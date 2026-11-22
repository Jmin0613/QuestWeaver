import assert from 'node:assert/strict';
import test from 'node:test';
import { FlowHistory } from '../src/flowHistory.ts';

const initial = {
  steps: [
    { id: 'start', kind: 'START', title: '시작', description: '', x: 0, y: 0 },
    { id: 'end', kind: 'END', title: '종료', description: '', x: 300, y: 0 },
  ],
  links: [{ id: 'link', from: 'start', to: 'end', condition: '완료' }],
};
const edit = (graph, update) => {
  const result = structuredClone(graph);
  update(result);
  return result;
};

test('one drag or input group restores its initial and final snapshots', () => {
  for (const field of ['x', 'width', 'title']) {
    const history = new FlowHistory(initial);
    let final;
    for (let i = 1; i <= 30; i++) {
      final = edit(initial, (graph) => { graph.steps[0][field] = field === 'title' ? '입력'.repeat(i) : i * 10; });
      history.record(final, 1);
    }
    assert.deepEqual(history.undo(), initial);
    assert.equal(history.canUndo, false);
    assert.deepEqual(history.redo(), final);
    assert.equal(history.canRedo, false);
  }
});

test('deleting a step and its incident links is restored atomically', () => {
  const history = new FlowHistory(initial);
  const deleted = { steps: [initial.steps[1]], links: [] };
  history.record(deleted, 1);
  assert.deepEqual(history.undo(), initial);
  assert.deepEqual(history.redo(), deleted);
});

test('consecutive undo and redo traverse separate edits and discard redo after a new edit', () => {
  const history = new FlowHistory(initial);
  const moved = edit(initial, (graph) => { graph.steps[0].x = 90; });
  const titled = edit(moved, (graph) => { graph.steps[0].title = '변경'; });
  history.record(moved, 1);
  history.record(titled, 2);
  assert.deepEqual(history.undo(), moved);
  assert.deepEqual(history.undo(), initial);
  assert.deepEqual(history.redo(), moved);
  history.record(edit(moved, (graph) => { graph.links[0].condition = '새 조건'; }), 3);
  assert.equal(history.canRedo, false);
  assert.equal(history.redo(), undefined);
});

test('returning a gesture to its original shape does not create a no-op entry', () => {
  const history = new FlowHistory(initial);
  assert.equal(history.record(initial, 1), false);
  history.record(edit(initial, (graph) => { graph.steps[0].x = 10; }), 2);
  history.record(initial, 2);
  assert.equal(history.canUndo, false);
});

test('saving a snapshot preserves history and undo differs from the saved snapshot', () => {
  const history = new FlowHistory(initial);
  const saved = edit(initial, (graph) => { graph.steps[0].height = 200; });
  history.record(saved, 1);
  assert.notDeepEqual(history.undo(), saved);
  assert.deepEqual(history.redo(), saved);
});

test('AI replacement can be undone and sessions have independent histories', () => {
  const history = new FlowHistory(initial);
  const draft = { steps: [], links: [] };
  history.record(draft, 1);
  assert.deepEqual(history.undo(), initial);
  assert.deepEqual(history.redo(), draft);
  const nextSession = new FlowHistory(draft);
  assert.equal(nextSession.canUndo, false);
  assert.equal(nextSession.canRedo, false);
});

test('bulk edge kind conversion restores legacy curves and manual routes in one undo', () => {
  const original = edit(initial, (graph) => {
    graph.links[0].curve = { start: { x: 120, y: -190 }, end: { x: -80, y: 20 } };
    graph.links.push({ id: 'retry', from: 'end', to: 'start', condition: '재도전',
      kind: 'ORTHOGONAL', route: { start: 40, end: 40, offset: 300 } });
  });
  const history = new FlowHistory(original);
  const bulk = edit(original, (graph) => { graph.links.forEach((link) => { link.kind = 'ORTHOGONAL'; }); });
  history.record(bulk, 1);
  assert.deepEqual(history.undo(), original);
  assert.equal(history.canUndo, false);
  assert.deepEqual(history.redo(), bulk);
});
