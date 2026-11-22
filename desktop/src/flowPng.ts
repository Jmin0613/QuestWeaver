import { asEdge, withLanes } from './flowElements';
import { stepFontFamily, stepLayout, titleLineHeight } from './stepLayout';
import { linkCurve, portAnchor } from './flowGeometry';
import { stepLabels } from './flowModel';
import type { FlowDocument, StepKind } from './flowModel';

const maxSide = 8192;
const maxPixels = 24_000_000;
const margin = 34;
const fontFamily = stepFontFamily;
const tooLarge = '차트가 PNG 크기 제한(한 변 8,192px, 총 2,400만 픽셀)을 넘습니다. 단계 간격을 줄여 주세요.';
const colors: Record<StepKind, [string, string]> = {
  START: ['#2b775d', '#edf8f3'],
  PROGRESS: ['#4b61a0', '#f0f3fc'],
  BRANCH: ['#95601b', '#fff5e6'],
  END: ['#985070', '#fff0f5'],
};
type Box = { x: number; y: number; width: number; height: number };

function wrap(ctx: CanvasRenderingContext2D, value: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r\n?|\n/u)) {
    let line = '';
    for (const character of paragraph) {
      if (line && ctx.measureText(line + character).width > width) {
        lines.push(line);
        line = '';
      }
      if (lines.length > maxSide / 15) throw new Error(tooLarge);
      line += character;
    }
    lines.push(line);
    if (lines.length > maxSide / 15) throw new Error(tooLarge);
  }
  return lines;
}

function intersects(a: Box, b: Box) {
  return a.x < b.x + b.width + 5 && a.x + a.width + 5 > b.x &&
    a.y < b.y + b.height + 5 && a.y + a.height + 5 > b.y;
}

export async function renderFlowPng(flow: FlowDocument, game: string, quest: string): Promise<Uint8Array> {
  if (!flow.steps.length) throw new Error('내보낼 단계가 없습니다.');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PNG를 그릴 수 없습니다.');
  const ctx = context;
  await document.fonts.ready;
  ctx.font = `600 14px ${fontFamily}`;
  const anchor = flow.steps[0];
  const cards = new Map(flow.steps.map((step) => {
    const x = step.x - anchor.x, y = step.y - anchor.y;
    if (!(Math.abs(x) < maxSide && Math.abs(y) < maxSide)) throw new Error(tooLarge);
    return [step.id, { ...step, ...stepLayout(step), x, y }];
  }));

  const occupied: Box[] = [...cards.values()];
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  function include(x: number, y: number) {
    bounds.left = Math.min(bounds.left, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.right = Math.max(bounds.right, x);
    bounds.bottom = Math.max(bounds.bottom, y);
  }
  for (const card of cards.values()) {
    include(card.x, card.y);
    include(card.x + card.width, card.y + card.height);
  }

  ctx.font = `500 13px ${fontFamily}`;
  const lines = withLanes(flow.links.map(asEdge)).map((edge) => {
    const from = cards.get(edge.source);
    const to = cards.get(edge.target);
    if (!from || !to) throw new Error('연결된 단계를 찾을 수 없어 PNG를 만들 수 없습니다.');
    const start = portAnchor(from, from.direction, 'source');
    const end = portAnchor(to, to.direction, 'target');
    const curve = linkCurve(start, end, edge.data?.lane ?? 0, edge.data?.curve);
    for (const point of Object.values(curve)) include(point.x, point.y);
    const condition = edge.data?.condition.trim();
    let label;
    if (condition) {
      const text = wrap(ctx, condition, 230);
      const width = Math.max(...text.map((row) => ctx.measureText(row).width)) + 16;
      const height = text.length * 17 + 10;
      const box = { x: curve.midpoint.x - width / 2, y: curve.midpoint.y - height - 5, width, height };
      let collision = occupied.find((other) => intersects(box, other));
      while (collision) {
        box.y = collision.y - height - 6;
        collision = occupied.find((other) => intersects(box, other));
      }
      occupied.push(box);
      include(box.x, box.y);
      include(box.x + width, box.y + height);
      label = { ...box, text };
    }
    return { start, end, ...curve, label };
  });

  ctx.font = `700 23px ${fontFamily}`;
  const questLines = wrap(ctx, quest, 720);
  const questWidth = Math.max(...questLines.map((row) => ctx.measureText(row).width));
  ctx.font = `500 15px ${fontFamily}`;
  const gameLines = wrap(ctx, game, 720);
  const gameWidth = Math.max(...gameLines.map((row) => ctx.measureText(row).width));
  const header = 30 * questLines.length + 21 * gameLines.length + 20;
  const width = Math.ceil(Math.max(360, questWidth, gameWidth, bounds.right - bounds.left) + 2 * margin);
  const height = Math.ceil(bounds.bottom - bounds.top + header + 2 * margin + 24);
  const scale = Math.min(2, maxSide / width, maxSide / height, Math.sqrt(maxPixels / (width * height)));
  if (!Number.isFinite(scale) || scale < 1) throw new Error(tooLarge);
  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'top';
  function text(rows: string[], x: number, y: number, lineHeight: number, size: number, weight: number, color: string) {
    ctx.font = `${weight} ${size}px ${fontFamily}`;
    ctx.fillStyle = color;
    rows.forEach((row, index) => ctx.fillText(row, x, y + index * lineHeight));
  }
  text(gameLines, margin, margin, 21, 15, 500, '#475674');
  text(questLines, margin, margin + gameLines.length * 21, 30, 23, 700, '#1d273c');
  text(['React Flow · xyflow.com'], margin, height - 26, 15, 12, 500, '#475674');
  ctx.translate(margin - bounds.left, margin + header - bounds.top);

  for (const { start, end, startControl, midpoint, endControl, label } of lines) {
    ctx.strokeStyle = '#53658c';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.bezierCurveTo(startControl.x, startControl.y, endControl.x, endControl.y, end.x, end.y);
    ctx.stroke();
    const angle = Math.atan2(end.y - endControl.y, end.x - endControl.x);
    ctx.fillStyle = '#53658c';
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    for (const offset of [-0.45, 0.45]) {
      ctx.lineTo(end.x - 9 * Math.cos(angle + offset), end.y - 9 * Math.sin(angle + offset));
    }
    ctx.closePath();
    ctx.fill();
    if (label) {
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(midpoint.x, midpoint.y);
      ctx.lineTo(midpoint.x, label.y + label.height);
      ctx.stroke();
    }
  }

  function box(area: Box, border: string, fill: string) {
    ctx.beginPath();
    ctx.roundRect(area.x, area.y, area.width, area.height, 6);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = border;
    ctx.stroke();
  }
  for (const card of cards.values()) {
    const [accent, fill] = colors[card.kind];
    box(card, accent, fill);
    text([stepLabels[card.kind]], card.x + 15, card.y + 9, 15, 12, 700, accent);
    text(card.lines, card.x + 15, card.y + 24, titleLineHeight, 14, 600, '#1d273c');
  }
  for (const { label } of lines) {
    if (!label) continue;
    box(label, '#b9c7dd', '#fff');
    text(label.text, label.x + 8, label.y + 5, 17, 13, 500, '#263656');
  }

  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('PNG 인코딩에 실패했습니다.');
  return new Uint8Array(await png.arrayBuffer());
}
