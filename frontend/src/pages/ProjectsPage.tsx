import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  Banknote,
  Boxes,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  Download,
  Edit3,
  FileCheck2,
  FileText,
  Filter,
  FolderKanban,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Tag,
  Undo2,
  UploadCloud,
  Users,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SyncStatus } from "@/components/common/SyncStatus";
import { SectionNav } from "@/components/common/SectionNav";
import { useCustomToast } from "@/hooks/useCustomToast";
import { useAuth } from "@/hooks/useAuth";
import { useBackgroundRefresh } from "@/hooks/useBackgroundRefresh";
import { readSectionCache, writeSectionCache } from "@/lib/sectionCache";
import { confirmDiscardChanges, useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { getErrorMessage } from "@/lib/api";
import { businessApi, type ClientRecord } from "@/lib/businessApi";
import { inventoryApi, type StockBalance } from "@/lib/inventoryApi";
import {
  uploadToPresignedUrl,
  workspaceApi,
  type AssignableUser,
  type DocumentRecord,
  type Project,
  type ProjectDashboardSummary,
  type ProjectTask,
  type ProjectWorkspace,
} from "@/lib/workspaceApi";

type ProjectsSection =
  | "overview"
  | "all"
  | "active"
  | "planning"
  | "on_hold"
  | "completed"
  | "archived";

type PortfolioView = "table" | "cards" | "timeline" | "calendar";
type WorkspaceTab = "overview" | "tasks" | "documents" | "finance" | "inventory" | "activity";
type FinanceKind = "quotation" | "invoice" | "payment" | "purchase" | "expense";
type FinanceView = "quotations" | "invoices" | "payments" | "purchase_orders" | "expenses";

type ProjectsSnapshot = {
  projects: Project[];
  dashboard: ProjectDashboardSummary | null;
};

type ProjectFormState = {
  name: string;
  client_id: string;
  client_name: string;
  description: string;
  status: string;
  value_ugx: string;
  amount_paid_ugx: string;
  start_date: string;
  due_date: string;
  progress: string;
  project_manager_email: string;
  team_emails: string[];
  tags: string;
  current_milestone: string;
};

type TaskFormState = {
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee_email: string;
  due_date: string;
};

type FilterState = {
  status: string;
  client: string;
  manager: string;
  start_from: string;
  start_to: string;
  deadline_from: string;
  deadline_to: string;
  progress_min: string;
  progress_max: string;
  value_min: string;
  value_max: string;
  tag: string;
};

const emptyProjectForm: ProjectFormState = {
  name: "",
  client_id: "",
  client_name: "",
  description: "",
  status: "planning",
  value_ugx: "",
  amount_paid_ugx: "",
  start_date: "",
  due_date: "",
  progress: "0",
  project_manager_email: "",
  team_emails: [],
  tags: "",
  current_milestone: "",
};

const emptyTaskForm: TaskFormState = {
  title: "",
  description: "",
  status: "todo",
  priority: "normal",
  assignee_email: "",
  due_date: "",
};

const emptyFilters: FilterState = {
  status: "",
  client: "",
  manager: "",
  start_from: "",
  start_to: "",
  deadline_from: "",
  deadline_to: "",
  progress_min: "",
  progress_max: "",
  value_min: "",
  value_max: "",
  tag: "",
};

const money = (value: number) =>
  new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0,
  }).format(value || 0);

const today = () => new Date().toISOString().slice(0, 10);

const splitList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const makeFinanceForm = (kind: FinanceKind, project: Project) => {
  const date = today();
  return {
    issue_date: date,
    order_date: date,
    expense_date: date,
    payment_date: date,
    party: kind === "purchase" ? "" : project.client_name,
    method: "bank",
    category: "general",
    number: "",
    amount: "",
    paid: "",
    description: "",
    reference: "",
    invoice_id: "",
    due_date: "",
  };
};

const normalizeTaskStatus = (status: string) => (status === "pending" ? "todo" : status);

const statusLabel = (status: string) =>
  ({
    planning: "Planning",
    active: "Active",
    on_hold: "On Hold",
    completed: "Completed",
    cancelled: "Cancelled",
    todo: "To Do",
    pending: "To Do",
    in_progress: "In Progress",
    review: "Review",
  })[status] || status.replaceAll("_", " ");

const daysRemaining = (dueDate: string | null) => {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T23:59:59`).getTime();
  const now = new Date().getTime();
  return Math.ceil((due - now) / 86_400_000);
};

const projectHealth = (project: Project) => {
  if (project.is_archived) return { label: "Archived", tone: "muted" };
  if (project.status === "completed") return { label: "Complete", tone: "good" };
  if (project.status === "on_hold") return { label: "On hold", tone: "watch" };

  const remaining = daysRemaining(project.due_date);
  if (remaining !== null && remaining < 0) return { label: "Overdue", tone: "bad" };
  if (!project.project_manager_email) return { label: "Needs manager", tone: "watch" };
  if (remaining !== null && remaining <= 7 && project.progress < 80) {
    return { label: "At risk", tone: "bad" };
  }
  if (project.status === "active" && project.progress < 25) {
    return { label: "Needs attention", tone: "watch" };
  }
  return { label: "On track", tone: "good" };
};

const healthClass = (tone: string) =>
  tone === "good"
    ? "bg-emerald-500/10 text-emerald-500"
    : tone === "bad"
      ? "bg-destructive/10 text-destructive"
      : tone === "watch"
        ? "bg-amber-500/10 text-amber-500"
        : "bg-muted text-muted-foreground";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

const textareaClass =
  "min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30";

const metricCard = (
  label: string,
  value: React.ReactNode,
  helper?: string,
  icon?: React.ReactNode,
) => (
  <Card>
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-2 text-xl font-bold">{value}</p>
        {helper && <p className="mt-1 text-[10px] text-muted-foreground">{helper}</p>}
      </div>
      {icon && <div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div>}
    </div>
  </Card>
);

export const ProjectsPage: React.FC = () => {
  const { showSuccessToast, showErrorToast, showWarningToast } = useCustomToast();
  const { user } = useAuth();
  const [initialCache] = useState(() => readSectionCache<ProjectsSnapshot>(user?.id, "projects"));

  const [projects, setProjects] = useState<Project[]>(initialCache?.data.projects ?? []);
  const [dashboard, setDashboard] = useState<ProjectDashboardSummary | null>(initialCache?.data.dashboard ?? null);
  const [section, setSection] = useState<ProjectsSection>("overview");
  const [portfolioView, setPortfolioView] = useState<PortfolioView>("table");
  const [selectedId, setSelectedId] = useState("");
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("overview");
  const [projectStock, setProjectStock] = useState<StockBalance[]>([]);
  const [projectStockLoading, setProjectStockLoading] = useState(false);
  const [financeView, setFinanceView] = useState<FinanceView>("invoices");

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [projectModal, setProjectModal] = useState<"create" | "edit" | null>(null);
  const [projectForm, setProjectForm] = useState<ProjectFormState>(emptyProjectForm);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectSaving, setProjectSaving] = useState(false);

  const [actionProject, setActionProject] = useState<Project | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<TaskFormState>(emptyTaskForm);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskProjectId, setTaskProjectId] = useState("");

  const [financeKind, setFinanceKind] = useState<FinanceKind | null>(null);
  const [financeProject, setFinanceProject] = useState<Project | null>(null);
  const [financeForm, setFinanceForm] = useState<Record<string, string>>({});
  const [financeSaving, setFinanceSaving] = useState(false);

  const [uploadProjectId, setUploadProjectId] = useState("");
  const [documentCategory, setDocumentCategory] = useState("other");
  const [docBusy, setDocBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(initialCache?.savedAt ?? null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceSyncedAt, setWorkspaceSyncedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [availableClients, setAvailableClients] = useState<ClientRecord[]>([]);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [projectOptionsLoading, setProjectOptionsLoading] = useState(false);
  const [projectOptionsError, setProjectOptionsError] = useState<string | null>(null);

  const projectDirty =
    Boolean(projectModal) &&
    JSON.stringify(projectForm) !== JSON.stringify(emptyProjectForm) &&
    (!editingProject ||
      JSON.stringify(projectForm) !==
        JSON.stringify({
          name: editingProject.name,
          client_id: editingProject.client_id || "",
          client_name: editingProject.client_name,
          description: editingProject.description || "",
          status: editingProject.status,
          value_ugx: String(editingProject.value_ugx),
          amount_paid_ugx: String(editingProject.amount_paid_ugx),
          start_date: editingProject.start_date || "",
          due_date: editingProject.due_date || "",
          progress: String(editingProject.progress),
          project_manager_email: editingProject.project_manager_email || "",
          team_emails: editingProject.team_emails,
          tags: editingProject.tags.join(", "),
          current_milestone: editingProject.current_milestone || "",
        }));

  const taskDirty =
    taskModalOpen &&
    (editingTask
      ? taskForm.title !== editingTask.title ||
        taskForm.description !== (editingTask.description || "") ||
        taskForm.status !== normalizeTaskStatus(editingTask.status) ||
        taskForm.priority !== editingTask.priority ||
        taskForm.assignee_email !== (editingTask.assignee_email || "") ||
        taskForm.due_date !== (editingTask.due_date || "")
      : JSON.stringify(taskForm) !== JSON.stringify(emptyTaskForm));

  const financeDirty =
    Boolean(financeKind && financeProject) &&
    JSON.stringify(financeForm) !==
      JSON.stringify(makeFinanceForm(financeKind as FinanceKind, financeProject as Project));

  useUnsavedChanges(projectDirty || taskDirty || financeDirty);

  const loadPortfolio = useCallback(async (_showLoading = true) => {
    setIsRefreshing(true);
    setLoadError(null);
    try {
      const [rows, summary] = await Promise.all([
        workspaceApi.projects({ include_archived: true }),
        workspaceApi.projectDashboard(),
      ]);
      const snapshot: ProjectsSnapshot = { projects: rows, dashboard: summary };
      setProjects(snapshot.projects);
      setDashboard(snapshot.dashboard);
      setLastSyncedAt(writeSectionCache(user?.id, "projects", snapshot));
    } catch (error) {
      setLoadError(getErrorMessage(error, "Projects could not be refreshed."));
    } finally {
      setIsRefreshing(false);
    }
  }, [user?.id]);

  const loadProjectOptions = useCallback(async () => {
    setProjectOptionsLoading(true);
    setProjectOptionsError(null);

    const [clientsResult, staffResult] = await Promise.allSettled([
      businessApi.clients(),
      workspaceApi.assignableUsers(),
    ]);

    const errors: string[] = [];
    if (clientsResult.status === "fulfilled") {
      setAvailableClients(
        clientsResult.value
          .filter((client) => client.is_active)
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } else {
      errors.push(getErrorMessage(clientsResult.reason, "Clients could not be loaded."));
    }

    if (staffResult.status === "fulfilled") {
      setAssignableUsers(staffResult.value);
    } else {
      errors.push(getErrorMessage(staffResult.reason, "Assignable staff could not be loaded."));
    }

    setProjectOptionsError(errors.length ? errors.join(" ") : null);
    setProjectOptionsLoading(false);
  }, []);

  useEffect(() => {
    void loadProjectOptions();
  }, [loadProjectOptions]);

  const loadWorkspace = useCallback(async (id: string) => {
    if (!id) {
      setWorkspace(null);
      setWorkspaceSyncedAt(null);
      return;
    }
    const cached = readSectionCache<ProjectWorkspace>(user?.id, `project-workspace:${id}`);
    if (cached) {
      setWorkspace(cached.data);
      setWorkspaceSyncedAt(cached.savedAt);
    }
    setWorkspaceLoading(true);
    setLoadError(null);
    try {
      const nextWorkspace = await workspaceApi.projectWorkspace(id);
      setWorkspace(nextWorkspace);
      setWorkspaceSyncedAt(writeSectionCache(user?.id, `project-workspace:${id}`, nextWorkspace));
    } catch (error) {
      setLoadError(getErrorMessage(error, "The project workspace could not be refreshed."));
    } finally {
      setWorkspaceLoading(false);
    }
  }, [user?.id]);

  useBackgroundRefresh(loadPortfolio);

  useEffect(() => {
    if (selectedId) void loadWorkspace(selectedId);
    else setWorkspace(null);
  }, [loadWorkspace, selectedId]);

  useEffect(() => {
    if (!selectedId || workspaceTab !== "inventory") return;
    setProjectStockLoading(true);
    void inventoryApi.projectStock(selectedId)
      .then(setProjectStock)
      .catch((error) => showErrorToast(getErrorMessage(error, "Project inventory could not be loaded."), "Inventory unavailable"))
      .finally(() => setProjectStockLoading(false));
  }, [selectedId, workspaceTab, showErrorToast]);

  useEffect(() => {
    if (!projects.length || selectedId) return;
    const requested = sessionStorage.getItem("starafrica.openProjectId");
    if (!requested || !projects.some((project) => project.id === requested)) return;
    sessionStorage.removeItem("starafrica.openProjectId");
    setSelectedId(requested);
    setWorkspaceTab("overview");
  }, [projects, selectedId]);

  const projectCounts = useMemo(
    () => ({
      all: projects.filter((project) => !project.is_archived).length,
      active: projects.filter(
        (project) => !project.is_archived && project.status === "active",
      ).length,
      planning: projects.filter(
        (project) => !project.is_archived && project.status === "planning",
      ).length,
      on_hold: projects.filter(
        (project) => !project.is_archived && project.status === "on_hold",
      ).length,
      completed: projects.filter(
        (project) => !project.is_archived && project.status === "completed",
      ).length,
      archived: projects.filter((project) => project.is_archived).length,
    }),
    [projects],
  );

  const sections = [
    { id: "overview" as const, label: "Overview" },
    { id: "all" as const, label: "All Projects", count: projectCounts.all },
    { id: "active" as const, label: "Active", count: projectCounts.active },
    { id: "planning" as const, label: "Planning", count: projectCounts.planning },
    { id: "on_hold" as const, label: "On Hold", count: projectCounts.on_hold },
    { id: "completed" as const, label: "Completed", count: projectCounts.completed },
    { id: "archived" as const, label: "Archived", count: projectCounts.archived },
  ];

  const clients = useMemo(
    () => Array.from(new Set(projects.map((project) => project.client_name))).sort(),
    [projects],
  );
  const managers = useMemo(
    () =>
      Array.from(
        new Set(
          projects
            .map((project) => project.project_manager_email)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort(),
    [projects],
  );
  const tags = useMemo(
    () => Array.from(new Set(projects.flatMap((project) => project.tags))).sort(),
    [projects],
  );

  const filteredProjects = useMemo(() => {
    const search = query.trim().toLowerCase();
    const minProgress = filters.progress_min ? Number(filters.progress_min) : null;
    const maxProgress = filters.progress_max ? Number(filters.progress_max) : null;
    const minValue = filters.value_min ? Number(filters.value_min) : null;
    const maxValue = filters.value_max ? Number(filters.value_max) : null;

    return projects.filter((project) => {
      if (section === "archived") {
        if (!project.is_archived) return false;
      } else if (project.is_archived) {
        return false;
      }

      if (
        section !== "overview" &&
        section !== "all" &&
        section !== "archived" &&
        project.status !== section
      ) {
        return false;
      }

      if (filters.status && project.status !== filters.status) return false;
      if (filters.client && project.client_name !== filters.client) return false;
      if (filters.manager && project.project_manager_email !== filters.manager) return false;
      if (filters.start_from && (!project.start_date || project.start_date < filters.start_from)) {
        return false;
      }
      if (filters.start_to && (!project.start_date || project.start_date > filters.start_to)) {
        return false;
      }
      if (
        filters.deadline_from &&
        (!project.due_date || project.due_date < filters.deadline_from)
      ) {
        return false;
      }
      if (
        filters.deadline_to &&
        (!project.due_date || project.due_date > filters.deadline_to)
      ) {
        return false;
      }
      if (minProgress !== null && project.progress < minProgress) return false;
      if (maxProgress !== null && project.progress > maxProgress) return false;
      if (minValue !== null && project.value_ugx < minValue) return false;
      if (maxValue !== null && project.value_ugx > maxValue) return false;
      if (filters.tag && !project.tags.includes(filters.tag)) return false;

      if (search) {
        const haystack = [
          project.name,
          project.client_name,
          project.description || "",
          project.project_manager_email || "",
          project.current_milestone || "",
          ...project.tags,
          ...project.team_emails,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      return true;
    });
  }, [projects, query, filters, section]);

  const recentProjects = useMemo(
    () =>
      [...projects]
        .filter((project) => !project.is_archived)
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        )
        .slice(0, 6),
    [projects],
  );

  const attentionProjects = useMemo(
    () =>
      projects
        .filter((project) => {
          if (project.is_archived || project.status === "completed") return false;
          const health = projectHealth(project);
          return health.tone === "bad" || health.tone === "watch";
        })
        .slice(0, 6),
    [projects],
  );

  const clearFilters = () => {
    setFilters(emptyFilters);
    setQuery("");
  };

  const openProject = (project: Project) => {
    setActionProject(null);
    const cached = readSectionCache<ProjectWorkspace>(user?.id, `project-workspace:${project.id}`);
    if (cached) {
      setWorkspace(cached.data);
      setWorkspaceSyncedAt(cached.savedAt);
    }
    setSelectedId(project.id);
    setWorkspaceTab("overview");
  };

  const changeSection = (value: ProjectsSection) => {
    setSection(value);
    setSelectedId("");
    setWorkspace(null);
    setWorkspaceTab("overview");
  };

  const openCreateProject = () => {
    setEditingProject(null);
    setProjectForm({
      ...emptyProjectForm,
      project_manager_email: user?.email || "",
    });
    setProjectModal("create");
    void loadProjectOptions();
  };

  const openEditProject = (project: Project) => {
    setEditingProject(project);
    setProjectForm({
      name: project.name,
      client_id: project.client_id || "",
      client_name: project.client_name,
      description: project.description || "",
      status: project.status,
      value_ugx: String(project.value_ugx),
      amount_paid_ugx: String(project.amount_paid_ugx),
      start_date: project.start_date || "",
      due_date: project.due_date || "",
      progress: String(project.progress),
      project_manager_email: project.project_manager_email || "",
      team_emails: project.team_emails,
      tags: project.tags.join(", "),
      current_milestone: project.current_milestone || "",
    });
    setProjectModal("edit");
    setActionProject(null);
  };

  const closeProjectModal = () => {
    if (projectSaving) return;
    if (!confirmDiscardChanges(projectDirty, "Discard these project changes?")) return;
    setProjectModal(null);
    setEditingProject(null);
    setProjectForm(emptyProjectForm);
  };

  const saveProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (projectSaving) return;

    if (!projectForm.name.trim() || !projectForm.client_id) {
      showWarningToast("Project name and client are required.", "Check project details");
      return;
    }

    const value = Number(projectForm.value_ugx || 0);
    const paid = Number(projectForm.amount_paid_ugx || 0);
    const progress = Number(projectForm.progress || 0);

    if (!Number.isFinite(value) || value < 0 || !Number.isFinite(paid) || paid < 0) {
      showWarningToast("Project money values must be valid positive amounts.", "Check finances");
      return;
    }

    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
      showWarningToast("Progress must be between 0 and 100.", "Check progress");
      return;
    }

    const payload = {
      name: projectForm.name.trim(),
      client_id: projectForm.client_id,
      client_name: projectForm.client_name.trim(),
      description: projectForm.description.trim() || null,
      status: projectForm.status,
      value_ugx: value,
      amount_paid_ugx: paid,
      start_date: projectForm.start_date || null,
      due_date: projectForm.due_date || null,
      progress,
      project_manager_email: projectForm.project_manager_email.trim(),
      team_emails: projectForm.team_emails,
      tags: splitList(projectForm.tags),
      current_milestone: projectForm.current_milestone.trim(),
    };

    setProjectSaving(true);
    try {
      const saved =
        projectModal === "edit" && editingProject
          ? await workspaceApi.updateProject(editingProject.id, payload)
          : await workspaceApi.createProject(payload);

      setProjectModal(null);
      setEditingProject(null);
      setProjectForm(emptyProjectForm);
      await loadPortfolio(false);

      if (selectedId === saved.id) await loadWorkspace(saved.id);
      if (projectModal === "create") {
        setSelectedId(saved.id);
        setWorkspaceTab("overview");
      }

      showSuccessToast(
        projectModal === "edit"
          ? "Project details were updated."
          : `${saved.name} was created.`,
        projectModal === "edit" ? "Project updated" : "Project created",
      );
    } catch (error) {
      showErrorToast(
        getErrorMessage(error, "The project could not be saved."),
        "Project not saved",
      );
    } finally {
      setProjectSaving(false);
    }
  };

  const archiveOrRestore = async (project: Project) => {
    const action = project.is_archived ? "restore" : "archive";
    if (
      !window.confirm(
        project.is_archived
          ? `Restore "${project.name}" to active project management?`
          : `Archive "${project.name}"? Its records will remain available in Archived.`,
      )
    ) {
      return;
    }

    setActionBusy(true);
    try {
      if (project.is_archived) await workspaceApi.restoreProject(project.id);
      else await workspaceApi.archiveProject(project.id);

      if (selectedId === project.id && !project.is_archived) {
        setSelectedId("");
        setWorkspace(null);
      }
      setActionProject(null);
      await loadPortfolio(false);
      showSuccessToast(
        project.is_archived ? "Project restored." : "Project archived.",
        project.is_archived ? "Project restored" : "Project archived",
      );
    } catch (error) {
      showErrorToast(
        getErrorMessage(error, `The project could not be ${action}d.`),
        "Project not updated",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const duplicateProject = async (project: Project) => {
    setActionBusy(true);
    try {
      const duplicate = await workspaceApi.duplicateProject(project.id);
      setActionProject(null);
      await loadPortfolio(false);
      showSuccessToast(
        `${duplicate.name} was created as a planning project.`,
        "Project duplicated",
      );
    } catch (error) {
      showErrorToast(
        getErrorMessage(error, "The project could not be duplicated."),
        "Duplicate failed",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const changeStatus = async (project: Project, status: string) => {
    setActionBusy(true);
    try {
      await workspaceApi.updateProject(project.id, {
        status,
        progress: status === "completed" ? 100 : project.progress,
      });
      setActionProject(null);
      await loadPortfolio(false);
      if (selectedId === project.id) await loadWorkspace(project.id);
      showSuccessToast(`Status changed to ${statusLabel(status)}.`, "Project updated");
    } catch (error) {
      showErrorToast(
        getErrorMessage(error, "The project status could not be updated."),
        "Status not changed",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const openTaskModal = (projectId: string, task?: ProjectTask) => {
    setTaskProjectId(projectId);
    setEditingTask(task || null);
    setTaskForm(
      task
        ? {
            title: task.title,
            description: task.description || "",
            status: normalizeTaskStatus(task.status),
            priority: task.priority,
            assignee_email: task.assignee_email || "",
            due_date: task.due_date || "",
          }
        : emptyTaskForm,
    );
    setTaskModalOpen(true);
    setActionProject(null);
  };

  const closeTaskModal = () => {
    if (taskSaving) return;
    if (!confirmDiscardChanges(taskDirty, "Discard these task changes?")) return;
    setTaskModalOpen(false);
    setEditingTask(null);
    setTaskForm(emptyTaskForm);
    setTaskProjectId("");
  };

  const saveTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!taskForm.title.trim() || !taskProjectId) {
      showWarningToast("Task title is required.", "Check task");
      return;
    }

    setTaskSaving(true);
    try {
      const payload = {
        project_id: taskProjectId,
        title: taskForm.title.trim(),
        description: taskForm.description.trim() || null,
        status: taskForm.status,
        priority: taskForm.priority,
        assignee_email: taskForm.assignee_email.trim() || null,
        due_date: taskForm.due_date || null,
      };

      if (editingTask) {
        const { project_id: _projectId, ...update } = payload;
        await workspaceApi.updateTask(editingTask.id, update);
      } else {
        await workspaceApi.createTask(payload);
      }

      setTaskModalOpen(false);
      setEditingTask(null);
      setTaskForm(emptyTaskForm);
      setTaskProjectId("");
      if (selectedId) await loadWorkspace(selectedId);
      await loadPortfolio(false);
      showSuccessToast(
        editingTask ? "Task updated." : "Task added to the project.",
        editingTask ? "Task updated" : "Task created",
      );
    } catch (error) {
      showErrorToast(getErrorMessage(error, "The task could not be saved."), "Task not saved");
    } finally {
      setTaskSaving(false);
    }
  };

  const updateTaskStatus = async (task: ProjectTask, status: string) => {
    try {
      await workspaceApi.updateTask(task.id, { status });
      if (selectedId) await loadWorkspace(selectedId);
      await loadPortfolio(false);
    } catch (error) {
      showErrorToast(
        getErrorMessage(error, "The task status could not be updated."),
        "Task not updated",
      );
    }
  };

  const startUpload = (projectId: string) => {
    setUploadProjectId(projectId);
    setActionProject(null);
    window.setTimeout(() => fileInput.current?.click(), 0);
  };

  const uploadDocument = async (file: File) => {
    const projectId = uploadProjectId || workspace?.project.id;
    if (!projectId || docBusy) return;

    setDocBusy(true);
    try {
      const signed = await workspaceApi.createUploadUrl({
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        project_id: projectId,
      });
      await uploadToPresignedUrl(signed.upload_url, file);
      await workspaceApi.createDocument({
        title: file.name.replace(/\.[^.]+$/, ""),
        original_filename: file.name,
        category: documentCategory,
        content_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        storage_key: signed.storage_key,
        project_id: projectId,
        ocr_status: "not_requested",
        review_status: "not_reviewed",
      });
      if (selectedId === projectId) await loadWorkspace(projectId);
      showSuccessToast("Document uploaded and attached to the project.", "Upload complete");
    } catch (error) {
      showErrorToast(
        getErrorMessage(error, "The document could not be uploaded."),
        "Upload failed",
      );
    } finally {
      setDocBusy(false);
      setUploadProjectId("");
    }
  };

  const updateDocument = async (
    document: DocumentRecord,
    body: Record<string, unknown>,
  ) => {
    try {
      await workspaceApi.updateDocument(document.id, body);
      if (selectedId) await loadWorkspace(selectedId);
    } catch (error) {
      showErrorToast(
        getErrorMessage(error, "The document could not be updated."),
        "Document not updated",
      );
    }
  };

  const openDocument = async (document: DocumentRecord) => {
    try {
      const { url } = await workspaceApi.downloadDocument(document.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      showErrorToast(
        getErrorMessage(error, "The document could not be opened."),
        "Document unavailable",
      );
    }
  };

  const openFinance = (kind: FinanceKind, project: Project) => {
    setFinanceKind(kind);
    setFinanceProject(project);
    setActionProject(null);
    setFinanceForm(makeFinanceForm(kind, project));
  };

  const closeFinance = () => {
    if (financeSaving) return;
    if (!confirmDiscardChanges(financeDirty, "Discard this finance record?")) return;
    setFinanceKind(null);
    setFinanceProject(null);
    setFinanceForm({});
  };

  const saveFinance = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!financeKind || !financeProject) return;

    const amount = Number(financeForm.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      showWarningToast("Enter a valid amount greater than zero.", "Check amount");
      return;
    }

    setFinanceSaving(true);
    try {
      if (financeKind === "quotation") {
        await workspaceApi.createQuotation({
          quotation_number: financeForm.number?.trim(),
          client_id: financeProject.client_id,
          client_name: financeProject.client_name,
          project_id: financeProject.id,
          amount_ugx: amount,
          issue_date: financeForm.issue_date || today(),
          status: "draft",
        });
      } else if (financeKind === "invoice") {
        await workspaceApi.createInvoice({
          invoice_number: financeForm.number?.trim(),
          client_id: financeProject.client_id,
          client_name: financeProject.client_name,
          project_id: financeProject.id,
          amount_ugx: amount,
          paid_amount_ugx: Number(financeForm.paid || 0),
          issue_date: financeForm.issue_date || today(),
          due_date: financeForm.due_date || null,
          status: "draft",
        });
      } else if (financeKind === "payment") {
        await workspaceApi.createPayment({
          project_id: financeProject.id,
          invoice_id: financeForm.invoice_id || null,
          amount_ugx: amount,
          payment_date: financeForm.payment_date || today(),
          method: financeForm.method || "bank",
          reference: financeForm.reference?.trim() || null,
        });
      } else if (financeKind === "purchase") {
        await workspaceApi.createPurchaseOrder({
          po_number: financeForm.number?.trim(),
          supplier_name: financeForm.party?.trim(),
          project_id: financeProject.id,
          amount_ugx: amount,
          order_date: financeForm.order_date || today(),
          status: "draft",
        });
      } else {
        await workspaceApi.createExpense({
          description: financeForm.description?.trim(),
          project_id: financeProject.id,
          amount_ugx: amount,
          expense_date: financeForm.expense_date || today(),
          category: financeForm.category?.trim() || "general",
          reference: financeForm.reference?.trim() || null,
        });
      }

      setFinanceKind(null);
      setFinanceProject(null);
      setFinanceForm({});
      await loadPortfolio(false);
      if (selectedId === financeProject.id) await loadWorkspace(financeProject.id);
      showSuccessToast("The finance record was saved.", "Finance updated");
    } catch (error) {
      showErrorToast(
        getErrorMessage(error, "The finance record could not be saved."),
        "Finance not saved",
      );
    } finally {
      setFinanceSaving(false);
    }
  };

  const renderPortfolioProject = (project: Project) => {
    const health = projectHealth(project);
    const remaining = daysRemaining(project.due_date);

    if (portfolioView === "cards") {
      return (
        <Card key={project.id} className="flex h-full flex-col p-4">
          <div className="flex items-start justify-between gap-3">
            <button className="min-w-0 text-left" onClick={() => openProject(project)}>
              <p className="truncate text-sm font-semibold">{project.name}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {project.client_name}
              </p>
            </button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Actions for ${project.name}`}
              onClick={() => setActionProject(project)}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${healthClass(health.tone)}`}>
              {health.label}
            </span>
            <span className="rounded-full bg-accent px-2 py-1 text-[10px] text-muted-foreground">
              {statusLabel(project.status)}
            </span>
            {project.tags.slice(0, 2).map((tagValue) => (
              <span
                key={tagValue}
                className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground"
              >
                {tagValue}
              </span>
            ))}
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Progress</span>
              <span>{project.progress}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${project.progress}%` }}
              />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-[10px] text-muted-foreground">Value</p>
              <p className="mt-1 font-semibold">{money(project.value_ugx)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Deadline</p>
              <p className="mt-1 font-medium">
                {project.due_date || "Not set"}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Manager</p>
              <p className="mt-1 truncate">
                {project.project_manager_email || "Unassigned"}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Days remaining</p>
              <p className="mt-1">
                {remaining === null
                  ? "—"
                  : remaining < 0
                    ? `${Math.abs(remaining)} overdue`
                    : remaining}
              </p>
            </div>
          </div>
          <Button className="mt-5 w-full" variant="outline" onClick={() => openProject(project)}>
            Open workspace
          </Button>
        </Card>
      );
    }

    if (portfolioView === "timeline") {
      return (
        <Card key={project.id} className="p-4">
          <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)_140px_120px] md:items-center">
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">
                {project.start_date || "No start date"}
              </p>
              <p className="mt-1 text-xs font-medium">
                → {project.due_date || "No deadline"}
              </p>
            </div>
            <button className="text-left" onClick={() => openProject(project)}>
              <p className="font-semibold">{project.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {project.client_name} · {project.current_milestone || "No current milestone"}
              </p>
            </button>
            <div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${project.progress}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {project.progress}% complete
              </p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded-full px-2 py-1 text-[10px] ${healthClass(health.tone)}`}>
                {health.label}
              </span>
              <Button size="icon-sm" variant="ghost" onClick={() => setActionProject(project)}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      );
    }

    if (portfolioView === "calendar") {
      return null;
    }

    return (
      <tr key={project.id} className="border-b border-border last:border-0 hover:bg-accent/20">
        <td className="px-3 py-3">
          <button className="text-left" onClick={() => openProject(project)}>
            <p className="text-sm font-semibold">{project.name}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {project.tags.slice(0, 3).join(" · ") || "No tags"}
            </p>
          </button>
        </td>
        <td className="px-3 py-3 text-xs">{project.client_name}</td>
        <td className="px-3 py-3 text-xs">{statusLabel(project.status)}</td>
        <td className="px-3 py-3">
          <span className={`rounded-full px-2 py-1 text-[10px] ${healthClass(health.tone)}`}>
            {health.label}
          </span>
        </td>
        <td className="px-3 py-3 text-xs">
          <div className="min-w-24">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{project.progress}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${project.progress}%` }}
              />
            </div>
          </div>
        </td>
        <td className="px-3 py-3 text-xs">{project.due_date || "—"}</td>
        <td className="px-3 py-3 text-xs">{money(project.value_ugx)}</td>
        <td className="px-3 py-3 text-xs">
          {project.project_manager_email || "Unassigned"}
        </td>
        <td className="px-3 py-3 text-right">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Actions for ${project.name}`}
            onClick={() => setActionProject(project)}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </td>
      </tr>
    );
  };

  const calendarGroups = (() => {
    const groups = new Map<string, Project[]>();
    filteredProjects.forEach((project) => {
      const key = project.due_date ? project.due_date.slice(0, 7) : "No deadline";
      const rows = groups.get(key) || [];
      rows.push(project);
      groups.set(key, rows);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  })();

  const financeLinkOptions = workspace
    ? [
        ...workspace.finance.quotations.map((item) => ({
          value: `quotation:${item.id}`,
          label: `Quotation ${item.quotation_number}`,
        })),
        ...workspace.finance.invoices.map((item) => ({
          value: `invoice:${item.id}`,
          label: `Invoice ${item.invoice_number}`,
        })),
        ...workspace.finance.payments.map((item) => ({
          value: `payment:${item.id}`,
          label: `Payment ${item.reference || item.payment_date}`,
        })),
        ...workspace.finance.purchase_orders.map((item) => ({
          value: `purchase_order:${item.id}`,
          label: `PO ${item.po_number}`,
        })),
        ...workspace.finance.expenses.map((item) => ({
          value: `expense:${item.id}`,
          label: `Expense ${item.description}`,
        })),
      ]
    : [];

  const workspaceWarnings = workspace
    ? [
        workspace.project.is_archived ? "This project is archived." : "",
        daysRemaining(workspace.project.due_date) !== null &&
        (daysRemaining(workspace.project.due_date) as number) < 0 &&
        workspace.project.status !== "completed"
          ? "The project deadline has passed."
          : "",
        !workspace.project.project_manager_email ? "No project manager is assigned." : "",
        workspace.tasks.some(
          (task) =>
            task.status !== "completed" &&
            task.priority === "high" &&
            task.due_date &&
            task.due_date < today(),
        )
          ? "A high-priority task is overdue."
          : "",
        workspace.finance.invoice_outstanding_ugx > 0
          ? "There is outstanding invoiced revenue."
          : "",
      ].filter(Boolean)
    : [];

  const completedTasks =
    workspace?.tasks.filter((task) => normalizeTaskStatus(task.status) === "completed").length || 0;

  const taskColumns = [
    { id: "todo", label: "To Do" },
    { id: "in_progress", label: "In Progress" },
    { id: "review", label: "Review" },
    { id: "completed", label: "Completed" },
  ];

  const workspaceTabs = [
    { id: "overview" as const, label: "Overview", icon: FolderKanban },
    { id: "tasks" as const, label: "Tasks", icon: CheckCircle2 },
    { id: "documents" as const, label: "Documents", icon: FileText },
    { id: "finance" as const, label: "Finance", icon: WalletCards },
    { id: "inventory" as const, label: "Inventory", icon: Boxes },
    { id: "activity" as const, label: "Activity", icon: Activity },
  ];

  return (
    <div className="space-y-6">
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        accept=".pdf,image/*,.doc,.docx,.xls,.xlsx"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadDocument(file);
          event.currentTarget.value = "";
        }}
      />

      {!workspace && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Projects</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Company-wide project control, delivery, documents, teams and money.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SyncStatus isRefreshing={isRefreshing} error={loadError} lastSyncedAt={lastSyncedAt} />
              <Button className="gap-2" onClick={openCreateProject}>
                <Plus className="h-4 w-4" /> New project
              </Button>
            </div>
          </div>

          <SectionNav
            items={sections}
            active={section}
            onChange={changeSection}
            ariaLabel="Project sections"
          />

          {section === "overview" && dashboard && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {metricCard("Total Projects", dashboard.total_projects, undefined, <FolderKanban className="h-4 w-4" />)}
                {metricCard("Active Projects", dashboard.active_projects)}
                {metricCard("Planning", dashboard.planning_projects)}
                {metricCard("Overdue", dashboard.overdue_projects, undefined, <AlertTriangle className="h-4 w-4" />)}
                {metricCard("Completed", dashboard.completed_projects, undefined, <CheckCircle2 className="h-4 w-4" />)}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {metricCard("Total Project Value", money(dashboard.total_project_value_ugx))}
                {metricCard("Amount Received", money(dashboard.amount_received_ugx), undefined, <Banknote className="h-4 w-4" />)}
                {metricCard("Outstanding", money(dashboard.outstanding_ugx), undefined, <WalletCards className="h-4 w-4" />)}
                {metricCard("Tasks Due", dashboard.tasks_due, "Due today or overdue")}
                {metricCard("Needs Attention", dashboard.projects_needing_attention, undefined, <AlertTriangle className="h-4 w-4" />)}
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">Projects needing attention</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Overdue, unassigned or low-progress active work.
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setSection("all")}>
                      View all
                    </Button>
                  </div>
                  <div className="mt-4 space-y-2">
                    {attentionProjects.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No projects need immediate attention.
                      </p>
                    ) : (
                      attentionProjects.map((project) => {
                        const health = projectHealth(project);
                        return (
                          <button
                            key={project.id}
                            onClick={() => openProject(project)}
                            className="flex w-full items-center justify-between gap-4 rounded-lg border border-border p-3 text-left hover:bg-accent/30"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{project.name}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {project.client_name} · {project.progress}% complete
                              </p>
                            </div>
                            <span className={`rounded-full px-2 py-1 text-[10px] ${healthClass(health.tone)}`}>
                              {health.label}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </Card>

                <Card>
                  <div>
                    <h2 className="font-semibold">Recently updated</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The latest project folders your team has worked on.
                    </p>
                  </div>
                  <div className="mt-4 space-y-2">
                    {recentProjects.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No projects yet.
                      </p>
                    ) : (
                      recentProjects.map((project) => (
                        <button
                          key={project.id}
                          onClick={() => openProject(project)}
                          className="flex w-full items-center justify-between gap-4 rounded-lg border border-border p-3 text-left hover:bg-accent/30"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{project.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {project.client_name} · {statusLabel(project.status)}
                            </p>
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(project.updated_at).toLocaleDateString()}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </Card>
              </div>
            </div>
          )}

          <Card className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[240px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search projects, clients, managers, milestones or tags..."
                  className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                />
              </div>
              <Button
                variant={filtersOpen ? "secondary" : "outline"}
                className="gap-2"
                onClick={() => setFiltersOpen((value) => !value)}
              >
                <Filter className="h-4 w-4" /> Filters
              </Button>
              <div className="flex rounded-lg border border-border p-1">
                {[
                  { id: "table" as const, label: "Table", icon: List },
                  { id: "cards" as const, label: "Cards", icon: LayoutGrid },
                  { id: "timeline" as const, label: "Timeline", icon: Clock3 },
                  { id: "calendar" as const, label: "Calendar", icon: CalendarDays },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    title={label}
                    onClick={() => setPortfolioView(id)}
                    className={
                      portfolioView === id
                        ? "flex items-center gap-1 rounded-md bg-accent px-2 py-1.5 text-xs font-medium"
                        : "flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/60"
                    }
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden xl:inline">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {filtersOpen && (
              <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                <div>
                  <label className="mb-1 block text-[10px] uppercase text-muted-foreground">Status</label>
                  <select
                    className={selectClass}
                    value={filters.status}
                    onChange={(event) =>
                      setFilters((previous) => ({ ...previous, status: event.target.value }))
                    }
                  >
                    <option value="">Any status</option>
                    <option value="planning">Planning</option>
                    <option value="active">Active</option>
                    <option value="on_hold">On Hold</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase text-muted-foreground">Client</label>
                  <select
                    className={selectClass}
                    value={filters.client}
                    onChange={(event) =>
                      setFilters((previous) => ({ ...previous, client: event.target.value }))
                    }
                  >
                    <option value="">Any client</option>
                    {clients.map((client) => (
                      <option key={client} value={client}>{client}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase text-muted-foreground">Project manager</label>
                  <select
                    className={selectClass}
                    value={filters.manager}
                    onChange={(event) =>
                      setFilters((previous) => ({ ...previous, manager: event.target.value }))
                    }
                  >
                    <option value="">Any manager</option>
                    {managers.map((manager) => (
                      <option key={manager} value={manager}>{manager}</option>
                    ))}
                  </select>
                </div>
                <Input
                  label="Start date from"
                  type="date"
                  value={filters.start_from}
                  onChange={(event) =>
                    setFilters((previous) => ({ ...previous, start_from: event.target.value }))
                  }
                />
                <Input
                  label="Start date to"
                  type="date"
                  value={filters.start_to}
                  onChange={(event) =>
                    setFilters((previous) => ({ ...previous, start_to: event.target.value }))
                  }
                />
                <Input
                  label="Deadline from"
                  type="date"
                  value={filters.deadline_from}
                  onChange={(event) =>
                    setFilters((previous) => ({ ...previous, deadline_from: event.target.value }))
                  }
                />
                <Input
                  label="Deadline to"
                  type="date"
                  value={filters.deadline_to}
                  onChange={(event) =>
                    setFilters((previous) => ({ ...previous, deadline_to: event.target.value }))
                  }
                />
                <Input
                  label="Progress min %"
                  type="number"
                  min="0"
                  max="100"
                  value={filters.progress_min}
                  onChange={(event) =>
                    setFilters((previous) => ({ ...previous, progress_min: event.target.value }))
                  }
                />
                <Input
                  label="Progress max %"
                  type="number"
                  min="0"
                  max="100"
                  value={filters.progress_max}
                  onChange={(event) =>
                    setFilters((previous) => ({ ...previous, progress_max: event.target.value }))
                  }
                />
                <Input
                  label="Value min UGX"
                  type="number"
                  min="0"
                  value={filters.value_min}
                  onChange={(event) =>
                    setFilters((previous) => ({ ...previous, value_min: event.target.value }))
                  }
                />
                <Input
                  label="Value max UGX"
                  type="number"
                  min="0"
                  value={filters.value_max}
                  onChange={(event) =>
                    setFilters((previous) => ({ ...previous, value_max: event.target.value }))
                  }
                />
                <div>
                  <label className="mb-1 block text-[10px] uppercase text-muted-foreground">Tag</label>
                  <select
                    className={selectClass}
                    value={filters.tag}
                    onChange={(event) =>
                      setFilters((previous) => ({ ...previous, tag: event.target.value }))
                    }
                  >
                    <option value="">Any tag</option>
                    {tags.map((tagValue) => (
                      <option key={tagValue} value={tagValue}>{tagValue}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
              <div>
                <p className="text-sm font-semibold">
                  {sections.find((item) => item.id === section)?.label || "Projects"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {filteredProjects.length} project{filteredProjects.length === 1 ? "" : "s"} shown
                </p>
              </div>
              {(query || Object.values(filters).some(Boolean)) && (
                <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] text-primary">
                  Filters active
                </span>
              )}
            </div>

            {filteredProjects.length === 0 ? (
              <div className="py-16 text-center">
                <FolderKanban className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 font-medium">No projects match this view</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Change the filters or create a new project.
                </p>
              </div>
            ) : portfolioView === "table" ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-border text-[10px] uppercase text-muted-foreground">
                      <th className="px-3 py-2">Project</th>
                      <th className="px-3 py-2">Client</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Health</th>
                      <th className="px-3 py-2">Progress</th>
                      <th className="px-3 py-2">Deadline</th>
                      <th className="px-3 py-2">Value</th>
                      <th className="px-3 py-2">Manager</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>{filteredProjects.map(renderPortfolioProject)}</tbody>
                </table>
              </div>
            ) : portfolioView === "cards" ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredProjects.map(renderPortfolioProject)}
              </div>
            ) : portfolioView === "timeline" ? (
              <div className="space-y-3">
                {[...filteredProjects]
                  .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"))
                  .map(renderPortfolioProject)}
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {calendarGroups.map(([month, rows]) => (
                  <Card key={month}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold">
                          {month === "No deadline"
                            ? month
                            : new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, {
                                month: "long",
                                year: "numeric",
                              })}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {rows.length} deadline{rows.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-4 space-y-2">
                      {rows
                        .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""))
                        .map((project) => (
                          <button
                            key={project.id}
                            className="w-full rounded-lg border border-border p-3 text-left hover:bg-accent/30"
                            onClick={() => openProject(project)}
                          >
                            <div className="flex justify-between gap-3">
                              <p className="text-sm font-medium">{project.name}</p>
                              <span className="text-[10px] text-muted-foreground">
                                {project.due_date?.slice(8) || "—"}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {project.client_name} · {project.progress}%
                            </p>
                          </button>
                        ))}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {workspace && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
              onClick={() => {
                setSelectedId("");
                setWorkspace(null);
                setWorkspaceSyncedAt(null);
                setWorkspaceTab("overview");
              }}
            >
              <ArrowLeft className="h-4 w-4" /> Back to Projects
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <SyncStatus isRefreshing={workspaceLoading} error={loadError} lastSyncedAt={workspaceSyncedAt} />
              <Button variant="outline" size="sm" onClick={() => openEditProject(workspace.project)}>
                <Edit3 className="h-4 w-4" /> Edit project
              </Button>
              <Button size="sm" onClick={() => setActionProject(workspace.project)}>
                Actions
              </Button>
            </div>
          </div>

          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-bold">{workspace.project.name}</h1>
                  <span className={`rounded-full px-2 py-1 text-[10px] ${healthClass(projectHealth(workspace.project).tone)}`}>
                    {projectHealth(workspace.project).label}
                  </span>
                  <span className="rounded-full bg-accent px-2 py-1 text-[10px] text-muted-foreground">
                    {statusLabel(workspace.project.status)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {workspace.project.client_name}
                  {workspace.project.current_milestone
                    ? ` · ${workspace.project.current_milestone}`
                    : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Project value</p>
                <p className="text-lg font-bold">{money(workspace.project.value_ugx)}</p>
              </div>
            </div>

            <div className="mt-5 flex gap-2 overflow-x-auto border-t border-border pt-4">
              {workspaceTabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setWorkspaceTab(id)}
                  className={
                    workspaceTab === id
                      ? "flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                      : "flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
                  }
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
          </Card>

          {workspaceTab === "overview" && (
            <div className="space-y-4">
              {workspaceWarnings.length > 0 && (
                <Card className="border-amber-500/30 bg-amber-500/5">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
                    <div>
                      <h3 className="font-semibold">Project warnings</h3>
                      <div className="mt-2 space-y-1">
                        {workspaceWarnings.map((warning) => (
                          <p key={warning} className="text-sm text-muted-foreground">• {warning}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                {metricCard("Project Health", projectHealth(workspace.project).label)}
                {metricCard("Progress", `${workspace.project.progress}%`)}
                {metricCard(
                  "Task Completion",
                  `${completedTasks}/${workspace.tasks.length}`,
                  workspace.tasks.length
                    ? `${Math.round((completedTasks / workspace.tasks.length) * 100)}% complete`
                    : "No tasks yet",
                )}
                {metricCard("Documents", workspace.documents.length)}
                {metricCard(
                  "Days Remaining",
                  daysRemaining(workspace.project.due_date) === null
                    ? "—"
                    : (daysRemaining(workspace.project.due_date) as number) < 0
                      ? `${Math.abs(daysRemaining(workspace.project.due_date) as number)} overdue`
                      : daysRemaining(workspace.project.due_date),
                )}
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
                <Card>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold">Project overview</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Delivery ownership, milestone, team and schedule.
                      </p>
                    </div>
                    <span className="text-xs font-semibold">{workspace.project.progress}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${workspace.project.progress}%` }}
                    />
                  </div>
                  <p className="mt-5 text-sm leading-6 text-muted-foreground">
                    {workspace.project.description || "No project description has been added yet."}
                  </p>
                  <div className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Client</p>
                      <p className="mt-1 text-sm font-medium">{workspace.project.client_name}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Manager</p>
                      <p className="mt-1 break-all text-sm">
                        {workspace.project.project_manager_email || "Not assigned"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Current milestone</p>
                      <p className="mt-1 text-sm">
                        {workspace.project.current_milestone || "Not set"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Start date</p>
                      <p className="mt-1 text-sm">{workspace.project.start_date || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Deadline</p>
                      <p className="mt-1 text-sm">{workspace.project.due_date || "Not set"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Assigned staff</p>
                      <p className="mt-1 text-sm">{workspace.project.team_emails.length}</p>
                    </div>
                  </div>
                  <div className="mt-5 border-t border-border pt-4">
                    <p className="text-[10px] uppercase text-muted-foreground">Team</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {workspace.project.team_emails.length === 0 ? (
                        <span className="text-sm text-muted-foreground">No staff assigned.</span>
                      ) : (
                        workspace.project.team_emails.map((email) => (
                          <span key={email} className="rounded-full bg-accent px-3 py-1 text-xs">
                            {email}
                          </span>
                        ))
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {workspace.project.tags.map((tagValue) => (
                        <span key={tagValue} className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground">
                          <Tag className="h-3 w-3" /> {tagValue}
                        </span>
                      ))}
                    </div>
                  </div>
                </Card>

                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                    {metricCard("Project Value", money(workspace.finance.project_value_ugx))}
                    {metricCard("Paid / Received", money(workspace.finance.amount_paid_ugx))}
                    {metricCard("Outstanding", money(workspace.finance.project_outstanding_ugx))}
                  </div>
                  <Card>
                    <h3 className="font-semibold">Recent activity</h3>
                    <div className="mt-3 space-y-3">
                      {workspace.activity.slice(0, 5).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No activity yet.</p>
                      ) : (
                        workspace.activity.slice(0, 5).map((item) => (
                          <div key={item.id} className="border-l-2 border-primary/30 pl-3">
                            <p className="text-xs font-medium">{item.summary}</p>
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {new Date(item.created_at).toLocaleString()}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </Card>
                </div>
              </div>
            </div>
          )}

          {workspaceTab === "tasks" && (
            <div className="space-y-4">
              <Card className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="font-semibold">Project tasks</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Move work through To Do, In Progress, Review and Completed.
                  </p>
                </div>
                <Button onClick={() => openTaskModal(workspace.project.id)}>
                  <Plus className="h-4 w-4" /> Add task
                </Button>
              </Card>

              <div className="grid gap-4 xl:grid-cols-4">
                {taskColumns.map((column) => {
                  const columnTasks = workspace.tasks.filter(
                    (task) => normalizeTaskStatus(task.status) === column.id,
                  );
                  return (
                    <Card key={column.id} className="min-h-[320px] p-3">
                      <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
                        <p className="text-sm font-semibold">{column.label}</p>
                        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px]">
                          {columnTasks.length}
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {columnTasks.length === 0 ? (
                          <p className="py-8 text-center text-xs text-muted-foreground">
                            No tasks
                          </p>
                        ) : (
                          columnTasks.map((task) => (
                            <div key={task.id} className="rounded-lg border border-border p-3">
                              <button
                                className="w-full text-left"
                                onClick={() => openTaskModal(workspace.project.id, task)}
                              >
                                <p className="text-sm font-medium">{task.title}</p>
                                {task.description && (
                                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                    {task.description}
                                  </p>
                                )}
                              </button>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                <span className={
                                  task.priority === "high"
                                    ? "rounded-full bg-destructive/10 px-2 py-1 text-[10px] text-destructive"
                                    : task.priority === "low"
                                      ? "rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground"
                                      : "rounded-full bg-amber-500/10 px-2 py-1 text-[10px] text-amber-500"
                                }>
                                  {task.priority} priority
                                </span>
                                {task.due_date && (
                                  <span className="rounded-full bg-accent px-2 py-1 text-[10px] text-muted-foreground">
                                    Due {task.due_date}
                                  </span>
                                )}
                              </div>
                              <p className="mt-2 break-all text-[10px] text-muted-foreground">
                                {task.assignee_email || "Unassigned"}
                              </p>
                              <select
                                className={`${selectClass} mt-3 h-8 text-xs`}
                                value={normalizeTaskStatus(task.status)}
                                onChange={(event) =>
                                  void updateTaskStatus(task, event.target.value)
                                }
                              >
                                {taskColumns.map((option) => (
                                  <option key={option.id} value={option.id}>{option.label}</option>
                                ))}
                              </select>
                            </div>
                          ))
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {workspaceTab === "documents" && (
            <div className="space-y-4">
              <Card className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h3 className="font-semibold">Project documents</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Upload, classify, review and open files attached to this project.
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="mb-1 block text-[10px] uppercase text-muted-foreground">
                      Upload category
                    </label>
                    <select
                      className={selectClass}
                      value={documentCategory}
                      onChange={(event) => setDocumentCategory(event.target.value)}
                    >
                      <option value="other">Other</option>
                      <option value="contract">Contract</option>
                      <option value="quotation">Quotation</option>
                      <option value="invoice">Invoice</option>
                      <option value="purchase_order">Purchase Order</option>
                      <option value="receipt">Receipt</option>
                      <option value="report">Report</option>
                    </select>
                  </div>
                  <Button
                    className="gap-2"
                    isLoading={docBusy}
                    onClick={() => startUpload(workspace.project.id)}
                  >
                    <UploadCloud className="h-4 w-4" /> Upload
                  </Button>
                </div>
              </Card>

              {workspace.documents.length === 0 ? (
                <Card className="py-14 text-center">
                  <FileText className="mx-auto h-9 w-9 text-muted-foreground" />
                  <p className="mt-3 font-medium">No project documents yet</p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {workspace.documents.map((document) => (
                    <Card key={document.id} className="p-4">
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_150px_120px_180px_220px_auto] lg:items-center">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{document.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {document.original_filename} · {Math.max(1, Math.round(document.size_bytes / 1024))} KB
                          </p>
                          {document.related_record_type && (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              Related to {document.related_record_type.replaceAll("_", " ")}
                            </p>
                          )}
                        </div>
                        <select
                          className={selectClass}
                          value={document.category}
                          onChange={(event) =>
                            void updateDocument(document, { category: event.target.value })
                          }
                        >
                          <option value="other">Other</option>
                          <option value="contract">Contract</option>
                          <option value="quotation">Quotation</option>
                          <option value="invoice">Invoice</option>
                          <option value="purchase_order">Purchase Order</option>
                          <option value="receipt">Receipt</option>
                          <option value="report">Report</option>
                        </select>
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground">OCR</p>
                          <p className="mt-1 text-xs font-medium">
                            {document.ocr_status.replaceAll("_", " ")}
                          </p>
                        </div>
                        <select
                          className={selectClass}
                          value={document.review_status}
                          onChange={(event) =>
                            void updateDocument(document, { review_status: event.target.value })
                          }
                        >
                          <option value="not_reviewed">Not reviewed</option>
                          <option value="needs_review">Needs review</option>
                          <option value="reviewed">Reviewed</option>
                          <option value="approved">Approved</option>
                        </select>
                        <select
                          className={selectClass}
                          value={
                            document.related_record_type && document.related_record_id
                              ? `${document.related_record_type}:${document.related_record_id}`
                              : ""
                          }
                          onChange={(event) => {
                            const value = event.target.value;
                            if (!value) {
                              void updateDocument(document, { related_record_type: "" });
                              return;
                            }
                            const [related_record_type, related_record_id] = value.split(":", 2);
                            void updateDocument(document, {
                              related_record_type,
                              related_record_id,
                            });
                          }}
                        >
                          <option value="">No finance link</option>
                          {financeLinkOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-2"
                          onClick={() => void openDocument(document)}
                        >
                          <Download className="h-3.5 w-3.5" /> Open
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {workspaceTab === "finance" && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {metricCard("Project Value", money(workspace.finance.project_value_ugx))}
                {metricCard("Received", money(workspace.finance.amount_paid_ugx))}
                {metricCard("Outstanding", money(workspace.finance.project_outstanding_ugx))}
                {metricCard("Expenses", money(workspace.finance.expenses_ugx))}
                {metricCard("Purchase Orders", money(workspace.finance.purchase_orders_ugx))}
              </div>

              <Card>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">Project finance</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Quotations, invoices, payments, purchase orders and expenses.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openFinance("quotation", workspace.project)}>New quote</Button>
                    <Button size="sm" variant="outline" onClick={() => openFinance("invoice", workspace.project)}>New invoice</Button>
                    <Button size="sm" variant="outline" onClick={() => openFinance("payment", workspace.project)}>Record payment</Button>
                    <Button size="sm" variant="outline" onClick={() => openFinance("purchase", workspace.project)}>New PO</Button>
                    <Button size="sm" onClick={() => openFinance("expense", workspace.project)}>Add expense</Button>
                  </div>
                </div>

                <div className="mt-5 flex gap-2 overflow-x-auto border-b border-border pb-3">
                  {[
                    { id: "quotations" as const, label: "Quotations", count: workspace.finance.quotations.length },
                    { id: "invoices" as const, label: "Invoices", count: workspace.finance.invoices.length },
                    { id: "payments" as const, label: "Payments", count: workspace.finance.payments.length },
                    { id: "purchase_orders" as const, label: "Purchase Orders", count: workspace.finance.purchase_orders.length },
                    { id: "expenses" as const, label: "Expenses", count: workspace.finance.expenses.length },
                  ].map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setFinanceView(item.id)}
                      className={
                        financeView === item.id
                          ? "rounded-lg bg-accent px-3 py-2 text-xs font-semibold"
                          : "rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-accent/50"
                      }
                    >
                      {item.label} <span className="ml-1 opacity-60">{item.count}</span>
                    </button>
                  ))}
                </div>

                <div className="mt-4">
                  {financeView === "quotations" && (
                    <div className="space-y-2">
                      {workspace.finance.quotations.length === 0 ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">No quotations.</p>
                      ) : workspace.finance.quotations.map((item) => (
                        <div key={item.id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_160px_120px]">
                          <div><p className="text-sm font-medium">{item.quotation_number}</p><p className="text-xs text-muted-foreground">{item.issue_date}</p></div>
                          <p className="text-sm font-semibold">{money(item.amount_ugx)}</p>
                          <p className="text-xs text-muted-foreground">{item.status}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {financeView === "invoices" && (
                    <div className="space-y-2">
                      {workspace.finance.invoices.length === 0 ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">No invoices.</p>
                      ) : workspace.finance.invoices.map((item) => (
                        <div key={item.id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_150px_150px_100px]">
                          <div><p className="text-sm font-medium">{item.invoice_number}</p><p className="text-xs text-muted-foreground">Due {item.due_date || "—"}</p></div>
                          <div><p className="text-[10px] text-muted-foreground">Invoice</p><p className="text-sm font-semibold">{money(item.amount_ugx)}</p></div>
                          <div><p className="text-[10px] text-muted-foreground">Paid</p><p className="text-sm font-semibold">{money(item.paid_amount_ugx)}</p></div>
                          <p className="text-xs text-muted-foreground">{item.status}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {financeView === "payments" && (
                    <div className="space-y-2">
                      <div className="mb-4 grid gap-3 sm:grid-cols-2">
                        {metricCard("Payments recorded", money(workspace.finance.payment_total_ugx))}
                        {metricCard("Invoice paid total", money(workspace.finance.invoice_paid_ugx))}
                      </div>
                      {workspace.finance.payments.length === 0 ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">No payments recorded.</p>
                      ) : workspace.finance.payments.map((item) => (
                        <div key={item.id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_150px_120px]">
                          <div><p className="text-sm font-medium">{item.reference || "Payment"}</p><p className="text-xs text-muted-foreground">{item.payment_date} · {item.method}</p></div>
                          <p className="text-sm font-semibold">{money(item.amount_ugx)}</p>
                          <p className="text-xs text-muted-foreground">{item.invoice_id ? "Linked invoice" : "Project payment"}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {financeView === "purchase_orders" && (
                    <div className="space-y-2">
                      {workspace.finance.purchase_orders.length === 0 ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">No purchase orders.</p>
                      ) : workspace.finance.purchase_orders.map((item) => (
                        <div key={item.id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_160px_110px]">
                          <div><p className="text-sm font-medium">{item.po_number}</p><p className="text-xs text-muted-foreground">{item.supplier_name}</p></div>
                          <p className="text-sm font-semibold">{money(item.amount_ugx)}</p>
                          <p className="text-xs text-muted-foreground">{item.status}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {financeView === "expenses" && (
                    <div className="space-y-2">
                      {workspace.finance.expenses.length === 0 ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">No expenses.</p>
                      ) : workspace.finance.expenses.map((item) => (
                        <div key={item.id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_160px_120px]">
                          <div><p className="text-sm font-medium">{item.description}</p><p className="text-xs text-muted-foreground">{item.category} · {item.expense_date}</p></div>
                          <p className="text-sm font-semibold">{money(item.amount_ugx)}</p>
                          <p className="text-xs text-muted-foreground">{item.reference || "—"}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            </div>
          )}

          {workspaceTab === "inventory" && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                {metricCard("Items Assigned", new Set(projectStock.map((row) => row.item_id)).size)}
                {metricCard("Quantity Assigned", projectStock.reduce((sum, row) => sum + row.quantity, 0).toLocaleString())}
                {metricCard("Stock Value", money(projectStock.reduce((sum, row) => sum + row.value_ugx, 0)))}
              </div>
              <Card className="overflow-x-auto">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Project inventory</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Stock allocated to this project, including its current warehouse and storage location.</p>
                  </div>
                  {projectStockLoading && <span className="text-xs text-muted-foreground">Updating…</span>}
                </div>
                {projectStock.length === 0 ? (
                  <div className="py-12 text-center">
                    <Boxes className="mx-auto h-9 w-9 text-muted-foreground" />
                    <p className="mt-3 font-medium">No stock allocated to this project</p>
                    <p className="mt-1 text-sm text-muted-foreground">Use Inventory → Stock Movement → Project Allocation to assign items.</p>
                  </div>
                ) : (
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="text-xs text-muted-foreground"><tr><th className="pb-3">SKU</th><th className="pb-3">Item</th><th className="pb-3">Warehouse</th><th className="pb-3">Location</th><th className="pb-3 text-right">Quantity</th><th className="pb-3 text-right">Unit Cost</th><th className="pb-3 text-right">Value</th></tr></thead>
                    <tbody>{projectStock.map((row) => <tr key={row.id} className="border-t border-border"><td className="py-3 font-mono text-xs">{row.item_sku}</td><td className="py-3 font-medium">{row.item_name}</td><td className="py-3">{row.warehouse_name}</td><td className="py-3">{row.location_name || "Warehouse root"}</td><td className="py-3 text-right">{row.quantity.toLocaleString()}</td><td className="py-3 text-right">{money(row.unit_cost_ugx)}</td><td className="py-3 text-right font-semibold">{money(row.value_ugx)}</td></tr>)}</tbody>
                  </table>
                )}
              </Card>
            </div>
          )}

          {workspaceTab === "activity" && (
            <Card>
              <div>
                <h3 className="font-semibold">Project activity</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Human-readable timeline of project, task, document and finance changes.
                </p>
              </div>
              <div className="mt-5 space-y-3">
                {workspace.activity.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No activity recorded yet.
                  </p>
                ) : (
                  workspace.activity.map((item) => (
                    <div key={item.id} className="flex gap-3">
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Activity className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1 rounded-lg border border-border p-3">
                        <p className="text-sm font-medium">{item.summary}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {new Date(item.created_at).toLocaleString()}
                          {item.changed_by ? ` · ${item.changed_by}` : ""}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          )}
        </div>
      )}

      <Modal
        isOpen={Boolean(projectModal)}
        onClose={closeProjectModal}
        title={projectModal === "edit" ? "Edit project" : "New project"}
        description="Set the project essentials, ownership, schedule and delivery context."
        className="max-w-3xl"
      >
        <form onSubmit={saveProject} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Project name" value={projectForm.name} onChange={(event) => setProjectForm((previous) => ({ ...previous, name: event.target.value }))} required />
            <div>
              <label className="mb-1.5 block text-xs font-medium">Client</label>
              <select
                className={selectClass}
                value={projectForm.client_id}
                onChange={(event) => {
                  const selected = availableClients.find((client) => client.id === event.target.value);
                  setProjectForm((previous) => ({
                    ...previous,
                    client_id: event.target.value,
                    client_name: selected?.name || "",
                  }));
                }}
                required
                disabled={projectOptionsLoading}
              >
                <option value="">{projectOptionsLoading ? "Loading clients..." : "Select client"}</option>
                {availableClients.map((client) => (
                  <option key={client.id} value={client.id} disabled={!client.is_active}>
                    {client.name}{client.is_active ? "" : " (inactive)"}
                  </option>
                ))}
              </select>
              {projectOptionsError && (
                <p className="mt-1 text-xs text-destructive">{projectOptionsError}</p>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium">Description</label>
            <textarea
              className={textareaClass}
              value={projectForm.description}
              onChange={(event) =>
                setProjectForm((previous) => ({ ...previous, description: event.target.value }))
              }
              placeholder="What is this project delivering?"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium">Status</label>
              <select
                className={selectClass}
                value={projectForm.status}
                onChange={(event) =>
                  setProjectForm((previous) => ({ ...previous, status: event.target.value }))
                }
              >
                <option value="planning">Planning</option>
                <option value="active">Active</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <Input
              label="Progress %"
              type="number"
              min="0"
              max="100"
              value={projectForm.progress}
              onChange={(event) =>
                setProjectForm((previous) => ({ ...previous, progress: event.target.value }))
              }
            />
            <Input
              label="Current milestone"
              value={projectForm.current_milestone}
              onChange={(event) =>
                setProjectForm((previous) => ({
                  ...previous,
                  current_milestone: event.target.value,
                }))
              }
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              label="Project value UGX"
              type="number"
              min="0"
              value={projectForm.value_ugx}
              onChange={(event) =>
                setProjectForm((previous) => ({ ...previous, value_ugx: event.target.value }))
              }
            />
            <Input
              label="Amount received UGX"
              type="number"
              min="0"
              value={projectForm.amount_paid_ugx}
              onChange={(event) =>
                setProjectForm((previous) => ({
                  ...previous,
                  amount_paid_ugx: event.target.value,
                }))
              }
            />
            <Input
              label="Start date"
              type="date"
              value={projectForm.start_date}
              onChange={(event) =>
                setProjectForm((previous) => ({ ...previous, start_date: event.target.value }))
              }
            />
            <Input
              label="Deadline"
              type="date"
              value={projectForm.due_date}
              onChange={(event) =>
                setProjectForm((previous) => ({ ...previous, due_date: event.target.value }))
              }
            />
          </div>

          <Input
            label="Project manager email"
            type="email"
            value={projectForm.project_manager_email}
            readOnly
            helperText={projectModal === "create"
              ? "Automatically set to the currently signed-in Star Africa Logistics user."
              : "The project manager is managed by the system and is not free text."}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium">Assigned staff</label>
              <select
                className={selectClass}
                value=""
                disabled={projectOptionsLoading}
                onChange={(event) => {
                  const email = event.target.value;
                  if (!email) return;
                  setProjectForm((previous) => ({
                    ...previous,
                    team_emails: previous.team_emails.includes(email)
                      ? previous.team_emails
                      : [...previous.team_emails, email],
                  }));
                }}
              >
                <option value="">{projectOptionsLoading ? "Loading staff..." : "Add staff member"}</option>
                {assignableUsers
                  .filter((staff) => staff.email !== projectForm.project_manager_email)
                  .filter((staff) => !projectForm.team_emails.includes(staff.email))
                  .map((staff) => (
                    <option key={staff.id} value={staff.email}>
                      {staff.full_name} ? {staff.email}
                    </option>
                  ))}
              </select>
              <div className="mt-2 flex min-h-8 flex-wrap gap-2">
                {projectForm.team_emails.length ? projectForm.team_emails.map((email) => (
                  <button
                    key={email}
                    type="button"
                    className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-foreground hover:bg-muted/80"
                    onClick={() =>
                      setProjectForm((previous) => ({
                        ...previous,
                        team_emails: previous.team_emails.filter((item) => item !== email),
                      }))
                    }
                    title="Remove assigned staff"
                  >
                    {email} ?
                  </button>
                )) : (
                  <span className="text-xs text-muted-foreground">No additional staff assigned.</span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Only active Star Africa Logistics users can be selected.</p>
            </div>
            <Input
              label="Tags"
              value={projectForm.tags}
              onChange={(event) =>
                setProjectForm((previous) => ({ ...previous, tags: event.target.value }))
              }
              helperText="Example: Priority, MTN, Installation"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={closeProjectModal} disabled={projectSaving}>
              Cancel
            </Button>
            <Button type="submit" isLoading={projectSaving}>
              {projectModal === "edit" ? "Save changes" : "Create project"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(actionProject)}
        onClose={() => !actionBusy && setActionProject(null)}
        title={actionProject ? `${actionProject.name} — Actions` : "Project actions"}
        description="Choose what you need to do with this project."
        className="max-w-2xl"
      >
        {actionProject && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Button variant="outline" className="justify-start" onClick={() => openProject(actionProject)}>
              <FolderKanban className="h-4 w-4" /> Open workspace
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => openEditProject(actionProject)}>
              <Edit3 className="h-4 w-4" /> Edit project
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => openEditProject(actionProject)}>
              <Users className="h-4 w-4" /> Assign manager
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => openEditProject(actionProject)}>
              <Users className="h-4 w-4" /> Assign team
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => void duplicateProject(actionProject)} isLoading={actionBusy}>
              <Copy className="h-4 w-4" /> Duplicate project
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => openTaskModal(actionProject.id)}>
              <CheckCircle2 className="h-4 w-4" /> Add task
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => startUpload(actionProject.id)}>
              <UploadCloud className="h-4 w-4" /> Upload document
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => openFinance("quotation", actionProject)}>
              <FileCheck2 className="h-4 w-4" /> Create quotation
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => openFinance("invoice", actionProject)}>
              <Receipt className="h-4 w-4" /> Create invoice
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => openFinance("purchase", actionProject)}>
              <ShoppingCart className="h-4 w-4" /> Create purchase order
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => openFinance("expense", actionProject)}>
              <Banknote className="h-4 w-4" /> Add expense
            </Button>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium">Change status</label>
              <select
                className={selectClass}
                value={actionProject.status}
                onChange={(event) => void changeStatus(actionProject, event.target.value)}
                disabled={actionBusy}
              >
                <option value="planning">Planning</option>
                <option value="active">Active</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <Button
              variant={actionProject.is_archived ? "outline" : "destructive"}
              className="justify-start sm:col-span-2"
              onClick={() => void archiveOrRestore(actionProject)}
              isLoading={actionBusy}
            >
              {actionProject.is_archived ? <Undo2 className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              {actionProject.is_archived ? "Restore project" : "Archive project"}
            </Button>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={taskModalOpen}
        onClose={closeTaskModal}
        title={editingTask ? "Edit task" : "Add project task"}
        description="Set the workflow state, priority, assignee and due date."
      >
        <form onSubmit={saveTask} className="space-y-4">
          <Input
            label="Task title"
            value={taskForm.title}
            onChange={(event) => setTaskForm((previous) => ({ ...previous, title: event.target.value }))}
            required
          />
          <div>
            <label className="mb-1.5 block text-xs font-medium">Description</label>
            <textarea
              className={textareaClass}
              value={taskForm.description}
              onChange={(event) =>
                setTaskForm((previous) => ({ ...previous, description: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium">Status</label>
              <select
                className={selectClass}
                value={taskForm.status}
                onChange={(event) =>
                  setTaskForm((previous) => ({ ...previous, status: event.target.value }))
                }
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Review</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium">Priority</label>
              <select
                className={selectClass}
                value={taskForm.priority}
                onChange={(event) =>
                  setTaskForm((previous) => ({ ...previous, priority: event.target.value }))
                }
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <Input
            label="Assignee email"
            type="email"
            value={taskForm.assignee_email}
            onChange={(event) =>
              setTaskForm((previous) => ({ ...previous, assignee_email: event.target.value }))
            }
          />
          <Input
            label="Due date"
            type="date"
            value={taskForm.due_date}
            onChange={(event) =>
              setTaskForm((previous) => ({ ...previous, due_date: event.target.value }))
            }
          />
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={closeTaskModal} disabled={taskSaving}>
              Cancel
            </Button>
            <Button type="submit" isLoading={taskSaving}>
              {editingTask ? "Save task" : "Add task"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(financeKind)}
        onClose={closeFinance}
        title={
          financeKind === "quotation"
            ? "New project quotation"
            : financeKind === "invoice"
              ? "New project invoice"
              : financeKind === "payment"
                ? "Record project payment"
                : financeKind === "purchase"
                  ? "New project purchase order"
                  : "Add project expense"
        }
        description={
          financeProject
            ? `This record will be linked to ${financeProject.name}.`
            : "This record will be linked to the selected project."
        }
      >
        <form onSubmit={saveFinance} className="space-y-4">
          {financeKind === "payment" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium">Invoice (optional)</label>
                <select
                  className={selectClass}
                  value={financeForm.invoice_id || ""}
                  onChange={(event) =>
                    setFinanceForm((previous) => ({ ...previous, invoice_id: event.target.value }))
                  }
                >
                  <option value="">Project payment only</option>
                  {(workspace && workspace.project.id === financeProject?.id
                    ? workspace.finance.invoices
                    : []
                  ).map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.invoice_number} — outstanding {money(Math.max(0, invoice.amount_ugx - invoice.paid_amount_ugx))}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                label="Reference"
                value={financeForm.reference || ""}
                onChange={(event) =>
                  setFinanceForm((previous) => ({ ...previous, reference: event.target.value }))
                }
                placeholder="Bank ref, receipt no..."
              />
              <div>
                <label className="mb-1.5 block text-xs font-medium">Method</label>
                <select
                  className={selectClass}
                  value={financeForm.method || "bank"}
                  onChange={(event) =>
                    setFinanceForm((previous) => ({ ...previous, method: event.target.value }))
                  }
                >
                  <option value="bank">Bank</option>
                  <option value="cash">Cash</option>
                  <option value="mobile_money">Mobile Money</option>
                  <option value="cheque">Cheque</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </>
          )}

          {financeKind !== "expense" && financeKind !== "payment" && (
            <>
              <Input
                label="Number"
                value={financeForm.number || ""}
                onChange={(event) =>
                  setFinanceForm((previous) => ({ ...previous, number: event.target.value }))
                }
                required
              />
              <Input
                label={financeKind === "purchase" ? "Supplier" : "Client"}
                value={financeForm.party || ""}
                onChange={(event) =>
                  setFinanceForm((previous) => ({ ...previous, party: event.target.value }))
                }
                required
              />
            </>
          )}

          {financeKind === "expense" && (
            <Input
              label="Description"
              value={financeForm.description || ""}
              onChange={(event) =>
                setFinanceForm((previous) => ({ ...previous, description: event.target.value }))
              }
              required
            />
          )}

          <Input
            label="Amount UGX"
            type="number"
            min="0"
            value={financeForm.amount || ""}
            onChange={(event) =>
              setFinanceForm((previous) => ({ ...previous, amount: event.target.value }))
            }
            required
          />

          {financeKind === "invoice" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Already paid UGX"
                type="number"
                min="0"
                value={financeForm.paid || ""}
                onChange={(event) =>
                  setFinanceForm((previous) => ({ ...previous, paid: event.target.value }))
                }
              />
              <Input
                label="Due date"
                type="date"
                value={financeForm.due_date || ""}
                onChange={(event) =>
                  setFinanceForm((previous) => ({ ...previous, due_date: event.target.value }))
                }
              />
            </div>
          )}

          {financeKind === "expense" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Category"
                value={financeForm.category || ""}
                onChange={(event) =>
                  setFinanceForm((previous) => ({ ...previous, category: event.target.value }))
                }
              />
              <Input
                label="Reference"
                value={financeForm.reference || ""}
                onChange={(event) =>
                  setFinanceForm((previous) => ({ ...previous, reference: event.target.value }))
                }
              />
            </div>
          )}

          <Input
            label="Date"
            type="date"
            value={
              financeForm[
                financeKind === "purchase"
                  ? "order_date"
                  : financeKind === "expense"
                    ? "expense_date"
                    : financeKind === "payment"
                      ? "payment_date"
                      : "issue_date"
              ] || today()
            }
            onChange={(event) => {
              const key =
                financeKind === "purchase"
                  ? "order_date"
                  : financeKind === "expense"
                    ? "expense_date"
                    : financeKind === "payment"
                      ? "payment_date"
                      : "issue_date";
              setFinanceForm((previous) => ({ ...previous, [key]: event.target.value }));
            }}
          />

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={closeFinance} disabled={financeSaving}>
              Cancel
            </Button>
            <Button type="submit" isLoading={financeSaving}>
              <Banknote className="h-4 w-4" /> Save
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default ProjectsPage;
