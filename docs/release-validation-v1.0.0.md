# v1.0.0 배포 후보 검증 기록

검증일: 2026-11-25 (한국 시간). 사용자 DB·실제 API 키를 읽거나 변경하지 않았고, 유료 AI 요청을 보내지 않았습니다.

## 버전과 원격 상태

- 시작 시 앱 0.1.0, backend 0.0.1-SNAPSHOT → 앱·lockfile 루트 두 곳·backend 모두 1.0.0.
- `git ls-remote --tags origin` 결과 태그 없음. GitHub 공개 releases API 결과 공개 릴리즈 없음. 비인증 조회이므로 비공개 초안의 존재는 확인 범위 밖입니다.
- origin: `https://github.com/Jmin0613/QuestWeaver.git`, 기준 커밋 `21a61fa`.
- 실행 파일 리소스도 FileVersion 1.0.0, ProductVersion 1.0.0.0 확인. `signExecutable: false`로 서명만 생략하고 버전 리소스는 작성합니다.

## 자동 검증 결과

| 구분 | 실제 결과 |
| --- | --- |
| backend `test bootJar` | 성공. 현재 입력의 Gradle 캐시 결과 재사용(UP-TO-DATE), 테스트 XML 30건·실패 0·오류 0 |
| TypeScript + Vite build | 성공 |
| Node 단위 테스트 | 33건 통과 |
| 개발 바이너리 E2E | workspace, aiSettings, flowLayout, menu, questFiles 모두 통과 |
| 최종 win-unpacked E2E | questFiles, flowLayout, menu 통과 |
| 최종 win-unpacked 신규 프로필 smoke | 번들 런타임 연결, 빈 목록·키 미등록, 한글 AI 연결 설정, 중복 실행 시 최소화 창 복원, 앱 종료 후 backend 포트 해제, 재실행 통과 |
| NSIS x64 생성 | 성공 |
| 실제 NSIS 설치/시작 메뉴 실행 | 미검증 |

개발/패키지 E2E는 임시 프로필·임시 H2와 테스트 파일을 사용합니다. UI 조작은 합성 이벤트이며 네이티브 저장 대화상자는 테스트 경로로 대체합니다. JSON 가져오기·내보내기·반복 가져오기·오류/취소, 편집·저장·재실행·미리보기·PNG, 구조 검사 상태 유지, 배치·이력을 확인했습니다. AI 관련 자동 검증은 모의 응답이며 유료 호출이 아닙니다. 실제 OS 키 입력·네이티브 대화상자·별도 사용자 설치를 대체하지 않습니다.

신규 프로필 smoke는 JAVA_HOME/JDK_HOME을 제거한 자식 환경에서 실행했습니다. 앱 소스의 패키지 실행 분기는 resources/runtime/bin/java.exe를 지정합니다. 시스템 Java/Node가 아예 없는 VM 자체에서의 검증은 아닙니다. 세션/보안 저장 키 검증은 가짜 키와 임시 프로필로 개발 바이너리에서 수행했으며 개인 보관 키는 사용하지 않았습니다.

경고: Vite의 React Flow `use client` 번들 경고와 Node의 TypeScript 모듈 유형 추론 경고가 남습니다. 빌드·테스트는 성공했습니다. electron-builder는 작성자 미지정·기본 Electron 아이콘을 안내했습니다.

## 배포물 점검

- 명시적 패키지 구성은 `electron/**/*`, `dist/**/*` 및 준비한 backend JAR·jlink runtime만 포함합니다.
- 최종 win-unpacked 파일 284개, app.asar 항목 15개 확인. app.asar는 dist·electron·package.json만 포함하고, 이미지·테스트·샘플·사용자 프로필은 없습니다.
- 앱 텍스트 파일 12개에서 API 키 형태 리터럴·개인키 헤더를 점검했으며 해당 항목은 발견되지 않았습니다. 실제 키를 읽어 대조하지 않았습니다. 환경변수 이름과 키 처리 코드는 정상적으로 포함됩니다.
- 디스크/asar에서 DB·보안 키 저장 파일·환경설정 비밀 파일·로그·검증 이미지·캐시가 없는지 확인했습니다.
- 번들 JAR은 현재 build JAR과 바이트 단위로 일치합니다. JAR 앱 리소스 52개는 애플리케이션 클래스와 application.yaml이며 샘플 JSON·DB·로그·환경변수 파일이 없습니다.
- React Flow LICENSE와 표시용 attribution이 유지됩니다. 번들 Java의 legal 자료도 runtime 안에 유지됩니다.
- NSIS는 이 최종 패키지를 대상으로 생성됐습니다. 설치 프로그램 내부를 별도 재추출하여 비교하거나 실제 설치한 점검은 수행하지 않았습니다.
- 실제 사용자 데이터 폴더와 보안 저장 파일은 점검 대상으로 열지 않았습니다. 원본 images/ 캡처는 보존하고 선택한 복사본 6장만 docs/images/에 영문명으로 배치했습니다.

설치 파일 크기와 SHA-256은 [릴리즈 노트 초안](release-notes-v1.0.0.md)에 기록했습니다. 최종 파일은 서명되지 않았습니다.

## 공개 전 실제 설치 확인 순서

기존 사용자 데이터를 보호하려면 현재 사용자 대신 **새 Windows 사용자 또는 별도 VM**을 사용합니다. 기존 앱 폴더·DB를 지우지 마세요. 새 사용자/VM에 Java·Node를 별도 설치하지 않은 상태에서 진행합니다. 실제 API 키를 넣거나 생성 확정할 필요는 없습니다.

1. 최신 보안 패치의 Windows x64 JDK 21로 재빌드하고 설치 파일 해시를 다시 기록합니다. 이 후보의 OpenJDK 21.0.2를 최신 런타임이라고 표시하지 마세요.
2. 새 환경에서 설치 파일의 출처·해시를 확인하고 설치합니다. 시작 메뉴로 실행해 백엔드 연결과 빈 목록을 확인합니다. 설치·제거 도중의 Windows 보안 대화상자는 직접 판단합니다.
3. 파일/편집/보기/창 메뉴와 AI 연결 설정의 제목·설명·모델·키 미등록 상태를 확인하고 취소합니다. 일반 수동 기능이 키 없이 동작하는지 확인합니다.
4. 테스트 퀘스트를 등록하고 원문·기획 정보·단계·분기·재도전 경로를 작성합니다. 크기·조건·경로를 바꾸고 가로/세로 자동 배치, 실행 취소·다시 실행, 구조 검사, 저장을 확인합니다.
5. 테스트용 JSON을 네이티브 대화상자로 내보내고 다시 가져와 별도 임시저장 항목이 생기는지 확인합니다. 파일 선택·저장 취소도 확인합니다. 실제 개인 퀘스트 JSON을 사용할 필요는 없습니다.
6. 상세 미리보기에서 단계를 클릭하고 PNG를 실제 저장합니다. 한글·화살표·조건·화면 밖 단계와 우회 경로가 포함되는지 확인합니다.
7. 입력란의 Ctrl+Z/Ctrl+Y와 차트 단축키를 비교하고 미저장 이탈/종료를 취소해 입력이 남는지 확인합니다.
8. 앱을 두 번 실행해 기존 창이 활성화되는지, 창을 최소화한 뒤에도 복원되는지 확인합니다.
9. 정상 종료 후 앱이 시작한 Java 프로세스가 끝나는지 확인합니다. 시작 메뉴로 재실행해 원문·기획 정보·배치·경로·크기가 복원되는지 확인합니다.
10. 결과를 이 문서에 기록한 뒤 공개를 결정합니다. 실제 설치/재실행에 실패했다면 아직 검증 완료로 표시하지 마세요.

## 재현 명령

프로젝트 루트 PowerShell, JDK 21 및 npm 의존성 설치 후:

```powershell
$env:JAVA_HOME = 'C:\path\to\jdk-21'
cd backend
.\gradlew.bat test bootJar
cd ..
npm.cmd --prefix desktop run build
node --test desktop/tests/*.test.mjs
# 개발 E2E: README에 나열된 5개 파일

cd desktop
npm.cmd run dist:win
cd ..
$env:QUESTWEAVER_TEST_EXECUTABLE = Join-Path $PWD 'desktop\release\win-unpacked\QuestWeaver.exe'
try {
    node desktop/tests/releaseSmoke.e2e.cjs
    node desktop/tests/questFiles.e2e.cjs
    node desktop/tests/flowLayout.e2e.cjs
    node desktop/tests/menu.e2e.cjs
} finally {
    Remove-Item Env:QUESTWEAVER_TEST_EXECUTABLE -ErrorAction SilentlyContinue
}
Get-FileHash 'desktop\release\QuestWeaver Setup 1.0.0.exe' -Algorithm SHA256
```

이 환경변수는 테스트 하네스에서만 사용되며 제품 코드의 사용자 데이터 경로나 실행 동작을 변경하지 않습니다.
