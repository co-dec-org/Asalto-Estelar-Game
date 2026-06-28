# Stellar Assault — Asalto Estelar

Shoot 'em up en **Canvas 2D + Web Audio API**, en un solo `index.html` sin
dependencias. Forma parte del hub **Web Video Game**, cuyo objetivo es explorar
las Web API de audio y video llevando al límite cada dispositivo sin sacrificar
fluidez.

## Web generativa (auto-test → configuración adaptada)

Al cargar, la web **evalúa el dispositivo** antes de jugar (`capabilities.js`) y
**genera** la configuración de calidad óptima:

1. **Detecta el tipo de dispositivo**: `phone` / `tablet` / `desktop`.
2. **Mide capacidad real** con micro-benchmarks (CPU + render canvas) y lee
   señales del sistema (núcleos, RAM, GPU, DPR, red).
3. **Clasifica en dos niveles**:
   - **Capa Alta**: glow (shadowBlur), DPR hasta 2x, más partículas y estrellas.
   - **Capa Baja**: sin glow, DPR 1, densidad reducida → fluidez en equipos modestos.
4. **Adapta el juego** a esa configuración (`Q`) en tiempo de ejecución.

El umbral del clasificador (`classify`) es calibrable en `capabilities.js`.

## Optimizaciones de rendimiento

- `shadowBlur` (lo más caro del canvas) **solo en Capa Alta**.
- **Cache de gradientes** (naves, llamas, balas) en vez de recrearlos por frame.
- **devicePixelRatio**: nitidez en pantallas retina sin reescribir el render.
- **Page Visibility API**: pausa el bucle al ocultar la pestaña (ahorro de batería).
- **Bus de audio maestro** (`GainNode`) + `resume()` también en arranque por teclado.
- Densidad de partículas / estrellas y techo de proyectiles según el nivel.

## Estadísticas anónimas (opcional)

El perfil del dispositivo es **anónimo por diseño** (sin datos personales). El
juego ya lo envía con `navigator.sendBeacon` a la función serverless
`api/stats.js` (endpoint cableado en `index.html`:
`window.CAP_STATS_ENDPOINT = "/api/stats.js"`).

`api/stats.js` no usa dependencias npm: habla con **Supabase (Postgres)** por su
REST API (PostgREST) usando `fetch`. Guarda **una fila por visita** en la tabla
`visits`, lo que permite análisis SQL posterior. Endpoints:

- `POST /api/stats.js` — inserta la visita (dispositivo, nivel, puntaje, GPU,
  núcleos, RAM, red, pantalla, idioma, fecha). Anónimo, sin PII.
- `GET /api/stats.js` — devuelve agregados vía la función SQL `stats_summary()`.

**Degrada con gracia**: sin credenciales no falla; solo registra en los logs.

### Activar Supabase

1. Conecta Supabase al proyecto en Vercel (**Storage → Marketplace → Supabase**,
   o crea el proyecto en supabase.com y añade las env vars). Necesarias (solo en
   el servidor, nunca en git): `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
2. En el **SQL Editor** de Supabase, ejecuta una vez:

```sql
create table if not exists visits (
  id           bigint generated always as identity primary key,
  created_at   timestamptz default now(),
  app          text,                -- qué web del hub (base compartida entre proyectos)
  device_type  text,                -- phone | tablet | desktop
  tier         text,                -- high | low (gama alta / baja)
  orientation  text,                -- portrait | landscape
  aspect_ratio numeric,             -- ancho/alto del viewport
  skin         text,                -- skin/tema activo
  country      text,                -- geo aproximado por IP (headers de Vercel)
  region       text,
  city         text,
  lat          numeric,             -- lat/long APROXIMADAS por IP (no es GPS)
  lon          numeric,
  tier_score   int,
  cores        int,
  memory       int,
  dpr          numeric,
  gpu          text,
  net          text,
  screen_w     int,
  screen_h     int,
  lang         text
);
create index if not exists visits_app_idx on visits (app);

-- Resumen filtrable por app (p_app = null => todas las webs del hub).
-- Usa count(*) FILTER (...) para una sola pasada sobre la tabla.
create or replace function stats_summary(p_app text default null)
returns json language sql stable as $$
  select json_build_object(
    'total', count(*),
    'today', count(*) filter (where created_at::date = current_date),
    'byDevice', json_build_object(
       'phone',   count(*) filter (where device_type='phone'),
       'tablet',  count(*) filter (where device_type='tablet'),
       'desktop', count(*) filter (where device_type='desktop')),
    'byTier', json_build_object(
       'high', count(*) filter (where tier='high'),
       'low',  count(*) filter (where tier='low')),
    'byOrientation', json_build_object(
       'portrait',  count(*) filter (where orientation='portrait'),
       'landscape', count(*) filter (where orientation='landscape')),
    'orientationByDevice', json_build_object(
       'phone',   json_build_object(
          'portrait',  count(*) filter (where device_type='phone' and orientation='portrait'),
          'landscape', count(*) filter (where device_type='phone' and orientation='landscape')),
       'tablet',  json_build_object(
          'portrait',  count(*) filter (where device_type='tablet' and orientation='portrait'),
          'landscape', count(*) filter (where device_type='tablet' and orientation='landscape')),
       'desktop', json_build_object(
          'portrait',  count(*) filter (where device_type='desktop' and orientation='portrait'),
          'landscape', count(*) filter (where device_type='desktop' and orientation='landscape'))),
    'bySkin', coalesce((select json_object_agg(skin, c) from (
        select skin, count(*) c from visits v2
        where (p_app is null or v2.app = p_app) and skin is not null
        group by skin) t), '{}'::json),
    'topCountries', coalesce((select json_agg(json_build_object('country', country, 'n', c)) from (
        select country, count(*) c from visits v3
        where (p_app is null or v3.app = p_app) and country is not null
        group by country order by c desc limit 8) t2), '[]'::json),
    'topRegions', coalesce((select json_agg(json_build_object('region', region, 'n', c)) from (
        select region, count(*) c from visits v4
        where (p_app is null or v4.app = p_app) and region is not null
        group by region order by c desc limit 8) t4), '[]'::json),
    'topCities', coalesce((select json_agg(json_build_object('city', city, 'region', region, 'n', c)) from (
        select city, region, count(*) c from visits v5
        where (p_app is null or v5.app = p_app) and city is not null
        group by city, region order by c desc limit 12) t5), '[]'::json)
  )
  from visits
  where p_app is null or app = p_app;
$$;
```

3. Redeploy. Cada visita inserta una fila; el panel y `GET /api/stats.js` los muestran.

Hay un panel visual en `stats.html` (ruta `/stats.html`) que lee el endpoint y
muestra las visitas por dispositivo, nivel, orientación, skin y país. Si la BD no
está conectada, lo indica.

### Política de geolocalización (estándar del hub)

Dos niveles según el tipo de usuario:

- **Anónimos → geo por IP, hasta CIUDAD.** La función lee los headers que Vercel
  inyecta (`x-vercel-ip-country`, `x-vercel-ip-country-region`,
  `x-vercel-ip-city`, `x-vercel-ip-latitude/longitude`). Es aproximado a nivel
  ciudad (NO precisión GPS; lat/long es el centroide de la ciudad), **sin pedir
  permiso** y **sin guardar el IP crudo**. No se intenta comuna a este nivel.

- **Usuarios registrados → GPS con consentimiento + reverse-geocoding.** Solo
  para usuarios que se registran y dan permiso explícito: `navigator.geolocation`
  da lat/long precisas y un servicio de reverse-geocoding las traduce a
  comuna/dirección. Esto es dato personal: se guarda bajo el perfil del usuario
  (no en `visits` anónima), con consentimiento y opción de borrado. Requiere una
  capa de registro/autenticación en el proyecto que lo use.

El módulo reutilizable es `geolocate.js` (reverse-geocoding con **Nominatim /
OpenStreetMap**, gratis). Uso, tras el consentimiento del usuario y desde un
gesto (click):

```html
<script src="geolocate.js"></script>
<script>
  botonUbicacion.onclick = async () => {
    if (!Geolocate.available()) return;
    try {
      const loc = await Geolocate.locate({ language: 'es' });
      // loc.comuna, loc.city, loc.region, loc.country, loc.coords {lat,lon}
      // → guardar bajo el perfil del usuario registrado (no en visits anónima)
    } catch (e) { /* permiso denegado o sin señal */ }
  };
</script>
```

Atribución requerida al usar Nominatim: mostrar “© OpenStreetMap contributors”.
Para volumen alto, self-host de Nominatim o proxy server-side (User-Agent propio).

## Skins (temas visuales)

`skins.js` es un motor de temas reutilizable del hub: cada skin es un set de
variables CSS que se aplican sobre `:root`. Trae base compartida **noche / día /
neón (conceptual)**; cada proyecto puede añadir los suyos con
`Skins.register(nombre, { label, vars })`. Por defecto sigue el
`prefers-color-scheme` del sistema y recuerda la elección en `localStorage`. El
skin activo se registra en cada visita (columna `skin`) y se ve en el panel.

## Controles

- **Teclado**: WASD / flechas para mover, Espacio para disparar.
- **Móvil**: arrastra para mover; disparo automático.

## Local y despliegue

- Local: abrir `index.html` (los scripts cargan como assets de la misma carpeta).
  El envío de estadísticas no aplica en local (no hay `/api`); el auto-test y el
  juego funcionan igual.
- Deploy: Vercel. `vercel.json` sirve `*.html` y `*.js` con `@vercel/static`,
  construye `api/*.js` con `@vercel/node`, y usa `filesystem` antes del fallback
  a `index.html`. Con esta config la función queda en `/api/stats.js` (de ahí que
  el cliente apunte a esa ruta).
