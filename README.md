# QuestWeaver

QuestWeaver는 퀘스트를 구조화하고 흐름을 설계하기 위한 데스크톱 앱입니다. 초기 화면에서 백엔드 연결 상태와 퀘스트 목록 영역을 확인할 수 있습니다.

## 폴더 구조

```text
backend/           Spring Boot, Java 21, Gradle Wrapper, H2
desktop/
  electron/        창, 프로세스 수명 주기, 상태 전달
  scripts/         백엔드 빌드 및 Windows 런타임 준비
  src/             React + TypeScript 화면
```

## 사전 준비

- Windows x64와 Node.js 24 LTS를 사용합니다.
- 최신 보안 업데이트가 적용된 Windows x64 OpenJDK 21 배포판(JDK)을 설치합니다. `JAVA_HOME`에는 `bin`의 상위 폴더인 JDK 설치 경로를 지정합니다. Windows 배포 빌드에는 JDK의 `jlink`와 `jmods`가 필요합니다.
- 처음 빌드할 때는 npm, Gradle, Maven Central 및 Electron 배포 서버에 접근할 수 있어야 합니다.

## 개발 실행

이 문서가 있는 폴더에서 PowerShell을 실행합니다.

```powershell
$env:JAVA_HOME = 'C:\path\to\jdk-21'
cd desktop
npm.cmd ci
npm.cmd run dev
```

`dev`는 실행 JAR과 화면을 빌드한 뒤 Electron을 실행합니다. 코드를 수정한 뒤에는 앱을 닫고 명령을 다시 실행합니다. 창을 닫으면 Java에 정상 종료를 요청하고, 5초 안에 종료되지 않으면 Electron이 자신이 시작한 Java 프로세스를 종료합니다. 앱을 다시 실행하면 이미 열린 창으로 이동합니다.

백엔드는 `127.0.0.1`에 바인딩하고 운영체제가 배정한 빈 포트를 사용합니다. 시작을 마치면 Electron에 실제 포트를 전달합니다. Electron은 `GET /api/status`의 `{"status":"UP"}` 응답을 확인한 뒤 연결 성공을 표시합니다. 시작에 실패하거나 실행 중 Java가 종료되면 실패 메시지를 표시합니다. 개발 실행에서는 PowerShell에 기록된 백엔드 출력을 확인할 수 있습니다.

H2 파일은 Windows에서 기본적으로 `%APPDATA%\QuestWeaver\data\questweaver.mv.db`에 생성됩니다. 개발 앱과 설치 앱은 같은 사용자 데이터 폴더를 사용하므로 한 번에 하나만 실행합니다.

## 빌드 및 테스트

다음 명령은 이 문서가 있는 폴더를 기준으로 실행합니다.

```powershell
Push-Location backend
.\gradlew.bat test bootJar
Pop-Location
npm.cmd --prefix desktop run build
```

## Windows x64 배포

개발 실행과 같은 사전 준비를 마친 뒤 실행합니다.

```powershell
cd desktop
npm.cmd ci
npm.cmd run dist:win
```

`desktop/release/`에 NSIS 설치 프로그램과 `win-unpacked/`가 생성됩니다. 배포 앱은 `resources/backend/questweaver.jar`와 `resources/runtime/`의 Java 21 런타임을 사용합니다. 설치 대상 PC에는 Java나 Node.js가 필요하지 않습니다. 기본 빌드에는 코드 서명이 적용되지 않습니다.

설치 검증은 Java가 없는 Windows x64 환경에서 설치 프로그램을 실행해 진행할 수 있습니다. 시작 메뉴에서 QuestWeaver를 열어 연결 성공을 확인하고, 한 번 더 실행해 기존 창으로 이동하는지 확인합니다. 창을 닫은 뒤 작업 관리자에서 이 앱이 시작한 Java 프로세스가 종료됐는지 확인합니다. 앱을 다시 열어 같은 사용자 데이터 폴더의 DB로 연결되는지 확인합니다.
