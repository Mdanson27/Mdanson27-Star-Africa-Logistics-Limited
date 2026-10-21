import { useEffect } from "react";

export function useBackgroundRefresh(
  refresh: () => void | Promise<void>,
  intervalMs = 30_000,
): void {
  useEffect(() => {
    void refresh();

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    const interval = window.setInterval(refreshIfVisible, intervalMs);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [intervalMs, refresh]);
}
