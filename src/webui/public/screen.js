(function () {
  /**
   * Bildschirm: Drehung und einzelne Anzeigen.
   *
   * Zwei Dinge, die das Gerät betreffen und nicht den Inhalt — deshalb in den
   * Einstellungen und nicht im Layout.
   *
   *  * **Drehung** liegt in der Konfiguration der Instanz und wird im Renderer
   *    als CSS-Drehung angewandt. Nicht über `xrandr`: so wirkt sie auch in
   *    der Live-Vorschau am Handy, sie braucht keine Rechte auf dem Gerät und
   *    überlebt einen Wechsel des Anzeigeservers.
   *  * **Anzeigen einzeln abschalten** geht dagegen nur über `xrandr`.
   *    `vcgencmd display_power` kennt nur „den Bildschirm"; wer zwei Panels
   *    am selben Pi hat, käme damit nicht weit.
   */

  function el(id) {
    return document.getElementById(id);
  }

  function text(schluessel, rueckfall) {
    return typeof t === 'function' ? (t(schluessel) || rueckfall) : rueckfall;
  }

  // --- Drehung --------------------------------------------------------------

  const ERLAUBT = [0, 90, 180, 270];

  /**
   * Die Drehung dieser Anzeige - immer einer der vier erlaubten Werte.
   *
   * Auch der Renderer faellt bei einem unbekannten Wert auf 0 zurueck; die
   * Oberflaeche muss dieselbe Annahme treffen, sonst zeigt der Editor ein
   * anderes Format als der Spiegel.
   */
  function drehung(config = window.currentConfig) {
    const grad = Number(config?.display?.rotation) || 0;
    return ERLAUBT.includes(grad) ? grad : 0;
  }

  /**
   * Steht das Panel hochkant an der Wand?
   *
   * Bei 90 und 270 Grad tauschen Breite und Hoehe die Rollen - der Renderer
   * setzt den Inhalt dann in ein hochkantes Feld und kippt es erst danach.
   * Fuer den Editor heisst das: er muss dieses hochkante Feld zeigen, nicht
   * den liegenden Bildspeicher.
   */
  function hochkant(config) {
    const grad = drehung(config);
    return grad === 90 || grad === 270;
  }

  /**
   * Sagt allen Bescheid, die sich mitdrehen - Layout-Editor und
   * Live-Ansicht. Ueber ein Ereignis statt ueber direkte Aufrufe, damit
   * screen.js nichts von den beiden wissen muss.
   */
  function meldeDrehung() {
    document.dispatchEvent(new CustomEvent('mm:drehung', {
      detail: { grad: drehung(), hochkant: hochkant() }
    }));
  }

  function zeigeDrehung() {
    const auswahl = el('screen-rotation');
    const config = window.currentConfig;
    if (!auswahl || !config) return;

    auswahl.value = String(config.display?.rotation ?? 0);
    meldeDrehung();
  }

  /** Die Konfiguration dieser Anzeige zurueckschreiben. */
  async function speichere(config) {
    await fetch(`/api/config?instance=${encodeURIComponent(window.currentInstance || 'display1')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
  }

  async function speichereDrehung(grad) {
    const config = window.currentConfig;
    if (!config) return;

    config.display = { ...(config.display || {}), rotation: Number(grad) || 0 };

    // Erst melden, dann speichern: der Editor soll sich sofort drehen und
    // nicht erst, wenn der Server geantwortet hat.
    meldeDrehung();

    await speichere(config);
  }

  // --- Einbrennschutz -------------------------------------------------------

  /**
   * Dieselben Vorgaben wie in src/renderer/burnIn.js.
   *
   * Doppelt, weil die Oberflaeche den Renderer nicht laden kann - sie liefe
   * sonst mit und schriebe CSS-Variablen in die falsche Seite.
   * tests/einbrennschutz.test.js haelt die beiden Listen zusammen.
   */
  const SCHUTZ_STANDARD = {
    shift: true,
    shiftRange: 8,
    shiftIntervalMinutes: 5,
    brightness: 1,
    night: false,
    nightBrightness: 0.4,
    nightFrom: '23:00',
    nightTo: '06:30'
  };

  function schutzWerte() {
    return { ...SCHUTZ_STANDARD, ...(window.currentConfig?.display?.burnIn || {}) };
  }

  /** Werte an den Feldern, Einheiten daneben, Abhaengiges ausgegraut. */
  function zeigeSchutz() {
    const werte = schutzWerte();
    if (!el('burnin-shift')) return;

    el('burnin-shift').checked = werte.shift !== false;
    el('burnin-range').value = String(werte.shiftRange);
    el('burnin-interval').value = String(werte.shiftIntervalMinutes);
    el('burnin-brightness').value = String(Math.round(werte.brightness * 100));
    el('burnin-night').checked = werte.night === true;
    el('burnin-night-brightness').value = String(Math.round(werte.nightBrightness * 100));
    el('burnin-from').value = werte.nightFrom;
    el('burnin-to').value = werte.nightTo;

    beschrifteSchutz();
  }

  function beschrifteSchutz() {
    const anzeige = {
      'burnin-range': (v) => `${v} px`,
      'burnin-interval': (v) => `${v} min`,
      'burnin-brightness': (v) => `${v} %`,
      'burnin-night-brightness': (v) => `${v} %`
    };

    for (const [id, formatiere] of Object.entries(anzeige)) {
      const regler = el(id);
      const ausgabe = regler?.parentElement.querySelector('output');
      if (regler && ausgabe) ausgabe.textContent = formatiere(regler.value);
    }

    // Ein Regler, der nichts bewirkt, gehoert ausgegraut - sonst zieht man
    // daran und wundert sich, dass nichts passiert.
    const versatz = el('burnin-shift')?.checked;
    for (const id of ['burnin-range', 'burnin-interval']) {
      if (el(id)) el(id).disabled = !versatz;
    }

    const nachts = el('burnin-night')?.checked;
    for (const id of ['burnin-night-brightness', 'burnin-from', 'burnin-to']) {
      if (el(id)) el(id).disabled = !nachts;
    }
  }

  async function speichereSchutz() {
    const config = window.currentConfig;
    if (!config || !el('burnin-shift')) return;

    config.display = {
      ...(config.display || {}),
      burnIn: {
        shift: el('burnin-shift').checked,
        shiftRange: Number(el('burnin-range').value),
        shiftIntervalMinutes: Number(el('burnin-interval').value),
        brightness: Number(el('burnin-brightness').value) / 100,
        night: el('burnin-night').checked,
        nightBrightness: Number(el('burnin-night-brightness').value) / 100,
        nightFrom: el('burnin-from').value || SCHUTZ_STANDARD.nightFrom,
        nightTo: el('burnin-to').value || SCHUTZ_STANDARD.nightTo
      }
    };

    await speichere(config);
  }

  const SCHUTZ_FELDER = [
    'burnin-shift', 'burnin-range', 'burnin-interval', 'burnin-brightness',
    'burnin-night', 'burnin-night-brightness', 'burnin-from', 'burnin-to'
  ];

  // --- Anzeigen -------------------------------------------------------------

  async function zeigeAusgaenge() {
    const behaelter = el('screen-outputs');
    if (!behaelter) return;

    let ausgaenge = [];
    try {
      const antwort = await fetch('/api/display/outputs');
      if (antwort.ok) ausgaenge = await antwort.json();
    } catch {
      // Ohne xrandr gibt es nichts zu zeigen - das ist kein Fehler, sondern
      // ein Rechner ohne mehrere Anzeigen.
    }

    behaelter.textContent = '';
    if (!ausgaenge.length) return;

    const titel = document.createElement('h4');
    titel.className = 'screen-outputs-titel';
    titel.textContent = text('outputs', 'Angeschlossene Anzeigen');
    behaelter.appendChild(titel);

    for (const ausgang of ausgaenge) {
      const zeile = document.createElement('div');
      zeile.className = 'screen-output';
      if (!ausgang.connected) zeile.classList.add('leer');

      const name = document.createElement('span');
      name.className = 'screen-output-name';
      name.textContent = ausgang.name;

      const zustand = document.createElement('span');
      zustand.className = 'screen-output-zustand';
      zustand.textContent = ausgang.connected ? '' : text('outputDisconnected', 'nicht angeschlossen');

      const schalter = document.createElement('button');
      schalter.type = 'button';
      schalter.className = 'zonen-schalter';
      schalter.classList.toggle('an', ausgang.on);
      schalter.disabled = !ausgang.connected;
      schalter.setAttribute('aria-label', ausgang.name);
      schalter.setAttribute('aria-pressed', String(ausgang.on));
      schalter.addEventListener('click', async () => {
        await fetch('/api/display/output', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ output: ausgang.name, on: !ausgang.on })
        });
        zeigeAusgaenge();
      });

      zeile.append(name, zustand, schalter);
      behaelter.appendChild(zeile);
    }
  }

  function start() {
    el('screen-rotation')?.addEventListener('change', (e) => speichereDrehung(e.target.value));

    for (const id of SCHUTZ_FELDER) {
      // input: die Zahl neben dem Regler laeuft beim Ziehen mit.
      // change: gespeichert wird erst beim Loslassen - sonst schriebe jeder
      // Pixel eine eigene Anfrage an den Server.
      el(id)?.addEventListener('input', beschrifteSchutz);
      el(id)?.addEventListener('change', speichereSchutz);
    }

    document.addEventListener('mm:language', zeigeAusgaenge);
    zeigeDrehung();
    zeigeSchutz();
    zeigeAusgaenge();
  }

  if (typeof window !== 'undefined') {
    // SCHUTZ_STANDARD haengt mit dran, damit ein Test die Vorgaben hier gegen
    // die in src/renderer/burnIn.js halten kann.
    window.Bildschirm = {
      zeigeDrehung, zeigeSchutz, zeigeAusgaenge, drehung, hochkant, SCHUTZ_STANDARD
    };
    document.addEventListener('DOMContentLoaded', start);
  }
})();
