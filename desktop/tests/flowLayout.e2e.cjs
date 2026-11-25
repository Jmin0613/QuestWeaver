const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const h = require('./workspace.e2e.cjs');
const { start, stop, run, inMain, api, has, until, button, dirty } = h;
const graph = async () => {
  const data = await h.graph();
  // React Flow recalculates handle coordinates through screen transforms after fitting.
  data.edges = data.edges.map(([id, path]) => [id, path.replace(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi,
    (number) => String(Math.round(Number(number) * 100) / 100))]);
  return data;
};
const output = path.resolve(__dirname, '../.npm-cache/workspace-verification');
const inspection = () => run(() => document.querySelector('.flow-inspection strong')?.textContent);
async function arrange(label, confirm = true) {
  await run((accept) => { window.confirm = () => accept; document.querySelector('.flow-layout-menu').open = true; }, confirm);
  await button(label);
}
async function open(title) {
  await has(title); await button(title); await has('플로우 편집'); await button('플로우 편집');
  await until(() => run(() => !!document.querySelector('.flow-layout-menu')), 'editor');
}
function noOverlap(flow) {
  for (let i = 0; i < flow.steps.length; i++) for (const b of flow.steps.slice(i + 1)) {
    const a = flow.steps[i];
    assert.ok(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
  }
}
async function main() {
  await start();
  const route = '/api/quests/' + randomUUID();
  const names = ['시작', '아주 긴 한글 제목입니다\n' + '공백없는긴문자열'.repeat(12), '결과 분기', '성공', '포기', '독립 단계'];
  const steps = names.map((title, i) => ({ id: randomUUID(), kind: ['START', 'PROGRESS', 'BRANCH', 'END', 'END', 'PROGRESS'][i],
    title, description: '설명 유지 ' + i, planning: { notes: '메모 유지' }, direction: i % 2 ? 'VERTICAL' : 'HORIZONTAL',
    x: i * 90 - 400, y: -170 + i * 20, width: [210, 95, 380, 150, 170, 156][i], height: i === 2 ? 230 : 70 }));
  const links = [[0, 1], [1, 2], [2, 3], [2, 4], [2, 1], [2, 1]].map(([a, b], i) => ({
    id: randomUUID(), from: steps[a].id, to: steps[b].id, condition: '긴 연결 조건 ' + i,
    kind: i === 5 ? 'CURVE' : 'ORTHOGONAL', route: { start: 80, end: 70, offset: 99 },
    curve: { start: { x: 120, y: 300 }, end: { x: -90, y: 280 } },
  }));
  const original = { steps, links, viewport: { x: 5, y: 10, zoom: 0.8 } };
  await api('PUT', route, { title: '자동 배치 검증', body: '훈련하고 성공, 포기 또는 재도전을 선택한다.', writingState: 'DRAFT' });
  assert.equal((await api('PUT', route + '/flow', original)).ok, true);
  const baseline = (await api('GET', route + '/flow')).data;
  await button('퀘스트 추가'); await button('목록으로 돌아가기');
  await open('자동 배치 검증');
  const before = await graph();
  await button('검사'); await until(() => inspection().then(Boolean), 'inspection');
  const checked = await inspection();
  await arrange('가로: 왼쪽→오른쪽', false);
  assert.deepEqual(await graph(), before);
  await arrange('가로: 왼쪽→오른쪽');
  assert.notDeepEqual(await graph(), before);
  assert.equal(await inspection(), checked);
  assert.equal(await dirty(), true);
  assert.deepEqual((await api('GET', route + '/flow')).data, baseline);
  await button('실행 취소');
  assert.deepEqual(await graph(), before);
  assert.equal(await dirty(), false);
  await button('다시 실행');
  await button('저장');
  await until(() => dirty().then((d) => !d), 'saved horizontal');
  const horizontal = (await api('GET', route + '/flow')).data;
  noOverlap(horizontal);
  assert.ok(horizontal.steps.every((step) => step.direction === 'HORIZONTAL'));
  assert.ok(horizontal.steps[1].height > 300, 'actual Korean wrapping expands the narrow box');
  assert.equal(horizontal.steps[2].width, 380);
  assert.deepEqual(horizontal.steps.map((s) => [s.id, s.title, s.description, s.planning]), baseline.steps.map((s) => [s.id, s.title, s.description, s.planning]));
  await h.screenshot('layout-horizontal.png');
  await arrange('세로: 위→아래');
  assert.equal(await inspection(), checked);
  await button('저장');
  await until(() => dirty().then((d) => !d), 'saved vertical');
  const saved = (await api('GET', route + '/flow')).data;
  noOverlap(saved);
  assert.ok(saved.steps.every((step) => step.direction === 'VERTICAL'));
  assert.deepEqual(saved.links.map(({ id, from, to, condition, kind }) => ({ id, from, to, condition, kind })),
    original.links.map(({ id, from, to, condition, kind }) => ({ id, from, to, condition, kind })));
  await h.screenshot('layout-vertical.png');
  await stop(); await start();
  assert.deepEqual((await api('GET', route + '/flow')).data, saved);
  await open('자동 배치 검증');
  const restored = await graph();
  await button('상세로 돌아가기'); await has('PNG 내보내기');
  await inMain((file) => {
    process.mainModule.require('electron').dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    return true;
  }, path.join(output, 'layout-export.png'));
  await button('PNG 내보내기'); await has('PNG를 저장했습니다.');
  const png = fs.readFileSync(path.join(output, 'layout-export.png'));
  assert.equal(png.readUInt32BE(0), 0x89504e47);
  assert.ok(png.readUInt32BE(16) > 300 && png.readUInt32BE(20) > 300);
  assert.deepEqual((await api('GET', route + '/flow')).data, saved);

  // One mocked generation, multiple local preview layouts. Never register or read a user key.
  await inMain((flow) => {
    const ipc = process.mainModule.require('electron').ipcMain;
    globalThis.layoutAiCalls = 0;
    const original = ipc._invokeHandlers.get('backend:request');
    ipc.removeHandler('backend:request');
    ipc.handle('backend:request', (event, method, route, body) => {
      if (route.endsWith('/generate')) { globalThis.layoutAiCalls++; return { ok: true, data: { flow, needsReview: [] } }; }
      return original(event, method, route, body);
    });
    ipc.removeHandler('ai:status');
    ipc.handle('ai:status', () => ({ ok: true, data: { configured: true, source: 'session', model: 'mock', warning: '' } }));
  }, { ...original, steps: original.steps.map((step, index) => index ? step : { ...step, title: '생성된 시작 단계' }) });
  await button('플로우 편집');
  await until(() => run(() => !!document.querySelector('.flow-ai-tools')), 'AI editor');
  await run(() => { window.confirm = () => true; document.querySelector('.flow-ai-tools').open = true; });
  await button('AI로 플로우 생성'); await has('AI 플로우 초안');
  assert.equal(await run(() => document.querySelector('[aria-label="AI 초안 자동 배치"]').value), 'HORIZONTAL');
  await run(() => {
    const select = document.querySelector('[aria-label="AI 초안 자동 배치"]');
    select.value = 'VERTICAL'; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await inMain(() => globalThis.layoutAiCalls), 1);
  await button('적용');
  assert.equal(await dirty(), true);
  assert.deepEqual((await api('GET', route + '/flow')).data, saved);
  await button('실행 취소');
  assert.deepEqual(await graph(), restored);
  assert.equal(await dirty(), false);
  await button('다시 실행'); await button('저장');
  await until(() => dirty().then((d) => !d), 'AI layout explicit save');
  assert.ok((await api('GET', route + '/flow')).data.steps.every((step) => step.direction === 'VERTICAL'));
  assert.equal(await inMain(() => globalThis.layoutAiCalls), 1);
  console.log('PASS layout: measured Korean boxes, branches/retry/parallel/isolated, confirmation cancel, atomic undo/redo, inspection retained, explicit save/restart, preview/PNG, one mock AI call with local direction changes');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(h.cleanup);
