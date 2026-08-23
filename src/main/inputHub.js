const { MockProvider } = require('./inputProviders/mock');

/**
 * Verteilt Gesten-Ereignisse.
 *
 * Hier liegen die Regeln, die jeder Anbieter sonst selbst befolgen müsste -
 * und von denen jeder eine andere Auslegung hätte:
 *
 *  - **Sperrzeit.** Ein Sensor liefert eine Wischbewegung leicht mehrfach.
 *    Ohne Sperre schaltet der Spiegel drei Seiten weiter statt einer.
 *  - **Mindestsicherheit.** Eine halb erkannte Geste ist schlimmer als keine:
 *    was von selbst passiert, wirkt kaputt.
 *  - **Privatsphäre.** Bei aktivem Gäste- oder Duschmodus wird der Anbieter
 *    gar nicht erst gestartet. Ein Kamera-Sensor, der "nur zuhört", ist genau
 *    das, was hier niemand will.
 */

const PROVIDERS = {
  mock: MockProvider
  // leapLegacy und apds9960 kommen dazu, sobald die Hardware feststeht.
};

class InputHub {
  constructor({ bus, getConfig, getPrivacyMode, log = console }) {
    this.bus = bus;
    this.getConfig = getConfig;
    this.getPrivacyMode = getPrivacyMode;
    this.log = log;

    this.provider = null;
    this.providerName = 'none';
    this.lastGesture = null;
    this.lastAt = 0;
    this.counts = {};
  }

  settings() {
    const config = this.getConfig() || {};
    return {
      enabled: false,
      provider: 'none',
      cooldownMs: 400,
      minConfidence: 0.6,
      bindings: {},
      ...(config.input || {})
    };
  }

  async start() {
    const settings = this.settings();

    if (!settings.enabled) {
      this.log.log?.('Gesten: nicht eingeschaltet.');
      return;
    }

    // Bei eingeschränkter Privatsphäre gar nicht erst starten.
    if (this.getPrivacyMode() !== 'normal') {
      this.log.log?.('Gesten: wegen Privatsphäre-Modus nicht gestartet.');
      return;
    }

    const Provider = PROVIDERS[settings.provider];
    if (!Provider) {
      this.log.warn?.(`Gesten: unbekannter Anbieter "${settings.provider}".`);
      return;
    }

    this.provider = new Provider(settings[settings.provider] || {}, (event) => this.handle(event));
    this.providerName = settings.provider;

    await this.provider.start();
    this.log.log?.(`Gesten: Anbieter "${settings.provider}" läuft.`);
  }

  async stop() {
    if (!this.provider) return;
    await this.provider.stop();
    this.provider = null;
    this.providerName = 'none';
  }

  /** Beim Wechsel der Privatsphäre neu entscheiden. */
  async onPrivacyChange(mode) {
    if (mode !== 'normal') await this.stop();
    else if (!this.provider) await this.start();
  }

  handle(event) {
    const settings = this.settings();

    if (event.confidence < settings.minConfidence) return;

    // Sperrzeit gilt je Geste: schnell hintereinander links und rechts zu
    // wischen ist eine gültige Eingabe, zweimal links meist nicht.
    const now = Date.now();
    if (event.gesture === this.lastGesture && now - this.lastAt < settings.cooldownMs) {
      return;
    }

    this.lastGesture = event.gesture;
    this.lastAt = now;
    this.counts[event.gesture] = (this.counts[event.gesture] || 0) + 1;

    const action = settings.bindings[event.gesture] || null;
    if (this.bus) this.bus.emit('input:gesture', { ...event, action });
  }

  status() {
    return {
      provider: this.providerName,
      running: Boolean(this.provider),
      connected: this.provider ? this.provider.getStatus().connected : false,
      detail: this.provider ? this.provider.getStatus().detail : null,
      lastGesture: this.lastGesture,
      lastAt: this.lastAt || null,
      counts: { ...this.counts },
      privacyMode: this.getPrivacyMode()
    };
  }

  /** Für den Mock-Anbieter und den Bindungs-Editor. */
  trigger(gesture, extra = {}) {
    if (!this.provider || typeof this.provider.trigger !== 'function') {
      throw new Error('Der aktive Anbieter lässt sich nicht von Hand auslösen.');
    }
    return this.provider.trigger(gesture, extra);
  }
}

module.exports = { InputHub, PROVIDERS };
