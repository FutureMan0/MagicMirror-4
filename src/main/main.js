const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const ConfigManager = require('./configManager');
const ModuleLoader = require('./moduleLoader');
const { applyGpuFlags } = require('./gpu');
const updater = require('./updater');
const { Auth, getLanAddress } = require('./auth');
const ThemeManager = require('./themeManager');
const QRCode = require('qrcode');
const express = require('express');
const WebSocket = require('ws');
const fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

let mainWindow = null;
let configManager = null;
let moduleLoader = null;
let webServer = null;
let wss = null;
let auth = null;

const args = process.argv.slice(2);
const instanceName = args.find(arg => arg.startsWith('--instance='))?.split('=')[1] || process.env.DEFAULT_INSTANCE || 'display1';
const screenIndex = parseInt(args.find(arg => arg.startsWith('--screen='))?.split('=')[1] || '0');
const isDev = args.includes('--dev');
const noServer = args.includes('--no-server');
const customPort = args.find(arg => arg.startsWith('--port='))?.split('=')[1];
const forceDisableGpu = args.includes('--disable-gpu') || process.env.MM_DISABLE_GPU === '1';

// Chromium-Flags und userData-Pfad MUESSEN vor app.whenReady() gesetzt werden.
// Der userData-Pfad wurde bislang erst danach umgebogen - zu diesem Zeitpunkt
// hatte Chromium das Standardverzeichnis schon geoeffnet, weshalb sich zwei
// Instanzen (display1/display2) um dieselben Cache-Dateien stritten.
const perfProfile = applyGpuFlags(app, { disableGpu: forceDisableGpu });
app.setPath('userData', path.join(app.getPath('userData'), instanceName));

let windowRetryCount = 0;
let windowRetryWindowStart = Date.now();
let gpuCrashCount = 0;

function logCrash(kind, detail) {
  const line = `[${new Date().toISOString()}] ${kind}: ${detail}\n`;
  console.error(line.trim());
  try {
    const logDir = path.join(__dirname, '../../logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'crash.log'), line);
  } catch (e) {
    // Logging darf niemals der Grund sein, warum wir nicht sauber beenden.
  }
}

function createWindow() {
  configManager = new ConfigManager(instanceName);
  const config = configManager.loadConfig();

  const displays = screen.getAllDisplays();
  const targetDisplay = displays[screenIndex] || displays[0];

  mainWindow = new BrowserWindow({
    width: targetDisplay.size.width,
    height: targetDisplay.size.height,
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    fullscreen: !isDev,
    frame: false,
    // Kein transparent:true. Der Hintergrund ist ohnehin deckend schwarz,
    // aber ein transparentes Fenster zwingt den Compositor unter X11 auf einen
    // alpha-gemischten Pfad ohne Hardware-Overlay.
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Erst zeigen, wenn wirklich etwas zu sehen ist - sonst blitzt beim Start
  // ein leeres Fenster auf.
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.on('unresponsive', () => {
    logCrash('unresponsive', 'renderer reagiert nicht, lade in 10s neu');
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    }, 10000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.setKiosk(true);
  }

  moduleLoader = new ModuleLoader(path.join(__dirname, '../../modules'));

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('config-loaded', {
      config,
      modules: moduleLoader.scanModules(),
      instanceName,
      perfProfile
    });
  });
}

function startWebServer() {
  if (noServer) return;

  const expressApp = express();
  const port = customPort || process.env.CONFIG_PORT || 3000;

  // Nicht aktivieren: mit `trust proxy` koennte ein X-Forwarded-For-Header
  // eine entfernte Anfrage als Loopback ausgeben und die Anmeldung umgehen.
  expressApp.disable('trust proxy');
  expressApp.disable('x-powered-by');

  expressApp.use(express.json());

  const envHelper = new ConfigManager(instanceName);
  auth = new Auth({
    configDir: path.join(__dirname, '../../config'),
    envPath: envHelper.envPath,
    readEnv: () => envHelper._readEnvFile(),
    writeEnv: (vars) => envHelper._writeEnvFile(vars)
  });

  if (!auth.enabled) {
    console.warn('');
    console.warn('  !!  MM_AUTH=off - der Konfigurations-Server ist UNGESCHUETZT.');
    console.warn('  !!  Jeder im Netzwerk kann Einstellungen aendern und Updates ausloesen.');
    console.warn('');
  }

  // Der Kopplungscode wird auf dem Spiegel angezeigt. Wer ihn lesen kann,
  // steht im Raum - das ist der eigentliche Nachweis.
  auth.onPairingChange = async (state) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (!state.active) {
      mainWindow.webContents.send('pairing-ended');
      return;
    }

    const url = `http://${getLanAddress()}:${port}/?pair=${state.code}`;
    let svg = null;
    try {
      svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 320 });
    } catch (error) {
      console.error('QR-Code konnte nicht erzeugt werden:', error.message);
    }

    mainWindow.webContents.send('pairing-started', {
      code: state.code,
      url,
      svg,
      expiresAt: state.expiresAt
    });
  };

  // Statische Dateien bleiben oeffentlich - sonst laedt die Anmeldeseite nicht.
  expressApp.use(express.static(path.join(__dirname, '../webui/public')));

  expressApp.get('/api/auth/status', (req, res) => {
    res.json({
      authRequired: auth.enabled,
      authenticated: auth.isAuthenticated(req),
      isLocal: Auth.isLoopback(req),
      pairing: { active: auth.getPairingState().active }
    });
  });

  expressApp.post('/api/auth/pair/start', (req, res) => {
    try {
      const state = auth.startPairing(req.socket.remoteAddress || 'unbekannt');
      // Der Code selbst wird NICHT zurueckgegeben - er steht auf dem Spiegel.
      res.json({ started: true, expiresAt: state.expiresAt });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  expressApp.post('/api/auth/pair/claim', (req, res) => {
    try {
      const label = (req.headers['user-agent'] || 'unbekanntes Geraet').slice(0, 120);
      const sessionId = auth.claimPairing(req.body?.code, label);
      res.setHeader('Set-Cookie', Auth.sessionCookie(sessionId));
      res.json({ success: true });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  expressApp.post('/api/auth/login', (req, res) => {
    try {
      const label = (req.headers['user-agent'] || 'unbekanntes Geraet').slice(0, 120);
      const sessionId = auth.loginWithToken(req.body?.token, label);
      res.setHeader('Set-Cookie', Auth.sessionCookie(sessionId));
      res.json({ success: true });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  expressApp.post('/api/auth/logout', (req, res) => {
    auth.revokeSession(Auth.readCookie(req, 'mm4_session'));
    res.setHeader('Set-Cookie', Auth.clearCookie());
    res.json({ success: true });
  });

  // Ab hier ist alles unter /api geschuetzt.
  expressApp.use('/api', auth.middleware(['/auth/']));

  expressApp.get('/api/config', (req, res) => {
    const instance = req.query.instance || instanceName;
    const instanceConfigManager = new ConfigManager(instance);
    // Ueber HTTP niemals Klartext-Geheimnisse. Der Renderer bekommt die
    // vollstaendige Config weiterhin ueber IPC.
    res.json(instanceConfigManager.loadConfig({ redact: true }));
  });

  expressApp.put('/api/config', (req, res) => {
    try {
      const instance = req.query.instance || instanceName;
      const instanceConfigManager = new ConfigManager(instance);
      instanceConfigManager.saveConfig(req.body);

      // Frisch laden statt req.body weiterzureichen: der Body enthaelt fuer
      // unveraenderte Geheimnisse nur den Platzhalter "__SET__", der Spiegel
      // braucht aber die echten Werte.
      const savedConfig = instanceConfigManager.loadConfig();

      if (wss) {
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'config-updated', instance }));
          }
        });
      }
      if (mainWindow && instance === instanceName) {
        mainWindow.webContents.send('config-update', savedConfig);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Themes werden aus dem Verzeichnis gelesen, nicht in der Oberflaeche
  // aufgezaehlt. Ein neuer Ordner unter themes/ taucht damit sofort auf.
  expressApp.get('/api/themes', (req, res) => {
    const themeManager = new ThemeManager(path.join(__dirname, '../../themes'));
    res.json(themeManager.scanThemes());
  });

  expressApp.get('/api/modules', (req, res) => {
    const loader = moduleLoader || new ModuleLoader(path.join(__dirname, '../../modules'));
    const secretsHelper = new ConfigManager(instanceName);
    res.json(loader.scanModules().map(m => ({
      name: m.name,
      info: m.info,
      // Damit die Web-UI diese Felder maskiert darstellt und beim Speichern
      // nicht versehentlich den Platzhalter zurueckschreibt.
      secretFields: secretsHelper.getSecretFields(m.name)
    })));
  });

  const loader = moduleLoader || new ModuleLoader(path.join(__dirname, '../../modules'));
  loader.registerBackendRoutes(expressApp, { instanceName, ConfigManager, fetch });

  // Update Endpoints. Die eigentliche Arbeit liegt in src/main/updater.js -
  // dort werden ausschliesslich execFile-Aufrufe mit Argument-Arrays benutzt,
  // damit nichts mehr durch eine Shell laeuft.
  expressApp.get('/api/update/check', async (req, res) => {
    try {
      res.json(await updater.checkForUpdate());
    } catch (error) {
      res.status(500).json({ error: error.message, details: error.stderr });
    }
  });

  expressApp.post('/api/update/execute', async (req, res) => {
    try {
      const result = await updater.executeUpdate();
      res.json({ success: true, log: result.log });

      // Kurz warten, damit die Antwort den Client sicher erreicht.
      setTimeout(() => {
        updater.restart((error) => {
          console.error('Auto-Restart fehlgeschlagen:', error.message);
        });
      }, 2000);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        code: error.code,
        details: error.details || error.stderr
      });
    }
  });

  webServer = expressApp.listen(port, () => {
    console.log(`Web Config Server läuft auf http://localhost:${port}`);
  });

  wss = new WebSocket.Server({ server: webServer });
}

// IPC Handlers
ipcMain.handle('get-module-styles', async (event, moduleName) => {
  const stylesPath = path.join(__dirname, '../../modules', moduleName, 'styles.css');
  return { success: true, styles: fs.existsSync(stylesPath) ? fs.readFileSync(stylesPath, 'utf8') : '' };
});

ipcMain.handle('get-module-info', async (event, moduleName) => {
  const infoPath = path.join(__dirname, '../../modules', moduleName, 'module.json');
  return { success: true, info: fs.existsSync(infoPath) ? JSON.parse(fs.readFileSync(infoPath, 'utf8')) : {} };
});

// Ein abgestuerzter Renderer hinterliess bisher ein schwarzes Fenster: der
// Hauptprozess lebte weiter, also griff auch der Neustart durch pm2/systemd
// nicht. Jetzt bauen wir das Fenster selbst neu auf - und geben auf, wenn das
// wiederholt scheitert, damit der Prozessmanager uebernehmen kann.
function recreateWindow(reason) {
  const now = Date.now();
  if (now - windowRetryWindowStart > 60000) {
    windowRetryWindowStart = now;
    windowRetryCount = 0;
  }

  windowRetryCount += 1;
  if (windowRetryCount > 5) {
    logCrash('give-up', `${reason} - 5 Neuversuche in 60s, beende Prozess`);
    app.exit(1);
    return;
  }

  logCrash('recreate-window', `${reason} (Versuch ${windowRetryCount})`);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  mainWindow = null;
  setTimeout(createWindow, 1000 * windowRetryCount);
}

app.on('render-process-gone', (event, webContents, details) => {
  recreateWindow(`render-process-gone (${details.reason})`);
});

app.on('child-process-gone', (event, details) => {
  logCrash('child-process-gone', `${details.type}: ${details.reason}`);

  if (details.type === 'GPU') {
    gpuCrashCount += 1;
    if (gpuCrashCount >= 3 && !forceDisableGpu) {
      logCrash('gpu-fallback', 'dritter GPU-Absturz, Neustart ohne Hardware-Beschleunigung');
      app.relaunch({ args: process.argv.slice(1).concat(['--disable-gpu']) });
      app.exit(0);
    }
  }
});

// Der zentrale Handler. Ein Modul-Backend hatte bisher einen eigenen
// installiert, der Fehler schluckte und den Prozess weiterlaufen liess.
process.on('uncaughtException', (err) => {
  logCrash('uncaughtException', err && err.stack ? err.stack : String(err));
  app.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logCrash('unhandledRejection', reason && reason.stack ? reason.stack : String(reason));
});

app.whenReady().then(() => {
  createWindow();
  startWebServer();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
