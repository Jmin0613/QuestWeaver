import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type BackendStatus = {
  state: 'starting' | 'connected' | 'failed';
  message: string;
};

declare global {
  interface Window {
    questWeaver: {
      onBackendStatus(callback: (status: BackendStatus) => void): () => void;
    };
  }
}

const statusLabels = {
  starting: '시작 중',
  connected: '연결 성공',
  failed: '연결 실패',
};

function App() {
  const [backend, setBackend] = useState<BackendStatus>({
    state: 'starting',
    message: '백엔드를 시작하고 있습니다.',
  });

  useEffect(() => window.questWeaver.onBackendStatus(setBackend), []);

  return (
    <main>
      <header>
        <h1>QuestWeaver</h1>
        <p>퀘스트를 구조화하고 흐름을 설계하세요.</p>
      </header>

      <section className="connection" aria-labelledby="backend-title">
        <h2 id="backend-title">백엔드 연결 상태</h2>
        <div role="status">
          <strong className={`status ${backend.state}`}>{statusLabels[backend.state]}</strong>
          <span>{backend.message}</span>
        </div>
      </section>

      <section className="quests" aria-labelledby="quests-title">
        <h2 id="quests-title">퀘스트 목록</h2>
        <p>퀘스트 목록은 추후 제공됩니다.</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
