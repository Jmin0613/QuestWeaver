// Match Electron's existing Windows default menu, including developer tools in both builds.
// Keep roles (and their native accelerators/behaviour); translate only visible labels.
function installKoreanMenu(Menu) {
  const separator = () => ({ type: 'separator' });
  const template = [
    { label: '파일', role: 'fileMenu', submenu: [
      { label: '종료', role: 'quit' },
    ] },
    { label: '편집', role: 'editMenu', submenu: [
      { label: '실행 취소', role: 'undo' },
      { label: '다시 실행', role: 'redo' },
      separator(),
      { label: '잘라내기', role: 'cut' },
      { label: '복사', role: 'copy' },
      { label: '붙여넣기', role: 'paste' },
      { label: '삭제', role: 'delete' },
      separator(),
      { label: '모두 선택', role: 'selectAll' },
    ] },
    { label: '보기', role: 'viewMenu', submenu: [
      { label: '새로고침', role: 'reload' },
      { label: '강제 새로고침', role: 'forceReload' },
      { label: '개발자 도구', role: 'toggleDevTools' },
      separator(),
      { label: '실제 크기', role: 'resetZoom' },
      { label: '확대', role: 'zoomIn' },
      { label: '축소', role: 'zoomOut' },
      separator(),
      { label: '전체 화면 전환', role: 'togglefullscreen' },
    ] },
    { label: '창', role: 'windowMenu', submenu: [
      { label: '최소화', role: 'minimize' },
      { label: '최대화/복원', role: 'zoom' },
      { label: '창 닫기', role: 'close' },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { installKoreanMenu };
