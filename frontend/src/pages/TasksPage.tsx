import React, { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Columns3,
  FileText,
  ListTodo,
  Pencil,
  Plus,
  Search,
  UserRound,
  Zap,
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
import { getErrorMessage } from "@/lib/api";
import {
  TASK_STATUSES,
  taskInView,
  taskStatusLabel,
  type TaskStatus,
  type TasksView,
} from "@/lib/taskUtils";
import {
  workspaceApi,
  type DocumentRecord,
  type Project,
  type ProjectTask,
  type TaskDashboardSummary,
} from "@/lib/workspaceApi";

type DisplayMode = "list" | "board";

type TaskForm = {
  title: string;
  description: string;
  project_id: string;
  assignee_email: string;
  priority: string;
  status: TaskStatus;
  start_date: string;
  due_date: string;
  related_document_id: string;
};

type TasksSnapshot = {
  tasks: ProjectTask[];
  projects: Project[];
  documents: DocumentRecord[];
  dashboard: TaskDashboardSummary | null;
};

const blankForm = (projectId = ""): TaskForm => ({
  title: "",
  description: "",
  project_id: projectId,
  assignee_email: "",
  priority: "normal",
  status: "todo",
  start_date: "",
  due_date: "",
  related_document_id: "",
});

const dateOnly = () => new Date().toISOString().slice(0, 10);
const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const textareaClass =
  "min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

const priorityClass = (priority: string) => {
  if (priority === "urgent") return "bg-red-500/15 text-red-500";
  if (priority === "high") return "bg-amber-500/15 text-amber-500";
  if (priority === "low") return "bg-sky-500/15 text-sky-500";
  return "bg-accent text-muted-foreground";
};

export const TasksPage: React.FC = () => {
  const { user } = useAuth();
  const { showSuccessToast, showErrorToast } = useCustomToast();
  const [initialCache] = useState(() => readSectionCache<TasksSnapshot>(user?.id, "tasks"));
  const [tasks, setTasks] = useState<ProjectTask[]>(initialCache?.data.tasks ?? []);
  const [projects, setProjects] = useState<Project[]>(initialCache?.data.projects ?? []);
  const [documents, setDocuments] = useState<DocumentRecord[]>(initialCache?.data.documents ?? []);
  const [dashboard, setDashboard] = useState<TaskDashboardSummary | null>(initialCache?.data.dashboard ?? null);
  const [view, setView] = useState<TasksView>("my");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("list");
  const [search, setSearch] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(initialCache?.savedAt ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<TaskForm>(blankForm());

  const load = useCallback(async (_showLoading = true) => {
    setIsRefreshing(true);
    setLoadError(null);
    try {
      const [nextTasks, nextProjects, nextDocuments, nextDashboard] = await Promise.all([
        workspaceApi.tasks(),
        workspaceApi.projects(),
        workspaceApi.documents(),
        workspaceApi.taskDashboard(),
      ]);
      const snapshot: TasksSnapshot = {
        tasks: nextTasks,
        projects: nextProjects,
        documents: nextDocuments,
        dashboard: nextDashboard,
      };
      setTasks(snapshot.tasks);
      setProjects(snapshot.projects);
      setDocuments(snapshot.documents);
      setDashboard(snapshot.dashboard);
      setLastSyncedAt(writeSectionCache(user?.id, "tasks", snapshot));
    } catch (error) {
      setLoadError(getErrorMessage(error, "Tasks could not be refreshed."));
    } finally {
      setIsRefreshing(false);
    }
  }, [user?.id]);

  useBackgroundRefresh(load);

  const today = dateOnly();
  const currentEmail = user?.email?.trim().toLowerCase() || "";

  const visibleTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (!taskInView(task, view, today, currentEmail)) return false;
      if (!term) return true;
      const project = projects.find((item) => item.id === task.project_id);
      return [task.title, task.description, task.assignee_email, project?.name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [tasks, projects, search, view, today, currentEmail]);

  const taskViews = [
    { id: "my" as const, label: "My Tasks", count: tasks.filter((task) => taskInView(task, "my", today, currentEmail)).length },
    { id: "all" as const, label: "All Tasks", count: tasks.length },
    { id: "today" as const, label: "Today", count: tasks.filter((task) => taskInView(task, "today", today, currentEmail)).length },
    { id: "upcoming" as const, label: "Upcoming", count: tasks.filter((task) => taskInView(task, "upcoming", today, currentEmail)).length },
    { id: "overdue" as const, label: "Overdue", count: tasks.filter((task) => taskInView(task, "overdue", today, currentEmail)).length },
    { id: "completed" as const, label: "Completed", count: tasks.filter((task) => task.status === "completed").length },
  ];

  const projectName = (projectId: string) =>
    projects.find((item) => item.id === projectId)?.name || "Unknown project";
  const documentTitle = (documentId: string | null) =>
    documents.find((item) => item.id === documentId)?.title || null;

  const availableDocuments = useMemo(
    () => documents.filter((doc) => !doc.project_id || doc.project_id === form.project_id),
    [documents, form.project_id],
  );

  const openCreate = () => {
    setEditingTask(null);
    setForm(blankForm(projects[0]?.id || ""));
    setIsModalOpen(true);
  };

  const openEdit = (task: ProjectTask) => {
    setEditingTask(task);
    setForm({
      title: task.title,
      description: task.description || "",
      project_id: task.project_id,
      assignee_email: task.assignee_email || "",
      priority: task.priority,
      status: task.status as TaskStatus,
      start_date: task.start_date || "",
      due_date: task.due_date || "",
      related_document_id: task.related_document_id || "",
    });
    setIsModalOpen(true);
  };

  const saveTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    if (!form.title.trim() || !form.project_id) {
      showErrorToast("Title and project are required.", "Check task details");
      return;
    }
    if (form.start_date && form.due_date && form.start_date > form.due_date) {
      showErrorToast("Start date cannot be after the due date.", "Check task dates");
      return;
    }

    setIsSaving(true);
    try {
      const body: Record<string, unknown> = {
        project_id: form.project_id,
        title: form.title.trim(),
        description: form.description.trim(),
        assignee_email: form.assignee_email.trim(),
        priority: form.priority,
        status: form.status,
      };
      if (editingTask) {
        if (form.start_date) body.start_date = form.start_date;
        else body.clear_start_date = true;
        if (form.due_date) body.due_date = form.due_date;
        else body.clear_due_date = true;
        if (form.related_document_id) body.related_document_id = form.related_document_id;
        else body.clear_related_document = true;
        await workspaceApi.updateTask(editingTask.id, body);
      } else {
        body.start_date = form.start_date || null;
        body.due_date = form.due_date || null;
        body.related_document_id = form.related_document_id || null;
        await workspaceApi.createTask(body);
      }
      setIsModalOpen(false);
      await load(false);
      showSuccessToast(editingTask ? "Task changes saved." : "Task created.", editingTask ? "Task updated" : "Task created");
    } catch (error) {
      showErrorToast(getErrorMessage(error, "The task could not be saved."), "Task not saved");
    } finally {
      setIsSaving(false);
    }
  };

  const changeStatus = async (task: ProjectTask, status: string) => {
    if (busyTaskId || status === task.status) return;
    setBusyTaskId(task.id);
    try {
      await workspaceApi.updateTask(task.id, { status });
      await load(false);
      showSuccessToast(`Moved to ${taskStatusLabel(status)}.`, "Task updated");
    } catch (error) {
      showErrorToast(getErrorMessage(error, "The task status could not be updated."), "Task not updated");
    } finally {
      setBusyTaskId(null);
    }
  };

  const removeTask = async () => {
    if (!editingTask || isSaving) return;
    if (!window.confirm(`Delete "${editingTask.title}"? This cannot be undone.`)) return;
    setIsSaving(true);
    try {
      await workspaceApi.deleteTask(editingTask.id);
      setIsModalOpen(false);
      await load(false);
      showSuccessToast("Task deleted.", "Task removed");
    } catch (error) {
      showErrorToast(getErrorMessage(error, "The task could not be deleted."), "Task not deleted");
    } finally {
      setIsSaving(false);
    }
  };

  const metrics = [
    { label: "Due Today", value: dashboard?.due_today ?? 0, icon: CalendarDays },
    { label: "Overdue", value: dashboard?.overdue ?? 0, icon: AlertTriangle },
    { label: "High Priority", value: dashboard?.high_priority ?? 0, icon: Zap },
    { label: "Assigned to Me", value: dashboard?.assigned_to_me ?? 0, icon: UserRound },
    { label: "Recently Completed", value: dashboard?.recently_completed ?? 0, icon: ClipboardCheck },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start the day here: see what is due, overdue, important and assigned to you.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SyncStatus isRefreshing={isRefreshing} error={loadError} lastSyncedAt={lastSyncedAt} />
          <Button onClick={openCreate} disabled={projects.length === 0}>
            <Plus className="mr-2 h-4 w-4" /> New Task
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{label}</span>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </Card>
        ))}
      </div>

      <SectionNav items={taskViews} active={view} onChange={setView} ariaLabel="Task sections" />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full lg:max-w-md">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tasks, projects or assignees"
            icon={<Search />}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant={displayMode === "list" ? "default" : "outline"} onClick={() => setDisplayMode("list")}>
            <ListTodo className="mr-2 h-4 w-4" /> List
          </Button>
          <Button variant={displayMode === "board" ? "default" : "outline"} onClick={() => setDisplayMode("board")}>
            <Columns3 className="mr-2 h-4 w-4" /> Board
          </Button>
          <span className="hidden text-xs text-muted-foreground xl:inline">Calendar-ready dates enabled</span>
        </div>
      </div>

      {visibleTasks.length === 0 ? (
        <Card className="py-14 text-center">
          <ListTodo className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 font-medium">No tasks in this view</p>
          <p className="mt-1 text-sm text-muted-foreground">Create a task or switch to another section.</p>
        </Card>
      ) : displayMode === "list" ? (
        <div className="space-y-3">
          {visibleTasks.map((task) => {
            const docTitle = documentTitle(task.related_document_id);
            return (
              <Card key={task.id} className="p-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => openEdit(task)} className="text-left text-sm font-semibold hover:underline">
                        {task.title}
                      </button>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityClass(task.priority)}`}>
                        {task.priority}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {projectName(task.project_id)} · {task.assignee_email || "Unassigned"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Start: {task.start_date || "—"}</span>
                      <span>Due: {task.due_date || "—"}</span>
                      {task.status === "completed" && (
                        <span>Completed: {task.completed_at ? task.completed_at.slice(0, 10) : "—"}</span>
                      )}
                      {docTitle && <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{docTitle}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label={`Status for ${task.title}`}
                      className={`${selectClass} w-40`}
                      value={task.status}
                      disabled={busyTaskId === task.id}
                      onChange={(event) => void changeStatus(task, event.target.value)}
                    >
                      {TASK_STATUSES.map((status) => <option key={status} value={status}>{taskStatusLabel(status)}</option>)}
                    </select>
                    <Button variant="outline" size="sm" onClick={() => openEdit(task)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-4">
          {TASK_STATUSES.map((status) => {
            const columnTasks = visibleTasks.filter((task) => task.status === status);
            return (
              <div key={status} className="rounded-xl border border-border bg-muted/20 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">{taskStatusLabel(status)}</h2>
                  <span className="rounded-full bg-accent px-2 py-0.5 text-xs">{columnTasks.length}</span>
                </div>
                <div className="space-y-3">
                  {columnTasks.map((task) => (
                    <Card key={task.id} className="p-3">
                      <button onClick={() => openEdit(task)} className="w-full text-left">
                        <p className="text-sm font-medium">{task.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{projectName(task.project_id)}</p>
                        <p className="mt-2 text-xs text-muted-foreground">Due {task.due_date || "not set"}</p>
                      </button>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] ${priorityClass(task.priority)}`}>{task.priority}</span>
                        <select
                          aria-label={`Move ${task.title}`}
                          className={`${selectClass} h-8 w-32 text-xs`}
                          value={task.status}
                          disabled={busyTaskId === task.id}
                          onChange={(event) => void changeStatus(task, event.target.value)}
                        >
                          {TASK_STATUSES.map((next) => <option key={next} value={next}>{taskStatusLabel(next)}</option>)}
                        </select>
                      </div>
                    </Card>
                  ))}
                  {columnTasks.length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">No tasks</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSaving && setIsModalOpen(false)}
        title={editingTask ? "Edit Task" : "Create Task"}
        description="Tasks stay linked to their project and related Star Africa Logistics documents."
        className="max-w-2xl"
      >
        <form onSubmit={saveTask} className="space-y-4">
          <Input label="Title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required />
          <div>
            <label className="mb-1.5 block text-xs font-medium">Description</label>
            <textarea className={textareaClass} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium">Project</label>
              <select className={selectClass} value={form.project_id} onChange={(event) => setForm((current) => ({ ...current, project_id: event.target.value, related_document_id: "" }))} required>
                <option value="">Select project</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </div>
            <Input label="Assignee Email" type="email" value={form.assignee_email} onChange={(event) => setForm((current) => ({ ...current, assignee_email: event.target.value }))} placeholder="staff@starafricalogistics.com" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium">Priority</label>
              <select className={selectClass} value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium">Status</label>
              <select className={selectClass} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as TaskStatus }))}>
                {TASK_STATUSES.map((status) => <option key={status} value={status}>{taskStatusLabel(status)}</option>)}
              </select>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Start Date" type="date" value={form.start_date} onChange={(event) => setForm((current) => ({ ...current, start_date: event.target.value }))} />
            <Input label="Due Date" type="date" value={form.due_date} onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium">Related Document</label>
            <select className={selectClass} value={form.related_document_id} onChange={(event) => setForm((current) => ({ ...current, related_document_id: event.target.value }))}>
              <option value="">No related document</option>
              {availableDocuments.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-4">
            <div>
              {editingTask && (
                <Button type="button" variant="outline" onClick={() => void removeTask()} disabled={isSaving}>
                  Delete Task
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)} disabled={isSaving}>Cancel</Button>
              <Button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : editingTask ? "Save Changes" : "Create Task"}</Button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default TasksPage;
