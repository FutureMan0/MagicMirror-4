const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { normalizeManifest, defaultEnvName } = require(path.join(ROOT, 'src/shared/manifest.js'));

test('leitet ENV-Namen nachvollziehbar ab', () => {
  assert.equal(defaultEnvName('weather', 'apiKey'), 'WEATHER_API_KEY');
  assert.equal(defaultEnvName('home-assistant', 'accessToken'), 'HOME_ASSISTANT_ACCESS_TOKEN');
  assert.equal(defaultEnvName('mqtt', 'password'), 'MQTT_PASSWORD');
});

test('ein v1-Manifest ohne secrets bleibt gültig', () => {
  const manifest = normalizeManifest({ name: 'clock', displayName: 'Uhr' }, 'clock');
  assert.equal(manifest.apiVersion, 1);
  assert.deepEqual(manifest.secrets, []);
  assert.equal(manifest.entry, 'index.js');
});

test('secrets akzeptieren Kurzform und volle Form', () => {
  const manifest = normalizeManifest({
    name: 'demo',
    secrets: ['token', { key: 'apiKey', env: 'CUSTOM_KEY', exposeToRenderer: false }]
  }, 'demo');

  assert.equal(manifest.secrets[0].env, 'DEMO_TOKEN', 'Kurzform braucht einen abgeleiteten ENV-Namen');
  assert.equal(manifest.secrets[0].exposeToRenderer, true, 'Standard muss "sichtbar" sein');
  assert.equal(manifest.secrets[1].env, 'CUSTOM_KEY');
  assert.equal(manifest.secrets[1].exposeToRenderer, false);
});

test('unbekannte Config-Typen werden gemeldet und auf string zurückgesetzt', () => {
  const warnings = [];
  const manifest = normalizeManifest(
    { name: 'demo', config: { x: { type: 'kaputt' } } },
    'demo',
    { warn: (message) => warnings.push(message) }
  );

  assert.equal(manifest.config.x.type, 'string');
  assert.equal(warnings.length, 1);
});

// Der eigentliche Zweck: ein Modul mit API-Schlüssel darf keinen Eingriff im
// Kern mehr brauchen. Vorher standen die Zuordnungen an zwei Stellen fest
// verdrahtet - in configManager.js und in renderer/moduleLoader.js.
test('der Kern kennt keine fest verdrahteten Modulnamen mehr', () => {
  const configManager = fs.readFileSync(path.join(ROOT, 'src/main/configManager.js'), 'utf8');
  const rendererLoader = fs.readFileSync(path.join(ROOT, 'src/renderer/moduleLoader.js'), 'utf8');

  for (const source of [configManager, rendererLoader]) {
    assert.doesNotMatch(source, /sensitiveFieldsMapping/);
    for (const name of ['weather', 'untis', 'spotify']) {
      assert.doesNotMatch(
        source,
        new RegExp(`case '${name}'`),
        `"${name}" ist wieder fest im Kern verdrahtet`
      );
    }
  }
});

test('die Manifeste der ausgelieferten Module sind gültig', () => {
  const modulesDir = path.join(ROOT, 'modules');
  const names = fs.readdirSync(modulesDir)
    .filter(name => fs.existsSync(path.join(modulesDir, name, 'module.json')));

  const seenEnvNames = new Map();

  for (const name of names) {
    const raw = JSON.parse(fs.readFileSync(path.join(modulesDir, name, 'module.json'), 'utf8'));
    const manifest = normalizeManifest(raw, name);

    assert.equal(manifest.name, name);

    for (const secret of manifest.secrets) {
      // Ein doppelt vergebener ENV-Name würde bedeuten, dass sich zwei Module
      // gegenseitig die Zugangsdaten überschreiben.
      const previous = seenEnvNames.get(secret.env);
      assert.equal(
        previous, undefined,
        `${secret.env} wird von ${name} und ${previous} gleichzeitig benutzt`
      );
      seenEnvNames.set(secret.env, name);

      // Jedes Geheimnis muss auch im Config-Schema stehen, sonst taucht es in
      // der Web-UI gar nicht als Feld auf.
      assert.ok(
        manifest.config[secret.key],
        `${name}: "${secret.key}" ist als Geheimnis deklariert, fehlt aber im Config-Schema`
      );
    }
  }
});

// Ein WebUntis-Passwort hat im Browser nichts verloren.
test('die WebUntis-Zugangsdaten erreichen den Renderer nicht', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules/untis/module.json'), 'utf8'));
  const manifest = normalizeManifest(raw, 'untis');

  for (const key of ['server', 'username', 'password', 'school']) {
    const secret = manifest.secrets.find(s => s.key === key);
    assert.ok(secret, `untis: "${key}" ist nicht als Geheimnis deklariert`);
    assert.equal(secret.exposeToRenderer, false, `untis.${key} wird an den Browser ausgeliefert`);
  }

  const frontend = fs.readFileSync(path.join(ROOT, 'modules/untis/index.js'), 'utf8');
  assert.doesNotMatch(
    frontend,
    /password:\s*this\.config\.password/,
    'Das Frontend schickt das Passwort wieder mit'
  );

  const backend = fs.readFileSync(path.join(ROOT, 'modules/untis/backend.js'), 'utf8');
  assert.doesNotMatch(
    backend,
    /req\.body\.(server|username|password|school)/,
    'Das Backend übernimmt Zugangsdaten wieder aus dem Request - damit liesse sich ein beliebiger Host ansprechen'
  );
});
