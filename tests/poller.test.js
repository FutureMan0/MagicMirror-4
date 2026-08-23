const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { createPoller } = require(path.join(ROOT, 'src/main/integrations/poller.js'));

const quiet = { warn() {} };

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mm4-poller-'));
}

test('holt beim Start und liefert einen Umschlag', async () => {
  const poller = createPoller({
    key: 'demo',
    intervalMs: 60000,
    fetcher: async () => ({ value: 42 }),
    log: quiet
  });

  const result = await poller.start();
  poller.stop();

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { value: 42 });
  assert.equal(result.stale, false);
  assert.equal(result.error, null);
});

// Spiegel, Live-Ansicht und Konfigurationsseite fragen dieselben Daten ab.
// Ohne Bündelung wären das drei Anfragen nach draussen statt einer.
test('gleichzeitige Abfragen werden zu einer gebündelt', async () => {
  let calls = 0;

  const poller = createPoller({
    key: 'demo',
    intervalMs: 60000,
    fetcher: async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 30));
      return { value: calls };
    },
    log: quiet
  });

  const [a, b, c] = await Promise.all([poller.refresh(), poller.refresh(), poller.refresh()]);
  poller.stop();

  assert.equal(calls, 1, `${calls} Anfragen statt einer`);
  assert.deepEqual(a.data, b.data);
  assert.deepEqual(b.data, c.data);
});

test('ein Fehler behält die alten Daten und meldet sich', async () => {
  let shouldFail = false;

  const poller = createPoller({
    key: 'demo',
    intervalMs: 60000,
    fetcher: async () => {
      if (shouldFail) throw new Error('Netz weg');
      return { value: 'gut' };
    },
    log: quiet
  });

  await poller.start();
  shouldFail = true;
  const result = await poller.refresh();
  poller.stop();

  assert.equal(result.ok, false);
  assert.equal(result.error.message, 'Netz weg');
  // Entscheidend: die alten Daten sind noch da. Ein leerer Spiegel wäre
  // schlechter als leicht veraltete Werte.
  assert.deepEqual(result.data, { value: 'gut' });
  assert.ok(result.nextRetryAt > Date.now());
});

test('wiederholte Fehler vergrössern den Abstand', async () => {
  const poller = createPoller({
    key: 'demo',
    intervalMs: 1000,
    fetcher: async () => { throw new Error('kaputt'); },
    log: quiet
  });

  await poller.start();
  const firstWait = poller.get().nextRetryAt - Date.now();

  await poller.refresh();
  await poller.refresh();
  const laterWait = poller.get().nextRetryAt - Date.now();
  poller.stop();

  assert.ok(
    laterWait > firstWait * 2,
    `Abstand wächst nicht: ${firstWait} -> ${laterWait}`
  );
});

test('Retry-After der Gegenstelle wird beachtet', async () => {
  const poller = createPoller({
    key: 'demo',
    intervalMs: 1000,
    fetcher: async () => {
      const error = new Error('zu viele Anfragen');
      error.retryAfterMs = 120000;
      throw error;
    },
    log: quiet
  });

  await poller.start();
  const wait = poller.get().nextRetryAt - Date.now();
  poller.stop();

  assert.ok(wait > 100000, `wartet nur ${wait} ms statt der geforderten 120 s`);
});

// Eine 304-Antwort von GitHub kostet kein Rate-Limit.
test('notModified behält die Daten und aktualisiert nur den Zeitstempel', async () => {
  let first = true;

  const poller = createPoller({
    key: 'demo',
    intervalMs: 60000,
    fetcher: async ({ etag }) => {
      if (first) {
        first = false;
        return { data: { value: 1 }, meta: { etag: 'abc' } };
      }
      assert.equal(etag, 'abc', 'der ETag wird nicht mitgeschickt');
      return { notModified: true };
    },
    log: quiet
  });

  await poller.start();
  const before = poller.get().fetchedAt;
  await new Promise(resolve => setTimeout(resolve, 5));
  const after = await poller.refresh();
  poller.stop();

  assert.equal(after.ok, true);
  assert.deepEqual(after.data, { value: 1 });
  assert.ok(after.fetchedAt > before, 'der Zeitstempel wurde nicht aufgefrischt');
});

// Nach pm2 restart - also bei jedem Update - stünde der Spiegel sonst
// minutenlang leer.
test('Daten überleben einen Neustart', async () => {
  const dir = tempDir();

  const first = createPoller({
    key: 'demo',
    intervalMs: 60000,
    cacheDir: dir,
    fetcher: async () => ({ value: 'gemerkt' }),
    log: quiet
  });
  await first.start();
  first.stop();

  const second = createPoller({
    key: 'demo',
    intervalMs: 60000,
    cacheDir: dir,
    fetcher: async () => { throw new Error('Netz noch nicht da'); },
    log: quiet
  });

  const result = await second.start();
  second.stop();

  assert.deepEqual(result.data, { value: 'gemerkt' }, 'die Daten sind verloren gegangen');
  assert.equal(result.ok, false, 'der Fehler muss trotzdem sichtbar sein');
});

test('ein unlesbarer Zwischenspeicher wird ignoriert statt zu werfen', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'demo.json'), '{kaputt');

  const poller = createPoller({
    key: 'demo',
    intervalMs: 60000,
    cacheDir: dir,
    fetcher: async () => ({ value: 'frisch' }),
    log: quiet
  });

  const result = await poller.start();
  poller.stop();
  assert.deepEqual(result.data, { value: 'frisch' });
});

test('meldet jedes Ergebnis auf dem Bus', async () => {
  const seen = [];
  const bus = { emit: (topic, payload) => seen.push({ topic, payload }) };

  const poller = createPoller({
    key: 'wetter',
    intervalMs: 60000,
    bus,
    fetcher: async () => ({ temperatur: 21 }),
    log: quiet
  });

  await poller.start();
  poller.stop();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].topic, 'data:wetter');
  assert.deepEqual(seen[0].payload.data, { temperatur: 21 });
});

test('alte Daten werden als veraltet gekennzeichnet', async () => {
  const poller = createPoller({
    key: 'demo',
    intervalMs: 1000,
    staleAfterMs: 20,
    fetcher: async () => ({ value: 1 }),
    log: quiet
  });

  await poller.start();
  assert.equal(poller.get().stale, false);

  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(poller.get().stale, true, 'ohne Kennzeichnung wirken alte Werte aktuell');

  poller.stop();
});

test('stop() beendet den Takt', async () => {
  let calls = 0;
  const poller = createPoller({
    key: 'demo',
    intervalMs: 30,
    minIntervalMs: 10,
    fetcher: async () => { calls += 1; return { value: calls }; },
    log: quiet
  });

  await poller.start();
  poller.stop();
  const afterStop = calls;

  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(calls, afterStop, 'es wird nach stop() weiter abgefragt');
});
