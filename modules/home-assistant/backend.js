const { defineHttpModule } = require('../../src/main/integrations/httpModule');

/**
 * Home Assistant.
 *
 * Die REST-Schnittstelle ist standardmässig aktiv und braucht nur einen
 * langlebigen Zugriffstoken (im HA-Profil ganz unten erzeugbar, zehn Jahre
 * gültig).
 *
 * Der heikle Teil ist nicht das Anzeigen, sondern das Schalten. Ein Modul,
 * das beliebige {domain, service}-Paare durchreicht, ist eine Fernbedienung
 * für alles, was Home Assistant kann - einschliesslich Türschlössern,
 * Alarmanlagen und `homeassistant.stop`. Deshalb drei Schranken, die ALLE
 * greifen müssen:
 *
 *   1. allowControl muss ausdrücklich eingeschaltet sein (Standard: aus).
 *   2. Die Entität muss in der konfigurierten Liste stehen.
 *   3. Die Domain muss auf einer fest verdrahteten Liste stehen.
 *
 * Die dritte Schranke ist die wichtigste: sie steht im Code, nicht in der
 * Konfiguration, und lässt sich über die Oberfläche nicht aufweichen.
 */

// Bewusst eng. Was hier fehlt, lässt sich nicht schalten - auch nicht, wenn
// jemand es in die Entitätenliste einträgt.
const ALLOWED_DOMAINS = new Set([
  'light', 'switch', 'scene', 'script',
  'media_player', 'cover', 'input_boolean', 'fan', 'climate'
]);

// Ebenfalls fest: nur diese Dienste, keine beliebigen.
const ALLOWED_SERVICES = new Set([
  'turn_on', 'turn_off', 'toggle',
  'open_cover', 'close_cover', 'stop_cover',
  'media_play', 'media_pause', 'media_play_pause', 'media_next_track', 'media_previous_track',
  'volume_set', 'set_temperature'
]);

function baseUrl(config) {
  const url = String(config.baseUrl || '').trim().replace(/\/+$/, '');
  if (!url || !/^https?:\/\//.test(url)) return null;
  return `${url}/api`;
}

function headersFor(config) {
  return {
    Authorization: `Bearer ${config.token}`,
    'Content-Type': 'application/json'
  };
}

/** Die konfigurierten Entitäten - kommagetrennt oder als Liste. */
function parseEntities(value) {
  if (Array.isArray(value)) {
    return value.map(entry => (typeof entry === 'string' ? entry : entry?.entity_id))
      .filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map(entry => entry.trim())
    // Eine Entitäts-Kennung ist immer domain.name.
    .filter(entry => /^[a-z_]+\.[a-z0-9_]+$/.test(entry));
}

/** Namen, die ohne Zusatz lesbar sind: "sensor.wohnzimmer_temp" hilft nicht. */
function friendlyName(state, fallback) {
  return state?.attributes?.friendly_name || fallback;
}

module.exports = defineHttpModule({
  name: 'home-assistant',

  defaults: {
    baseUrl: '',
    token: '',
    entities: '',
    allowControl: false,
    showUnavailable: false,
    allowInsecureTls: false,
    updateInterval: 15000,
    minInterval: 5000
  },

  buildRequests(config) {
    const base = baseUrl(config);
    if (!base || !config.token) return [];

    // Ein Abruf für alle Entitäten: /states liefert den gesamten Zustand.
    // Einzelabfragen wären bei zehn Entitäten zehn Anfragen.
    return [{
      url: `${base}/states`,
      headers: headersFor(config),
      allowInsecureTls: config.allowInsecureTls === true,
      conditional: false
    }];
  },

  transform([states], config) {
    const wanted = parseEntities(config.entities);
    const byId = new Map((states || []).map(state => [state.entity_id, state]));

    const entities = wanted.map(entityId => {
      const state = byId.get(entityId);

      if (!state) {
        return { entityId, name: entityId, state: 'unbekannt', available: false, domain: entityId.split('.')[0] };
      }

      const domain = entityId.split('.')[0];
      const available = state.state !== 'unavailable' && state.state !== 'unknown';

      return {
        entityId,
        domain,
        name: friendlyName(state, entityId),
        state: state.state,
        available,
        // Nur, was die Anzeige wirklich braucht - der volle
        // Attributsatz einer Entität ist teils riesig.
        unit: state.attributes?.unit_of_measurement || null,
        brightness: state.attributes?.brightness ?? null,
        temperature: state.attributes?.temperature ?? null,
        mediaTitle: state.attributes?.media_title || null,
        controllable: ALLOWED_DOMAINS.has(domain)
      };
    });

    return {
      entities: config.showUnavailable ? entities : entities.filter(e => e.available),
      // Die Oberfläche muss wissen, ob Schalten überhaupt erlaubt ist -
      // sonst zeigt sie Schalter, die nichts tun.
      controlEnabled: config.allowControl === true,
      total: wanted.length
    };
  },

  actions: {
    /**
     * Schaltet eine Entität. Alle drei Schranken werden hier geprüft - nicht
     * in der Oberfläche, denn die ist nur ein Client unter mehreren.
     */
    async call(body, { config, request }) {
      if (config.allowControl !== true) {
        const error = new Error('Steuerung ist nicht eingeschaltet.');
        error.code = 'CONTROL_DISABLED';
        throw error;
      }

      const entityId = String(body.entityId || '');
      const service = String(body.service || '');
      const domain = entityId.split('.')[0];

      if (!parseEntities(config.entities).includes(entityId)) {
        throw new Error(`"${entityId}" steht nicht in der konfigurierten Liste.`);
      }

      if (!ALLOWED_DOMAINS.has(domain)) {
        throw new Error(`Die Gattung "${domain}" lässt sich nicht schalten.`);
      }

      if (!ALLOWED_SERVICES.has(service)) {
        throw new Error(`Der Dienst "${service}" ist nicht erlaubt.`);
      }

      const base = baseUrl(config);
      const payload = { entity_id: entityId };

      // Nur die zwei Zusatzwerte, die überhaupt sinnvoll sind - und beide
      // begrenzt.
      if (Number.isFinite(Number(body.brightness))) {
        payload.brightness = Math.min(255, Math.max(0, Math.round(Number(body.brightness))));
      }
      if (Number.isFinite(Number(body.volumeLevel))) {
        payload.volume_level = Math.min(1, Math.max(0, Number(body.volumeLevel)));
      }

      await request({
        url: `${base}/services/${domain}/${service}`,
        method: 'POST',
        headers: headersFor(config),
        body: payload,
        allowInsecureTls: config.allowInsecureTls === true,
        conditional: false
      });

      return { entityId, service };
    }
  },

  async testConnection(config, request) {
    const base = baseUrl(config);
    if (!base) return { ok: false, error: 'Es fehlt noch die Adresse von Home Assistant.' };
    if (!config.token) return { ok: false, error: 'Es fehlt noch der Zugriffstoken.' };

    try {
      const response = await request({
        url: `${base}/states`,
        headers: headersFor(config),
        allowInsecureTls: config.allowInsecureTls === true,
        conditional: false
      });

      const all = response.data || [];
      const wanted = parseEntities(config.entities);
      const found = wanted.filter(id => all.some(state => state.entity_id === id));

      return {
        ok: true,
        entitiesTotal: all.length,
        configured: wanted.length,
        found: found.length,
        // Ein Tippfehler in einer Kennung ist der häufigste Grund dafür,
        // dass "nichts angezeigt wird".
        missing: wanted.filter(id => !found.includes(id))
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
});

module.exports._guards = { ALLOWED_DOMAINS, ALLOWED_SERVICES, parseEntities };
