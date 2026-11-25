import { useEffect, useRef, useState } from 'react';
import { questTitle } from './api';
import type { QuestFilePreview } from './api';

export function QuestFileExport({ id, disabled }: { id: string; disabled: boolean }) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function save() {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage(''); setError('');
    try {
      const result = await window.questWeaver.exportQuestFile(id);
      if (result.status === 'saved') setMessage('퀘스트 파일을 저장했습니다.');
      if (result.status === 'error') setError(result.message);
    } catch { setError('퀘스트 파일 내보내기를 완료하지 못했습니다. 다시 시도하세요.'); }
    finally { busy.current = false; setPending(false); }
  }
  return <div className="quest-file-action">
    <button type="button" disabled={disabled || pending} onClick={() => void save()}>
      {pending ? '내보내는 중…' : '퀘스트 파일 내보내기'}</button>
    {message && <p role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

export function QuestFileImport({ disabled, onImported }: { disabled: boolean; onImported: (id: string) => void }) {
  const [preview, setPreview] = useState<QuestFilePreview>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false), active = useRef(true), ticket = useRef<string | undefined>(undefined);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (ticket.current) window.questWeaver.cancelQuestFile(ticket.current);
    };
  }, []);
  function cancel() {
    if (busy.current) return;
    if (ticket.current) window.questWeaver.cancelQuestFile(ticket.current);
    ticket.current = undefined; setPreview(undefined); setError('');
  }
  async function choose() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError('');
    try {
      const result = await window.questWeaver.chooseQuestFile();
      if (!active.current) {
        if (result.status === 'preview') window.questWeaver.cancelQuestFile(result.ticket);
        return;
      }
      if (result.status === 'preview') { ticket.current = result.ticket; setPreview(result); }
      if (result.status === 'error') setError(result.message);
    } catch { if (active.current) setError('퀘스트 파일을 열지 못했습니다. 다시 선택하세요.'); }
    finally { busy.current = false; if (active.current) setPending(false); }
  }
  async function confirm() {
    if (!preview || busy.current) return;
    busy.current = true; setPending(true); setError('');
    try {
      const result = await window.questWeaver.importQuestFile(preview.ticket);
      if (!active.current) return;
      if (result.status === 'imported') { ticket.current = undefined; setPreview(undefined); onImported(result.quest.summary.id); }
      if (result.status === 'error') setError(result.message);
    } catch { if (active.current) setError('가져오기를 완료하지 못했습니다. 목록을 확인하고 다시 시도하세요.'); }
    finally { busy.current = false; if (active.current) setPending(false); }
  }
  return <div className="quest-file-action">
    <button type="button" disabled={disabled || pending} onClick={() => void choose()}>
      {pending ? '파일 처리 중…' : '퀘스트 파일 가져오기'}</button>
    {error && !preview && <p role="alert" className="error">{error}</p>}
    {preview && <ImportPreview preview={preview} pending={pending} error={error} cancel={cancel} confirm={() => void confirm()} />}
  </div>;
}

function ImportPreview({ preview, pending, error, cancel, confirm }: {
  preview: QuestFilePreview; pending: boolean; error: string; cancel: () => void; confirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  const info = preview.summary;
  return <dialog ref={dialog} className="quest-import-dialog" aria-labelledby="quest-import-title" onCancel={(event) => {
    event.preventDefault(); if (!pending) cancel();
  }}>
    <h2 id="quest-import-title">퀘스트 파일 가져오기 확인</h2>
    <dl className="metadata">
      <div><dt>퀘스트명</dt><dd>{questTitle(info.title)}</dd></div>
      <div><dt>게임</dt><dd>{info.game || '미선택'}</dd></div>
      <div><dt>지역</dt><dd>{info.region || '미선택'}</dd></div>
      <div><dt>단계</dt><dd>{info.steps}개</dd></div>
      <div><dt>연결선</dt><dd>{info.links}개</dd></div>
    </dl>
    <p>기존 퀘스트를 덮어쓰지 않고 새 임시저장 퀘스트를 만듭니다. 작성일과 수정일은 가져온 시각으로 시작합니다.</p>
    <p className="hint">파일 형식만 검증했습니다. 가져온 뒤 편집기에서 구조 검사를 다시 실행하세요.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="actions"><button type="button" disabled={pending} onClick={cancel}>취소</button>
      <button type="button" className="primary" disabled={pending} onClick={confirm}>
        {pending ? '가져오는 중…' : '새 퀘스트로 가져오기'}</button></div>
  </dialog>;
}
