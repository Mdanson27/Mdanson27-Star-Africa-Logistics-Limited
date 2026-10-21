import React from "react";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useSystemHealth } from "@/features/dashboard/SystemHealthContext";

export const SystemHealthCard: React.FC = () => {
  const {
    api,
    database,
    valkey,
    migrations,
    isChecking,
    lastCheckedAt,
    refreshHealth,
  } = useSystemHealth();

  const healths = [api, database, valkey, migrations];

  return (
    <Card className="h-full flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div>
            <CardTitle>System & Subsystem Health</CardTitle>
            <CardDescription>
              Live dependency probes
              {lastCheckedAt ? ` · checked ${lastCheckedAt.toLocaleTimeString()}` : ""}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refreshHealth()}
            disabled={isChecking}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isChecking ? "animate-spin text-primary" : ""}`} />
            Run Probe
          </Button>
        </div>

        <div className="mt-4 space-y-3">
          {healths.map((sub) => (
            <div
              key={sub.name}
              className="flex items-center justify-between rounded-lg bg-accent/40 p-3 border border-border"
            >
              <div className="flex items-center gap-3">
                {sub.status === "healthy" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                ) : sub.status === "loading" ? (
                  <RefreshCw className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                )}
                <div>
                  <div className="text-xs font-medium text-foreground">{sub.name}</div>
                  <div className="text-[10px] text-muted-foreground">{sub.details}</div>
                </div>
              </div>

              {sub.latencyMs !== undefined && (
                <span className="text-[11px] font-mono text-muted-foreground">{sub.latencyMs} ms</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-lg bg-primary/10 border border-primary/20 p-3 text-[11px] text-primary">
        Live probes: /health, /health/ready and /health/startup.
      </div>
    </Card>
  );
};
