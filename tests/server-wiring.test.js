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

// Express arbeitet die Handler in Registrierungsreihenfolge ab. Stuende
// registerBackendRoutes vor der Middleware, waeren /api/untis/*,
// /api/presence/* und /api/spotify/* weiterhin offen - und zwar ohne dass
// irgendetwas anderes auffaellig waere.
test('Modul-Backends und Update-Endpunkte liegen hinter der Middleware', () => {
  const middleware = mainSource.indexOf("expressApp.use('/api', auth.middleware");
  assert.ok(middleware > -1, 'Auth-Middleware fehlt');

  const mustComeAfter = {
    'Modul-Backends': 'loader.registerBackendRoutes(expressApp',
    'GET /api/config': "expressApp.get('/api/config'",
    'PUT /api/config': "expressApp.put('/api/config'",
    'GET /api/modules': "expressApp.get('/api/modules'",
    'Update-Pruefung': "expressApp.get('/api/update/check'",
    'Update-Ausfuehrung': "expressApp.post('/api/update/execute'"
  };

  for (const [label, needle] of Object.entries(mustComeAfter)) {
    const position = mainSource.indexOf(needle);
    assert.ok(position > -1, `${label} nicht gefunden (${needle})`);
    assert.ok(
      position > middleware,
      `${label} ist vor der Auth-Middleware registriert und damit ungeschuetzt`
    );
  }
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

test('der Spiegel wird ueber HTTP ausgeliefert, mit Rueckfall auf die Datei', () => {
  assert.match(mainSource, /expressApp\.use\('\/mirror'/, '/mirror ist nicht gemountet');
  assert.match(mainSource, /loadURL\(url\)/, 'das Fenster laedt nicht ueber HTTP');
  assert.match(
    mainSource, /did-fail-load[\s\S]*?loadFile\(fileUrl\)/,
    'ohne Rueckfallebene bleibt der Spiegel schwarz, sobald der Server nicht antwortet'
  );
});

test('der Webserver startet vor dem Fenster', () => {
  // Auf den Aufruf ankern, nicht auf die Erwaehnung: weiter oben steht
  // app.whenReady() auch in einem Kommentar.
  const ready = mainSource.slice(mainSource.indexOf('app.whenReady().then('));
  const server = ready.indexOf('startWebServer()');
  const window = ready.indexOf('createWindow()');

  assert.ok(server > -1 && window > -1);
  assert.ok(
    server < window,
    'sonst laedt das Fenster, bevor der Port lauscht, und faellt unnoetig auf file:// zurueck'
  );
});

// backend.js laeuft im Hauptprozess und hat Zugriff auf Konfiguration und
// .env. Es darf unter keinen Umstaenden ueber HTTP abrufbar sein.
test('Modul-Dateien werden nur nach Whitelist ausgeliefert', () => {
  const whitelist = mainSource.match(/MODULE_PUBLIC_FILES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(whitelist, 'keine Whitelist fuer Modul-Dateien gefunden');

  const files = whitelist[1];
  assert.match(files, /'index\.js'/);
  assert.match(files, /'styles\.css'/);
  assert.match(files, /'module\.json'/);
  assert.doesNotMatch(files, /backend\.js/, 'backend.js steht auf der Whitelist');

  // Ohne Namenspruefung liesse sich ueber ../ aus dem Modulverzeichnis
  // ausbrechen.
  assert.match(
    mainSource, /\/\^\[a-zA-Z0-9_-\]\+\$\/\.test\(name\)/,
    'der Modulname wird nicht auf harmlose Zeichen geprueft'
  );
});

// Der WebSocket-Kanal muss denselben Schutz haben wie die HTTP-Seite - sonst
// waere der Bus ein offener Kanal ins Netzwerk.
test('der WebSocket-Hub bekommt die Anmeldung durchgereicht', () => {
  assert.match(
    mainSource, /createWsHub\(\{[^}]*auth[^}]*\}\)/,
    'ohne auth im Hub kann sich jeder im Netzwerk verbinden'
  );

  const bridge = fs.readFileSync(path.join(ROOT, 'src/main/busBridge.js'), 'utf8');
  assert.doesNotMatch(
    bridge, /wss\.clients/,
    'die Bruecke sendet wieder blind an alle Verbundenen, statt Abos zu beachten'
  );
});

test('Konfigurationsaenderungen tragen ihre Herkunft', () => {
  assert.match(
    mainSource, /origin:\s*req\.get\('X-MM-Client-Id'\)/,
    'ohne origin ueberschreibt der eigene Speichervorgang die offene Bearbeitung'
  );
});

// Ein Signal-Handler ersetzt das Standardverhalten. Beendet er nicht selbst,
// laesst sich die Anwendung gar nicht mehr stoppen - pm2 und systemd muessten
// jedes Mal bis zum SIGKILL warten.
test('nur der Hauptprozess behandelt Beendigungssignale', () => {
  assert.match(mainSource, /process\.on\('SIGTERM'/, 'der Hauptprozess behandelt SIGTERM nicht');
  assert.match(mainSource, /function shutdown\(/, 'kein zentrales Beenden');
  assert.match(mainSource, /onShutdown:\s*registerShutdownHook/, 'Module koennen sich nicht anmelden');

  const modulesDir = path.join(ROOT, 'modules');
  for (const name of fs.readdirSync(modulesDir)) {
    const backend = path.join(modulesDir, name, 'backend.js');
    if (!fs.existsSync(backend)) continue;

    const source = fs.readFileSync(backend, 'utf8').replace(/\/\/[^\n]*/g, '');
    for (const signal of ['SIGTERM', 'SIGINT', 'uncaughtException']) {
      assert.doesNotMatch(
        source,
        new RegExp(`process\\.on\\(\\s*'${signal}'`),
        `${name}/backend.js faengt ${signal} ab - das macht die Anwendung unstoppbar`
      );
    }
  }
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
