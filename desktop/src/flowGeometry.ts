import type { CurveOffsets, Direction } from './flowModel';

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
