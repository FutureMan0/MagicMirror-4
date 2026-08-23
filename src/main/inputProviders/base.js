/**
 * Schnittstelle für Gesten-Erkennung.
 *
 * Der Spiegel soll nicht wissen, welcher Sensor angeschlossen ist. Das ist
 * hier keine Vorsichtsmaßnahme auf Verdacht, sondern eine offene Frage:
 *
 *   Ultraleaps aktuelle Software (Hyperion) unterstützt ausschließlich den
 *   Leap Motion Controller 2. Für den ersten Controller gibt es auf dem Pi nur
 *   das Legacy-SDK von 2014 als 32-Bit-Binärdatei - ob das auf einem heutigen
 *   64-Bit-System läuft, entscheidet erst der Versuch. Klappt es nicht, ist
 *   ein APDS-9960 für 8 Euro die Alternative, und der ist noch dazu keine
 *   Kamera.
 *
 * Solange das offen ist, wäre es falsch, den Sensor in die Anzeige
 * einzubauen. Ein Anbieter liefert normalisierte Ereignisse - mehr nicht.
 */

/** Die Gesten, die der Rest der Anwendung kennt. */
const GESTURES = [
  'swipe_left', 'swipe_right', 'swipe_up', 'swipe_down',
  'push', 'palm_hold', 'grab', 'pinch',
  'hand_present', 'hand_lost'
];

class InputProvider {
  /**
   * @param config  Modul-Konfiguration
   * @param emit    (event) => void, wird bei jeder erkannten Geste gerufen
   */
  constructor(config = {}, emit = () => {}) {
    this.config = config;
    this.emit = emit;
    this.connected = false;
  }

  async start() {}
  async stop() {}

  getStatus() {
    return { connected: this.connected, detail: null };
  }

  /** Baut ein normalisiertes Ereignis - der einzige Weg nach draußen. */
  buildEvent(gesture, extra = {}) {
    if (!GESTURES.includes(gesture)) {
      throw new Error(`Unbekannte Geste: ${gesture}`);
    }

    return {
      type: 'gesture',
      gesture,
      confidence: extra.confidence ?? 1,
      hand: extra.hand || 'unknown',
      position: extra.position || null,
      source: this.constructor.providerName || 'unknown',
      ts: Date.now()
    };
  }
}

module.exports = { InputProvider, GESTURES };
