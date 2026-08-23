const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const ConfigManager = require('./configManager');
const ModuleLoader = require('./moduleLoader');
const { applyGpuFlags } = require('./gpu');
const express = require('express');
const WebSocket = require('ws');
const fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

let mainWindow = null;
let configManager = null;
let moduleLoader = null;
let presenceModule = null;
let webServer = null;
let wss = null;

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

  expressApp.use(express.json());
  expressApp.use(express.static(path.join(__dirname, '../webui/public')));

  expressApp.get('/api/config', (req, res) => {
    const instance = req.query.instance || instanceName;
    const instanceConfigManager = new ConfigManager(instance);
    res.json(instanceConfigManager.loadConfig());
  });

  expressApp.put('/api/config', (req, res) => {
    try {
      const instance = req.query.instance || instanceName;
      const instanceConfigManager = new ConfigManager(instance);
      instanceConfigManager.saveConfig(req.body);
      if (wss) {
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'config-updated', instance }));
          }
        });
      }
      if (mainWindow && instance === instanceName) {
        mainWindow.webContents.send('config-update', req.body);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  expressApp.get('/api/modules', (req, res) => {
    const loader = moduleLoader || new ModuleLoader(path.join(__dirname, '../../modules'));
    res.json(loader.scanModules().map(m => ({ name: m.name, info: m.info })));
  });

  const loader = moduleLoader || new ModuleLoader(path.join(__dirname, '../../modules'));
  loader.registerBackendRoutes(expressApp, { instanceName, ConfigManager, fetch });

  // Update Endpoints
  expressApp.get('/api/update/check', async (req, res) => {
    try {
      const { exec } = require('child_process');
      exec('git fetch && git status -uno', (error, stdout, stderr) => {
        if (error) {
          return res.status(500).json({ error: error.message });
        }
        const hasUpdate = stdout.includes('behind');
        res.json({ updateAvailable: hasUpdate });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  expressApp.post('/api/update/execute', async (req, res) => {
    try {
      const { exec } = require('child_process');
      
      // Get project directory (two levels up from src/main/main.js)
      const projectDir = path.join(__dirname, '../..');
      
      // Get current user (not root)
      const currentUser = process.env.USER || process.env.SUDO_USER || 'pi';
      
      // Step 1: Stash local changes if any (prevents merge conflicts)
      exec(`cd "${projectDir}" && git stash push -m "Auto-stashed before update"`, (stashError, stashStdout, stashStderr) => {
        const hasLocalChanges = !stashError && stashStdout.includes('Saved working directory');
        
        // Step 2: Pull latest changes
        exec(`cd "${projectDir}" && git pull`, (pullError, pullStdout, pullStderr) => {
          if (pullError) {
            return res.status(500).json({ 
              error: pullError.message, 
              details: pullStderr,
              note: hasLocalChanges ? 'Local changes were stashed. Use "git stash list" to see them.' : ''
            });
          }
          
          // Step 3: Install dependencies (as the correct user, not root)
          exec(`cd "${projectDir}" && sudo -u ${currentUser} npm install`, (npmError, npmStdout, npmStderr) => {
            if (npmError) {
              return res.status(500).json({ 
                error: npmError.message, 
                details: npmStderr,
                note: 'Git pull succeeded but npm install failed. Try running manually: cd ~/MagicMirror-4 && npm install'
              });
            }
            
            let logMessage = pullStdout + '\n\n' + npmStdout;
            if (hasLocalChanges) {
              logMessage += '\n\nNote: Local changes were automatically stashed. Use "git stash list" to review them.';
            }
            
            res.json({ 
              success: true, 
              log: logMessage,
              stashedChanges: hasLocalChanges
            });

            // Restart after a short delay
            setTimeout(() => {
              exec('pm2 restart all', (e) => {
                if (e) console.error('Auto-Restart failed:', e);
              });
            }, 2000);
          });
        });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  webServer = expressApp.listen(port, () => {
    console.log(`Web Config Server läuft auf http://localhost:${port}`);
  });

  wss = new WebSocket.Server({ server: webServer });
}

// IPC Handlers
ipcMain.handle('get-module-code', async (event, moduleName) => {
  const modulePath = path.join(__dirname, '../../modules', moduleName, 'index.js');
  if (fs.existsSync(modulePath)) {
    const code = fs.readFileSync(modulePath, 'utf8');
    const browserCode = code.replace(/module\.exports\s*=\s*/g, 'return ').replace(/require\([^)]+\)/g, '{}');
    return { success: true, code: browserCode };
  }
  return { success: false, error: 'Modul nicht gefunden' };
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
