export type Status = "todo" | "doing" | "review" | "done";
export type Priority = "high" | "medium" | "low";
export type Health = "on-track" | "at-risk" | "off-track" | "done";
export type Color = "blue" | "indigo" | "purple" | "pink" | "red" | "orange" | "yellow" | "green" | "teal";
export type View = "board" | "list" | "timeline";

export interface Project {
  id: string;
  name: string;
  owner: string;
  start: string; // YYYY-MM-DD or ""
  due: string;
  health: Health;
  color: Color;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface Task {
  id: string;
  title: string;
  projectId: string; // "" when the task has no project
  assignee: string;
  status: Status;
  priority: Priority;
  due: string;
  notes: string;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type ProjectInput = Pick<Project, "name" | "owner" | "start" | "due" | "health" | "color" | "description">;
export type TaskInput = Pick<Task, "title" | "projectId" | "assignee" | "status" | "priority" | "due" | "notes">;

export const STATUSES: { id: Status; label: string; color: string }[] = [
  { id: "todo", label: "To Do", color: "var(--label-3)" },
  { id: "doing", label: "In Progress", color: "var(--blue)" },
  { id: "review", label: "Review", color: "var(--orange)" },
  { id: "done", label: "Done", color: "var(--green)" },
];
export const HEALTH_LABEL: Record<Health, string> = {
  "on-track": "On track", "at-risk": "At risk", "off-track": "Off track", done: "Completed",
};
export const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
export const COLORS: Color[] = ["blue", "indigo", "purple", "pink", "red", "orange", "yellow", "green", "teal"];
