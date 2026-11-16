import { useLayoutEffect } from 'react';

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
