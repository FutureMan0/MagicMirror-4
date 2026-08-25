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

  function zeigeDrehung() {
    const auswahl = el('screen-rotation');
    const config = window.currentConfig;
    if (!auswahl || !config) return;

    auswahl.value = String(config.display?.rotation ?? 0);
  }

  async function speichereDrehung(grad) {
    const config = window.currentConfig;
    if (!config) return;

    config.display = { ...(config.display || {}), rotation: Number(grad) || 0 };

    await fetch(`/api/config?instance=${encodeURIComponent(window.currentInstance || 'display1')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
  }

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
    document.addEventListener('mm:language', zeigeAusgaenge);
    zeigeDrehung();
    zeigeAusgaenge();
  }

  if (typeof window !== 'undefined') {
    window.Bildschirm = { zeigeDrehung, zeigeAusgaenge };
    document.addEventListener('DOMContentLoaded', start);
  }
})();
