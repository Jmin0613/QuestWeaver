import { useCallback, useEffect, useState } from 'react';
import type { QuestPlanning } from './planning';

export type BackendStatus = {
  state: 'starting' | 'connected' | 'failed';
  message: string;
};

export type AiSettingsStatus = { source: 'none' | 'session' | 'stored' | 'environment'; configured: boolean; model: string; secureStorageAvailable: boolean; warning: string };

type Reply = { ok: true; data?: unknown } | { ok: false; message: string };
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

declare global {
  interface Window {
    questWeaver: {
      aiStatus(): Promise<Reply>;
      saveAiKey(value: string, store: boolean): Promise<Reply>;
      deleteAiKey(): Promise<Reply>;
      openAiKeyPage(): Promise<boolean>;
      request(method: Method, route: string, body?: object): Promise<Reply>;
      saveFlowPng(title: string, bytes: Uint8Array): Promise<
        { status: 'saved' | 'canceled' } | { status: 'error'; message: string }
      >;
      setCloseGuard(guarded: boolean): void;
      onBackendStatus(callback: (status: BackendStatus) => void): () => void;
    };
  }
}

export type Option = { id: number; name: string };
export type WritingState = 'DRAFT' | 'REGISTERED';
export type QuestSummary = {
  id: string;
  gameId: number | null;
  gameName: string | null;
  regionId: number | null;
  regionName: string | null;
  title: string | null;
  writingState: WritingState;
  updatedAt: string;
};
export type QuestDetail = {
  summary: QuestSummary;
  author: string | null;
  body: string | null;
  createdAt: string;
  planning?: QuestPlanning;
};
export type QuestFields = {
  gameId: number | null;
  regionId: number | null;
  title: string;
  author: string;
  body: string;
  planning: QuestPlanning;
};

export const stateLabels: Record<WritingState, string> = {
  DRAFT: '임시저장',
  REGISTERED: '등록',
};
export const questTitle = (title: string | null) => title || '제목 없는 퀘스트';

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
export const formatDate = (value: string) => dateFormatter.format(new Date(value));

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다. 다시 시도하세요.';
}

export async function request<T>(method: Method, route: string, body?: object): Promise<T> {
  const reply = await window.questWeaver.request(method, route, body).catch(() => {
    throw new Error('앱에서 백엔드 요청을 전달하지 못했습니다.');
  });
  if (!reply.ok) throw new Error(reply.message);
  return reply.data as T;
}

export function useResource<T>(route: string | null, delay = 0) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ route: string; revision: number; data?: T; error?: string }>();
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (route === null) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void request<T>('GET', route).then(
        (data) => { if (active) setResult({ route, revision, data }); },
        (error) => { if (active) setResult({ route, revision, error: errorMessage(error) }); },
      );
    }, delay);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [route, revision, delay]);

  const current = result?.route === route ? result : undefined;
  return {
    data: current?.data,
    error: current?.revision === revision ? current.error : undefined,
    loading: route !== null && current?.revision !== revision,
    reload,
  };
}
