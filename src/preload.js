const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onConfigLoaded: (callback) => {
    ipcRenderer.on('config-loaded', (event, data) => callback(data));
  },
  onConfigUpdate: (callback) => {
    ipcRenderer.on('config-update', (event, data) => callback(data));
  },
  onPresenceDetected: (callback) => {
    ipcRenderer.on('presence-detected', () => callback());
  },
  onPresenceLost: (callback) => {
    ipcRenderer.on('presence-lost', () => callback());
  },
  // Kopplung: der Code wird auf dem Spiegel angezeigt, damit ihn nur sehen
  // kann, wer im Raum steht.
  onPairingStarted: (callback) => {
    ipcRenderer.on('pairing-started', (event, data) => callback(data));
  },
  onPairingEnded: (callback) => {
    ipcRenderer.on('pairing-ended', () => callback());
  },
  // Module Loading API
  getModuleStyles: (moduleName) => ipcRenderer.invoke('get-module-styles', moduleName),
  getModuleInfo: (moduleName) => ipcRenderer.invoke('get-module-info', moduleName)
});
