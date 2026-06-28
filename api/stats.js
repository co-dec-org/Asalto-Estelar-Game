/* ============================================================================
 * Web Video Game (hub) — api/stats.js
 * Función serverless (Vercel) para recopilar estadísticas ANÓNIMAS del auto-test.
 *
 * Backend: Supabase (Postgres) vía su REST API (PostgREST) con `fetch` nativo —
 * sin dependencias npm. Guarda UNA FILA POR VISITA en la tabla `visits`, lo que
 * permite análisis SQL posterior (por dispositivo, nivel, GPU, fecha, etc.).
 *
 * - POST: inserta la visita (vía navigator.sendBeacon). Anónimo: sin PII.
 * - GET:  devuelve agregados llamando a la función SQL `stats_summary()`.
 *
 * Variables de entorno (las inyecta Vercel al conectar Supabase; NO van en git):
 *   SUPABASE_URL                 (o NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY    (o SUPABASE_SERVICE_KEY) — solo en el servidor.
 *
 * Esquema requerido (ejecutar una vez en el SQL Editor de Supabase): ver README.
 * Degrada con gracia: si no hay credenciales, no falla — solo registra en log.
 * ========================================================================== */

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const DB_ON = !!(SB_URL && SB_KEY);

function sbHeaders(extra) {
  return Object.assign({
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json'
  }, extra || {});
}

// Inserta una fila en la tabla `visits`.
async function insertVisit(row) {
  const r = await fetch(`${SB_URL}/rest/v1/visits`, {
    method: 'POST',
    headers: sbHeaders({ 'Prefer': 'return=minimal' }),
    body: JSON.stringify(row)
  });
  if (!r.ok) throw new Error('insert HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120));
}

// Llama a la función SQL stats_summary() y devuelve su JSON.
async function fetchSummary() {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/stats_summary`, {
    method: 'POST',
    headers: sbHeaders(),
    body: '{}'
  });
  if (!r.ok) throw new Error('rpc HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return r.json();
}

// Deja solo campos no identificatorios y los mapea a columnas de la tabla.
function toRow(b) {
  b = b || {};
  const dev = ['phone', 'tablet', 'desktop'].includes(b.deviceType) ? b.deviceType : 'unknown';
  const tier = ['high', 'low'].includes(b.tier) ? b.tier : 'unknown';
  const scr = (b.screen && b.screen.w) ? b.screen : {};
  return {
    device_type: dev,
    tier: tier,
    tier_score: Number(b.tierScore) || null,
    cores: Number(b.cores) || null,
    memory: Number(b.memory) || null,
    dpr: Number(b.dpr) || null,
    gpu: (b.gpu && typeof b.gpu.renderer === 'string') ? b.gpu.renderer.slice(0, 120) : null,
    net: (b.net && typeof b.net.effectiveType === 'string') ? b.net.effectiveType : null,
    screen_w: Number(scr.w) || null,
    screen_h: Number(scr.h) || null,
    lang: typeof b.lang === 'string' ? b.lang.slice(0, 12) : null
  };
}

module.exports = async (req, res) => {
  // ── POST: registrar una visita ─────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      // sendBeacon suele enviar text/plain → req.body puede llegar como string.
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const row = toRow(body);

      if (DB_ON) await insertVisit(row);
      else console.log('[stats] (Supabase no configurado) visita anónima:', row);
    } catch (e) {
      console.error('[stats] error al guardar:', e && e.message);
    }
    // sendBeacon ignora la respuesta: nunca devolvemos error ruidoso.
    res.status(204).end();
    return;
  }

  // ── GET: agregados ─────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (!DB_ON) {
      res.status(200).json({ ready: false, note: 'Supabase no configurado. Conecta la BD y crea la tabla.' });
      return;
    }
    try {
      const s = await fetchSummary();
      res.status(200).json({
        ready: true,
        total: s.total || 0,
        today: s.today || 0,
        byDevice: s.byDevice || { phone: 0, tablet: 0, desktop: 0 },
        byTier: s.byTier || { high: 0, low: 0 }
      });
    } catch (e) {
      res.status(500).json({ ready: false, error: 'Supabase no disponible', detail: e && e.message });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido' });
};
