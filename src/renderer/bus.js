// Der Bus im Renderer.
//
// Empfängt Ereignisse aus dem Hauptprozess (per IPC) und stellt sie lokal zu.
// Module abonnieren Themen, statt Endpunkte im Sekundentakt abzufragen.
(function () {
  // src/shared/bus.js wird davor als <script> geladen und legt die Klasse
  // unter window.MMBusModule ab.
  const Bus = window.MMBusModule && window.MMBusModule.Bus;
  if (!Bus) {
    console.error('Bus-Implementierung nicht gefunden - lädt src/shared/bus.js vor bus.js?');
    return;
  }

  const bus = new Bus({ name: 'renderer' });

  // Ereignisse aus dem Hauptprozess lokal zustellen.
  if (window.electronAPI && window.electronAPI.onBusEvent) {
    window.electronAPI.onBusEvent((envelope) => {
      if (!envelope || typeof envelope.topic !== 'string') return;
      bus.emit(envelope.topic, envelope.payload);
    });
  }

  /**
   * Ereignis an den Hauptprozess schicken UND lokal zustellen.
   *
   * Der Hauptprozess schickt es nicht zurück (siehe busBridge), sonst käme es
   * doppelt an.
   */
  function publish(topic, payload) {
    bus.emit(topic, payload);
    if (window.electronAPI && window.electronAPI.emitBusEvent) {
      window.electronAPI.emitBusEvent(topic, payload);
    }
  }

  window.mmBus = {
    on: (pattern, listener) => bus.on(pattern, listener),
    once: (pattern, listener) => bus.once(pattern, listener),
    off: (pattern, listener) => bus.off(pattern, listener),
    emit: (topic, payload) => bus.emit(topic, payload),
    publish
  };
})();
