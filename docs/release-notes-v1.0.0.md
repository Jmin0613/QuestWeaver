# QuestWeaver v1.0.0

Windows x64 첫 정식 공개 버전입니다. [다운로드 및 첨부 파일](https://github.com/Jmin0613/QuestWeaver/releases/tag/v1.0.0)

QuestWeaver의 첫 정식 공개 버전인 Windows x64 로컬 퀘스트 기획 도구입니다. 퀘스트 원문 작성부터 플로우 편집·구조 검사·백업까지 한 PC에서 이어서 작업할 수 있습니다.

## 포함 기능

- 게임·지역별 퀘스트 관리와 검색, 수동 임시저장·등록
- 퀘스트 공통 및 단계별 기획 정보, 독립 스크롤 속성 패널
- 단계 크기·좌우형/상하형 연결점·직선/꺾은선/곡선 편집
- 실행 취소·다시 실행과 가로·세로 로컬 자동 배치
- 그래프 구조 검사, 상세 미리보기와 전체 차트 PNG 내보내기
- 사용자 OpenAI API 키 설정과 AI 초안 미리보기·적용·명시적 저장
- 버전 1 JSON 내보내기·새 퀘스트로 가져오기
- 한글 네이티브 메뉴, 백엔드 자동 실행·종료와 개발/설치 DB 분리

## 배포 파일

| 항목 | 값 |
| --- | --- |
| GitHub 첨부 파일 | `QuestWeaver.Setup.1.0.0.exe` |
| 로컬 위치 | `desktop/release/QuestWeaver Setup 1.0.0.exe` |
| 크기 | 194,892,303 bytes (185.86 MiB) |
| SHA-256 | `1D67D4E522C03583AD9FC432CDB8102FECE6294992F17B1839C33A628EDF843A` |
| 대상 | Windows x64 / NSIS / 현재 사용자 설치 |
| 서명 | 없음 (`NotSigned`) |
| 번들 | Electron 45.3.3, Eclipse Temurin 21.0.13.1+2 런타임, Java 백엔드 |

설치 대상 PC에 별도 Java·Node.js 설치는 필요하지 않습니다. 샘플 JSON·DB·API 키·보안 저장 파일은 첨부하지 않습니다. 공개 첨부 대상은 검증을 마친 해당 설치 파일과 `SHA256SUMS.txt`입니다. 구버전 0.1.0 설치 파일·win-unpacked·builder-debug·테스트 이미지·사용자 데이터는 첨부 대상이 아닙니다.

## 사용 전 안내

신규 프로필은 빈 퀘스트 목록과 키 미등록 상태에서 시작합니다. 기존 프로필의 작업은 초기화하지 않습니다. README 화면의 퀘스트는 사용 예시이며 설치 파일에 포함되지 않습니다.

AI 생성 시 저장된 퀘스트 원문을 OpenAI로 전송하고 본인의 API 계정에 비용이 청구됩니다. ChatGPT 구독과 API 과금은 별개입니다. AI 결과는 검토·수정할 초안이며, 구조 검사는 게임 실행이나 자유 입력 조건의 의미까지 검증하지 않습니다. 키 없이 수동 기능을 사용할 수 있습니다.

## 호환성과 한계

- 과거 수동 곡선이 현재 단일 3차 베지어 표시에서 일부 다르게 보일 수 있습니다.
- 자동 배치는 복잡한 그래프의 모든 선 교차·문구 겹침을 제거하지 않습니다.
- 코드 서명이 없고 기본 Electron 아이콘을 사용합니다.
- Java 런타임은 2026-11-25 공식 Adoptium API의 Windows x64 Java 21 최신 배포(21.0.13.1+2)로 재생성했습니다. 모듈별 legal 자료와 Temurin NOTICE를 포함합니다.

## 검증 범위

사용자가 최종 설치 파일로 **실제 설치·실행, 저장 후 종료·재실행 시 데이터 유지**를 직접 확인했습니다. 별도 Windows 사용자/VM 사용 여부, 설치 앱의 JSON·PNG 네이티브 파일 대화상자, 중복 실행·백엔드 정리 등은 이번 사용자 보고만으로 확인됐다고 기록하지 않습니다.

백엔드 테스트 30개, 프론트 단위 테스트 33개와 최종 win-unpacked 바이너리 자동 검증 5개가 통과했습니다. 자동 검증은 임시 DB·프로필과 모의 AI를 사용했고, 파일 대화상자는 테스트 경로로 대체했습니다. win-unpacked 검증과 사용자 직접 설치 검증을 구분합니다. 이번 릴리즈 준비 중 실제 유료 AI API는 호출하지 않았습니다.

세부 범위는 [검증 기록](release-validation-v1.0.0.md)을 참고하세요.

## 번들 Java 고지와 소스

Eclipse Temurin의 NOTICE 및 runtime/legal/ 아래 GPLv2·Classpath Exception·Assembly Exception·타사 고지를 보존합니다. [공식 배포](https://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.13.1%2B2), [해당 버전 OpenJDK 소스](https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13.1%2B2/OpenJDK21U-jdk-sources_21.0.13.1_2.tar.gz).

설치 파일의 기존 SHA-256과 빌드 입력을 재확인했으며, v1.0.0 태그의 앱 소스를 대상으로 배포합니다. README 정리로 앱이나 설치 파일을 재빌드하지 않았습니다.

GitHub는 업로드 파일명의 공백을 점으로 정리합니다. 로컬 설치 파일과 공개 첨부 파일의 내용·SHA-256은 같으며, SHA256SUMS.txt는 공개 첨부 파일명을 기준으로 합니다.
