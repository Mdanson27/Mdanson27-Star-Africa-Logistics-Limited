import type { ProjectTask } from "@/lib/workspaceApi";

export type TasksView = "my" | "all" | "today" | "upcoming" | "overdue" | "completed";

export const TASK_STATUSES = ["todo", "in_progress", "review", "completed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function taskStatusLabel(status: string): string {
  return ({
    todo: "To Do",
    in_progress: "In Progress",
    review: "Review",
    completed: "Done",
  } as Record<string, string>)[status] || status.replaceAll("_", " ");
}

export function taskInView(
  task: ProjectTask,
  view: TasksView,
  today: string,
  currentEmail: string,
): boolean {
  const completed = task.status === "completed";
  const due = task.due_date;
  if (view === "all") return true;
  if (view === "my") return Boolean(currentEmail) && task.assignee_email?.trim().toLowerCase() === currentEmail;
  if (view === "completed") return completed;
  if (view === "today") return !completed && due === today;
  if (view === "upcoming") return !completed && Boolean(due) && due! > today;
  if (view === "overdue") return !completed && Boolean(due) && due! < today;
  return true;
}
