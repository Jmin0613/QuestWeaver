const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('questWeaver', {
  request(method, route, body) {
    return ipcRenderer.invoke('backend:request', method, route, body);
  },
  setCloseGuard(guarded) {
    ipcRenderer.send('editor:close-guard', guarded);
  },
  onBackendStatus(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('backend:status', listener);
    ipcRenderer.send('backend:subscribe');
    return () => ipcRenderer.removeListener('backend:status', listener);
  },
});
