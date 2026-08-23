// Modul-SDK.
//
// Der bisherige Vertrag war eine Klasse mit constructor/render/destroy und
// sonst nichts. Alles Weitere musste jedes Modul selbst mitbringen: die
// API-Basis-URL ausrechnen, Timer verwalten, HTML escapen, aufräumen. Das ging
// wiederholt schief - ein vergessenes clearInterval ließ die Uhr im
// Sekundentakt weiterlaufen, ein relativer fetch landete unter file:// im
// Nichts.
//
// MMModule nimmt diese Dinge ab. Der alte Vertrag bleibt gültig: Module ohne
// Basisklasse laufen unverändert weiter.
(function () {
  /**
   * Verwaltet Timer eines Moduls und räumt sie beim Zerstören ab.
   *
   * Damit ist die Fehlerklasse "vergessenes clearInterval" strukturell
   * erledigt, nicht durch Disziplin.
   */
  class Timers {
    constructor() {
      this.intervals = new Set();
      this.timeouts = new Set();
      this.frames = new Set();
    }

    every(ms, callback) {
      const id = setInterval(callback, ms);
      this.intervals.add(id);
      return () => {
        clearInterval(id);
        this.intervals.delete(id);
      };
    }

    after(ms, callback) {
      const id = setTimeout(() => {
        this.timeouts.delete(id);
        callback();
      }, ms);
      this.timeouts.add(id);
      return () => {
        clearTimeout(id);
        this.timeouts.delete(id);
      };
    }

    frame(callback) {
      const id = requestAnimationFrame((timestamp) => {
        this.frames.delete(id);
        callback(timestamp);
      });
      this.frames.add(id);
      return () => {
        cancelAnimationFrame(id);
        this.frames.delete(id);
      };
    }

    clearAll() {
      this.intervals.forEach(clearInterval);
      this.timeouts.forEach(clearTimeout);
      this.frames.forEach(cancelAnimationFrame);
      this.intervals.clear();
      this.timeouts.clear();
      this.frames.clear();
    }
  }

  /** Kleiner HTTP-Helfer mit bereits aufgelöster Basis-URL. */
  function createHttp(moduleName) {
    // Unter file:// müssen Anfragen an den Server absolut adressiert werden -
    // ein relativer Pfad landet sonst auf file:///api/...
    const base = (typeof window !== 'undefined' && window.location.protocol === 'file:')
      ? 'http://localhost:3000'
      : '';

    async function request(method, endpoint, body) {
      const response = await fetch(`${base}${endpoint}`, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });

      if (!response.ok) {
        const error = new Error(`${moduleName}: ${method} ${endpoint} -> HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }

      return response.status === 204 ? null : response.json();
    }

    return {
      base,
      get: (endpoint) => request('GET', endpoint),
      post: (endpoint, body) => request('POST', endpoint, body)
    };
  }

  class MMModule {
    /** Config-Schlüssel, deren Änderung keinen Neuaufbau erzwingt. */
    static patchable = [];

    constructor(config = {}) {
      this.config = config;
      this.name = this.constructor.moduleName || 'module';

      this.timers = new Timers();
      this.http = createHttp(this.name);
      this.bus = (typeof window !== 'undefined' && window.mmBus) || null;
      this.html = (typeof window !== 'undefined' && window.mmHtml) || null;

      this.container = null;
      this._subscriptions = [];
      this._updateScheduled = false;
      this._destroyed = false;
    }

    /** Namensraum-Logger, damit im Log erkennbar ist, wer spricht. */
    log(...args) {
      console.log(`[${this.name}]`, ...args);
    }

    logError(...args) {
      console.error(`[${this.name}]`, ...args);
    }

    /** Bus-Abo, das beim Zerstören automatisch endet. */
    subscribe(pattern, listener) {
      if (!this.bus) return () => {};
      const off = this.bus.on(pattern, listener);
      this._subscriptions.push(off);
      return off;
    }

    /**
     * Bittet um eine Aktualisierung. Mehrere Aufrufe in einem Frame werden zu
     * einer zusammengefasst - ein Modul kann also bedenkenlos bei jedem
     * eintreffenden Datenpunkt aufrufen.
     */
    requestUpdate() {
      if (this._updateScheduled || this._destroyed) return;
      this._updateScheduled = true;

      this.timers.frame(() => {
        this._updateScheduled = false;
        if (this._destroyed) return;
        try {
          this.update();
        } catch (error) {
          this.logError('update() ist gescheitert:', error);
        }
      });
    }

    // ---- Von Modulen zu überschreiben ----------------------------------

    /** Asynchrone Vorbereitung ohne DOM. */
    async init() {}

    /** Liefert genau ein Element - oder null für ein Modul ohne Anzeige. */
    render() {
      return null;
    }

    /** Aktualisiert die bestehende Anzeige, ohne sie neu aufzubauen. */
    update() {}

    /**
     * Entscheidet, ob eine Konfigurationsänderung ohne Neuaufbau auskommt.
     * Standard: nur wenn ausschließlich als `patchable` erklärte Schlüssel
     * betroffen sind.
     */
    onConfigChange(_nextConfig, changedKeys = []) {
      const patchable = this.constructor.patchable || [];
      return changedKeys.every((key) => patchable.includes(key)) ? 'patch' : 'rebuild';
    }

    // ---- Vom Host aufgerufen -------------------------------------------

    destroy() {
      this._destroyed = true;
      this.timers.clearAll();
      this._subscriptions.forEach((off) => off());
      this._subscriptions = [];
      this.container = null;
    }
  }

  if (typeof window !== 'undefined') {
    window.MMModule = MMModule;
    window.MMTimers = Timers;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MMModule, Timers, createHttp };
  }
})();
