// Live-Verbindung zur Spiegel-Instanz.
//
// Die Oberfläche hat ihre Daten bisher nur beim Laden geholt. Änderungen von
// einem anderen Gerät - oder vom Spiegel selbst - kamen nie an, und der
// Spotify-Einrichtungsdialog fragte im Sekundentakt nach.
//
// Wichtiger als das Nachladen ist aber, was bei *fehlender* Verbindung
// passiert: Wer offline weiterklickt und speichert, überschreibt womöglich
// einen Stand, den er gar nicht gesehen hat. Deshalb sperrt der Client die
// Speichern-Knöpfe, solange er getrennt ist.
(function () {
  const RECONNECT_MIN_MS = 1000;
  const RECONNECT_MAX_MS = 30000;

  // Eigene Kennung: Ereignisse, die der eigene Speichervorgang ausgelöst hat,
  // dürfen die gerade offene Bearbeitung nicht überschreiben.
  const clientId = `webui-${Math.random().toString(36).slice(2, 10)}`;

  let socket = null;
  let reconnectDelay = RECONNECT_MIN_MS;
  let reconnectTimer = null;
  let connected = false;
  let banner = null;

  // 'config:*', nicht 'config': das Ereignis heisst config:changed, und ein
  // Muster ohne :* trifft nur den exakten Namen. Sonst kommt nie etwas an.
  const topics = new Set(['config:*', 'presence:*', 'system:*', 'data:*']);

  function setConnected(next) {
    if (connected === next) return;
    connected = next;

    document.body.classList.toggle('mm-offline', !next);
    updateBanner();
    lockSaveButtons(!next);

    document.dispatchEvent(new CustomEvent('mm:connection', { detail: { connected: next } }));
  }

  function updateBanner() {
    if (connected) {
      banner?.remove();
      banner = null;
      return;
    }

    if (banner) return;
    banner = document.createElement('div');
    banner.className = 'mm-offline-banner';
    banner.textContent = 'Keine Verbindung zum Spiegel — Änderungen sind vorübergehend gesperrt.';
    document.body.appendChild(banner);
  }

  /**
   * Sperrt alles, was speichert. Bewusst breit gefasst: lieber ein Knopf zu
   * viel gesperrt als eine Änderung, die auf einem veralteten Stand aufsetzt.
   */
  function lockSaveButtons(locked) {
    const selectors = [
      '#save-settings-btn',
      '#save-grid-settings-btn',
      '#execute-update-btn',
      '.btn-primary[data-saves]'
    ];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        element.disabled = locked;
        element.title = locked ? 'Keine Verbindung zum Spiegel' : '';
      }
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;

    // Zufällige Streuung, damit nicht alle Geräte gleichzeitig anklopfen.
    const jitter = reconnectDelay * (0.75 + Math.random() * 0.5);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, jitter);

    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${scheme}//${window.location.host}/ws`);

    socket.addEventListener('open', () => {
      reconnectDelay = RECONNECT_MIN_MS;
      socket.send(JSON.stringify({ type: 'hello', clientId }));
      socket.send(JSON.stringify({ type: 'subscribe', topics: [...topics] }));
      setConnected(true);
    });

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === 'event') {
        handleEvent(message.topic, message.payload);
      }
    });

    socket.addEventListener('close', () => {
      setConnected(false);
      scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // close folgt ohnehin; hier nur nicht in die Konsole schreien.
      socket.close();
    });
  }

  function handleEvent(topic, payload) {
    // Der eigene Speichervorgang: die Oberfläche hat den Stand bereits.
    if (payload && payload.origin && payload.origin === clientId) return;

    document.dispatchEvent(new CustomEvent('mm:event', { detail: { topic, payload } }));

    if (topic === 'config:changed') {
      document.dispatchEvent(new CustomEvent('mm:config', { detail: payload }));
    }
  }

  // Nach dem Aufwachen aus dem Hintergrund sofort nachfassen, statt den
  // Backoff abzuwarten - sonst wirkt die Oberfläche beim Zurückwechseln tot.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !connected) {
      reconnectDelay = RECONNECT_MIN_MS;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      connect();
    }
  });

  window.addEventListener('online', () => {
    reconnectDelay = RECONNECT_MIN_MS;
    connect();
  });

  window.mmLive = {
    clientId,
    isConnected: () => connected,
    subscribe(topic) {
      topics.add(topic);
      if (connected) socket.send(JSON.stringify({ type: 'subscribe', topics: [topic] }));
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect);
  } else {
    connect();
  }
})();
