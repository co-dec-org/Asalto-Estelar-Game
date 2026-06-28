/* ============================================================================
 * Web Video Game (hub) — skins.js
 * Motor de skins (temas visuales) reutilizable entre proyectos del hub.
 *
 * Cada skin es un set de variables CSS que se aplican en caliente sobre :root.
 * Incluye base compartida: noche, día y uno conceptual (neón). Cada proyecto
 * puede añadir los suyos con Skins.register('miSkin', {...}).
 *
 * Selección generativa: por defecto sigue el `prefers-color-scheme` del sistema
 * (claro → día, oscuro → noche) y recuerda la elección manual en localStorage.
 *
 * Expone: window.Skins = { init, apply, toggle, current, list, label, register }
 * ========================================================================== */
(function (global) {
  'use strict';

  var SKINS = {
    night: { label: 'Noche', vars: {
      '--bg': '#000a18', '--bg2': '#06182b', '--fg': '#cfeffff0',
      '--muted': '#7fb0c8', '--accent': '#00eeff', '--accent2': '#0088ff'
    }},
    day: { label: 'Día', vars: {
      '--bg': '#e9f1fa', '--bg2': '#ffffff', '--fg': '#0a2233',
      '--muted': '#5a7184', '--accent': '#0077cc', '--accent2': '#3399ff'
    }},
    neon: { label: 'Neón (conceptual)', vars: {
      '--bg': '#0a0014', '--bg2': '#1a0a2e', '--fg': '#ffe6ff',
      '--muted': '#c79fd6', '--accent': '#ff2bd6', '--accent2': '#9b5cff'
    }}
  };
  var order = ['night', 'day', 'neon'];
  var currentName = 'night';
  var KEY = 'hub.skin';

  function register(name, def) {
    SKINS[name] = def;
    if (order.indexOf(name) < 0) order.push(name);
  }

  function apply(name) {
    if (!SKINS[name]) name = 'night';
    var vars = SKINS[name].vars, root = document.documentElement;
    for (var k in vars) { if (vars.hasOwnProperty(k)) root.style.setProperty(k, vars[k]); }
    root.setAttribute('data-skin', name);
    currentName = name;
    try { localStorage.setItem(KEY, name); } catch (e) {}
  }

  function pickDefault() {
    try { var saved = localStorage.getItem(KEY); if (saved && SKINS[saved]) return saved; } catch (e) {}
    if (global.matchMedia && global.matchMedia('(prefers-color-scheme: light)').matches) return 'day';
    return 'night';
  }

  function init() { apply(pickDefault()); }
  function toggle() { var i = order.indexOf(currentName); apply(order[(i + 1) % order.length]); return currentName; }
  function current() { return currentName; }
  function label(name) { return (SKINS[name] || {}).label || name; }

  global.Skins = {
    init: init, apply: apply, toggle: toggle, current: current,
    list: function () { return order.slice(); }, label: label, register: register
  };

})(typeof window !== 'undefined' ? window : this);
