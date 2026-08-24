/**
 * Privatsphäre als Zustand der Anwendung, nicht als Kniff je Modul.
 *
 * Der Spiegel hängt in einem Bad mit Dusche. Das bedeutet dreierlei, und die
 * drei Dinge werden oft verwechselt:
 *
 *   1. **Inhalt.** Ein Gast im Raum soll nicht den Stundenplan sehen.
 *   2. **Sensoren.** Eine Kamera in einem Raum, in dem geduscht wird, ist ein
 *      Problem für sich - unabhängig davon, was auf dem Bildschirm steht.
 *   3. **Praktisches.** Beim Duschen beschlägt der Spiegel, und man ist nass.
 *      Eine riesige Uhr ist dann nützlicher als eine Stundentafel.
 *
 * Jedes Modul erklärt in seinem Manifest, wie heikel sein Inhalt ist. Der
 * Renderer blendet danach aus - über ein Attribut, nicht über Neuaufbau.
 *
 * Fail-safe: ein Modul OHNE Angabe gilt als "sensitive". Neue Module sind
 * damit privat, bis jemand sie ausdrücklich freigibt - nie umgekehrt.
 */

const MODES = ['normal', 'guest', 'shower', 'off'];

const DEFAULT_LEVELS = {
  normal: ['public', 'personal', 'sensitive'],
  guest: ['public'],
  shower: ['public'],
  off: []
};

class PrivacyManager {
  constructor({ bus, getConfig, saveMode = null, log = console }) {
    this.bus = bus;
    this.getConfig = getConfig;
    this.saveMode = saveMode;
    this.log = log;

    this.mode = 'normal';
    this.since = Date.now();
    this.revertTimer = null;
    this.sensorControl = null;
  }

  /** Der Sensor-Abschalter wird nachgereicht, weil er Hardware kennt. */
  attachSensorControl(control) {
    this.sensorControl = control;
  }

  /**
   * Bildschirmsteuerung für `shower.display: "off"`. Optional: ohne sie
   * bleibt der Duschmodus rein optisch, statt gar nicht zu funktionieren.
   */
  attachDisplayControl(control) {
    this.displayControl = control;
  }

  settings() {
    const config = this.getConfig() || {};
    const privacy = config.privacy || {};
    return {
      levels: { ...DEFAULT_LEVELS, ...(privacy.levels || {}) },
      guest: { autoRevertMinutes: 30, ...(privacy.guest || {}) },
      shower: {
        trigger: 'auto',
        zone: { minDistanceCm: 0, maxDistanceCm: 120 },
        dwellSeconds: 20,
        exitDelaySeconds: 60,
        display: 'clock',
        dimOpacity: 0.35,
        sensorHardOff: true,
        ...(privacy.shower || {})
      },
      defaultMode: privacy.default || 'normal'
    };
  }

  state() {
    const settings = this.settings();
    return {
      mode: this.mode,
      since: this.since,
      visibleLevels: settings.levels[this.mode] || [],
      expiresAt: this.revertAt || null,
      sensor: this.sensorControl ? this.sensorControl.status() : null
    };
  }

  /**
   * Wechselt den Zustand.
   *
   * Reihenfolge ist bedeutsam: der Sensor wird abgeschaltet, BEVOR sich am
   * Bildschirm etwas ändert. Andersherum gäbe es einen Moment, in dem der
   * Spiegel schon "privat" aussieht, die Kamera aber noch läuft - genau der
   * falsche Eindruck.
   */
  async setMode(mode, { ttlMinutes = null, reason = 'manuell' } = {}) {
    if (!MODES.includes(mode)) {
      throw new Error(`Unbekannter Zustand: ${mode}`);
    }

    if (mode === this.mode) return this.state();

    const settings = this.settings();
    const needsSensorOff = mode !== 'normal' && settings.shower.sensorHardOff !== false;

    if (this.sensorControl) {
      if (needsSensorOff) await this.sensorControl.disable(`Privatsphäre: ${mode}`);
      else await this.sensorControl.enable();
    }

    // Der Bildschirm folgt erst, wenn der Sensor bereits aus ist - dieselbe
    // Reihenfolge wie beim Sensor selbst: nie so aussehen, als wäre es
    // privat, solange es das noch nicht ist.
    if (this.displayControl) {
      const wantsOff = mode === 'shower' && settings.shower.display === 'off';
      await this.displayControl.set(!wantsOff);
    }

    this.mode = mode;
    this.since = Date.now();
    this.log.log?.(`Privatsphäre: ${mode} (${reason})`);

    clearTimeout(this.revertTimer);
    this.revertTimer = null;
    this.revertAt = null;

    // Der Gästemodus soll sich nicht dauerhaft festsetzen: wer ihn abends
    // einschaltet, will ihn am nächsten Morgen nicht noch vorfinden.
    const minutes = ttlMinutes ?? (mode === 'guest' ? settings.guest.autoRevertMinutes : null);
    if (minutes && minutes > 0) {
      this.revertAt = Date.now() + minutes * 60000;
      this.revertTimer = setTimeout(() => {
        this.setMode(settings.defaultMode, { reason: 'Zeit abgelaufen' }).catch(() => {});
      }, minutes * 60000);
      this.revertTimer.unref?.();
    }

    if (this.saveMode) this.saveMode(mode);
    this.publish();

    return this.state();
  }

  publish() {
    if (this.bus) this.bus.emit('privacy:changed', this.state());
  }

  /**
   * Meldung des Anwesenheitssensors, dass jemand in der Duschzone steht.
   * Der Sensor entscheidet nicht selbst - es gibt genau einen Besitzer des
   * Zustands.
   */
  async reportShowerZone(inZone) {
    const settings = this.settings();
    if (settings.shower.trigger !== 'auto') return;

    if (inZone && this.mode === 'normal') {
      await this.setMode('shower', { reason: 'Duschzone erkannt' });
    } else if (!inZone && this.mode === 'shower') {
      await this.setMode(settings.defaultMode, { reason: 'Duschzone verlassen' });
    }
  }

  stop() {
    clearTimeout(this.revertTimer);
    this.revertTimer = null;
  }
}

/**
 * Entscheidet, ob ein Modul in einem Zustand sichtbar ist.
 * Ohne Angabe gilt es als heikel - siehe Fail-safe oben.
 */
function isVisible(privacyLevel, visibleLevels) {
  return visibleLevels.includes(privacyLevel || 'sensitive');
}

module.exports = { PrivacyManager, MODES, DEFAULT_LEVELS, isVisible };
