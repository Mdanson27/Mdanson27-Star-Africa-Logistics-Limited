import { describe, expect, it } from "vitest";
import { taskInView, taskStatusLabel } from "@/lib/taskUtils";
import type { ProjectTask } from "@/lib/workspaceApi";

const baseTask: ProjectTask = {
  id: "task-1",
  project_id: "project-1",
  title: "Prepare report",
  description: null,
  assignee_email: "staff@starafrica.test",
  status: "todo",
  priority: "high",
  start_date: "2026-10-05",
  due_date: "2026-10-05",
  related_document_id: null,
  completed_at: null,
  created_at: "2026-10-05T08:00:00Z",
  updated_at: "2026-10-05T08:00:00Z",
};

describe("Tasks 2.0 view rules", () => {
  it("uses staff-facing board labels while preserving backend workflow values", () => {
    expect(taskStatusLabel("todo")).toBe("To Do");
    expect(taskStatusLabel("in_progress")).toBe("In Progress");
    expect(taskStatusLabel("review")).toBe("Review");
    expect(taskStatusLabel("completed")).toBe("Done");
  });

  it("places due work into Today and assigned work into My Tasks", () => {
    expect(taskInView(baseTask, "today", "2026-10-05", "staff@starafrica.test")).toBe(true);
    expect(taskInView(baseTask, "my", "2026-10-05", "staff@starafrica.test")).toBe(true);
  });

  it("keeps completed work out of active date views", () => {
    const completed = { ...baseTask, status: "completed", completed_at: "2026-10-05T09:00:00Z" };
    expect(taskInView(completed, "today", "2026-10-05", "staff@starafrica.test")).toBe(false);
    expect(taskInView(completed, "completed", "2026-10-05", "staff@starafrica.test")).toBe(true);
  });
});
