import { autoLayout } from './flowLayout';
import { stepLayout } from './stepLayout';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  applyNodeChanges, Background, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
} from '@xyflow/react';
import type { Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './flow.css';
import { errorMessage, questTitle, request, stateLabels, useResource } from './api';
import type { QuestDetail } from './api';
import { asEdge, asNode, FlowControls, flowEdgeTypes, flowNodeTypes, graphData, flowBounds, sizeNode, updateNodeData, withLanes } from './flowElements';
import { AiFlowGenerator } from './AiFlowGenerator';
import type { LinkEdge, StepNode } from './flowElements';
import { directionLabels, linkKindLabels, stepLabels } from './flowModel';
import type { CurveOffsets, Direction, FlowDocument, LinkKind, OrthogonalRoute, StepKind } from './flowModel';
import { useCloseGuard, useNavigationGuard } from './useCloseGuard';
import type { NavigationGuard } from './useCloseGuard';
import { FlowHistory } from './flowHistory';
import { planningPatch, questPlanning } from './planning';
import { QuestPlanningFields, StepPlanningFields } from './PlanningFields';

type Props = { quest: QuestDetail; onBack: () => void; onEdit: (quest: QuestDetail) => void; navigationGuard: NavigationGuard };
type Workspace = { quest: QuestDetail; flow: FlowDocument };
type InspectionWarning = { code: string; stepId: string | null; reason: string };
const kinds = Object.keys(stepLabels) as StepKind[];

export function FlowEditor({ quest, onBack, onEdit, navigationGuard }: Props) {
  const route = `/api/quests/${quest.summary.id}/workspace`;
  const flow = useResource<Workspace>(route);
  if (flow.data) {
    return <ReactFlowProvider key={route}><FlowWorkspace quest={flow.data.quest} onBack={onBack} onEdit={onEdit}
      navigationGuard={navigationGuard} initial={flow.data.flow} route={route} /></ReactFlowProvider>;
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

function FlowWorkspace({ quest, onBack, onEdit, navigationGuard, initial, route }: Props & { initial: FlowDocument; route: string }) {
  const canvas = useRef<HTMLDivElement>(null);
  const layoutMenu = useRef<HTMLDetailsElement>(null);
  const view = useReactFlow<StepNode, LinkEdge>();
  const [nodes, setNodes] = useNodesState(initial.steps.map(asNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.links.map(asEdge));
  const [questInfo, setQuestInfo] = useState(quest);
  const [planning, setPlanning] = useState(() => questPlanning(quest.planning));
  const [savedPlanning, setSavedPlanning] = useState(planning);
  const [tab, setTab] = useState<'quest' | 'element'>('quest');
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [savedGraph, setSavedGraph] = useState(() => JSON.stringify({ ...graphData(nodes, edges), planning }));
  const [saving, setSaving] = useState(false);
  const [appliedDraft, setAppliedDraft] = useState<FlowDocument>();
  const pending = useRef(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [inspection, setInspection] = useState<{ signature: string; warnings: InspectionWarning[] }>();
  const [inspectionError, setInspectionError] = useState('');

  const selectLink = useCallback((id: string) => {
    setTab('element');
    setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node));
    setEdges((current) => current.map((edge) => (edge.selected ?? false) === (edge.id === id)
      ? edge : { ...edge, selected: edge.id === id }));
  }, [setNodes, setEdges]);
  const updateCurve = useCallback((id: string, curve?: CurveOffsets) => {
    if (pending.current) return;
    setEdges((current) => current.map((edge) => edge.id === id
      ? { ...edge, data: { condition: '', ...edge.data, curve } } : edge));
  }, [setEdges]);
  const updateRoute = useCallback((id: string, route?: OrthogonalRoute) => {
    if (pending.current) return;
    setEdges((current) => current.map((edge) => edge.id === id
      ? { ...edge, data: { condition: '', ...edge.data, route } } : edge));
  }, [setEdges]);
  const renderedEdges = useMemo(() => withLanes(edges, selectLink, saving ? undefined : updateCurve,
    saving ? undefined : updateRoute).map((edge) => ({
    ...edge, zIndex: edge.selected ? 1 : 0, reconnectable: !saving && !!edge.selected,
  })), [edges, selectLink, saving, updateCurve, updateRoute]);
  const graph = useMemo(() => ({ ...graphData(nodes, edges), planning }), [nodes, edges, planning]);
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
    setPlanning(questPlanning(restored.planning));
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
    dirty ? '저장하지 않은 기획 정보와 플로우 변경이 있습니다. 편집 화면을 나갈까요?' : undefined);

  useEffect(() => {
    if (!appliedDraft) return;
    if (appliedDraft.steps.length) {
      const bounds = flowBounds(appliedDraft.steps.map(asNode), withLanes(appliedDraft.links.map(asEdge)));
      if (bounds) void view.fitBounds(bounds, { padding: 0.2 });
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

  function arrange(direction: Direction) {
    if (pending.current || !nodes.length) return;
    if (!window.confirm('차트 전체의 위치와 연결 방향을 변경하고 기존 수동 연결 경로를 초기화합니다. 실행 취소로 복원할 수 있습니다. 자동 배치할까요?')) return;
    if (layoutMenu.current) layoutMenu.current.open = false;
    history.record(graph, historyGroup.current);
    historyGroup.current++;
    applyDraft(autoLayout({ steps: graph.steps, links: graph.links, viewport: view.getViewport() }, direction, stepLayout));
  }

  const step = nodes.find((node) => node.selected);
  const link = edges.find((edge) => edge.selected);

  function addStep(kind: StepKind) {
    if (pending.current || !canvas.current) return;
    setTab('element');
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
    const edge = asEdge({ id: crypto.randomUUID(), from: source, to: target, condition: '', kind: 'ORTHOGONAL' });
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
      setEdges((current) => current.map((edge) => (edge.source === step.id || edge.target === step.id)
        ? { ...edge, data: { condition: '', ...edge.data, curve: undefined, route: undefined } } : edge));
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
      const result = await request<Workspace>('PUT', route, {
        flow: { steps: graph.steps, links: graph.links, viewport: view.getViewport() },
        planning: planningPatch(planning, savedPlanning),
      });
      const saved = questPlanning(result.quest.planning);
      const snapshot = { ...graph, planning: saved };
      history.synchronize(snapshot);
      setPlanning(saved);
      setSavedPlanning(saved);
      setQuestInfo(result.quest);
      setSavedGraph(JSON.stringify(snapshot));
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

  async function editQuest() {
    if (!canLeave()) return;
    try {
      onEdit(await request<QuestDetail>('GET', `/api/quests/${quest.summary.id}`));
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  async function inspect() {
    if (checking) return;
    setChecking(true);
    setInspectionError('');
    try {
      const warnings = await request<InspectionWarning[]>('POST', '/api/flow/inspect', {
        steps: graph.steps, links: graph.links, viewport: initial.viewport,
      });
      setInspection({ signature: inspectionSignature, warnings });
      setInspectionOpen(true);
    } catch (failure) {
      setInspectionError(errorMessage(failure));
    } finally {
      setChecking(false);
    }
  }

  function focusStep(id: string) {
    const target = nodes.find((node) => node.id === id);
    if (!target) return;
    setTab('element');
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
        <div><h2 id="flow-heading">{questTitle(questInfo.summary.title)}</h2><p className="hint">퀘스트 플로우 편집</p></div>
        <div className="flow-heading-actions">
          <button type="button" disabled={saving || !history.canUndo}
            title="실행 취소 (Ctrl+Z)" onClick={() => travelHistory('undo')}>실행 취소</button>
          <button type="button" disabled={saving || !history.canRedo}
            title="다시 실행 (Ctrl+Y)" onClick={() => travelHistory('redo')}>다시 실행</button>
          <button type="button" disabled={saving} onClick={back}>상세로 돌아가기</button>
          <button type="button" className="primary" disabled={saving} onClick={() => void save()}>저장</button>
          <button type="button" disabled={checking} onClick={() => void inspect()}>검사</button>
          <details ref={layoutMenu} className="flow-layout-menu"><summary>자동 배치</summary>
            <div className="auto-layout-options">
              <p className="hint">차트 전체 위치와 연결 방향을 바꿉니다. 단계 하나의 연결 방향 설정과 별개입니다. 수동 연결 경로는 초기화됩니다.</p>
              <button type="button" disabled={saving || !nodes.length} onClick={() => arrange('HORIZONTAL')}>가로: 왼쪽→오른쪽</button>
              <button type="button" disabled={saving || !nodes.length} onClick={() => arrange('VERTICAL')}>세로: 위→아래</button>
            </div>
          </details>
          <details className="flow-ai-tools"><summary>AI 초안</summary>
            <AiFlowGenerator route={route.replace('/workspace', '/flow')} ready={!saving}
              hasSource={!!questInfo.body?.trim()} onApply={applyDraft} />
          </details>
        </div>
      </div>
      <div className="flow-toolbar" aria-label="단계 추가">
        {kinds.map((kind) => <button key={kind} type="button" disabled={saving} onClick={() => addStep(kind)}>
          {stepLabels[kind]} 단계 추가
        </button>)}
        <button type="button" disabled={saving || !edges.some((edge) => edge.data?.kind !== 'ORTHOGONAL')}
          onClick={() => setEdges((current) => current.map((edge) => ({
            ...edge, data: { condition: '', ...edge.data, kind: 'ORTHOGONAL' },
          })))}>모든 연결선 직선·꺾은선으로</button>
        <span className="flow-unsaved" style={{ visibility: dirty ? 'visible' : 'hidden' }}>저장하지 않은 변경</span>
      </div>
      {saving && <p role="status">기획 정보와 플로우를 저장하고 있습니다.</p>}
      {saved && <p className="success" style={{ visibility: dirty ? 'hidden' : 'visible' }} role="status">기획 정보와 플로우를 저장했습니다.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <details className="flow-inspection" aria-label="플로우 검사 결과" open={inspectionOpen}
        onToggle={(event) => setInspectionOpen(event.currentTarget.open)}>
        <summary>구조 검사 · <strong>{inspectionStatus}</strong>{checking && ' · 검사 중…'}</summary>
        {inspectionError && <p className="error" role="alert">검사 요청에 실패했습니다. {inspectionError}</p>}
        {inspection && !needsInspection && inspection.warnings.length > 0 && <ul>
          {inspection.warnings.map(({ code, stepId, reason }) => <li key={`${code}:${stepId}`}>
            {stepId ? <button type="button" className="inspection-warning" onClick={() => focusStep(stepId)}>
              <strong>{titleFor(stepId)}</strong> · {reason}
            </button> : reason}
          </li>)}
        </ul>}
        <p className="hint">그래프의 연결 구조를 검사합니다. 자유 입력한 조건·변수의 의미와 게임 내 실행은 검사 범위에 포함되지 않습니다.</p>
      </details>
      <div className="flow-layout">
        <div ref={canvas} className="flow-canvas" onKeyDown={canvasKeyDown} role="region" aria-label="퀘스트 차트">
          <ReactFlow
            nodes={nodes}
            edges={renderedEdges}
            onNodesChange={(changes) => setNodes((current) => applyNodeChanges(changes, current).map(sizeNode))}
            onEdgesChange={onEdgesChange}
            onConnect={connect}
            onReconnect={reconnect}
            onNodeClick={() => setTab('element')}
            onNodeDragStart={() => setTab('element')}
            onEdgeClick={() => setTab('element')}
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
            <FlowControls empty={!nodes.length} bounds={flowBounds(nodes, renderedEdges)} />
          </ReactFlow>
        </div>
        <aside className="flow-sidebar">
          <div className="flow-tabs" role="tablist" aria-label="기획 속성">
            {(['quest', 'element'] as const).map((item) => <button key={item} type="button" role="tab"
              id={item + '-tab'} aria-controls={item + '-properties'} aria-selected={tab === item}
              tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 'quest' : event.key === 'End' ? 'element'
                  : item === 'quest' ? 'element' : 'quest';
                setTab(next);
                document.getElementById(next + '-tab')?.focus();
              }}>{item === 'quest' ? '퀘스트 정보' : '선택 요소'}</button>)}
          </div>
          <section id="quest-properties" role="tabpanel" aria-labelledby="quest-tab" hidden={tab !== 'quest'}>
            <h3>퀘스트 정보</h3>
            <dl className="planning-details">
              <div><dt>퀘스트명</dt><dd>{questTitle(questInfo.summary.title)}</dd></div>
              <div><dt>게임</dt><dd>{questInfo.summary.gameName ?? '미선택'}</dd></div>
              <div><dt>지역</dt><dd>{questInfo.summary.regionName ?? '미선택'}</dd></div>
              <div><dt>작성 상태</dt><dd>{stateLabels[questInfo.summary.writingState]}</dd></div>
            </dl>
            <button type="button" disabled={saving} onClick={() => void editQuest()}>퀘스트 기본 정보 수정</button>
            <details className="flow-reference">
              <summary>퀘스트 원문</summary>
              <div>{questInfo.body?.trim() ? questInfo.body : '입력한 원문이 없습니다.'}</div>
            </details>
            <fieldset disabled={saving}>
              <details className="planning-group" open>
                <summary>퀘스트 기획 정보 <span className="optional">선택</span></summary>
                <QuestPlanningFields value={planning} onChange={setPlanning} />
              </details>
            </fieldset>
          </section>
          <section id="element-properties" role="tabpanel" aria-labelledby="element-tab" hidden={tab !== 'element'}>
            <h3 id="flow-properties-heading">선택한 요소</h3>
            {!step && !link && <p className="hint">단계나 연결선을 선택하면 속성을 편집할 수 있습니다. 채워진 출력 점에서 도착 단계의 흰 입력 점으로 끌어 놓으세요.</p>}
            {step && <fieldset disabled={saving}>
              <details className="planning-group" open>
                <summary>기본 정보</summary>
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
                <p className="hint">연결 방향을 바꾸면 이 단계에 붙은 수동 곡선과 직각 경로가 초기화됩니다.</p>
                <label htmlFor="flow-step-title">단계 제목</label>
                <textarea id="flow-step-title" rows={3} maxLength={200} value={step.data.title} onChange={(event) => updateStep({ title: event.target.value })} />
                <label htmlFor="flow-step-description">단계 설명</label>
                <textarea id="flow-step-description" rows={5} value={step.data.description}
                  onChange={(event) => updateStep({ description: event.target.value })} />
                <StepPlanningFields group="basic" value={step.data.planning}
                  onChange={(planning) => updateStep({ planning })} />
              </details>
              <details className="planning-group" open><summary>조건과 결과</summary>
                <p className="hint">이 단계의 시작·완료 기준입니다. 다음 단계로 갈 분기 조건은 연결선에서 작성하세요.</p>
                <StepPlanningFields group="conditions" value={step.data.planning}
                  onChange={(planning) => updateStep({ planning })} />
              </details>
              <details className="planning-group" open><summary>메모</summary>
                <StepPlanningFields group="notes" value={step.data.planning}
                  onChange={(planning) => updateStep({ planning })} />
              </details>
              <button type="button" className="danger" onClick={removeSelection}>단계 삭제</button>
            </fieldset>}
            {!step && link && <fieldset disabled={saving}>
              <p className="flow-endpoints">{titleFor(link.source)} → {titleFor(link.target)}</p>
              <p className="hint">선의 끝점을 끌면 연결할 단계를 바꿀 수 있습니다.</p>
              <label htmlFor="flow-link-kind">연결선 종류</label>
              <select id="flow-link-kind" value={link.data?.kind ?? 'CURVE'} onChange={(event) => {
                const kind = event.target.value as LinkKind;
                setEdges((current) => current.map((edge) => edge.id === link.id
                  ? { ...edge, data: { condition: '', ...edge.data, kind } } : edge));
              }}>
                {Object.entries(linkKindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
              </select>
              {link.data?.kind === 'ORTHOGONAL' && <p className="hint">노란 점을 끌면 꺾은선을 조절합니다. 수평 구간은 위아래로, 수직 구간은 좌우로 움직입니다.</p>}
              <label htmlFor="flow-link-condition">조건 또는 선택지</label>
              <p className="hint">이 연결을 따라 다음 단계로 이동하는 분기 조건입니다. 단계 자체의 시작·완료 조건과 구분해 작성하세요.</p>
              <textarea id="flow-link-condition" rows={3} value={link.data?.condition ?? ''}
                onChange={(event) => updateCondition(event.target.value)} />
              {link.data?.kind === 'ORTHOGONAL'
                ? <button type="button" disabled={!link.data.route} onClick={() => updateRoute(link.id)}>경로 초기화</button>
                : <button type="button" disabled={!link.data?.curve} onClick={() => updateCurve(link.id)}>곡선 초기화</button>}
              <button type="button" className="danger" onClick={removeSelection}>연결선 삭제</button>
            </fieldset>}
          </section>
        </aside>
      </div>
    </section>
  );
}
