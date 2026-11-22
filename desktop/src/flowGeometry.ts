import type { CurveOffsets, Direction, Link, OrthogonalRoute } from './flowModel';

type Point = { x: number; y: number };
type Anchor = Point & { side: Side };
type Card = Point & { width: number; height: number };
type Side = 'top' | 'bottom' | 'left' | 'right';
export type PortKind = 'source' | 'target';
export const handleSize = 12;
// At t=0.5 each interior control contributes 3/8 of its position.
export const midpointControlWeight = 3 / 8;
export const normals: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function portAnchor(card: Card, direction: Direction | undefined, kind: PortKind): Anchor {
  const side = direction === 'VERTICAL' ? (kind === 'source' ? 'bottom' : 'top')
    : (kind === 'source' ? 'right' : 'left');
  const { x, y } = normals[side];
  return {
    side,
    x: card.x + card.width * (1 + x) / 2,
    y: card.y + card.height * (1 + y) / 2,
  };
}

export function linkCurve(from: Anchor, to: Anchor, lane: number, curve?: CurveOffsets) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const a = normals[from.side], b = normals[to.side];
  const direction = distance ? { x: dx / distance, y: dy / distance } : { x: -a.y, y: a.x };
  const across = { x: -direction.y, y: direction.x };
  const reach = Math.min(140, Math.max(32, distance / 3));
  const bend = Math.min(130, Math.max(55, distance / 2));
  const facingAway = a.x * dx + a.y * dy <= 0 && b.x * dx + b.y * dy >= 0;
  const detour = facingAway ? { x: Math.abs(a.y), y: Math.abs(a.x) } : { x: 0, y: 0 };
  const steer = {
    x: (across.x * lane * 46 + detour.x * bend) / (2 * midpointControlWeight),
    y: (across.y * lane * 46 + detour.y * bend) / (2 * midpointControlWeight),
  };
  const start = curve?.start ?? { x: a.x * reach + steer.x, y: a.y * reach + steer.y };
  const end = curve?.end ?? { x: b.x * reach + steer.x, y: b.y * reach + steer.y };
  const startControl = { x: from.x + start.x, y: from.y + start.y };
  const endControl = { x: to.x + end.x, y: to.y + end.y };
  const midpoint = {
    x: (from.x + to.x) / 8 + (startControl.x + endControl.x) * midpointControlWeight,
    y: (from.y + to.y) / 8 + (startControl.y + endControl.y) * midpointControlWeight,
  };
  return { midpoint, startControl, endControl };
}

type SegmentControl = { index: number; axis: 'x' | 'y'; field: keyof OrthogonalRoute; sign: number };

export function orthogonalPath(from: Anchor, to: Anchor, lane = 0, manual?: OrthogonalRoute,
  source?: Card, target?: Card) {
  const horizontal = from.side === 'right';
  const targetHorizontal = to.side === 'left';
  const clearance = 40 + Math.abs(lane) * 24;
  let start = clearance, end = clearance, offset = lane * 24;
  const center = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  if (horizontal === targetHorizontal) {
    const gap = horizontal ? to.x - from.x : to.y - from.y;
    if (gap > 48) {
      start = end = Math.min(clearance, gap / 3);
    } else {
      const outer = horizontal
        ? Math.max(source ? source.y + source.height : from.y + 27,
          target ? target.y + target.height : to.y + 27)
        : Math.max(source ? source.x + source.width : from.x + 78,
          target ? target.x + target.width : to.x + 78);
      offset = outer + clearance + lane * 24 - (horizontal ? center.y : center.x);
    }
  } else if (horizontal) {
    if (to.x < from.x + clearance) start = Math.max(clearance, (target ? target.x + target.width : to.x + 78) + clearance - from.x);
    if (to.y < from.y + clearance) end = Math.max(clearance, to.y - (source?.y ?? from.y - 27) + clearance);
    if (target && from.y >= target.y && from.x + start >= target.x && from.x + start <= target.x + target.width) {
      start = target.x + target.width + clearance - from.x;
    }
    if (source && to.y - end >= source.y && to.y - end <= source.y + source.height) {
      end = to.y - source.y + clearance;
    }
  } else {
    if (to.y < from.y + clearance) start = Math.max(clearance, (target ? target.y + target.height : to.y + 27) + clearance - from.y);
    if (to.x < from.x + clearance) end = Math.max(clearance, to.x - (source?.x ?? from.x - 78) + clearance);
    if (target && from.x >= target.x && from.y + start >= target.y && from.y + start <= target.y + target.height) {
      start = target.y + target.height + clearance - from.y;
    }
    if (source && to.x - end >= source.x && to.x - end <= source.x + source.width) {
      end = to.x - source.x + clearance;
    }
  }
  if (horizontal !== targetHorizontal) {
    start += lane * 18;
    end -= lane * 18;
  }
  const route = manual ?? { start, end, offset };
  start = Math.max(24, route.start);
  end = Math.max(24, route.end);
  let points: Point[];
  let segments: SegmentControl[];
  if (horizontal && targetHorizontal) {
    const y = center.y + route.offset;
    points = [from, { x: from.x + start, y: from.y }, { x: from.x + start, y },
      { x: to.x - end, y }, { x: to.x - end, y: to.y }, to];
    segments = [{ index: 1, axis: 'x', field: 'start', sign: 1 },
      { index: 2, axis: 'y', field: 'offset', sign: 1 }, { index: 3, axis: 'x', field: 'end', sign: -1 }];
  } else if (!horizontal && !targetHorizontal) {
    const x = center.x + route.offset;
    points = [from, { x: from.x, y: from.y + start }, { x, y: from.y + start },
      { x, y: to.y - end }, { x: to.x, y: to.y - end }, to];
    segments = [{ index: 1, axis: 'y', field: 'start', sign: 1 },
      { index: 2, axis: 'x', field: 'offset', sign: 1 }, { index: 3, axis: 'y', field: 'end', sign: -1 }];
  } else if (horizontal) {
    points = [from, { x: from.x + start, y: from.y }, { x: from.x + start, y: to.y - end },
      { x: to.x, y: to.y - end }, to];
    segments = [{ index: 1, axis: 'x', field: 'start', sign: 1 }, { index: 2, axis: 'y', field: 'end', sign: -1 }];
  } else {
    points = [from, { x: from.x, y: from.y + start }, { x: to.x - end, y: from.y + start },
      { x: to.x - end, y: to.y }, to];
    segments = [{ index: 1, axis: 'y', field: 'start', sign: 1 }, { index: 2, axis: 'x', field: 'end', sign: -1 }];
  }
  const controls = segments.map((segment) => {
    const a = points[segment.index], b = points[segment.index + 1];
    return { ...segment, a, b, length: Math.hypot(b.x - a.x, b.y - a.y) };
  });
  // Put the condition on the longest interior run, away from the endpoints.
  const labelSegment = controls.reduce((longest, segment) => segment.length > longest.length ? segment : longest);
  const midpoint = { x: (labelSegment.a.x + labelSegment.b.x) / 2, y: (labelSegment.a.y + labelSegment.b.y) / 2 };
  return { points, midpoint, controls, route: { start, end, offset: route.offset },
    path: points.map((point, i) => `${i ? 'L' : 'M'} ${point.x},${point.y}`).join(' ') };
}

export function linkGeometry(from: Anchor, to: Anchor,
  data: Pick<Link, 'kind' | 'curve' | 'route'> & { lane?: number }, source?: Card, target?: Card) {
  if (data.kind === 'ORTHOGONAL') {
    const orthogonal = orthogonalPath(from, to, data.lane, data.route, source, target);
    if (!data.route) {
      return { orthogonal, curve: undefined, points: [from, to], endControl: from,
        midpoint: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
        path: `M ${from.x},${from.y} L ${to.x},${to.y}` };
    }
    return { ...orthogonal, orthogonal, endControl: orthogonal.points.at(-2)!, curve: undefined };
  }
  const curve = linkCurve(from, to, data.lane ?? 0, data.curve);
  return { ...curve, curve, orthogonal: undefined, points: [from, curve.startControl, curve.endControl, to],
    path: `M ${from.x},${from.y} C ${curve.startControl.x},${curve.startControl.y} ${curve.endControl.x},${curve.endControl.y} ${to.x},${to.y}` };
}
