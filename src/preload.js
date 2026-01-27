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
  // Module Loading API
  getModuleCode: (moduleName) => ipcRenderer.invoke('get-module-code', moduleName),
  getModuleStyles: (moduleName) => ipcRenderer.invoke('get-module-styles', moduleName),
  getModuleInfo: (moduleName) => ipcRenderer.invoke('get-module-info', moduleName)
});
