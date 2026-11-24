const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('questWeaver', {
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  saveAiKey: (value, store) => ipcRenderer.invoke('ai:save', value, store),
  deleteAiKey: () => ipcRenderer.invoke('ai:delete'),
  openAiKeyPage: () => ipcRenderer.invoke('ai:key-page'),
  request(method, route, body) {
    return ipcRenderer.invoke('backend:request', method, route, body);
  },
  saveFlowPng(title, bytes) {
    return ipcRenderer.invoke('flow:save-png', title, bytes);
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
