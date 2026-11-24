const fs = require('node:fs/promises');
const path = require('node:path');

// Only the main process holds credentials. Public results contain status, never keys.
function createAiSettings({ directory, safeStorage, environmentKey = '', model = 'gpt-5.4-mini' }) {
  const file = path.join(directory, 'openai-key.enc');
  let key = '', persisted = false, warning = '', available = false;
  let queue = Promise.resolve();
  const valid = (value) => typeof value === 'string' && /^[\x21-\x7e]{1,2048}$/.test(value);
  const fallback = valid(environmentKey.trim()) ? environmentKey.trim() : '';
  const status = () => ({ source: key ? (persisted ? 'stored' : 'session') : fallback ? 'environment' : 'none',
    configured: Boolean(key || fallback), model, secureStorageAvailable: available, warning });
  const serial = (action) => {
    const next = queue.then(action);
    queue = next.catch(() => {});
    return next;
  };
  async function initialize() {
    try {
      available = await safeStorage.isAsyncEncryptionAvailable()
        && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
      const encrypted = await fs.readFile(file);
      if (!available) throw new Error('unavailable');
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      if (!valid(decrypted.result)) throw new Error('invalid');
      key = decrypted.result;
      persisted = true;
      if (decrypted.shouldReEncrypt) {
        await fs.writeFile(file + '.tmp', await safeStorage.encryptStringAsync(key), { mode: 0o600 });
        await fs.rename(file + '.tmp', file);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') warning = '저장된 키를 안전하게 읽지 못했습니다. 키를 다시 등록하거나 삭제하세요.';
    }
  }
  const ready = initialize();
  return {
    ready,
    status: async () => { await ready; await queue; return status(); },
    // The returned snapshot belongs only to the request that is about to start.
    key: async () => { await ready; await queue; return key || fallback; },
    save: (value, store) => serial(async () => {
      await ready;
      if (typeof value !== 'string' || !valid(value.trim()) || typeof store !== 'boolean') {
        return { ok: false, message: '올바른 API 키를 입력하세요. 공백이나 줄바꿈은 사용할 수 없습니다.' };
      }
      const next = value.trim();
      let encrypted;
      if (store && available) {
        try { encrypted = await safeStorage.encryptStringAsync(next); }
        catch { available = false; }
      }
      try {
        // Finish temporary-file cleanup before the persistent value is changed.
        await fs.rm(file + '.tmp', { force: true });
        if (encrypted) {
          await fs.mkdir(directory, { recursive: true });
          await fs.writeFile(file + '.tmp', encrypted, { mode: 0o600 });
          await fs.rename(file + '.tmp', file);
        } else {
          // Remove the old persistent value before accepting a session replacement.
          await fs.rm(file, { force: true });
        }
        key = next;
        persisted = Boolean(encrypted);
        warning = store && !available ? '안전한 PC 저장을 사용할 수 없어 이번 실행에서만 사용합니다.' : '';
        return { ok: true, data: status() };
      } catch {
        return { ok: false, message: '키 보관 파일을 변경하지 못했습니다. 이전 설정을 유지합니다. 폴더 접근 권한을 확인하세요.' };
      }
    }),
    remove: () => serial(async () => {
      await ready;
      try {
        await fs.rm(file + '.tmp', { force: true });
        await fs.rm(file, { force: true });
        key = ''; persisted = false; warning = '';
        return { ok: true, data: status() };
      } catch {
        return { ok: false, message: '저장된 키를 삭제하지 못했습니다. 폴더 접근 권한을 확인하세요.' };
      }
    }),
  };
}

module.exports = { createAiSettings };
