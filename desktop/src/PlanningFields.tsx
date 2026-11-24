import { actionLabels } from './planning';
import type { QuestPlanning, StepPlanning } from './planning';

const questFields = [
  { key: 'code', label: '기획용 퀘스트 코드', max: 120, single: true },
  { key: 'chapter', label: '챕터 / 그룹', max: 200, single: true },
  { key: 'prerequisites', label: '선행 퀘스트 / 시작 조건' },
  { key: 'rewards', label: '퀘스트 완료 보상' },
  { key: 'background', label: '기획 의도 / 배경' },
] as const;
const stepFields = [
  { key: 'target', label: '목표 대상', group: 'basic', placeholder: 'NPC, 적, 오브젝트 이름 또는 기획용 식별자' },
  { key: 'location', label: '장소', group: 'basic', placeholder: '' },
  { key: 'startCondition', label: '시작 조건', group: 'conditions', placeholder: '' },
  { key: 'completionCondition', label: '완료 조건', group: 'conditions', placeholder: '흑아의 체력이 0이 되면 완료' },
  { key: 'stateChanges', label: '완료 시 상태·변수 변경', group: 'conditions', placeholder: '흑아전 완료 = true' },
  { key: 'rewards', label: '단계 보상', group: 'conditions', placeholder: '' },
  { key: 'notes', label: '기획 메모', group: 'notes', placeholder: '재도전 시 컷신을 생략하고 첫 전투 진입 상태로 복원' },
] as const;

export function QuestPlanningFields({ value, onChange }: {
  value: QuestPlanning; onChange: (value: QuestPlanning) => void;
}) {
  return <div className="planning-fields">
    {questFields.map((field) => {
      const id = 'quest-plan-' + field.key;
      return <div key={field.key}>
        <label htmlFor={id}>{field.label}</label>
        {'single' in field
          ? <input id={id} maxLength={field.max} value={value[field.key]}
            onChange={(event) => onChange({ ...value, [field.key]: event.target.value })} />
          : <textarea id={id} rows={3} value={value[field.key]}
            onChange={(event) => onChange({ ...value, [field.key]: event.target.value })} />}
      </div>;
    })}
    <label className="planning-checkbox"><input id="quest-plan-optional" type="checkbox" checked={value.optional}
      onChange={(event) => onChange({ ...value, optional: event.target.checked })} />선택 퀘스트</label>
  </div>;
}

export function StepPlanningFields({ value, onChange, group }: {
  value: StepPlanning; onChange: (value: StepPlanning) => void; group: 'basic' | 'conditions' | 'notes';
}) {
  return <>
    {group === 'basic' && <>
      <label htmlFor="step-plan-actionType">행동 유형</label>
      <select id="step-plan-actionType" value={value.actionType}
        onChange={(event) => onChange({ ...value, actionType: event.target.value as StepPlanning['actionType'] })}>
        {Object.entries(actionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </>}
    {stepFields.filter((field) => field.group === group).map((field) => <div key={field.key}>
      <label htmlFor={'step-plan-' + field.key}>{field.label}</label>
      <textarea id={'step-plan-' + field.key} rows={group === 'basic' ? 2 : 3}
        value={value[field.key]} placeholder={field.placeholder}
        onChange={(event) => onChange({ ...value, [field.key]: event.target.value })} />
    </div>)}
  </>;
}

function ReadPlanning({ entries }: { entries: [string, string][] }) {
  const visible = entries.filter(([, value]) => value.trim());
  if (!visible.length) return null;
  return <dl className="planning-details">{visible.map(([label, value]) =>
    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function QuestPlanningDetails({ value }: { value: QuestPlanning }) {
  return <ReadPlanning entries={[
    ...questFields.map((field): [string, string] => [field.label, value[field.key]]),
    ['선택 퀘스트', value.optional ? '예' : ''],
  ]} />;
}

export function StepPlanningDetails({ value }: { value: StepPlanning }) {
  return <ReadPlanning entries={[
    ['행동 유형', value.actionType === 'UNSPECIFIED' ? '' : actionLabels[value.actionType]],
    ...stepFields.map((field): [string, string] => [field.label, value[field.key]]),
  ]} />;
}
