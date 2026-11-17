import type { Project, ProjectInput, Task, TaskInput } from "./types";

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `The server returned an error (${res.status}).`);
  return data as T;
}

export const api = {
  board: () => request<{ projects: Project[]; tasks: Task[] }>("GET", "/board"),
  createProject: (p: ProjectInput) => request<Project>("POST", "/projects", p),
  updateProject: (id: string, p: Partial<ProjectInput>) => request<Project>("PATCH", `/projects/${id}`, p),
  deleteProject: (id: string) => request<void>("DELETE", `/projects/${id}`),
  createTask: (t: TaskInput) => request<Task>("POST", "/tasks", t),
  updateTask: (id: string, t: Partial<TaskInput>) => request<Task>("PATCH", `/tasks/${id}`, t),
  deleteTask: (id: string) => request<void>("DELETE", `/tasks/${id}`),
};
