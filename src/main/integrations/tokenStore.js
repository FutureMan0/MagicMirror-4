const crypto = require('node:crypto');

/**
 * Verwaltet OAuth-Token für ein Modul.
 *
 * Klingt nach Kleinkram, ist aber der Punkt, an dem der Spotify-Zugang
 * dauerhaft kaputtgehen kann:
 *
 * Unter PKCE gibt Spotify bei **jeder** Erneuerung einen neuen Refresh-Token
 * aus und macht den alten ungültig. Zwei gleichzeitige Erneuerungen - etwa
 * weil zwei Displays laufen oder weil zwei Anfragen zusammentreffen -
 * bedeuten also: eine gewinnt, die andere hält einen ungültigen Token in der
 * Hand, und beim nächsten Versuch ist der Zugang weg. Wiederherstellen geht
 * dann nur über den kompletten Anmeldevorgang.
 *
 * Deshalb: genau ein Besitzer, ein Riegel, und der neue Refresh-Token wird
 * gespeichert, BEVOR der Access-Token benutzt wird.
 */
class TokenStore {
  constructor({ envKey, readEnv, writeEnv, log = console }) {
    this.envKey = envKey;
    this.readEnv = readEnv;
    this.writeEnv = writeEnv;
    this.log = log;

    this.accessToken = null;
    this.expiresAt = 0;
    this.refreshing = null;
  }

  getRefreshToken() {
    return process.env[this.envKey] || this.readEnv()[this.envKey] || null;
  }

  hasRefreshToken() {
    return Boolean(this.getRefreshToken());
  }

  /**
   * Speichert den Refresh-Token. Muss vor jeder Verwendung des zugehörigen
   * Access-Tokens passieren - sonst geht bei einem Absturz dazwischen der
   * Zugang verloren.
   */
  saveRefreshToken(token) {
    if (!token) return;

    const env = this.readEnv();
    env[this.envKey] = token;
    this.writeEnv(env);
    process.env[this.envKey] = token;
  }

  clear() {
    const env = this.readEnv();
    env[this.envKey] = '';
    this.writeEnv(env);
    delete process.env[this.envKey];

    this.accessToken = null;
    this.expiresAt = 0;
  }

  /**
   * Liefert einen gültigen Access-Token und erneuert ihn bei Bedarf.
   *
   * `refresher` bekommt den Refresh-Token und gibt
   * { accessToken, expiresIn, refreshToken? } zurück.
   */
  async getAccessToken(refresher) {
    // 30 Sekunden Puffer: ein Token, der während der Anfrage abläuft, ist so
    // gut wie keiner.
    if (this.accessToken && Date.now() < this.expiresAt - 30000) {
      return this.accessToken;
    }

    // Der Riegel. Ohne ihn erneuern zwei gleichzeitige Anfragen parallel -
    // und unter PKCE macht die zweite den Token der ersten ungültig.
    if (this.refreshing) return this.refreshing;

    this.refreshing = (async () => {
      try {
        const refreshToken = this.getRefreshToken();
        if (!refreshToken) {
          const error = new Error('Nicht verbunden.');
          error.code = 'NOT_CONFIGURED';
          throw error;
        }

        const result = await refresher(refreshToken);

        // Zuerst den neuen Refresh-Token sichern, dann erst weiterarbeiten.
        if (result.refreshToken && result.refreshToken !== refreshToken) {
          this.saveRefreshToken(result.refreshToken);
        }

        this.accessToken = result.accessToken;
        this.expiresAt = Date.now() + (result.expiresIn || 3600) * 1000;

        return this.accessToken;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }
}

/**
 * PKCE-Prüfwerte.
 *
 * Der öffentliche Weg ohne Client-Secret: statt eines Geheimnisses schickt man
 * beim Anmelden einen Hash mit und beim Einlösen das Original. Ein
 * abgefangener Code nützt damit niemandem.
 */
function createPkcePair() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

module.exports = { TokenStore, createPkcePair };
