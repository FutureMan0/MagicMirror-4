const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { PrivacyManager, isVisible, DEFAULT_LEVELS } =
  require(path.join(ROOT, 'src/main/privacyManager.js'));
const { normalizeManifest } = require(path.join(ROOT, 'src/shared/manifest.js'));

const quiet = { log() {}, warn() {} };

function makeManager(configExtra = {}) {
  const events = [];
  const bus = { emit: (topic, payload) => events.push({ topic, payload }) };

  const manager = new PrivacyManager({
    bus,
    getConfig: () => ({ privacy: { default: 'normal', ...configExtra } }),
    log: quiet
  });

  return { manager, events };
}

// Fail-safe: ein neues Modul ist privat, bis jemand es ausdruecklich
// freigibt. Andersherum waere ein vergessenes Feld ein Datenleck.
test('ein Modul ohne Angabe gilt als heikel', () => {
  assert.equal(normalizeManifest({ name: 'x' }, 'x').privacyLevel, 'sensitive');
  assert.equal(normalizeManifest({ name: 'x', privacyLevel: 'quatsch' }, 'x').privacyLevel, 'sensitive');
  assert.equal(normalizeManifest({ name: 'x', privacyLevel: 'public' }, 'x').privacyLevel, 'public');
});

test('die Sichtbarkeitsregeln stimmen je Zustand', () => {
  assert.equal(isVisible('sensitive', DEFAULT_LEVELS.normal), true);
  assert.equal(isVisible('sensitive', DEFAULT_LEVELS.guest), false);
  assert.equal(isVisible('personal', DEFAULT_LEVELS.guest), false);
  assert.equal(isVisible('public', DEFAULT_LEVELS.guest), true);
  assert.equal(isVisible('public', DEFAULT_LEVELS.off), false);

  // Ohne Angabe wie "sensitive" behandeln.
  assert.equal(isVisible(undefined, DEFAULT_LEVELS.guest), false);
});

test('ein Wechsel meldet sich auf dem Bus', async () => {
  const { manager, events } = makeManager();

  await manager.setMode('guest');

  assert.equal(manager.mode, 'guest');
  assert.equal(events.length, 1);
  assert.equal(events[0].topic, 'privacy:changed');
  assert.deepEqual(events[0].payload.visibleLevels, ['public']);
});

test('ein unbekannter Zustand wird abgelehnt', async () => {
  const { manager } = makeManager();
  await assert.rejects(() => manager.setMode('irgendwas'), /Unbekannter Zustand/);
});

// Der Gaestemodus soll sich nicht festsetzen: wer ihn abends einschaltet,
// will ihn morgens nicht noch vorfinden.
test('der Gästemodus endet von selbst', async () => {
  const { manager } = makeManager({ guest: { autoRevertMinutes: 30 } });

  await manager.setMode('guest');
  const state = manager.state();

  assert.ok(state.expiresAt > Date.now());
  assert.ok(state.expiresAt <= Date.now() + 30 * 60000 + 100);

  manager.stop();
});

test('der Normalzustand bekommt keine Ablauffrist', async () => {
  const { manager } = makeManager();
  await manager.setMode('guest');
  await manager.setMode('normal');

  assert.equal(manager.state().expiresAt, null);
  manager.stop();
});

// Reihenfolge: erst der Sensor, dann der Bildschirm. Andersherum saehe der
// Spiegel schon privat aus, waehrend die Kamera noch laeuft.
test('der Sensor wird abgeschaltet, bevor sich am Bildschirm etwas ändert', async () => {
  const order = [];
  const { manager } = makeManager();

  manager.attachSensorControl({
    disable: async () => { order.push('sensor-aus'); },
    enable: async () => { order.push('sensor-an'); },
    status: () => ({ active: false })
  });

  manager.bus = { emit: () => order.push('bildschirm') };

  await manager.setMode('shower');

  assert.deepEqual(order, ['sensor-aus', 'bildschirm']);
  manager.stop();
});

test('zurück im Normalzustand darf der Sensor wieder an', async () => {
  const order = [];
  const { manager } = makeManager();

  manager.attachSensorControl({
    disable: async () => { order.push('aus'); },
    enable: async () => { order.push('an'); },
    status: () => ({ active: true })
  });

  await manager.setMode('guest');
  await manager.setMode('normal');

  assert.deepEqual(order, ['aus', 'an']);
  manager.stop();
});

test('die Duschzone schaltet nur bei automatischem Auslöser', async () => {
  const { manager } = makeManager({ shower: { trigger: 'manual' } });

  await manager.reportShowerZone(true);
  assert.equal(manager.mode, 'normal', 'bei manuellem Auslöser darf nichts passieren');

  manager.stop();
});

test('die Duschzone schaltet hin und zurück', async () => {
  const { manager } = makeManager({ shower: { trigger: 'auto' } });

  await manager.reportShowerZone(true);
  assert.equal(manager.mode, 'shower');

  await manager.reportShowerZone(false);
  assert.equal(manager.mode, 'normal');

  manager.stop();
});

// Wer von Hand auf "Gast" gestellt hat, will nicht, dass ein Schritt in die
// Duschzone das ueberschreibt.
test('die Duschzone übergeht einen von Hand gesetzten Zustand nicht', async () => {
  const { manager } = makeManager({ shower: { trigger: 'auto' } });

  await manager.setMode('guest');
  await manager.reportShowerZone(true);

  assert.equal(manager.mode, 'guest');
  manager.stop();
});

// --- Was tatsächlich ausgeliefert wird -----------------------------------

test('jedes Modul hat eine bewusste Privatsphäre-Stufe', () => {
  const modulesDir = path.join(ROOT, 'modules');

  for (const name of fs.readdirSync(modulesDir)) {
    const file = path.join(modulesDir, name, 'module.json');
    if (!fs.existsSync(file)) continue;

    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(
      ['public', 'personal', 'sensitive'].includes(raw.privacyLevel),
      `${name}: keine Privatsphäre-Stufe im Manifest - es gälte als "sensitive"`
    );
  }
});

test('der Stundenplan gilt als heikel, die Uhr als öffentlich', () => {
  const read = (name) => JSON.parse(
    fs.readFileSync(path.join(ROOT, 'modules', name, 'module.json'), 'utf8')
  );

  assert.equal(read('untis').privacyLevel, 'sensitive');
  assert.equal(read('clock').privacyLevel, 'public');
  assert.equal(read('clock').showInShower, true, 'im Duschmodus soll wenigstens die Uhr bleiben');
  assert.equal(read('spotify').privacyLevel, 'personal');
});

test('das Ausblenden läuft über Attribute, nicht über Neuaufbau', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/styles/privacy.css'), 'utf8');

  assert.match(css, /html\[data-privacy="guest"\][^{]*data-privacy-level="sensitive"/);
  assert.match(css, /html\[data-privacy="shower"\][^{]*data-show-in-shower/);

  const renderer = fs.readFileSync(path.join(ROOT, 'src/renderer/renderer.js'), 'utf8');
  assert.match(renderer, /dataset\.privacyLevel/, 'die Stufe landet nicht am Container');
  assert.match(renderer, /'sensitive'/, 'der Rückfallwert fehlt');
});
