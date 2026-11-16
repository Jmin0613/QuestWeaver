const { execFileSync } = require('node:child_process');
const { existsSync, mkdtempSync, mkdirSync, copyFileSync, rmSync, renameSync, readFileSync } = require('node:fs');
const path = require('node:path');

const desktop = path.resolve(__dirname, '..');
const backend = path.resolve(desktop, '../backend');
const jdk = process.env.JAVA_HOME;
const packaging = process.argv.includes('--package');

function run(file, args, options = {}) {
  execFileSync(file, args, { stdio: 'inherit', ...options });
}

if (process.platform !== 'win32' || !jdk || !existsSync(path.join(jdk, 'jmods', 'java.base.jmod'))) {
  throw new Error('Windows x64 JDK 21을 설치하고 JAVA_HOME을 JDK 폴더로 설정하세요.');
}

const release = readFileSync(path.join(jdk, 'release'), 'utf8');
if (!/^JAVA_VERSION="21(?:[.+-][^"]*)?"\r?$/m.test(release) || !/^OS_ARCH="(?:amd64|x86_64)"\r?$/m.test(release)) {
  throw new Error('JAVA_HOME에 Windows x64 JDK 21을 지정하세요.');
}

run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'gradlew.bat', 'bootJar'], { cwd: backend });

if (packaging) {
  const staging = path.join(desktop, '.packaging');
  mkdirSync(staging, { recursive: true });
  const temporary = mkdtempSync(path.join(staging, 'runtime-'));
  const image = path.join(temporary, 'image');
  const runtime = path.join(staging, 'runtime');
  try {
    run(path.join(jdk, 'bin', 'jlink.exe'), [
      '--module-path', path.join(jdk, 'jmods'),
      '--add-modules', 'java.se,jdk.unsupported,jdk.crypto.ec,jdk.zipfs,jdk.charsets,jdk.localedata',
      '--strip-debug', '--no-header-files', '--no-man-pages', '--output', image,
    ]);
    run(path.join(image, 'bin', 'java.exe'), ['-version']);
    rmSync(runtime, { recursive: true, force: true });
    renameSync(image, runtime);
    copyFileSync(path.join(backend, 'build', 'libs', 'questweaver.jar'), path.join(staging, 'backend.jar'));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
