/* ============================================================================
 * Web Video Game (hub) — capabilities.js
 * Auto-test de dispositivo + clasificación por niveles (capa alta / capa baja).
 *
 * Objetivo: que la web sea "generativa": primero evalúa el dispositivo del
 * visitante (Phone / Tablet / Desktop + capacidad de cómputo y render) y luego
 * genera la configuración de calidad óptima para llevar al límite las
 * Web API de audio y video sin sacrificar fluidez en equipos modestos.
 *
 * Sin dependencias. Reutilizable entre los mini-juegos del hub.
 * Expone:  window.Capabilities = { run, detectDeviceType, qualityFor,
 *                                  defaultQuality, reportStats }
 * ========================================================================== */
(function (global) {
  'use strict';

  function nv() { return global.navigator || {}; }   // navigator en vivo (no cacheado)

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---- Tipo de dispositivo: phone / tablet / desktop --------------------- */
  function detectDeviceType() {
    var nav = nv();
    var ua = nav.userAgent || '';
    var uaData = nav.userAgentData || null;
    var coarse = global.matchMedia ? global.matchMedia('(pointer:coarse)').matches : false;
    var touch = nav.maxTouchPoints || 0;
    var sw = (global.screen && screen.width) || global.innerWidth || 0;
    var sh = (global.screen && screen.height) || global.innerHeight || 0;
    var big = Math.max(sw, sh);

    // iPadOS reciente se hace pasar por Mac: detectar por touch.
    var iPadOSDesktopUA = /Macintosh/.test(ua) && touch > 1;
    if (/iPad|PlayBook|Silk/i.test(ua) || iPadOSDesktopUA) return 'tablet';
    if (/Tablet/i.test(ua)) return 'tablet';
    // Android sin "Mobile" suele ser tablet.
    if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';

    var mobileHint = uaData ? !!uaData.mobile : /Mobi|iPhone|iPod|Android.*Mobile/i.test(ua);
    if (mobileHint) {
      // iPad y Android-tablet ya se filtraron arriba. Aquí, por lado MENOR de la
      // pantalla: teléfonos < ~600px lógicos; >=600 es tablet (evita falsos
      // positivos con teléfonos altos modernos de 900+px de lado largo).
      var small = Math.min(sw, sh) || 0;
      return small >= 600 ? 'tablet' : 'phone';
    }
    // Sin pista móvil pero táctil y pantalla mediana => tablet.
    if (coarse && touch > 0 && big < 1366) return 'tablet';
    return 'desktop';
  }

  /* ---- GPU (cuando el navegador lo permite) ------------------------------ */
  function getGPU() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return { renderer: null, vendor: null, webgl2: false };
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      var renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
      var vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null;
      var webgl2 = false;
      try { webgl2 = !!document.createElement('canvas').getContext('webgl2'); } catch (e) {}
      return { renderer: renderer, vendor: vendor, webgl2: webgl2 };
    } catch (e) { return { renderer: null, vendor: null, webgl2: false }; }
  }

  /* ---- Micro-benchmark de CPU -------------------------------------------- */
  // Cuenta operaciones matemáticas que caben en un presupuesto fijo de tiempo.
  function cpuBench(budgetMs) {
    var end = performance.now() + budgetMs;
    var ops = 0, x = 0;
    while (performance.now() < end) {
      for (var i = 0; i < 10000; i++) { x += Math.sqrt(i * 1.0001) * Math.sin(i); }
      ops += 10000;
    }
    return { ops: ops, _sink: x };
  }

  /* ---- Micro-benchmark de render (canvas 2D con sombra = caro) ----------- */
  function canvasBench(budgetMs) {
    try {
      var c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      var ctx = c.getContext('2d');
      var end = performance.now() + budgetMs;
      var draws = 0;
      while (performance.now() < end) {
        ctx.save();
        ctx.shadowColor = '#00ffff'; ctx.shadowBlur = 8;
        ctx.fillStyle = '#00eeff';
        for (var i = 0; i < 50; i++) {
          ctx.beginPath();
          ctx.arc((draws * 7 + i * 13) % 256, (draws * 11 + i * 17) % 256, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        draws += 50;
      }
      return { draws: draws };
    } catch (e) { return { draws: 0 }; }
  }

  /* ---- Info de audio ----------------------------------------------------- */
  function getAudioInfo() {
    try {
      var A = global.AudioContext || global.webkitAudioContext;
      if (!A) return null;
      var c = new A();
      var info = { sampleRate: c.sampleRate, baseLatency: c.baseLatency || null };
      if (c.close) c.close();
      return info;
    } catch (e) { return null; }
  }

  /* ---- Orientación y viewport -------------------------------------------- */
  function getOrientation() {
    if (global.matchMedia) {
      return global.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape';
    }
    var w = global.innerWidth || 0, h = global.innerHeight || 0;
    return h >= w ? 'portrait' : 'landscape';
  }
  function aspectRatio() {
    var w = global.innerWidth || 0, h = global.innerHeight || 0;
    return h > 0 ? Math.round((w / h) * 100) / 100 : null;
  }

  /* ---- Red ---------------------------------------------------------------- */
  function getNet() {
    var nav = nv();
    var c = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (!c) return null;
    return { effectiveType: c.effectiveType || null, downlink: c.downlink || null, saveData: !!c.saveData };
  }

  /* ---- Clasificación en niveles (capa alta / capa baja) ------------------ */
  // Combina benchmarks reales + specs declaradas. Umbrales calibrables.
  function classify(p) {
    var cpu  = clamp(p.bench.cpuOps / 4.0e6, 0, 1);     // ~4M ops/90ms => tope
    var cv   = clamp(p.bench.canvasDraws / 9000, 0, 1);  // ~9k draws/90ms => tope
    var core = clamp((p.cores || 2) / 8, 0, 1);
    var mem  = clamp((p.memory || 2) / 8, 0, 1);

    var s = (cpu * 0.34 + cv * 0.34 + core * 0.16 + mem * 0.16) * 100;

    var r = ((p.gpu && p.gpu.renderer) || '').toLowerCase();
    if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(r)) s *= 0.5; // GPU emulada
    if (p.net && p.net.saveData) s *= 0.9;            // usuario pidió ahorrar datos
    if (p.deviceType === 'phone') s *= 0.92;          // margen de seguridad térmico/batería

    return { tier: s >= 48 ? 'high' : 'low', score: Math.round(s),
             parts: { cpu: cpu, canvas: cv, core: core, mem: mem } };
  }

  /* ---- Config de calidad generada a partir del nivel --------------------- */
  function qualityFor(tier, device, dpr) {
    if (tier === 'high') {
      return {
        tier: 'high', label: 'Capa Alta', dpr: Math.min(dpr || 1, 2),
        glow: true, particleScale: 1,
        stars: device === 'phone' ? 130 : 220,
        maxBullets: 240, audioVoices: 'full'
      };
    }
    return {
      tier: 'low', label: 'Capa Baja', dpr: 1,
      glow: false, particleScale: 0.45,
      stars: device === 'phone' ? 60 : 110,
      maxBullets: 120, audioVoices: 'reduced'
    };
  }

  function defaultQuality() {
    // Config conservadora mientras corre el test (el overlay tapa la pantalla).
    return qualityFor('low', detectDeviceType(), 1);
  }

  /* ---- Recopilación anónima de estadísticas ------------------------------ */
  // Anónimo por diseño: NO recoge PII. Solo se envía si el sitio define
  // window.CAP_STATS_ENDPOINT (p. ej. una función serverless de Vercel).
  function reportStats(profile) {
    try {
      var nav = nv();
      var endpoint = global.CAP_STATS_ENDPOINT;
      if (endpoint && nav.sendBeacon) {
        nav.sendBeacon(endpoint, JSON.stringify(profile));
      }
      if (global.console) console.log('[Capabilities] perfil anónimo:', profile);
    } catch (e) {}
  }

  /* ---- Orquestador del test --------------------------------------------- */
  async function run(progress) {
    var nav = nv();
    function step(pct, label) { if (progress) progress({ pct: pct, label: label }); }

    step(5, 'Detectando dispositivo…');
    await delay(60);
    var deviceType = detectDeviceType();
    var dpr = global.devicePixelRatio || 1;

    step(20, 'Analizando GPU…');
    await delay(60);
    var gpu = getGPU();

    step(40, 'Midiendo CPU…');
    await delay(30);
    var cpu = cpuBench(90);

    step(70, 'Midiendo render (canvas)…');
    await delay(30);
    var cv = canvasBench(90);

    step(90, 'Calculando perfil…');
    await delay(40);
    var audio = getAudioInfo();
    var net = getNet();

    var profile = {
      deviceType: deviceType,
      dpr: dpr,
      cores: nav.hardwareConcurrency || null,
      memory: nav.deviceMemory || null,
      screen: { w: (global.screen && screen.width) || null, h: (global.screen && screen.height) || null },
      orientation: getOrientation(),
      aspectRatio: aspectRatio(),
      gpu: gpu,
      audio: audio,
      net: net,
      bench: { cpuOps: cpu.ops, canvasDraws: cv.draws },
      lang: nav.language || null,
      ts: Date.now()
    };

    var scored = classify(profile);
    profile.tier = scored.tier;
    profile.tierScore = scored.score;

    var quality = qualityFor(scored.tier, deviceType, dpr);
    step(100, 'Listo');

    return { profile: profile, quality: quality, tier: scored.tier, score: scored.score, parts: scored.parts };
  }

  global.Capabilities = {
    run: run,
    detectDeviceType: detectDeviceType,
    classify: classify,
    qualityFor: qualityFor,
    defaultQuality: defaultQuality,
    reportStats: reportStats
  };

})(typeof window !== 'undefined' ? window : this);
