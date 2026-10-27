(function () {
  /**
   * Technische Fehler in Sätze übersetzen, die an einer Wand stehen dürfen.
   *
   * Der Anlass: auf dem Spiegel stand „FEHLER: FETCH FAILED" — englischer
   * Jargon aus den Innereien von undici, in einer deutschen Oberfläche, in
   * einem Badezimmer. Wer das liest, weiß weder was los ist noch was zu tun
   * wäre.
   *
   * Zwei Regeln:
   *
   *  1. **Was der Spiegel zeigt, ist nie die rohe Meldung.** Sie geht in die
   *     Konsole, wo sie hingehört, und an die Wand kommt ein Satz.
   *  2. **Unbekanntes wird nicht geraten.** Passt keine Regel, steht dort
   *     „Vorübergehend nicht verfügbar" — vage, aber wahr. Eine erfundene
   *     Ursache wäre schlimmer als keine.
   */

  const REGELN = [
    // Netzwerk. `fetch failed` ist die haeufigste und nichtssagendste.
    { muster: /fetch failed|failed to fetch|networkerror|econnrefused|enotfound|eai_again|dns/i,
      de: 'Keine Verbindung', en: 'No connection' },

    // Zeitueberschreitung - eigener Fall, weil die Ursache eine andere ist:
    // erreichbar, aber zu langsam. Genau der Fall bei schwachem WLAN.
    { muster: /timeout|timed out|etimedout|aborterror|abgebrochen/i,
      de: 'Zeitüberschreitung', en: 'Timed out' },

    // Zugangsdaten. Fuer den Nutzer das einzig Handlungsrelevante.
    { muster: /\b(401|403)\b|unauthorized|forbidden|invalid[_ ]?(api|token|key)/i,
      de: 'Zugangsdaten abgelehnt', en: 'Credentials rejected' },

    { muster: /\b404\b|not found/i,
      de: 'Nicht gefunden', en: 'Not found' },

    { muster: /\b(429)\b|rate limit|too many requests/i,
      de: 'Zu viele Anfragen', en: 'Too many requests' },

    { muster: /\b5\d\d\b|internal server|bad gateway|service unavailable/i,
      de: 'Dienst gestört', en: 'Service unavailable' },

    { muster: /not[_ ]configured|kein[e]? (api|schlüssel|zugang)/i,
      de: 'Noch nicht eingerichtet', en: 'Not set up yet' }
  ];

  const STANDARD = { de: 'Vorübergehend nicht verfügbar', en: 'Temporarily unavailable' };

  /**
   * @param {unknown} fehler  Error, String oder Umschlag mit .message/.code
   * @param {string}  sprache 'de' (Standard) oder 'en'
   * @returns {string} ein Satz ohne Fachbegriffe
   */
  function humanError(fehler, sprache = 'de') {
    // Eine unbekannte Sprache faellt auf Englisch, die Vorgabe der Anwendung.
    const key = sprache === 'de' ? 'de' : 'en';

    const text = [
      fehler && fehler.code,
      fehler && fehler.message,
      typeof fehler === 'string' ? fehler : '',
      fehler && fehler.error && fehler.error.message,
      fehler && String(fehler.status || '')
    ].filter(Boolean).join(' ');

    if (!text.trim()) return STANDARD[key];

    for (const regel of REGELN) {
      if (regel.muster.test(text)) return regel[key];
    }
    return STANDARD[key];
  }

  /**
   * Die wenigen festen Texte, die der Rahmen selbst anzeigt.
   *
   * Sie standen vorher als deutsche Literale im Code. Auf einem Spiegel, der
   * auf Englisch eingestellt war, stand deshalb „Not set up yet" direkt über
   * „Noch nicht eingerichtet." - zwei Sprachen übereinander in demselben
   * Modul.
   */
  const TEXTE = {
    renderFailed:  { de: 'Anzeige fehlgeschlagen.', en: 'Display failed.' },
    empty:         { de: 'Nichts zu zeigen.', en: 'Nothing to show.' },
    unreachable:   { de: 'Nicht erreichbar — zeigt den Stand von ',
                     en: 'Unreachable — showing data from ' },
    asOf:          { de: 'Stand von ', en: 'As of ' },
    ageUnknown:    { de: 'unbekannt', en: 'unknown' },
    ageNow:        { de: 'gerade eben', en: 'just now' },
    ageMinutes:    { de: 'vor {n} min', en: '{n} min ago' },
    ageHours:      { de: 'vor {n} h', en: '{n} h ago' },
    ageDays:       { de: 'vor {n} Tagen', en: '{n} days ago' },

    // Was der Spiegel selbst zeigt, ausserhalb der Module: Platzhalter fuer
    // ein Modul, das nicht laedt, die Kopplung, die Privatsphaere und die
    // Ansicht ohne Konfiguration. Die Sprache kommt aus `language` in der
    // Konfiguration (am Spiegel: document.documentElement.lang).
    moduleFailed:  { de: 'Modul konnte nicht geladen werden', en: 'Module could not be loaded' },
    noRender:      { de: 'Modul hat keine render() Methode', en: 'Module has no render() method' },
    errorPrefix:   { de: 'Fehler: ', en: 'Error: ' },
    pairingTitle:  { de: 'Gerät koppeln', en: 'Pair a device' },
    pairingValid:  { de: 'gültig noch {n} s', en: 'valid for another {n} s' },
    privacyGuest:  { de: 'Gästemodus — persönliche Inhalte sind ausgeblendet',
                     en: 'Guest mode — personal content is hidden' },
    privacyOff:    { de: 'Anzeige aus', en: 'Display off' },
    notSignedIn:   { de: 'Nicht angemeldet — bitte die Web-Oberfläche öffnen und koppeln.',
                     en: 'Not signed in — open the web interface and pair this device.' },
    configFailed:  { de: 'Konfiguration konnte nicht geladen werden: ',
                     en: 'The configuration could not be loaded: ' }
  };

  /**
   * @param {string} schluessel Name aus TEXTE
   * @param {string} sprache    'de' (Standard) oder 'en'
   * @param {object} werte      Platzhalter, z. B. { n: 5 }
   */
  function uiText(schluessel, sprache = 'de', werte = {}) {
    const eintrag = TEXTE[schluessel];
    if (!eintrag) return '';

    const key = sprache === 'de' ? 'de' : 'en';
    return Object.entries(werte).reduce(
      (text, [name, wert]) => text.replace(`{${name}}`, String(wert)),
      eintrag[key]
    );
  }

  if (typeof window !== 'undefined') {
    window.mmHumanError = humanError;
    window.mmUiText = uiText;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { humanError, uiText };
  }
})();
