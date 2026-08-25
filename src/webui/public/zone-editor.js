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
            this.macheZiehbar(chip, modul.module);
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
        this.macheZiehbar(zeile, modul.module);
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
        : this.text('zoneHint', 'Modul in eine Zone ziehen — oder antippen, dann die Zone.');
      fuss.appendChild(hinweis);

      const speichern = document.createElement('button');
      speichern.className = 'btn-primary zonen-speichern';
      speichern.textContent = this.text('save', 'Speichern');
      speichern.disabled = !this.entwurf;
      speichern.addEventListener('click', () => this.speichere());
      fuss.appendChild(speichern);

      return fuss;
    }

    /**
     * Ziehen und Antippen in einer Geste.
     *
     * Pointer Events statt HTML5-Drag-and-Drop: letzteres gibt es auf
     * Touchgeraeten nicht. Wer nur tippt, waehlt aus; wer zieht, legt direkt
     * ab. Beides muss gehen - am Rechner zieht man, am Handy tippt man
     * lieber, und mit dem Finger zu ziehen soll trotzdem klappen.
     */
    macheZiehbar(element, modulName) {
      element.style.touchAction = 'none';

      element.addEventListener('pointerdown', (start) => {
        if (start.button !== undefined && start.button !== 0) return;

        let gezogen = false;
        let geist = null;
        let letzteZone = null;

        const bewegen = (e) => {
          const weit = Math.hypot(e.clientX - start.clientX, e.clientY - start.clientY);
          if (!gezogen && weit < 8) return;   // ein Wackler ist kein Ziehen

          if (!gezogen) {
            gezogen = true;
            element.setPointerCapture?.(e.pointerId);
            geist = this.baueGeist(element, e);
          }

          geist.style.left = `${e.clientX}px`;
          geist.style.top = `${e.clientY}px`;

          const zone = this.zoneUnter(e.clientX, e.clientY);
          if (zone !== letzteZone) {
            this.hebeHervor(zone);
            letzteZone = zone;
          }
        };

        const loslassen = (e) => {
          element.removeEventListener('pointermove', bewegen);
          element.removeEventListener('pointerup', loslassen);
          element.removeEventListener('pointercancel', loslassen);

          geist?.remove();
          this.hebeHervor(null);

          if (!gezogen) {
            e.stopPropagation();
            // Reines Antippen: markieren, dann Zone antippen.
            this.markiert = this.markiert === modulName ? null : modulName;
            this.zeichne();
            return;
          }

          const zone = this.zoneUnter(e.clientX, e.clientY);
          if (zone) {
            this.markiert = modulName;
            this.zoneGewaehlt(zone);
          }
        };

        element.addEventListener('pointermove', bewegen);
        element.addEventListener('pointerup', loslassen);
        element.addEventListener('pointercancel', loslassen);
      });
    }

    /** Ein Abbild, das am Finger klebt - sonst zieht man ins Nichts. */
    baueGeist(element, e) {
      const geist = document.createElement('div');
      geist.className = 'zonen-geist';
      geist.textContent = element.textContent;
      geist.style.left = `${e.clientX}px`;
      geist.style.top = `${e.clientY}px`;
      document.body.appendChild(geist);
      return geist;
    }

    /** Welche Zone liegt unter diesem Punkt? */
    zoneUnter(x, y) {
      for (const feld of this.wurzel.querySelectorAll('.zonen-feld')) {
        const r = feld.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          return feld.dataset.zone;
        }
      }
      return null;
    }

    hebeHervor(id) {
      for (const feld of this.wurzel.querySelectorAll('.zonen-feld')) {
        feld.classList.toggle('zonen-ziel', feld.dataset.zone === id);
      }
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
