/* ============================================================================
 * Web Video Game (hub) — api/stats.js
 * Función serverless (Vercel) para recopilar estadísticas ANÓNIMAS del auto-test.
 *
 * - POST: recibe el perfil del dispositivo (vía navigator.sendBeacon) y guarda
 *   contadores agregados + una lista reciente capada en Vercel KV (Upstash).
 * - GET:  devuelve los agregados (para un futuro panel).
 *
 * Sin dependencias npm: usa `fetch` nativo contra la REST API de Upstash, con
 * las variables de entorno que Vercel KV inyecta automáticamente
 * (KV_REST_API_URL, KV_REST_API_TOKEN). NO hay secretos en el repo.
 *
 * Degrada con gracia: si KV no está configurado, no falla — solo registra en log.
 * El perfil es anónimo por diseño (sin PII): se sanea antes de guardar.
 * ========================================================================== */

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KV_ON = !!(KV_URL && KV_TOKEN);

// Ejecuta una serie de comandos Redis en un solo POST (pipeline de Upstash).
async function kvPipeline(commands) {
  if (!KV_ON) return null;
  const r = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!r.ok) throw new Error('KV pipeline HTTP ' + r.status);
  return r.json();
}

// Deja solo campos no identificatorios y acota tipos.
function sanitize(b) {
  b = b || {};
  const dev = ['phone', 'tablet', 'desktop'].includes(b.deviceType) ? b.deviceType : 'unknown';
  const tier = ['high', 'low'].includes(b.tier) ? b.tier : 'unknown';
  return {
    deviceType: dev,
    tier: tier,
    tierScore: Number(b.tierScore) || null,
    cores: Number(b.cores) || null,
    memory: Number(b.memory) || null,
    dpr: Number(b.dpr) || null,
    gpu: (b.gpu && typeof b.gpu.renderer === 'string') ? b.gpu.renderer.slice(0, 80) : null,
    net: (b.net && typeof b.net.effectiveType === 'string') ? b.net.effectiveType : null,
    screen: (b.screen && b.screen.w) ? { w: b.screen.w, h: b.screen.h } : null,
    lang: typeof b.lang === 'string' ? b.lang.slice(0, 12) : null,
    ts: Date.now()
  };
}

function today() { return new Date().toISOString().slice(0, 10); } // YYYY-MM-DD

module.exports = async (req, res) => {
  // ── POST: registrar un perfil ──────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      // sendBeacon suele enviar text/plain → req.body puede llegar como string.
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const p = sanitize(body);

      if (KV_ON) {
        await kvPipeline([
          ['INCR', 'stats:total'],
          ['INCR', `stats:device:${p.deviceType}`],
          ['INCR', `stats:tier:${p.tier}`],
          ['INCR', `stats:day:${today()}`],
          ['LPUSH', 'stats:recent', JSON.stringify(p)],
          ['LTRIM', 'stats:recent', '0', '499']
        ]);
      } else {
        console.log('[stats] (KV no configurado) perfil anónimo:', p);
      }
    } catch (e) {
      console.error('[stats] error al guardar:', e && e.message);
    }
    // sendBeacon ignora la respuesta: nunca devolvemos error ruidoso.
    res.status(204).end();
    return;
  }

  // ── GET: agregados ─────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (!KV_ON) {
      res.status(200).json({ kv: false, note: 'Vercel KV no configurado. Activa KV para persistir.' });
      return;
    }
    try {
      const out = await kvPipeline([
        ['GET', 'stats:total'],
        ['GET', 'stats:tier:high'],
        ['GET', 'stats:tier:low'],
        ['GET', 'stats:device:phone'],
        ['GET', 'stats:device:tablet'],
        ['GET', 'stats:device:desktop'],
        ['GET', `stats:day:${today()}`]
      ]);
      const v = out.map(x => Number(x.result) || 0);
      res.status(200).json({
        kv: true,
        total: v[0],
        byTier: { high: v[1], low: v[2] },
        byDevice: { phone: v[3], tablet: v[4], desktop: v[5] },
        today: v[6]
      });
    } catch (e) {
      res.status(500).json({ error: 'KV no disponible', detail: e && e.message });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido' });
};
