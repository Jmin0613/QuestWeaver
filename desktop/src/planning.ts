export type QuestPlanning = {
  code: string;
  chapter: string;
  prerequisites: string;
  optional: boolean;
  rewards: string;
  background: string;
};

export const actionLabels = {
  UNSPECIFIED: '미지정', MOVE: '이동', DIALOGUE: '대화', COMBAT: '전투',
  INTERACTION: '상호작용', CUTSCENE: '컷신', OTHER: '기타',
};
export type StepPlanning = {
  actionType: keyof typeof actionLabels;
  target: string;
  location: string;
  startCondition: string;
  completionCondition: string;
  stateChanges: string;
  rewards: string;
  notes: string;
};

export function questPlanning(value?: Partial<QuestPlanning> | null): QuestPlanning {
  return { code: '', chapter: '', prerequisites: '', optional: false, rewards: '', background: '', ...value };
}

export function stepPlanning(value?: Partial<StepPlanning> | null): StepPlanning {
  return { actionType: 'UNSPECIFIED', target: '', location: '', startCondition: '', completionCondition: '',
    stateChanges: '', rewards: '', notes: '', ...value };
}

export function planningPatch(value: QuestPlanning, baseline: QuestPlanning): Partial<QuestPlanning> {
  return Object.fromEntries(Object.entries(value).filter(([key, field]) => field !== baseline[key as keyof QuestPlanning]));
}
