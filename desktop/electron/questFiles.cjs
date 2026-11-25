const { randomUUID } = require('node:crypto');
const { open, rename, unlink } = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const maxBytes = 5 * 1024 * 1024;
function filename(title) {
  const base = Array.from((title || '제목 없는 퀘스트').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim())
    .slice(0, 100).join('').replace(/[. ]+$/u, '') || '퀘스트';
  return `${/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(base) ? '_' : ''}${base}-quest.json`;
}
function fileError(error) {
  return { status: 'error', message: ({ EACCES: '파일 접근 권한이 없습니다. 다른 위치를 선택하세요.',
    EPERM: '파일에 접근할 수 없습니다. 사용 중인지 확인하세요.', ENOSPC: '디스크 공간이 부족합니다.',
    ENOENT: '선택한 파일이나 폴더를 찾을 수 없습니다.' })[error.code] || '퀘스트 파일을 처리하지 못했습니다. 파일과 저장 위치를 확인하세요.' };
}

function createQuestFiles({ dialog, downloads, request }) {
  let busy = false;
  let candidate;
  async function exclusive(action) {
    if (busy) return { status: 'error', message: '이미 퀘스트 파일을 처리하고 있습니다.' };
    busy = true;
    try { return await action(); } catch (error) { return fileError(error); } finally { busy = false; }
  }
  return {
    export: (window, id) => exclusive(async () => {
      if (typeof id !== 'string' || !/^[a-f\d-]{36}$/.test(id)) return { status: 'error', message: '퀘스트를 확인하세요.' };
      const reply = await request('GET', `/api/quests/${id}/file`);
      if (!reply.ok) return { status: 'error', message: reply.message };
      const bytes = Buffer.from(JSON.stringify(reply.data, null, 2) + '\n', 'utf8');
      if (bytes.length > maxBytes) return { status: 'error', message: '퀘스트 파일 크기 제한인 5 MiB를 초과합니다.' };
      const result = await dialog.showSaveDialog(window, { title: '퀘스트 파일 내보내기',
        defaultPath: path.join(downloads(), filename(reply.data.quest.title)),
        filters: [{ name: 'QuestWeaver 퀘스트 JSON', extensions: ['json'] }] });
      if (result.canceled || !result.filePath) return { status: 'canceled' };
      if (path.extname(result.filePath).toLowerCase() !== '.json') return { status: 'error', message: '확장자를 .json으로 지정하세요.' };
      let temporary;
      try {
        const sibling = path.join(path.dirname(result.filePath), `.questweaver-${randomUUID()}.tmp`);
        const file = await open(sibling, 'wx', 0o600);
        temporary = sibling;
        try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
        await rename(temporary, result.filePath);
        temporary = undefined;
        return { status: 'saved' };
      } finally { if (temporary) await unlink(temporary).catch(() => {}); }
    }),
    choose: (window) => exclusive(async () => {
      candidate = undefined;
      const selection = await dialog.showOpenDialog(window, { title: '퀘스트 파일 가져오기', properties: ['openFile'],
        filters: [{ name: 'QuestWeaver 퀘스트 JSON', extensions: ['json'] }] });
      if (selection.canceled || !selection.filePaths?.[0]) return { status: 'canceled' };
      const file = await open(selection.filePaths[0], 'r');
      let document;
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > maxBytes) return { status: 'error', message: '5 MiB 이하의 일반 JSON 파일을 선택하세요.' };
        // Bound the read even if another process grows the file after stat().
        const buffer = Buffer.alloc(maxBytes + 1);
        let size = 0;
        while (size < buffer.length) {
          const result = await file.read(buffer, size, buffer.length - size, null);
          if (!result.bytesRead) break;
          size += result.bytesRead;
        }
        if (size > maxBytes) return { status: 'error', message: '퀘스트 파일은 5 MiB 이하여야 합니다.' };
        try { document = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)); }
        catch { return { status: 'error', message: 'UTF-8 JSON 파일이 아닙니다. 파일 인코딩을 확인하세요.' }; }
      } finally { await file.close(); }
      const reply = await request('POST', '/api/quest-files/preview', { document });
      if (!reply.ok) return { status: 'error', message: reply.message };
      const ticket = randomUUID();
      candidate = { ticket, document };
      return { status: 'preview', ticket, summary: reply.data };
    }),
    confirm: (ticket) => exclusive(async () => {
      if (!candidate || ticket !== candidate.ticket) return { status: 'error', message: '가져올 파일을 다시 선택하세요.' };
      const reply = await request('POST', '/api/quest-files/import', { document: candidate.document });
      if (!reply.ok) return { status: 'error', message: reply.message };
      candidate = undefined;
      return { status: 'imported', quest: reply.data };
    }),
    cancel: (ticket) => { if (!busy && candidate?.ticket === ticket) candidate = undefined; },
  };
}
module.exports = { createQuestFiles, filename };
