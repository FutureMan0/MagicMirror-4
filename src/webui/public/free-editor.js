/**
 * Freies Positionieren.
 *
 * Kein Raster, keine Zonen: jedes Modul liegt dort, wo man es hinzieht, und
 * ist so groß, wie man es zieht. Gespeichert wird in Prozent der Bildfläche —
 * damit gilt dasselbe Layout auf jedem Panel und in jeder Drehung, ohne dass
 * irgendwo Pixel umgerechnet werden müssen.
 *
 *     position: { x: '12%', y: '4%', width: '40%', height: '28%' }
 *
 * Der Renderer kann dieses Format seit jeher (`type: 'absolute'`); es fehlte
 * nur die Bedienung dafür.
 *
 * Warum Pointer-Events und nicht mousedown/touchstart nebeneinander: der alte
 * Editor hatte für beides eigene Zweige, hängte seine Zuhörer ans `document`
 * und verlor den Faden, sobald der Finger den Knopf verließ. `setPointerCapture`
 * hält den Zeiger beim Element, bis er losgelassen wird — ein Pfad für Maus,
 * Finger und Stift.
 */
(function () {
  const MIN_BREITE = 8;   // Prozent. Darunter trifft man es nicht mehr.
  const MIN_HOEHE = 5;
  const RASTUNG = 0.5;    // Prozent. Fein genug zum Ausrichten, grob genug zum Treffen.

  function klemme(wert, min, max) {
    return Math.min(max, Math.max(min, wert));
  }

  function raste(wert) {
    return Math.round(wert / RASTUNG) * RASTUNG;
  }

  /** '12.5%' -> 12.5. Alles Unlesbare ergibt den Rückfallwert. */
  function prozent(wert, rueckfall) {
    const zahl = parseFloat(String(wert));
    return Number.isFinite(zahl) ? zahl : rueckfall;
  }

  function text(schluessel, rueckfall) {
    return typeof t === 'function' ? (t(schluessel) || rueckfall) : rueckfall;
  }

  class FreiEditor {
    constructor(auswahl, config, beimSpeichern) {
      this.behaelter = document.querySelector(auswahl);
      this.config = config;
      this.beimSpeichern = beimSpeichern;
      this.gewaehlt = null;
      this.spiegelSichtbar = localStorage.getItem('freiSpiegel') !== '0';

      if (!this.behaelter) return;
      this.baue();
      this.zeichne();

      // Die Drehung ändert das Format der Fläche.
      document.addEventListener('mm:drehung', () => this.zeichne());
    }

    module() {
      return (this.config?.modules || []).filter(m => m.enabled !== false);
    }

    modulName(modul) {
      const liste = window.availableModules || [];
      const anzeige = liste.find(m => m.name === modul.module)?.info?.displayName;
      if (!anzeige) return modul.module;
      if (typeof anzeige === 'string') return anzeige;
      const sprache = typeof getCurrentLanguage === 'function' ? getCurrentLanguage() : 'de';
      return anzeige[sprache] || anzeige.de || modul.module;
    }

    /**
     * Die Lage eines Moduls in Prozent.
     *
     * Alles, was noch Zone oder Raster ist, bekommt beim ersten Anfassen eine
     * Fläche — sonst läge es bei 0,0 übereinander mit allen anderen.
     */
    lage(modul, index) {
      const p = modul.position;

      if (p && typeof p === 'object' && (p.x !== undefined || p.y !== undefined)) {
        return {
          x: klemme(prozent(p.x, 0), 0, 100),
          y: klemme(prozent(p.y, 0), 0, 100),
          breite: klemme(prozent(p.width, 30), MIN_BREITE, 100),
          hoehe: klemme(prozent(p.height, 20), MIN_HOEHE, 100)
        };
      }

      // Noch nie frei platziert: gestaffelt untereinander, damit alles
      // sichtbar und einzeln greifbar ist.
      const reihe = index % 4;
      return { x: 6, y: 4 + reihe * 23, breite: 44, hoehe: 20 };
    }

    speicherLage(modul, lage) {
      modul.position = {
        x: `${raste(lage.x)}%`,
        y: `${raste(lage.y)}%`,
        width: `${raste(lage.breite)}%`,
        height: `${raste(lage.hoehe)}%`
      };
    }

    // --- Aufbau -------------------------------------------------------------

    baue() {
      this.behaelter.textContent = '';
      this.behaelter.className = 'frei-editor';

      const kopf = document.createElement('div');
      kopf.className = 'frei-kopf';

      const spiegel = document.createElement('button');
      spiegel.type = 'button';
      spiegel.className = 'frei-schalter';
      spiegel.textContent = text('mirrorBackdrop', 'Spiegel im Hintergrund');
      spiegel.addEventListener('click', () => {
        this.spiegelSichtbar = !this.spiegelSichtbar;
        localStorage.setItem('freiSpiegel', this.spiegelSichtbar ? '1' : '0');
        this.zeichne();
      });
      this.spiegelKnopf = spiegel;

      this.hinweis = document.createElement('span');
      this.hinweis.className = 'frei-hinweis';

      kopf.append(spiegel, this.hinweis);

      // Die Fläche. Position: relative, damit die Module darin absolut liegen.
      this.buehne = document.createElement('div');
      this.buehne.className = 'frei-buehne';
      this.buehne.addEventListener('pointerdown', (e) => {
        // Auf freie Fläche getippt: Auswahl aufheben.
        if (e.target === this.buehne || e.target === this.spiegelBild) this.waehle(null);
      });

      this.werkzeug = document.createElement('div');
      this.werkzeug.className = 'frei-werkzeug';

      this.behaelter.append(kopf, this.buehne, this.werkzeug);
    }

    // --- Zeichnen -----------------------------------------------------------

    zeichne() {
      if (!this.behaelter) return;

      const v = window.Bildschirm?.vorschau?.() || { format: '16 / 9', breite: 1920, hoehe: 1080 };
      this.buehne.style.setProperty('--vorschau-format', v.format);
      // Querformat richtet sich nach der Breite, Hochformat nach der Hoehe -
      // sonst waere die Flaeche auf einem Telefon zwei Bildschirme hoch.
      this.buehne.classList.toggle('hochkant', !!v.hochkant);

      this.buehne.textContent = '';
      this.spiegelBild = null;

      if (this.spiegelSichtbar) this.zeichneSpiegel(v);
      this.spiegelKnopf?.classList.toggle('an', this.spiegelSichtbar);

      const module = this.module();
      this.hinweis.textContent = module.length
        ? text('freeHint', 'Ziehen zum Verschieben, an der Ecke zum Vergrößern.')
        : text('freeEmpty', 'Kein Modul aktiv.');

      module.forEach((modul, index) => this.zeichneModul(modul, index));
      this.zeichneWerkzeug();
    }

    /** Der echte Spiegel als Hintergrund - sonst schiebt man blind. */
    zeichneSpiegel(v) {
      const rahmen = document.createElement('div');
      rahmen.className = 'frei-spiegel';

      const bild = document.createElement('iframe');
      bild.className = 'frei-spiegel-bild';
      bild.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      bild.setAttribute('title', text('livePreview', 'Live-Vorschau'));
      bild.src = v.url || '/mirror/index.html?preview=1&rotate=off';

      rahmen.appendChild(bild);
      this.buehne.appendChild(rahmen);
      this.spiegelBild = bild;

      const skaliere = () => {
        const breite = this.buehne.clientWidth;
        if (!breite) return;
        bild.style.width = `${v.breite}px`;
        bild.style.height = `${v.hoehe}px`;
        bild.style.transform = `scale(${breite / v.breite})`;
      };

      requestAnimationFrame(skaliere);
      if (!this.spiegelBeobachter) {
        this.spiegelBeobachter = new ResizeObserver(() => {
          if (this.spiegelBild) skaliere();
        });
        this.spiegelBeobachter.observe(this.buehne);
      }
    }

    zeichneModul(modul, index) {
      const lage = this.lage(modul, index);
      const kasten = document.createElement('div');
      kasten.className = 'frei-modul';
      kasten.dataset.modul = modul.module;
      if (this.gewaehlt === modul.module) kasten.classList.add('gewaehlt');

      kasten.style.left = `${lage.x}%`;
      kasten.style.top = `${lage.y}%`;
      kasten.style.width = `${lage.breite}%`;
      kasten.style.height = `${lage.hoehe}%`;

      const name = document.createElement('span');
      name.className = 'frei-modul-name';
      name.textContent = this.modulName(modul);

      const masse = document.createElement('span');
      masse.className = 'frei-modul-masse';
      masse.textContent = `${Math.round(lage.breite)}×${Math.round(lage.hoehe)}`;

      const griff = document.createElement('span');
      griff.className = 'frei-griff';
      griff.setAttribute('aria-hidden', 'true');

      kasten.append(name, masse, griff);

      this.macheZiehbar(kasten, modul, lage, 'verschieben');
      this.macheZiehbar(griff, modul, lage, 'groesse', kasten);

      this.buehne.appendChild(kasten);
    }

    /**
     * Ziehen - für Verschieben und Vergrößern derselbe Code.
     *
     * setPointerCapture hält den Zeiger am Element fest: der Finger darf die
     * Fläche verlassen, ohne dass der Zug abreißt. Genau daran scheiterte der
     * alte Editor bei jedem zweiten Versuch.
     */
    macheZiehbar(element, modul, start, art, kastenAlt) {
      const kasten = kastenAlt || element;

      element.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        this.waehle(modul.module);

        const flaeche = this.buehne.getBoundingClientRect();
        const vonX = e.clientX;
        const vonY = e.clientY;
        const anfang = { ...start };

        element.setPointerCapture(e.pointerId);
        kasten.classList.add('zieht');

        const bewegt = (ev) => {
          const dx = ((ev.clientX - vonX) / flaeche.width) * 100;
          const dy = ((ev.clientY - vonY) / flaeche.height) * 100;

          if (art === 'verschieben') {
            start.x = klemme(raste(anfang.x + dx), 0, 100 - anfang.breite);
            start.y = klemme(raste(anfang.y + dy), 0, 100 - anfang.hoehe);
          } else {
            start.breite = klemme(raste(anfang.breite + dx), MIN_BREITE, 100 - anfang.x);
            start.hoehe = klemme(raste(anfang.hoehe + dy), MIN_HOEHE, 100 - anfang.y);
          }

          kasten.style.left = `${start.x}%`;
          kasten.style.top = `${start.y}%`;
          kasten.style.width = `${start.breite}%`;
          kasten.style.height = `${start.hoehe}%`;

          const masse = kasten.querySelector('.frei-modul-masse');
          if (masse) masse.textContent = `${Math.round(start.breite)}×${Math.round(start.hoehe)}`;
        };

        const fertig = (ev) => {
          element.releasePointerCapture(ev.pointerId);
          element.removeEventListener('pointermove', bewegt);
          element.removeEventListener('pointerup', fertig);
          element.removeEventListener('pointercancel', fertig);
          kasten.classList.remove('zieht');

          this.speicherLage(modul, start);
          this.speichere();
        };

        element.addEventListener('pointermove', bewegt);
        element.addEventListener('pointerup', fertig);
        element.addEventListener('pointercancel', fertig);
      });
    }

    // --- Auswahl und Werkzeuge ---------------------------------------------

    waehle(name) {
      if (this.gewaehlt === name) return;
      this.gewaehlt = name;

      for (const kasten of this.buehne.querySelectorAll('.frei-modul')) {
        kasten.classList.toggle('gewaehlt', kasten.dataset.modul === name);
      }
      this.zeichneWerkzeug();
    }

    /** Größe und Schriftgröße des gewählten Moduls - dort, wo man sie braucht. */
    zeichneWerkzeug() {
      this.werkzeug.textContent = '';

      const modul = this.module().find(m => m.module === this.gewaehlt);
      if (!modul) {
        const leer = document.createElement('p');
        leer.className = 'form-hint';
        leer.textContent = text('freePick', 'Ein Modul antippen, um Größe und Schrift einzustellen.');
        this.werkzeug.appendChild(leer);
        return;
      }

      const titel = document.createElement('h4');
      titel.className = 'frei-werkzeug-titel';
      titel.textContent = this.modulName(modul);
      this.werkzeug.appendChild(titel);

      // Nur die Schriftgröße. Die Größe stellt man hier durch Ziehen ein -
      // ein zusätzlicher Größenregler würde dieselbe Fläche ein zweites Mal
      // verändern und das Modul aus seiner Position schieben.
      const darstellung = modul.appearance || {};
      this.werkzeug.appendChild(this.regler(
        text('moduleFontScale', 'Schriftgröße'), darstellung.fontScale,
        (faktor) => this.setzeDarstellung(modul, 'fontScale', faktor)
      ));

      const hinweis = document.createElement('p');
      hinweis.className = 'form-hint';
      hinweis.textContent = text('freeSizeHint', 'Die Größe stellst du durch Ziehen an der Ecke ein.');
      this.werkzeug.appendChild(hinweis);
    }

    regler(beschriftung, wert, beimAendern) {
      const zeile = document.createElement('div');
      zeile.className = 'darstellung-zeile';

      const zahl = Number(wert);
      const start = Math.round((Number.isFinite(zahl) && zahl > 0 ? zahl : 1) * 100);

      const label = document.createElement('label');
      label.textContent = beschriftung;

      const regler = document.createElement('input');
      regler.type = 'range';
      regler.min = '50';
      regler.max = '200';
      regler.step = '5';
      regler.value = String(start);

      const ausgabe = document.createElement('output');
      ausgabe.textContent = `${start} %`;

      regler.addEventListener('input', () => { ausgabe.textContent = `${regler.value} %`; });
      regler.addEventListener('change', () => beimAendern(Number(regler.value) / 100));

      const id = `frei-${beschriftung.replace(/\W+/g, '')}`;
      regler.id = id;
      label.setAttribute('for', id);

      zeile.append(label, regler, ausgabe);
      return zeile;
    }

    setzeDarstellung(modul, schluessel, faktor) {
      const darstellung = { scale: 1, fontScale: 1, ...(modul.appearance || {}) };
      darstellung[schluessel] = faktor;

      // Steht beides auf 100 %, fällt der Eintrag weg - der Standard hat in
      // der Datei nichts zu suchen.
      if (darstellung.scale === 1 && darstellung.fontScale === 1) delete modul.appearance;
      else modul.appearance = darstellung;

      this.speichere();
    }

    speichere() {
      if (typeof this.beimSpeichern === 'function') this.beimSpeichern(this.config);
    }

    updateConfig(config) {
      this.config = config;
      this.zeichne();
    }
  }

  // Nur am window: die Dateien unter src/webui/public sind Browser-Skripte,
  // und die Lint-Regeln dort kennen kein CommonJS. Tests laden sie ueber
  // new Function(...) und greifen das Fenster ab.
  if (typeof window !== 'undefined') window.FreiEditor = FreiEditor;
})();
