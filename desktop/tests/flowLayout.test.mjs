import test from 'node:test';
import assert from 'node:assert/strict';
import { autoLayout } from '../src/flowLayout.ts';
import { FlowHistory } from '../src/flowHistory.ts';
import { portAnchor, linkGeometry } from '../src/flowGeometry.ts';

const measure = (step) => ({ width: step.width ?? 156, height: Math.max(step.height ?? 54, step.title.length * 2) });
const make = (ids, pairs) => ({
  steps: ids.map((id, index) => ({ id, kind: index === 0 ? 'START' : 'PROGRESS', title: id, description: '설명',
    x: 777, y: -321, planning: { notes: '유지' } })),
  links: pairs.map(([from, to], i) => ({ id: 'link-' + i, from, to, condition: '조건 ' + i, kind: 'ORTHOGONAL',
    route: { start: 90, end: 100, offset: 200 }, curve: { start: { x: 1, y: 2 }, end: { x: 3, y: 4 } } })),
  viewport: { x: 77, y: 22, zoom: 0.8 },
});
function noOverlap(flow) {
  for (let i = 0; i < flow.steps.length; i++) for (const b of flow.steps.slice(i + 1)) {
    const a = flow.steps[i];
    assert.ok(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
  }
}
const meaning = (flow) => ({ steps: flow.steps.map(({ id, kind, title, description, planning }) => ({ id, kind, title, description, planning })),
  links: flow.links.map(({ id, from, to, condition, kind }) => ({ id, from, to, condition, kind })) });

test('horizontal and vertical chains retain meaning, dimensions and have increasing ranks', () => {
  for (const direction of ['HORIZONTAL', 'VERTICAL']) {
    const original = make(['시작', '긴한글제목'.repeat(40), '종료'], [['시작', '긴한글제목'.repeat(40)], ['긴한글제목'.repeat(40), '종료']]);
    original.steps[0].width = 380; original.steps[0].height = 130;
    original.steps[1].width = 80;
    const snapshot = structuredClone(original), arranged = autoLayout(original, direction,
      (step) => ({ ...measure(step), lines: ['renderer only'], minHeight: 54 }));
    assert.ok(arranged.steps.every((step) => !('lines' in step) && !('minHeight' in step)));
    assert.deepEqual(original, snapshot);
    assert.deepEqual(meaning(arranged), meaning(original));
    noOverlap(arranged);
    const axis = direction === 'HORIZONTAL' ? 'x' : 'y';
    assert.ok(arranged.steps[0][axis] < arranged.steps[1][axis] && arranged.steps[1][axis] < arranged.steps[2][axis]);
    assert.ok(arranged.steps.every((step) => step.direction === direction));
    assert.equal(arranged.steps[0].width, 380);
    assert.equal(arranged.steps[1].height, measure(original.steps[1]).height);
    assert.deepEqual(arranged, autoLayout(arranged, direction, measure), 'repeating layout is stable');
  }
});

test('branches, parallel links, feedback, self loops and isolated cycles have separate space and outer return routes', () => {
  const original = make(['s', 'b', 'left', 'right', 'end', 'alone', 'cycle-a', 'cycle-b'],
    [['s', 'b'], ['b', 'left'], ['b', 'right'], ['left', 'end'], ['right', 'end'], ['right', 'b'],
      ['right', 'b'], ['b', 'b'], ['cycle-a', 'cycle-b'], ['cycle-b', 'cycle-a']]);
  original.steps[2].width = 460; original.steps[3].height = 320;
  for (const direction of ['HORIZONTAL', 'VERTICAL']) {
    const arranged = autoLayout(original, direction, measure);
    noOverlap(arranged);
    assert.deepEqual(meaning(arranged), meaning(original));
    const byId = new Map(arranged.steps.map((step) => [step.id, step]));
    const cross = direction === 'HORIZONTAL' ? 'y' : 'x';
    const extent = Math.max(...arranged.steps.map((step) => step[cross] + (cross === 'y' ? step.height : step.width)));
    const paths = [];
    for (const link of arranged.links.filter((l) => l.from === 'right' && l.to === 'b' || l.from === l.to)) {
      const a = byId.get(link.from), b = byId.get(link.to);
      const geometry = linkGeometry(portAnchor(a, direction, 'source'), portAnchor(b, direction, 'target'), link, a, b);
      assert.ok(geometry.points.some((point) => point[cross] > extent));
      paths.push(geometry.path);
    }
    assert.equal(new Set(paths).size, paths.length);
  }
});

test('curve kinds are kept and retry curves have outer control offsets', () => {
  const flow = make(['a', 'b'], [['a', 'b'], ['b', 'a']]);
  flow.links.forEach((link) => { link.kind = 'CURVE'; });
  const arranged = autoLayout(flow, 'VERTICAL', measure);
  assert.ok(arranged.links.every((link) => link.kind === 'CURVE' && link.route === undefined));
  assert.ok(arranged.links[1].curve.start.x > 156);
});

test('one history entry restores all positions, directions and manual paths, and supports redo', () => {
  const flow = make(['a', 'b'], [['a', 'b'], ['b', 'a']]);
  const history = new FlowHistory(flow);
  const arranged = autoLayout(flow, 'VERTICAL', measure);
  history.record(arranged, 1);
  assert.deepEqual(history.undo(), flow);
  assert.equal(history.canUndo, false);
  assert.deepEqual(history.redo(), arranged);
});

test('empty charts and a deep cycle terminate deterministically', () => {
  const empty = make([], []);
  assert.deepEqual(autoLayout(empty, 'VERTICAL', measure), empty);
  const ids = Array.from({ length: 2000 }, (_, i) => String(i));
  const flow = make(ids, ids.map((id, i) => [id, ids[(i + 1) % ids.length]]));
  const arranged = autoLayout(flow, 'HORIZONTAL', measure);
  assert.equal(arranged.steps.length, 2000);
  assert.ok(arranged.steps.every((step) => Number.isFinite(step.x) && Number.isFinite(step.y)));
});
