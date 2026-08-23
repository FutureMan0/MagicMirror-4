const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { diff, isEmpty, decide, keyOf, changedKeys } =
  require(path.join(ROOT, 'src/renderer/reconciler.js'));

const clone = (value) => JSON.parse(JSON.stringify(value));

const BASE = {
  theme: 'minimal',
  language: 'de',
  gridSettings: { columns: 3, rows: 3 },
  modules: [
    { id: 'uhr', module: 'clock', enabled: true, config: { showDate: true }, position: { column: 1, row: 1 } },
    { id: 'wetter', module: 'weather', enabled: true, config: { city: 'Wien' }, position: { column: 2, row: 1 } }
  ]
};

test('ohne Änderung gibt es nichts zu tun', () => {
  const result = diff(BASE, clone(BASE));

  assert.equal(isEmpty(result), true);
  assert.equal(result.unchanged.length, 2);
});

// Der Kern der Sache: wer eine Einstellung der Uhr verstellt, soll nicht
// auslösen, dass das Wetter neu geladen wird.
test('eine Änderung betrifft nur ihr Modul', () => {
  const next = clone(BASE);
  next.modules[0].config.showDate = false;

  const result = diff(BASE, next);

  assert.equal(result.patched.length, 1);
  assert.equal(result.patched[0].key, 'uhr');
  assert.deepEqual(result.patched[0].changed, ['showDate']);
  assert.deepEqual(result.unchanged.map(u => u.key), ['wetter']);
});

test('ein Themewechsel fasst kein Modul an', () => {
  const result = diff(BASE, { ...clone(BASE), theme: 'cyberpunk' });

  assert.equal(result.theme, true);
  assert.equal(result.patched.length, 0);
  assert.equal(result.rebuilt.length, 0);
  assert.equal(result.unchanged.length, 2);
});

test('geänderte Rastereinstellungen fassen kein Modul an', () => {
  const next = clone(BASE);
  next.gridSettings.columns = 4;

  const result = diff(BASE, next);

  assert.equal(result.grid, true);
  assert.equal(result.patched.length, 0);
});

test('ein verschobenes Modul wird nur umplatziert', () => {
  const next = clone(BASE);
  next.modules[0].position.column = 3;

  const result = diff(BASE, next);

  assert.deepEqual(result.moved.map(m => m.key), ['uhr']);
  assert.equal(result.patched.length, 0, 'Verschieben ist keine Konfigurationsänderung');
});

test('hinzugefügte und entfernte Module werden erkannt', () => {
  const next = clone(BASE);
  next.modules.push({ id: 'neu', module: 'github', enabled: true, config: {} });
  next.modules.splice(1, 1);

  const result = diff(BASE, next);

  assert.deepEqual(result.added.map(a => a.key), ['neu']);
  assert.deepEqual(result.removed.map(r => r.key), ['wetter']);
});

// Ein abgeschaltetes Modul soll wirklich weg sein, nicht nur unsichtbar -
// sonst fragt es im Hintergrund weiter Daten ab.
test('Ein- und Ausschalten zählt wie Hinzufügen und Entfernen', () => {
  const off = clone(BASE);
  off.modules[1].enabled = false;

  const result = diff(BASE, off);
  assert.deepEqual(result.removed.map(r => r.key), ['wetter']);

  const backOn = diff(off, BASE);
  assert.deepEqual(backOn.added.map(a => a.key), ['wetter']);
});

test('ein abgeschaltetes Modul taucht nirgends auf', () => {
  const off = clone(BASE);
  off.modules[1].enabled = false;

  const result = diff(off, clone(off));

  assert.equal(isEmpty(result), true);
  assert.deepEqual(result.unchanged.map(u => u.key), ['uhr']);
});

// Ohne feste Kennung saehe ein Umsortieren wie "alle ausgetauscht" aus.
test('Umsortieren allein ändert nichts', () => {
  const next = clone(BASE);
  next.modules.reverse();

  const result = diff(BASE, next);

  assert.equal(isEmpty(result), true, 'Umsortieren hat einen Neuaufbau ausgelöst');
  assert.equal(result.unchanged.length, 2);
});

test('ohne Kennung wird über Modulname und Position verglichen', () => {
  const withoutIds = {
    modules: [
      { module: 'clock', enabled: true, config: {} },
      { module: 'weather', enabled: true, config: {} }
    ]
  };

  assert.equal(keyOf(withoutIds.modules[0], 0), 'clock#0');
  assert.equal(isEmpty(diff(withoutIds, clone(withoutIds))), true);
});

test('ein Sprachwechsel wird gesondert gemeldet', () => {
  const result = diff(BASE, { ...clone(BASE), language: 'en' });
  assert.equal(result.language, true);
});

test('changedKeys nennt genau die geänderten Schlüssel', () => {
  assert.deepEqual(changedKeys({ a: 1, b: 2 }, { a: 1, b: 3 }), ['b']);
  assert.deepEqual(changedKeys({ a: 1 }, { a: 1, b: 2 }), ['b']);
  assert.deepEqual(changedKeys({ a: { x: 1 } }, { a: { x: 1 } }), []);
});

// Ob eine Aenderung ohne Neuaufbau auskommt, weiss nur das Modul selbst.
test('das Modul entscheidet über Patchen oder Neuaufbau', () => {
  const patchable = { onConfigChange: (cfg, changed) => changed.every(k => k === 'showDate') ? 'patch' : 'rebuild' };

  assert.equal(decide(patchable, {}, ['showDate']), 'patch');
  assert.equal(decide(patchable, {}, ['apiKey']), 'rebuild');
});

test('ohne onConfigChange wird sicherheitshalber neu aufgebaut', () => {
  assert.equal(decide({}, {}, ['x']), 'rebuild');
  assert.equal(decide(null, {}, ['x']), 'rebuild');
});

test('ein Fehler in onConfigChange führt zum Neuaufbau, nicht zum Absturz', () => {
  const broken = { onConfigChange: () => { throw new Error('kaputt'); } };
  assert.equal(decide(broken, {}, ['x']), 'rebuild');
});

test('der Hauptprozess vergibt feste Kennungen', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(ROOT, 'src/main/configManager.js'), 'utf8');

  assert.match(
    source, /if \(!mod\.id\) mod\.id = crypto\.randomUUID\(\)/,
    'ohne feste Kennung sieht ein Umsortieren wie ein Komplettaustausch aus'
  );
});
