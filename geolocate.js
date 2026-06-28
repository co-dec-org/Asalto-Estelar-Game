/* ============================================================================
 * Web Video Game (hub) — geolocate.js
 * Geolocalización PRECISA para USUARIOS REGISTRADOS (con consentimiento).
 *
 * Flujo: el proyecto pide consentimiento → Geolocate.locate() →
 *   navigator.geolocation (GPS, el navegador pide permiso) →
 *   reverse-geocoding con Nominatim (OpenStreetMap, gratis) →
 *   devuelve país / región / ciudad / COMUNA / dirección.
 *
 * IMPORTANTE (política del hub):
 *  - Esto es DATO PERSONAL. Úsalo solo con usuarios registrados que dieron
 *    consentimiento explícito. Guárdalo bajo el perfil del usuario (no en la
 *    tabla anónima `visits`). Ofrece borrado.
 *  - NO se llama solo: el proyecto invoca locate() tras el consentimiento,
 *    idealmente desde un gesto del usuario (click) para el prompt de permiso.
 *  - Nominatim: uso ligero, requiere atribución "© OpenStreetMap contributors".
 *    Para volumen alto, self-host o proxy server-side (User-Agent propio).
 *
 * Expone: window.Geolocate = { available, locate }
 * ========================================================================== */
(function (global) {
  'use strict';

  var DEFAULT_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';

  function available() {
    return !!(global.navigator && global.navigator.geolocation);
  }

  // Promesa sobre getCurrentPosition.
  function getPosition(opts) {
    return new Promise(function (resolve, reject) {
      if (!available()) { reject(new Error('Geolocation no soportada')); return; }
      global.navigator.geolocation.getCurrentPosition(
        function (pos) { resolve(pos); },
        function (err) { reject(err); },
        {
          enableHighAccuracy: opts.highAccuracy !== false,
          timeout: opts.timeout || 12000,
          maximumAge: opts.maximumAge || 0
        }
      );
    });
  }

  // Reverse-geocoding con Nominatim → objeto address.
  async function reverseGeocode(lat, lon, opts) {
    var url = (opts.endpoint || DEFAULT_ENDPOINT)
      + '?format=jsonv2&addressdetails=1&zoom=' + (opts.zoom || 18)
      + '&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon)
      + '&accept-language=' + (opts.language || 'es')
      + (opts.email ? '&email=' + encodeURIComponent(opts.email) : '');
    var r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('Nominatim HTTP ' + r.status);
    return r.json();
  }

  // En Chile la "comuna" suele venir como municipality/city/town/county/city_district.
  function pickComuna(a) {
    return a.municipality || a.city_district || a.county || a.town
        || a.city || a.suburb || a.village || null;
  }
  function pickCity(a) {
    return a.city || a.town || a.municipality || a.village || a.county || null;
  }
  function pickRegion(a) {
    return a.state || a.region || a.state_district || null;
  }

  /* locate(opts) → Promise<result>
   * result = {
   *   coords: { lat, lon, accuracy },
   *   country, countryCode, region, city, comuna, road, postcode,
   *   displayName, raw
   * }
   * opts: { highAccuracy, timeout, language, zoom, email, endpoint }
   */
  async function locate(opts) {
    opts = opts || {};
    var pos = await getPosition(opts);
    var lat = pos.coords.latitude, lon = pos.coords.longitude;
    var base = {
      coords: { lat: lat, lon: lon, accuracy: pos.coords.accuracy || null }
    };
    try {
      var geo = await reverseGeocode(lat, lon, opts);
      var a = (geo && geo.address) || {};
      return Object.assign(base, {
        country: a.country || null,
        countryCode: (a.country_code || '').toUpperCase() || null,
        region: pickRegion(a),
        city: pickCity(a),
        comuna: pickComuna(a),
        road: a.road || null,
        postcode: a.postcode || null,
        displayName: geo.display_name || null,
        raw: geo
      });
    } catch (e) {
      // Si el reverse-geocoding falla, igual devolvemos las coordenadas GPS.
      base.geocodeError = e && e.message;
      return base;
    }
  }

  global.Geolocate = { available: available, locate: locate };

})(typeof window !== 'undefined' ? window : this);
