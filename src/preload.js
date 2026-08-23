const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onConfigLoaded: (callback) => {
    ipcRenderer.on('config-loaded', (event, data) => callback(data));
  },
  onConfigUpdate: (callback) => {
    ipcRenderer.on('config-update', (event, data) => callback(data));
  },
  // Kopplung: der Code wird auf dem Spiegel angezeigt, damit ihn nur sehen
  // kann, wer im Raum steht.
  onPairingStarted: (callback) => {
    ipcRenderer.on('pairing-started', (event, data) => callback(data));
  },
  onPairingEnded: (callback) => {
    ipcRenderer.on('pairing-ended', () => callback());
  },
  // Ereignis-Bus. Ersetzt die einzelnen presence-*-Kanaele: der Renderer
  // abonniert Themen, statt fuer jede Nachricht einen eigenen IPC-Kanal zu
  // brauchen.
  onBusEvent: (callback) => {
    ipcRenderer.on('bus-event', (event, envelope) => callback(envelope));
  },
  emitBusEvent: (topic, payload) => {
    ipcRenderer.send('bus-emit', { topic, payload });
  },

  // Module Loading API
  getModuleStyles: (moduleName) => ipcRenderer.invoke('get-module-styles', moduleName),
  getModuleInfo: (moduleName) => ipcRenderer.invoke('get-module-info', moduleName)
});
