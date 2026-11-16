import { useCallback, useLayoutEffect } from 'react';
import type { RefObject } from 'react';

export type NavigationGuard = RefObject<(() => boolean) | null>;

export function useNavigationGuard(guard: NavigationGuard, busy: RefObject<boolean>, message?: string) {
  const canLeave = useCallback(() => !busy.current && (!message || window.confirm(message)), [busy, message]);
  useLayoutEffect(() => {
    guard.current = canLeave;
    return () => { guard.current = null; };
  }, [guard, canLeave]);
  return canLeave;
}

export function useCloseGuard(guarded: boolean) {
  useLayoutEffect(() => {
    if (!guarded) return;
    function preventExit(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = true;
    }
    window.questWeaver.setCloseGuard(true);
    window.addEventListener('beforeunload', preventExit);
    return () => {
      window.removeEventListener('beforeunload', preventExit);
      window.questWeaver.setCloseGuard(false);
    };
  }, [guarded]);
}
