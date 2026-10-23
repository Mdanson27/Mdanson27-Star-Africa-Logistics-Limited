import React, { useEffect, useMemo, useState } from "react";
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

interface PersistentPanelProps {
  id: NavItem;
  currentTab: NavItem;
  children: React.ReactNode;
}

const PersistentPanel: React.FC<PersistentPanelProps> = ({ id, currentTab, children }) => (
  <section
    className={currentTab === id ? "block" : "hidden"}
    aria-hidden={currentTab !== id}
    data-workspace-section={id}
  >
    {children}
  </section>
);

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
      window.dispatchEvent(new CustomEvent("starafrica:refresh-sections"));
    } finally {
      setIsRefreshing(false);
    }
  };

  const panels = useMemo(
    () => [
      ...(isPlatformAdmin
        ? [
            { id: "dashboard" as NavItem, node: <DashboardPage /> },
            { id: "users" as NavItem, node: <UsersPage /> },
            { id: "telemetry" as NavItem, node: <div className="max-w-4xl"><TelemetryStream /></div> },
            { id: "people" as NavItem, node: <PeoplePayrollPage /> },
          ]
        : []),
      { id: "home" as NavItem, node: <HomePage onNavigate={selectTab} /> },
      { id: "projects" as NavItem, node: <ProjectsPage /> },
      { id: "inventory" as NavItem, node: <InventoryPage /> },
      { id: "bids" as NavItem, node: <BidsPage onNavigate={selectTab} /> },
      { id: "documents" as NavItem, node: <DocumentsPage /> },
      { id: "business" as NavItem, node: <BusinessPage /> },
      { id: "tasks" as NavItem, node: <TasksPage /> },
      { id: "reports" as NavItem, node: <ReportsPage /> },
      { id: "settings" as NavItem, node: <SettingsPage /> },
    ],
    [isPlatformAdmin],
  );

  const orderedPanels = useMemo(
    () => [...panels].sort((left, right) => {
      if (left.id === currentTab) return -1;
      if (right.id === currentTab) return 1;
      return 0;
    }),
    [currentTab, panels],
  );

  return (
    <AppShell
      currentTab={currentTab}
      onSelectTab={selectTab}
      onRefreshAll={handleRefresh}
      isRefreshing={isRefreshing}
    >
      {orderedPanels.map((panel) => (
        <PersistentPanel key={panel.id} id={panel.id} currentTab={currentTab}>
          {panel.node}
        </PersistentPanel>
      ))}
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
