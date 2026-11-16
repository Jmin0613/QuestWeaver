import { BaseEdge, EdgeLabelRenderer, Handle, MarkerType, Panel, Position, useReactFlow } from '@xyflow/react';
import type { Edge, EdgeProps, Node, NodeProps } from '@xyflow/react';
import { stepLabels } from './flowModel';
import type { FlowDocument, Link, Step } from './flowModel';

type StepData = Pick<Step, 'kind' | 'title' | 'description'>;
export type StepNode = Node<StepData, 'questStep'>;
export type LinkEdge = Edge<{ condition: string; lane?: number; select?: (id: string) => void }, 'questLink'>;

export function asNode({ id, x, y, kind, title, description }: Step): StepNode {
  const width = 156;
  const height = 54;
  const handleSize = 12;
  const handleY = (height - handleSize) / 2;
  // Fixed cards and handle positions let edges render on the first frame.
  return {
    id,
    type: 'questStep',
    position: { x, y },
    data: { kind, title, description },
    initialWidth: width,
    initialHeight: height,
    style: { width, height },
    handles: [
      { id: 'in', type: 'target', position: Position.Left, x: -handleSize / 2, y: handleY, width: handleSize, height: handleSize },
      { id: 'out', type: 'source', position: Position.Right, x: width - handleSize / 2, y: handleY, width: handleSize, height: handleSize },
    ],
  };
}

export function asEdge({ id, from, to, condition }: Link): LinkEdge {
  return {
    id,
    type: 'questLink',
    source: from,
    target: to,
    sourceHandle: 'out',
    targetHandle: 'in',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#53658c' },
    interactionWidth: 20,
    data: { condition },
    ariaLabel: condition || '퀘스트 연결선',
  };
}

export function graphData(nodes: StepNode[], edges: LinkEdge[]): Pick<FlowDocument, 'steps' | 'links'> {
  return {
    steps: nodes.map(({ id, position, data }) => ({ id, ...data, x: position.x, y: position.y })),
    links: edges.map(({ id, source, target, data }) => ({ id, from: source, to: target, condition: data?.condition ?? '' })),
  };
}

export function withLanes(edges: LinkEdge[], select?: (id: string) => void): LinkEdge[] {
  const counts = new Map<string, number>();
  const keyFor = (edge: LinkEdge) => `${edge.source}:${edge.target}`;
  for (const edge of edges) {
    const key = keyFor(edge);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const nextLane = new Map<string, number>();
  return edges.map((edge) => {
    const key = keyFor(edge);
    const lane = nextLane.get(key) ?? -((counts.get(key) ?? 1) - 1) / 2;
    nextLane.set(key, lane + 1);
    return { ...edge, data: { condition: edge.data?.condition ?? '', lane, select } };
  });
}

export const flowFitOptions = { padding: 0.24, maxZoom: 1.3, includeHiddenNodes: true };

export function FlowControls({ empty = false }: { empty?: boolean }) {
  const view = useReactFlow<StepNode, LinkEdge>();
  return (
    <Panel position="bottom-left" className="flow-controls">
      <button type="button" title="확대" aria-label="확대" onClick={() => void view.zoomIn()}>+</button>
      <button type="button" title="축소" aria-label="축소" onClick={() => void view.zoomOut()}>−</button>
      <button type="button" disabled={empty} onClick={() => void view.fitView(flowFitOptions)}>전체 보기</button>
    </Panel>
  );
}

function StepBox({ data, isConnectable }: NodeProps<StepNode>) {
  return (
    <div className={`flow-step flow-step-${data.kind.toLowerCase()}`}>
      <Handle id="in" type="target" position={Position.Left} title="들어오는 연결" isConnectable={isConnectable} />
      <div className="flow-step-kind">{stepLabels[data.kind]}</div>
      <div className="flow-step-title" title={data.title}>{data.title.trim() || '제목 없는 단계'}</div>
      <Handle id="out" type="source" position={Position.Right} title="나가는 연결" isConnectable={isConnectable} />
    </div>
  );
}

function LinkLine({ id, sourceX, sourceY, targetX, targetY, markerEnd, interactionWidth, data, selected }: EdgeProps<LinkEdge>) {
  const lane = data?.lane ?? 0;
  const backward = targetX < sourceX;
  const reach = backward ? 75 + 20 * Math.abs(lane) : Math.max(35, (targetX - sourceX) / 2);
  const bend = (backward ? 125 : 0) + lane * 58;
  const path = `M ${sourceX},${sourceY} C ${sourceX + reach},${sourceY + bend} ${targetX - reach},${targetY + bend} ${targetX},${targetY}`;
  const labelX = (sourceX + targetX) / 2;
  const labelY = (sourceY + targetY) / 2 + 0.75 * bend;
  const condition = data?.condition.trim();
  const select = data?.select;
  const labelStyle = { transform: `translate(${labelX}px, ${labelY}px) translate(-50%, -130%)` };

  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={interactionWidth} />
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
