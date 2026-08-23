const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const ConfigManager = require('./configManager');
const ModuleLoader = require('./moduleLoader');
const { applyGpuFlags } = require('./gpu');
const updater = require('./updater');
const { Auth, getLanAddress } = require('./auth');
const ThemeManager = require('./themeManager');
const { createBusBridge } = require('./busBridge');
const { createWsHub } = require('./wsHub');
const QRCode = require('qrcode');
const express = require('express');

let mainWindow = null;
let configManager = null;
let moduleLoader = null;
let webServer = null;
let auth = null;
let wsHub = null;

// Ein Bus fuer den gesamten Hauptprozess. Modul-Backends bekommen ihn im
// Kontext und koennen damit den Spiegel und die Web-UI erreichen, ohne beide
// zu kennen.
const { bus, receiveFromRenderer } = createBusBridge({
  getWindows: () => BrowserWindow.getAllWindows(),
  getWsHub: () => wsHub
});

// Warnungen sammeln, sobald der Bus existiert. Modul-Backends melden schon
// beim Registrieren ihrer Routen - also bevor die Startprobe zuhoeren
// koennte.
// Aufraeumarbeiten, die Modul-Backends anmelden. Sie duerfen das NICHT ueber
// eigene process.on('SIGTERM')-Handler tun: ein Signal-Handler ersetzt das
// Standardverhalten, und wenn er nicht selbst beendet, laesst sich die App
// gar nicht mehr stoppen. Genau das ist passiert - pm2 und systemd haetten
// auf dem Pi jedes Mal bis zum SIGKILL warten muessen.
const shutdownHooks = [];
let shuttingDown = false;

function registerShutdownHook(fn) {
  if (typeof fn === 'function') shutdownHooks.push(fn);
}

function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Beende (${reason}) …`);

  for (const hook of shutdownHooks) {
    try {
      hook();
    } catch (error) {
      console.error('Aufräumen fehlgeschlagen:', error.message);
    }
  }

  // Kurze Frist fuer Aufraeumarbeiten, danach wird beendet - egal was noch
  // laeuft.
  const force = setTimeout(() => app.exit(exitCode), 2000);
  force.unref?.();

  app.exit(exitCode);
}

const startupWarnings = [];
bus.on('system:warning', (payload) => {
  if (!payload || !payload.message) return;
  startupWarnings.push({ source: payload.source || 'unbekannt', message: payload.message });
  console.warn(`[${payload.source || 'unbekannt'}] ${payload.message}`);
});

const args = process.argv.slice(2);
const instanceName = args.find(arg => arg.startsWith('--instance='))?.split('=')[1] || process.env.DEFAULT_INSTANCE || 'display1';
const screenIndex = parseInt(args.find(arg => arg.startsWith('--screen='))?.split('=')[1] || '0');
const isDev = args.includes('--dev');
const noServer = args.includes('--no-server');
const customPort = args.find(arg => arg.startsWith('--port='))?.split('=')[1];
const forceDisableGpu = args.includes('--disable-gpu') || process.env.MM_DISABLE_GPU === '1';
// Startprobe: die App faehrt hoch, meldet, ob jedes Modul gemountet ist, und
// beendet sich. Ohne das ist "die Tests sind gruen" kein Beleg dafuer, dass
// der Spiegel ueberhaupt startet.
const smokeMode = args.includes('--smoke');
const smokeTimeoutMs = parseInt(
  args.find(arg => arg.startsWith('--smoke-timeout='))?.split('=')[1] || '30000',
  10
);

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

  loadMirror();

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
      // Geheimnisse mit exposeToRenderer:false bleiben draussen.
      config: configManager.loadConfigForRenderer(),
      modules: moduleLoader.scanModules(),
      instanceName,
      perfProfile
    });
  });
}

/**
 * Laedt die Spiegel-Ansicht.
 *
 * Bevorzugt ueber HTTP; scheitert das - etwa weil dieser Instanz mit
 * --no-server kein Server zur Verfuegung steht oder der Port belegt ist -,
 * wird die Datei direkt geoeffnet. Ein toter Server darf den Spiegel niemals
 * schwarz lassen.
 */
function loadMirror() {
  const fileUrl = path.join(__dirname, '../renderer/index.html');

  if (args.includes('--legacy-file-protocol')) {
    mainWindow.loadFile(fileUrl);
    return;
  }

  const port = customPort || process.env.CONFIG_PORT || 3000;
  const url = `http://127.0.0.1:${port}/mirror/index.html?instance=${encodeURIComponent(instanceName)}`;

  let fallbackUsed = false;
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, failedUrl) => {
    if (fallbackUsed || !failedUrl.startsWith('http://127.0.0.1')) return;
    fallbackUsed = true;
    console.warn(`Spiegel konnte nicht ueber HTTP geladen werden (${errorDescription}), nutze file://`);
    mainWindow.loadFile(fileUrl);
  });

  mainWindow.loadURL(url);
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
  expressApp.use(express.static(path.join(__dirname, '../webui/public'), {
    setHeaders(res, filePath) {
      // Nicht jede Umgebung kennt .webmanifest; ohne den richtigen Typ
      // ignorieren Browser das Manifest stillschweigend und die App laesst
      // sich nicht installieren.
      if (filePath.endsWith('.webmanifest')) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      }
      // Der Service Worker darf nicht aus dem Zwischenspeicher kommen -
      // sonst bleibt eine kaputte Fassung haengen.
      if (filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }));

  // Der Spiegel selbst wird ueber HTTP ausgeliefert statt per file:// geladen.
  // Das loest gleich mehreres auf einmal:
  //   - relative fetch-Aufrufe aus Modulen funktionieren (unter file:// landen
  //     sie auf file:///api/... und schlagen immer fehl),
  //   - dynamisches import() wird moeglich, das Chromium unter file:// sperrt,
  //   - und die Ansicht laesst sich spaeter am Handy oeffnen.
  // http://127.0.0.1 gilt in Chromium als secure context, moderne APIs stehen
  // also zur Verfuegung.
  expressApp.use('/mirror', express.static(path.join(__dirname, '../renderer')));
  expressApp.use('/themes', express.static(path.join(__dirname, '../../themes')));
  // Von Haupt- und Renderer-Prozess gemeinsam genutzte Bausteine (Bus,
  // Manifest-Auslegung). Enthalten keine Geheimnisse.
  expressApp.use('/shared', express.static(path.join(__dirname, '../shared')));

  // Modul-Dateien nur auf Whitelist. backend.js wird bewusst NIE ausgeliefert:
  // es laeuft im Hauptprozess und hat Zugriff auf Konfiguration und .env.
  const MODULE_PUBLIC_FILES = new Set(['index.js', 'styles.css', 'module.json']);

  expressApp.get('/modules/:name/:file', (req, res) => {
    const { name, file } = req.params;

    if (!/^[a-zA-Z0-9_-]+$/.test(name) || !MODULE_PUBLIC_FILES.has(file)) {
      return res.status(404).end();
    }

    const filePath = path.join(__dirname, '../../modules', name, file);
    if (!fs.existsSync(filePath)) return res.status(404).end();

    res.sendFile(filePath);
  });

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
      const savedConfig = instanceConfigManager.loadConfigForRenderer();

      // Ueber den Bus statt von Hand an alle Verbundenen: so bekommen nur
      // Abonnenten die Nachricht, und "origin" verhindert, dass der eigene
      // Speichervorgang die gerade offene Bearbeitung ueberschreibt.
      bus.emit('config:changed', {
        instance,
        origin: req.get('X-MM-Client-Id') || null,
        config: instanceConfigManager.loadConfig({ redact: true })
      });

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
  loader.registerBackendRoutes(expressApp, {
    instanceName,
    ConfigManager,
    fetch,
    bus,
    // Statt eigener Signal-Handler: hier anmelden.
    onShutdown: registerShutdownHook
  });

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

  wsHub = createWsHub({ server: webServer, auth });
}

// IPC Handlers
// Ereignisse aus dem Renderer (spaeter: Gesten, Nutzeraktionen am Spiegel).
ipcMain.on('bus-emit', (event, message) => {
  if (message && typeof message.topic === 'string') {
    receiveFromRenderer(message.topic, message.payload);
  }
});

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

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logCrash('unhandledRejection', reason && reason.stack ? reason.stack : String(reason));
});

/**
 * Startprobe. Wartet darauf, dass der Renderer meldet, welche Module gemountet
 * sind, schreibt eine Zeile auf stdout und beendet sich.
 */
function runSmokeMode() {
  let finished = false;

  const finish = (result) => {
    if (finished) return;
    finished = true;

    // Eine klar erkennbare Zeile - der Rest von stdout ist Electron-Rauschen.
    process.stdout.write(`MM4_SMOKE_RESULT ${JSON.stringify(result)}\n`);

    // Scheitert das Hochfahren, hat weiteres Warten keinen Zweck.
    if (!result.ok) {
      app.exit(1);
      return;
    }

    // Sonst am Leben bleiben: die Startprobe prueft anschliessend noch den
    // Live-Kanal, und dafuer muss der Server laufen. Beendet wird von aussen.
    process.stdout.write('MM4_SMOKE_READY\n');

    // Sicherheitsnetz, falls der Aufrufer verschwindet.
    const guard = setTimeout(() => app.exit(0), 60000);
    guard.unref?.();
  };

  const timer = setTimeout(() => {
    finish({
      ok: false,
      reason: 'timeout',
      message: `Der Renderer hat sich innerhalb von ${smokeTimeoutMs} ms nicht gemeldet.`
    });
  }, smokeTimeoutMs);
  timer.unref?.();

  bus.on('system:modules-rendered', (payload) => {
    const failed = (payload && payload.failed) || [];
    finish({
      ok: failed.length === 0 && startupWarnings.length === 0,
      reason: failed.length > 0
        ? 'module-failed'
        : (startupWarnings.length > 0 ? 'startup-warning' : 'ok'),
      mounted: (payload && payload.mounted) || [],
      failed,
      warnings: startupWarnings,
      theme: payload && payload.theme
    });
  });

  bus.on('system:render-failed', (payload) => {
    finish({ ok: false, reason: 'render-failed', message: payload && payload.error });
  });
}

app.whenReady().then(() => {
  // Server zuerst: das Fenster laedt den Spiegel ueber HTTP und wuerde sonst
  // auf die Rueckfallebene file:// fallen, nur weil der Port noch nicht
  // lauscht.
  startWebServer();
  if (smokeMode) runSmokeMode();
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
