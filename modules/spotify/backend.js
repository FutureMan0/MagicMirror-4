// Spotify Backend Routes für OAuth-Flow

let authState = {}; // Temporärer State-Storage (in Produktion: Redis/DB verwenden)
let callbackServer = null; // Separater Server für Spotify Callback

function registerRoutes(app, { instanceName, ConfigManager, fetch }) {
  const crypto = require('crypto');
  const express = require('express');

  // OAuth-Flow starten
  app.get('/api/spotify/auth-url', (req, res) => {
    try {
      const instance = req.query.instance || instanceName;
      const configManager = new ConfigManager(instance);
      const config = configManager.loadConfig();

      // Finde Spotify-Modul in Config
      const spotifyModule = config.modules?.find(m => m.module === 'spotify');
      if (!spotifyModule || !spotifyModule.config) {
        return res.status(400).json({ error: 'Spotify-Modul nicht in Config gefunden.' });
      }

      const clientId = spotifyModule.config.clientId || process.env.SPOTIFY_CLIENT_ID;
      if (!clientId) {
        return res.status(400).json({ error: 'Spotify Client ID nicht konfiguriert.' });
      }

      // Generiere State für CSRF-Protection
      const state = crypto.randomBytes(16).toString('hex');
      authState[instance] = { state, status: 'pending', timestamp: Date.now() };

      // Spotify OAuth URL (verwende 127.0.0.1 statt localhost - ohne trailing slash!)
      const redirectUri = 'http://127.0.0.1:8080/callback';
      const scope = 'user-read-currently-playing user-read-playback-state';
      
      const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        scope: scope,
        redirect_uri: redirectUri,
        state: state
      }).toString();

      res.json({ authUrl });
    } catch (error) {
      console.error('Fehler beim Generieren der Auth-URL:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Starte separaten Callback-Server auf Port 9999 (wenn noch nicht gestartet)
  if (!callbackServer) {
    const callbackApp = express();
    
    // Unterstütze beide Varianten (mit und ohne trailing slash)
    callbackApp.get('/callback', async (req, res) => {
      await handleSpotifyCallback(req, res, { instanceName, ConfigManager, fetch });
    });
    
    callbackApp.get('/callback/', async (req, res) => {
      await handleSpotifyCallback(req, res, { instanceName, ConfigManager, fetch });
    });
    
    callbackServer = callbackApp.listen(8080, '127.0.0.1', () => {
      console.log('✓ Spotify Callback Server läuft auf http://127.0.0.1:8080');
    });
  }

  // OAuth Callback Handler (wird von beiden Servern verwendet)
  async function handleSpotifyCallback(req, res, context) {
    const code = req.query.code;
    const state = req.query.state;
    const error = req.query.error;

    if (error) {
      console.error('Spotify OAuth Fehler:', error);
      return res.send(`
        <html>
          <head><title>Spotify Auth Fehler</title></head>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1 style="color: red;">❌ Authentifizierung fehlgeschlagen</h1>
            <p>${error}</p>
            <p>Du kannst dieses Fenster jetzt schließen.</p>
          </body>
        </html>
      `);
    }

    // Finde Instance anhand des States
    let instance = null;
    for (const [inst, data] of Object.entries(authState)) {
      if (data.state === state) {
        instance = inst;
        break;
      }
    }

    if (!instance) {
      return res.send(`
        <html>
          <head><title>Spotify Auth Fehler</title></head>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1 style="color: red;">❌ Ungültiger State</h1>
            <p>Authentifizierung fehlgeschlagen. Bitte versuche es erneut.</p>
            <p>Du kannst dieses Fenster jetzt schließen.</p>
          </body>
        </html>
      `);
    }

    try {
      const configManager = new context.ConfigManager(instance);
      const config = configManager.loadConfig();

      const spotifyModule = config.modules?.find(m => m.module === 'spotify');
      if (!spotifyModule || !spotifyModule.config) {
        throw new Error('Spotify-Modul nicht in Config gefunden.');
      }

      const clientId = spotifyModule.config.clientId || process.env.SPOTIFY_CLIENT_ID;
      const clientSecret = spotifyModule.config.clientSecret || process.env.SPOTIFY_CLIENT_SECRET;
      const redirectUri = 'http://127.0.0.1:8080/callback';

      // Tausche Authorization Code gegen Access Token & Refresh Token
      const tokenResponse = await context.fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: redirectUri
        }).toString()
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok || !tokenData.refresh_token) {
        throw new Error(tokenData.error_description || 'Token-Austausch fehlgeschlagen.');
      }

      // Speichere Refresh Token in Config
      spotifyModule.config.refreshToken = tokenData.refresh_token;
      configManager.saveConfig(config);

      // Update Auth State
      authState[instance] = { 
        status: 'completed', 
        timestamp: Date.now(),
        refreshToken: tokenData.refresh_token
      };

      res.send(`
        <html>
          <head><title>Spotify Auth Erfolgreich</title></head>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1 style="color: green;">✓ Erfolgreich verbunden!</h1>
            <p>Spotify wurde erfolgreich mit deinem Magic Mirror verbunden.</p>
            <p>Du kannst dieses Fenster jetzt schließen.</p>
            <script>
              setTimeout(() => window.close(), 3000);
            </script>
          </body>
        </html>
      `);
    } catch (error) {
      console.error('Fehler beim Token-Austausch:', error);
      authState[instance] = { 
        status: 'error', 
        error: error.message,
        timestamp: Date.now()
      };
      res.send(`
        <html>
          <head><title>Spotify Auth Fehler</title></head>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1 style="color: red;">❌ Fehler</h1>
            <p>${error.message}</p>
            <p>Du kannst dieses Fenster jetzt schließen.</p>
          </body>
        </html>
      `);
    }
  }

  // Status-Check für Frontend-Polling
  app.get('/api/spotify/auth-status', (req, res) => {
    const instance = req.query.instance || instanceName;
    const state = authState[instance];

    if (!state) {
      return res.json({ status: 'pending' });
    }

    // Cleanup: Entferne State nach 1 Minute wenn completed/error
    if ((state.status === 'completed' || state.status === 'error') && 
        Date.now() - state.timestamp > 60000) {
      delete authState[instance];
    }

    res.json({
      status: state.status,
      error: state.error
    });
  });

  console.log('✓ Spotify Backend Routes registriert');
}

module.exports = { registerRoutes };
