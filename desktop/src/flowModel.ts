export const stepLabels = {
  START: '시작',
  PROGRESS: '진행',
  BRANCH: '분기',
  END: '종료',
};

export type StepKind = keyof typeof stepLabels;
export type Step = {
  id: string;
  kind: StepKind;
  title: string;
  description: string;
  x: number;
  y: number;
};

export type Link = {
  id: string;
  from: string;
  to: string;
  condition: string;
};

export type FlowDocument = {
  steps: Step[];
  links: Link[];
  viewport: { x: number; y: number; zoom: number };
};
