import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QuestEditor } from './QuestEditor';
import { FlowEditor } from './FlowEditor';
import { FlowPreview } from './FlowPreview';
import { errorMessage, formatDate, questTitle, request, stateLabels, useResource } from './api';
import type { BackendStatus, Option, QuestDetail, QuestSummary, WritingState } from './api';
import { useNavigationGuard } from './useCloseGuard';
import type { NavigationGuard } from './useCloseGuard';
import './style.css';

type Filters = { search: string; gameId: string; regionId: string };
const emptyFilters: Filters = { search: '', gameId: '', regionId: '' };
type Screen =
  | { kind: 'list' }
  | { kind: 'detail'; id: string }
  | { kind: 'editor'; quest?: QuestDetail }
  | { kind: 'flow'; quest: QuestDetail };
const listScreen: Screen = { kind: 'list' };
const connectionLabels = { starting: '연결 중', connected: '백엔드 연결됨', failed: '연결 실패' };

function WritingBadge({ state }: { state: WritingState }) {
  return <span className={`status ${state === 'DRAFT' ? 'draft' : 'registered'}`}>{stateLabels[state]}</span>;
}

function QuestList({ filters, setFilters, games, connected, onOpen, onAdd }: {
  filters: Filters;
  setFilters: (value: Filters) => void;
  games: ReturnType<typeof useResource<Option[]>>;
  connected: boolean;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const regions = useResource<Option[]>(connected && filters.gameId ? `/api/games/${filters.gameId}/regions` : null);
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.gameId) params.set('gameId', filters.gameId);
  if (filters.regionId) params.set('regionId', filters.regionId);
  const hasFilters = params.size > 0;
  const quests = useResource<QuestSummary[]>(connected ? `/api/quests?${params}` : null, 150);
  const empty = quests.data?.length === 0;

  return (
    <section className="panel" aria-labelledby="list-title">
      <div className="section-heading">
        <h2 id="list-title">퀘스트 목록</h2>
        {(!empty || hasFilters) && <button className="primary" disabled={!connected} onClick={onAdd}>퀘스트 추가</button>}
      </div>
      <div className="filters">
        <div>
          <label htmlFor="filter-title">퀘스트명 검색</label>
          <input id="filter-title" type="search" value={filters.search} placeholder="퀘스트명 입력"
            onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
        </div>
        <div>
          <label htmlFor="filter-game">게임</label>
          <select id="filter-game" value={filters.gameId} onChange={(event) => {
            setFilters({ ...filters, gameId: event.target.value, regionId: '' });
          }}>
            <option value="">모든 게임</option>
            {games.data?.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="filter-region">지역</label>
          <select id="filter-region" value={filters.regionId} disabled={!filters.gameId || regions.loading}
            onChange={(event) => setFilters({ ...filters, regionId: event.target.value })}>
            <option value="">{filters.gameId ? '모든 지역' : '게임 먼저 선택'}</option>
            {regions.data?.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
        </div>
        <button type="button" disabled={filters === emptyFilters} onClick={() => setFilters(emptyFilters)}>초기화</button>
      </div>
      {games.error && <LoadError message={games.error} retry={games.reload} />}
      {regions.error && <LoadError message={regions.error} retry={regions.reload} />}
      {quests.error && <LoadError message={quests.error} retry={quests.reload} />}
      {quests.loading && <p className="hint" role="status">퀘스트를 불러오고 있습니다.</p>}
      {empty && !quests.loading && (
        <div className="empty">
          <p>{hasFilters ? '검색 조건에 맞는 퀘스트가 없습니다.' : '아직 작성한 퀘스트가 없습니다.'}</p>
          {!hasFilters && <>
            <p className="hint">첫 퀘스트의 내용을 작성하거나 아이디어를 임시저장하세요.</p>
            <button className="primary" onClick={onAdd}>퀘스트 추가</button>
          </>}
        </div>
      )}
      {!!quests.data?.length && (
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">퀘스트명</th><th scope="col">게임명</th><th scope="col">지역</th>
              <th scope="col">작성 상태</th><th scope="col">최종 수정일</th></tr></thead>
            <tbody>
              {quests.data.map((quest) => (
                <tr key={quest.id} onClick={() => onOpen(quest.id)}>
                  <td><button className="text-button" onClick={(event) => { event.stopPropagation(); onOpen(quest.id); }}>
                    {questTitle(quest.title)}
                  </button></td>
                  <td>{quest.gameName ?? '—'}</td><td>{quest.regionName ?? '—'}</td>
                  <td><WritingBadge state={quest.writingState} /></td>
                  <td><time dateTime={quest.updatedAt}>{formatDate(quest.updatedAt)}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="error" role="alert">{message} <button type="button" onClick={retry}>다시 불러오기</button></div>;
}

function QuestView({ id, onBack, onEdit, onFlow, navigationGuard }: {
  id: string;
  onBack: () => void;
  onEdit: (quest: QuestDetail) => void;
  onFlow: (quest: QuestDetail) => void;
  navigationGuard: NavigationGuard;
}) {
  const quest = useResource<QuestDetail>(`/api/quests/${id}`);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const pending = useRef(false);
  useNavigationGuard(navigationGuard, pending);

  async function remove(title: string) {
    if (pending.current || !window.confirm(`‘${title}’ 퀘스트를 삭제할까요?`)) return;
    pending.current = true;
    setDeleting(true);
    setDeleteError('');
    try {
      await request<void>('DELETE', `/api/quests/${id}`);
      onBack();
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      pending.current = false;
      setDeleting(false);
    }
  }

  const detail = quest.data;
  const info = detail?.summary;
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>{info ? questTitle(info.title) : '퀘스트 상세'}</h2>
        <button type="button" disabled={deleting} onClick={onBack}>목록으로 돌아가기</button>
      </div>
      {quest.loading && <p role="status">퀘스트를 불러오고 있습니다.</p>}
      {quest.error && <LoadError message={quest.error} retry={quest.reload} />}
      {detail && info && <>
        <dl className="metadata">
          <div><dt>게임</dt><dd>{info.gameName ?? '미선택'}</dd></div>
          <div><dt>지역</dt><dd>{info.regionName ?? '미선택'}</dd></div>
          <div><dt>작성자</dt><dd>{detail.author ?? '미입력'}</dd></div>
          <div><dt>작성 상태</dt><dd><WritingBadge state={info.writingState} /></dd></div>
          <div><dt>작성일</dt><dd><time dateTime={detail.createdAt}>{formatDate(detail.createdAt)}</time></dd></div>
          <div><dt>최종 수정일</dt><dd><time dateTime={info.updatedAt}>{formatDate(info.updatedAt)}</time></dd></div>
        </dl>
        <h3>퀘스트 원문</h3>
        <div className="quest-body">{detail.body?.trim() ? detail.body : '입력한 원문이 없습니다.'}</div>
        <FlowPreview questId={id} gameName={info.gameName ?? '게임 미선택'} title={questTitle(info.title)}
          onEdit={() => onFlow(detail)} disabled={deleting} />
        <div className="actions">
          <button type="button" className="primary" disabled={deleting} onClick={() => onEdit(detail)}>수정</button>
          <button type="button" className="danger" disabled={deleting} onClick={() => void remove(questTitle(info.title))}>
            {deleting ? '삭제 중…' : '삭제'}
          </button>
        </div>
      </>}
      {deleteError && <p className="error" role="alert">{deleteError}</p>}
    </section>
  );
}

function App() {
  const [backend, setBackend] = useState<BackendStatus>({
    state: 'starting',
    message: '백엔드를 시작하고 있습니다.',
  });
  const [screen, setScreen] = useState<Screen>(listScreen);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const navigationGuard = useRef<(() => boolean) | null>(null);
  const games = useResource<Option[]>(backend.state === 'starting' ? null : '/api/games');

  useEffect(() => window.questWeaver.onBackendStatus(setBackend), []);

  const backToList = () => setScreen(listScreen);
  const openQuest = (id: string) => setScreen({ kind: 'detail', id });

  function goToList() {
    if (screen.kind === 'list' || navigationGuard.current?.() === false) return;
    backToList();
  }

  return (
    <main className={screen.kind === 'flow' ? 'flow-main' : undefined}>
      <header className="app-header">
        <h1><button type="button" className="app-logo" onClick={goToList}
          aria-label="QuestWeaver 퀘스트 목록">QuestWeaver</button></h1>
        <span className={`status connection ${backend.state}`} role="status" title={backend.message}>
          {connectionLabels[backend.state]}
        </span>
      </header>
      {backend.state === 'failed' && <p className="error" role="alert">{backend.message}</p>}
      {screen.kind === 'list' && <QuestList filters={filters} setFilters={setFilters} games={games}
        connected={backend.state === 'connected'} onOpen={openQuest}
        onAdd={() => setScreen({ kind: 'editor' })} />}
      {screen.kind === 'detail' && <QuestView key={screen.id} id={screen.id} onBack={backToList} navigationGuard={navigationGuard}
        onEdit={(quest) => setScreen({ kind: 'editor', quest })}
        onFlow={(quest) => setScreen({ kind: 'flow', quest })} />}
      {screen.kind === 'editor' && <QuestEditor initial={screen.quest} games={games.data ?? []} navigationGuard={navigationGuard}
        gamesError={games.error} reloadGames={games.reload} onSaved={openQuest}
        onBack={() => screen.quest ? openQuest(screen.quest.summary.id) : backToList()} />}
      {screen.kind === 'flow' && <FlowEditor quest={screen.quest} navigationGuard={navigationGuard}
        onBack={() => openQuest(screen.quest.summary.id)} />}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
