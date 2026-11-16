import { useMemo, useRef, useState } from 'react';
import { Background, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './flow.css';
import { errorMessage, useResource } from './api';
import { renderFlowPng } from './flowPng';
import { asEdge, asNode, FlowControls, flowEdgeTypes, flowFitOptions, flowNodeTypes, withLanes } from './flowElements';
import { stepLabels } from './flowModel';
import type { FlowDocument } from './flowModel';

export function FlowPreview({ questId, gameName, title, onEdit, disabled }: {
  questId: string; gameName: string; title: string; onEdit: () => void; disabled: boolean;
}) {
  const flow = useResource<FlowDocument>(`/api/quests/${questId}/flow`);
  const empty = flow.data?.steps.length === 0;
  const pending = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exported, setExported] = useState(false);

  async function exportPng() {
    if (pending.current || !flow.data?.steps.length) return;
    pending.current = true;
    setExporting(true);
    setExported(false);
    setExportError('');
    try {
      const bytes = await renderFlowPng(flow.data, gameName, title);
      const result = await window.questWeaver.saveFlowPng(title, bytes);
      if (result.status === 'error') setExportError(result.message);
      if (result.status === 'saved') setExported(true);
    } catch (failure) {
      setExportError(errorMessage(failure));
    } finally {
      pending.current = false;
      setExporting(false);
    }
  }

  return (
    <section className="flow-preview" aria-labelledby="flow-preview-title">
      <div className="section-heading">
        <h3 id="flow-preview-title">퀘스트 플로우</h3>
        <div className="flow-heading-actions">
          {!empty && <button type="button" onClick={onEdit} disabled={disabled || exporting}>플로우 편집</button>}
          <button type="button" onClick={() => void exportPng()}
            disabled={disabled || exporting || !flow.data?.steps.length}>PNG 내보내기</button>
        </div>
      </div>
      {exporting && <p role="status">PNG 내보내는 중…</p>}
      {exported && <p className="success" role="status">PNG를 저장했습니다.</p>}
      {exportError && <p className="error" role="alert">{exportError}</p>}
      {flow.loading && <p role="status">플로우를 불러오고 있습니다.</p>}
      {flow.error && <p className="error" role="alert">
        플로우를 불러오지 못했습니다. {flow.error} <button type="button" onClick={flow.reload} disabled={disabled}>다시 불러오기</button>
      </p>}
      {empty && <div className="empty">
        <p>아직 작성된 플로우가 없습니다</p>
        <button type="button" onClick={onEdit} disabled={disabled}>플로우 작성</button>
      </div>}
      {flow.data && !empty && <PreviewChart flow={flow.data} />}
    </section>
  );
}

export function PreviewChart({ flow, id }: { flow: FlowDocument; id?: string }) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = flow.steps.find((step) => step.id === selectedId);
  const nodes = useMemo(() => flow.steps.map((step) => ({
    ...asNode(step),
    selected: step.id === selectedId,
    ariaLabel: step.title.trim() || '제목 없는 단계',
  })), [flow.steps, selectedId]);
  const edges = useMemo(() => withLanes(flow.links.map(asEdge)), [flow.links]);

  return (
    <>
      <div className="flow-canvas flow-preview-canvas" role="region" aria-label="퀘스트 플로우 미리보기"
        onKeyDown={(event) => {
          if ((event.key !== 'Enter' && event.key !== ' ') || !(event.target instanceof HTMLElement)) return;
          const id = event.target.closest<HTMLElement>('.react-flow__node')?.dataset.id;
          if (!id) return;
          event.preventDefault();
          setSelectedId(id);
        }}>
        <ReactFlow
          id={id}
          nodes={nodes}
          edges={edges}
          nodeTypes={flowNodeTypes}
          edgeTypes={flowEdgeTypes}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(undefined)}
          fitView
          fitViewOptions={flowFitOptions}
          minZoom={0.1}
          maxZoom={4}
          nodesDraggable={false}
          nodesConnectable={false}
          connectOnClick={false}
          edgesReconnectable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          zoomOnScroll={false}
          preventScrolling={false}
        >
          <Background gap={22} color="#cad4e5" />
          <FlowControls />
        </ReactFlow>
      </div>
      {selected && <div className="flow-preview-step" aria-live="polite">
        <strong>{selected.title.trim() || '제목 없는 단계'}</strong>
        <span className="hint"> · {stepLabels[selected.kind]}</span>
        <p>{selected.description.trim() ? selected.description : '입력한 설명이 없습니다.'}</p>
      </div>}
    </>
  );
}
