const fs = require('node:fs');
const path = require('node:path');

/**
 * Regelmäßiges Abfragen einer fremden Schnittstelle.
 *
 * Jedes der geplanten Module - GitHub, Gitea, Unraid, Home Assistant - braucht
 * dasselbe: in Abständen etwas holen, das Ergebnis behalten, bei einem Fehler
 * nicht aufgeben aber auch nicht hämmern, und dem Spiegel etwas anzeigbares
 * geben, auch wenn gerade nichts geht.
 *
 * Vier Dinge, die einzeln nachgebaut regelmäßig schiefgehen:
 *
 *  - **Plattenspeicher.** Nach einem Neustart - etwa durch `pm2 restart` beim
 *    Update - stünde der Spiegel sonst minutenlang leer, obwohl die Daten von
 *    vor zwei Minuten völlig ausreichen.
 *  - **Backoff.** Ein starrer Abstand schreibt bei einem dauerhaft nicht
 *    erreichbaren Dienst dieselbe Fehlermeldung im Minutentakt in die Logs.
 *  - **Ein Aufruf für alle.** Spiegel, Live-Ansicht am Handy und
 *    Konfigurationsseite fragen dieselben Daten ab. Ohne Bündelung sind das
 *    drei Anfragen nach draußen statt einer.
 *  - **Bedingte Anfragen.** Eine 304-Antwort von GitHub kostet kein
 *    Rate-Limit. Ohne ETag ist das Kontingent bei drei Repositories schnell
 *    aufgebraucht.
 */

const MAX_BACKOFF_MS = 30 * 60 * 1000;

function jitter(ms) {
  // ±20 %, damit mehrere Module nicht im Gleichschritt anklopfen.
  return Math.round(ms * (0.8 + Math.random() * 0.4));
}

function createPoller({
  key,
  fetcher,
  intervalMs = 300000,
  minIntervalMs = 30000,
  staleAfterMs = null,
  cacheDir = null,
  bus = null,
  log = console
}) {
  if (!key) throw new Error('poller: key fehlt');
  if (typeof fetcher !== 'function') throw new Error('poller: fetcher fehlt');

  const interval = Math.max(intervalMs, minIntervalMs);
  const staleAfter = staleAfterMs || interval * 3;
  const cacheFile = cacheDir ? path.join(cacheDir, `${key}.json`) : null;

  let state = {
    ok: false,
    data: null,
    fetchedAt: null,
    stale: true,
    error: null,
    nextRetryAt: null
  };

  let meta = { etag: null, lastModified: null };
  let timer = null;
  let inflight = null;
  let failures = 0;
  let stopped = false;

  // --- Plattenspeicher -----------------------------------------------------

  function loadFromDisk() {
    if (!cacheFile || !fs.existsSync(cacheFile)) return;

    try {
      const stored = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (!stored || typeof stored !== 'object') return;

      state = {
        ok: true,
        data: stored.data,
        fetchedAt: stored.fetchedAt,
        // Beim Laden immer als veraltet markieren: die Daten sind aus einem
        // früheren Lauf, und wie alt sie sind, entscheidet gleich isStale().
        stale: true,
        error: null,
        nextRetryAt: null
      };
      meta = stored.meta || meta;
    } catch (error) {
      log.warn?.(`poller[${key}]: Zwischenspeicher unlesbar - ${error.message}`);
    }
  }

  function saveToDisk() {
    if (!cacheFile || !state.ok) return;

    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const tmp = `${cacheFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({
        data: state.data,
        fetchedAt: state.fetchedAt,
        meta
      }));
      // Atomar ersetzen - ein Stromausfall darf keine halbe Datei hinterlassen.
      fs.renameSync(tmp, cacheFile);
    } catch (error) {
      log.warn?.(`poller[${key}]: Zwischenspeicher nicht schreibbar - ${error.message}`);
    }
  }

  // --- Zustand -------------------------------------------------------------

  function isStale() {
    if (!state.fetchedAt) return true;
    return Date.now() - state.fetchedAt > staleAfter;
  }

  function envelope() {
    return { ...state, stale: isStale(), key };
  }

  function publish() {
    if (bus) bus.emit(`data:${key}`, envelope());
  }

  // --- Abfragen ------------------------------------------------------------

  async function runFetch() {
    // Ein Aufruf für alle: läuft schon eine Abfrage, wird deren Ergebnis
    // geteilt statt eine zweite loszuschicken.
    if (inflight) return inflight;

    inflight = (async () => {
      try {
        const result = await fetcher({ etag: meta.etag, lastModified: meta.lastModified });

        // Unverändert: die Gegenstelle sagt, dass sich nichts getan hat.
        if (result && result.notModified) {
          state = { ...state, ok: true, error: null, fetchedAt: Date.now(), nextRetryAt: null };
          failures = 0;
          saveToDisk();
          publish();
          return envelope();
        }

        state = {
          ok: true,
          data: result && 'data' in result ? result.data : result,
          fetchedAt: Date.now(),
          stale: false,
          error: null,
          nextRetryAt: null
        };

        if (result && result.meta) meta = { ...meta, ...result.meta };

        failures = 0;
        saveToDisk();
        publish();
        return envelope();
      } catch (error) {
        failures += 1;

        // Sagt die Gegenstelle, wann sie wieder mag, halten wir uns daran.
        const retryAfterMs = error.retryAfterMs
          || Math.min(interval * 2 ** (failures - 1), MAX_BACKOFF_MS);

        state = {
          ...state,
          ok: false,
          error: { message: error.message, code: error.code || null },
          nextRetryAt: Date.now() + retryAfterMs
        };

        // Nur die ersten Fehler einzeln melden - der Rest ist Rauschen.
        if (failures <= 3) {
          log.warn?.(`poller[${key}]: ${error.message}`);
        } else if (failures === 4) {
          log.warn?.(`poller[${key}]: weitere Fehler werden nicht mehr einzeln gemeldet.`);
        }

        publish();
        return envelope();
      } finally {
        inflight = null;
      }
    })();

    return inflight;
  }

  function scheduleNext() {
    if (stopped) return;

    clearTimeout(timer);
    const delay = state.nextRetryAt
      ? Math.max(state.nextRetryAt - Date.now(), minIntervalMs)
      : interval;

    timer = setTimeout(tick, jitter(delay));
    timer.unref?.();
  }

  async function tick() {
    await runFetch();
    scheduleNext();
  }

  // --- Nach außen ----------------------------------------------------------

  return {
    key,

    async start() {
      stopped = false;
      loadFromDisk();
      // Vorhandenes sofort verfügbar machen, damit der Spiegel nicht leer
      // startet - und parallel dazu frische Daten holen.
      if (state.ok) publish();
      await tick();
      return envelope();
    },

    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },

    /** Der zuletzt bekannte Stand - ohne zu warten. */
    get: () => envelope(),

    /** Sofort neu holen, etwa nach einer Konfigurationsänderung. */
    async refresh() {
      const result = await runFetch();
      scheduleNext();
      return result;
    },

    /** Nur für Tests. */
    _state: () => state,
    _failures: () => failures
  };
}

module.exports = { createPoller, MAX_BACKOFF_MS };
