import { useRef, useState } from 'react';
import { errorMessage, request, useResource } from './api';
import type { Option, QuestDetail, QuestFields, WritingState } from './api';
import { useCloseGuard, useNavigationGuard } from './useCloseGuard';
import type { NavigationGuard } from './useCloseGuard';

type Props = {
  initial?: QuestDetail;
  games: Option[];
  gamesError?: string;
  reloadGames: () => void;
  onBack: () => void;
  navigationGuard: NavigationGuard;
  onSaved: (id: string) => void;
};

function fieldsFrom(quest?: QuestDetail): QuestFields {
  return {
    gameId: quest?.summary.gameId ?? null,
    regionId: quest?.summary.regionId ?? null,
    title: quest?.summary.title ?? '',
    author: quest?.author ?? '',
    body: quest?.body ?? '',
  };
}

export function QuestEditor({ initial, games, gamesError, reloadGames, onBack, onSaved, navigationGuard }: Props) {
  const [id] = useState(() => initial?.summary.id ?? crypto.randomUUID());
  const isRegistered = initial?.summary.writingState === 'REGISTERED';
  const [baseline, setBaseline] = useState(() => fieldsFrom(initial));
  const [fields, setFields] = useState(baseline);
  const [add, setAdd] = useState<'game' | 'region' | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const regionRoute = fields.gameId === null ? null : `/api/games/${fields.gameId}/regions`;
  const regions = useResource<Option[]>(regionRoute);
  const dirty = name !== '' || (Object.keys(fields) as (keyof QuestFields)[])
    .some((key) => fields[key] !== baseline[key]);
  useCloseGuard(dirty || busy);
  const canLeave = useNavigationGuard(navigationGuard, running,
    dirty ? '저장하지 않은 변경이 있습니다. 작성 화면을 나갈까요?' : undefined);

  function change(update: Partial<QuestFields>) {
    setFields((previous) => ({ ...previous, ...update }));
    setError('');
    setNotice('');
  }

  function back() {
    if (canLeave()) onBack();
  }

  async function submit(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function save(writingState: WritingState) {
    void submit(async () => {
      if (writingState === 'REGISTERED' && (!fields.gameId || !fields.title.trim() || !fields.body.trim())) {
        throw new Error('등록하려면 게임, 퀘스트명, 퀘스트 원문을 입력하세요.');
      }
      const saved = await request<QuestDetail>('PUT', `/api/quests/${id}`, { ...fields, writingState });
      if (writingState === 'REGISTERED') {
        onSaved(id);
        return;
      }
      const savedFields = fieldsFrom(saved);
      setFields(savedFields);
      setBaseline(savedFields);
      setNotice('임시저장했습니다.');
    });
  }

  function chooseGame(value: number | null) {
    setAdd(null);
    setName('');
    change({ gameId: value, regionId: null });
  }

  function addOption() {
    if (!add) return;
    const route = add === 'game' ? '/api/games' : regionRoute;
    if (!route) return;
    void submit(async () => {
      if (!name.trim()) throw new Error('이름을 입력하세요.');
      const option = await request<Option>('POST', route, { name });
      if (add === 'game') {
        reloadGames();
        chooseGame(option.id);
      } else {
        regions.reload();
        change({ regionId: option.id });
      }
      setName('');
      setAdd(null);
    });
  }

  function toggleAdd(kind: 'game' | 'region') {
    setAdd(add === kind ? null : kind);
    setName('');
    setError('');
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>{initial ? '퀘스트 수정' : '퀘스트 작성'}</h2>
        <button type="button" onClick={back} disabled={busy}>{initial ? '상세로 돌아가기' : '목록으로 돌아가기'}</button>
      </div>
      <p className="hint">등록할 때는 게임, 퀘스트명, 퀘스트 원문이 필요합니다.</p>
      <form onSubmit={(event) => { event.preventDefault(); save('REGISTERED'); }}>
        <fieldset disabled={busy}>
          <div className="form-grid">
            <div>
              <label htmlFor="quest-game">게임</label>
              <div className="field-row">
                <select id="quest-game" value={fields.gameId ?? ''} onChange={(event) => {
                  chooseGame(event.target.value ? Number(event.target.value) : null);
                }}>
                  <option value="">게임 선택</option>
                  {games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
                </select>
                <button type="button" aria-expanded={add === 'game'} onClick={() => toggleAdd('game')}>게임 추가</button>
              </div>
              {gamesError && <p className="field-error" role="alert">{gamesError} <button type="button" onClick={reloadGames}>다시 불러오기</button></p>}
            </div>
            <div>
              <label htmlFor="quest-region">지역 <span className="optional">선택</span></label>
              <div className="field-row">
                <select id="quest-region" value={fields.regionId ?? ''} disabled={fields.gameId === null || regions.loading}
                  onChange={(event) => change({ regionId: event.target.value ? Number(event.target.value) : null })}>
                  <option value="">{fields.gameId === null ? '게임을 먼저 선택하세요' : '지역 선택 안 함'}</option>
                  {regions.data?.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
                </select>
                <button type="button" disabled={fields.gameId === null} aria-expanded={add === 'region'}
                  onClick={() => toggleAdd('region')}>지역 추가</button>
              </div>
              {regions.error && <p className="field-error" role="alert">{regions.error} <button type="button" onClick={regions.reload}>다시 불러오기</button></p>}
            </div>
          </div>

          {add && (
            <div className="inline-add">
              <label htmlFor="option-name">새 {add === 'game' ? '게임' : '지역'} 이름</label>
              <div className="field-row">
                <input id="option-name" autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addOption(); }
                  }} />
                <button type="button" onClick={addOption}>추가</button>
                <button type="button" onClick={() => toggleAdd(add)}>취소</button>
              </div>
            </div>
          )}

          <div className="form-grid text-fields">
            <div>
              <label htmlFor="quest-title">퀘스트명</label>
              <input id="quest-title" maxLength={200} value={fields.title} onChange={(event) => change({ title: event.target.value })} />
            </div>
            <div>
              <label htmlFor="quest-author">작성자 <span className="optional">선택</span></label>
              <input id="quest-author" maxLength={120} value={fields.author} onChange={(event) => change({ author: event.target.value })} />
            </div>
          </div>
          <label htmlFor="quest-body">퀘스트 원문</label>
          <textarea id="quest-body" rows={8} value={fields.body} onChange={(event) => change({ body: event.target.value })} />
          <div className="actions">
            <button className="primary" type="submit" disabled={name !== ''}>{isRegistered ? '저장' : '등록'}</button>
            {!isRegistered && <button type="button" disabled={name !== ''} onClick={() => save('DRAFT')}>임시저장</button>}
          </div>
        </fieldset>
      </form>
      {busy && <p role="status">저장 중…</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
