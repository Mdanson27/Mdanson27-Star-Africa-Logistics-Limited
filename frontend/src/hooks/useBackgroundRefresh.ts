import { useEffect, useRef } from "react";

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const FOCUS_REFRESH_MIN_AGE_MS = 60_000;
const REFRESH_ALL_EVENT = "starafrica:refresh-sections";

let globalRefreshQueue: Promise<void> = Promise.resolve();

function enqueueRefresh(task: () => Promise<void>): Promise<void> {
  const scheduled = globalRefreshQueue.then(task, task);
  globalRefreshQueue = scheduled.catch(() => undefined);
  return scheduled;
}

export function useBackgroundRefresh(
  refresh: () => void | Promise<void>,
  intervalMs = DEFAULT_INTERVAL_MS,
): void {
  const runningRef = useRef(false);
  const lastRunRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    const run = async (force = false) => {
      if (disposed || runningRef.current || !navigator.onLine) return;
      const now = Date.now();
      if (!force && now - lastRunRef.current < FOCUS_REFRESH_MIN_AGE_MS) return;

      runningRef.current = true;
      lastRunRef.current = now;

      try {
        await enqueueRefresh(async () => {
          if (disposed || !navigator.onLine) return;
          await refresh();
        });
      } finally {
        runningRef.current = false;
      }
    };

    void run(true);

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void run(false);
    };

    const forceRefresh = () => {
      if (document.visibilityState === "visible") void run(true);
    };

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void run(true);
    }, intervalMs);

    window.addEventListener("focus", refreshIfVisible);
    window.addEventListener("online", refreshIfVisible);
    window.addEventListener(REFRESH_ALL_EVENT, forceRefresh);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      window.removeEventListener("online", refreshIfVisible);
      window.removeEventListener(REFRESH_ALL_EVENT, forceRefresh);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [intervalMs, refresh]);
}
