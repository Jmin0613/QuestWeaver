import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
const { createQuestFiles, filename } = createRequire(import.meta.url)('../electron/questFiles.cjs');
const id = '00000000-0000-4000-8000-000000000001';
async function isolated(work) {
  const directory = await mkdtemp(path.join(tmpdir(), 'qw-file-test-'));
  try { await work(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
function fixture(directory, request) {
  const target = path.join(directory, 'quest.json');
  const dialog = { showSaveDialog: async () => ({ filePath: target }),
    showOpenDialog: async () => ({ filePaths: [target] }) };
  return { target, dialog, files: createQuestFiles({ dialog, downloads: () => directory, request }) };
}

test('safe Windows quest filenames retain Korean and handle reserved devices and forbidden characters', () => {
  assert.equal(filename('한글:퀘스트?\n'), '한글_퀘스트__-quest.json');
  assert.equal(filename('CON.txt'), '_CON.txt-quest.json');
  assert.equal(filename(''), '제목 없는 퀘스트-quest.json');
  assert.ok(!/[<>:"/\\|?*\u0000-\u001f]/.test(filename('a<>:"/\\|?*')));
});

test('export writes UTF-8 JSON; cancellation and write failure do not replace old files', () => isolated(async (directory) => {
  const payload = { format: 'questweaver.quest', schemaVersion: 1, quest: { title: '한글', body: '원문\n둘째 줄' }, flow: {} };
  const { files, dialog, target } = fixture(directory, async () => ({ ok: true, data: payload }));
  assert.equal((await files.export(null, id)).status, 'saved');
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), payload);
  const original = await readFile(target);
  dialog.showSaveDialog = async () => ({ canceled: true });
  assert.equal((await files.export(null, id)).status, 'canceled');
  dialog.showSaveDialog = async () => ({ filePath: path.join(target, 'child.json') });
  assert.equal((await files.export(null, id)).status, 'error');
  assert.deepEqual(await readFile(target), original);
  assert.deepEqual(await readdir(directory), ['quest.json']);
}));

test('selection validates in Java before confirmation, snapshots the file and clears a cancelled ticket', () => isolated(async (directory) => {
  const calls = [];
  const { files, target } = fixture(directory, async (method, route, body) => {
    calls.push({ method, route, body });
    return { ok: true, data: route.endsWith('/preview') ? { title: '시험', steps: 0, links: 0 } : { summary: { id } } };
  });
  await writeFile(target, '{"format":"example"}', 'utf8');
  const preview = await files.choose(null);
  assert.equal(preview.status, 'preview');
  assert.equal(calls.length, 1);
  assert.ok(!('document' in preview) && !('filePath' in preview));
  await writeFile(target, 'changed on disk');
  assert.equal((await files.confirm(preview.ticket)).status, 'imported');
  assert.equal(calls[1].body.document, '{"format":"example"}');
  assert.equal((await files.confirm(preview.ticket)).status, 'error');
  const again = await files.choose(null);
  files.cancel(again.ticket);
  assert.equal((await files.confirm(again.ticket)).status, 'error');
}));

test('oversized, invalid UTF-8, malformed files and cancellation never import', () => isolated(async (directory) => {
  const calls = [];
  const { files, dialog, target } = fixture(directory, async (_method, route) => {
    calls.push(route); return { ok: false, message: '지원하지 않는 파일 버전입니다.' };
  });
  await writeFile(target, Buffer.from([0xff, 0xfe, 0x01]));
  assert.equal((await files.choose(null)).status, 'error');
  await writeFile(target, Buffer.alloc(5 * 1024 * 1024 + 1));
  assert.equal((await files.choose(null)).status, 'error');
  assert.equal(calls.length, 0);
  await writeFile(target, '{}');
  assert.equal((await files.choose(null)).status, 'error');
  dialog.showOpenDialog = async () => ({ canceled: true });
  assert.equal((await files.choose(null)).status, 'canceled');
  assert.deepEqual(calls, ['/api/quest-files/preview']);
}));

test('a failed import retains the preview for retry and concurrent confirmations are not duplicated', () => isolated(async (directory) => {
  let finish, imports = 0;
  const { files, target } = fixture(directory, async (_method, route) => {
    if (route.endsWith('/preview')) return { ok: true, data: {} };
    imports++;
    return new Promise((resolve) => { finish = resolve; });
  });
  await writeFile(target, '{}');
  const preview = await files.choose(null);
  const pending = files.confirm(preview.ticket);
  assert.equal((await files.confirm(preview.ticket)).status, 'error');
  finish({ ok: false, message: '저장 실패' });
  assert.equal((await pending).status, 'error');
  const retry = files.confirm(preview.ticket);
  finish({ ok: true, data: { summary: { id } } });
  assert.equal((await retry).status, 'imported');
  assert.equal(imports, 2);
}));
