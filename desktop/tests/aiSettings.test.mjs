import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const { createAiSettings } = createRequire(import.meta.url)('../electron/aiSettings.cjs');

// Mock OS security without retaining plaintext on disk. Actual Windows DPAPI is tested in E2E.
const secret = randomBytes(32);
const secure = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (value) => {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, nonce);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), data]);
  },
  decryptStringAsync: async (buffer) => {
    const cipher = createDecipheriv('aes-256-gcm', secret, buffer.subarray(0, 12));
    cipher.setAuthTag(buffer.subarray(12, 28));
    return { result: Buffer.concat([cipher.update(buffer.subarray(28)), cipher.final()]).toString(), shouldReEncrypt: false };
  },
};
async function withDirectory(fn) {
  const directory = await mkdtemp(path.join(tmpdir(), 'qw-ai-unit-'));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('session keys disappear on restart and take precedence over environment without exposing key status', () => withDirectory(async (directory) => {
  const settings = createAiSettings({ directory, safeStorage: secure, environmentKey: 'fake-environment' });
  assert.equal((await settings.status()).source, 'environment');
  assert.equal((await settings.save('fake-session', false)).ok, true);
  assert.equal(await settings.key(), 'fake-session');
  assert.equal((await settings.status()).source, 'session');
  assert.ok(!JSON.stringify(await settings.status()).includes('fake-'));
  const restarted = createAiSettings({ directory, safeStorage: secure, environmentKey: 'fake-environment' });
  assert.equal(await restarted.key(), 'fake-environment');
  await settings.remove();
  assert.equal((await settings.status()).source, 'environment');
}));

test('encrypted persistence, replacement and deletion never resurrect an old stored key', () => withDirectory(async (directory) => {
  const make = () => createAiSettings({ directory, safeStorage: secure });
  const initial = make();
  await initial.save('fake-persistent', true);
  assert.ok(!(await readFile(path.join(directory, 'openai-key.enc'))).includes(Buffer.from('fake-persistent')));
  const restarted = make();
  assert.equal((await restarted.status()).source, 'stored');
  assert.equal(await restarted.key(), 'fake-persistent');
  await restarted.save('fake-replacement', false);
  assert.equal((await make().status()).source, 'none');
  await restarted.save('fake-new-persistent', true);
  await restarted.remove();
  assert.equal((await make().status()).source, 'none');
}));

test('unavailable or insecure OS storage falls back to memory, never plaintext', () => withDirectory(async (directory) => {
  for (const safeStorage of [
    { ...secure, isAsyncEncryptionAvailable: async () => false },
    { ...secure, getSelectedStorageBackend: () => 'basic_text' },
    { ...secure, encryptStringAsync: async () => { throw new Error('unavailable'); } },
  ]) {
    const settings = createAiSettings({ directory, safeStorage });
    const result = await settings.save('fake-session-only', true);
    assert.equal(result.data.source, 'session');
    assert.match(result.data.warning, /이번 실행/);
    await assert.rejects(readFile(path.join(directory, 'openai-key.enc')), { code: 'ENOENT' });
    assert.equal((await createAiSettings({ directory, safeStorage }).status()).source, 'none');
  }
}));

test('malformed input is rejected and concurrent mutations are serialized', () => withDirectory(async (directory) => {
  const settings = createAiSettings({ directory, safeStorage: secure });
  for (const invalid of ['', 'a\nb', {}, 'a'.repeat(2049), '가짜키']) {
    assert.equal((await settings.save(invalid, false)).ok, false);
  }
  await Promise.all([settings.save('fake-first', true), settings.save('fake-second', false), settings.remove()]);
  assert.equal(await settings.key(), '');
  assert.equal((await createAiSettings({ directory, safeStorage: secure }).status()).source, 'none');
}));

test('filesystem failure preserves the active and previously stored key and sanitizes errors', () => withDirectory(async (directory) => {
  const settings = createAiSettings({ directory, safeStorage: secure });
  await settings.save('fake-previous', true);
  await mkdir(path.join(directory, 'openai-key.enc.tmp'));
  const result = await settings.save('fake-new', false);
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes('fake-'));
  assert.equal(await settings.key(), 'fake-previous');
  const restarted = createAiSettings({ directory, safeStorage: secure });
  assert.equal(await restarted.key(), 'fake-previous');
}));
