const { defineHttpModule } = require('../../src/main/integrations/httpModule');

/**
 * Unraid-Server.
 *
 * Unraid 7 bringt eine offizielle GraphQL-Schnittstelle mit (in 7.2 fest
 * eingebaut, davor über das Connect-Plugin). Angesprochen wird sie über
 * POST /graphql mit dem Kopf x-api-key.
 *
 * Der Haken, und der Grund für den Aufbau hier:
 *
 *   Das Schema unterscheidet sich zwischen 7.0, 7.1 und 7.2. Felder heissen
 *   anders, manche gibt es gar nicht - VM-Abfragen etwa fehlen in manchen
 *   Fassungen komplett.
 *
 * Eine einzelne grosse Abfrage würde deshalb komplett scheitern, sobald ein
 * einziges Feld unbekannt ist: GraphQL antwortet dann mit einem Fehler für
 * die ganze Abfrage. Also je Abschnitt eine eigene Abfrage. Fällt einer aus,
 * fehlt genau dieser Abschnitt statt der ganzen Anzeige.
 *
 * Voraussetzungen, die man kennen muss (sonst sucht man lange):
 *   1. Unraid 7.2 oder das Connect-Plugin.
 *   2. Settings -> Management Access -> Developer Options einschalten.
 *   3. Schlüssel anlegen: unraid-api apikey --create
 */

const SECTIONS = {
  system: `query { metrics { cpu { percentTotal } memory { used total percentTotal } } }`,

  array: `query {
    array {
      state
      capacity { kilobytes { used free total } }
      disks { name temp fsUsed fsSize status }
      parityCheckStatus { status progress errors }
    }
  }`,

  docker: `query { docker { containers { names state status } } }`,

  vms: `query { vms { domains { name state } } }`
};

function endpoint(config) {
  const url = String(config.serverUrl || '').trim().replace(/\/+$/, '');
  if (!url || !/^https?:\/\//.test(url)) return null;
  return `${url}/graphql`;
}

function sectionsFor(config) {
  const wanted = [];
  if (config.showSystem !== false) wanted.push('system');
  if (config.showArray !== false) wanted.push('array');
  if (config.showDocker !== false) wanted.push('docker');
  if (config.showVms === true) wanted.push('vms');
  return wanted;
}

/** Temperatur einer Platte, oder null wenn es keine Angabe gibt. */
function readTemperature(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toGigabytes(kilobytes) {
  const value = Number(kilobytes);
  return Number.isFinite(value) ? value / 1024 / 1024 : null;
}

module.exports = defineHttpModule({
  name: 'unraid',

  defaults: {
    serverUrl: '',
    apiKey: '',
    allowInsecureTls: true,
    showSystem: true,
    showArray: true,
    showDocker: true,
    showVms: false,
    maxDisks: 8,
    updateInterval: 30000,
    minInterval: 10000
  },

  buildRequests(config) {
    const url = endpoint(config);
    if (!url || !config.apiKey) return [];

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      Accept: 'application/json'
    };

    return sectionsFor(config).map(section => ({
      url,
      method: 'POST',
      headers,
      body: { query: SECTIONS[section] },
      allowInsecureTls: config.allowInsecureTls !== false,
      // GraphQL antwortet auf POST; bedingte Anfragen ergeben hier keinen Sinn.
      conditional: false
    }));
  },

  transform(responses, config) {
    const sections = sectionsFor(config);
    const result = { unavailable: [] };

    sections.forEach((section, index) => {
      const response = responses[index];

      // GraphQL liefert Fehler mit HTTP 200 - hier steht also der eigentliche
      // Grund, warum ein Abschnitt fehlt.
      if (!response || response.errors || !response.data) {
        result.unavailable.push({
          section,
          reason: response?.errors?.[0]?.message || 'keine Antwort'
        });
        return;
      }

      const data = response.data;

      if (section === 'system' && data.metrics) {
        result.system = {
          cpuPercent: data.metrics.cpu?.percentTotal ?? null,
          memoryPercent: data.metrics.memory?.percentTotal ?? null,
          memoryUsedGb: toGigabytes(data.metrics.memory?.used),
          memoryTotalGb: toGigabytes(data.metrics.memory?.total)
        };
      }

      if (section === 'array' && data.array) {
        const kb = data.array.capacity?.kilobytes || {};
        const total = Number(kb.total) || 0;
        const used = Number(kb.used) || 0;

        result.array = {
          state: data.array.state || 'unbekannt',
          usedGb: toGigabytes(used),
          totalGb: toGigabytes(total),
          percent: total > 0 ? (used / total) * 100 : null,
          parity: data.array.parityCheckStatus
            ? {
              status: data.array.parityCheckStatus.status,
              progress: data.array.parityCheckStatus.progress,
              errors: data.array.parityCheckStatus.errors
            }
            : null,
          disks: (data.array.disks || [])
            .slice(0, config.maxDisks || 8)
            .map(disk => ({
              name: disk.name,
              // Unraid liefert die Temperatur je nach Fassung als Zahl oder
              // als Zeichenkette, bei schlafenden Platten gar nicht und
              // gelegentlich als "*". Wichtig: null und "" muessen VOR
              // Number() abgefangen werden - Number(null) ist 0, und eine
              // schlafende Platte saehe dann aus, als waere sie 0 Grad kalt.
              temp: readTemperature(disk.temp),
              status: disk.status || null,
              percent: Number(disk.fsSize) > 0
                ? (Number(disk.fsUsed) / Number(disk.fsSize)) * 100
                : null
            }))
        };
      }

      if (section === 'docker' && data.docker) {
        const containers = data.docker.containers || [];
        result.docker = {
          total: containers.length,
          running: containers.filter(c => String(c.state).toLowerCase() === 'running').length
        };
      }

      if (section === 'vms' && data.vms) {
        const domains = data.vms.domains || [];
        result.vms = {
          total: domains.length,
          running: domains.filter(d => String(d.state).toLowerCase().includes('running')).length
        };
      }
    });

    return result;
  },

  /**
   * Der Verbindungstest sagt, WELCHE Abschnitte gehen - nicht nur ob
   * irgendetwas geht. Bei einem versionsabhängigen Schema ist genau das die
   * nützliche Auskunft.
   */
  async testConnection(config, request) {
    const url = endpoint(config);
    if (!url) return { ok: false, error: 'Es fehlt noch die Adresse des Servers.' };
    if (!config.apiKey) return { ok: false, error: 'Es fehlt noch der API-Schlüssel.' };

    const available = [];
    const unavailable = [];

    for (const section of Object.keys(SECTIONS)) {
      try {
        const response = await request({
          url,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey
          },
          body: { query: SECTIONS[section] },
          allowInsecureTls: config.allowInsecureTls !== false,
          conditional: false
        });

        if (response.data?.errors) {
          unavailable.push({ section, reason: response.data.errors[0]?.message });
        } else {
          available.push(section);
        }
      } catch (error) {
        // Ein Fehler beim ersten Abschnitt heisst meist: Adresse, Schlüssel
        // oder Developer Options stimmen nicht.
        if (available.length === 0 && unavailable.length === 0) {
          return { ok: false, error: error.message };
        }
        unavailable.push({ section, reason: error.message });
      }
    }

    return { ok: available.length > 0, available, unavailable };
  }
});
