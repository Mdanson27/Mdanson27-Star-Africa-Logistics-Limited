import React, { useState } from "react";
import { Sidebar, type NavItem } from "@/components/layout/Sidebar";
import { TopNavbar } from "@/components/layout/TopNavbar";
import { Footer } from "@/components/common/Footer";
import { cn } from "@/lib/utils";

interface AppShellProps {
  currentTab: NavItem;
  onSelectTab: (tab: NavItem) => void;
  children: React.ReactNode;
  onRefreshAll?: () => void;
  isRefreshing?: boolean;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentTab,
  onSelectTab,
  children,
  onRefreshAll,
  isRefreshing,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);

  return (
    <div className="app-scrollbarless flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <Sidebar
          currentTab={currentTab}
          onSelectTab={onSelectTab}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((prev) => !prev)}
        />

        <div
          className={cn(
            "flex h-full min-w-0 flex-1 flex-col overflow-hidden transition-all duration-200",
            sidebarOpen ? "pl-64" : "pl-20"
          )}
        >
          <TopNavbar
            onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
            onRefreshAll={onRefreshAll}
            isRefreshing={isRefreshing}
          />
          <main className="scrollbar-none min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-6 md:p-8">{children}</main>
          <Footer />
        </div>
      </div>
    </div>
  );
};
