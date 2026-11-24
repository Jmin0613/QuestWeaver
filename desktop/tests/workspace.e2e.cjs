// Build both projects first. This test uses a disposable profile and H2 file.
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const desktop = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qw-workspace-'));
const databaseFile = path.join(profile, 'database', 'questweaver');
fs.mkdirSync(path.dirname(databaseFile));
const output = path.join(desktop, '.npm-cache', 'workspace-verification');
fs.mkdirSync(output, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let app, page, main, dataProfile, logs = '', nextId = 0;

async function until(check, label) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const result = await check();
    if (result) return result;
    await wait(80);
  }
  throw new Error(label);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await once(socket, 'open');
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    clearTimeout(call.timeout);
    if (message.error) call.reject(new Error(JSON.stringify(message.error)));
    else call.resolve(message.result);
  });
  return {
    socket,
    call(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(method + ' timed out'));
        }, 10000);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function evaluate(client, expression) {
  const reply = await client.call('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description);
  return reply.result.value;
}

const run = (fn, ...args) => evaluate(page, '(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
const inMain = (fn, ...args) => evaluate(main, '(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
const api = (method, route, body) => run((m, r, b) => window.questWeaver.request(m, r, b ?? undefined), method, route, body ?? null);
const has = (text) => until(() => run((t) => document.body.innerText.includes(t), text), text);

async function start() {
  logs = '';
  const server = net.createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (upper === 'QUESTWEAVER_OPENAI_API_KEY' || upper === 'SPRING_APPLICATION_JSON'
        || upper.startsWith('SPRING_DATASOURCE_')) delete env[key];
  }
  env.SPRING_DATASOURCE_URL = 'jdbc:h2:file:' + databaseFile.replaceAll('\\', '/');
  env.SPRING_DATASOURCE_USERNAME = 'questweaver_test';
  env.SPRING_DATASOURCE_PASSWORD = '';
  app = spawn(path.join(desktop, 'node_modules/electron/dist/electron.exe'), [
    '--inspect=0', '.', '--user-data-dir=' + path.join(profile, 'profile'),
    '--remote-debugging-port=' + port,
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  ], { cwd: desktop, env, windowsHide: true });
  for (const stream of [app.stdout, app.stderr]) stream.on('data', (data) => { logs += data; });
  const tab = await until(async () => {
    try {
      const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      return tabs.find((candidate) => candidate.type === 'page');
    } catch { return undefined; }
  }, 'Electron page');
  page = await connect(tab.webSocketDebuggerUrl);
  main = await connect(await until(() => /Debugger listening on (ws:\/\/[^\s]+)/.exec(logs)?.[1], 'Electron inspector'));
  const actualProfile = await inMain(() => process.mainModule.require('electron').app.getPath('userData'));
  assert.ok(actualProfile.startsWith(profile + path.sep), 'must use disposable profile');
  dataProfile = actualProfile;
  await size(1440, 1050);
  await has('백엔드 연결됨');
  assert.ok(fs.existsSync(databaseFile + '.mv.db'), 'must create the disposable H2 database');
}

async function stop() {
  if (!main || app.exitCode !== null) return;
  const done = once(app, 'close');
  await inMain(() => {
    const electron = process.mainModule.require('electron');
    electron.dialog.showMessageBoxSync = () => 1;
    setTimeout(() => electron.app.quit(), 150);
    return true;
  });
  main.socket.close();
  page.socket.close();
  await done;
  main = undefined;
}

function makeTemporaryDatabaseUseLegacySchema() {
  assert.ok(dataProfile.startsWith(profile + path.sep));
  const jdk = process.env.JAVA_HOME;
  if (!jdk) throw new Error('Set JAVA_HOME to a Windows x64 JDK 21');
  const jar = path.join(jdk, 'bin', 'jar.exe');
  const bootJar = path.resolve(desktop, '../backend/build/libs/questweaver.jar');
  const entries = execFileSync(jar, ['tf', bootJar], { encoding: 'utf8', windowsHide: true });
  const h2Entry = entries.split(/\r?\n/).find((entry) => /^BOOT-INF\/lib\/h2-[^/]+\.jar$/.test(entry));
  assert.ok(h2Entry, 'H2 driver must be present in the built backend');
  const directory = path.join(profile, 'migration-check');
  fs.mkdirSync(directory);
  execFileSync(jar, ['xf', bootJar, h2Entry], { cwd: directory, windowsHide: true });
  const database = databaseFile.replaceAll('\\', '/');
  const result = execFileSync(path.join(jdk, 'bin', 'java.exe'), [
    '-cp', path.join(directory, h2Entry), 'org.h2.tools.Shell',
    '-url', 'jdbc:h2:file:' + database, '-user', 'questweaver_test', '-password', '',
    '-sql', 'alter table quest drop column planning_document',
  ], { encoding: 'utf8', windowsHide: true });
  assert.ok(!result.includes('Error'), result);
}

async function size(width, height) {
  await inMain((w, h) => process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].setSize(w, h), width, height);
  await wait(100);
}

async function button(label) {
  await run((label) => {
    const element = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === label);
    if (!element || element.disabled) throw new Error('Unavailable button ' + label);
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    element.focus();
    element.click();
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }, label);
  await wait(30);
}

async function set(id, value) {
  await run((id, value) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(id);
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    element.focus();
    if (element.type === 'checkbox') {
      if (element.checked !== value) element.click();
      return;
    }
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  }, id, value);
  await wait(30);
}

const value = (id) => run((id) => document.getElementById(id)?.value, id);
const dirty = () => run(() => document.querySelector('.flow-unsaved')?.style.visibility === 'visible');
const inspection = () => run(() => document.querySelector('.flow-inspection strong')?.textContent);
const graph = () => run(() => ({
  nodes: [...document.querySelectorAll('.react-flow__node')].map((node) => [node.dataset.id, node.style.transform, node.style.width, node.style.height]),
  edges: [...document.querySelectorAll('.react-flow__edge')].map((edge) => [edge.dataset.id, edge.querySelector('.react-flow__edge-path').getAttribute('d')]),
}));

async function selectNode(id) {
  await run((id) => {
    const node = document.querySelector('.react-flow__node[data-id="' + id + '"]');
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    node.click();
  }, id);
  await wait(50);
}

async function screenshot(name) {
  const result = await page.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(output, name), Buffer.from(result.data, 'base64'));
}

async function dragRouteControl() {
  const point = await run(() => {
    const handle = document.querySelector('[aria-label="직선을 꺾은선으로 조절"]');
    const rect = handle.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  const mouse = (type, x, y, buttons) => page.call('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons, clickCount: 1,
  });
  await mouse('mouseMoved', point.x, point.y, 0);
  await mouse('mousePressed', point.x, point.y, 1);
  for (const amount of [10, 25, 40]) {
    await mouse('mouseMoved', point.x, point.y + amount, 1);
    await wait(40);
  }
  await mouse('mouseReleased', point.x, point.y + 40, 0);
  await wait(60);
}

async function resizeSelectedNode() {
  await run(async () => {
    const handle = document.querySelector('.react-flow__node.selected .step-resize.bottom.right');
    const rect = handle.getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const options = { view: window, bubbles: true, cancelable: true, button: 0, buttons: 1 };
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    handle.dispatchEvent(new MouseEvent('mousedown', { ...options, clientX: x, clientY: y }));
    for (const amount of [10, 25, 40]) {
      window.dispatchEvent(new MouseEvent('mousemove', { ...options, clientX: x + amount, clientY: y + amount }));
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    window.dispatchEvent(new MouseEvent('mouseup', { ...options, buttons: 0, clientX: x + 40, clientY: y + 40 }));
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await wait(60);
}

async function checkLayout() {
  const layout = await run(() => {
    const canvas = document.querySelector('.flow-layout .flow-canvas').getBoundingClientRect();
    const sidebar = document.querySelector('.flow-sidebar');
    return {
      canvas: canvas.toJSON(), sidebar: sidebar.getBoundingClientRect().toJSON(),
      scrollable: sidebar.scrollHeight > sidebar.clientHeight,
      pageHeight: document.documentElement.scrollHeight, height: innerHeight, width: innerWidth,
      buttons: [...document.querySelectorAll('.flow-heading-actions > button')].map((button) => button.getBoundingClientRect().toJSON()),
    };
  });
  assert.ok(layout.canvas.height >= 80 && layout.canvas.width >= 100, JSON.stringify(layout));
  assert.ok(layout.canvas.bottom <= layout.height + 1);
  assert.ok(layout.sidebar.bottom <= layout.height + 1);
  assert.ok(layout.pageHeight <= layout.height + 1, 'workspace must fit viewport');
  assert.ok(layout.buttons.every((rect) => rect.left >= 0 && rect.right <= layout.width && rect.bottom <= layout.height));
  assert.ok(layout.scrollable);
}

async function mainTest() {
  await start();
  const game = (await api('POST', '/api/games', { name: '검증 게임' })).data;
  const region = (await api('POST', '/api/games/' + game.id + '/regions', { name: '검증 지역' })).data;
  const questRoute = '/api/quests/' + randomUUID();
  const flowRoute = questRoute + '/flow';
  const workspaceRoute = questRoute + '/workspace';
  const basic = { title: '기획 편집 검증', body: '저장된 퀘스트 원문', author: '기획자',
    gameId: game.id, regionId: region.id, writingState: 'DRAFT' };
  assert.ok((await api('PUT', questRoute, basic)).ok);
  const step = (kind, title, x) => ({ id: randomUUID(), kind, title, description: '', x, y: 80 });
  const startStep = step('START', '시작', 0), progress = step('PROGRESS', '흑아 전투', 300), end = step('END', '종료', 650);
  const flow = {
    steps: [startStep, progress, end],
    links: [
      { id: randomUUID(), from: startStep.id, to: progress.id, condition: '전투 진입' },
      { id: randomUUID(), from: progress.id, to: end.id, condition: '완료' },
    ],
    viewport: { x: 60, y: 80, zoom: 0.85 },
  };
  assert.ok((await api('PUT', flowRoute, flow)).ok);
  const original = (await api('GET', workspaceRoute)).data;
  // Simulate an existing file DB with the previous schema, entirely in the temporary profile.
  await stop();
  makeTemporaryDatabaseUseLegacySchema();
  await start();
  assert.deepEqual((await api('GET', workspaceRoute)).data, original);
  await set('filter-title', '기획 편집 검증');
  await has('기획 편집 검증');
  await button('기획 편집 검증');
  await has('플로우 편집');
  await button('플로우 편집');
  await until(() => value('quest-plan-code').then((result) => result === ''), 'legacy quest planning');
  await selectNode(progress.id);
  assert.equal(await value('step-plan-actionType'), 'UNSPECIFIED');
  assert.equal(await value('step-plan-completionCondition'), '');
  assert.equal(await value('step-plan-notes'), '');
  await button('검사');
  await until(() => inspection().then((status) => status === '경고 없음'), 'structure inspection');
  await button('퀘스트 정보');
  await set('quest-plan-code', 'Q-BOSS-01');
  assert.equal(await dirty(), true);
  await button('실행 취소');
  assert.equal(await value('quest-plan-code'), '');
  assert.equal(await dirty(), false);
  await button('다시 실행');
  assert.equal(await value('quest-plan-code'), 'Q-BOSS-01');
  for (const [key, text] of Object.entries({
    chapter: '성문 챕터', prerequisites: '앞 퀘스트 완료', rewards: '퀘스트 전체 보상',
  })) await set('quest-plan-' + key, text);
  await set('quest-plan-optional', true);
  await selectNode(progress.id);
  assert.equal(await run(() => document.getElementById('element-tab').getAttribute('aria-selected')), 'true');
  await set('step-plan-actionType', 'COMBAT');
  const stepFields = {
    target: '흑아', location: '성문 앞', startCondition: '성문 개방',
    completionCondition: '흑아의 체력이 0이 되면 완료', stateChanges: '흑아전 완료 = true',
    rewards: '단계 보상', notes: '재도전 시 컷신 생략',
  };
  for (const [key, text] of Object.entries(stepFields)) await set('step-plan-' + key, text);
  assert.equal(await inspection(), '경고 없음');
  const beforeScroll = await run(() => ({
    canvas: document.querySelector('.flow-layout .flow-canvas').getBoundingClientRect().toJSON(),
    view: document.querySelector('.react-flow__viewport').style.transform,
  }));
  await run(() => { const panel = document.querySelector('.flow-sidebar'); panel.scrollTop = panel.scrollHeight; });
  assert.ok(await run(() => document.querySelector('.flow-sidebar').scrollTop > 0));
  assert.deepEqual(await run(() => ({
    canvas: document.querySelector('.flow-layout .flow-canvas').getBoundingClientRect().toJSON(),
    view: document.querySelector('.react-flow__viewport').style.transform,
  })), beforeScroll);
  await checkLayout();
  await run(() => { document.querySelector('.flow-sidebar').scrollTop = 0; });
  await screenshot('workspace-wide.png');

  // Substitute a failed save in this test process.
  await inMain(() => {
    const ipc = process.mainModule.require('electron').ipcMain;
    globalThis.originalRequest = ipc._invokeHandlers.get('backend:request');
    ipc.removeHandler('backend:request');
    ipc.handle('backend:request', (event, method, route, body) => method === 'PUT' && route.endsWith('/workspace')
      ? { ok: false, message: '검증용 저장 실패' } : globalThis.originalRequest(event, method, route, body));
  });
  await button('저장');
  await has('검증용 저장 실패');
  assert.equal(await value('step-plan-notes'), stepFields.notes);
  assert.equal(await dirty(), true);
  assert.deepEqual((await api('GET', workspaceRoute)).data, original);
  await button('퀘스트 정보');
  await run(() => { window.confirm = () => false; });
  await button('퀘스트 기본 정보 수정');
  assert.equal(await value('quest-plan-code'), 'Q-BOSS-01');
  assert.ok(await run(() => document.querySelector('.flow-panel') !== null));
  await inMain(() => {
    const ipc = process.mainModule.require('electron').ipcMain;
    ipc.removeHandler('backend:request');
    ipc.handle('backend:request', globalThis.originalRequest);
  });
  await api('PUT', questRoute, { ...basic, title: '최신 퀘스트명', body: '다른 창에서 수정한 원문',
    planning: { background: '다른 창의 기획 의도' } });
  await button('저장');
  await has('기획 정보와 플로우를 저장했습니다.');
  const firstSave = (await api('GET', workspaceRoute)).data;
  assert.equal(firstSave.quest.summary.title, '최신 퀘스트명');
  assert.equal(firstSave.quest.body, '다른 창에서 수정한 원문');
  assert.equal(firstSave.quest.planning.background, '다른 창의 기획 의도');
  assert.equal(firstSave.quest.planning.rewards, '퀘스트 전체 보상');
  assert.equal(firstSave.flow.steps[1].kind, 'PROGRESS');
  assert.deepEqual(firstSave.flow.steps[1].planning, { actionType: 'COMBAT', ...stepFields });
  assert.equal(await dirty(), false);
  await button('실행 취소');
  assert.equal(await dirty(), true);
  assert.deepEqual((await api('GET', workspaceRoute)).data, firstSave);
  await button('다시 실행');
  assert.equal(await dirty(), false);
  assert.equal(await inspection(), '경고 없음');
  await set('quest-plan-background', '최종 기획 의도');
  await button('저장');
  await until(() => dirty().then((result) => !result), 'saved planning baseline');
  await run(() => { window.confirm = () => true; });
  await button('퀘스트 기본 정보 수정');
  await has('퀘스트 수정');
  assert.equal(await value('quest-plan-code'), 'Q-BOSS-01');
  await set('quest-plan-chapter', '수정 화면의 챕터');
  await button('임시저장');
  await has('임시저장했습니다.');
  await button('상세로 돌아가기');
  await has('수정 화면의 챕터');
  await button('플로우 편집');
  await until(() => value('quest-plan-code').then((result) => result === 'Q-BOSS-01'), 'reopened editor');
  await selectNode(progress.id);
  assert.equal(await value('step-plan-notes'), stepFields.notes);
  await button('검사');
  await until(() => inspection().then((status) => status === '경고 없음'), 'reinspection');
  await button('완료');
  await set('flow-link-kind', 'ORTHOGONAL');
  assert.equal(await inspection(), '경고 없음');
  await button('실행 취소');
  assert.equal(await value('flow-link-kind'), 'CURVE');
  await button('다시 실행');
  const beforeRoute = await graph();
  await dragRouteControl();
  const routed = await graph();
  assert.notDeepEqual(routed.edges, beforeRoute.edges);
  assert.deepEqual(routed.nodes, beforeRoute.nodes);
  await button('실행 취소');
  await button('다시 실행');
  await selectNode(progress.id);
  const beforeResize = await graph();
  await resizeSelectedNode();
  assert.notDeepEqual((await graph()).nodes, beforeResize.nodes);
  assert.equal(await value('step-plan-notes'), stepFields.notes);
  assert.equal(await inspection(), '경고 없음');
  await button('저장');
  await until(() => dirty().then((result) => !result), 'edge save');
  const saved = (await api('GET', workspaceRoute)).data;
  const savedGraph = await graph();
  await stop();
  await start();
  assert.deepEqual((await api('GET', workspaceRoute)).data, saved);
  await until(() => run(() => [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '최신 퀘스트명')), 'restarted list');
  await button('최신 퀘스트명');
  await has('최종 기획 의도');
  await until(() => run(() => document.querySelectorAll('.react-flow__node').length === 3), 'detail flow');
  await selectNode(progress.id);
  await has('재도전 시 컷신 생략');
  assert.ok(await run(() => document.querySelector('.flow-preview-step').innerText.includes('전투')));
  assert.equal(await run(() => document.querySelectorAll('.curve-handle,.step-resize').length), 0);
  assert.deepEqual((await graph()).nodes, savedGraph.nodes);
  for (const [id, expectedPath] of savedGraph.edges) {
    const actualPath = (await graph()).edges.find(([edgeId]) => edgeId === id)[1];
    const expected = expectedPath.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const actual = actualPath.match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.equal(actual.length, expected.length);
    assert.ok(actual.every((number, index) => Math.abs(number - expected[index]) < 0.2));
  }
  await inMain((file) => {
    process.mainModule.require('electron').dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, path.join(output, 'workspace-flow.png'));
  await run(() => {
    window.pngText = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.pngText.push(text);
      return original.call(this, text, ...args);
    };
  });
  await button('PNG 내보내기');
  await has('PNG를 저장했습니다.');
  assert.ok(!(await run(() => window.pngText)).some((text) => ['단계 보상', '퀘스트 전체 보상', '재도전 시 컷신 생략'].includes(text)));
  assert.deepEqual((await api('GET', workspaceRoute)).data, saved);

  // Mock both AI endpoints. The application cannot call an external AI service here.
  const draft = { ...flow, steps: [{ ...startStep, title: 'AI 생성 단계' }], links: [] };
  await inMain((draft) => {
    const ipc = process.mainModule.require('electron').ipcMain;
    globalThis.originalRequest = ipc._invokeHandlers.get('backend:request');
    ipc.removeHandler('backend:request');
    ipc.handle('backend:request', (event, method, route, body) =>
      route === '/api/ai/flow/status' ? { ok: true, data: { configured: true } } :
      route.endsWith('/generate') ? { ok: true, data: { flow: draft, needsReview: [] } } :
      globalThis.originalRequest(event, method, route, body));
  }, draft);
  await button('플로우 편집');
  await until(() => value('quest-plan-code').then((result) => result === 'Q-BOSS-01'), 'AI editor');
  await run(() => { window.confirm = () => true; document.querySelector('.flow-ai-tools').open = true; });
  await until(() => run(() => ![...document.querySelectorAll('button')].find((button) => button.textContent === 'AI로 플로우 생성')?.disabled), 'mock AI configuration');
  await button('AI로 플로우 생성');
  await has('AI 플로우 초안');
  await button('적용');
  await until(() => run(() => document.querySelectorAll('.flow-layout .react-flow__node').length === 1), 'AI application');
  assert.equal(await value('quest-plan-code'), 'Q-BOSS-01');
  await selectNode(startStep.id);
  assert.equal(await value('step-plan-actionType'), 'UNSPECIFIED');
  assert.equal(await value('step-plan-notes'), '');
  await button('실행 취소');
  await selectNode(progress.id);
  assert.equal(await value('step-plan-notes'), stepFields.notes);
  assert.equal(await dirty(), false);
  assert.deepEqual((await api('GET', workspaceRoute)).data, saved);
  await size(480, 600);
  await run(() => { document.querySelector('.flow-ai-tools').open = false; });
  await button('전체 보기');
  await checkLayout();
  await screenshot('workspace-small.png');
  console.log('PASS workspace: legacy defaults, scoped planning, atomic save, failure retention, undo/redo, guard, independent scroll, basic editor, restart, preview/PNG, mocked AI, small window');
  console.log('Verification images: ' + output);
}

mainTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await stop().catch(() => { main?.socket.close(); page?.socket.close(); app?.kill(); });
  if (path.dirname(fs.realpathSync(profile)) === fs.realpathSync(os.tmpdir())
      && path.basename(profile).startsWith('qw-workspace-')) {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 6 });
  }
});
