(function () {
  /**
   * Layout über Zonen.
   *
   * Der alte Editor war eine 8×10-Leinwand. Auf einem 390 Pixel breiten
   * Telefon sind das Zellen von 35 Pixeln — man trifft sie nicht, und wer
   * trifft, baut sich meist etwas Unaufgeräumtes. Statt Millimeterarbeit gibt
   * es jetzt sieben Zonen und pro Modul eine Auswahl.
   *
   * Zwei Dinge, die den Unterschied machen:
   *
   *  * **Die Vorschau ist die Bedienung.** Eine Zone antippen wählt sie für
   *    das gerade markierte Modul aus. Man sieht sofort, wo es landet.
   *  * **Es wird nicht sofort gespeichert.** Änderungen sammeln sich, bis man
   *    „Speichern" antippt — sonst zuckt der Spiegel an der Wand bei jedem
   *    Fingertipp.
   */

  const ZONEN_LAYOUT = [
    ['oben-links', 'oben-mitte', 'oben-rechts'],
    ['links', 'mitte', 'rechts'],
    ['unten']
  ];

  class ZonenEditor {
    constructor(selektor, config, beimSpeichern) {
      this.wurzel = document.querySelector(selektor);
      this.config = config;
      this.beimSpeichern = beimSpeichern;
      this.entwurf = null;
      this.markiert = null;

      if (this.wurzel) this.zeichne();
    }

    updateConfig(config) {
      this.config = config;
      // Ein laufender Entwurf hat Vorrang: sonst verwirft ein Ereignis von
      // aussen die gerade begonnene Aenderung.
      if (!this.entwurf) this.zeichne();
    }

    /** Module, die auf dem Spiegel erscheinen können. */
    module() {
      return (this.config?.modules || []).filter(m => m.enabled !== false);
    }

    /** Die aktuell gewählte Zone eines Moduls. */
    zoneVon(modul) {
      const zonen = window.MMZonen;
      const id = zonen.alsZone(this.entwurf?.[modul.module] ?? modul.position);
      return id || null;
    }

    sprache() {
      return typeof getCurrentLanguage === 'function' ? getCurrentLanguage() : 'de';
    }

    text(schluessel, rueckfall) {
      return typeof t === 'function' ? (t(schluessel) || rueckfall) : rueckfall;
    }

    zeichne() {
      const zonen = window.MMZonen;
      if (!this.wurzel || !zonen) return;

      this.wurzel.textContent = '';
      this.wurzel.appendChild(this.baueVorschau());
      this.wurzel.appendChild(this.baueListe());
      this.wurzel.appendChild(this.baueFusszeile());
    }

    /** Der Spiegel im Kleinen. Zonen sind antippbar. */
    baueVorschau() {
      const zonen = window.MMZonen;
      const rahmen = document.createElement('div');
      rahmen.className = 'zonen-vorschau';

      for (const reihe of ZONEN_LAYOUT) {
        const zeile = document.createElement('div');
        zeile.className = 'zonen-reihe';
        if (reihe.length === 1) zeile.classList.add('zonen-reihe-breit');

        for (const id of reihe) {
          const feld = document.createElement('button');
          feld.type = 'button';
          feld.className = 'zonen-feld';
          feld.dataset.zone = id;

          const name = document.createElement('span');
          name.className = 'zonen-feld-name';
          name.textContent = zonen.zonenLabel(id, this.sprache());
          feld.appendChild(name);

          for (const modul of this.module()) {
            if (this.zoneVon(modul) !== id) continue;
            const chip = document.createElement('span');
            chip.className = 'zonen-chip';
            if (this.markiert === modul.module) chip.classList.add('markiert');
            chip.textContent = this.modulName(modul);
            feld.appendChild(chip);
          }

          feld.addEventListener('click', () => this.zoneGewaehlt(id));
          zeile.appendChild(feld);
        }
        rahmen.appendChild(zeile);
      }
      return rahmen;
    }

    modulName(modul) {
      const info = window.moduleInfoCache?.[modul.module]?.info;
      const anzeige = info?.displayName;
      if (!anzeige) return modul.module;
      if (typeof anzeige === 'string') return anzeige;
      return anzeige[this.sprache()] || anzeige.de || modul.module;
    }

    /** Ein Modul markieren, dann eine Zone antippen. */
    baueListe() {
      const liste = document.createElement('div');
      liste.className = 'zonen-liste';

      for (const modul of this.module()) {
        const zeile = document.createElement('button');
        zeile.type = 'button';
        zeile.className = 'zonen-listenzeile';
        if (this.markiert === modul.module) zeile.classList.add('markiert');

        const name = document.createElement('span');
        name.className = 'zonen-listenname';
        name.textContent = this.modulName(modul);

        const wo = document.createElement('span');
        wo.className = 'zonen-listenzone';
        const id = this.zoneVon(modul);
        wo.textContent = id
          ? window.MMZonen.zonenLabel(id, this.sprache())
          : this.text('zoneFrei', 'Freie Position');

        zeile.append(name, wo);
        zeile.addEventListener('click', () => {
          this.markiert = this.markiert === modul.module ? null : modul.module;
          this.zeichne();
        });
        liste.appendChild(zeile);
      }
      return liste;
    }

    baueFusszeile() {
      const fuss = document.createElement('div');
      fuss.className = 'zonen-fusszeile';

      const hinweis = document.createElement('p');
      hinweis.className = 'zonen-hinweis';
      hinweis.textContent = this.markiert
        ? this.text('zoneTapZone', 'Jetzt eine Zone antippen.')
        : this.text('zoneTapModule', 'Ein Modul antippen, dann eine Zone.');
      fuss.appendChild(hinweis);

      const speichern = document.createElement('button');
      speichern.className = 'btn-primary zonen-speichern';
      speichern.textContent = this.text('save', 'Speichern');
      speichern.disabled = !this.entwurf;
      speichern.addEventListener('click', () => this.speichere());
      fuss.appendChild(speichern);

      return fuss;
    }

    zoneGewaehlt(id) {
      if (!this.markiert) return;
      this.entwurf = { ...(this.entwurf || {}), [this.markiert]: id };
      this.markiert = null;
      this.zeichne();
    }

    async speichere() {
      if (!this.entwurf) return;

      const neu = {
        ...this.config,
        modules: this.config.modules.map(m =>
          this.entwurf[m.module] ? { ...m, position: this.entwurf[m.module] } : m
        )
      };

      this.entwurf = null;
      await this.beimSpeichern(neu);
      this.config = neu;
      this.zeichne();
    }
  }

  if (typeof window !== 'undefined') window.ZonenEditor = ZonenEditor;
})();
