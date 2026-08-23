const path = require('node:path');
const https = require('node:https');
const { createPoller } = require('./poller');

/**
 * Baut aus einer Handvoll Angaben ein vollständiges Modul-Backend.
 *
 * Jedes der geplanten Module macht dasselbe: Zugangsdaten aus der
 * Konfiguration lesen, eine fremde Schnittstelle abfragen, das Ergebnis in
 * eine anzeigbare Form bringen, es ausliefern. Ohne gemeinsame Grundlage
 * schreibt jedes davon seine eigene Fassung - und jede hat andere Lücken.
 *
 *   module.exports = defineHttpModule({
 *     name: 'github',
 *     defaults: { updateInterval: 300000 },
 *     buildRequests: (config) => [...],
 *     transform: (responses, config) => ({ ... })
 *   });
 *
 * Daraus entstehen:
 *
 *   GET  /api/<name>/data          der zuletzt bekannte Stand
 *   POST /api/<name>/refresh       sofort neu holen
 *   POST /api/<name>/test          Verbindungstest für den Einrichtungsdialog
 *   POST /api/<name>/action/:id    optionale Aktionen (schalten, steuern)
 *
 * Geheimnisse werden serverseitig gelesen und verlassen den Pi nicht.
 */

/** Wirft einen Fehler, der die Wartezeit der Gegenstelle mitführt. */
function httpError(response, body) {
  const error = new Error(`HTTP ${response.status}${body ? `: ${String(body).slice(0, 200)}` : ''}`);
  error.code = response.status;

  // 429 und 403 mit Rate-Limit-Kopf: die Gegenstelle sagt, wann sie wieder
  // mag. Sich daran zu halten ist billiger als gesperrt zu werden.
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    error.retryAfterMs = Number.isFinite(seconds)
      ? seconds * 1000
      : Math.max(0, new Date(retryAfter).getTime() - Date.now());
  }

  const reset = response.headers.get('x-ratelimit-reset');
  if (!error.retryAfterMs && reset && Number(reset) > 0) {
    error.retryAfterMs = Math.max(0, Number(reset) * 1000 - Date.now());
  }

  return error;
}

/**
 * Anfrage über node:https, wenn das Zertifikat nicht geprüft werden soll.
 *
 * Selbst gehostete Dienste - Gitea, Unraid, Home Assistant - laufen im
 * Heimnetz fast immer mit einem selbstsignierten Zertifikat. Das globale
 * NODE_TLS_REJECT_UNAUTHORIZED wäre der falsche Hebel: es schaltet die Prüfung
 * für ALLE Verbindungen ab, auch für die zu Spotify und GitHub. Deshalb hier
 * ein eigener Weg, der nur für diese eine Anfrage gilt.
 */
function insecureRequest(request) {
  return new Promise((resolve, reject) => {
    const url = new URL(request.url);

    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: request.method || 'GET',
      headers: request.headers || {},
      rejectUnauthorized: false,
      timeout: request.timeoutMs || 15000
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');

        if (res.statusCode === 304) return resolve({ notModified: true });

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`);
          error.code = res.statusCode;
          return reject(error);
        }

        try {
          resolve({
            data: JSON.parse(body),
            meta: { etag: res.headers.etag || null, lastModified: res.headers['last-modified'] || null }
          });
        } catch (error) {
          reject(new Error(`Antwort ist kein gültiges JSON: ${error.message}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const error = new Error(`Zeitüberschreitung nach ${request.timeoutMs || 15000} ms`);
      error.code = 'ETIMEDOUT';
      reject(error);
    });

    req.on('error', reject);

    if (request.body) req.write(JSON.stringify(request.body));
    req.end();
  });
}

/**
 * Führt eine Anfrage aus. `request` ist absichtlich schlicht gehalten -
 * { url, method, headers, body, json } - damit ein Modul nichts über fetch
 * wissen muss.
 */
async function performRequest(request, { etag, lastModified } = {}) {
  const headers = { ...(request.headers || {}) };

  // Bedingte Anfrage: eine 304-Antwort kostet bei GitHub kein Kontingent.
  if (request.conditional !== false) {
    if (etag) headers['If-None-Match'] = etag;
    if (lastModified) headers['If-Modified-Since'] = lastModified;
  }

  // Selbstsigniertes Zertifikat: eigener Weg, der die Prüfung nur für diese
  // Anfrage aussetzt.
  if (request.allowInsecureTls && request.url.startsWith('https:')) {
    return insecureRequest({ ...request, headers });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs || 15000);

  try {
    const response = await fetch(request.url, {
      method: request.method || 'GET',
      headers: request.body ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: request.body ? JSON.stringify(request.body) : undefined,
      signal: controller.signal
    });

    if (response.status === 304) {
      return { notModified: true };
    }

    if (!response.ok) {
      throw httpError(response, await response.text().catch(() => ''));
    }

    return {
      data: await response.json(),
      meta: {
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified')
      }
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`Zeitüberschreitung nach ${request.timeoutMs || 15000} ms`);
      timeoutError.code = 'ETIMEDOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function defineHttpModule({
  name,
  defaults = {},
  buildRequests,
  transform = (responses) => responses,
  actions = {},
  testConnection = null
}) {
  if (!name) throw new Error('defineHttpModule: name fehlt');
  if (typeof buildRequests !== 'function') throw new Error('defineHttpModule: buildRequests fehlt');

  return {
    name,

    // Fuer Tests: die reinen Funktionen ohne Server und ohne Netz. Genau die
    // Stellen, an denen ein Modul eigene Logik hat.
    _definition: { defaults, buildRequests, transform, actions, testConnection },

    registerRoutes(app, context) {
      const { instanceName, ConfigManager, bus, onShutdown } = context;

      /** Die aktuelle Konfiguration - inklusive der Geheimnisse aus der .env. */
      function readConfig(instance = instanceName) {
        const manager = new ConfigManager(instance);
        const config = manager.loadConfig();
        const entry = (config.modules || []).find(m => m.module === name);
        return { ...defaults, ...(entry?.config || {}) };
      }

      const poller = createPoller({
        key: name,
        intervalMs: readConfig().updateInterval || defaults.updateInterval || 300000,
        minIntervalMs: defaults.minInterval || 30000,
        cacheDir: path.join(__dirname, '../../../config/cache'),
        bus,
        fetcher: async (meta) => {
          const config = readConfig();
          const requests = await buildRequests(config);

          if (!requests || requests.length === 0) {
            const error = new Error(`${name} ist nicht vollständig konfiguriert.`);
            error.code = 'NOT_CONFIGURED';
            throw error;
          }

          const responses = await Promise.all(
            requests.map(request => performRequest(request, meta))
          );

          // Nur wenn ALLE Teilantworten unverändert sind, gilt das Ganze als
          // unverändert - sonst würde eine geänderte Teilantwort verschluckt.
          if (responses.every(response => response.notModified)) {
            return { notModified: true };
          }

          return {
            data: await transform(responses.map(r => r.data), config),
            meta: responses.find(r => r.meta)?.meta
          };
        }
      });

      // Erst starten, wenn das Modul überhaupt aktiv ist - sonst fragt ein
      // abgeschaltetes Modul munter weiter nach draussen.
      const entryEnabled = () => {
        const manager = new ConfigManager(instanceName);
        const config = manager.loadConfig();
        const entry = (config.modules || []).find(m => m.module === name);
        return entry && entry.enabled !== false;
      };

      if (entryEnabled()) {
        poller.start().catch(error => {
          console.error(`${name}: Erstabruf fehlgeschlagen -`, error.message);
        });
      } else {
        console.log(`${name}: nicht aktiviert - kein Abruf.`);
      }

      if (typeof onShutdown === 'function') onShutdown(() => poller.stop());

      // Nach einer Konfigurationsänderung sofort neu holen - sonst zeigt der
      // Spiegel bis zum nächsten Takt noch den alten Stand.
      if (bus) {
        bus.on('config:changed', () => {
          if (entryEnabled()) poller.refresh().catch(() => {});
          else poller.stop();
        });
      }

      app.get(`/api/${name}/data`, (req, res) => {
        res.json(poller.get());
      });

      app.post(`/api/${name}/refresh`, async (req, res) => {
        res.json(await poller.refresh());
      });

      app.post(`/api/${name}/test`, async (req, res) => {
        try {
          const config = { ...readConfig(), ...(req.body || {}) };

          if (testConnection) {
            res.json(await testConnection(config, performRequest));
            return;
          }

          const requests = await buildRequests(config);
          if (!requests || requests.length === 0) {
            res.status(400).json({ ok: false, error: 'Nicht vollständig konfiguriert.' });
            return;
          }

          await performRequest({ ...requests[0], conditional: false });
          res.json({ ok: true });
        } catch (error) {
          res.status(200).json({ ok: false, error: error.message, code: error.code || null });
        }
      });

      for (const [actionId, handler] of Object.entries(actions)) {
        app.post(`/api/${name}/action/${actionId}`, async (req, res) => {
          try {
            const result = await handler(req.body || {}, {
              config: readConfig(),
              request: performRequest,
              refresh: () => poller.refresh()
            });
            res.json({ ok: true, result: result ?? null });
          } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
          }
        });
      }
    }
  };
}

module.exports = { defineHttpModule, performRequest, httpError };
