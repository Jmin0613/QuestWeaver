import type { Direction, FlowDocument, Step } from './flowModel';

type Size = { width: number; height: number };

/** Deterministic layered layout. Feedback links remain links, but do not constrain ranks. */
export function autoLayout(flow: FlowDocument, direction: Direction, measure: (step: Step) => Size): FlowDocument {
  if (!flow.steps.length) return { ...flow, steps: [], links: [...flow.links] };
  const horizontal = direction === 'HORIZONTAL';
  const byId = new Map(flow.steps.map((step) => [step.id, step]));
  const outgoing = new Map(flow.steps.map((step) => [step.id, [] as string[]]));
  const incoming = new Map(flow.steps.map((step) => [step.id, 0]));
  for (const link of flow.links) {
    if (!byId.has(link.from) || !byId.has(link.to)) continue;
    outgoing.get(link.from)!.push(link.to);
    incoming.set(link.to, incoming.get(link.to)! + 1);
  }
  const seeds = [...flow.steps].sort((a, b) =>
    Number(b.kind === 'START') - Number(a.kind === 'START') ||
    Number(incoming.get(a.id)! > 0) - Number(incoming.get(b.id)! > 0));
  const color = new Map<string, number>();
  const dag = new Map(flow.steps.map((step) => [step.id, [] as string[]]));
  // Iterative DFS also handles closed cycles, self loops, disconnected graphs and deep chains.
  for (const seed of seeds) {
    if (color.has(seed.id)) continue;
    const stack = [{ id: seed.id, index: 0 }];
    color.set(seed.id, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1], next = outgoing.get(frame.id)!;
      if (frame.index === next.length) { color.set(frame.id, 2); stack.pop(); continue; }
      const target = next[frame.index++];
      if (color.get(target) === 1) continue;
      dag.get(frame.id)!.push(target);
      if (!color.has(target)) { color.set(target, 1); stack.push({ id: target, index: 0 }); }
    }
  }
  const degree = new Map(flow.steps.map((step) => [step.id, 0]));
  for (const targets of dag.values()) for (const id of targets) degree.set(id, degree.get(id)! + 1);
  const queue = seeds.filter((step) => degree.get(step.id) === 0).map((step) => step.id);
  const rank = new Map(flow.steps.map((step) => [step.id, 0]));
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const target of dag.get(id)!) {
      rank.set(target, Math.max(rank.get(target)!, rank.get(id)! + 1));
      degree.set(target, degree.get(target)! - 1);
      if (!degree.get(target)) queue.push(target);
    }
  }
  const sizes = new Map(flow.steps.map((step) => {
    const { width, height } = measure(step);
    return [step.id, { width, height }] as const;
  }));
  const layers: string[][] = [];
  for (const id of queue) (layers[rank.get(id)!] ??= []).push(id);
  const mainSizes = layers.map((ids) => Math.max(...ids.map((id) => horizontal ? sizes.get(id)!.width : sizes.get(id)!.height)));
  const crossSizes = layers.map((ids) => ids.reduce((total, id) =>
    total + (horizontal ? sizes.get(id)!.height : sizes.get(id)!.width), (ids.length - 1) * 100));
  const crossSize = Math.max(...crossSizes);
  const positions = new Map<string, { x: number; y: number }>();
  const layerEnds: number[] = [];
  let main = 0;
  layers.forEach((ids, index) => {
    let cross = (crossSize - crossSizes[index]) / 2;
    for (const id of ids) {
      positions.set(id, horizontal ? { x: main, y: cross } : { x: cross, y: main });
      const size = sizes.get(id)!;
      cross += (horizontal ? size.height : size.width) + 100;
    }
    layerEnds[index] = main + mainSizes[index];
    main += mainSizes[index] + 200;
  });
  const steps = flow.steps.map((step) => ({ ...step, ...positions.get(step.id)!, ...sizes.get(step.id)!, direction }));
  const placed = new Map(steps.map((step) => [step.id, step]));
  const counts = new Map<string, number>();
  for (const link of flow.links) {
    const key = JSON.stringify([link.from, link.to]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const lanes = new Map<string, number>();
  let feedback = 0;
  const links = flow.links.map((link) => {
    const a = placed.get(link.from), b = placed.get(link.to);
    if (!a || !b) return { ...link }; // Preserve malformed references for the existing format validator.
    const key = JSON.stringify([link.from, link.to]);
    const lane = lanes.get(key) ?? -(counts.get(key)! - 1) / 2;
    lanes.set(key, lane + 1);
    const backward = rank.get(a.id)! >= rank.get(b.id)!;
    const from = horizontal ? { x: a.x + a.width, y: a.y + a.height / 2 }
      : { x: a.x + a.width / 2, y: a.y + a.height };
    const to = horizontal ? { x: b.x, y: b.y + b.height / 2 } : { x: b.x + b.width / 2, y: b.y };
    const middle = horizontal ? (from.y + to.y) / 2 : (from.x + to.x) / 2;
    const offset = backward ? crossSize + 90 + feedback++ * 70 - middle : lane * 36;
    if (link.kind === 'ORTHOGONAL') {
      const exit = layerEnds[rank.get(a.id)!] - (horizontal ? from.x : from.y);
      return { ...link, curve: undefined, route: { start: exit + 48 + Math.abs(lane) * 12,
        end: 48 + Math.abs(lane) * 12, offset } };
    }
    // Keep the existing curve kind; calculate offsets instead of changing its endpoints or meaning.
    const reach = Math.min(140, Math.max(48, Math.abs(horizontal ? to.x - from.x : to.y - from.y) / 3));
    return { ...link, route: undefined, curve: backward || lane !== 0 ? {
      start: horizontal ? { x: reach, y: offset / 0.75 } : { x: offset / 0.75, y: reach },
      end: horizontal ? { x: -reach, y: offset / 0.75 } : { x: offset / 0.75, y: -reach },
    } : undefined };
  });
  return { ...flow, steps, links };
}
