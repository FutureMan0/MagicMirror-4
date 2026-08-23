const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { Auth } = require(path.join(ROOT, 'src/main/auth.js'));

function makeAuth({ token = null, authOff = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm4-auth-'));
  const env = {};

  if (token) {
    process.env.MM_ADMIN_TOKEN = token;
  } else {
    delete process.env.MM_ADMIN_TOKEN;
  }

  if (authOff) {
    process.env.MM_AUTH = 'off';
  } else {
    delete process.env.MM_AUTH;
  }

  const auth = new Auth({
    configDir: dir,
    envPath: path.join(dir, '.env'),
    readEnv: () => ({ ...env }),
    writeEnv: (vars) => Object.assign(env, vars)
  });

  return { auth, env, dir };
}

// Anfragen ohne Cookie, wie sie vom Handy kommen.
function remoteRequest(headers = {}) {
  return { headers, socket: { remoteAddress: '192.168.1.77' }, path: '/config' };
}

function localRequest(headers = {}) {
  return { headers, socket: { remoteAddress: '127.0.0.1' }, path: '/config' };
}

test('erzeugt beim ersten Start ein Admin-Token und legt es in .env ab', () => {
  const { auth, env } = makeAuth();
  assert.equal(typeof auth.token, 'string');
  assert.ok(auth.token.length >= 64, 'Token ist zu kurz');
  assert.equal(env.MM_ADMIN_TOKEN, auth.token, 'Token muss in .env landen');
});

test('ein vorhandenes Token wird uebernommen statt neu erzeugt', () => {
  const existing = 'a'.repeat(64);
  const { auth, env } = makeAuth({ token: existing });
  assert.equal(auth.token, existing);
  assert.equal(env.MM_ADMIN_TOKEN, undefined, '.env darf unveraendert bleiben');
});

test('eine entfernte Anfrage ohne Session ist nicht angemeldet', () => {
  const { auth } = makeAuth();
  assert.equal(auth.isAuthenticated(remoteRequest()), false);
});

// Die Module am Spiegel holen ihre Daten per HTTP von der eigenen Maschine.
// Wuerde Loopback nicht ausgenommen, muesste jedes Modul umgebaut werden -
// und wer Zugriff auf den Pi hat, hat ohnehin eine Shell.
test('Loopback ist ausgenommen, damit die Module am Spiegel weiter laufen', () => {
  const { auth } = makeAuth();
  assert.equal(auth.isAuthenticated(localRequest()), true);
});

test('ein X-Forwarded-For-Header macht eine Anfrage nicht zu Loopback', () => {
  const { auth } = makeAuth();
  const spoofed = remoteRequest({ 'x-forwarded-for': '127.0.0.1' });
  assert.equal(auth.isAuthenticated(spoofed), false);
});

test('MM_AUTH=off laesst alles durch', () => {
  const { auth } = makeAuth({ authOff: true });
  assert.equal(auth.enabled, false);
  assert.equal(auth.isAuthenticated(remoteRequest()), true);
});

test('Kopplung: richtiger Code ergibt eine gueltige Session', () => {
  const { auth } = makeAuth();
  const state = auth.startPairing('192.168.1.77');

  assert.equal(state.active, true);
  assert.equal(state.code.length, 8);

  const sessionId = auth.claimPairing(state.code, 'Testgeraet');
  assert.ok(auth.isValidSession(sessionId));

  const request = remoteRequest({ cookie: `mm4_session=${sessionId}` });
  assert.equal(auth.isAuthenticated(request), true);
});

test('Kopplung: Gross-/Kleinschreibung und Leerzeichen sind egal', () => {
  const { auth } = makeAuth();
  const { code } = auth.startPairing('192.168.1.77');
  const typed = code.toLowerCase().replace(/(.{4})/, '$1 ');
  assert.ok(auth.isValidSession(auth.claimPairing(typed, 'Testgeraet')));
});

test('Kopplung: falscher Code wird abgewiesen', () => {
  const { auth } = makeAuth();
  auth.startPairing('192.168.1.77');
  assert.throws(() => auth.claimPairing('AAAABBBB', 'Testgeraet'), /stimmt nicht/);
});

test('Kopplung: nach fuenf Fehlversuchen wird abgebrochen', () => {
  const { auth } = makeAuth();
  const { code } = auth.startPairing('192.168.1.77');
  const wrong = code === 'AAAABBBB' ? 'BBBBAAAA' : 'AAAABBBB';

  for (let i = 0; i < 5; i += 1) {
    assert.throws(() => auth.claimPairing(wrong, 'x'));
  }

  // Auch der richtige Code hilft jetzt nicht mehr.
  assert.throws(() => auth.claimPairing(code, 'x'), /keine Kopplung|Fehlversuche/);
});

test('Kopplung: ohne laufende Kopplung geht gar nichts', () => {
  const { auth } = makeAuth();
  assert.throws(() => auth.claimPairing('AAAABBBB', 'x'), /keine Kopplung/);
});

test('Kopplung: ein abgelaufener Code wird nicht mehr angenommen', () => {
  const { auth } = makeAuth();
  const { code } = auth.startPairing('192.168.1.77');
  auth.pairing.expiresAt = Date.now() - 1;
  assert.throws(() => auth.claimPairing(code, 'x'), /keine Kopplung/);
});

test('Kopplung: zu schnelle Wiederholung wird gebremst', () => {
  const { auth } = makeAuth();
  auth.startPairing('192.168.1.77');
  assert.throws(() => auth.startPairing('192.168.1.77'), /Zu viele/);
});

test('Anmeldung per Token funktioniert, ein falsches Token nicht', () => {
  const { auth } = makeAuth();
  assert.ok(auth.isValidSession(auth.loginWithToken(auth.token, 'CLI')));
  assert.throws(() => auth.loginWithToken('b'.repeat(64), 'CLI'), /stimmt nicht/);
  assert.throws(() => auth.loginWithToken('kurz', 'CLI'), /stimmt nicht/);
});

test('Bearer-Token im Header wird akzeptiert', () => {
  const { auth } = makeAuth();
  const request = remoteRequest({ authorization: `Bearer ${auth.token}` });
  assert.equal(auth.isAuthenticated(request), true);

  const wrong = remoteRequest({ authorization: 'Bearer falsch' });
  assert.equal(auth.isAuthenticated(wrong), false);
});

test('abgelaufene und zurueckgezogene Sessions gelten nicht mehr', () => {
  const { auth } = makeAuth();
  const sessionId = auth.loginWithToken(auth.token, 'CLI');

  auth.sessions[sessionId].expiresAt = Date.now() - 1;
  assert.equal(auth.isValidSession(sessionId), false);

  const second = auth.loginWithToken(auth.token, 'CLI');
  auth.revokeSession(second);
  assert.equal(auth.isValidSession(second), false);
});

test('Sessions ueberleben einen Neustart', () => {
  const { auth, dir, env } = makeAuth();
  const sessionId = auth.loginWithToken(auth.token, 'Handy');

  process.env.MM_ADMIN_TOKEN = auth.token;
  const restarted = new Auth({
    configDir: dir,
    envPath: path.join(dir, '.env'),
    readEnv: () => ({ ...env }),
    writeEnv: () => {}
  });

  assert.ok(restarted.isValidSession(sessionId), 'Session nach Neustart verloren');
});

test('die Middleware antwortet mit 401 statt still durchzulassen', () => {
  const { auth } = makeAuth();
  const middleware = auth.middleware(['/auth/']);

  let status = null;
  let body = null;
  let nextCalled = false;

  const res = {
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; }
  };

  middleware(remoteRequest(), res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(status, 401);
  assert.equal(body.authRequired, true);

  // Die Anmelderouten selbst muessen offen bleiben.
  nextCalled = false;
  middleware({ ...remoteRequest(), path: '/auth/status' }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});
