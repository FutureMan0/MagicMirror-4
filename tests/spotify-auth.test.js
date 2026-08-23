const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { TokenStore, createPkcePair } = require(path.join(ROOT, 'src/main/integrations/tokenStore.js'));

test('PKCE erzeugt einen passenden Prüfwert', () => {
  const { verifier, challenge } = createPkcePair();

  assert.ok(verifier.length >= 43, 'zu kurz für den Standard');
  assert.equal(
    crypto.createHash('sha256').update(verifier).digest('base64url'),
    challenge,
    'die Prüfsumme passt nicht zum Prüfwert'
  );
  // base64url: keine Zeichen, die in einer Adresse kodiert werden müssten.
  assert.doesNotMatch(verifier + challenge, /[+/=]/);
});

test('zwei Aufrufe erzeugen verschiedene Prüfwerte', () => {
  assert.notEqual(createPkcePair().verifier, createPkcePair().verifier);
});

function makeStore() {
  const env = {};
  delete process.env.TEST_REFRESH;

  return {
    env,
    store: new TokenStore({
      envKey: 'TEST_REFRESH',
      readEnv: () => ({ ...env }),
      writeEnv: (vars) => Object.assign(env, vars),
      log: { warn() {} }
    })
  };
}

test('ohne Token wird das gemeldet, statt es zu versuchen', async () => {
  const { store } = makeStore();

  assert.equal(store.hasRefreshToken(), false);
  await assert.rejects(
    () => store.getAccessToken(async () => { throw new Error('darf nicht aufgerufen werden'); }),
    /Nicht verbunden/
  );
});

test('ein gültiger Zugangstoken wird wiederverwendet', async () => {
  const { store } = makeStore();
  store.saveRefreshToken('r1');

  let calls = 0;
  const refresher = async () => {
    calls += 1;
    return { accessToken: `a${calls}`, expiresIn: 3600 };
  };

  assert.equal(await store.getAccessToken(refresher), 'a1');
  assert.equal(await store.getAccessToken(refresher), 'a1');
  assert.equal(calls, 1, 'es wurde unnötig erneuert');
});

test('ein abgelaufener Zugangstoken wird erneuert', async () => {
  const { store } = makeStore();
  store.saveRefreshToken('r1');

  let calls = 0;
  const refresher = async () => {
    calls += 1;
    return { accessToken: `a${calls}`, expiresIn: 3600 };
  };

  await store.getAccessToken(refresher);
  store.expiresAt = Date.now() - 1;

  assert.equal(await store.getAccessToken(refresher), 'a2');
  assert.equal(calls, 2);
});

// Der eigentliche Grund für diese Klasse: unter PKCE gibt Spotify bei jeder
// Erneuerung einen NEUEN Refresh-Token aus und macht den alten ungültig. Zwei
// gleichzeitige Erneuerungen bedeuten, dass eine davon mit einem toten Token
// dasteht - und der Zugang ist weg, wiederherstellbar nur über den ganzen
// Anmeldevorgang.
test('gleichzeitige Erneuerungen werden zu einer zusammengefasst', async () => {
  const { store } = makeStore();
  store.saveRefreshToken('r1');

  let calls = 0;
  const refresher = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 30));
    return { accessToken: `a${calls}`, expiresIn: 3600, refreshToken: `r${calls + 1}` };
  };

  const results = await Promise.all([
    store.getAccessToken(refresher),
    store.getAccessToken(refresher),
    store.getAccessToken(refresher)
  ]);

  assert.equal(calls, 1, `${calls} parallele Erneuerungen - der Zugang wäre verloren`);
  assert.deepEqual(results, ['a1', 'a1', 'a1']);
});

test('ein rotierter Refresh-Token wird gespeichert', async () => {
  const { store, env } = makeStore();
  store.saveRefreshToken('alt');

  await store.getAccessToken(async () => ({
    accessToken: 'a1',
    expiresIn: 3600,
    refreshToken: 'neu'
  }));

  assert.equal(env.TEST_REFRESH, 'neu', 'der neue Token wurde nicht gesichert');
  assert.equal(store.getRefreshToken(), 'neu');
});

test('clear() trennt die Verbindung vollständig', async () => {
  const { store, env } = makeStore();
  store.saveRefreshToken('r1');
  await store.getAccessToken(async () => ({ accessToken: 'a1', expiresIn: 3600 }));

  store.clear();

  assert.equal(store.hasRefreshToken(), false);
  assert.equal(env.TEST_REFRESH, '');
  assert.equal(store.accessToken, null);
});

// Spotify erlaubt seit November 2025 nur noch https:// oder woertliche
// Loopback-Adressen als Rueckleitung. Eine LAN-Adresse wuerde abgelehnt - und
// genau daran scheiterte die Einrichtung vom Handy aus.
test('die Rückleitungsadresse ist HTTPS', () => {
  const backend = require(path.join(ROOT, 'modules/spotify/backend.js'));
  const redirect = backend._internals.DEFAULT_REDIRECT;

  assert.ok(redirect.startsWith('https://'), 'Spotify lehnt alles andere ab');
  assert.doesNotMatch(redirect, /localhost|127\.0\.0\.1|192\.168\./);
});

test('die angeforderten Berechtigungen reichen für Anzeige und Steuerung', () => {
  const backend = require(path.join(ROOT, 'modules/spotify/backend.js'));
  const scopes = backend._internals.SCOPES.split(' ');

  assert.ok(scopes.includes('user-read-currently-playing'));
  assert.ok(scopes.includes('user-modify-playback-state'), 'ohne das ist keine Steuerung möglich');
});

test('das Modul verlangt kein Client Secret mehr', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'modules/spotify/module.json'), 'utf8')
  );

  assert.equal(manifest.config.clientSecret, undefined, 'PKCE braucht kein Secret');
  assert.ok(manifest.config.clientId, 'die Client ID wird weiterhin gebraucht');

  const backend = fs.readFileSync(path.join(ROOT, 'modules/spotify/backend.js'), 'utf8');
  assert.doesNotMatch(backend, /client_secret/, 'im Backend steckt noch ein Secret-Pfad');
});

// Der zweite Server auf 127.0.0.1:8080 war der Grund, warum die Einrichtung
// vom Handy aus nicht ging: dort zeigt 127.0.0.1 auf das Handy.
test('es gibt keinen zweiten Server mehr', () => {
  const backend = fs.readFileSync(path.join(ROOT, 'modules/spotify/backend.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  assert.doesNotMatch(backend, /listen\(/, 'ein eigener Server ist zurück');
  assert.doesNotMatch(backend, /8080/);
});

test('die Steuerung erlaubt nur bekannte Aktionen', () => {
  const backend = fs.readFileSync(path.join(ROOT, 'modules/spotify/backend.js'), 'utf8');

  // Kein Durchreichen beliebiger Pfade an Spotify.
  assert.match(backend, /const CONTROLS = \{/);
  assert.doesNotMatch(
    backend,
    /\$\{req\.body[^}]*\}`/,
    'ein Wert aus dem Request landet direkt in einer Spotify-Adresse'
  );
});
