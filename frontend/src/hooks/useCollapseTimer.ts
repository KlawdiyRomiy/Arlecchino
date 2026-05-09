import { useState, useRef, useCallback, useEffect } from "react";

export function useCollapseTimer(delay = 60_000, enabled = true) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    clear();
    setIsCollapsed(false);

    if (enabled) {
      timerRef.current = setTimeout(() => setIsCollapsed(true), delay);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [clear, delay, enabled]);

  return {
    isCollapsed: enabled ? isCollapsed : false,
    resetTimer,
    stopTimer,
  };
}
