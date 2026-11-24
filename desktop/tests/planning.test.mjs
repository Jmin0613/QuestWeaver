import assert from 'node:assert/strict';
import test from 'node:test';
import { planningPatch, questPlanning, stepPlanning } from '../src/planning.ts';
import { FlowHistory } from '../src/flowHistory.ts';

test('legacy quest and AI step metadata have empty defaults without placeholder content', () => {
  assert.deepEqual(questPlanning(), { code: '', chapter: '', prerequisites: '', optional: false, rewards: '', background: '' });
  assert.equal(stepPlanning().actionType, 'UNSPECIFIED');
  assert.ok(Object.entries(stepPlanning()).filter(([key]) => key !== 'actionType').every(([, value]) => value === ''));
});

test('planning patches send only edited fields, including clearing text and false values', () => {
  const baseline = questPlanning({ code: 'Q-001', optional: true, rewards: '보상' });
  assert.deepEqual(planningPatch(baseline, baseline), {});
  assert.deepEqual(planningPatch({ ...baseline, optional: false, rewards: '' }, baseline), { optional: false, rewards: '' });
  assert.deepEqual(planningPatch({ ...baseline, chapter: '제2장' }, baseline), { chapter: '제2장' });
});

test('quest and step planning participate in session history independently', () => {
  const initial = { steps: [{ id: 's', planning: stepPlanning() }], links: [], planning: questPlanning() };
  const history = new FlowHistory(initial);
  const questEdited = { ...initial, planning: questPlanning({ rewards: '퀘스트 보상' }) };
  const stepEdited = { ...questEdited, steps: [{ id: 's', planning: stepPlanning({ rewards: '단계 보상' }) }] };
  history.record(questEdited, 1);
  history.record(stepEdited, 2);
  assert.deepEqual(history.undo(), questEdited);
  assert.deepEqual(history.undo(), initial);
  assert.deepEqual(history.redo(), questEdited);
  assert.deepEqual(history.redo(), stepEdited);
});

test('saving refreshed metadata keeps prior undo history without recording server refresh as an edit', () => {
  const initial = { steps: [], links: [], planning: questPlanning() };
  const history = new FlowHistory(initial);
  history.record({ ...initial, planning: questPlanning({ code: 'Q-2' }) }, 1);
  const saved = { ...initial, planning: questPlanning({ code: 'Q-2', chapter: '다른 창에서 수정' }) };
  history.synchronize(saved);
  assert.equal(history.record(saved, 2), false);
  assert.deepEqual(history.undo(), initial);
  assert.deepEqual(history.redo(), saved);
});
