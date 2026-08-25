const { defineHttpModule } = require('../../src/main/integrations/httpModule');

/**
 * Wetter.
 *
 * Das Modul holte seine Daten bisher selbst aus dem Renderer — mit dem
 * API-Schlüssel in der URL. Drei Folgen, alle unangenehm:
 *
 *  * **In der Live-Ansicht am Handy war das Wetter leer.** Über HTTP liefert
 *    der Server für Geheimnisse nur `"__SET__"`; das Modul fragte damit an,
 *    bekam eine Fehlerantwort und stolperte über sie: „Cannot read properties
 *    of undefined (reading 'temp')". Deshalb startete dort auch nie ein
 *    Wetter-Effekt.
 *  * **Der Schlüssel lag im Browser.** In der URL, in den DevTools, im
 *    Verlauf.
 *  * **Jede Anzeige fragte einzeln.** Spiegel, Live-Ansicht und
 *    Konfigurationsseite holten dasselbe dreimal.
 *
 * Über das Fundament ist all das erledigt: der Schlüssel wird serverseitig
 * gelesen, eine Abfrage versorgt alle Anzeigen, der letzte Stand liegt auf
 * Platte und ist nach einem Neustart sofort da.
 *
 * Die Antwort behält bewusst die Form von OpenWeatherMap. Das Frontend ist
 * daran gewachsen; es umzubauen wäre eine zweite Baustelle, die mit dem
 * Fehler nichts zu tun hat.
 */

const API = 'https://api.openweathermap.org/data/2.5';

function url(pfad, config) {
  const parameter = new URLSearchParams({
    q: config.city,
    units: config.units || 'metric',
    appid: config.apiKey,
    lang: config.language || 'de'
  });
  return `${API}/${pfad}?${parameter}`;
}

module.exports = defineHttpModule({
  name: 'weather',

  defaults: {
    // Zehn Minuten. OpenWeatherMap aktualisiert seine Werte ohnehin nicht
    // häufiger, und das kostenlose Kontingent ist begrenzt.
    updateInterval: 600000,
    units: 'metric'
  },

  buildRequests(config) {
    if (!config.apiKey || !config.city) return [];

    return [
      { url: url('weather', config) },
      { url: url('forecast', config) }
    ];
  },

  transform([aktuell, vorhersage]) {
    // Beides muss da sein. Ein halbes Wetter ist schlechter als keines: das
    // Frontend zeigt sonst eine Temperatur ohne Vorhersage und wirkt kaputt.
    if (!aktuell || !aktuell.weather || !aktuell.main) {
      const fehler = new Error('Unerwartete Antwort von OpenWeatherMap.');
      fehler.code = 'BAD_RESPONSE';
      throw fehler;
    }

    return { current: aktuell, forecast: vorhersage || null };
  },

  /** „Verbindung testen" im Einrichtungsdialog. */
  async test(config, { fetch }) {
    if (!config.apiKey) return { ok: false, message: 'Kein API-Schlüssel hinterlegt.' };
    if (!config.city) return { ok: false, message: 'Kein Ort eingetragen.' };

    const antwort = await fetch(url('weather', config));

    if (antwort.status === 401) {
      return { ok: false, message: 'Der API-Schlüssel wurde abgelehnt.' };
    }
    if (antwort.status === 404) {
      return { ok: false, message: `Ort „${config.city}" nicht gefunden.` };
    }
    if (!antwort.ok) {
      return { ok: false, message: `OpenWeatherMap antwortete mit ${antwort.status}.` };
    }

    const daten = await antwort.json();
    return { ok: true, message: `${daten.name}: ${Math.round(daten.main?.temp)}°` };
  }
});
