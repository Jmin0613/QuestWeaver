// Disposable profile/H2 and test files only. Native dialogs are replaced with deterministic paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const h = require('./workspace.e2e.cjs');
const { start, stop, run, inMain, api, has, until, button, set, value } = h;
const list = async () => (await api('GET', '/api/quests?')).data;
const backToList = () => run(() => document.querySelector('.app-logo').click());

async function main() {
  await start();
  let target = path.join(h.profile, 'transfer.json');
  const png = path.resolve(__dirname, '../.npm-cache/workspace-verification/imported-quest.png');
  async function configureFiles(file = target, mode = 'normal') {
    await inMain((file, png, mode) => {
      const dialog = process.mainModule.require('electron').dialog;
      dialog.showSaveDialog = async (_window, options) => {
        globalThis.questFilename = options.defaultPath;
        if (mode === 'cancel') return { canceled: true };
        return { canceled: false, filePath: options.title.includes('PNG') ? png : file };
      };
      dialog.showOpenDialog = async () => mode === 'cancel' ? { canceled: true } : { canceled: false, filePaths: [file] };
    }, file, png, mode);
  }
  await configureFiles();
  const game = (await api('POST', '/api/games', { name: '파일 테스트 게임' })).data;
  const region = (await api('POST', `/api/games/${game.id}/regions`, { name: '성문' })).data;
  const route = '/api/quests/' + randomUUID();
  const basic = { title: '이전:퀘스트? 한글', body: '여러 줄 원문\n<img src=x onerror="window.__fileExecuted=true">\n다시 도전한다.',
    author: '테스트 작성자', gameId: game.id, regionId: region.id, writingState: 'REGISTERED',
    planning: { code: 'BACKUP-1', chapter: '챕터 1', prerequisites: '선행 완료', optional: true, rewards: '보상\n둘째 줄', background: '기획 의도' } };
  await api('PUT', route, basic);
  const steps = ['시작', '분기', '종료'].map((title, i) => ({ id: randomUUID(), title, kind: ['START', 'BRANCH', 'END'][i],
    description: '단계 설명\n둘째 줄', x: i * 320 - 200, y: i * 100, width: i === 1 ? 340 : 200, height: 130,
    direction: i === 1 ? 'VERTICAL' : 'HORIZONTAL', planning: { actionType: 'COMBAT', target: '적', location: '성문',
      startCondition: '진입', completionCondition: '전투 완료', stateChanges: '전투=true', rewards: '단계 보상', notes: '메모\n둘째 줄' } }));
  const pairs = [[0, 1], [1, 2], [1, 0], [1, 0]];
  const flow = { steps, links: pairs.map(([from, to], i) => ({ id: randomUUID(), from: steps[from].id, to: steps[to].id,
    condition: '조건 ' + i, kind: i === 2 ? 'CURVE' : 'ORTHOGONAL',
    curve: i === 2 ? { start: { x: 260, y: 230 }, end: { x: -180, y: 260 } } : undefined,
    route: i !== 2 ? { start: 70, end: 60, offset: 160 + i * 50 } : undefined })), viewport: { x: 35, y: 80, zoom: 0.7 } };
  await api('PUT', route + '/flow', flow);
  const original = (await api('GET', route + '/workspace')).data;
  await button('퀘스트 추가'); await button('목록으로 돌아가기');
  await has(basic.title); await button(basic.title); await has('퀘스트 파일 내보내기');
  await button('퀘스트 파일 내보내기'); await has('퀘스트 파일을 저장했습니다.');
  const file = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.equal(file.format, 'questweaver.quest'); assert.equal(file.schemaVersion, 1);
  assert.deepEqual(file.flow, original.flow);
  assert.equal(file.quest.body, basic.body); assert.equal(file.quest.author, basic.author);
  assert.deepEqual(file.quest.planning, original.quest.planning);
  assert.ok(!fs.readFileSync(target, 'utf8').includes(route.split('/').at(-1)), 'no internal quest id');
  assert.ok(!/apiKey|security|token|dataDir|userData/i.test(fs.readFileSync(target, 'utf8')));
  assert.ok(!/[<>:"/\\|?*]/.test(path.basename(await inMain(() => globalThis.questFilename))));
  assert.deepEqual((await api('GET', route + '/workspace')).data, original);

  await configureFiles(target, 'cancel');
  await button('퀘스트 파일 내보내기');
  assert.deepEqual((await api('GET', route + '/workspace')).data, original);
  await configureFiles(path.join(target, 'cannot-write.json'));
  await button('퀘스트 파일 내보내기');
  await until(() => run(() => !!document.querySelector('.quest-file-action .error')?.textContent), 'export filesystem error');
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), file);
  await backToList(); await has('퀘스트 파일 가져오기');
  await configureFiles(target, 'cancel');
  await button('퀘스트 파일 가져오기'); assert.equal((await list()).length, 1);
  await configureFiles();
  await button('퀘스트 파일 가져오기'); await has('퀘스트 파일 가져오기 확인');
  await has('3개'); await has('4개'); await button('취소');
  assert.equal((await list()).length, 1);

  const bad = path.join(h.profile, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ ...file, schemaVersion: 999 }));
  await configureFiles(bad); await button('퀘스트 파일 가져오기'); await has('지원하지 않는 퀘스트 파일 버전');
  fs.writeFileSync(bad, '{ not json');
  await button('퀘스트 파일 가져오기'); await has('JSON 형식이나 필드 값');
  assert.equal((await list()).length, 1);

  // A failed transactional save keeps the confirmation preview and supports an explicit retry.
  await configureFiles(); await button('퀘스트 파일 가져오기'); await has('새 퀘스트로 가져오기');
  await inMain(() => {
    globalThis.fileFetch = globalThis.fetch;
    globalThis.fetch = (url, options) => String(url).endsWith('/api/quest-files/import')
      ? Promise.resolve(new Response(JSON.stringify({ message: '검증용 가져오기 저장 실패' }), { status: 409 }))
      : globalThis.fileFetch(url, options);
  });
  await button('새 퀘스트로 가져오기'); await has('검증용 가져오기 저장 실패');
  assert.equal((await list()).length, 1);
  await inMain(() => { globalThis.fetch = globalThis.fileFetch; });
  await button('새 퀘스트로 가져오기'); await has('퀘스트 파일 내보내기');
  const all = await list(), imported = all.find((item) => item.id !== original.quest.summary.id);
  assert.equal(all.length, 2); assert.equal(imported.writingState, 'DRAFT');
  const copyRoute = '/api/quests/' + imported.id;
  const restored = (await api('GET', copyRoute + '/workspace')).data;
  assert.equal(restored.quest.body, basic.body);
  assert.deepEqual(restored.quest.planning, original.quest.planning);
  assert.equal(restored.quest.summary.gameId, game.id); assert.equal(restored.quest.summary.regionId, region.id);
  assert.ok(restored.flow.steps.every((step) => !steps.some((old) => old.id === step.id)));
  assert.equal(await run(() => window.__fileExecuted === true), false);
  assert.equal(await run(() => document.querySelectorAll('.quest-body img').length), 0);
  await has('PNG 내보내기'); await button('PNG 내보내기'); await has('PNG를 저장했습니다.');
  assert.ok(fs.statSync(png).size > 1000);
  await button('플로우 편집'); await has('검사 전');
  await run((id) => document.querySelector(`.flow-layout .react-flow__node[data-id="${id}"]`).click(), restored.flow.steps[1].id);
  await until(() => run(() => !!document.getElementById('step-plan-notes')), 'selected imported step');
  assert.equal(await value('step-plan-notes'), '메모\n둘째 줄');
  await set('flow-step-title', '가져온 단계 수정');
  await button('저장'); await until(async () => (await api('GET', copyRoute + '/flow')).data.steps[1].title === '가져온 단계 수정', 'save imported graph');
  const saved = (await api('GET', copyRoute + '/workspace')).data;
  await stop(); await start(); target = path.join(h.profile, 'transfer.json'); await configureFiles();
  assert.deepEqual((await api('GET', copyRoute + '/workspace')).data, saved);
  await has(basic.title); await button(basic.title); await has('퀘스트 파일 내보내기');
  await backToList(); await has('퀘스트 파일 가져오기');
  await button('퀘스트 파일 가져오기'); await has('새 퀘스트로 가져오기'); await button('새 퀘스트로 가져오기');
  await has('퀘스트 파일 내보내기'); assert.equal((await list()).length, 3);
  assert.deepEqual((await api('GET', route + '/workspace')).data, original);

  // A completely incomplete draft with an empty chart also round-trips through the file UI.
  const emptyRoute = '/api/quests/' + randomUUID();
  await api('PUT', emptyRoute, { writingState: 'DRAFT' });
  const emptyFile = path.join(h.profile, 'empty.json');
  await configureFiles(emptyFile);
  assert.equal((await run((id) => window.questWeaver.exportQuestFile(id), emptyRoute.split('/').at(-1))).status, 'saved');
  await backToList(); await has('퀘스트 파일 가져오기'); await button('퀘스트 파일 가져오기');
  await has('제목 없는 퀘스트'); await has('0개'); await button('새 퀘스트로 가져오기'); await has('플로우 작성');
  await h.screenshot('quest-file-imported-empty.png');
  console.log('PASS quest files: UTF-8 export/import, metadata/geometry/paths, fresh draft IDs, reuse, XSS as text, cancel/errors/retry, edit/save/restart, reimport, empty draft, preview/PNG; no AI calls');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(h.cleanup);
