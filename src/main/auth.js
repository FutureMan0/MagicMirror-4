const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SESSION_COOKIE = 'mm4_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 Tage
const WS_TICKET_TTL_MS = 30 * 1000;                // 30 Sekunden
const PAIRING_TTL_MS = 60 * 1000;                  // 60 Sekunden
const PAIRING_MIN_INTERVAL_MS = 5 * 1000;          // Rate-Limit pro IP

/**
 * Anmeldung für den Konfigurations-Server.
 *
 * Der Spiegel hängt an der Wand und man steht davor - genau das ist der
 * Anmeldeweg: ein Kopplungscode wird für 60 Sekunden als QR-Code auf dem
 * Spiegel angezeigt. Wer ihn scannen kann, ist im Raum.
 *
 * Bewusste Entscheidungen:
 *
 *  - **Loopback ist ausgenommen.** Die Module am Spiegel holen ihre Daten per
 *    HTTP von der eigenen Maschine (`/api/untis/timetable`,
 *    `/api/presence/status`). Wer Zugriff auf den Pi selbst hat, hat ohnehin
 *    eine Shell - eine Anmeldung dort brächte keine Sicherheit, würde aber
 *    jedes Modul umbauen.
 *  - **`trust proxy` bleibt aus.** Sonst könnte ein X-Forwarded-For-Header
 *    eine entfernte Anfrage als Loopback ausgeben.
 *  - **`MM_AUTH=off`** ist der Notausgang, falls man sich aussperrt - mit
 *    deutlicher Warnung beim Start.
 */
class Auth {
  constructor({ configDir, envPath, writeEnv, readEnv }) {
    this.sessionsPath = path.join(configDir, 'sessions.json');
    this.envPath = envPath;
    this.writeEnv = writeEnv;
    this.readEnv = readEnv;

    this.enabled = process.env.MM_AUTH !== 'off';
    this.sessions = this._loadSessions();

    // Nur im Speicher: eine Eintrittskarte lebt dreissig Sekunden, die muss
    // keinen Neustart ueberstehen.
    this.wsTickets = new Map();
    this.pairing = null;
    this.lastPairingRequest = new Map();

    this.token = this._ensureToken();
    this.onPairingChange = () => {};
  }

  // --- Einrichtung ---------------------------------------------------------

  _ensureToken() {
    const existing = process.env.MM_ADMIN_TOKEN;
    if (existing && existing.length >= 32) return existing;

    const token = crypto.randomBytes(32).toString('hex');
    const envVars = this.readEnv();
    envVars.MM_ADMIN_TOKEN = token;
    this.writeEnv(envVars);
    process.env.MM_ADMIN_TOKEN = token;

    console.log('Neues Admin-Token erzeugt und in .env gespeichert.');
    return token;
  }

  _loadSessions() {
    try {
      if (!fs.existsSync(this.sessionsPath)) return {};
      const parsed = JSON.parse(fs.readFileSync(this.sessionsPath, 'utf8'));
      const now = Date.now();
      // Abgelaufenes gleich beim Laden aussortieren.
      return Object.fromEntries(
        Object.entries(parsed).filter(([, session]) => session.expiresAt > now)
      );
    } catch (error) {
      console.error('Sessions konnten nicht gelesen werden:', error.message);
      return {};
    }
  }

  _persistSessions() {
    try {
      fs.mkdirSync(path.dirname(this.sessionsPath), { recursive: true });
      const tmp = `${this.sessionsPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.sessions, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.sessionsPath);
    } catch (error) {
      console.error('Sessions konnten nicht gespeichert werden:', error.message);
    }
  }

  // --- Sessions ------------------------------------------------------------

  createSession(label) {
    const id = crypto.randomBytes(32).toString('hex');
    this.sessions[id] = {
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
      label: label || 'unbekannt'
    };
    this._persistSessions();
    return id;
  }

  isValidSession(id) {
    const session = id && this.sessions[id];
    if (!session) return false;
    if (session.expiresAt <= Date.now()) {
      delete this.sessions[id];
      this._persistSessions();
      return false;
    }
    return true;
  }

  revokeSession(id) {
    if (id && this.sessions[id]) {
      delete this.sessions[id];
      this._persistSessions();
    }
  }

  // --- Eintrittskarten fuer den WebSocket ----------------------------------
  //
  // Warum nicht einfach der Sitzungs-Cookie: den schickt iOS Safari bei einem
  // WebSocket-Upgrade nicht mit, wenn die Oberflaeche als App auf dem
  // Startbildschirm liegt. HTTP funktionierte dabei tadellos - der Spiegel
  // meldete trotzdem "keine Verbindung", und weil die Oberflaeche dann jede
  // Aenderung sperrt, liess sich nichts mehr speichern.
  //
  // Die Karte wird nur an eine angemeldete Sitzung ausgegeben, gilt dreissig
  // Sekunden und genau einmal. Sie steht damit zwar in der Adresse - aber sie
  // ist nach dem Verbinden verbraucht, und laenger als der Verbindungsaufbau
  // lebt sie nicht.
  createWsTicket() {
    const ticket = crypto.randomBytes(24).toString('hex');
    this.wsTickets.set(ticket, Date.now() + WS_TICKET_TTL_MS);

    // Abgelaufene mitnehmen, damit die Ablage nicht unbegrenzt waechst.
    for (const [wert, ablauf] of this.wsTickets) {
      if (ablauf <= Date.now()) this.wsTickets.delete(wert);
    }

    return ticket;
  }

  consumeWsTicket(ticket) {
    if (!ticket) return false;

    const ablauf = this.wsTickets.get(ticket);
    // Einmal und nicht wieder: auch ein abgelaufener Wert wird entfernt.
    this.wsTickets.delete(ticket);

    return typeof ablauf === 'number' && ablauf > Date.now();
  }

  // --- Kopplung ------------------------------------------------------------

  /**
   * Startet eine Kopplung. Der Code wird vom Aufrufer auf dem Spiegel
   * angezeigt - ohne physischen Zugang zum Raum ist er nicht zu erfahren.
   */
  startPairing(clientIp) {
    const now = Date.now();
    const last = this.lastPairingRequest.get(clientIp) || 0;
    if (now - last < PAIRING_MIN_INTERVAL_MS) {
      const error = new Error('Zu viele Kopplungsversuche. Bitte kurz warten.');
      error.status = 429;
      throw error;
    }
    this.lastPairingRequest.set(clientIp, now);

    // Ziffern und Buchstaben ohne die üblichen Verwechslungen (0/O, 1/I).
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from(crypto.randomBytes(8))
      .map(byte => alphabet[byte % alphabet.length])
      .join('');

    this.pairing = { code, expiresAt: now + PAIRING_TTL_MS, attempts: 0 };
    this.onPairingChange(this.getPairingState());
    return this.getPairingState();
  }

  getPairingState() {
    if (!this.pairing) return { active: false };
    if (this.pairing.expiresAt <= Date.now()) {
      this.pairing = null;
      return { active: false };
    }
    return {
      active: true,
      code: this.pairing.code,
      expiresAt: this.pairing.expiresAt
    };
  }

  cancelPairing() {
    this.pairing = null;
    this.onPairingChange({ active: false });
  }

  /**
   * Löst einen Kopplungscode gegen eine Session ein.
   * Nach fünf Fehlversuchen wird der Code verworfen - 32^8 Möglichkeiten
   * sind zwar nicht zu raten, aber ein Zähler kostet nichts.
   */
  claimPairing(code, label) {
    const state = this.getPairingState();
    if (!state.active) {
      const error = new Error('Es läuft gerade keine Kopplung. Bitte am Spiegel neu starten.');
      error.status = 400;
      throw error;
    }

    this.pairing.attempts += 1;
    if (this.pairing.attempts > 5) {
      this.cancelPairing();
      const error = new Error('Zu viele Fehlversuche. Die Kopplung wurde abgebrochen.');
      error.status = 429;
      throw error;
    }

    const given = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const expected = this.pairing.code;

    // Längenprüfung vor timingSafeEqual: der Vergleich wirft bei ungleicher Länge.
    const matches = given.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));

    if (!matches) {
      const error = new Error('Code stimmt nicht.');
      error.status = 401;
      throw error;
    }

    this.cancelPairing();
    return this.createSession(label);
  }

  /** Anmeldung mit dem Admin-Token aus der .env - der Weg ohne Spiegel. */
  loginWithToken(token, label) {
    const given = Buffer.from(String(token || ''));
    const expected = Buffer.from(this.token);

    const matches = given.length === expected.length &&
      crypto.timingSafeEqual(given, expected);

    if (!matches) {
      const error = new Error('Token stimmt nicht.');
      error.status = 401;
      throw error;
    }

    return this.createSession(label);
  }

  // --- Middleware ----------------------------------------------------------

  static isLoopback(req) {
    const address = req.socket?.remoteAddress || '';
    return address === '127.0.0.1'
      || address === '::1'
      || address === '::ffff:127.0.0.1';
  }

  static readCookie(req, name) {
    const header = req.headers.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
      const index = part.indexOf('=');
      if (index === -1) continue;
      if (part.slice(0, index).trim() === name) {
        return decodeURIComponent(part.slice(index + 1).trim());
      }
    }
    return null;
  }

  sessionFromRequest(req) {
    const cookie = Auth.readCookie(req, SESSION_COOKIE);
    if (this.isValidSession(cookie)) return cookie;

    // Alternative für Skripte und Werkzeuge: Bearer-Token.
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      const token = header.slice(7);
      if (token.length === this.token.length &&
          crypto.timingSafeEqual(Buffer.from(token), Buffer.from(this.token))) {
        return 'bearer';
      }
    }

    return null;
  }

  isAuthenticated(req) {
    if (!this.enabled) return true;
    if (Auth.isLoopback(req)) return true;
    return this.sessionFromRequest(req) !== null;
  }

  middleware(publicPaths = []) {
    return (req, res, next) => {
      if (this.isAuthenticated(req)) return next();
      if (publicPaths.some(prefix => req.path.startsWith(prefix))) return next();

      res.status(401).json({
        error: 'Nicht angemeldet.',
        authRequired: true
      });
    };
  }

  static sessionCookie(sessionId) {
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    // Kein Secure-Flag: der Zugriff läuft im Heimnetz über http.
    return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
  }

  static clearCookie() {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
}

/** Erste nicht-interne IPv4-Adresse - die Adresse für den QR-Code. */
function getLanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return '127.0.0.1';
}

module.exports = { Auth, getLanAddress, SESSION_COOKIE, PAIRING_TTL_MS };
