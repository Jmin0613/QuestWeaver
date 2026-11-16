const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');

function startBackend({ java, jar, dataDir, onStatus }) {
  mkdirSync(dataDir, { recursive: true });
  const child = spawn(java, [
    '-jar', jar,
    '--questweaver.desktop-managed=true',
    '--server.address=127.0.0.1',
    '--server.port=0',
  ], {
    cwd: dataDir,
    env: { ...process.env, QUESTWEAVER_DATA_DIR: dataDir.replaceAll('\\', '/') },
    windowsHide: true,
  });
  const closed = new Promise((resolve) => child.once('close', resolve));
  const lines = createInterface({ input: child.stdout });
  const healthRequest = new AbortController();
  let checking = false;
  let connected = false;
  let stopPromise;
  const startupTimer = setTimeout(() => fail('백엔드 시작 시간이 초과되었습니다.'), 60_000);

  function stop() {
    if (!stopPromise) {
      stopPromise = closed;
      clearTimeout(startupTimer);
      healthRequest.abort();
      child.stdin.end();
      const forceStop = setTimeout(() => child.kill(), 5_000);
      void closed.then(() => clearTimeout(forceStop));
    }
    return stopPromise;
  }

  function fail(message) {
    if (stopPromise) return;
    onStatus({ state: 'failed', message });
    void stop();
  }

  child.stdin.on('error', (error) => console.error('[backend stdin]', error.message));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.once('error', (error) => {
    console.error('[backend]', error);
    fail('Java 백엔드를 실행할 수 없습니다.');
  });
  child.once('exit', (code, signal) => {
    console.error('[backend exit]', code, signal);
    fail(connected ? '백엔드 연결이 끊겼습니다.' : '백엔드가 시작 중 종료되었습니다.');
  });

  lines.on('line', async (line) => {
    console.log('[backend]', line);
    const ready = /^QUESTWEAVER_READY ([1-9]\d{0,4})$/.exec(line);
    if (!ready || checking || stopPromise) return;
    checking = true;

    try {
      const response = await fetch(`http://127.0.0.1:${ready[1]}/api/status`, {
        redirect: 'error',
        signal: AbortSignal.any([healthRequest.signal, AbortSignal.timeout(5_000)]),
      });
      if (!response.ok || (await response.json()).status !== 'UP') {
        throw new Error(`Unexpected status API response (HTTP ${response.status})`);
      }
      if (stopPromise || child.exitCode !== null || child.signalCode !== null) return;
      clearTimeout(startupTimer);
      connected = true;
      onStatus({ state: 'connected', message: '백엔드에 연결되었습니다.' });
    } catch (error) {
      if (stopPromise) return;
      console.error('[backend status]', error);
      fail('백엔드 상태를 확인할 수 없습니다.');
    }
  });

  return { stop };
}

module.exports = { startBackend };
