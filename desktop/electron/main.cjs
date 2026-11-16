const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { startBackend } = require('./backend.cjs');
const { savePng } = require('./pngExport.cjs');

let window;
let backend;
let stopping = false;
let readyToQuit = false;
let closeGuard = false;
let closeConfirmed = false;
let status = { state: 'starting', message: '백엔드를 시작하고 있습니다.' };

const allowedRoutes = {
  GET: /^\/api\/(?:ai\/flow\/status|games(?:\/\d+\/regions)?|quests(?:\?[^#]*|\/[a-f\d-]{36}(?:\/flow)?)?)$/,
  POST: /^\/api\/(?:flow\/inspect|games(?:\/\d+\/regions)?|quests\/[a-f\d-]{36}\/flow\/generate)$/,
  PUT: /^\/api\/quests\/[a-f\d-]{36}(?:\/flow)?$/,
  DELETE: /^\/api\/quests\/[a-f\d-]{36}$/,
};

function publishStatus() {
  if (window && !window.isDestroyed()) {
    window.webContents.send('backend:status', status);
  }
}

function isAppFrame(event) {
  return window && !window.isDestroyed() && event.senderFrame === window.webContents.mainFrame;
}

function confirmClose() {
  return dialog.showMessageBoxSync(window, {
    type: 'warning',
    title: 'QuestWeaver',
    message: '저장하지 않은 변경이 있습니다. 앱을 닫을까요?',
    buttons: ['계속 작성', '앱 닫기'],
    defaultId: 0,
    cancelId: 0,
  }) === 1;
}

// Select the development profile before Electron acquires its instance lock.
if (!app.isPackaged) {
  const developmentProfile = app.getPath('userData') + '-dev';
  mkdirSync(developmentProfile, { recursive: true });
  app.setPath('userData', developmentProfile);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window || window.isDestroyed() || stopping) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  ipcMain.on('backend:subscribe', (event) => {
    if (window && !window.isDestroyed() && event.sender === window.webContents) {
      publishStatus();
    }
  });

  ipcMain.handle('backend:request', async (event, method, route, body) => {
    if (!isAppFrame(event) || typeof method !== 'string' || !Object.hasOwn(allowedRoutes, method) || typeof route !== 'string'
        || !allowedRoutes[method].test(route)) {
      return { ok: false, message: '지원하지 않는 요청입니다.' };
    }
    if (!backend || stopping) return { ok: false, message: '백엔드에 연결되어 있지 않습니다.' };
    return backend.request(method, route, body);
  });

  ipcMain.handle('flow:save-png', (event, title, bytes) => {
    if (!isAppFrame(event) || stopping) return { status: 'error', message: 'PNG 저장을 시작할 수 없습니다.' };
    return savePng(window, title, bytes);
  });

  ipcMain.on('editor:close-guard', (event, guarded) => {
    if (isAppFrame(event)) closeGuard = guarded === true;
  });

  app.whenReady().then(() => {
    if (stopping) return;
    window = new BrowserWindow({
      width: 960,
      height: 640,
      minWidth: 420,
      minHeight: 400,
      title: 'QuestWeaver',
      backgroundColor: '#f6f7fb',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.on('close', (event) => {
      if (!closeGuard) return;
      closeConfirmed = confirmClose();
      if (!closeConfirmed) event.preventDefault();
    });
    window.webContents.on('will-prevent-unload', (event) => {
      if (closeConfirmed || confirmClose()) event.preventDefault();
    });
    window.webContents.on('did-finish-load', () => { closeGuard = false; });
    window.loadFile(path.join(__dirname, '../dist/index.html')).catch((error) => {
      console.error('[renderer]', error);
      app.quit();
    });

    const resources = process.resourcesPath;
    try {
      backend = startBackend({
        allowAi: !app.isPackaged,
        java: app.isPackaged
          ? path.join(resources, 'runtime', 'bin', 'java.exe')
          : path.join(process.env.JAVA_HOME, 'bin', 'java.exe'),
        jar: app.isPackaged
          ? path.join(resources, 'backend', 'questweaver.jar')
          : path.join(__dirname, '../../backend/build/libs/questweaver.jar'),
        dataDir: path.join(app.getPath('userData'), 'data'),
        onStatus(nextStatus) {
          status = nextStatus;
          publishStatus();
        },
      });
    } catch (error) {
      console.error('[backend setup]', error);
      status = { state: 'failed', message: '백엔드 실행 환경 또는 데이터 폴더를 확인하세요.' };
      publishStatus();
    }
  });

  app.on('window-all-closed', () => app.quit());
  // A cancelled window close must leave Java running and the editor usable.
  app.on('will-quit', (event) => {
    if (readyToQuit) return;
    stopping = true;
    if (!backend) return;
    event.preventDefault();
    void backend.stop().then(() => {
      if (readyToQuit) return;
      readyToQuit = true;
      app.quit();
    });
  });
}
