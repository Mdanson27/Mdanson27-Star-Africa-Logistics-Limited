import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

interface SyncStatusProps {
  isRefreshing: boolean;
  error?: string | null;
  lastSyncedAt?: string | null;
}

function syncLabel(value: string | null | undefined): string {
  if (!value) return "Not synced yet";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 10) return "Synced just now";
  if (seconds < 60) return `Synced ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Synced ${hours}h ago`;
}

export const SyncStatus: React.FC<SyncStatusProps> = ({
  isRefreshing,
  error,
  lastSyncedAt,
}) => {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => forceTick((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  if (error) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400" title={error}>
        <AlertTriangle className="h-3.5 w-3.5" />
        Couldn't refresh — showing last synced data
      </div>
    );
  }

  if (isRefreshing) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        Updating…
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-3.5 w-3.5" />
      {syncLabel(lastSyncedAt)}
    </div>
  );
};
