export const stepLabels = {
  START: '시작',
  PROGRESS: '진행',
  BRANCH: '분기',
  END: '종료',
};

export type StepKind = keyof typeof stepLabels;
export const directionLabels = { HORIZONTAL: '좌우형', VERTICAL: '상하형' };
export type Direction = keyof typeof directionLabels;
export type CurveOffsets = { start: { x: number; y: number }; end: { x: number; y: number } };
export type Step = {
  id: string;
  kind: StepKind;
  title: string;
  description: string;
  x: number;
  y: number;
  direction?: Direction;
  width?: number;
  height?: number;
};

export type Link = {
  id: string;
  from: string;
  to: string;
  condition: string;
  curve?: CurveOffsets;
};

export type FlowDocument = {
  steps: Step[];
  links: Link[];
  viewport: { x: number; y: number; zoom: number };
};
