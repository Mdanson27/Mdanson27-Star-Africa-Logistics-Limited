import React from "react";
import { MetricsOverviewCards } from "@/features/dashboard/MetricsOverviewCards";
import { SystemHealthCard } from "@/features/dashboard/SystemHealthCard";
import { TelemetryStream } from "@/features/dashboard/TelemetryStream";
import { useSystemHealth } from "@/features/dashboard/SystemHealthContext";
import { useAuth } from "@/hooks/useAuth";

export const DashboardPage: React.FC = () => {
  const { user, isAuthenticated } = useAuth();
  const { api, database, valkey, migrations } = useSystemHealth();

  const apiStatus =
    api.status === "healthy" ? "ONLINE" : api.status === "loading" ? "CHECKING" : "OFFLINE";

  const databaseHealthy =
    database.status === "loading" ? null : database.status === "healthy";
  const cacheHealthy =
    valkey.status === "loading" ? null : valkey.status === "healthy";
  const migrationsHealthy =
    migrations.status === "loading" ? null : migrations.status === "healthy";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground truncate max-w-lg">
          Hi, {user?.full_name || user?.email} 👋
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Star Africa Logistics operating system overview.
        </p>
      </div>

      <MetricsOverviewCards
        apiStatus={apiStatus}
        authHealthy={isAuthenticated}
        databaseHealthy={databaseHealthy}
        cacheHealthy={cacheHealthy}
        migrationsHealthy={migrationsHealthy}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SystemHealthCard />
        <TelemetryStream />
      </div>
    </div>
  );
};

export default DashboardPage;
