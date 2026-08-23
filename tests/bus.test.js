const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { Bus } = require(path.join(ROOT, 'src/shared/bus.js'));

test('stellt an exakte Themen zu', () => {
  const bus = new Bus();
  const seen = [];
  bus.on('presence:changed', payload => seen.push(payload));

  bus.emit('presence:changed', { present: true });
  bus.emit('presence:display', { on: false });

  assert.deepEqual(seen, [{ present: true }]);
});

test('Platzhalter greifen auf Präfix und auf alles', () => {
  const bus = new Bus();
  const prefix = [];
  const all = [];

  bus.on('presence:*', (_payload, topic) => prefix.push(topic));
  bus.on('*', (_payload, topic) => all.push(topic));

  bus.emit('presence:changed', {});
  bus.emit('presence:display', {});
  bus.emit('weather:conditions', {});

  assert.deepEqual(prefix, ['presence:changed', 'presence:display']);
  assert.deepEqual(all, ['presence:changed', 'presence:display', 'weather:conditions']);
});

test('ein Präfix greift nicht auf ein gleichnamiges Thema ohne Doppelpunkt', () => {
  const bus = new Bus();
  const seen = [];
  bus.on('presence:*', (_p, topic) => seen.push(topic));

  bus.emit('presenceXchanged', {});
  assert.deepEqual(seen, []);
});

test('Abmelden funktioniert, auch aus dem Zuhörer heraus', () => {
  const bus = new Bus();
  const seen = [];

  const off = bus.on('x', () => {
    seen.push('einmal');
    off();
  });

  bus.emit('x');
  bus.emit('x');
  assert.deepEqual(seen, ['einmal']);
});

test('once() hört genau einmal zu', () => {
  const bus = new Bus();
  let count = 0;
  bus.once('x', () => { count += 1; });

  bus.emit('x');
  bus.emit('x');
  assert.equal(count, 1);
});

// Ein fehlerhaftes Modul darf die übrigen nicht mitreißen.
test('ein werfender Zuhörer stoppt die Zustellung nicht', () => {
  const errors = [];
  const bus = new Bus({ onError: (error) => errors.push(error.message) });
  const seen = [];

  bus.on('x', () => { throw new Error('kaputt'); });
  bus.on('x', () => seen.push('überlebt'));

  bus.emit('x');

  assert.deepEqual(seen, ['überlebt']);
  assert.deepEqual(errors, ['kaputt']);
});

// Der Bus läuft im Hauptprozess und im Renderer aus derselben Datei.
test('die Bus-Datei funktioniert in beiden Welten', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/shared/bus.js'), 'utf8');
  assert.match(source, /window\.MMBusModule/, 'im Browser nicht erreichbar');
  assert.match(source, /module\.exports/, 'in Node nicht erreichbar');
});

// Der eigentliche Zweck der Umstellung.
test('der Präsenzsensor sendet, statt dass das Frontend pollt', () => {
  const backend = fs.readFileSync(path.join(ROOT, 'modules/mmwave-presence/backend.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(ROOT, 'modules/mmwave-presence/index.js'), 'utf8');

  assert.match(backend, /publish\('presence:changed'/, 'das Backend meldet Wechsel nicht');
  assert.match(backend, /publish\('presence:display'/, 'das Backend meldet den Displayzustand nicht');
  assert.doesNotMatch(
    backend, /BrowserWindow\.getAllWindows\(\)/,
    'das Modul greift wieder direkt auf Fenster zu, statt den Bus zu benutzen'
  );

  assert.match(frontend, /mmBus\.on\('presence:changed'/, 'das Frontend abonniert nicht');
  assert.doesNotMatch(
    frontend, /setInterval\([^)]*,\s*(2000|5000)\)/,
    'das Frontend pollt wieder im Sekundentakt'
  );
});

test('der Bus wird an die Modul-Backends durchgereicht', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src/main/main.js'), 'utf8');
  assert.match(
    main, /registerBackendRoutes\(expressApp,\s*\{[^}]*bus[^}]*\}\)/,
    'ohne bus im Kontext kann ein Backend nichts melden'
  );
});
