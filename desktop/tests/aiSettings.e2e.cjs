// Run against a disposable Electron profile and explicit temporary H2 database.
// All outbound AI traffic is intercepted in the main process; no paid API is called.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const h = require('./workspace.e2e.cjs');
const { start, stop, run, inMain, api, has, until, button, set, value, graph } = h;
const fakeKey = 'fake-ai-e2e-session';
const persistentKey = 'fake-ai-e2e-persistent';
const environmentKey = 'fake-ai-e2e-environment';

async function guardExternalApi() {
  // Keep the real Electron->Java->provider path, replace only external transport.
  await inMain(() => {
    globalThis.aiCalls = [];
    globalThis.aiMode = 'success';
    globalThis.aiDelay = false;
    globalThis.originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/flow/generate')) {
        globalThis.aiCalls.push(options.headers['X-QuestWeaver-AI-Key']);
        if (globalThis.aiDelay) await new Promise((resolve) => { globalThis.finishAi = resolve; });
        if (globalThis.aiMode === 'failure') {
          return new Response(JSON.stringify({ message: 'AI 서비스 인증에 실패했습니다. AI 연결 설정에서 키를 다시 등록하세요.' }), { status: 502 });
        }
        return new Response(JSON.stringify({ flow: {
          steps: [{ id: '00000000-0000-4000-8000-000000000001', kind: 'START', title: '모의 생성', description: '', x: 0, y: 0 }],
          links: [], viewport: { x: 0, y: 0, zoom: 1 },
        }, needsReview: ['종료 조건 확인 필요'] }), { status: 200 });
      }
      // Block external destinations even if implementation changes accidentally.
      if (!String(url).startsWith('http://127.0.0.1:')) throw new Error('External transport blocked in test');
      return globalThis.originalFetch(url, options);
    };
    return true;
  });
}
const calls = () => inMain(() => globalThis.aiCalls.length);
const settingsStatus = async () => (await run(() => window.questWeaver.aiStatus())).data;
async function saveKey(key, store = false, label = '저장') {
  await set('openai-key', key);
  if (store) await run(() => document.querySelector('.ai-store-option input').click());
  await button(label);
}
async function openFlow(title) {
  await has(title);
  await button(title);
  const action = await until(() => run(() => [...document.querySelectorAll('button')]
    .find((b) => ['플로우 편집', '플로우 작성'].includes(b.textContent))?.textContent), 'flow action');
  await button(action);
  await until(() => run(() => Boolean(document.querySelector('.flow-ai-tools'))), 'flow editor');
  await run(() => { document.querySelector('.flow-ai-tools').open = true; window.confirm = () => true; });
}

async function main() {
  await start();
  await guardExternalApi();
  const port = /QUESTWEAVER_READY (\d+)/.exec(h.logs)[1];
  assert.equal((await fetch('http://127.0.0.1:' + port + '/api/status')).status, 401);
  assert.equal(await inMain(async () => {
    const handler = process.mainModule.require('electron').ipcMain._invokeHandlers.get('ai:status');
    return (await handler({ senderFrame: null })).ok;
  }), false, 'foreign frames cannot access AI settings IPC');
  assert.equal((await settingsStatus()).source, 'none');
  const id = randomUUID(), route = '/api/quests/' + id;
  const quest = (await api('PUT', route, { title: 'AI 연결 설정 검증', body: '훈련을 시작한다.', writingState: 'DRAFT' })).data;
  const flow = { steps: [{ id: randomUUID(), kind: 'START', title: '기존 단계', description: '', x: 20, y: 30 }],
    links: [], viewport: { x: 0, y: 0, zoom: 1 } };
  assert.equal((await api('PUT', route + '/flow', flow)).ok, true);
  // Reload list through navigation after creating the temporary quest.
  await button('퀘스트 추가');
  await button('목록으로 돌아가기');
  await openFlow('AI 연결 설정 검증');
  const original = await graph();
  await button('AI로 플로우 생성');
  await has('저장하고 계속');
  assert.equal(await run(() => document.getElementById('openai-key').type), 'password');
  assert.equal(await run(() => document.querySelector('.ai-store-option input').checked), false);
  await set('openai-key', fakeKey);
  await button('취소');
  assert.deepEqual(await graph(), original);
  assert.equal((await settingsStatus()).source, 'none');
  assert.equal(await calls(), 0);

  // A normal settings save never generates, and clears its input immediately.
  await button('AI 연결 설정');
  await saveKey(fakeKey);
  await has('키 설정을 저장했습니다.');
  assert.equal(await value('openai-key'), '');
  assert.equal(await calls(), 0);
  assert.equal((await settingsStatus()).source, 'session');
  await button('닫기');
  await run(() => { window.confirm = () => false; });
  await button('AI로 플로우 생성');
  assert.equal(await calls(), 0);
  assert.deepEqual(await graph(), original);

  await run(() => { window.confirm = () => true; });
  await inMain(() => { globalThis.aiMode = 'failure'; return true; });
  await button('AI로 플로우 생성');
  await has('AI 서비스 인증에 실패했습니다.');
  assert.deepEqual(await graph(), original);
  await inMain(() => { globalThis.aiMode = 'success'; globalThis.aiDelay = true; return true; });
  await button('AI로 플로우 생성');
  await until(async () => await calls() === 2, 'one generation request');
  assert.equal(await run(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'AI로 플로우 생성').disabled), true);
  await button('AI 연결 설정');
  await button('등록한 키 삭제');
  await has('이미 진행 중인 생성 요청은 취소되지 않습니다.');
  await button('닫기');
  await inMain(() => { globalThis.finishAi(); globalThis.aiDelay = false; return true; });
  await has('AI 플로우 초안');
  await button('취소');
  assert.deepEqual(await graph(), original);
  assert.equal((await settingsStatus()).source, 'none');

  // First-time setup continues to a separate source-transmission confirmation.
  await run(() => { window.confirm = () => { window.confirmCount = (window.confirmCount || 0) + 1; return false; }; });
  await button('AI로 플로우 생성');
  await saveKey(fakeKey, false, '저장하고 계속');
  await until(() => run(() => window.confirmCount === 1), 'confirmation after key registration');
  assert.equal(await calls(), 2);
  await run(() => { window.confirm = () => true; });
  await button('AI로 플로우 생성');
  await has('종료 조건 확인 필요');
  await button('적용');
  assert.equal((await api('GET', route + '/flow')).data.steps[0].title, '기존 단계');
  await button('저장');
  await until(async () => (await api('GET', route + '/flow')).data.steps[0].title === '모의 생성', 'explicit save');

  // A delayed response for the first quest must not reach a new editor session.
  const otherId = randomUUID(), otherRoute = '/api/quests/' + otherId;
  await api('PUT', otherRoute, { title: '다른 퀘스트', body: '종료한다.', writingState: 'DRAFT' });
  await inMain(() => { globalThis.aiDelay = true; return true; });
  await button('AI로 플로우 생성');
  await until(async () => await calls() === 4, 'delayed generation');
  await button('상세로 돌아가기');
  await run(() => document.querySelector('.app-logo').click());
  await openFlow('다른 퀘스트');
  await inMain(() => { globalThis.finishAi(); globalThis.aiDelay = false; return true; });
  await run(() => new Promise((resolve) => setTimeout(resolve, 200)));
  await until(() => run(() => !document.querySelector('.ai-flow-dialog')), 'late result ignored');
  assert.equal((await api('GET', otherRoute + '/flow')).data.steps.length, 0);
  assert.equal(await run(() => document.querySelectorAll('.flow-layout .react-flow__node').length), 0);

  const secure = (await settingsStatus()).secureStorageAvailable;
  assert.equal(secure, true, 'This Windows test expects actual OS secure storage');
  await button('AI 연결 설정');
  await saveKey(persistentKey, true);
  await has('이 PC에 저장됨');
  assert.ok(!fs.readFileSync(path.join(h.profile, 'openai-key.enc')).includes(Buffer.from(persistentKey)));
  assert.ok(!JSON.stringify(await settingsStatus()).includes(persistentKey));
  await button('닫기');
  assert.equal(await calls(), 4);
  assert.ok(!h.logs.includes(fakeKey) && !h.logs.includes(persistentKey));
  await stop();
  assert.ok(!fs.readFileSync(h.databaseFile + '.mv.db').includes(Buffer.from(fakeKey)));
  assert.ok(!fs.readFileSync(h.databaseFile + '.mv.db').includes(Buffer.from(persistentKey)));

  await start({ environmentKey });
  await guardExternalApi();
  assert.equal((await settingsStatus()).source, 'stored');
  await openFlow('AI 연결 설정 검증');
  await button('AI로 플로우 생성');
  await has('AI 플로우 초안');
  assert.equal(await inMain(() => globalThis.aiCalls[0] === 'fake-ai-e2e-persistent'), true);
  await button('취소');
  await button('AI 연결 설정');
  await saveKey(fakeKey); // Explicit session replacement deletes the persistent key.
  await has('이번 실행에서만 사용');
  assert.equal(fs.existsSync(path.join(h.profile, 'openai-key.enc')), false);
  await button('등록한 키 삭제');
  await has('개발 환경변수 사용 중');
  await has('Remove-Item Env:QUESTWEAVER_OPENAI_API_KEY');
  await saveKey(fakeKey);
  await button('닫기');
  await stop();
  await start();
  await guardExternalApi();
  assert.equal((await settingsStatus()).source, 'none', 'session and previous stored key do not survive');
  assert.equal((await api('GET', route + '/flow')).data.steps[0].title, '모의 생성');
  assert.equal((await api('GET', route)).data.author, quest.author);
  assert.ok(!h.logs.includes(fakeKey) && !h.logs.includes(environmentKey));
  await button('AI 연결 설정');
  await h.screenshot('ai-settings.png');
  console.log('PASS AI settings: cancellation, no implicit calls, single flight, failure retention, delayed result, explicit save, OS encrypted restart, session replacement, deletion/environment priority, no plaintext in temporary DB/logs');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(h.cleanup);
