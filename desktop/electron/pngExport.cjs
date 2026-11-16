const { app, dialog } = require('electron');
const { randomUUID } = require('node:crypto');
const { open, rename, unlink } = require('node:fs/promises');
const path = require('node:path');

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let saving = false;

function filename(title) {
  const safe = Array.from(title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim())
    .slice(0, 100).join('').replace(/[. ]+$/u, '') || '퀘스트';
  // A title can contain a dot after a reserved Windows device name.
  const reserved = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(safe);
  return `${reserved ? '_' : ''}${safe}-flow.png`;
}

async function savePng(window, title, bytes) {
  if (saving) return { status: 'error', message: '이미 PNG 내보내기를 진행하고 있습니다.' };
  if (typeof title !== 'string' || title.length > 1000 ||
      !(bytes instanceof Uint8Array) || bytes.length < 33 || bytes.length > 40_000_000) {
    return { status: 'error', message: '저장할 PNG 데이터가 올바르지 않거나 너무 큽니다.' };
  }
  const png = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (!png.subarray(0, 8).equals(pngSignature) || png.toString('ascii', 12, 16) !== 'IHDR' ||
      width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 24_000_000) {
    return { status: 'error', message: 'PNG 형식 또는 이미지 크기 제한을 확인하세요.' };
  }
  saving = true;
  let temporary;
  try {
    const result = await dialog.showSaveDialog(window, {
      title: '퀘스트 플로우 PNG 저장',
      defaultPath: path.join(app.getPath('downloads'), filename(title)),
      filters: [{ name: 'PNG 이미지', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return { status: 'canceled' };
    if (path.extname(result.filePath).toLowerCase() !== '.png') {
      return { status: 'error', message: '파일 확장자를 .png로 지정해 주세요.' };
    }
    const candidate = path.join(path.dirname(result.filePath), `.questweaver-${randomUUID()}.tmp`);
    // Write to a sibling file first so a failed write leaves an existing image intact.
    const output = await open(candidate, 'wx');
    temporary = candidate;
    try {
      await output.writeFile(png);
    } finally {
      await output.close();
    }
    await rename(temporary, result.filePath);
    temporary = undefined;
    return { status: 'saved' };
  } catch (error) {
    const message = {
      EACCES: '저장 위치에 쓰기 권한이 없습니다.',
      EPERM: '저장 위치에 쓰기 권한이 없거나 다른 프로그램이 파일을 사용 중입니다.',
      ENOSPC: '저장 공간이 부족합니다.',
      ENOENT: '선택한 저장 폴더를 찾을 수 없습니다.',
      EBUSY: '다른 프로그램이 파일을 사용 중입니다.',
    }[error.code] ?? 'PNG 파일을 저장하지 못했습니다. 다른 저장 위치를 선택해 주세요.';
    return { status: 'error', message };
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
    saving = false;
  }
}

module.exports = { savePng };
