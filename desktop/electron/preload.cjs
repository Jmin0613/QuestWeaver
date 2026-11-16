const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('questWeaver', {
  onBackendStatus(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('backend:status', listener);
    ipcRenderer.send('backend:subscribe');
    return () => ipcRenderer.removeListener('backend:status', listener);
  },
});
