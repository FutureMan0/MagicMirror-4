// Einbrennschutz für OLED-Panels.
//
// Ein Spiegel zeigt rund um die Uhr fast dasselbe Bild: die Uhrzeit steht Jahr
// für Jahr an derselben Stelle. Auf einem OLED heißt das ein bleibendes
// Nachbild - die organischen Leuchtstoffe altern dort schneller, wo sie heller
// leuchten, und das lässt sich nicht rückgängig machen.
//
// Zwei Maßnahmen, beide einzeln abschaltbar:
//
//   Bildversatz      Der gesamte Inhalt wandert alle paar Minuten um ein paar
//                    Pixel weiter. Eine Ziffernkante ist ein bis zwei Pixel
//                    breit; acht Pixel genügen also, damit keine Stelle des
//                    Panels dauerhaft dieselbe Helligkeit trägt.
//   Nachtabsenkung   Einbrennen hängt an Helligkeit MAL Zeit. Nachts steht
//                    ohnehin niemand davor.
//
// Nicht hier, sondern in src/main/displayPower.js: den Bildschirm ganz
// abzuschalten. Das ist die wirksamste Maßnahme überhaupt und hat mit dem
// Inhalt nichts zu tun.
//
// Die Rechnungen stehen bewusst als reine Funktionen da - so lassen sie sich
// prüfen, ohne einen Spiegel zu starten und ohne auf Mitternacht zu warten.
(function () {
  const STANDARD = {
    // An, nicht aus. Dieselbe Regel wie bei der Privatsphäre: die schützende
    // Einstellung ist die Vorgabe. Auf einem LCD schadet der Versatz nicht, auf
    // einem OLED entscheidet er darüber, ob nach zwei Jahren die Uhrzeit im
    // Panel steht.
    shift: true,
    shiftRange: 8,
    shiftIntervalMinutes: 5,

    brightness: 1,
    night: false,
    nightBrightness: 0.4,
    nightFrom: '23:00',
    nightTo: '06:30'
  };

  // Zwölf Haltepunkte auf zwei Radien im Wechsel. Auf einem einzigen Kreis
  // träfe der Versatz immer dieselben Bahnen; so deckt er die Fläche ab.
  const HALTEPUNKTE = 12;

  function zahl(wert, rueckfall, min, max) {
    const n = Number(wert);
    if (!Number.isFinite(n)) return rueckfall;
    return Math.min(max, Math.max(min, n));
  }

  /** Die Einstellungen mit Vorgaben aufgefüllt und auf sinnvolle Grenzen gebracht. */
  function einstellungen(config) {
    const roh = (config && config.display && config.display.burnIn) || {};

    return {
      shift: roh.shift !== false,
      // Mehr als 24 Pixel sieht man wandern, weniger als 2 bringt nichts.
      shiftRange: Math.round(zahl(roh.shiftRange, STANDARD.shiftRange, 0, 24)),
      shiftIntervalMinutes: Math.round(
        zahl(roh.shiftIntervalMinutes, STANDARD.shiftIntervalMinutes, 1, 120)
      ),
      // Nie ganz dunkel: eine Anzeige, die aussieht wie ausgeschaltet, ist ein
      // Defekt und keine Einstellung. Zum Abschalten gibt es displayPower.
      brightness: zahl(roh.brightness, STANDARD.brightness, 0.15, 1),
      night: roh.night === true,
      nightBrightness: zahl(roh.nightBrightness, STANDARD.nightBrightness, 0.05, 1),
      nightFrom: typeof roh.nightFrom === 'string' ? roh.nightFrom : STANDARD.nightFrom,
      nightTo: typeof roh.nightTo === 'string' ? roh.nightTo : STANDARD.nightTo
    };
  }

  /**
   * Welcher Haltepunkt gilt gerade?
   *
   * Aus der Uhrzeit gerechnet und nicht mitgezählt: der Spiegel wird nach jedem
   * Update neu gestartet. Ein Zähler finge dann wieder bei null an, und bei
   * mehreren Updates am Tag stünde der Inhalt öfter auf Haltepunkt 0 als
   * irgendwo sonst - also genau die Ungleichverteilung, gegen die der Versatz
   * antritt.
   */
  function schrittFuer(datum, intervallMinuten) {
    const minuten = datum.getHours() * 60 + datum.getMinutes();
    return Math.floor(minuten / Math.max(1, intervallMinuten));
  }

  function versatz(schritt, weite) {
    if (!weite) return { x: 0, y: 0 };

    const i = ((Math.trunc(schritt) % HALTEPUNKTE) + HALTEPUNKTE) % HALTEPUNKTE;
    const winkel = (i / HALTEPUNKTE) * 2 * Math.PI;
    const radius = weite * (i % 2 === 0 ? 1 : 0.5);

    return {
      x: Math.round(Math.cos(winkel) * radius),
      y: Math.round(Math.sin(winkel) * radius)
    };
  }

  /** "23:00" als Minuten seit Mitternacht. Unlesbares ergibt null. */
  function zeitAlsMinuten(text) {
    const treffer = /^(\d{1,2}):(\d{2})$/.exec(String(text == null ? '' : text).trim());
    if (!treffer) return null;

    const stunden = Number(treffer[1]);
    const minuten = Number(treffer[2]);
    if (stunden > 23 || minuten > 59) return null;

    return stunden * 60 + minuten;
  }

  function istNacht(datum, vonText, bisText) {
    const von = zeitAlsMinuten(vonText);
    const bis = zeitAlsMinuten(bisText);

    // Gleiche Zeiten heißen nicht "immer" und nicht "nie" - sie heißen, dass
    // jemand nichts eingestellt hat. Dann bleibt es hell.
    if (von === null || bis === null || von === bis) return false;

    const jetzt = datum.getHours() * 60 + datum.getMinutes();

    // Über Mitternacht besteht das Fenster aus zwei Stücken.
    return von < bis
      ? (jetzt >= von && jetzt < bis)
      : (jetzt >= von || jetzt < bis);
  }

  function helligkeitFuer(datum, e) {
    if (e.night && istNacht(datum, e.nightFrom, e.nightTo)) return e.nightBrightness;
    return e.brightness;
  }

  // --- Anwenden -------------------------------------------------------------

  let aktuell = einstellungen(null);

  function inVorschau() {
    return typeof document !== 'undefined'
      && document.documentElement.dataset.preview === '1';
  }

  function setze(x, y, helligkeit, reserve) {
    const wurzel = document.documentElement;
    wurzel.style.setProperty('--mm-shift-x', `${x}px`);
    wurzel.style.setProperty('--mm-shift-y', `${y}px`);
    wurzel.style.setProperty('--mm-shift-reserve', `${reserve}px`);
    wurzel.style.setProperty('--mm-luminanz', String(helligkeit));
  }

  function aktualisieren(datum = new Date()) {
    if (typeof document === 'undefined') return;

    const weite = aktuell.shift ? aktuell.shiftRange : 0;

    // In der Vorschau weder wandern noch absenken: ein wanderndes Bild sieht
    // dort nach einem Fehler aus, und eine nachts abgesenkte Vorschau nach
    // einem kaputten Spiegel. Dieselbe Regel gilt schon fürs Dimmen bei
    // Abwesenheit.
    //
    // Die Randreserve bleibt aber stehen. Sie ist Teil des Layouts, und eine
    // Vorschau, die anders umbricht als der Spiegel, ist keine Vorschau.
    if (inVorschau()) {
      setze(0, 0, 1, weite);
      return;
    }

    const { x, y } = versatz(schrittFuer(datum, aktuell.shiftIntervalMinutes), weite);

    setze(x, y, helligkeitFuer(datum, aktuell), weite);
  }

  function anwenden(config) {
    aktuell = einstellungen(config);
    aktualisieren();
  }

  const api = {
    anwenden,
    aktualisieren,
    einstellungen,
    versatz,
    schrittFuer,
    zeitAlsMinuten,
    istNacht,
    helligkeitFuer,
    STANDARD
  };

  if (typeof window !== 'undefined') {
    window.mmEinbrennschutz = api;

    // Am gemeinsamen Takt statt an einem eigenen Timer - so wacht der Spiegel
    // nicht ein zweites Mal auf, nur um alle fünf Minuten zwei Zahlen zu
    // ändern.
    if (window.mmBus) {
      window.mmBus.on('tick:minute', (payload) => {
        aktualisieren(payload && payload.date ? payload.date : new Date());
      });
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
