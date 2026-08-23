const { Bus } = require('../shared/bus');

/**
 * Verbindet den Bus des Hauptprozesses mit Renderer (IPC) und Web-UI
 * (WebSocket).
 *
 * Ein Bus, drei Transporte. Wer im Hauptprozess `bus.emit('presence:changed', …)`
 * aufruft, erreicht damit alle Spiegel-Fenster und alle offenen Web-Oberflächen,
 * ohne einen davon zu kennen.
 *
 * Der WebSocket-Server existierte schon, aber es hat sich nie jemand
 * verbunden - er hat ins Leere gesendet.
 */
function createBusBridge({ getWindows, getWsHub }) {
  const bus = new Bus({ name: 'main' });

  // Alles weiterreichen, was nicht selbst von aussen hereingekommen ist -
  // sonst schickt man ein Ereignis im Kreis.
  bus.on('*', (payload, topic) => {
    if (payload && payload.__forwarded) return;

    const envelope = { topic, payload, ts: Date.now() };

    for (const win of getWindows()) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('bus-event', envelope);
      }
    }

    // Der Hub stellt nur an Clients zu, die das Thema abonniert haben - ein
    // Handy braucht nicht jeden Sekundentakt des Spiegels.
    const hub = getWsHub();
    if (hub) hub.broadcast(topic, payload);
  });

  /** Ereignis, das aus einem Renderer kam - lokal zustellen, nicht zurückschicken. */
  function receiveFromRenderer(topic, payload) {
    if (typeof topic !== 'string' || !topic) return;
    bus.emit(topic, { ...(payload || {}), __forwarded: true });
  }

  return { bus, receiveFromRenderer };
}

module.exports = { createBusBridge };
