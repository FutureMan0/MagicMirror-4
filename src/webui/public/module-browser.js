(function () {
  /**
   * Module: Übersicht und Detail.
   *
   * Vorher lag hier eine Seitenleiste mit einer Liste, daneben der
   * Layout-Editor. Zwei Dinge auf einmal, und beide klein. Jetzt zeigt der
   * Reiter erst die Module als Karten; ein Tipp öffnet die Einzelansicht mit
   * Vorschau und Einstellungen, ein Knopf oben links führt zurück.
   *
   * Der Wechsel ist animiert, weil die Karte, die man antippt, und die
   * Ansicht, die aufgeht, sonst nichts miteinander zu tun zu haben scheinen.
   * Esc führt ebenfalls zurück — wer eine Detailansicht öffnet, erwartet das.
   */

  const UEBERGANG_MS = 260;

  let detailOffen = false;

  function el(id) {
    return document.getElementById(id);
  }

  function sprache() {
    return typeof getCurrentLanguage === 'function' ? getCurrentLanguage() : 'de';
  }

  function text(schluessel, rueckfall) {
    return typeof t === 'function' ? (t(schluessel) || rueckfall) : rueckfall;
  }

  function name(modulConfig) {
    const liste = window.availableModules || [];
    const anzeige = liste.find(m => m.name === modulConfig.module)?.info?.displayName;
    if (!anzeige) return modulConfig.module;
    if (typeof anzeige === 'string') return anzeige;
    return anzeige[sprache()] || anzeige.de || modulConfig.module;
  }

  function beschreibung(modulConfig) {
    const liste = window.availableModules || [];
    return liste.find(m => m.name === modulConfig.module)?.info?.description || '';
  }

  /** Die Karten. Eine je Modul, aktiv oder nicht. */
  function zeichneKarten() {
    const raster = el('modul-karten');
    const config = window.currentConfig;
    if (!raster || !config?.modules) return;

    raster.textContent = '';

    config.modules.forEach((modul, index) => {
      const karte = document.createElement('button');
      karte.type = 'button';
      karte.className = 'modul-karte';
      if (modul.enabled === false) karte.classList.add('aus');

      const titel = document.createElement('span');
      titel.className = 'modul-karte-titel';
      titel.textContent = name(modul);

      const zeile = document.createElement('span');
      zeile.className = 'modul-karte-text';
      zeile.textContent = beschreibung(modul);

      const zustand = document.createElement('span');
      zustand.className = 'modul-karte-zustand';
      zustand.textContent = modul.enabled === false
        ? text('moduleOff', 'Aus')
        : text('moduleOn', 'An');

      karte.append(titel, zeile, zustand);
      karte.addEventListener('click', () => oeffne(index));
      raster.appendChild(karte);
    });
  }

  /** Die Einzelansicht aufziehen. */
  function oeffne(index) {
    const uebersicht = el('modul-uebersicht');
    const detail = el('modul-detail');
    const config = window.currentConfig;
    if (!uebersicht || !detail || !config?.modules?.[index]) return;

    const modul = config.modules[index];

    if (typeof window.selectModule === 'function') window.selectModule(index);

    const titel = el('modul-detail-titel');
    if (titel) titel.textContent = name(modul);

    zeigeVorschau();

    detail.hidden = false;
    detailOffen = true;

    // Zwei Bilder im selben Frame ergeben keine Animation - deshalb erst im
    // naechsten.
    requestAnimationFrame(() => {
      uebersicht.classList.add('weg');
      detail.classList.add('da');
    });
  }

  function zurueck() {
    const uebersicht = el('modul-uebersicht');
    const detail = el('modul-detail');
    if (!detail || !detailOffen) return;

    detail.classList.remove('da');
    uebersicht?.classList.remove('weg');
    detailOffen = false;

    // Die Vorschau sofort abschalten: sonst laeuft im Hintergrund ein
    // zweiter Renderer samt aller Netzabfragen weiter.
    const rahmen = el('modul-vorschau');
    if (rahmen) rahmen.removeAttribute('src');

    setTimeout(() => { detail.hidden = true; }, UEBERGANG_MS);
  }

  /** Der echte Spiegel, klein, neben den Einstellungen. */
  function zeigeVorschau() {
    const rahmen = el('modul-vorschau');
    const buehne = rahmen?.parentElement;
    if (!rahmen || !buehne) return;

    // Format, Masse und Massstab kommen aus screen.js - dieselbe Rechnung wie
    // fuer die Live-Ansicht und den Zonen-Editor. Steht das Panel hochkant, ist
    // auch die Vorschau hochkant.
    const richte = () => window.Bildschirm?.richteVorschauAus(buehne, rahmen);

    const v = window.Bildschirm?.vorschau();
    const url = v ? v.url : '/mirror/index.html?preview=1&rotate=off';
    if (rahmen.getAttribute('src') !== url) rahmen.setAttribute('src', url);

    requestAnimationFrame(richte);

    if (!buehne._beobachter) {
      buehne._beobachter = new ResizeObserver(richte);
      buehne._beobachter.observe(buehne);
    }

    // Dreht sich die Anzeige, dreht sich die Vorschau mit.
    if (!buehne._drehung) {
      buehne._drehung = true;
      document.addEventListener('mm:drehung', () => {
        if (!detailOffen) return;
        rahmen.setAttribute('src', window.Bildschirm?.vorschau().url || url);
        richte();
      });
    }
  }

  function start() {
    el('modul-zurueck')?.addEventListener('click', zurueck);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && detailOffen) zurueck();
    });
    zeichneKarten();
    document.addEventListener('mm:language', zeichneKarten);
  }

  if (typeof window !== 'undefined') {
    window.ModulBrowser = { zeichneKarten, zurueck, start };
    document.addEventListener('DOMContentLoaded', start);
  }
})();
