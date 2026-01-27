const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const ConfigManager = require('./configManager');
const ModuleLoader = require('./moduleLoader');
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
    transparent: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

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
      instanceName
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
      // Pull and reboot system (via PM2)
      exec('git pull && npm install', (error, stdout, stderr) => {
        if (error) {
          return res.status(500).json({ error: error.message, details: stderr });
        }
        res.json({ success: true, log: stdout });

        // Restart after a short delay
        setTimeout(() => {
          exec('pm2 restart all', (e) => {
            if (e) console.error('Auto-Restart failed:', e);
          });
        }, 2000);
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

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  app.setPath('userData', path.join(userDataPath, instanceName));
  createWindow();
  startWebServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
