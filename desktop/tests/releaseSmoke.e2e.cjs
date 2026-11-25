// Optional packaged-binary check, never an installer test. Uses the disposable harness only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const h = require('./workspace.e2e.cjs');

async function check() {
  assert.ok(process.env.QUESTWEAVER_TEST_EXECUTABLE, 'Set an absolute packaged executable path');
  delete process.env.JAVA_HOME;
  delete process.env.JDK_HOME;
  for (const name of Object.keys(process.env)) {
    if (name.toUpperCase() === 'QUESTWEAVER_OPENAI_API_KEY') delete process.env[name];
  }
  await h.start();
  assert.deepEqual((await h.api('GET', '/api/quests?')).data, []);
  const status = await h.run(() => window.questWeaver.aiStatus());
  assert.equal(status.data.source, 'none');
  assert.equal(status.data.configured, false);
  assert.equal(fs.existsSync(path.join(h.profile, 'openai-key.enc')), false);
  assert.deepEqual(await h.inMain(() => {
    const { app } = process.mainModule.require('electron');
    return { packaged: app.isPackaged, version: app.getVersion() };
  }), { packaged: true, version: '1.0.0' });
  await h.button('AI 연결 설정');
  await h.has('미등록');
  await h.has('AI 초안 생성에 사용할 OpenAI API 키와 모델을 관리합니다.');
  await h.button('취소');
  await h.inMain(() => {
    const { app, BrowserWindow } = process.mainModule.require('electron');
    globalThis.secondInstanceCount = 0;
    app.on('second-instance', () => { globalThis.secondInstanceCount++; });
    BrowserWindow.getAllWindows()[0].minimize();
  });
  const second = spawn(process.env.QUESTWEAVER_TEST_EXECUTABLE,
    ['--user-data-dir=' + h.profile], { windowsHide: true, stdio: 'ignore' });
  const [code] = await once(second, 'close');
  assert.equal(code, 0);
  await h.until(() => h.inMain(() => globalThis.secondInstanceCount === 1
    && !process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].isMinimized()), 'single instance restores window');
  const port = Number(/QUESTWEAVER_READY (\d+)/.exec(h.logs)[1]);
  await h.stop();
  const listening = await new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
  assert.equal(listening, false, 'backend port closes with app');
  await h.start();
  assert.deepEqual((await h.api('GET', '/api/quests?')).data, []);
  assert.equal((await h.run(() => window.questWeaver.aiStatus())).data.source, 'none');
  console.log('PASS packaged smoke: bundled runtime without JAVA_HOME, empty quests, no key, Korean AI settings, duplicate instance restoration, backend port cleanup, restart; not an installer test');
}

check().catch(error => { console.error(error); process.exitCode = 1; }).finally(h.cleanup);
