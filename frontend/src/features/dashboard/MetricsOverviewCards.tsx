import React from "react";
import { Activity, Database, KeyRound, ServerCog } from "lucide-react";
import { Card } from "@/components/ui/Card";

interface MetricsProps {
  apiStatus: string;
  authHealthy: boolean;
  databaseHealthy: boolean | null;
  cacheHealthy: boolean | null;
  migrationsHealthy: boolean | null;
}

function label(value: boolean | null, yes: string, no: string): string {
  if (value === null) return "Checking";
  return value ? yes : no;
}

function tone(healthy: boolean | null): string {
  if (healthy === null) return "text-muted-foreground bg-muted border-border";
  return healthy
    ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
    : "text-destructive bg-destructive/10 border-destructive/20";
}

function iconTone(healthy: boolean | null): string {
  if (healthy === null) return "text-muted-foreground";
  return healthy ? "text-emerald-500" : "text-destructive";
}

export const MetricsOverviewCards: React.FC<MetricsProps> = ({
  apiStatus,
  authHealthy,
  databaseHealthy,
  cacheHealthy,
  migrationsHealthy,
}) => {
  const apiHealthy = apiStatus === "ONLINE" ? true : apiStatus === "CHECKING" ? null : false;

  const cards = [
    {
      title: "Backend API",
      value: apiStatus,
      subtitle: "Litestar / Granian",
      icon: <Activity className={`h-5 w-5 ${iconTone(apiHealthy)}`} />,
      badge: label(apiHealthy, "Healthy", "Needs attention"),
      badgeColor: tone(apiHealthy),
    },
    {
      title: "Database",
      value: label(databaseHealthy, "Connected", "Unavailable"),
      subtitle: migrationsHealthy ? "Neon Postgres · schema current" : "Neon Postgres · schema check",
      icon: <Database className={`h-5 w-5 ${iconTone(databaseHealthy)}`} />,
      badge: label(databaseHealthy, "Healthy", "Needs attention"),
      badgeColor: tone(databaseHealthy),
    },
    {
      title: "Authentication",
      value: authHealthy ? "Signed in" : "Signed out",
      subtitle: "Neon Better Auth",
      icon: <KeyRound className={`h-5 w-5 ${authHealthy ? "text-emerald-500" : "text-destructive"}`} />,
      badge: authHealthy ? "Healthy" : "Needs attention",
      badgeColor: tone(authHealthy),
    },
    {
      title: "Task Queue",
      value: label(cacheHealthy, "Connected", "Unavailable"),
      subtitle: "SAQ + Valkey",
      icon: <ServerCog className={`h-5 w-5 ${iconTone(cacheHealthy)}`} />,
      badge: label(cacheHealthy, "Healthy", "Needs attention"),
      badgeColor: tone(cacheHealthy),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title} className="flex flex-col justify-between hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-muted-foreground">{card.title}</span>
            <div className="rounded-lg bg-accent p-2">{card.icon}</div>
          </div>
          <div className="space-y-1">
            <div className="text-xl font-bold tracking-tight text-card-foreground">{card.value}</div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{card.subtitle}</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${card.badgeColor}`}>
                {card.badge}
              </span>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};
