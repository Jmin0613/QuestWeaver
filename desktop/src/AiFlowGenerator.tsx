import { useAiSettings } from './AiSettings';
import { useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { errorMessage, request } from './api';
import { PreviewChart } from './FlowPreview';
import type { FlowDocument } from './flowModel';

type Draft = { flow: FlowDocument; needsReview: string[] };

export function AiFlowGenerator({ route, ready, hasSource, onApply }: {
  route: string;
  ready: boolean;
  hasSource: boolean;
  onApply: (flow: FlowDocument) => void;
}) {
  const settings = useAiSettings();
  const pending = useRef<AbortController | null>(null);
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState('');

  useEffect(() => () => pending.current?.abort(), [route]);

  async function generate() {
    if (pending.current || !ready || !hasSource) return;
    const job = new AbortController();
    pending.current = job;
    setGenerating(true);
    setError('');
    try {
      let status = await settings.refresh();
      if (!status.configured) {
        if (!await settings.open(true)) return;
        status = await settings.refresh();
      }
      if (job.signal.aborted) return;
      if (!window.confirm((status.warning ? status.warning + '\n\n' : '')
        + '저장된 퀘스트 원문을 외부 AI 서비스(OpenAI)로 전송합니다. API 사용 요금이 발생할 수 있습니다. 초안을 생성할까요?')) return;
      const result = await request<Draft>('POST', `${route}/generate`, {});
      if (!job.signal.aborted) setDraft(result);
    } catch (failure) {
      if (!job.signal.aborted) setError(errorMessage(failure));
    } finally {
      pending.current = null;
      if (!job.signal.aborted) setGenerating(false);
    }
  }

  return (
    <div className="ai-flow">
      <button type="button" disabled={generating || !ready || !hasSource}
        onClick={() => void generate()}>AI로 플로우 생성</button>
      {!hasSource && <p className="hint">저장된 퀘스트 원문을 먼저 작성하세요.</p>}
      {settings.status?.configured === false && <p className="hint">생성 버튼을 누르면 API 키를 등록할 수 있습니다.</p>}
      {generating && <p role="status">AI 생성 준비 또는 응답을 기다리고 있습니다…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {draft && <DraftDialog draft={draft} canApply={ready} onCancel={() => setDraft(undefined)} onApply={() => {
        onApply(draft.flow);
        setDraft(undefined);
      }} />}
    </div>
  );
}

function DraftDialog({ draft, canApply, onCancel, onApply }: {
  draft: Draft;
  canApply: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    setVisible(true);
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} className="ai-flow-dialog" aria-labelledby="ai-draft-title" onCancel={(event) => {
      event.preventDefault();
      onCancel();
    }}>
      <div className="section-heading">
        <h3 id="ai-draft-title">AI 플로우 초안</h3>
        <div className="flow-heading-actions">
          <button type="button" autoFocus onClick={onCancel}>취소</button>
          <button type="button" className="primary" disabled={!canApply} onClick={onApply}>적용</button>
        </div>
      </div>
      <p>적용하면 현재 편집 중인 차트가 교체됩니다. DB에 반영하려면 저장을 누르세요.</p>
      {visible && (draft.flow.steps.length
        ? <ReactFlowProvider><PreviewChart id="ai-draft-preview" flow={draft.flow} /></ReactFlowProvider>
        : <p>추출된 단계가 없습니다.</p>)}
      {draft.needsReview.length > 0 && <>
        <h4>확인 필요</h4>
        <ul>{draft.needsReview.map((note, index) => <li key={index}>{note}</li>)}</ul>
      </>}
    </dialog>
  );
}
