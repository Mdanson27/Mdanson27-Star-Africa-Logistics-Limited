import React, { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  BarChart3,
  BookOpenCheck,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Landmark,
  ListTodo,
  Scale,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SyncStatus } from "@/components/common/SyncStatus";
import { SectionNav } from "@/components/common/SectionNav";
import { DonutChart, HorizontalBarChart, TrendChart } from "@/components/analytics/Charts";
import { useAuth } from "@/hooks/useAuth";
import { useBackgroundRefresh } from "@/hooks/useBackgroundRefresh";
import { readSectionCache, writeSectionCache } from "@/lib/sectionCache";
import { getErrorMessage } from "@/lib/api";
import {
  workspaceApi,
  type BalanceSheetReport,
  type CashFlowReport,
  type DashboardAnalytics,
  type DocumentRecord,
  type ExpenseRecord,
  type ProfitLossReport,
  type Project,
  type ProjectTask,
  type ReceivableAgingReport,
  type TrialBalanceReport,
} from "@/lib/workspaceApi";

type ReportsView =
  | "executive"
  | "accounting"
  | "financial"
  | "projects"
  | "tasks"
  | "receivables"
  | "expenses"
  | "documents";

type ReportsSnapshot = {
  analytics: DashboardAnalytics | null;
  trialBalance: TrialBalanceReport | null;
  profitLoss: ProfitLossReport | null;
  balanceSheet: BalanceSheetReport | null;
  cashFlow: CashFlowReport | null;
  aging: ReceivableAgingReport | null;
  projects: Project[];
  tasks: ProjectTask[];
  documents: DocumentRecord[];
  expenses: ExpenseRecord[];
};

const localDate = (value = new Date()) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const money = (value: number) =>
  new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0,
  }).format(value);

const compactMoney = (value: number) =>
  `UGX ${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;

const statusLabel = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const completedTask = (task: ProjectTask) => ["completed", "done"].includes(task.status.toLowerCase());

const Metric: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
}> = ({ label, value, hint, icon }) => (
  <Card className="p-4">
    <div className="flex items-start justify-between gap-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {icon && <div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div>}
    </div>
    <p className="mt-3 text-xl font-bold">{value}</p>
    {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
  </Card>
);

const StatementBlock: React.FC<{
  title: string;
  lines: Array<{ code: string; name: string; amount_ugx: number }>;
  totalLabel: string;
  total: number;
}> = ({ title, lines, totalLabel, total }) => (
  <Card className="p-0 overflow-hidden">
    <div className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold">{title}</h3></div>
    <div className="divide-y divide-border">
      {lines.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No balances recorded.</p>
      ) : lines.map((line) => (
        <div key={`${line.code}-${line.name}`} className="grid grid-cols-[70px_1fr_auto] gap-3 px-4 py-2.5 text-xs">
          <span className="font-mono text-muted-foreground">{line.code}</span>
          <span>{line.name}</span>
          <span className="font-medium">{money(line.amount_ugx)}</span>
        </div>
      ))}
    </div>
    <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-3 text-sm font-semibold">
      <span>{totalLabel}</span><span>{money(total)}</span>
    </div>
  </Card>
);

export const ReportsPage: React.FC = () => {
  const { user } = useAuth();
  const today = localDate();
  const [fromDate, setFromDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [toDate, setToDate] = useState(today);
  const [view, setView] = useState<ReportsView>("executive");
  const [initialCache] = useState(() => readSectionCache<ReportsSnapshot>(user?.id, "reports-2"));
  const [snapshot, setSnapshot] = useState<ReportsSnapshot>(() => ({
    analytics: initialCache?.data.analytics ?? null,
    trialBalance: initialCache?.data.trialBalance ?? null,
    profitLoss: initialCache?.data.profitLoss ?? null,
    balanceSheet: initialCache?.data.balanceSheet ?? null,
    cashFlow: initialCache?.data.cashFlow ?? null,
    aging: initialCache?.data.aging ?? null,
    projects: initialCache?.data.projects ?? [],
    tasks: initialCache?.data.tasks ?? [],
    documents: initialCache?.data.documents ?? [],
    expenses: initialCache?.data.expenses ?? [],
  }));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(initialCache?.savedAt ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsRefreshing(true);
    setLoadError(null);
    try {
      const [analytics, trialBalance, profitLoss, balanceSheet, cashFlow, aging, projects, tasks, documents, expenses] = await Promise.all([
        workspaceApi.reportingDashboard(12),
        workspaceApi.trialBalance(toDate),
        workspaceApi.profitLoss(fromDate, toDate),
        workspaceApi.balanceSheet(toDate),
        workspaceApi.cashFlow(fromDate, toDate),
        workspaceApi.receivablesAging(toDate),
        workspaceApi.projects({ include_archived: true }),
        workspaceApi.tasks({ include_archived_projects: true }),
        workspaceApi.documents(),
        workspaceApi.expenses(),
      ]);
      const next: ReportsSnapshot = { analytics, trialBalance, profitLoss, balanceSheet, cashFlow, aging, projects, tasks, documents, expenses };
      setSnapshot(next);
      setLastSyncedAt(writeSectionCache(user?.id, "reports-2", next));
    } catch (error) {
      setLoadError(getErrorMessage(error, "Reporting data could not be refreshed."));
    } finally {
      setIsRefreshing(false);
    }
  }, [fromDate, toDate, user?.id]);

  useBackgroundRefresh(load, 60_000);

  const tabs = [
    { id: "executive" as const, label: "Executive" },
    { id: "accounting" as const, label: "Accounting" },
    { id: "financial" as const, label: "Financial" },
    { id: "projects" as const, label: "Projects" },
    { id: "tasks" as const, label: "Tasks" },
    { id: "receivables" as const, label: "Receivables" },
    { id: "expenses" as const, label: "Expenses" },
    { id: "documents" as const, label: "Documents" },
  ];

  const { analytics, trialBalance, profitLoss, balanceSheet, cashFlow, aging, projects, tasks, documents, expenses } = snapshot;
  const completedTasks = tasks.filter(completedTask).length;
  const overdueTasks = tasks.filter((task) => !completedTask(task) && task.due_date && task.due_date < today).length;
  const highPriority = tasks.filter((task) => !completedTask(task) && ["high", "urgent", "critical"].includes(task.priority.toLowerCase())).length;
  const taskCompletion = tasks.length ? (completedTasks / tasks.length) * 100 : 0;

  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const tasksByProject = useMemo(() => {
    const values = new Map<string, number>();
    tasks.forEach((task) => values.set(task.project_id, (values.get(task.project_id) ?? 0) + 1));
    return Array.from(values.entries()).map(([id, value]) => ({ label: projectNameById.get(id) ?? "Unknown project", value })).sort((a, b) => b.value - a.value);
  }, [tasks, projectNameById]);

  const projectStatus = (analytics?.project_status ?? []).map((item) => ({ label: item.name, value: item.count }));
  const taskStatus = (analytics?.task_status ?? []).map((item) => ({ label: item.name, value: item.count }));
  const invoiceStatus = (analytics?.invoice_status ?? []).map((item) => ({ label: item.name, value: item.count }));
  const expenseMix = (analytics?.expense_categories ?? []).map((item) => ({ label: item.name, value: item.value }));
  const documentMix = (analytics?.document_categories ?? []).map((item) => ({ label: item.name, value: item.count }));
  const agingMix = aging ? [
    { label: "Current", value: aging.current_ugx },
    { label: "1–30 days", value: aging.days_1_30_ugx },
    { label: "31–60 days", value: aging.days_31_60_ugx },
    { label: "61–90 days", value: aging.days_61_90_ugx },
    { label: "90+ days", value: aging.days_90_plus_ugx },
  ] : [];

  const periodLabel = `${fromDate} → ${toDate}`;

  return (
    <div className="min-w-0 max-w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Reporting & Analytics 2.0</p>
          <h1 className="mt-1 text-2xl font-bold">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">Financial statements, operational performance, collections and management intelligence.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[10px] text-muted-foreground">From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 block rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground" /></label>
          <label className="text-[10px] text-muted-foreground">To<input type="date" value={toDate} max={today} onChange={(event) => setToDate(event.target.value)} className="mt-1 block rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground" /></label>
          <Button variant="outline" size="sm" onClick={() => window.print()}>Print / Save PDF</Button>
          <SyncStatus isRefreshing={isRefreshing} error={loadError} lastSyncedAt={lastSyncedAt} />
        </div>
      </div>

      <SectionNav items={tabs} active={view} onChange={setView} ariaLabel="Report sections" />

      {view === "executive" && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Net profit" value={money(profitLoss?.net_profit_ugx ?? 0)} hint={`${profitLoss?.margin_percent.toFixed(1) ?? "0.0"}% margin · ${periodLabel}`} icon={<TrendingUp className="h-4 w-4" />} />
            <Metric label="Receivables" value={money(aging?.total_ugx ?? analytics?.receivables_ugx ?? 0)} hint="Outstanding client balances" icon={<WalletCards className="h-4 w-4" />} />
            <Metric label="Task completion" value={`${taskCompletion.toFixed(1)}%`} hint={`${overdueTasks} overdue · ${highPriority} high priority`} icon={<CheckCircle2 className="h-4 w-4" />} />
            <Metric label="Net cash flow" value={money(cashFlow?.net_cash_flow_ugx ?? 0)} hint={periodLabel} icon={<CircleDollarSign className="h-4 w-4" />} />
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            <TrendChart className="xl:col-span-2" title="12-month commercial performance" subtitle="Invoices, cash received and recorded expenses." labels={(analytics?.monthly_finance ?? []).map((item) => item.month)} series={[
              { label: "Invoiced", values: (analytics?.monthly_finance ?? []).map((item) => item.invoiced_ugx) },
              { label: "Received", values: (analytics?.monthly_finance ?? []).map((item) => item.received_ugx) },
              { label: "Expenses", values: (analytics?.monthly_finance ?? []).map((item) => item.expenses_ugx) },
            ]} valueFormatter={compactMoney} />
            <DonutChart title="Receivables aging" subtitle="How long outstanding invoice balances have been due." items={agingMix} centerLabel="Outstanding" valueFormatter={compactMoney} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
            <DonutChart title="Projects" subtitle="Portfolio by project status." items={projectStatus} centerLabel="Projects" />
            <DonutChart title="Tasks" subtitle="Work distribution by workflow stage." items={taskStatus} centerLabel="Tasks" />
            <DonutChart title="Invoices" subtitle="Invoice lifecycle distribution." items={invoiceStatus} centerLabel="Invoices" />
            <DonutChart title="Expenses" subtitle="Spending concentration by category." items={expenseMix} centerLabel="Expenses" valueFormatter={compactMoney} />
          </div>
        </div>
      )}

      {view === "accounting" && (
        <div className="space-y-5">
          <Card className="border-primary/20 bg-primary/5">
            <div className="flex gap-3"><BookOpenCheck className="mt-0.5 h-5 w-5 text-primary" /><div><h2 className="text-sm font-semibold">Star Africa Logistics accounting policy used by these reports</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Issued invoices post Accounts Receivable and Revenue. Receipts post Cash/Bank and reduce Accounts Receivable. Recorded expenses post Expense and Cash/Bank. Draft invoices, quotations and purchase orders do not affect the ledger. Manual journals can later be used for capital, liabilities, assets and adjustments.</p></div></div>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Trial balance" value={trialBalance?.balanced ? "Balanced" : "Check required"} hint={`Difference ${money(trialBalance?.difference_ugx ?? 0)}`} icon={<Scale className="h-4 w-4" />} />
            <Metric label="Total assets" value={money(balanceSheet?.total_assets_ugx ?? 0)} hint={`As at ${toDate}`} icon={<Landmark className="h-4 w-4" />} />
            <Metric label="Net profit" value={money(profitLoss?.net_profit_ugx ?? 0)} hint={periodLabel} icon={<TrendingUp className="h-4 w-4" />} />
            <Metric label="Net cash flow" value={money(cashFlow?.net_cash_flow_ugx ?? 0)} hint={periodLabel} icon={<CircleDollarSign className="h-4 w-4" />} />
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"><div><h2 className="font-semibold">Trial Balance</h2><p className="text-xs text-muted-foreground">As at {toDate}</p></div><span className={`rounded-full px-3 py-1 text-xs font-medium ${trialBalance?.balanced ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"}`}>{trialBalance?.balanced ? "Debits = Credits" : "Out of balance"}</span></div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">Account</th><th className="px-4 py-3">Type</th><th className="px-4 py-3 text-right">Debit</th><th className="px-4 py-3 text-right">Credit</th><th className="px-4 py-3 text-right">Balance</th></tr></thead><tbody className="divide-y divide-border">{(trialBalance?.rows ?? []).map((row) => <tr key={row.account_code}><td className="px-4 py-3 font-mono text-muted-foreground">{row.account_code}</td><td className="px-4 py-3 font-medium">{row.account_name}</td><td className="px-4 py-3 text-muted-foreground">{statusLabel(row.account_type)}</td><td className="px-4 py-3 text-right">{money(row.debit_ugx)}</td><td className="px-4 py-3 text-right">{money(row.credit_ugx)}</td><td className="px-4 py-3 text-right font-medium">{money(row.balance_ugx)}</td></tr>)}</tbody><tfoot className="border-t-2 border-border bg-muted/30 font-semibold"><tr><td className="px-4 py-3" colSpan={3}>Totals</td><td className="px-4 py-3 text-right">{money(trialBalance?.total_debits_ugx ?? 0)}</td><td className="px-4 py-3 text-right">{money(trialBalance?.total_credits_ugx ?? 0)}</td><td className="px-4 py-3 text-right">{money(trialBalance?.difference_ugx ?? 0)}</td></tr></tfoot></table>
            </div>
          </Card>

          <div className="grid gap-5 xl:grid-cols-3">
            <StatementBlock title="Assets" lines={balanceSheet?.assets ?? []} totalLabel="Total Assets" total={balanceSheet?.total_assets_ugx ?? 0} />
            <StatementBlock title="Liabilities" lines={balanceSheet?.liabilities ?? []} totalLabel="Total Liabilities" total={balanceSheet?.total_liabilities_ugx ?? 0} />
            <StatementBlock title="Equity" lines={balanceSheet?.equity ?? []} totalLabel="Total Equity" total={balanceSheet?.total_equity_ugx ?? 0} />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card className="p-0 overflow-hidden"><div className="border-b border-border px-4 py-3"><h2 className="font-semibold">Profit & Loss</h2><p className="text-xs text-muted-foreground">{periodLabel}</p></div><div className="p-4"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue</h3>{(profitLoss?.revenue ?? []).map((line) => <div key={line.code} className="mt-2 flex justify-between text-xs"><span>{line.code} · {line.name}</span><span>{money(line.amount_ugx)}</span></div>)}<div className="mt-3 flex justify-between border-t border-border pt-3 text-sm font-semibold"><span>Total revenue</span><span>{money(profitLoss?.total_revenue_ugx ?? 0)}</span></div><h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expenses</h3>{(profitLoss?.expenses ?? []).map((line) => <div key={line.code} className="mt-2 flex justify-between text-xs"><span>{line.code} · {line.name}</span><span>{money(line.amount_ugx)}</span></div>)}<div className="mt-3 flex justify-between border-t border-border pt-3 text-sm font-semibold"><span>Total expenses</span><span>{money(profitLoss?.total_expenses_ugx ?? 0)}</span></div><div className="mt-4 flex justify-between rounded-lg bg-primary/10 p-3 font-semibold text-primary"><span>Net profit / (loss)</span><span>{money(profitLoss?.net_profit_ugx ?? 0)}</span></div></div></Card>
            <TrendChart title="Cash Flow" subtitle={`${periodLabel} · actual cash/bank movement recorded in the ledger.`} labels={(cashFlow?.monthly ?? []).map((item) => item.month)} series={[
              { label: "Inflows", values: (cashFlow?.monthly ?? []).map((item) => item.inflows_ugx) },
              { label: "Outflows", values: (cashFlow?.monthly ?? []).map((item) => item.outflows_ugx) },
            ]} valueFormatter={compactMoney} />
          </div>
        </div>
      )}

      {view === "financial" && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Revenue recognised" value={money(profitLoss?.total_revenue_ugx ?? 0)} icon={<BadgeDollarSign className="h-4 w-4" />} />
            <Metric label="Expenses" value={money(profitLoss?.total_expenses_ugx ?? 0)} icon={<BriefcaseBusiness className="h-4 w-4" />} />
            <Metric label="Cash collected" value={money(cashFlow?.inflows_ugx ?? 0)} icon={<CircleDollarSign className="h-4 w-4" />} />
            <Metric label="Outstanding invoices" value={money(aging?.total_ugx ?? 0)} icon={<WalletCards className="h-4 w-4" />} />
          </div>
          <TrendChart title="Revenue, receipts and expense trend" subtitle="Commercial movement across the last 12 months." labels={(analytics?.monthly_finance ?? []).map((item) => item.month)} series={[
            { label: "Invoiced", values: (analytics?.monthly_finance ?? []).map((item) => item.invoiced_ugx) },
            { label: "Received", values: (analytics?.monthly_finance ?? []).map((item) => item.received_ugx) },
            { label: "Expenses", values: (analytics?.monthly_finance ?? []).map((item) => item.expenses_ugx) },
          ]} valueFormatter={compactMoney} />
          <div className="grid gap-5 xl:grid-cols-2"><DonutChart title="Invoice lifecycle" subtitle="Draft, sent, partially paid, paid and overdue invoices." items={invoiceStatus} centerLabel="Invoices" /><DonutChart title="Expense concentration" subtitle="Where Star Africa Logistics's recorded spending is going." items={expenseMix} centerLabel="Expenses" valueFormatter={compactMoney} /></div>
          <Card className="p-0 overflow-hidden"><div className="border-b border-border px-4 py-3"><h2 className="font-semibold">Project financial performance</h2><p className="text-xs text-muted-foreground">Commercial value, receipts, recorded expenses and cash margin.</p></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="px-4 py-3 text-left">Project</th><th className="px-4 py-3 text-right">Value</th><th className="px-4 py-3 text-right">Received</th><th className="px-4 py-3 text-right">Expenses</th><th className="px-4 py-3 text-right">Cash margin</th></tr></thead><tbody className="divide-y divide-border">{(analytics?.top_projects ?? []).map((item) => <tr key={item.project_id}><td className="px-4 py-3"><p className="font-medium">{item.project_name}</p><p className="text-[10px] text-muted-foreground">{item.client_name}</p></td><td className="px-4 py-3 text-right">{money(item.value_ugx)}</td><td className="px-4 py-3 text-right">{money(item.received_ugx)}</td><td className="px-4 py-3 text-right">{money(item.expenses_ugx)}</td><td className="px-4 py-3 text-right font-semibold">{money(item.margin_ugx)}</td></tr>)}</tbody></table></div></Card>
        </div>
      )}

      {view === "projects" && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-2"><DonutChart title="Project status" subtitle="Portfolio distribution by current project stage." items={projectStatus} centerLabel="Projects" /><HorizontalBarChart title="Largest projects" subtitle="Project value ranking." items={(analytics?.top_projects ?? []).map((item) => ({ label: item.project_name, value: item.value_ugx }))} valueFormatter={compactMoney} /></div>
          <Card className="p-0 overflow-hidden"><div className="border-b border-border px-4 py-3"><h2 className="font-semibold">Project performance report</h2></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="px-4 py-3 text-left">Project</th><th className="px-4 py-3 text-left">Client</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Progress</th><th className="px-4 py-3 text-right">Value</th><th className="px-4 py-3 text-right">Outstanding</th></tr></thead><tbody className="divide-y divide-border">{projects.map((project) => <tr key={project.id}><td className="px-4 py-3 font-medium">{project.name}</td><td className="px-4 py-3 text-muted-foreground">{project.client_name}</td><td className="px-4 py-3">{statusLabel(project.status)}</td><td className="px-4 py-3 text-right">{project.progress}%</td><td className="px-4 py-3 text-right">{money(project.value_ugx)}</td><td className="px-4 py-3 text-right">{money(Math.max(0, project.value_ugx - project.amount_paid_ugx))}</td></tr>)}</tbody></table></div></Card>
        </div>
      )}

      {view === "tasks" && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="All tasks" value={tasks.length} icon={<ListTodo className="h-4 w-4" />} /><Metric label="Completed" value={completedTasks} hint={`${taskCompletion.toFixed(1)}% completion`} icon={<CheckCircle2 className="h-4 w-4" />} /><Metric label="Overdue" value={overdueTasks} icon={<AlertTriangle className="h-4 w-4" />} /><Metric label="High priority open" value={highPriority} icon={<AlertTriangle className="h-4 w-4" />} /></div>
          <div className="grid gap-5 xl:grid-cols-2"><DonutChart title="Task completion & workflow" subtitle="Task distribution across the current workflow." items={taskStatus} centerLabel="Tasks" /><HorizontalBarChart title="Tasks by project" subtitle="Where the team's workload is concentrated." items={tasksByProject} /></div>
          <Card className="p-0 overflow-hidden"><div className="border-b border-border px-4 py-3"><h2 className="font-semibold">Task performance report</h2></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="px-4 py-3 text-left">Task</th><th className="px-4 py-3 text-left">Project</th><th className="px-4 py-3">Assignee</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Due</th></tr></thead><tbody className="divide-y divide-border">{tasks.slice(0, 100).map((task) => <tr key={task.id}><td className="px-4 py-3 font-medium">{task.title}</td><td className="px-4 py-3 text-muted-foreground">{projectNameById.get(task.project_id) ?? "—"}</td><td className="px-4 py-3">{task.assignee_email ?? "Unassigned"}</td><td className="px-4 py-3">{statusLabel(task.priority)}</td><td className="px-4 py-3">{statusLabel(task.status)}</td><td className="px-4 py-3">{task.due_date ?? "—"}</td></tr>)}</tbody></table></div></Card>
        </div>
      )}

      {view === "receivables" && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[1fr_2fr]"><DonutChart title="A/R aging" subtitle="Outstanding invoices grouped by age." items={agingMix} centerLabel="A/R" valueFormatter={compactMoney} /><Card><h3 className="text-sm font-semibold">Collection priorities</h3><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{agingMix.map((item) => <div key={item.label} className="rounded-lg border border-border p-3"><p className="text-[10px] text-muted-foreground">{item.label}</p><p className="mt-1 text-sm font-semibold">{money(item.value)}</p></div>)}</div></Card></div>
          <Card className="p-0 overflow-hidden"><div className="border-b border-border px-4 py-3"><h2 className="font-semibold">Accounts Receivable Aging Report</h2><p className="text-xs text-muted-foreground">As at {toDate}</p></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="px-4 py-3 text-left">Invoice</th><th className="px-4 py-3 text-left">Client</th><th className="px-4 py-3">Due date</th><th className="px-4 py-3 text-right">Days overdue</th><th className="px-4 py-3">Bucket</th><th className="px-4 py-3 text-right">Outstanding</th></tr></thead><tbody className="divide-y divide-border">{(aging?.invoices ?? []).map((item) => <tr key={item.invoice_number}><td className="px-4 py-3 font-medium">{item.invoice_number}</td><td className="px-4 py-3">{item.client_name}</td><td className="px-4 py-3">{item.due_date ?? "—"}</td><td className="px-4 py-3 text-right">{item.days_overdue}</td><td className="px-4 py-3">{item.bucket}</td><td className="px-4 py-3 text-right font-semibold">{money(item.outstanding_ugx)}</td></tr>)}</tbody></table></div></Card>
        </div>
      )}

      {view === "expenses" && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-2"><DonutChart title="Expenses by category" subtitle="Spending categories across the last 12 months." items={expenseMix} centerLabel="Expenses" valueFormatter={compactMoney} /><HorizontalBarChart title="Highest expense categories" subtitle="Ranked by recorded amount." items={expenseMix} valueFormatter={compactMoney} /></div>
          <Card className="p-0 overflow-hidden"><div className="border-b border-border px-4 py-3"><h2 className="font-semibold">Expense Register</h2><p className="text-xs text-muted-foreground">Recent recorded expenditure.</p></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-left">Description</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Project</th><th className="px-4 py-3 text-right">Amount</th></tr></thead><tbody className="divide-y divide-border">{expenses.slice(0, 100).map((item) => <tr key={item.id}><td className="px-4 py-3">{item.expense_date}</td><td className="px-4 py-3 font-medium">{item.description}</td><td className="px-4 py-3">{statusLabel(item.category)}</td><td className="px-4 py-3 text-muted-foreground">{item.project_id ? projectNameById.get(item.project_id) ?? "Linked project" : "—"}</td><td className="px-4 py-3 text-right font-semibold">{money(item.amount_ugx)}</td></tr>)}</tbody></table></div></Card>
        </div>
      )}

      {view === "documents" && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="All documents" value={documents.length} icon={<FileText className="h-4 w-4" />} /><Metric label="OCR completed" value={documents.filter((item) => item.ocr_status === "completed").length} /><Metric label="Project-linked" value={documents.filter((item) => Boolean(item.project_id)).length} /><Metric label="Generated commercial" value={documents.filter((item) => item.category === "generated_commercial").length} /></div>
          <div className="grid gap-5 xl:grid-cols-2"><DonutChart title="Document mix" subtitle="Documents grouped by category." items={documentMix} centerLabel="Documents" /><HorizontalBarChart title="Document categories" subtitle="Largest groups in Star Africa Logistics's document archive." items={documentMix} /></div>
        </div>
      )}
    </div>
  );
};

export default ReportsPage;
