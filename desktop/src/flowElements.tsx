import { useLayoutEffect, useRef } from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, MarkerType, NodeResizeControl, Panel, useReactFlow, useUpdateNodeInternals } from '@xyflow/react';
import type { Position } from '@xyflow/react';
import type { Edge, EdgeProps, Node, NodeProps, Rect, XYPosition } from '@xyflow/react';
import { stepLabels } from './flowModel';
import type { CurveOffsets, Direction, FlowDocument, Link, Step } from './flowModel';
import { handleSize, linkCurve, midpointControlWeight, normals, portAnchor } from './flowGeometry';
import { minStepWidth, stepLayout } from './stepLayout';

type StepData = Pick<Step, 'kind' | 'title' | 'description'> & { direction: Direction };
export type StepNode = Node<StepData, 'questStep'>;
type CurveChange = (id: string, curve: CurveOffsets) => void;
export type LinkEdge = Edge<{
  condition: string;
  curve?: CurveOffsets;
  lane?: number;
  select?: (id: string) => void;
  changeCurve?: CurveChange;
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

export function asEdge({ id, from, to, condition, curve }: Link): LinkEdge {
  return {
    id,
    type: 'questLink',
    source: from,
    target: to,
    sourceHandle: 'source',
    targetHandle: 'target',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#53658c' },
    interactionWidth: 20,
    data: { condition, curve },
    ariaLabel: condition || '퀘스트 연결선',
  };
}

export function graphData(nodes: StepNode[], edges: LinkEdge[]): Pick<FlowDocument, 'steps' | 'links'> {
  return {
    steps: nodes.map(({ id, position, data, width, height }) => ({ id, ...data, width, height, x: position.x, y: position.y })),
    links: edges.map(({ id, source, target, data }) => ({
      id, from: source, to: target, condition: data?.condition ?? '', curve: data?.curve,
    })),
  };
}

export function withLanes(edges: LinkEdge[], select?: (id: string) => void, changeCurve?: CurveChange): LinkEdge[] {
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
    return { ...edge, data: { condition: '', ...edge.data, lane, select, changeCurve } };
  });
}

export const flowFitOptions = { padding: 0.24, maxZoom: 1.3, includeHiddenNodes: true };

export function manualCurveBounds(nodes: StepNode[], edges: LinkEdge[]): Rect | undefined {
  if (!edges.some((edge) => edge.data?.curve)) return;
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
    const curve = linkCurve(portAnchor(from, from.direction, 'source'), portAnchor(to, to.direction, 'target'),
      edge.data?.lane ?? 0, edge.data?.curve);
    for (const point of Object.values(curve)) include(point.x, point.y);
    if (edge.data?.condition.trim()) {
      include(curve.midpoint.x - 70, curve.midpoint.y - 32);
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

function CurveHandle({ point, label, center = false, beginDrag }: {
  point: XYPosition;
  label: string;
  center?: boolean;
  beginDrag: () => (delta: XYPosition) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const drag = useRef<{ id: number; origin: XYPosition; move: (delta: XYPosition) => void } | null>(null);
  return (
    <button type="button" className={`curve-handle nodrag nopan${center ? ' curve-handle-center' : ''}`} aria-label={label} title={label}
      style={{ left: point.x, top: point.y }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.stopPropagation();
        event.preventDefault();
        const origin = screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
        drag.current = { id: event.pointerId, origin, move: beginDrag() };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || event.pointerId !== active.id) return;
        event.stopPropagation();
        const pointer = screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
        active.move({ x: pointer.x - active.origin.x, y: pointer.y - active.origin.y });
      }}
      onLostPointerCapture={() => { drag.current = null; }}
    />
  );
}

function LinkLine({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  markerEnd, interactionWidth, data, selected }: EdgeProps<LinkEdge>) {
  const from = cardAnchor(sourceX, sourceY, sourcePosition);
  const to = cardAnchor(targetX, targetY, targetPosition);
  const { startControl, midpoint, endControl } = linkCurve(from, to, data?.lane ?? 0, data?.curve);
  const path = `M ${from.x},${from.y} C ${startControl.x},${startControl.y} ${endControl.x},${endControl.y} ${to.x},${to.y}`;
  const condition = data?.condition.trim();
  const select = data?.select;
  const changeCurve = selected ? data?.changeCurve : undefined;
  const labelGap = changeCurve ? 18 : 5;
  const labelStyle = { transform: `translate(${midpoint.x}px, ${midpoint.y - labelGap}px) translate(-50%, -100%)` };
  const start = { x: startControl.x - from.x, y: startControl.y - from.y };
  const end = { x: endControl.x - to.x, y: endControl.y - to.y };

  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={interactionWidth} />
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
