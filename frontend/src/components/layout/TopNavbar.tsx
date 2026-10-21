import React from "react";
import { Menu, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSystemHealth } from "@/features/dashboard/SystemHealthContext";
import { useAuth } from "@/hooks/useAuth";
import { brand } from "@/config/brand";

interface TopNavbarProps {
  onToggleSidebar: () => void;
  onRefreshAll?: () => void;
  isRefreshing?: boolean;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({ onToggleSidebar, onRefreshAll, isRefreshing = false }) => {
  const { clusterHealthy, isChecking } = useSystemHealth();
  const { isPlatformAdmin } = useAuth();
  const refreshing = isRefreshing || (isPlatformAdmin && isChecking);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/95 px-6 backdrop-blur">
      <Button variant="ghost" size="sm" onClick={onToggleSidebar} className="h-9 w-9 p-0 text-muted-foreground">
        <Menu className="h-5 w-5" />
      </Button>
      <div className="flex items-center gap-3">
        {isPlatformAdmin ? (
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs">
            <span className={`h-2 w-2 rounded-full ${clusterHealthy === true ? "bg-emerald-500" : clusterHealthy === false ? "bg-destructive" : "bg-muted-foreground"}`} />
            <span className="text-muted-foreground">{clusterHealthy === true ? "Cluster Healthy" : clusterHealthy === false ? "Service Degraded" : "Checking..."}</span>
          </div>
        ) : (
          <div className="hidden sm:block rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">{brand.productName}</div>
        )}
        {onRefreshAll && (
          <Button variant="outline" size="sm" onClick={onRefreshAll} disabled={refreshing} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        )}
      </div>
    </header>
  );
};
