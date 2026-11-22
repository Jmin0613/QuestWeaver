import type { FlowDocument } from './flowModel';

export type FlowGraph = Pick<FlowDocument, 'steps' | 'links'>;

/** A session stores domain snapshots, excluding selection and the viewport. */
export class FlowHistory {
  private past: FlowGraph[] = [];
  private future: FlowGraph[] = [];
  private group: number | undefined;
  private signature: string;
  private present: FlowGraph;

  constructor(present: FlowGraph) {
    this.present = present;
    this.signature = JSON.stringify(present);
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  record(graph: FlowGraph, group: number): boolean {
    const signature = JSON.stringify(graph);
    if (signature === this.signature) return false;
    if (this.group !== group) this.past.push(this.present);
    this.present = graph;
    this.signature = signature;
    this.group = group;
    this.future = [];
    if (JSON.stringify(this.past.at(-1)) === signature) {
      this.past.pop();
      this.group = undefined;
    }
    return true;
  }

  undo(): FlowGraph | undefined {
    const graph = this.past.pop();
    if (!graph) return;
    this.future.push(this.present);
    return this.restore(graph);
  }

  redo(): FlowGraph | undefined {
    const graph = this.future.pop();
    if (!graph) return;
    this.past.push(this.present);
    return this.restore(graph);
  }

  private restore(graph: FlowGraph): FlowGraph {
    this.present = graph;
    this.signature = JSON.stringify(graph);
    this.group = undefined;
    return graph;
  }
}
