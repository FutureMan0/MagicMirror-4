// Basisklasse für Module, die Daten von ihrem eigenen Backend anzeigen.
//
// Was jedes solche Modul sonst selbst schreiben müsste - und wobei es jedes
// Mal dieselben Lücken gibt:
//
//   * Anfangs steht nichts da. Ein leerer Kasten ist von "kaputt" nicht zu
//     unterscheiden, also braucht es eine Ladeanzeige.
//   * Fehler müssen sichtbar sein, aber nicht laut. Ein Spiegel, auf dem in
//     roter Schrift ein Stacktrace steht, ist schlimmer als einer, der die
//     letzten bekannten Werte zeigt.
//   * Veraltete Daten müssen als solche erkennbar sein - sonst hält man einen
//     zwei Stunden alten Wert für aktuell.
//   * Aufräumen beim Entfernen.
//
// Ein Modul auf dieser Basis implementiert nur noch renderData().
(function () {
  const Base = (typeof window !== 'undefined' && window.MMModule) || class {};

  class DataModule extends Base {
    constructor(config = {}) {
      super(config);

      this.data = null;
      this.envelope = null;
      this.root = null;
      this.statusElement = null;
    }

    // ---- Von Modulen zu setzen -----------------------------------------

    /** Endpunkt des eigenen Backends. */
    get endpoint() {
      return `/api/${this.constructor.moduleName}/data`;
    }

    /** Bus-Thema, unter dem das Backend meldet. */
    get topic() {
      return `data:${this.constructor.moduleName}`;
    }

    /** Überschrift des Moduls - optional. */
    get title() {
      return null;
    }

    /** Baut die Anzeige aus den Daten. Das Einzige, was ein Modul braucht. */
    renderData() {
      throw new Error(`${this.constructor.moduleName}: renderData() fehlt`);
    }

    // ---- Ablauf ----------------------------------------------------------

    async init() {
      // Der erste Stand kommt direkt vom Backend; danach meldet der Bus.
      try {
        this.applyEnvelope(await this.http.get(this.endpoint));
      } catch (error) {
        this.logError('Erstabruf fehlgeschlagen:', error.message);
        this.envelope = { ok: false, error: { message: error.message } };
      }
    }

    render() {
      this.container = document.createElement('div');
      this.container.className = `module-${this.constructor.moduleName} dm-module`;

      if (this.title) {
        const heading = document.createElement('div');
        heading.className = 'dm-title';
        heading.textContent = this.title;
        this.container.appendChild(heading);
      }

      this.statusElement = document.createElement('div');
      this.statusElement.className = 'dm-status';
      this.container.appendChild(this.statusElement);

      this.root = document.createElement('div');
      this.root.className = 'dm-body';
      this.container.appendChild(this.root);

      this.subscribe(this.topic, (envelope) => {
        this.applyEnvelope(envelope);
        this.requestUpdate();
      });

      // Ohne Bus - etwa in einem einfachen Browser - selbst nachfassen.
      if (!this.bus) {
        const interval = Math.max(this.config.updateInterval || 300000, 30000);
        this.timers.every(interval, () => this.reload());
      }

      this.update();
      return this.container;
    }

    async reload() {
      try {
        this.applyEnvelope(await this.http.get(this.endpoint));
        this.requestUpdate();
      } catch (error) {
        this.logError('Nachladen fehlgeschlagen:', error.message);
      }
    }

    applyEnvelope(envelope) {
      if (!envelope) return;
      this.envelope = envelope;
      // Auch bei einem Fehler die letzten bekannten Daten behalten - ein
      // leerer Spiegel ist schlechter als leicht veraltete Werte.
      if (envelope.data !== undefined && envelope.data !== null) {
        this.data = envelope.data;
      }
    }

    update() {
      if (!this.root) return;

      this.renderStatus();

      if (this.data === null || this.data === undefined) {
        this.renderPlaceholder();
        return;
      }

      try {
        this.renderData(this.data, this.root);
      } catch (error) {
        this.logError('Anzeige fehlgeschlagen:', error);
        this.root.textContent = '';
        this.root.appendChild(this.buildNotice('dm-error', this.text('renderFailed')));
      }
    }

    /**
     * Zeile über dem Inhalt: nichts, wenn alles frisch ist. Sichtbar nur,
     * wenn es etwas zu wissen gibt.
     */
    renderStatus() {
      const envelope = this.envelope;
      this.statusElement.textContent = '';
      this.statusElement.hidden = true;

      if (!envelope) return;

      if (!envelope.ok && envelope.error) {
        this.statusElement.hidden = false;
        this.statusElement.className = 'dm-status dm-status-error';
        this.statusElement.textContent = this.data
          // Es gibt noch Daten - der Fehler ist eine Randnotiz, kein Drama.
          ? this.text('unreachable') + this.formatAge(envelope.fetchedAt)
          : this.fehlerText(envelope.error);
        return;
      }

      if (envelope.stale && envelope.fetchedAt) {
        this.statusElement.hidden = false;
        this.statusElement.className = 'dm-status dm-status-stale';
        this.statusElement.textContent = this.text('asOf') + this.formatAge(envelope.fetchedAt);
      }
    }

    /**
     * Der Fehler als Satz. Bewusst hier und nicht nur in MMModule: DataModule
     * wird in Tests ohne geladenes SDK gebaut, und dann darf es nicht auf eine
     * Methode der Basisklasse zeigen, die es nicht gibt.
     */
    /** Die eingestellte Sprache des Spiegels. */
    get sprache() {
      return this.config?.language || 'de';
    }

    /** Ein fester Rahmentext in der eingestellten Sprache. */
    text(schluessel, werte) {
      const uebersetzen = typeof window !== 'undefined' && window.mmUiText;
      return uebersetzen ? uebersetzen(schluessel, this.sprache, werte) : '';
    }

    fehlerText(error) {
      if (typeof this.humanError === 'function') return this.humanError(error);

      const uebersetzen = typeof window !== 'undefined' && window.mmHumanError;
      if (uebersetzen) return uebersetzen(error, this.sprache);
      return this.sprache === 'en' ? 'Temporarily unavailable' : 'Vorübergehend nicht verfügbar';
    }

    renderPlaceholder() {
      this.root.textContent = '';

      const failed = this.envelope && !this.envelope.ok;
      if (failed) {
        this.root.appendChild(this.buildNotice('dm-error', this.fehlerText(this.envelope.error)));
        return;
      }

      // Skelett statt Spinner: es zeigt, wie viel gleich kommt, und springt
      // beim Eintreffen der Daten nicht.
      const skeleton = document.createElement('div');
      skeleton.className = 'dm-skeleton';
      for (let i = 0; i < 3; i += 1) {
        skeleton.appendChild(document.createElement('span'));
      }
      this.root.appendChild(skeleton);
    }

    buildNotice(className, text) {
      const notice = document.createElement('div');
      notice.className = className;
      notice.textContent = text;
      return notice;
    }

    formatAge(timestamp) {
      if (!timestamp) return this.text('ageUnknown');

      const minutes = Math.floor((Date.now() - timestamp) / 60000);
      if (minutes < 1) return this.text('ageNow');
      if (minutes < 60) return this.text('ageMinutes', { n: minutes });

      const hours = Math.floor(minutes / 60);
      if (hours < 24) return this.text('ageHours', { n: hours });
      return this.text('ageDays', { n: Math.floor(hours / 24) });
    }

    destroy() {
      if (super.destroy) super.destroy();
      this.root = null;
      this.statusElement = null;
    }
  }

  if (typeof window !== 'undefined') {
    window.DataModule = DataModule;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DataModule };
  }
})();
