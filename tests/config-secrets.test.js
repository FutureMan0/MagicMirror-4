const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ConfigManager = require(path.join(ROOT, 'src/main/configManager.js'));
const { SECRET_PLACEHOLDER } = ConfigManager;

// ConfigManager leitet seine Pfade aus __dirname ab. Fuer den Test wird eine
// Instanz erzeugt und danach auf ein temporaeres Verzeichnis umgebogen, damit
// weder die echte .env noch die echte Config angefasst wird.
function makeManager(baseConfig) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm4-config-'));
  const manager = new ConfigManager('test-instance');

  manager.configPath = dir;
  manager.mainConfigPath = path.join(dir, 'config.json');
  manager.instanceConfigPath = path.join(dir, 'instances', 'test-instance.json');
  manager.envPath = path.join(dir, '.env');

  fs.writeFileSync(manager.mainConfigPath, JSON.stringify(baseConfig, null, 2));
  fs.writeFileSync(manager.envPath, '# Testdatei\n');

  return { manager, dir };
}

function readEnv(manager) {
  return manager._readEnvFile();
}

const BASE = {
  language: 'de',
  modules: [
    {
      module: 'untis',
      enabled: true,
      config: { username: 'luis', password: 'geheim123', school: 'htl-klu', viewMode: 'week' }
    },
    {
      module: 'weather',
      enabled: true,
      config: { apiKey: 'abcdef123456', city: 'Wien,AT' }
    },
    {
      module: 'clock',
      enabled: true,
      config: { showDate: true }
    }
  ]
};

test('saveConfig schreibt Geheimnisse in .env und nicht in die Config-Datei', () => {
  const { manager } = makeManager(BASE);
  manager.saveConfig(JSON.parse(JSON.stringify(BASE)));

  const written = JSON.parse(fs.readFileSync(manager.instanceConfigPath, 'utf8'));
  const untis = written.modules.find(m => m.module === 'untis');

  assert.equal(untis.config.password, undefined, 'Passwort darf nicht in der Config-Datei stehen');
  assert.equal(untis.config.viewMode, 'week', 'nicht-sensible Felder bleiben erhalten');

  const env = readEnv(manager);
  assert.equal(env.UNTIS_PASSWORD, 'geheim123');
  assert.equal(env.OPENWEATHERMAP_API_KEY, 'abcdef123456');
});

// Das ist der eigentliche Zweck: GET /api/config lieferte bisher Passwort,
// API-Key und Spotify-Secret im Klartext an jeden im WLAN.
test('loadConfig({redact:true}) liefert keine Klartext-Geheimnisse', () => {
  const { manager } = makeManager(BASE);
  manager.saveConfig(JSON.parse(JSON.stringify(BASE)));

  // saveConfig hat die Werte nach .env geschrieben; fuer den Test simulieren
  // wir das Zurueckspielen ueber process.env.
  process.env.UNTIS_PASSWORD = 'geheim123';
  process.env.OPENWEATHERMAP_API_KEY = 'abcdef123456';

  const redacted = manager.loadConfig({ redact: true });
  const serialized = JSON.stringify(redacted);

  assert.ok(!serialized.includes('geheim123'), 'Passwort taucht in der Antwort auf');
  assert.ok(!serialized.includes('abcdef123456'), 'API-Key taucht in der Antwort auf');
  assert.deepEqual(redacted.env, {}, 'das env-Objekt darf ueber HTTP leer sein');

  const untis = redacted.modules.find(m => m.module === 'untis');
  assert.equal(untis.config.password, SECRET_PLACEHOLDER, 'gesetzte Geheimnisse als Platzhalter melden');
  assert.equal(untis.config.viewMode, 'week');

  delete process.env.UNTIS_PASSWORD;
  delete process.env.OPENWEATHERMAP_API_KEY;
});

// Ohne diese Behandlung wuerde die Web-UI beim ersten Speichern das echte
// Passwort mit der Zeichenkette "__SET__" ueberschreiben.
test('der Platzhalter laesst das gespeicherte Geheimnis unveraendert', () => {
  const { manager } = makeManager(BASE);
  manager.saveConfig(JSON.parse(JSON.stringify(BASE)));
  assert.equal(readEnv(manager).UNTIS_PASSWORD, 'geheim123');

  // So sieht zurueckgeschickt aus, was die Web-UI aus einer maskierten
  // Antwort erzeugt: Platzhalter statt Wert, dazu eine echte Aenderung.
  const roundTrip = JSON.parse(JSON.stringify(BASE));
  const untis = roundTrip.modules.find(m => m.module === 'untis');
  untis.config.password = SECRET_PLACEHOLDER;
  untis.config.viewMode = 'day';

  manager.saveConfig(roundTrip);

  assert.equal(readEnv(manager).UNTIS_PASSWORD, 'geheim123', 'Passwort wurde ueberschrieben');

  const written = JSON.parse(fs.readFileSync(manager.instanceConfigPath, 'utf8'));
  assert.equal(written.modules.find(m => m.module === 'untis').config.viewMode, 'day');
});

test('ein neuer Wert ersetzt das gespeicherte Geheimnis', () => {
  const { manager } = makeManager(BASE);
  manager.saveConfig(JSON.parse(JSON.stringify(BASE)));

  const changed = JSON.parse(JSON.stringify(BASE));
  changed.modules.find(m => m.module === 'untis').config.password = 'neuesPasswort';
  manager.saveConfig(changed);

  assert.equal(readEnv(manager).UNTIS_PASSWORD, 'neuesPasswort');
});

test('nicht gesetzte Geheimnisse bleiben leer statt maskiert', () => {
  const base = JSON.parse(JSON.stringify(BASE));
  base.modules.find(m => m.module === 'weather').config.apiKey = '';

  const { manager } = makeManager(base);
  delete process.env.OPENWEATHERMAP_API_KEY;

  const redacted = manager.loadConfig({ redact: true });
  const weather = redacted.modules.find(m => m.module === 'weather');

  assert.notEqual(
    weather.config.apiKey, SECRET_PLACEHOLDER,
    'leere Felder duerfen nicht als "gesetzt" erscheinen'
  );
});

test('getSecretFields nennt die maskierten Felder', () => {
  const { manager } = makeManager(BASE);
  assert.deepEqual(manager.getSecretFields('weather'), ['apiKey']);
  assert.ok(manager.getSecretFields('spotify').includes('refreshToken'));
  assert.deepEqual(manager.getSecretFields('clock'), []);
});
