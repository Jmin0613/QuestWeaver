import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AiSettingsStatus } from './api';

type SettingsContext = { open: (continuing?: boolean) => Promise<boolean>; status?: AiSettingsStatus; refresh: () => Promise<AiSettingsStatus> };
const Context = createContext<SettingsContext>(null!);
export const useAiSettings = () => useContext(Context);
const labels = { none: '미등록', session: '이번 실행에서만 사용', stored: '이 PC에 저장됨', environment: '개발 환경변수 사용 중' };

export function AiSettingsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AiSettingsStatus>();
  const [dialog, setDialog] = useState<{ continuing: boolean }>();
  const resolve = useRef<((saved: boolean) => void) | null>(null);
  async function refresh() {
    const reply = await window.questWeaver.aiStatus();
    if (!reply.ok) throw new Error(reply.message);
    const next = reply.data as AiSettingsStatus;
    setStatus(next);
    return next;
  }
  useEffect(() => { void refresh().catch(() => {}); }, []);
  function open(continuing = false) {
    if (resolve.current) return Promise.resolve(false);
    setDialog({ continuing });
    return new Promise<boolean>((done) => { resolve.current = done; });
  }
  function close(saved: boolean) {
    setDialog(undefined);
    resolve.current?.(saved);
    resolve.current = null;
  }
  return <Context.Provider value={{ open, status, refresh }}>
    {children}
    {dialog && <SettingsDialog continuing={dialog.continuing} status={status} refresh={refresh}
      onStatus={setStatus} close={close} />}
  </Context.Provider>;
}

function SettingsDialog({ continuing, status, refresh, onStatus, close }: {
  continuing: boolean; status?: AiSettingsStatus;
  refresh: () => Promise<AiSettingsStatus>; onStatus: (value: AiSettingsStatus) => void; close: (saved: boolean) => void;
}) {
  const element = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [store, setStore] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    element.current?.showModal();
    void refresh().catch(() => setError('AI 설정을 확인하지 못했습니다. 설정 창을 다시 열어 주세요.'));
    return () => element.current?.close();
  }, []); // The dialog is a new input session every time it opens.
  function cancel() {
    if (busy.current) return;
    setKey('');
    close(false);
  }
  async function change(remove: boolean) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(''); setNotice('');
    // Do not retain the typed credential while IPC completes.
    const sending = key;
    setKey(''); setVisible(false);
    try {
      const reply = await (remove ? window.questWeaver.deleteAiKey() : window.questWeaver.saveAiKey(sending, store));
      if (!reply.ok) { setError(reply.message); return; }
      const next = reply.data as AiSettingsStatus;
      onStatus(next);
      if (remove) {
        setNotice('앱에 등록한 키를 삭제했습니다. 이미 진행 중인 생성 요청은 취소되지 않습니다.');
      } else if (continuing) {
        close(true);
      } else {
        setNotice('키 설정을 저장했습니다. 인증 확인은 초안 생성 시 이루어지며, 지금은 API를 호출하지 않았습니다.');
      }
    } catch {
      setError('키 설정을 전달하지 못했습니다. 다시 입력해 시도하세요.');
    } finally {
      busy.current = false; setPending(false);
    }
  }
  return <dialog ref={element} className="ai-settings-dialog" aria-labelledby="ai-settings-title" onCancel={(event) => {
    event.preventDefault(); cancel();
  }}>
    <div className="section-heading"><h2 id="ai-settings-title">AI 설정</h2>
      <button type="button" disabled={pending} onClick={cancel}>닫기</button></div>
    <dl className="metadata">
      <div><dt>제공자</dt><dd>OpenAI</dd></div>
      <div><dt>현재 사용 모델</dt><dd>{status ? status.model || '모델 미설정' : '확인 중'}</dd></div>
      <div><dt>키 상태</dt><dd role="status">{status ? labels[status.source] : '확인 중'}</dd></div>
    </dl>
    <p className="ai-settings-notice">AI 초안 생성에는 본인의 OpenAI API 키가 필요합니다.<br />
      생성 시 저장된 퀘스트 원문이 OpenAI로 전송되며,<br />
      API 사용료는 해당 API 계정에 청구됩니다.<br />
      ChatGPT 구독과 API 과금은 별개입니다.<br />
      키 없이도 퀘스트 작성·편집·검사·저장·PNG 내보내기를 사용할 수 있습니다.</p>
    <button type="button" className="text-button" onClick={() => {
      void window.questWeaver.openAiKeyPage().then((opened) => {
        if (!opened) setError('발급 페이지를 열지 못했습니다. 브라우저에서 platform.openai.com/api-keys를 여세요.');
      });
    }}>OpenAI API 키 발급 페이지 열기</button>
    {status?.source === 'environment' && <p className="hint">개발 환경변수 QUESTWEAVER_OPENAI_API_KEY를 사용 중입니다.
      앱에 등록한 키가 우선합니다. 환경변수 사용을 중지하려면 앱을 종료하고 PowerShell에서
      <code> Remove-Item Env:QUESTWEAVER_OPENAI_API_KEY </code>를 실행한 뒤 다시 시작하세요.
      사용자·시스템 환경변수에도 등록했다면 해당 항목을 제거하세요.</p>}
    {status?.warning && <p role="status" className="hint">{status.warning}</p>}
    <form onSubmit={(event) => { event.preventDefault(); void change(false); }}>
      <label htmlFor="openai-key">새 API 키 (등록·교체)</label>
      <div className="ai-key-input"><input id="openai-key" type={visible ? 'text' : 'password'} value={key}
        autoComplete="off" spellCheck={false} maxLength={2048} disabled={pending}
        onChange={(event) => setKey(event.target.value)} />
        <button type="button" disabled={pending} aria-pressed={visible} onClick={() => setVisible(!visible)}>
          {visible ? '숨기기' : '표시'}</button></div>
      <label className="ai-store-option"><input type="checkbox" checked={store} disabled={pending || !status?.secureStorageAvailable}
        onChange={(event) => setStore(event.target.checked)} /> 이 PC에 키 저장</label>
      {!status?.secureStorageAvailable && <p className="hint">안전한 PC 저장을 사용할 수 없습니다. 이번 실행에서만 사용할 수 있습니다.</p>}
      <p className="hint">체크하지 않으면 앱 종료 시 키가 사라집니다. 기존에 PC에 저장한 키도 삭제하므로 재실행 후 되살아나지 않습니다.
        키를 삭제해도 개발 환경변수가 있으면 해당 키가 사용됩니다.</p>
      <div className="actions"><button className="primary" disabled={pending || !key.trim()}>
        {pending ? '처리 중…' : continuing ? '저장하고 계속' : '저장'}</button>
        <button type="button" disabled={pending} onClick={() => void change(true)}>등록한 키 삭제</button>
        <button type="button" disabled={pending} onClick={cancel}>취소</button></div>
    </form>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </dialog>;
}
