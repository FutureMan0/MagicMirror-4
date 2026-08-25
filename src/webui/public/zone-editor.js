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
      // Der echte Spiegel als Hintergrund. Bewusst abschaltbar: die Vorschau
      // ist ein zweiter Renderer samt aller Netzabfragen, und auf einem Pi
      // ist das nicht gratis.
      this.live = localStorage.getItem('zonenLive') === '1';

      if (this.wurzel) this.zeichne();
    }

    updateConfig(config) {
      this.config = config;
      // Ein laufender Entwurf hat Vorrang: sonst verwirft ein Ereignis von
      // aussen die gerade begonnene Aenderung.
      if (!this.entwurf && !this.entwurfAn) this.zeichne();
    }

    /** Module, die auf dem Spiegel erscheinen können. */
    module() {
      return this.alleModule().filter(m => this.istAn(m));
    }

    /** Ist das Modul sichtbar - mit noch nicht gespeicherten Änderungen? */
    istAn(modul) {
      return this.entwurfAn?.[modul.module] ?? (modul.enabled !== false);
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
      this.wurzel.appendChild(this.baueKopf());
      this.wurzel.appendChild(this.baueVorschau());
      this.wurzel.appendChild(this.baueListe());
      this.wurzel.appendChild(this.baueFusszeile());
    }

    /** Umschalter zwischen Zonen-Skizze und echtem Spiegelbild. */
    baueKopf() {
      const kopf = document.createElement('div');
      kopf.className = 'zonen-kopf';

      const hintergrund = document.createElement('button');
      hintergrund.type = 'button';
      hintergrund.className = 'zonen-liveschalter';
      hintergrund.classList.toggle('an', this.live);
      hintergrund.textContent = this.text('livePreviewBackdrop', 'Spiegel im Hintergrund');
      hintergrund.setAttribute('aria-pressed', String(this.live));
      hintergrund.addEventListener('click', () => {
        this.live = !this.live;
        localStorage.setItem('zonenLive', this.live ? '1' : '0');
        this.zeichne();
      });

      const vollbild = document.createElement('button');
      vollbild.type = 'button';
      vollbild.className = 'btn-primary zonen-vollbild';
      vollbild.textContent = this.text('livePreview', 'Live-Vorschau');
      vollbild.addEventListener('click', () => this.zeigeVollbild());

      kopf.append(hintergrund, vollbild);
      return kopf;
    }

    /** Der Spiegel im Kleinen. Zonen sind antippbar. */
    baueVorschau() {
      const zonen = window.MMZonen;
      const rahmen = document.createElement('div');
      rahmen.className = 'zonen-vorschau';
      if (this.live) rahmen.classList.add('zonen-vorschau-live');

      if (this.live) {
        // preview=1 schaltet das Praesenz-Dimmen ab - sonst sieht man ein
        // fast schwarzes Bild und haelt die Vorschau fuer kaputt.
        const instanz = window.currentInstance || 'display1';
        const rahmenLive = document.createElement('div');
        rahmenLive.className = 'zonen-live';

        const spiegel = document.createElement('iframe');
        spiegel.className = 'zonen-live-bild';
        spiegel.title = this.text('livePreview', 'Live-Vorschau');
        spiegel.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        spiegel.src = `/mirror/index.html?instance=${encodeURIComponent(instanz)}&preview=1`;

        rahmenLive.appendChild(spiegel);
        rahmen.appendChild(rahmenLive);

        // Der Faktor haengt von der Rahmenbreite ab und muss gerechnet
        // werden; in CSS gaebe es dafuer nur ungueltige Ausdruecke.
        const skaliere = () => {
          const breite = rahmen.clientWidth;
          if (breite) spiegel.style.transform = `scale(${breite / 1920})`;
        };
        requestAnimationFrame(skaliere);
        this.skalierer?.disconnect();
        this.skalierer = new ResizeObserver(skaliere);
        this.skalierer.observe(rahmen);
      }

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

    /**
     * Der Anzeigename aus dem Manifest. Ohne ihn stehen im Editor
     * Kennungen wie "clock" und "home-assistant" - in der Modulliste
     * daneben aber "Clock & Date". Zwei Namen fuer dieselbe Sache.
     */
    modulName(modul) {
      const liste = window.availableModules || [];
      const anzeige = liste.find(m => m.name === modul.module)?.info?.displayName;

      if (!anzeige) return modul.module;
      if (typeof anzeige === 'string') return anzeige;
      return anzeige[this.sprache()] || anzeige.de || modul.module;
    }

    /** Alle Module - auch die abgeschalteten, sonst kann man sie nicht zurückholen. */
    alleModule() {
      return this.config?.modules || [];
    }

    /** Ein Modul markieren, dann eine Zone antippen. Plus An/Aus je Zeile. */
    baueListe() {
      const liste = document.createElement('div');
      liste.className = 'zonen-liste';

      for (const modul of this.alleModule()) {
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

        // An/Aus gehoert hierher: wer das Layout ordnet, will ein Modul
        // wegnehmen koennen, ohne den Reiter zu wechseln.
        const schalter = document.createElement('button');
        schalter.type = 'button';
        schalter.className = 'zonen-schalter';
        schalter.classList.toggle('an', this.istAn(modul));
        schalter.setAttribute('aria-pressed', String(this.istAn(modul)));
        schalter.setAttribute('aria-label', this.modulName(modul));
        schalter.addEventListener('click', (e) => {
          e.stopPropagation();
          this.schalteModul(modul.module);
        });

        const reihe = document.createElement('div');
        reihe.className = 'zonen-listenreihe';
        if (!this.istAn(modul)) reihe.classList.add('aus');
        reihe.append(zeile, schalter);
        liste.appendChild(reihe);
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
      speichern.disabled = !this.entwurf && !this.entwurfAn;
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

    /**
     * Der Spiegel in gross - genau das, was an der Wand haengt.
     *
     * Als Overlay ueber allem, mit schwarzem Grund: ein Spiegel im
     * Briefmarkenformat sagt wenig ueber Schriftgroessen aus. Zu schliessen
     * ueber den Knopf oder Esc - wer eine Vollbildansicht oeffnet, erwartet,
     * dass Esc sie wieder schliesst.
     */
    zeigeVollbild() {
      const instanz = window.currentInstance || 'display1';

      const overlay = document.createElement('div');
      overlay.className = 'live-vollbild';

      const buehne = document.createElement('div');
      buehne.className = 'live-vollbild-buehne';

      const spiegel = document.createElement('iframe');
      spiegel.className = 'live-vollbild-bild';
      spiegel.title = this.text('livePreview', 'Live-Vorschau');
      spiegel.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      spiegel.src = `/mirror/index.html?instance=${encodeURIComponent(instanz)}&preview=1`;
      buehne.appendChild(spiegel);

      const zurueck = document.createElement('button');
      zurueck.className = 'live-vollbild-zurueck';
      zurueck.textContent = this.text('back', 'Zurück');

      const schliessen = () => {
        document.removeEventListener('keydown', beiTaste);
        window.removeEventListener('resize', skaliere);
        overlay.classList.add('geht');
        // Erst nach der Blende entfernen, sonst verschwindet sie hart.
        setTimeout(() => overlay.remove(), 200);
      };

      const beiTaste = (e) => { if (e.key === 'Escape') schliessen(); };

      const skaliere = () => {
        const faktor = Math.min(overlay.clientWidth / 1920, overlay.clientHeight / 1080);
        spiegel.style.transform = `scale(${faktor})`;
        buehne.style.width = `${1920 * faktor}px`;
        buehne.style.height = `${1080 * faktor}px`;
      };

      zurueck.addEventListener('click', schliessen);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) schliessen(); });
      document.addEventListener('keydown', beiTaste);
      window.addEventListener('resize', skaliere);

      overlay.append(buehne, zurueck);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => { skaliere(); overlay.classList.add('da'); });
    }

    /** Modul ein- oder ausblenden. Sammelt sich im Entwurf wie eine Zone. */
    schalteModul(name) {
      this.entwurfAn = this.entwurfAn || {};
      const modul = this.alleModule().find(m => m.module === name);
      const jetzt = this.entwurfAn[name] ?? (modul?.enabled !== false);
      this.entwurfAn[name] = !jetzt;
      this.zeichne();
    }

    zoneGewaehlt(id) {
      if (!this.markiert) return;
      this.entwurf = { ...(this.entwurf || {}), [this.markiert]: id };
      this.markiert = null;
      this.zeichne();
    }

    async speichere() {
      if (!this.entwurf && !this.entwurfAn) return;

      const neu = {
        ...this.config,
        modules: this.config.modules.map(m => {
          const geaendert = { ...m };
          if (this.entwurf?.[m.module]) geaendert.position = this.entwurf[m.module];
          if (this.entwurfAn && m.module in this.entwurfAn) {
            geaendert.enabled = this.entwurfAn[m.module];
          }
          return geaendert;
        })
      };

      this.entwurf = null;
      this.entwurfAn = null;
      await this.beimSpeichern(neu);
      this.config = neu;
      this.zeichne();
    }
  }

  if (typeof window !== 'undefined') window.ZonenEditor = ZonenEditor;
})();
