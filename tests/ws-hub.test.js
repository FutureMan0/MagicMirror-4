const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const { createWsHub, matchesTopic, CLOSE_NO_HELLO, CLOSE_UNAUTHORIZED } =
  require(path.join(ROOT, 'src/main/wsHub.js'));

// Anders als die quelltextbasierten Wächter ist das hier ein echter Test:
// richtiger HTTP-Server, richtiger WebSocket-Client, richtige Verbindung.
async function withHub(authStub, run) {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  const hub = createWsHub({ server, auth: authStub, helloTimeoutMs: 300, heartbeatMs: 60000 });
  const port = server.address().port;

  try {
    await run({ hub, port });
  } finally {
    hub.close();
    await new Promise(resolve => server.close(resolve));
  }
}

function connect(port, headers = {}) {
  return new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
}

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const onMessage = (raw) => {
      cleanup();
      resolve(JSON.parse(raw.toString()));
    };
    const onClose = (code) => {
      cleanup();
      reject(Object.assign(new Error(`geschlossen mit ${code}`), { code }));
    };
    const cleanup = () => {
      socket.off('message', onMessage);
      socket.off('close', onClose);
    };
    socket.on('message', onMessage);
    socket.on('close', onClose);
  });
}

function waitForClose(socket) {
  return new Promise(resolve => socket.on('close', resolve));
}

const allowAll = { isAuthenticated: () => true };
const denyAll = { isAuthenticated: () => false };

test('Themen-Muster greifen wie erwartet', () => {
  assert.equal(matchesTopic('*', 'irgendwas'), true);
  assert.equal(matchesTopic('presence:*', 'presence:changed'), true);
  assert.equal(matchesTopic('presence:*', 'presenceXchanged'), false);
  assert.equal(matchesTopic('config', 'config'), true);
  assert.equal(matchesTopic('config', 'config:changed'), false);
});

// Die HTTP-Seite ist seit Phase 1 geschützt. Ohne dieselbe Prüfung hier wäre
// der Bus ein offener Kanal ins Netzwerk.
test('eine nicht angemeldete Verbindung wird abgewiesen', async () => {
  await withHub(denyAll, async ({ port }) => {
    const socket = connect(port);
    const code = await waitForClose(socket);
    assert.equal(code, CLOSE_UNAUTHORIZED);
  });
});

test('ohne Begrüßung wird die Verbindung geschlossen', async () => {
  await withHub(allowAll, async ({ port }) => {
    const socket = connect(port);
    await new Promise(resolve => socket.on('open', resolve));
    // hello wird bewusst nicht geschickt.
    const code = await waitForClose(socket);
    assert.equal(code, CLOSE_NO_HELLO);
  });
});

test('nach der Begrüßung kommt ein welcome', async () => {
  await withHub(allowAll, async ({ port }) => {
    const socket = connect(port);
    await new Promise(resolve => socket.on('open', resolve));
    socket.send(JSON.stringify({ type: 'hello', clientId: 'test-1' }));

    const message = await nextMessage(socket);
    assert.equal(message.type, 'welcome');
    assert.equal(message.payload.clientId, 'test-1');
    assert.equal(message.v, 1);

    socket.close();
  });
});

test('zugestellt wird nur, was abonniert wurde', async () => {
  await withHub(allowAll, async ({ hub, port }) => {
    const socket = connect(port);
    await new Promise(resolve => socket.on('open', resolve));

    socket.send(JSON.stringify({ type: 'hello', clientId: 'test-2' }));
    await nextMessage(socket);
    socket.send(JSON.stringify({ type: 'subscribe', topics: ['presence:*'] }));

    // Kurz warten, bis das Abo verarbeitet ist.
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.equal(hub.broadcast('weather:conditions', {}), 0, 'nicht abonniert, trotzdem zugestellt');
    assert.equal(hub.broadcast('presence:changed', { present: true }), 1);

    const message = await nextMessage(socket);
    assert.equal(message.type, 'event');
    assert.equal(message.topic, 'presence:changed');
    assert.deepEqual(message.payload, { present: true });

    socket.close();
  });
});

test('ein Client ohne Begrüßung bekommt nichts zugestellt', async () => {
  await withHub(allowAll, async ({ hub, port }) => {
    const socket = connect(port);
    await new Promise(resolve => socket.on('open', resolve));
    // Kein hello - der Client zählt nicht.
    assert.equal(hub.clientCount(), 0);
    assert.equal(hub.broadcast('presence:changed', {}), 0);
    socket.close();
  });
});

test('unlesbare Nachrichten kappen die Verbindung nicht', async () => {
  await withHub(allowAll, async ({ port }) => {
    const socket = connect(port);
    await new Promise(resolve => socket.on('open', resolve));

    socket.send(JSON.stringify({ type: 'hello', clientId: 'test-3' }));
    await nextMessage(socket);

    socket.send('{kein gueltiges JSON');
    socket.send(JSON.stringify({ type: 'ping' }));

    const message = await nextMessage(socket);
    assert.equal(message.type, 'pong', 'die Verbindung hat den Mist nicht überlebt');

    socket.close();
  });
});

test('abgemeldete Themen werden nicht mehr zugestellt', async () => {
  await withHub(allowAll, async ({ hub, port }) => {
    const socket = connect(port);
    await new Promise(resolve => socket.on('open', resolve));

    socket.send(JSON.stringify({ type: 'hello', clientId: 'test-4' }));
    await nextMessage(socket);
    socket.send(JSON.stringify({ type: 'subscribe', topics: ['config'] }));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(hub.broadcast('config', {}), 1);

    socket.send(JSON.stringify({ type: 'unsubscribe', topics: ['config'] }));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(hub.broadcast('config', {}), 0);

    socket.close();
  });
});
