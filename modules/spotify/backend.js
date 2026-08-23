const crypto = require('node:crypto');
const { TokenStore, createPkcePair } = require('../../src/main/integrations/tokenStore');

/**
 * Spotify-Anbindung.
 *
 * Die Einrichtung war bisher nur am Spiegel selbst möglich, nicht am Handy -
 * und genau das war der Wunsch. Das lag an Spotifys Regeln für die
 * Rückleitungsadresse, nicht an einer Nachlässigkeit:
 *
 *   Seit dem 27.11.2025 erlaubt Spotify als Redirect-URI nur noch https://
 *   oder wörtliche Loopback-Adressen (http://127.0.0.1:PORT). LAN-Adressen,
 *   .local-Namen und sogar "localhost" sind verboten.
 *
 * Auf die Adresse des Pi umzubiegen ist damit unmöglich. Die alte Fassung
 * startete deshalb einen zweiten Server auf 127.0.0.1:8080 - der ist vom
 * Handy aus aber nicht erreichbar, denn dort zeigt 127.0.0.1 auf das Handy.
 *
 * Der Weg hier: eine HTTPS-Seite auf GitHub Pages ist die registrierte
 * Rückleitung. Sie liest die Adresse des Spiegels aus dem state - so, wie das
 * Handy ihn tatsächlich erreicht hat - und leitet dorthin weiter. Eine
 * HTTPS-zu-HTTP-Weiterleitung ist als Seitenaufruf erlaubt; die
 * Mixed-Content-Sperre gilt für nachgeladene Inhalte, nicht für Navigation.
 * Klappt das nicht, gibt es den Code zum Einfügen.
 *
 * Kein Client-Secret mehr: PKCE reicht, und damit muss man beim Einrichten
 * nur noch einen Wert abtippen statt zwei.
 */

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

const DEFAULT_REDIRECT = 'https://futureman0.github.io/MagicMirror-4/spotify-callback/';

const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state'
].join(' ');

const PENDING_TTL_MS = 10 * 60 * 1000;
// Mehrere Anzeigen fragen denselben Titel ab; ohne kurzen Zwischenspeicher
// wären das bei zwei Displays doppelt so viele Anfragen an Spotify.
const NOW_PLAYING_CACHE_MS = 2000;

function registerRoutes(app, context) {
  const { instanceName, ConfigManager, bus, onShutdown } = context;

  const configManager = new ConfigManager(instanceName);
  const tokens = new TokenStore({
    envKey: 'SPOTIFY_REFRESH_TOKEN',
    readEnv: () => configManager._readEnvFile(),
    writeEnv: (vars) => configManager._writeEnvFile(vars)
  });

  // Laufende Anmeldevorgänge: nonce -> { verifier, clientId, expiresAt }
  const pending = new Map();
  let nowPlayingCache = { at: 0, value: null };

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [nonce, entry] of pending) {
      if (entry.expiresAt < now) pending.delete(nonce);
    }
  }, 60000);
  sweep.unref?.();

  if (typeof onShutdown === 'function') onShutdown(() => clearInterval(sweep));

  function readConfig(instance = instanceName) {
    const manager = new ConfigManager(instance);
    const config = manager.loadConfig();
    return (config.modules || []).find(m => m.module === 'spotify')?.config || {};
  }

  function redirectUri() {
    return readConfig().redirectUri || DEFAULT_REDIRECT;
  }

  /** Die Adresse, unter der dieses Gerät den Spiegel gerade erreicht. */
  function returnAddress(req) {
    const host = req.get('host');
    if (!host) return null;
    return `${req.protocol}://${host}`;
  }

  async function exchange(body) {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString()
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error_description || data.error || `HTTP ${response.status}`);
    }

    return data;
  }

  async function accessToken() {
    return tokens.getAccessToken(async (refreshToken) => {
      const config = readConfig();
      const data = await exchange({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId
      });

      return {
        accessToken: data.access_token,
        expiresIn: data.expires_in,
        // Unter PKCE rotiert Spotify den Refresh-Token bei jeder Erneuerung.
        refreshToken: data.refresh_token
      };
    });
  }

  async function spotifyRequest(path, { method = 'GET' } = {}) {
    const token = await accessToken();

    const response = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` }
    });

    // 204 heisst "nichts läuft" - kein Fehler.
    if (response.status === 204) return null;

    if (response.status === 401) {
      const error = new Error('Zugang abgelaufen. Bitte neu verbinden.');
      error.code = 'UNAUTHORIZED';
      throw error;
    }

    if (!response.ok) {
      throw new Error(`Spotify antwortete mit ${response.status}`);
    }

    return response.status === 202 ? null : response.json().catch(() => null);
  }

  // --- Anmeldevorgang ------------------------------------------------------

  app.get('/api/spotify/auth-url', (req, res) => {
    try {
      const config = readConfig(req.query.instance);
      if (!config.clientId) {
        return res.status(400).json({ error: 'Es fehlt noch die Client ID.' });
      }

      const back = returnAddress(req);
      if (!back) {
        return res.status(400).json({ error: 'Die Adresse dieses Spiegels ließ sich nicht bestimmen.' });
      }

      const { verifier, challenge } = createPkcePair();
      const nonce = crypto.randomBytes(16).toString('hex');

      pending.set(nonce, {
        verifier,
        clientId: config.clientId,
        instance: req.query.instance || instanceName,
        expiresAt: Date.now() + PENDING_TTL_MS
      });

      // Der state trägt die Rückadresse mit. Damit übersteht der Vorgang auch
      // einen Wechsel der IP-Adresse und funktioniert gleichermaßen über
      // Hostname oder IP.
      const state = Buffer.from(JSON.stringify({ n: nonce, r: back })).toString('base64url');

      const url = `${AUTH_URL}?${new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        scope: SCOPES,
        redirect_uri: redirectUri(),
        code_challenge_method: 'S256',
        code_challenge: challenge,
        state
      })}`;

      res.json({ authUrl: url, redirectUri: redirectUri() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  async function completeAuth(code, state) {
    let nonce;
    try {
      nonce = JSON.parse(Buffer.from(state, 'base64url').toString()).n;
    } catch {
      throw new Error('Der state ist unlesbar.');
    }

    const entry = pending.get(nonce);
    if (!entry) {
      throw new Error('Dieser Anmeldevorgang ist abgelaufen. Bitte neu starten.');
    }
    pending.delete(nonce);

    const data = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: entry.clientId,
      code_verifier: entry.verifier
    });

    if (!data.refresh_token) {
      throw new Error('Spotify hat keinen Refresh-Token geliefert.');
    }

    tokens.saveRefreshToken(data.refresh_token);
    if (bus) bus.emit('spotify:connected', { connected: true });

    return true;
  }

  app.get('/api/spotify/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`/?spotify=error&reason=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return res.redirect('/?spotify=error&reason=missing');
    }

    try {
      await completeAuth(String(code), String(state));
      res.redirect('/?tab=modules&spotify=ok');
    } catch (err) {
      res.redirect(`/?spotify=error&reason=${encodeURIComponent(err.message)}`);
    }
  });

  /** Rückfallebene: der Code wird von Hand eingefügt. */
  app.post('/api/spotify/paste-code', async (req, res) => {
    try {
      const { code, state } = req.body || {};
      if (!code || !state) {
        return res.status(400).json({ ok: false, error: 'Code und state werden benötigt.' });
      }

      await completeAuth(String(code).trim(), String(state).trim());
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/spotify/auth-status', (req, res) => {
    const config = readConfig(req.query.instance);
    res.json({
      hasClientId: Boolean(config.clientId),
      connected: tokens.hasRefreshToken(),
      redirectUri: redirectUri()
    });
  });

  app.post('/api/spotify/disconnect', (req, res) => {
    tokens.clear();
    if (bus) bus.emit('spotify:connected', { connected: false });
    res.json({ ok: true });
  });

  // --- Wiedergabe ----------------------------------------------------------

  app.get('/api/spotify/now-playing', async (req, res) => {
    if (Date.now() - nowPlayingCache.at < NOW_PLAYING_CACHE_MS) {
      return res.json(nowPlayingCache.value);
    }

    try {
      const data = await spotifyRequest('/me/player/currently-playing');

      const value = {
        ok: true,
        fetchedAt: Date.now(),
        stale: false,
        error: null,
        data: data && data.item ? {
          isPlaying: Boolean(data.is_playing),
          progressMs: data.progress_ms || 0,
          track: {
            name: data.item.name,
            artists: (data.item.artists || []).map(a => a.name),
            album: data.item.album?.name || '',
            durationMs: data.item.duration_ms || 0,
            coverUrl: data.item.album?.images?.[0]?.url || null,
            id: data.item.id
          },
          device: data.device ? { name: data.device.name, volume: data.device.volume_percent } : null
        } : null
      };

      nowPlayingCache = { at: Date.now(), value };
      res.json(value);
    } catch (error) {
      const value = {
        ok: false,
        fetchedAt: Date.now(),
        stale: true,
        error: { message: error.message, code: error.code || null },
        data: nowPlayingCache.value?.data || null
      };
      nowPlayingCache = { at: Date.now(), value };
      res.json(value);
    }
  });

  // Nur diese Aktionen - kein Durchreichen beliebiger Pfade an Spotify.
  const CONTROLS = {
    play: { path: '/me/player/play', method: 'PUT' },
    pause: { path: '/me/player/pause', method: 'PUT' },
    next: { path: '/me/player/next', method: 'POST' },
    previous: { path: '/me/player/previous', method: 'POST' }
  };

  app.post('/api/spotify/control', async (req, res) => {
    const action = String(req.body?.action || '');
    const control = CONTROLS[action];

    if (!control) {
      return res.status(400).json({ ok: false, error: `Unbekannte Aktion: ${action}` });
    }

    try {
      await spotifyRequest(control.path, { method: control.method });
      // Der nächste Abruf soll den neuen Zustand sehen, nicht den gerade
      // zwischengespeicherten.
      nowPlayingCache = { at: 0, value: nowPlayingCache.value };
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}

module.exports = {
  registerRoutes,
  // Für Tests.
  _internals: { DEFAULT_REDIRECT, SCOPES }
};
