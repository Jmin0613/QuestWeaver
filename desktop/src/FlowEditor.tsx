import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  Background, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
} from '@xyflow/react';
import type { Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './flow.css';
import { errorMessage, questTitle, request, useResource } from './api';
import type { QuestDetail } from './api';
import { asEdge, asNode, FlowControls, flowEdgeTypes, flowFitOptions, flowNodeTypes, graphData, withLanes } from './flowElements';
import { AiFlowGenerator } from './AiFlowGenerator';
import type { LinkEdge, StepNode } from './flowElements';
import { stepLabels } from './flowModel';
import type { FlowDocument, StepKind } from './flowModel';
import { useCloseGuard } from './useCloseGuard';

type Props = { quest: QuestDetail; onBack: () => void };
type InspectionWarning = { code: string; stepId: string | null; reason: string };
const kinds = Object.keys(stepLabels) as StepKind[];

export function FlowEditor({ quest, onBack }: Props) {
  const route = `/api/quests/${quest.summary.id}/flow`;
  const flow = useResource<FlowDocument>(route);
  if (flow.data) {
    return <ReactFlowProvider><FlowWorkspace quest={quest} onBack={onBack} initial={flow.data} route={route} /></ReactFlowProvider>;
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>플로우 편집</h2>
        <button onClick={onBack}>상세로 돌아가기</button>
      </div>
      {flow.loading && <p role="status">플로우를 불러오고 있습니다.</p>}
      {flow.error && <p className="error" role="alert">{flow.error} <button onClick={flow.reload}>다시 불러오기</button></p>}
    </section>
  );
}

function FlowWorkspace({ quest, onBack, initial, route }: Props & { initial: FlowDocument; route: string }) {
  const canvas = useRef<HTMLDivElement>(null);
  const view = useReactFlow<StepNode, LinkEdge>();
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.steps.map(asNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.links.map(asEdge));
  const [savedGraph, setSavedGraph] = useState(() => JSON.stringify(graphData(nodes, edges)));
  const [saving, setSaving] = useState(false);
  const [appliedDraft, setAppliedDraft] = useState<FlowDocument>();
  const pending = useRef(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [inspection, setInspection] = useState<{ signature: string; warnings: InspectionWarning[] }>();
  const [inspectionError, setInspectionError] = useState('');

  const selectLink = useCallback((id: string) => {
    setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node));
    setEdges((current) => current.map((edge) => (edge.selected ?? false) === (edge.id === id)
      ? edge : { ...edge, selected: edge.id === id }));
  }, [setNodes, setEdges]);
  const renderedEdges = useMemo(() => withLanes(edges, selectLink), [edges, selectLink]);
  const graph = useMemo(() => graphData(nodes, edges), [nodes, edges]);
  const signature = JSON.stringify(graph);
  const inspectionSignature = JSON.stringify({
    steps: graph.steps.map(({ id, kind, title, description }) => ({ id, kind, title, description })),
    links: graph.links,
  });
  const needsInspection = inspection !== undefined && inspection.signature !== inspectionSignature;
  const inspectionStatus = !inspection ? '검사 전'
    : needsInspection ? '재검사 필요'
    : inspection.warnings.length ? '경고 있음' : '경고 없음';
  const dirty = !!appliedDraft || signature !== savedGraph;
  useCloseGuard(dirty || saving);

  useEffect(() => {
    if (!appliedDraft) return;
    if (appliedDraft.steps.length) {
      void view.fitView(flowFitOptions);
    } else {
      void view.setViewport(appliedDraft.viewport);
    }
  }, [appliedDraft, view]);

  function applyDraft(flow: FlowDocument) {
    setNodes(flow.steps.map(asNode));
    setEdges(flow.links.map(asEdge));
    setAppliedDraft(flow);
    setSaved(false);
    setError('');
  }

  const step = nodes.find((node) => node.selected);
  const link = edges.find((edge) => edge.selected);

  function addStep(kind: StepKind) {
    if (pending.current || !canvas.current) return;
    const bounds = canvas.current.getBoundingClientRect();
    const zoom = view.getZoom();
    const columns = Math.max(1, Math.floor((bounds.width - 30) / (190 * zoom)));
    function slot(index: number) {
      return view.screenToFlowPosition({
        x: bounds.left + 28 + (index % columns) * 190 * zoom,
        y: bounds.top + 32 + Math.floor(index / columns) * 96 * zoom,
      });
    }
    let index = 0;
    let position = slot(index);
    while (nodes.some((node) => Math.abs(node.position.x - position.x) < 168
        && Math.abs(node.position.y - position.y) < 72)) {
      position = slot(++index);
    }
    const newNode = asNode({ id: crypto.randomUUID(), kind, title: stepLabels[kind], description: '', ...position });
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), { ...newNode, selected: true }]);
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
  }

  function connect({ source, target }: Connection) {
    if (pending.current) return;
    const edge = asEdge({ id: crypto.randomUUID(), from: source, to: target, condition: '' });
    // Parallel links have independent IDs and conditions.
    setEdges((current) => [...current, edge]);
    // A handle click also bubbles to its node. Select the new link after that event.
    queueMicrotask(() => selectLink(edge.id));
  }

  function updateStep(update: Partial<StepNode['data']>) {
    if (!step || pending.current) return;
    setNodes((current) => current.map((node) => node.id === step.id
      ? { ...node, data: { ...node.data, ...update } } : node));
  }

  function updateCondition(condition: string) {
    if (!link || pending.current) return;
    setEdges((current) => current.map((edge) => edge.id === link.id
      ? { ...edge, data: { condition }, ariaLabel: condition || '퀘스트 연결선' } : edge));
  }

  function removeSelection() {
    if (pending.current || (!step && !link)) return;
    const removed = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    setNodes((current) => current.filter((node) => !removed.has(node.id)));
    setEdges((current) => current.filter((edge) => !edge.selected && !removed.has(edge.source) && !removed.has(edge.target)));
  }

  function canvasKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.key !== 'Delete' && event.key !== 'Backspace') || event.nativeEvent.isComposing
        || !(event.target instanceof Element) || event.target.closest('input, textarea, select, button, [contenteditable]')) return;
    if (!step && !link) return;
    event.preventDefault();
    removeSelection();
  }

  async function save() {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      await request<FlowDocument>('PUT', route, { ...graph, viewport: view.getViewport() });
      setSavedGraph(signature);
      setAppliedDraft(undefined);
      setSaved(true);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  function back() {
    if (pending.current) return;
    if (!dirty || window.confirm('저장하지 않은 플로우 변경이 있습니다. 상세로 돌아갈까요?')) onBack();
  }

  async function inspect() {
    if (checking) return;
    setChecking(true);
    setInspectionError('');
    try {
      const warnings = await request<InspectionWarning[]>('POST', '/api/flow/inspect', {
        ...graph, viewport: initial.viewport,
      });
      setInspection({ signature: inspectionSignature, warnings });
    } catch (failure) {
      setInspectionError(errorMessage(failure));
    } finally {
      setChecking(false);
    }
  }

  function focusStep(id: string) {
    const target = nodes.find((node) => node.id === id);
    if (!target) return;
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === id })));
    setEdges((current) => current.map((edge) => edge.selected ? { ...edge, selected: false } : edge));
    canvas.current?.scrollIntoView({ block: 'nearest' });
    void view.setCenter(
      target.position.x + (target.measured?.width ?? target.initialWidth ?? 0) / 2,
      target.position.y + (target.measured?.height ?? target.initialHeight ?? 0) / 2,
      { zoom: Math.max(view.getZoom(), 0.85), duration: 240 },
    );
  }

  const titleFor = (id: string) => nodes.find((node) => node.id === id)?.data.title.trim() || '제목 없는 단계';

  return (
    <section className="panel flow-panel" aria-labelledby="flow-heading">
      <div className="section-heading flow-heading">
        <div><h2 id="flow-heading">플로우 편집</h2><p className="hint">{questTitle(quest.summary.title)}</p></div>
        <div className="flow-heading-actions">
          <button type="button" disabled={saving} onClick={back}>상세로 돌아가기</button>
          <button type="button" className="primary" disabled={saving} onClick={() => void save()}>플로우 저장</button>
          <button type="button" disabled={checking} onClick={() => void inspect()}>검사</button>
        </div>
      </div>
      <div className="flow-toolbar" aria-label="단계 추가">
        {kinds.map((kind) => <button key={kind} type="button" disabled={saving} onClick={() => addStep(kind)}>
          {stepLabels[kind]} 단계 추가
        </button>)}
        {dirty && <span className="flow-unsaved">저장하지 않은 변경</span>}
      </div>
      <AiFlowGenerator route={route} ready={!saving} hasSource={!!quest.body?.trim()} onApply={applyDraft} />
      {saving && <p role="status">플로우를 저장하고 있습니다.</p>}
      {saved && !dirty && <p className="success" role="status">플로우를 저장했습니다.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <section className="flow-inspection" aria-label="플로우 검사 결과">
        <p role="status"><strong>{inspectionStatus}</strong>{checking && ' · 플로우 검사 중…'}</p>
        {inspectionError && <p className="error" role="alert">검사 요청에 실패했습니다. {inspectionError}</p>}
        {inspection && !needsInspection && inspection.warnings.length > 0 && <ul>
          {inspection.warnings.map(({ code, stepId, reason }) => <li key={`${code}:${stepId}`}>
            {stepId ? <button type="button" className="inspection-warning" onClick={() => focusStep(stepId)}>
              <strong>{titleFor(stepId)}</strong> · {reason}
            </button> : reason}
          </li>)}
        </ul>}
        <p className="hint">단계와 연결 구조를 검사합니다. 조건 충족 여부와 게임 내 실행은 별도로 확인하세요.</p>
      </section>
      <div className="flow-layout">
        <div ref={canvas} className="flow-canvas" onKeyDown={canvasKeyDown} role="region" aria-label="퀘스트 차트">
          <ReactFlow
            nodes={nodes}
            edges={renderedEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={connect}
            nodeTypes={flowNodeTypes}
            edgeTypes={flowEdgeTypes}
            defaultViewport={initial.viewport}
            minZoom={0.1}
            maxZoom={4}
            deleteKeyCode={null}
            nodesDraggable={!saving}
            nodesConnectable={!saving}
            edgesReconnectable={false}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
          >
            <Background gap={22} color="#cad4e5" />
            {nodes.length === 0 && <div className="flow-empty">아직 단계가 없습니다. 위 버튼으로 단계를 추가하세요.</div>}
            <FlowControls empty={!nodes.length} />
          </ReactFlow>
        </div>
        <aside className="flow-sidebar">
          <section aria-labelledby="flow-properties-heading">
            <h3 id="flow-properties-heading">선택한 요소</h3>
            {!step && !link && <p className="hint">단계나 연결선을 선택하면 속성을 편집할 수 있습니다. 연결하려면 오른쪽 점에서 다음 단계의 왼쪽 점으로 끌어 놓으세요.</p>}
            {step && <fieldset disabled={saving}>
              <label htmlFor="flow-step-kind">단계 종류</label>
              <select id="flow-step-kind" value={step.data.kind} onChange={(event) => updateStep({ kind: event.target.value as StepKind })}>
                {kinds.map((kind) => <option key={kind} value={kind}>{stepLabels[kind]}</option>)}
              </select>
              <label htmlFor="flow-step-title">단계 제목</label>
              <input id="flow-step-title" maxLength={200} value={step.data.title} onChange={(event) => updateStep({ title: event.target.value })} />
              <label htmlFor="flow-step-description">단계 설명</label>
              <textarea id="flow-step-description" rows={5} value={step.data.description}
                onChange={(event) => updateStep({ description: event.target.value })} />
              <button type="button" className="danger" onClick={removeSelection}>단계 삭제</button>
            </fieldset>}
            {!step && link && <fieldset disabled={saving}>
              <p className="flow-endpoints">{titleFor(link.source)} → {titleFor(link.target)}</p>
              <label htmlFor="flow-link-condition">조건 또는 선택지</label>
              <textarea id="flow-link-condition" rows={3} value={link.data?.condition ?? ''}
                onChange={(event) => updateCondition(event.target.value)} />
              <button type="button" className="danger" onClick={removeSelection}>연결선 삭제</button>
            </fieldset>}
          </section>
          <details className="flow-reference">
            <summary>퀘스트 원문</summary>
            <div>{quest.body?.trim() ? quest.body : '입력한 원문이 없습니다.'}</div>
          </details>
        </aside>
      </div>
    </section>
  );
}
