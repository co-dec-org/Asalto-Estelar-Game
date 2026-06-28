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

`api/stats.js` no usa dependencias npm: habla con **Vercel KV** (Upstash) por su
REST API usando variables de entorno. Endpoints:

- `POST /api/stats.js` — guarda contadores agregados (total, por dispositivo, por
  nivel, por día) y una lista reciente capada a 500.
- `GET /api/stats.js` — devuelve los agregados en JSON (base para un panel).

**Degrada con gracia**: si KV no está configurado, no falla; solo registra el
perfil en los logs de la función. Para activar la persistencia:

1. En el dashboard de Vercel del proyecto: **Storage → Create → KV** (Upstash).
   Vercel inyecta solo las env vars `KV_REST_API_URL` y `KV_REST_API_TOKEN`
   (no van en el repo: cero secretos versionados).
2. Redeploy. Cada visita suma a los agregados, consultables en `GET /api/stats.js`.

## Controles

- **Teclado**: WASD / flechas para mover, Espacio para disparar.
- **Móvil**: arrastra para mover; disparo automático.

## Local y despliegue

- Local: abrir `index.html` (los scripts cargan como assets de la misma carpeta).
  El envío de estadísticas no aplica en local (no hay `/api`); el auto-test y el
  juego funcionan igual.
- Deploy: Vercel en **zero-config**. Sirve los estáticos (`index.html`,
  `capabilities.js`) automáticamente y auto-detecta `api/stats.js` como función
  serverless en `/api/stats`. `vercel.json` solo activa `cleanUrls`.
