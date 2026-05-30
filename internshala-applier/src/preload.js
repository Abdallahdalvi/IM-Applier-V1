const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dalvi', {
  getConfig:     (user)         => ipcRenderer.invoke('dalvi:get-config', user),
  saveConfig:    (user, config) => ipcRenderer.invoke('dalvi:save-config', { user, config }),
  uploadPdf:     (user)         => ipcRenderer.invoke('dalvi:upload-pdf', user),
  toggleBrowser: ()             => ipcRenderer.invoke('dalvi:toggle-browser'),
  startBot:      (user)         => ipcRenderer.invoke('dalvi:start-bot', user),
  applyOnly:     (user)         => ipcRenderer.invoke('dalvi:apply-only', user),
  stopBot:       ()             => ipcRenderer.invoke('dalvi:stop-bot'),
  fetchModels:   (apiKey)       => ipcRenderer.invoke('dalvi:fetch-models', apiKey),

  onLog:  (cb) => ipcRenderer.on('bot:log',  (_e, d) => cb(d)),
  onDone: (cb) => ipcRenderer.on('bot:done', (_e, d) => cb(d)),
  offLog:  ()  => ipcRenderer.removeAllListeners('bot:log'),
  offDone: ()  => ipcRenderer.removeAllListeners('bot:done'),
});
