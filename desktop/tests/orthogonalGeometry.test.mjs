import assert from 'node:assert/strict';
import test from 'node:test';
import { linkCurve, linkGeometry, normals, orthogonalPath, portAnchor } from '../src/flowGeometry.ts';

const box = (x, y, width = 156, height = 80) => ({ x, y, width, height });
function check(source, target, fromDirection, toDirection, lane = 0, manual) {
  const from = portAnchor(source, fromDirection, 'source');
  const to = portAnchor(target, toDirection, 'target');
  const route = orthogonalPath(from, to, lane, manual, source, target);
  assert.deepEqual(route.points[0], from);
  assert.deepEqual(route.points.at(-1), to);
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i];
    assert.ok(a.x === b.x || a.y === b.y, 'every segment is axis aligned');
  }
  const first = route.points[1], last = route.points.at(-2);
  const a = normals[from.side], b = normals[to.side];
  assert.ok((first.x - from.x) * a.x + (first.y - from.y) * a.y >= 24);
  assert.ok((last.x - to.x) * b.x + (last.y - to.y) * b.y >= 24);
  assert.ok(!/[CQAS]/.test(route.path), 'corners use straight line commands');
  assert.ok(route.controls.some(({ a, b }) =>
    route.midpoint.x === (a.x + b.x) / 2 && route.midpoint.y === (a.y + b.y) / 2));
  return route;
}

test('straight, branches, mixed directions, backward links and self loops have square corners and correct arrows', () => {
  for (const a of ['HORIZONTAL', 'VERTICAL']) {
    for (const b of ['HORIZONTAL', 'VERTICAL']) {
      for (const target of [box(350, 0), box(0, 350), box(-350, -100), box(0, 0)]) {
        check(box(0, 0), target, a, b);
      }
    }
  }
});

test('backward routes run outside the complete endpoint boxes', () => {
  const source = box(600, 0, 240, 400), target = box(0, 0, 200, 200);
  const horizontal = check(source, target, 'HORIZONTAL', 'HORIZONTAL');
  assert.ok(horizontal.points[2].y > 400);
  const vertical = check(box(0, 600, 400, 100), target, 'VERTICAL', 'VERTICAL');
  assert.ok(vertical.points[2].x > 400);
});

test('parallel connections are distinct for forward, retry and mixed directions', () => {
  for (const [from, to] of [['HORIZONTAL', 'HORIZONTAL'], ['VERTICAL', 'VERTICAL'],
    ['HORIZONTAL', 'VERTICAL'], ['VERTICAL', 'HORIZONTAL']]) {
    for (const target of [box(500, 450), box(-300, -350)]) {
      const a = check(box(0, 0), target, from, to, -0.5);
      const b = check(box(0, 0), target, from, to, 0.5);
      assert.notEqual(a.path, b.path);
    }
  }
});

test('dragging changes only the normal coordinate of a segment and routes follow moved/resized nodes', () => {
  const source = box(0, 0), target = box(400, 100);
  const initial = check(source, target, 'HORIZONTAL', 'HORIZONTAL');
  for (const segment of initial.controls) {
    const manual = { ...initial.route, [segment.field]: initial.route[segment.field] + 10 * segment.sign };
    const changed = check(source, target, 'HORIZONTAL', 'HORIZONTAL', 0, manual);
    assert.equal(changed.points[segment.index][segment.axis] - initial.points[segment.index][segment.axis], 10);
    assert.equal(changed.points[segment.index + 1][segment.axis] - initial.points[segment.index + 1][segment.axis], 10);
    const moved = check(box(70, 90, 260, 180), box(470, 190), 'HORIZONTAL', 'HORIZONTAL', 0, manual);
    assert.deepEqual(moved.route, manual);
  }
});

test('legacy curves retain the exact existing cubic path and manual controls', () => {
  const from = portAnchor(box(0, 0), 'HORIZONTAL', 'source');
  const to = portAnchor(box(400, 0), 'HORIZONTAL', 'target');
  const curve = { start: { x: 200, y: -300 }, end: { x: -140, y: 80 } };
  const original = linkCurve(from, to, 0, curve);
  const restored = linkGeometry(from, to, { curve });
  assert.deepEqual(restored.curve, original);
  assert.deepEqual(linkGeometry(from, to, { kind: 'CURVE', curve }).curve, original);
  assert.ok(linkGeometry(from, to, { kind: 'ORTHOGONAL', curve }).orthogonal);
});

test('an unedited straight/polyline joins endpoints directly at equal or different heights', () => {
  const from = portAnchor(box(0, 0), 'HORIZONTAL', 'source');
  for (const target of [box(400, 0), box(400, 260), box(-300, -140)]) {
    const to = portAnchor(target, 'HORIZONTAL', 'target');
    const geometry = linkGeometry(from, to, { kind: 'ORTHOGONAL', lane: 0.5 });
    assert.deepEqual(geometry.points, [from, to]);
    assert.equal(geometry.path, `M ${from.x},${from.y} L ${to.x},${to.y}`);
    assert.deepEqual(geometry.midpoint, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  }
});

test('stored manual paths retain exactly the same corners and reset returns a direct line', () => {
  const source = box(600, 120), target = box(0, 0);
  const from = portAnchor(source, 'HORIZONTAL', 'source'), to = portAnchor(target, 'HORIZONTAL', 'target');
  const route = { start: 65, end: 90, offset: 370 };
  const expected = orthogonalPath(from, to, 0, route, source, target);
  const manual = linkGeometry(from, to, { kind: 'ORTHOGONAL', route }, source, target);
  assert.equal(manual.path, expected.path);
  assert.deepEqual(manual.points, expected.points);
  assert.equal(linkGeometry(from, to, { kind: 'ORTHOGONAL' }, source, target).points.length, 2);
});
