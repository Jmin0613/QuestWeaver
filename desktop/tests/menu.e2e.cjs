// Native Windows menu/shortcut verification with an isolated profile and in-memory quest fixtures.
const assert = require('node:assert/strict');
const h = require('./workspace.e2e.cjs');
const { start, run, inMain, button, has, until } = h;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// sendInputEvent targets Chromium, bypassing the native Windows accelerator dispatcher.
// Capture the production routing decision, suppress native dispatch for determinism, then
// execute the matching real menu role only when production allows that accelerator.
const key = async (keyCode, modifiers = []) => {
  await inMain((keyCode, modifiers) => {
    const e = process.mainModule.require('electron'), window = e.BrowserWindow.getAllWindows()[0];
    const wc = window.webContents;
    globalThis.menuShortcutIgnored = true;
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }, keyCode, modifiers);
  await wait(80);
  await inMain((keyCode, modifiers) => {
    if (globalThis.menuShortcutIgnored) return;
    const role = keyCode === 'F11' ? 'togglefullscreen' : modifiers.includes('control')
      ? ({ Z: 'undo', Y: 'redo', A: 'selectall' })[keyCode] : undefined;
    if (!role) return;
    const e = process.mainModule.require('electron'), window = e.BrowserWindow.getAllWindows()[0];
    const item = e.Menu.getApplicationMenu().items.flatMap((item) => item.submenu.items).find((item) => item.role === role);
    item.click({}, window, window.webContents);
  }, keyCode, modifiers);
  await wait(80);
};
const role = async (name) => {
  await inMain((name) => {
    const e = process.mainModule.require('electron'), window = e.BrowserWindow.getAllWindows()[0];
    const item = e.Menu.getApplicationMenu().items.flatMap((item) => item.submenu.items).find((item) => item.role === name);
    item.click({}, window, window.webContents);
  }, name);
  await wait(80);
};
const count = () => run(() => document.querySelectorAll('.flow-layout .react-flow__node').length);
const value = () => run(() => document.getElementById('flow-step-title').value);

async function main() {
  await start();
  await inMain(() => {
    const wc = process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents;
    const original = wc.setIgnoreMenuShortcuts.bind(wc);
    wc.setIgnoreMenuShortcuts = (ignore) => { globalThis.menuShortcutIgnored = ignore; original(true); };
  });
  const menu = await inMain(() => process.mainModule.require('electron').Menu.getApplicationMenu().items.map((item) => ({
    label: item.label, role: item.role,
    children: item.submenu.items.map((item) => ({ label: item.label, role: item.role, type: item.type,
      accelerator: item.accelerator, visible: item.visible })),
  })));
  assert.deepEqual(menu.map((item) => item.label), ['파일', '편집', '보기', '창']);
  const expected = [
    [['종료', 'quit', null]],
    [['실행 취소', 'undo', 'CommandOrControl+Z'], ['다시 실행', 'redo', 'Control+Y'],
      ['', null, null], ['잘라내기', 'cut', 'CommandOrControl+X'], ['복사', 'copy', 'CommandOrControl+C'],
      ['붙여넣기', 'paste', 'CommandOrControl+V'], ['삭제', 'delete', null], ['', null, null], ['모두 선택', 'selectall', 'CommandOrControl+A']],
    [['새로고침', 'reload', 'CmdOrCtrl+R'], ['강제 새로고침', 'forcereload', 'Shift+CmdOrCtrl+R'],
      ['개발자 도구', 'toggledevtools', 'Ctrl+Shift+I'], ['', null, null], ['실제 크기', 'resetzoom', 'CommandOrControl+0'],
      ['확대', 'zoomin', 'CommandOrControl+Plus'], ['축소', 'zoomout', 'CommandOrControl+-'], ['', null, null],
      ['전체 화면 전환', 'togglefullscreen', 'F11']],
    [['최소화', 'minimize', 'CommandOrControl+M'], ['최대화/복원', 'zoom', null], ['창 닫기', 'close', 'CommandOrControl+W']],
  ];
  assert.deepEqual(menu.map((item) => item.children.map(({ label, role, accelerator }) => [label, role, accelerator])), expected);
  assert.ok(menu.every((item) => item.children.every((child) => child.visible)));

  // Fixtures are served through the test IPC handler; nothing is written to H2.
  await inMain(() => {
    const e = process.mainModule.require('electron'), ipc = e.ipcMain;
    const original = ipc._invokeHandlers.get('backend:request');
    const summary = { id: '00000000-0000-4000-8000-000000000011', title: '메뉴 검증용 퀘스트', writingState: 'DRAFT',
      gameId: null, gameName: null, regionId: null, regionName: null, updatedAt: '2026-01-01T00:00:00Z' };
    const quest = { summary, author: null, body: '', createdAt: summary.updatedAt };
    const flow = { steps: [], links: [], viewport: { x: 0, y: 0, zoom: 1 } };
    ipc.removeHandler('backend:request');
    ipc.handle('backend:request', (event, method, route, body) => {
      if (method !== 'GET') throw new Error('No API writes or AI calls allowed in menu test');
      if (route.startsWith('/api/quests?')) return { ok: true, data: [summary] };
      if (route.endsWith('/workspace')) return { ok: true, data: { quest, flow } };
      if (route.endsWith('/flow')) return { ok: true, data: flow };
      if (route === '/api/quests/' + summary.id) return { ok: true, data: quest };
      return original(event, method, route, body);
    });
  });
  await button('퀘스트 추가'); await button('목록으로 돌아가기');
  await has('메뉴 검증용 퀘스트'); await button('메뉴 검증용 퀘스트');
  await has('플로우 작성'); await button('플로우 작성'); await has('시작 단계 추가');
  await button('시작 단계 추가'); await button('종료 단계 추가');
  assert.equal(await count(), 2);
  await key('Z', ['control']); assert.equal(await count(), 1, 'chart shortcut undoes exactly once');
  await key('Y', ['control']); assert.equal(await count(), 2);

  await run(() => document.querySelector('.flow-layout .react-flow__node').click());
  await until(() => run(() => !!document.getElementById('flow-step-title')), 'selected step properties');
  await run(() => { const field = document.getElementById('flow-step-title'); field.focus(); field.setSelectionRange(field.value.length, field.value.length); });
  const originalText = await value();
  await inMain(() => {
    const window = process.mainModule.require('electron').BrowserWindow.getAllWindows()[0];
    window.focus(); window.webContents.focus(); window.webContents.insertText(' 테스트');
  });
  await until(() => value().then((text) => text !== originalText), 'native text insertion');
  await key('Z', ['control']); assert.equal(await value(), originalText); assert.equal(await count(), 2);
  await key('Y', ['control']); assert.equal(await value(), originalText + ' 테스트');
  await role('undo'); assert.equal(await value(), originalText);
  await role('redo'); assert.equal(await value(), originalText + ' 테스트');
  await key('A', ['control']);
  assert.equal(await run(() => { const field = document.getElementById('flow-step-title'); return field.selectionEnd - field.selectionStart; }), (await value()).length);
  await run(() => document.querySelector('.flow-controls button').focus());
  await key('Z', ['control']);
  assert.equal(await value(), originalText, 'leaving the input returns shortcut ownership to the chart');
  assert.equal(await count(), 2);
  await key('Y', ['control']);
  assert.equal(await value(), originalText + ' 테스트');
  assert.equal(await count(), 2);

  await role('zoomin');
  assert.ok(await inMain(() => process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.getZoomLevel()) > 0);
  await role('resetzoom');
  assert.equal(await inMain(() => process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.getZoomLevel()), 0);
  await role('zoomout');
  assert.ok(await inMain(() => process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.getZoomLevel()) < 0);
  await role('resetzoom');
  await key('F11');
  await until(() => inMain(() => process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].isFullScreen()), 'fullscreen');
  await key('F11');
  await until(() => inMain(() => !process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].isFullScreen()), 'exit fullscreen');
  await role('minimize');
  assert.equal(await inMain(() => process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].isMinimized()), true);
  await inMain(() => process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].restore());

  // Cancelling either close or quit leaves the same dirty editor and Java alive.
  await inMain(() => {
    const dialog = process.mainModule.require('electron').dialog;
    globalThis.menuDialog = dialog.showMessageBoxSync; globalThis.menuConfirmations = 0;
    dialog.showMessageBoxSync = () => { globalThis.menuConfirmations++; return 0; };
  });
  await role('close'); await role('quit');
  assert.equal(await inMain(() => globalThis.menuConfirmations), 2);
  assert.equal(await count(), 2); await has('백엔드 연결됨');
  await inMain(() => { process.mainModule.require('electron').dialog.showMessageBoxSync = globalThis.menuDialog; });
  console.log('PASS menu: all labels/roles/accelerators match baseline, chart/text undo-redo isolation, text selection, zoom/fullscreen/minimize, close/quit cancellation');

}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(h.cleanup);
