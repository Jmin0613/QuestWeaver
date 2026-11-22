import { useLayoutEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, MarkerType, NodeResizeControl, Panel, useInternalNode, useReactFlow, useUpdateNodeInternals } from '@xyflow/react';
import type { Position } from '@xyflow/react';
import type { Edge, EdgeProps, Node, NodeProps, Rect, XYPosition } from '@xyflow/react';
import { stepLabels } from './flowModel';
import type { CurveOffsets, Direction, FlowDocument, Link, OrthogonalRoute, Step } from './flowModel';
import { handleSize, linkGeometry, midpointControlWeight, normals, portAnchor } from './flowGeometry';
import { minStepWidth, stepLayout } from './stepLayout';

type StepData = Pick<Step, 'kind' | 'title' | 'description'> & { direction: Direction };
export type StepNode = Node<StepData, 'questStep'>;
type CurveChange = (id: string, curve: CurveOffsets) => void;
type RouteChange = (id: string, route: OrthogonalRoute) => void;
export type LinkEdge = Edge<Pick<Link, 'condition' | 'kind' | 'curve' | 'route'> & {
  lane?: number;
  select?: (id: string) => void;
  changeCurve?: CurveChange;
  changeRoute?: RouteChange;
}, 'questLink'>;
function ports(direction: Direction, width: number, height: number) {
  return (['source', 'target'] as const).map((type) => {
    const anchor = portAnchor({ x: 0, y: 0, width, height }, direction, type);
    return { id: type, type, position: anchor.side as Position, anchor };
  });
}

function nodeHandles(direction: Direction, width: number, height: number) {
  return ports(direction, width, height).map(({ id, type, position, anchor }) => ({
    id, type, position, x: anchor.x - handleSize / 2, y: anchor.y - handleSize / 2,
    width: handleSize, height: handleSize,
  }));
}

export function asNode({ id, x, y, kind, title, description, direction = 'HORIZONTAL', ...size }: Step): StepNode {
  const { width, height } = stepLayout({ title, ...size });
  return {
    id,
    type: 'questStep',
    position: { x, y },
    data: { kind, title, description, direction },
    initialWidth: width,
    initialHeight: height,
    style: { width, height },
    width, height,
    handles: nodeHandles(direction, width, height),
  };
}

export function updateNodeData(node: StepNode, update: Partial<StepData>): StepNode {
  const data = { ...node.data, ...update };
  return sizeNode({ ...node, data });
}

export function sizeNode(node: StepNode): StepNode {
  const { width, height } = stepLayout({ title: node.data.title, width: node.width, height: node.height });
  return { ...node, width, height, measured: { width, height }, style: { ...node.style, width, height },
    handles: nodeHandles(node.data.direction, width, height) };
}

export function asEdge({ id, from, to, condition, curve, kind, route }: Link): LinkEdge {
  return {
    id,
    type: 'questLink',
    source: from,
    target: to,
    sourceHandle: 'source',
    targetHandle: 'target',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#53658c' },
    interactionWidth: 20,
    data: { condition, curve, kind, route },
    ariaLabel: condition || '퀘스트 연결선',
  };
}

export function graphData(nodes: StepNode[], edges: LinkEdge[]): Pick<FlowDocument, 'steps' | 'links'> {
  return {
    steps: nodes.map(({ id, position, data, width, height }) => ({ id, ...data, width, height, x: position.x, y: position.y })),
    links: edges.map(({ id, source, target, data }) => ({
      id, from: source, to: target, condition: data?.condition ?? '', curve: data?.curve,
      kind: data?.kind, route: data?.route,
    })),
  };
}

export function withLanes(edges: LinkEdge[], select?: (id: string) => void, changeCurve?: CurveChange, changeRoute?: RouteChange): LinkEdge[] {
  const counts = new Map<string, number>();
  const keyFor = (edge: LinkEdge) => `${edge.source}:${edge.sourceHandle}:${edge.target}:${edge.targetHandle}`;
  for (const edge of edges) {
    const key = keyFor(edge);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const nextLane = new Map<string, number>();
  return edges.map((edge) => {
    const key = keyFor(edge);
    const lane = nextLane.get(key) ?? -((counts.get(key) ?? 1) - 1) / 2;
    nextLane.set(key, lane + 1);
    return { ...edge, data: { condition: '', ...edge.data, lane, select, changeCurve, changeRoute } };
  });
}

export const flowFitOptions = { padding: 0.24, maxZoom: 1.3, includeHiddenNodes: true };

export function flowBounds(nodes: StepNode[], edges: LinkEdge[]): Rect | undefined {
  if (!nodes.length) return;
  const cards = new Map(nodes.map(({ id, position, data, width, height }) =>
    [id, { ...position, ...stepLayout({ title: data.title, width, height }), direction: data.direction }]));
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  function include(x: number, y: number) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  for (const card of cards.values()) {
    include(card.x, card.y);
    include(card.x + card.width, card.y + card.height);
  }
  for (const edge of edges) {
    const from = cards.get(edge.source), to = cards.get(edge.target);
    if (!from || !to) continue;
    const curve = linkGeometry(portAnchor(from, from.direction, 'source'), portAnchor(to, to.direction, 'target'),
      edge.data ?? {}, from, to);
    for (const point of curve.points) include(point.x, point.y);
    if (edge.data?.condition.trim()) {
      include(curve.midpoint.x - 70, curve.midpoint.y - 48);
      include(curve.midpoint.x + 70, curve.midpoint.y);
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function FlowControls({ empty = false, bounds }: { empty?: boolean; bounds?: Rect }) {
  const view = useReactFlow<StepNode, LinkEdge>();
  return (
    <Panel position="bottom-left" className="flow-controls">
      <button type="button" title="확대" aria-label="확대" onClick={() => void view.zoomIn()}>+</button>
      <button type="button" title="축소" aria-label="축소" onClick={() => void view.zoomOut()}>−</button>
      <button type="button" disabled={empty}
        onClick={() => void (bounds ? view.fitBounds(bounds, { padding: 0.2 }) : view.fitView(flowFitOptions))}>전체 보기</button>
    </Panel>
  );
}

const resizePositions = ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left'] as const;

function StepBox({ id, data, isConnectable, selected, width, height }: NodeProps<StepNode>) {
  const layout = stepLayout({ title: data.title, width, height });
  const refreshHandles = useUpdateNodeInternals();
  useLayoutEffect(() => {
    refreshHandles(id);
  }, [id, data.direction, layout.width, layout.height, refreshHandles]);
  return (
    <div className={`flow-step flow-step-${data.kind.toLowerCase()}`}>
      {selected && isConnectable && resizePositions.map((position) => (
        <NodeResizeControl key={position} position={position} className="step-resize nodrag nopan"
          minWidth={minStepWidth} minHeight={layout.minHeight} keepAspectRatio={false}
          style={{ marginLeft: position === 'left' ? -17 : position === 'right' ? 17 : 0,
            marginTop: position === 'top' ? -17 : position === 'bottom' ? 17 : 0 }} />
      ))}
      {ports(data.direction, layout.width, layout.height).map(({ id, type, position, anchor }) => (
        <Handle key={id} id={id} type={type} position={position} isConnectable={isConnectable}
          isConnectableStart={type === 'source'}
          title={type === 'source' ? '출력 연결점' : '입력 연결점'}
          style={{ left: anchor.x, top: anchor.y, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' }} />
      ))}
      <div className="flow-step-kind">{stepLabels[data.kind]}</div>
      <div className="flow-step-title" title={data.title}>{layout.lines.map((line, index) =>
        <div key={index}>{line || '\u00a0'}</div>)}</div>
    </div>
  );
}

function cardAnchor(x: number, y: number, side: Position) {
  const outward = normals[side];
  // React Flow provides the outer edge of the handle. Draw to the card boundary.
  return { side, x: x - outward.x * handleSize / 2, y: y - outward.y * handleSize / 2 };
}

function useFlowDrag(beginDrag: () => (delta: XYPosition) => void) {
  const { screenToFlowPosition } = useReactFlow();
  const drag = useRef<{ id: number; origin: XYPosition; screen: XYPosition; started: boolean;
    move: (delta: XYPosition) => void } | null>(null);
  return {
    onPointerDown: (event: PointerEvent<Element>) => {
      if (event.button !== 0 || drag.current) return;
      event.stopPropagation();
      event.preventDefault();
      if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus({ preventScroll: true });
      const origin = screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
      drag.current = { id: event.pointerId, origin, screen: { x: event.clientX, y: event.clientY },
        started: false, move: beginDrag() };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<Element>) => {
      const active = drag.current;
      if (!active || event.pointerId !== active.id) return;
      event.stopPropagation();
      if (!active.started && Math.hypot(event.clientX - active.screen.x, event.clientY - active.screen.y) < 3) return;
      active.started = true;
      const pointer = screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
      active.move({ x: pointer.x - active.origin.x, y: pointer.y - active.origin.y });
    },
    onLostPointerCapture: () => { drag.current = null; },
  };
}

function CurveHandle({ point, label, center = false, axis, beginDrag }: {
  point: XYPosition; label: string; center?: boolean; axis?: 'x' | 'y'; beginDrag: () => (delta: XYPosition) => void;
}) {
  const drag = useFlowDrag(beginDrag);
  return (
    <button type="button" className={`curve-handle nodrag nopan${center ? ' curve-handle-center' : ''}`} aria-label={label} title={label}
      style={{ left: point.x, top: point.y, cursor: axis ? (axis === 'x' ? 'ew-resize' : 'ns-resize') : undefined }}
      onClick={(event) => event.stopPropagation()} {...drag}
    />
  );
}

function LinkLine({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  source, target, markerEnd, interactionWidth, data, selected }: EdgeProps<LinkEdge>) {
  const sourceNode = useInternalNode<StepNode>(source);
  const targetNode = useInternalNode<StepNode>(target);
  function card(node: typeof sourceNode) {
    if (!node) return;
    return { ...node.internals.positionAbsolute,
      ...stepLayout({ title: node.data.title, width: node.measured.width ?? node.width,
        height: node.measured.height ?? node.height }) };
  }
  const from = cardAnchor(sourceX, sourceY, sourcePosition);
  const to = cardAnchor(targetX, targetY, targetPosition);
  const geometry = linkGeometry(from, to, data ?? {}, card(sourceNode), card(targetNode));
  const { path, midpoint, curve, orthogonal } = geometry;
  const condition = data?.condition.trim();
  const select = data?.select;
  const changeCurve = selected && curve ? data?.changeCurve : undefined;
  const changeRoute = selected && orthogonal ? data?.changeRoute : undefined;
  const labelGap = changeCurve || changeRoute ? 18 : 5;
  const labelStyle = { transform: `translate(${midpoint.x}px, ${midpoint.y - labelGap}px) translate(-50%, -100%)` };
  const startControl = curve?.startControl ?? from;
  const endControl = curve?.endControl ?? to;
  const start = { x: startControl.x - from.x, y: startControl.y - from.y };
  const end = { x: endControl.x - to.x, y: endControl.y - to.y };
  const sameOrientation = (from.side === 'right') === (to.side === 'left');
  const primaryIndex = sameOrientation ? 2 : 1;
  const routeControls = orthogonal?.controls.filter((segment) => data?.route
    ? segment.index === primaryIndex || segment.length > 8 : segment.index === primaryIndex) ?? [];

  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={interactionWidth}
      style={{ strokeLinejoin: 'miter', strokeLinecap: 'butt' }} />
    {orthogonal && changeRoute && <EdgeLabelRenderer>
      {routeControls.map((segment) =>
        <CurveHandle key={segment.index} center={segment.index === primaryIndex}
          point={data?.route ? { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 } : midpoint}
          label={!data?.route ? '직선을 꺾은선으로 조절'
            : segment.axis === 'x' ? '수직 구간을 좌우로 조절' : '수평 구간을 위아래로 조절'}
          axis={data?.route ? segment.axis : undefined}
          beginDrag={() => {
            const initial = !data?.route && sameOrientation ? { ...orthogonal.route, offset: 0 } : orthogonal.route;
            return (delta) => {
              const value = initial[segment.field] + delta[segment.axis] * segment.sign;
              changeRoute(id, { ...initial, [segment.field]: segment.field === 'offset' ? value : Math.max(24, value) });
            };
          }} />
      )}
    </EdgeLabelRenderer>}
    {changeCurve && <>
      <path className="curve-guide"
        d={`M ${from.x},${from.y} L ${startControl.x},${startControl.y} M ${to.x},${to.y} L ${endControl.x},${endControl.y}`} />
      <EdgeLabelRenderer>
        <CurveHandle point={startControl} label="출발 쪽 곡선 제어점" beginDrag={() => (delta) => changeCurve(id, {
          start: { x: start.x + delta.x, y: start.y + delta.y }, end,
        })} />
        <CurveHandle point={endControl} label="도착 쪽 곡선 제어점" beginDrag={() => (delta) => changeCurve(id, {
          start, end: { x: end.x + delta.x, y: end.y + delta.y },
        })} />
        <CurveHandle center point={midpoint} label="곡선 중앙 이동" beginDrag={() => (delta) => {
          const dx = delta.x / (2 * midpointControlWeight);
          const dy = delta.y / (2 * midpointControlWeight);
          changeCurve(id, {
            start: { x: start.x + dx, y: start.y + dy },
            end: { x: end.x + dx, y: end.y + dy },
          });
        }} />
      </EdgeLabelRenderer>
    </>}
    {condition && <EdgeLabelRenderer>
      {select ? (
        <button type="button" className={`flow-link-label nodrag nopan${selected ? ' selected' : ''}`}
          title={condition} aria-pressed={selected ?? false} onClick={() => select(id)} style={labelStyle}>
          {condition}
        </button>
      ) : <span className="flow-link-label" title={condition} style={labelStyle}>{condition}</span>}
    </EdgeLabelRenderer>}
  </>;
}

export const flowNodeTypes = { questStep: StepBox };
export const flowEdgeTypes = { questLink: LinkLine };
