const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { startBackend } = require('./backend.cjs');

let window;
let backend;
let stopping = false;
let readyToQuit = false;
let status = { state: 'starting', message: '백엔드를 시작하고 있습니다.' };

function publishStatus() {
  if (window && !window.isDestroyed()) {
    window.webContents.send('backend:status', status);
  }
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
    window.loadFile(path.join(__dirname, '../dist/index.html')).catch((error) => {
      console.error('[renderer]', error);
      app.quit();
    });

    const resources = process.resourcesPath;
    try {
      backend = startBackend({
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
  app.on('before-quit', (event) => {
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
