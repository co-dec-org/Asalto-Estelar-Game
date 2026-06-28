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
  id          bigint generated always as identity primary key,
  created_at  timestamptz default now(),
  app         text,                 -- qué web del hub (base compartida entre proyectos)
  device_type text,                 -- phone | tablet | desktop
  tier        text,                 -- high | low (gama alta / baja)
  tier_score  int,
  cores       int,
  memory      int,
  dpr         numeric,
  gpu         text,
  net         text,
  screen_w    int,
  screen_h    int,
  lang        text
);
create index if not exists visits_app_idx on visits (app);

-- Resumen filtrable por app (p_app = null => todas las webs del hub).
create or replace function stats_summary(p_app text default null)
returns json language sql stable as $$
  select json_build_object(
    'total',  (select count(*) from visits where p_app is null or app = p_app),
    'today',  (select count(*) from visits where (p_app is null or app = p_app)
                 and created_at::date = current_date),
    'byDevice', json_build_object(
       'phone',   (select count(*) from visits where (p_app is null or app = p_app) and device_type='phone'),
       'tablet',  (select count(*) from visits where (p_app is null or app = p_app) and device_type='tablet'),
       'desktop', (select count(*) from visits where (p_app is null or app = p_app) and device_type='desktop')),
    'byTier', json_build_object(
       'high', (select count(*) from visits where (p_app is null or app = p_app) and tier='high'),
       'low',  (select count(*) from visits where (p_app is null or app = p_app) and tier='low'))
  );
$$;
```

3. Redeploy. Cada visita inserta una fila; el panel y `GET /api/stats.js` los muestran.

Hay un panel visual en `stats.html` (ruta `/stats.html`) que lee el endpoint y
muestra las visitas por dispositivo y por nivel. Si la BD no está conectada, lo indica.

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
