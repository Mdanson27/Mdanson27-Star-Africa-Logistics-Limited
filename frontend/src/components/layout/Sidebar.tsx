import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  ChevronsUpDown,
  FileCode2,
  Files,
  FolderKanban,
  Home,
  ListTodo,
  Gavel,
  Boxes,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Logo } from "@/components/common/Logo";
import { SidebarAppearance } from "@/components/common/Appearance";
import { brand } from "@/config/brand";

export type NavItem =
  | "dashboard"
  | "users"
  | "telemetry"
  | "home"
  | "projects"
  | "inventory"
  | "bids"
  | "documents"
  | "business"
  | "tasks"
  | "reports"
  | "settings";

interface SidebarProps {
  currentTab: NavItem;
  onSelectTab: (tab: NavItem) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab, isOpen }) => {
  const { user, isPlatformAdmin, logout } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const workspace = [
    { id: "home" as NavItem, label: "Dashboard", icon: Home },
    { id: "projects" as NavItem, label: "Projects", icon: FolderKanban },
    { id: "inventory" as NavItem, label: "Inventory", icon: Boxes },
    { id: "bids" as NavItem, label: "Bids & Tenders", icon: Gavel },
    { id: "documents" as NavItem, label: "Documents", icon: Files },
    { id: "business" as NavItem, label: "Business", icon: BriefcaseBusiness },
    { id: "tasks" as NavItem, label: "Tasks", icon: ListTodo },
    { id: "reports" as NavItem, label: "Reports", icon: BarChart3 },
    { id: "settings" as NavItem, label: "Settings", icon: Settings },
  ];

  const admin = [
    { id: "dashboard" as NavItem, label: "Admin Console", icon: ShieldCheck },
    { id: "users" as NavItem, label: "Users & Access", icon: Users },
    { id: "telemetry" as NavItem, label: "System Telemetry", icon: Activity },
  ];

  const initials = (user?.full_name || user?.email || "U")
    .split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  const renderItem = ({ id, label, icon: Icon }: (typeof workspace)[number]) => (
    <button key={id} onClick={() => onSelectTab(id)}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        currentTab === id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
        !isOpen && "justify-center px-0",
      )}>
      <Icon className={cn("h-4 w-4 shrink-0", currentTab === id && "text-primary")} />
      {isOpen && <span>{label}</span>}
    </button>
  );

  return (
    <aside className={cn(
      "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200",
      isOpen ? "w-64" : "w-20",
    )}>
      <div className={cn("flex h-24 shrink-0 items-center border-b border-sidebar-border", isOpen ? "justify-start px-5" : "justify-center px-2")}>
        <Logo variant={isOpen ? "responsive" : "icon"} className={cn(isOpen ? "h-16 w-16" : "h-12 w-12")} />
        {isOpen && (
          <div className="ml-3 min-w-0">
            <p className="truncate text-sm font-semibold text-sidebar-foreground">{brand.companyName}</p>
            <p className="truncate text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Operating System</p>
          </div>
        )}
      </div>

      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {isPlatformAdmin && (
          <>
            {isOpen && <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Platform admin</p>}
            <div className="space-y-1">{admin.map(renderItem)}</div>
            <div className="my-4 border-t border-sidebar-border" />
            {isOpen && <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{brand.workspaceName}</p>}
          </>
        )}
        <div className="space-y-1">{workspace.map(renderItem)}</div>

        {isPlatformAdmin && (
          <div className="pt-4 mt-4 border-t border-sidebar-border">
            <a href="/docs" target="_blank" rel="noreferrer"
              className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-sidebar-accent", !isOpen && "justify-center px-0")}>
              <FileCode2 className="h-4 w-4" />{isOpen && <span>OpenAPI Docs</span>}
            </a>
          </div>
        )}
      </div>

      <div className="border-t border-sidebar-border p-3 space-y-2">
        <SidebarAppearance isOpen={isOpen} />
        <div className="relative" ref={menuRef}>
          <button onClick={() => setUserMenuOpen((value) => !value)}
            className={cn("flex w-full items-center justify-between rounded-xl p-2 hover:bg-sidebar-accent", !isOpen && "justify-center")}>
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">{initials}</div>
              {isOpen && <div className="min-w-0 text-left"><p className="truncate text-xs font-medium">{user?.full_name || "User"}</p><p className="truncate text-[10px] text-muted-foreground">{user?.email}</p></div>}
            </div>
            {isOpen && <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />}
          </button>
          {userMenuOpen && (
            <div className={cn("absolute z-50 rounded-xl border border-border bg-popover p-2 shadow-2xl", isOpen ? "bottom-full left-0 mb-2 w-full" : "left-full bottom-0 ml-2 w-56")}>
              <button onClick={() => { setUserMenuOpen(false); onSelectTab("settings"); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-accent"><Settings className="h-4 w-4" /> Settings</button>
              <button onClick={() => void logout()} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-destructive hover:bg-destructive/10"><LogOut className="h-4 w-4" /> Log out</button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
