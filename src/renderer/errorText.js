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
    const key = sprache === 'en' ? 'en' : 'de';

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

  if (typeof window !== 'undefined') {
    window.mmHumanError = humanError;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { humanError };
  }
})();
