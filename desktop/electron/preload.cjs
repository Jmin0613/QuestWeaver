const { contextBridge, ipcRenderer } = require('electron');

// Native text undo/redo uses Electron menu accelerators. Outside inputs the chart owns them.
function publishTextFocus() {
  const element = document.activeElement;
  ipcRenderer.send('editor:text-focus', !!element?.closest('input, textarea, select, [contenteditable]'));
}
document.addEventListener('focusin', publishTextFocus, true);
document.addEventListener('focusout', () => queueMicrotask(publishTextFocus), true);

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
