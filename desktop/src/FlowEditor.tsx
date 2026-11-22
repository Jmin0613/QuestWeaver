import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  applyNodeChanges, Background, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
} from '@xyflow/react';
import type { Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './flow.css';
import { errorMessage, questTitle, request, useResource } from './api';
import type { QuestDetail } from './api';
import { asEdge, asNode, FlowControls, flowEdgeTypes, flowFitOptions, flowNodeTypes, graphData, manualCurveBounds, sizeNode, updateNodeData, withLanes } from './flowElements';
import { AiFlowGenerator } from './AiFlowGenerator';
import type { LinkEdge, StepNode } from './flowElements';
import { directionLabels, stepLabels } from './flowModel';
import type { CurveOffsets, Direction, FlowDocument, StepKind } from './flowModel';
import { useCloseGuard, useNavigationGuard } from './useCloseGuard';
import type { NavigationGuard } from './useCloseGuard';
import { FlowHistory } from './flowHistory';

type Props = { quest: QuestDetail; onBack: () => void; navigationGuard: NavigationGuard };
type InspectionWarning = { code: string; stepId: string | null; reason: string };
const kinds = Object.keys(stepLabels) as StepKind[];

export function FlowEditor({ quest, onBack, navigationGuard }: Props) {
  const route = `/api/quests/${quest.summary.id}/flow`;
  const flow = useResource<FlowDocument>(route);
  if (flow.data) {
    return <ReactFlowProvider key={route}><FlowWorkspace quest={quest} onBack={onBack}
      navigationGuard={navigationGuard} initial={flow.data} route={route} /></ReactFlowProvider>;
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

function FlowWorkspace({ quest, onBack, navigationGuard, initial, route }: Props & { initial: FlowDocument; route: string }) {
  const canvas = useRef<HTMLDivElement>(null);
  const view = useReactFlow<StepNode, LinkEdge>();
  const [nodes, setNodes] = useNodesState(initial.steps.map(asNode));
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
  const updateCurve = useCallback((id: string, curve?: CurveOffsets) => {
    if (pending.current) return;
    setEdges((current) => current.map((edge) => edge.id === id
      ? { ...edge, data: { condition: '', ...edge.data, curve } } : edge));
  }, [setEdges]);
  const renderedEdges = useMemo(() => withLanes(edges, selectLink, saving ? undefined : updateCurve).map((edge) => ({
    ...edge, reconnectable: !saving && !!edge.selected,
  })), [edges, selectLink, saving, updateCurve]);
  const graph = useMemo(() => graphData(nodes, edges), [nodes, edges]);
  const signature = JSON.stringify(graph);
  const [history] = useState(() => new FlowHistory(graph));
  const historyGroup = useRef(0);
  const [, refreshHistory] = useState(0);
  useLayoutEffect(() => {
    if (history.record(graph, historyGroup.current)) refreshHistory((revision) => revision + 1);
  }, [graph, history]);

  function travelHistory(direction: 'undo' | 'redo') {
    if (pending.current) return;
    history.record(graph, historyGroup.current);
    historyGroup.current++;
    const restored = history[direction]();
    if (!restored) return;
    const selectedNodes = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    const selectedEdges = new Set(edges.filter((edge) => edge.selected).map((edge) => edge.id));
    setNodes(restored.steps.map((step) => ({ ...asNode(step), selected: selectedNodes.has(step.id) })));
    setEdges(restored.links.map((link) => ({ ...asEdge(link), selected: selectedEdges.has(link.id) })));
    setError('');
    refreshHistory((revision) => revision + 1);
  }

  function historyKeyDown(event: globalThis.KeyboardEvent) {
    const target = event.target;
    if (event.defaultPrevented || event.isComposing || document.querySelector('dialog[open]') || (target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable], dialog'))) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey && !event.altKey && (key === 'z' || key === 'y')) {
      event.preventDefault();
      event.stopPropagation();
      travelHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    } else if (!event.repeat) {
      historyGroup.current++;
    }
  }

  useEffect(() => {
    window.addEventListener('keydown', historyKeyDown, true);
    return () => window.removeEventListener('keydown', historyKeyDown, true);
  });
  const inspectionSignature = JSON.stringify({
    steps: graph.steps.map(({ id, kind, title, description }) => ({ id, kind, title, description })),
    links: graph.links.map(({ id, from, to, condition }) => ({ id, from, to, condition })),
  });
  const needsInspection = inspection !== undefined && inspection.signature !== inspectionSignature;
  const inspectionStatus = !inspection ? '검사 전'
    : needsInspection ? '재검사 필요'
    : inspection.warnings.length ? '경고 있음' : '경고 없음';
  const dirty = signature !== savedGraph;
  useCloseGuard(dirty || saving);
  const canLeave = useNavigationGuard(navigationGuard, pending,
    dirty ? '저장하지 않은 플로우 변경이 있습니다. 편집 화면을 나갈까요?' : undefined);

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

  function reconnect(edge: LinkEdge, connection: Connection) {
    if (pending.current) return;
    setEdges((current) => current.map((item) => item.id === edge.id ? { ...item, ...connection } : item));
  }

  function updateStep(update: Partial<StepNode['data']>) {
    if (!step || pending.current) return;
    setNodes((current) => current.map((node) => node.id === step.id ? updateNodeData(node, update) : node));
    if (update.direction && update.direction !== step.data.direction) {
      setEdges((current) => current.map((edge) => edge.data?.curve && (edge.source === step.id || edge.target === step.id)
        ? { ...edge, data: { ...edge.data, curve: undefined } } : edge));
    }
  }

  function updateCondition(condition: string) {
    if (!link || pending.current) return;
    setEdges((current) => current.map((edge) => edge.id === link.id
      ? { ...edge, data: { ...edge.data, condition }, ariaLabel: condition || '퀘스트 연결선' } : edge));
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
    if (canLeave()) onBack();
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
    <section className="panel flow-panel" aria-labelledby="flow-heading"
      onPointerDownCapture={() => { historyGroup.current++; }}
      onFocusCapture={(event) => {
        if (event.target.matches('input, textarea, [contenteditable]')) historyGroup.current++;
      }}
      onBlurCapture={(event) => {
        if (event.target.matches('input, textarea, [contenteditable]')) historyGroup.current++;
      }}>
      <div className="section-heading flow-heading">
        <div><h2 id="flow-heading">플로우 편집</h2><p className="hint">{questTitle(quest.summary.title)}</p></div>
        <div className="flow-heading-actions">
          <button type="button" disabled={saving || !history.canUndo}
            title="실행 취소 (Ctrl+Z)" onClick={() => travelHistory('undo')}>실행 취소</button>
          <button type="button" disabled={saving || !history.canRedo}
            title="다시 실행 (Ctrl+Y)" onClick={() => travelHistory('redo')}>다시 실행</button>
          <button type="button" disabled={saving} onClick={back}>상세로 돌아가기</button>
          <button type="button" className="primary" disabled={saving} onClick={() => void save()}>플로우 저장</button>
          <button type="button" disabled={checking} onClick={() => void inspect()}>검사</button>
        </div>
      </div>
      <div className="flow-toolbar" aria-label="단계 추가">
        {kinds.map((kind) => <button key={kind} type="button" disabled={saving} onClick={() => addStep(kind)}>
          {stepLabels[kind]} 단계 추가
        </button>)}
        <span className="flow-unsaved" style={{ visibility: dirty ? 'visible' : 'hidden' }}>저장하지 않은 변경</span>
      </div>
      <AiFlowGenerator route={route} ready={!saving} hasSource={!!quest.body?.trim()} onApply={applyDraft} />
      {saving && <p role="status">플로우를 저장하고 있습니다.</p>}
      {saved && <p className="success" style={{ visibility: dirty ? 'hidden' : 'visible' }} role="status">플로우를 저장했습니다.</p>}
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
            onNodesChange={(changes) => setNodes((current) => applyNodeChanges(changes, current).map(sizeNode))}
            onEdgesChange={onEdgesChange}
            onConnect={connect}
            onReconnect={reconnect}
            nodeTypes={flowNodeTypes}
            edgeTypes={flowEdgeTypes}
            defaultViewport={initial.viewport}
            minZoom={0.1}
            maxZoom={4}
            deleteKeyCode={null}
            nodesDraggable={!saving}
            nodesConnectable={!saving}
            edgesReconnectable={!saving}
            reconnectRadius={6}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
          >
            <Background gap={22} color="#cad4e5" />
            {nodes.length === 0 && <div className="flow-empty">아직 단계가 없습니다. 위 버튼으로 단계를 추가하세요.</div>}
            <FlowControls empty={!nodes.length} bounds={manualCurveBounds(nodes, renderedEdges)} />
          </ReactFlow>
        </div>
        <aside className="flow-sidebar">
          <section aria-labelledby="flow-properties-heading">
            <h3 id="flow-properties-heading">선택한 요소</h3>
            {!step && !link && <p className="hint">단계나 연결선을 선택하면 속성을 편집할 수 있습니다. 채워진 출력 점에서 도착 단계의 흰 입력 점으로 끌어 놓으세요.</p>}
            {step && <fieldset disabled={saving}>
              <label htmlFor="flow-step-kind">단계 종류</label>
              <select id="flow-step-kind" value={step.data.kind} onChange={(event) => updateStep({ kind: event.target.value as StepKind })}>
                {kinds.map((kind) => <option key={kind} value={kind}>{stepLabels[kind]}</option>)}
              </select>
              <label htmlFor="flow-step-direction">연결 방향</label>
              <select id="flow-step-direction" value={step.data.direction}
                onChange={(event) => updateStep({ direction: event.target.value as Direction })}>
                {Object.entries(directionLabels).map(([direction, label]) =>
                  <option key={direction} value={direction}>{label}</option>)}
              </select>
              <p className="hint">연결 방향을 바꾸면 이 단계에 붙은 수동 곡선이 초기화됩니다.</p>
              <label htmlFor="flow-step-title">단계 제목</label>
              <textarea id="flow-step-title" rows={3} maxLength={200} value={step.data.title} onChange={(event) => updateStep({ title: event.target.value })} />
              <label htmlFor="flow-step-description">단계 설명</label>
              <textarea id="flow-step-description" rows={5} value={step.data.description}
                onChange={(event) => updateStep({ description: event.target.value })} />
              <button type="button" className="danger" onClick={removeSelection}>단계 삭제</button>
            </fieldset>}
            {!step && link && <fieldset disabled={saving}>
              <p className="flow-endpoints">{titleFor(link.source)} → {titleFor(link.target)}</p>
              <p className="hint">선의 끝점을 끌면 연결할 단계를 바꿀 수 있습니다.</p>
              <label htmlFor="flow-link-condition">조건 또는 선택지</label>
              <textarea id="flow-link-condition" rows={3} value={link.data?.condition ?? ''}
                onChange={(event) => updateCondition(event.target.value)} />
              <button type="button" disabled={!link.data?.curve} onClick={() => updateCurve(link.id)}>곡선 초기화</button>
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
