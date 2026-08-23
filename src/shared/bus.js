/**
 * Ein sehr kleiner Ereignis-Bus mit Platzhalter-Themen.
 *
 * Bisher gab es gar keinen: Der Hauptprozess schickte einzelne IPC-Kanäle an
 * den Renderer, der WebSocket-Server sendete an niemanden, und Module fragten
 * sich gegenseitig per HTTP im Sekundentakt ab. Ein Bus ersetzt das durch
 * "wer etwas weiß, sagt es; wer es braucht, hört zu".
 *
 * Themen sind mit Doppelpunkt gegliedert und lassen sich mit `*` abonnieren:
 *
 *   presence:changed          genau dieses Thema
 *   presence:*                alles unterhalb von presence
 *   *                         alles
 *
 * Bewusst ohne Abhängigkeiten und ohne Node-EventEmitter, damit dieselbe
 * Datei im Browser und im Hauptprozess läuft.
 */
class Bus {
  constructor({ name = 'bus', onError = null } = {}) {
    this.name = name;
    this.listeners = new Map();
    this.onError = onError || ((error, topic) => {
      console.error(`[${this.name}] Fehler im Zuhörer für "${topic}":`, error);
    });
  }

  static matches(pattern, topic) {
    if (pattern === '*' || pattern === topic) return true;
    if (!pattern.endsWith(':*')) return false;
    return topic.startsWith(pattern.slice(0, -1));
  }

  /** Meldet einen Zuhörer an und liefert die Abmeldefunktion zurück. */
  on(pattern, listener) {
    if (!this.listeners.has(pattern)) this.listeners.set(pattern, new Set());
    this.listeners.get(pattern).add(listener);

    return () => this.off(pattern, listener);
  }

  once(pattern, listener) {
    const unsubscribe = this.on(pattern, (payload, topic) => {
      unsubscribe();
      listener(payload, topic);
    });
    return unsubscribe;
  }

  off(pattern, listener) {
    const set = this.listeners.get(pattern);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) this.listeners.delete(pattern);
  }

  /**
   * Sendet ein Ereignis. Ein fehlerhafter Zuhörer darf die übrigen nicht
   * mitreißen - deshalb wird jeder einzeln abgesichert.
   */
  emit(topic, payload) {
    let delivered = 0;

    for (const [pattern, set] of this.listeners) {
      if (!Bus.matches(pattern, topic)) continue;

      for (const listener of [...set]) {
        delivered += 1;
        try {
          listener(payload, topic);
        } catch (error) {
          this.onError(error, topic);
        }
      }
    }

    return delivered;
  }

  /** Nur für Tests und Aufräumarbeiten. */
  clear() {
    this.listeners.clear();
  }
}

// Läuft in beiden Welten: im Hauptprozess per require, im Renderer als
// <script>. Deshalb beide Ausgänge, jeweils abgesichert.
if (typeof window !== 'undefined') {
  window.MMBusModule = { Bus };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Bus };
}
