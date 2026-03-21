import { useState, useRef, useCallback } from "react";

export function useCollapseTimer(delay = 60_000, enabled = true) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);
  const prevEnabledRef = useRef(enabled);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetTimer = useCallback(() => {
    clear();
    setIsCollapsed(false);

    if (!enabled) return;

    timerRef.current = setTimeout(() => setIsCollapsed(true), delay);
  }, [clear, delay, enabled]);

  const stopTimer = useCallback(() => {
    clear();
    setIsCollapsed(false);
  }, [clear]);

  if (!initializedRef.current) {
    initializedRef.current = true;
    if (enabled) {
      timerRef.current = setTimeout(() => setIsCollapsed(true), delay);
    }
  } else if (enabled !== prevEnabledRef.current) {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsCollapsed(false);
    if (enabled) {
      timerRef.current = setTimeout(() => setIsCollapsed(true), delay);
    }
  }

  prevEnabledRef.current = enabled;

  return {
    isCollapsed: enabled ? isCollapsed : false,
    resetTimer,
    stopTimer,
  };
}
