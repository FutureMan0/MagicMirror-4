const { InputProvider } = require('./base');

/**
 * Anbieter ohne Hardware.
 *
 * Damit lässt sich der gesamte Gesten-Weg bauen, prüfen und vorführen, bevor
 * überhaupt entschieden ist, welcher Sensor es wird - und ohne dass jemand vor
 * dem Spiegel steht und wedelt, um eine Zuordnung zu testen.
 *
 * Ausgelöst wird über POST /api/input/test.
 */
class MockProvider extends InputProvider {
  static providerName = 'mock';

  async start() {
    this.connected = true;
  }

  async stop() {
    this.connected = false;
  }

  /** Löst eine Geste aus, als käme sie von einem Sensor. */
  trigger(gesture, extra = {}) {
    if (!this.connected) throw new Error('Der Anbieter läuft nicht.');
    const event = this.buildEvent(gesture, extra);
    this.emit(event);
    return event;
  }

  getStatus() {
    return {
      connected: this.connected,
      detail: 'Ohne Hardware - Gesten über POST /api/input/test auslösen.'
    };
  }
}

module.exports = { MockProvider };
