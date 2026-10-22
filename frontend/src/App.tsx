import React, { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { AppShell } from "@/components/layout/AppShell";
import type { NavItem } from "@/components/layout/Sidebar";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { UsersPage } from "@/pages/UsersPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { HomePage } from "@/pages/HomePage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { InventoryPage } from "@/pages/InventoryPage";
import { BidsPage } from "@/pages/BidsPage";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { BusinessPage } from "@/pages/BusinessPage";
import { TasksPage } from "@/pages/TasksPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { PeoplePayrollPage } from "@/pages/PeoplePayrollPage";
import { TelemetryStream } from "@/features/dashboard/TelemetryStream";
import { SystemHealthProvider, useSystemHealth } from "@/features/dashboard/SystemHealthContext";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { ToastProvider } from "@/components/ui/Toast";

const NAV_STORAGE_KEY = "starafrica.currentTab";
const ADMIN_TABS: NavItem[] = ["dashboard", "users", "telemetry", "people"];
const ALL_TABS: NavItem[] = [
  "dashboard",
  "users",
  "telemetry",
  "people",
  "home",
  "projects",
  "inventory",
  "bids",
  "documents",
  "business",
  "tasks",
  "reports",
  "settings",
];

const AuthenticatedApp: React.FC = () => {
  const { isAuthenticated, authState, isPlatformAdmin, refreshProfile } = useAuth();
  const { refreshHealth } = useSystemHealth();
  const [currentTab, setCurrentTab] = useState<NavItem>("home");
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;

    const stored = sessionStorage.getItem(NAV_STORAGE_KEY) as NavItem | null;
    const storedIsValid =
      Boolean(stored) &&
      ALL_TABS.includes(stored as NavItem) &&
      (isPlatformAdmin || !ADMIN_TABS.includes(stored as NavItem));

    setCurrentTab(
      storedIsValid ? (stored as NavItem) : isPlatformAdmin ? "dashboard" : "home",
    );
  }, [isAuthenticated, isPlatformAdmin]);

  const selectTab = (tab: NavItem) => {
    if (!isPlatformAdmin && ADMIN_TABS.includes(tab)) return;
    sessionStorage.setItem(NAV_STORAGE_KEY, tab);
    setCurrentTab(tab);
  };

  if (authState !== "verified" || !isAuthenticated) return <LoginPage />;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.allSettled([refreshProfile(), ...(isPlatformAdmin ? [refreshHealth()] : [])]);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <AppShell currentTab={currentTab} onSelectTab={selectTab} onRefreshAll={handleRefresh} isRefreshing={isRefreshing}>
      {currentTab === "dashboard" && isPlatformAdmin && <DashboardPage />}
      {currentTab === "users" && isPlatformAdmin && <UsersPage />}
      {currentTab === "telemetry" && isPlatformAdmin && <div className="max-w-4xl"><TelemetryStream /></div>}
      {currentTab === "people" && isPlatformAdmin && <PeoplePayrollPage />}
      {currentTab === "home" && <HomePage onNavigate={selectTab} />}
      {currentTab === "projects" && <ProjectsPage />}
      {currentTab === "inventory" && <InventoryPage />}
      {currentTab === "bids" && <BidsPage onNavigate={selectTab} />}
      {currentTab === "documents" && <DocumentsPage />}
      {currentTab === "business" && <BusinessPage />}
      {currentTab === "tasks" && <TasksPage />}
      {currentTab === "reports" && <ReportsPage />}
      {currentTab === "settings" && <SettingsPage />}
    </AppShell>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <SystemHealthProvider>
            <ToastProvider><AuthenticatedApp /></ToastProvider>
          </SystemHealthProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
