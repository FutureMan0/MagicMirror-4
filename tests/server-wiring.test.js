const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(ROOT, 'src/main/main.js'), 'utf8');

// Der Express-Server steckt noch in main.js und ist damit an Electron
// gebunden - er lässt sich in einem reinen Node-Test nicht starten. Die
// Entscheidungslogik ist in tests/auth.test.js abgedeckt; hier wird die
// Verdrahtung geprüft, denn genau dort würde eine gelöschte Zeile den Server
// still wieder öffnen, ohne dass ein Test rot wird.
//
// Sobald der Server in Phase 5 aus main.js herausgelöst ist, ersetzen echte
// HTTP-Tests diese Datei.

test('alles unter /api liegt hinter der Anmeldung', () => {
  assert.match(
    mainSource,
    /expressApp\.use\('\/api',\s*auth\.middleware\(/,
    'Die Auth-Middleware ist nicht mehr auf /api gemountet'
  );
});

test('die Anmelderouten sind vor der Middleware registriert', () => {
  const authRoute = mainSource.indexOf("'/api/auth/status'");
  const middleware = mainSource.indexOf("expressApp.use('/api', auth.middleware");

  assert.ok(authRoute > -1, '/api/auth/status fehlt');
  assert.ok(middleware > -1, 'Auth-Middleware fehlt');
  assert.ok(
    authRoute < middleware,
    'Die Anmelderouten müssen vor der Middleware stehen, sonst sperrt man sich aus'
  );
});

test('GET /api/config liefert nur maskierte Geheimnisse', () => {
  const handler = mainSource.slice(
    mainSource.indexOf("expressApp.get('/api/config'"),
    mainSource.indexOf("expressApp.put('/api/config'")
  );

  assert.ok(handler.length > 0, 'GET /api/config nicht gefunden');
  assert.match(
    handler,
    /loadConfig\(\{\s*redact:\s*true\s*\}\)/,
    'GET /api/config lädt die Config ohne redact - Passwörter gehen wieder über das Netz'
  );
});

test('PUT /api/config schickt dem Spiegel die geladene Config, nicht den Request-Body', () => {
  const handler = mainSource.slice(
    mainSource.indexOf("expressApp.put('/api/config'"),
    mainSource.indexOf("expressApp.get('/api/modules'")
  );

  assert.ok(handler.length > 0, 'PUT /api/config nicht gefunden');
  assert.match(
    handler,
    /send\('config-update',\s*savedConfig\)/,
    'Der Body enthält für unveränderte Geheimnisse nur den Platzhalter - der Spiegel bekäme "__SET__" statt des echten Werts'
  );
});

test('kein exec() mit Shell-String mehr im Hauptprozess', () => {
  assert.doesNotMatch(
    mainSource,
    /\bexec\s*\(/,
    'exec() ist zurück - Update-Endpunkte müssen execFile mit Argument-Array benutzen'
  );
});

test('trust proxy bleibt aus, sonst lässt sich Loopback vortäuschen', () => {
  assert.match(mainSource, /disable\('trust proxy'\)/);
});

test('der Updater benutzt ausschliesslich execFile', () => {
  const updaterSource = fs.readFileSync(path.join(ROOT, 'src/main/updater.js'), 'utf8');

  assert.doesNotMatch(updaterSource, /\bexec\s*\(/, 'exec() im Updater gefunden');
  assert.match(updaterSource, /execFile\(/);
  // npm install schreibt das Lockfile bei jeder Gelegenheit um - genau
  // dadurch war es kaputt.
  assert.match(updaterSource, /'ci',\s*'--omit=dev'/);
  assert.doesNotMatch(updaterSource, /'install'/, 'npm install statt npm ci');
});
