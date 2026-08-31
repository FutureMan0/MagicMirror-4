const { WebSocketServer } = require('ws');
const { Auth } = require('./auth');

/**
 * WebSocket-Verteiler für Web-Oberfläche und weitere Anzeigen.
 *
 * Vorher gab es zwar einen WebSocket-Server, aber er schickte blind an alle
 * Verbundenen und niemand hat sich je verbunden. Was gefehlt hat:
 *
 *  - **Anmeldung.** Ohne sie wäre der Bus ein offener Kanal ins Netzwerk,
 *    obwohl die HTTP-Seite seit Phase 1 geschützt ist.
 *  - **Abos.** Ein Handy braucht nicht jeden Sekundentakt des Spiegels.
 *  - **Herzschlag.** Eine tot gegangene WLAN-Verbindung bleibt sonst als
 *    offener Eintrag stehen, und Nachrichten laufen ins Nichts.
 */

const HELLO_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 30000;

const PROTOCOL_VERSION = 1;

// Erst nach einer Begrüßung wird zugestellt.
const CLOSE_NO_HELLO = 4401;
const CLOSE_UNAUTHORIZED = 4403;

function matchesTopic(pattern, topic) {
  if (pattern === '*' || pattern === topic) return true;
  if (!pattern.endsWith(':*')) return false;
  return topic.startsWith(pattern.slice(0, -1));
}

function createWsHub({
  server,
  auth,
  onRpc = null,
  // Nur für Tests: sonst dauert jeder Lauf die volle Begrüssungsfrist.
  helloTimeoutMs = HELLO_TIMEOUT_MS,
  heartbeatMs = HEARTBEAT_MS
} = {}) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Map();

  function send(socket, message) {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify({ v: PROTOCOL_VERSION, ts: Date.now(), ...message }));
  }

  wss.on('connection', (socket, request) => {
    // Drei Wege herein, in dieser Reihenfolge:
    //
    //   1. Loopback - die Module holen ihre Daten von der eigenen Adresse.
    //   2. Eine Eintrittskarte in der Adresse (?ticket=). Die braucht es, weil
    //      iOS Safari den Sitzungs-Cookie beim WebSocket-Upgrade nicht
    //      mitschickt, wenn die Oberflaeche als App auf dem Startbildschirm
    //      liegt: HTTP ging, der Kanal nicht, und die Oberflaeche sperrte
    //      daraufhin jede Aenderung.
    //   3. Der Sitzungs-Cookie, wie auf der HTTP-Seite.
    const anfrage = {
      headers: request.headers,
      socket: request.socket,
      path: '/ws'
    };

    let ticket = null;
    try {
      ticket = new URL(request.url, 'http://localhost').searchParams.get('ticket');
    } catch {
      // Keine auswertbare Adresse - dann bleibt es beim Cookie.
    }

    const willkommen = (auth ? auth.isAuthenticated(anfrage) : true)
      || (ticket && auth && auth.consumeWsTicket(ticket));

    if (!willkommen) {
      // Absichtlich mit Hinweis, welche Nachweise fehlten: ohne diese Zeile
      // sah man am Geraet nur "keine Verbindung" und hatte nichts in der Hand.
      console.warn('[ws] abgewiesen von %s (Cookie: %s, Karte: %s)',
        request.socket.remoteAddress,
        request.headers.cookie ? 'ja' : 'nein',
        ticket ? 'ungueltig' : 'keine');

      send(socket, { type: 'error', payload: { code: 'unauthorized' } });
      socket.close(CLOSE_UNAUTHORIZED, 'nicht angemeldet');
      return;
    }

    const state = { clientId: null, topics: new Set(), alive: true };
    clients.set(socket, state);

    const helloTimer = setTimeout(() => {
      if (!state.clientId) socket.close(CLOSE_NO_HELLO, 'keine Begruessung');
    }, helloTimeoutMs);

    socket.on('pong', () => { state.alive = true; });

    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return; // Unlesbares still verwerfen - kein Grund, die Verbindung zu kappen.
      }

      switch (message.type) {
        case 'hello':
          state.clientId = String(message.clientId || '').slice(0, 64) || `client-${clients.size}`;
          clearTimeout(helloTimer);
          send(socket, {
            type: 'welcome',
            payload: { clientId: state.clientId, protocol: PROTOCOL_VERSION }
          });
          break;

        case 'subscribe':
          for (const topic of message.topics || []) {
            if (typeof topic === 'string') state.topics.add(topic);
          }
          break;

        case 'unsubscribe':
          for (const topic of message.topics || []) state.topics.delete(topic);
          break;

        case 'ping':
          send(socket, { type: 'pong' });
          break;

        case 'rpc':
          if (!onRpc) {
            send(socket, {
              type: 'rpc-error',
              id: message.id,
              payload: { message: 'Keine RPC-Handler registriert.' }
            });
            break;
          }
          Promise.resolve(onRpc(message.method, message.params, state))
            .then(result => send(socket, { type: 'rpc-result', id: message.id, payload: result }))
            .catch(error => send(socket, {
              type: 'rpc-error',
              id: message.id,
              payload: { message: error.message }
            }));
          break;

        default:
          break;
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      clients.delete(socket);
    });

    socket.on('error', () => {
      clearTimeout(helloTimer);
      clients.delete(socket);
    });
  });

  // Eine im WLAN weggebrochene Verbindung meldet sich nicht ab. Ohne
  // Herzschlag bliebe sie als offener Eintrag stehen.
  const heartbeat = setInterval(() => {
    for (const [socket, state] of clients) {
      if (!state.alive) {
        socket.terminate();
        clients.delete(socket);
        continue;
      }
      state.alive = false;
      try {
        socket.ping();
      } catch {
        socket.terminate();
        clients.delete(socket);
      }
    }
  }, heartbeatMs);
  heartbeat.unref?.();

  return {
    /** Stellt ein Ereignis an alle zu, die das Thema abonniert haben. */
    broadcast(topic, payload) {
      let delivered = 0;

      for (const [socket, state] of clients) {
        if (!state.clientId) continue;
        if (![...state.topics].some(pattern => matchesTopic(pattern, topic))) continue;

        send(socket, { type: 'event', topic, payload });
        delivered += 1;
      }

      return delivered;
    },

    clientCount: () => [...clients.values()].filter(state => state.clientId).length,

    close() {
      clearInterval(heartbeat);
      wss.close();
    },

    // Für Tests.
    _wss: wss,
    _clients: clients
  };
}

module.exports = { createWsHub, matchesTopic, PROTOCOL_VERSION, CLOSE_NO_HELLO, CLOSE_UNAUTHORIZED };
