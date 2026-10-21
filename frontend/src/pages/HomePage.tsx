import React, { useCallback, useState } from "react";
import {
  BriefcaseBusiness,
  CheckSquare2,
  CircleDollarSign,
  FileText,
  FolderKanban,
  Plus,
  ScanLine,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SyncStatus } from "@/components/common/SyncStatus";
import { DonutChart, HorizontalBarChart, TrendChart } from "@/components/analytics/Charts";
import { useAuth } from "@/hooks/useAuth";
import { useBackgroundRefresh } from "@/hooks/useBackgroundRefresh";
import { readSectionCache, writeSectionCache } from "@/lib/sectionCache";
import { getErrorMessage } from "@/lib/api";
import {
  workspaceApi,
  type DashboardAnalytics,
  type DocumentRecord,
  type Project,
  type WorkspaceSummary,
} from "@/lib/workspaceApi";
import type { NavItem } from "@/components/layout/Sidebar";

interface HomePageProps {
  onNavigate: (tab: NavItem) => void;
}

type HomeSnapshot = {
  summary: WorkspaceSummary | null;
  projects: Project[];
  documents: DocumentRecord[];
  analytics: DashboardAnalytics | null;
};

const money = (value: number) =>
  new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0,
  }).format(value);

const compactMoney = (value: number) =>
  `UGX ${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;

export const HomePage: React.FC<HomePageProps> = ({ onNavigate }) => {
  const { user } = useAuth();
  const [initialCache] = useState(() => readSectionCache<HomeSnapshot>(user?.id, "home"));
  const [summary, setSummary] = useState<WorkspaceSummary | null>(initialCache?.data.summary ?? null);
  const [projects, setProjects] = useState<Project[]>(initialCache?.data.projects ?? []);
  const [documents, setDocuments] = useState<DocumentRecord[]>(initialCache?.data.documents ?? []);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(initialCache?.data.analytics ?? null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(initialCache?.savedAt ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsRefreshing(true);
    setLoadError(null);
    try {
      const [nextSummary, nextProjects, nextDocuments, nextAnalytics] = await Promise.all([
        workspaceApi.summary(),
        workspaceApi.projects(),
        workspaceApi.documents(),
        workspaceApi.reportingDashboard(6),
      ]);
      const snapshot: HomeSnapshot = {
        summary: nextSummary,
        projects: nextProjects.slice(0, 5),
        documents: nextDocuments.slice(0, 5),
        analytics: nextAnalytics,
      };
      setSummary(snapshot.summary);
      setProjects(snapshot.projects);
      setDocuments(snapshot.documents);
      setAnalytics(snapshot.analytics);
      setLastSyncedAt(writeSectionCache(user?.id, "home", snapshot));
    } catch (error) {
      setLoadError(getErrorMessage(error, "The management dashboard could not be refreshed."));
    } finally {
      setIsRefreshing(false);
    }
  }, [user?.id]);

  useBackgroundRefresh(load);

  const firstName = (user?.full_name || user?.email || "there").split(" ")[0];
  const stats = [
    {
      label: "Active projects",
      value: analytics?.active_projects ?? summary?.active_projects ?? 0,
      hint: "Currently in delivery",
      icon: <FolderKanban className="h-5 w-5" />,
    },
    {
      label: "Open tasks",
      value: analytics?.open_tasks ?? summary?.pending_tasks ?? 0,
      hint: `${analytics?.overdue_tasks ?? 0} overdue`,
      icon: <CheckSquare2 className="h-5 w-5" />,
    },
    {
      label: "Task completion",
      value: `${analytics?.task_completion_rate ?? 0}%`,
      hint: "Across all recorded tasks",
      icon: <TrendingUp className="h-5 w-5" />,
    },
    {
      label: "Receivables",
      value: compactMoney(analytics?.receivables_ugx ?? summary?.outstanding_ugx ?? 0),
      hint: "Still to be collected",
      icon: <WalletCards className="h-5 w-5" />,
    },
    {
      label: "Receipts this month",
      value: compactMoney(analytics?.receipts_month_ugx ?? 0),
      hint: "Cash received",
      icon: <CircleDollarSign className="h-5 w-5" />,
    },
    {
      label: "Net cash this month",
      value: compactMoney(analytics?.net_cash_month_ugx ?? 0),
      hint: "Receipts less recorded expenses",
      icon: <BriefcaseBusiness className="h-5 w-5" />,
    },
  ];

  const projectPie = (analytics?.project_status ?? []).map((item) => ({ label: item.name, value: item.count }));
  const taskPie = (analytics?.task_status ?? []).map((item) => ({ label: item.name, value: item.count }));
  const invoicePie = (analytics?.invoice_status ?? []).map((item) => ({ label: item.name, value: item.count }));
  const expensePie = (analytics?.expense_categories ?? []).map((item) => ({ label: item.name, value: item.value }));
  const documentPie = (analytics?.document_categories ?? []).map((item) => ({ label: item.name, value: item.count }));
  const topProjects = (analytics?.top_projects ?? []).map((item) => ({ label: item.project_name, value: item.value_ugx }));

  return (
    <div className="min-w-0 max-w-full space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Star Africa Logistics Management Dashboard</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Good day, {firstName} 👋</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live operational and financial intelligence across Star Africa Logistics.
          </p>
        </div>
        <SyncStatus isRefreshing={isRefreshing} error={loadError} lastSyncedAt={lastSyncedAt} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {stats.map((stat) => (
          <Card key={stat.label} className="flex min-h-32 flex-col justify-between p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <div className="rounded-lg bg-primary/10 p-2 text-primary">{stat.icon}</div>
            </div>
            <div>
              <p className="mt-3 text-xl font-bold">{stat.value}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">{stat.hint}</p>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <TrendChart
          className="xl:col-span-2"
          title="Financial movement — last 6 months"
          subtitle="Invoices raised, receipts collected and expenses recorded."
          labels={(analytics?.monthly_finance ?? []).map((item) => item.month)}
          series={[
            { label: "Invoiced", values: (analytics?.monthly_finance ?? []).map((item) => item.invoiced_ugx) },
            { label: "Received", values: (analytics?.monthly_finance ?? []).map((item) => item.received_ugx) },
            { label: "Expenses", values: (analytics?.monthly_finance ?? []).map((item) => item.expenses_ugx) },
          ]}
          valueFormatter={compactMoney}
        />
        <DonutChart title="Project portfolio" subtitle="How current projects are distributed by status." items={projectPie} centerLabel="Projects" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
        <DonutChart title="Task completion" subtitle="Work distribution across task stages." items={taskPie} centerLabel="Tasks" />
        <DonutChart title="Invoice status" subtitle="Current invoice workflow and collection position." items={invoicePie} centerLabel="Invoices" />
        <DonutChart title="Expense mix" subtitle="Recorded spending by category in the dashboard period." items={expensePie} centerLabel="Expenses" valueFormatter={compactMoney} />
        <DonutChart title="Document mix" subtitle="Documents available across Star Africa Logistics records." items={documentPie} centerLabel="Documents" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <HorizontalBarChart
          title="Largest projects by value"
          subtitle="Projects with the greatest commercial value."
          items={topProjects}
          valueFormatter={compactMoney}
        />
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Quick actions</h2>
              <p className="text-xs text-muted-foreground">Move from insight to action.</p>
            </div>
            {(analytics?.overdue_tasks ?? summary?.due_tasks ?? 0) > 0 && (
              <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs text-amber-600">
                {analytics?.overdue_tasks ?? summary?.due_tasks} overdue / due
              </span>
            )}
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Button className="justify-start gap-2" onClick={() => onNavigate("projects")}><Plus className="h-4 w-4" /> New project</Button>
            <Button variant="outline" className="justify-start gap-2" onClick={() => onNavigate("documents")}><ScanLine className="h-4 w-4" /> Scan document</Button>
            <Button variant="outline" className="justify-start gap-2" onClick={() => onNavigate("tasks")}><CheckSquare2 className="h-4 w-4" /> View tasks</Button>
            <Button variant="outline" className="justify-start gap-2" onClick={() => onNavigate("reports")}><TrendingUp className="h-4 w-4" /> Open reports</Button>
          </div>
          <div className="mt-5 rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-xs font-medium">This month</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div><p className="text-muted-foreground">Receipts</p><p className="mt-1 font-semibold">{money(analytics?.receipts_month_ugx ?? 0)}</p></div>
              <div><p className="text-muted-foreground">Expenses</p><p className="mt-1 font-semibold">{money(analytics?.expenses_month_ugx ?? 0)}</p></div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between"><h2 className="font-semibold">Recent projects</h2><button className="text-xs text-primary" onClick={() => onNavigate("projects")}>View all</button></div>
          <div className="mt-4 space-y-3">
            {projects.length === 0 ? <p className="text-sm text-muted-foreground">No projects yet.</p> : projects.map((project) => (
              <button key={project.id} onClick={() => onNavigate("projects")} className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-left hover:bg-accent/40">
                <div><p className="text-sm font-medium">{project.name}</p><p className="text-xs text-muted-foreground">{project.client_name}</p></div>
                <span className="text-xs font-medium">{project.progress}%</span>
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between"><h2 className="font-semibold">Recent documents</h2><button className="text-xs text-primary" onClick={() => onNavigate("documents")}>Open documents</button></div>
          <div className="mt-4 space-y-3">
            {documents.length === 0 ? <p className="text-sm text-muted-foreground">No documents uploaded yet.</p> : documents.map((document) => (
              <div key={document.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <FileText className="h-4 w-4 text-primary" /><div className="min-w-0"><p className="truncate text-sm font-medium">{document.title}</p><p className="text-xs text-muted-foreground">{document.category.replaceAll("_", " ")}</p></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default HomePage;
