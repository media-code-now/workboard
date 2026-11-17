import type { Project, ProjectInput, Task, TaskInput, User } from "./types";

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

/** Fired when the server says the session is gone, so the app can show the sign-in screen. */
export const SIGNED_OUT_EVENT = "workboard:signed-out";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), "X-Requested-With": "workboard" },
      credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  if (!res.ok) {
    const fallback = res.status >= 500
      ? `The server had a problem (error ${res.status}). Try again in a moment; if it keeps happening, check the function logs in Netlify.`
      : `The server returned an error (${res.status}).`;
    throw new ApiError(data.error || fallback, res.status);
  }
  return data as T;
}

export const api = {
  me: () => request<User>("GET", "/auth/me"),
  login: (email: string, password: string) => request<User>("POST", "/auth/login", { email, password }),
  logout: () => request<void>("POST", "/auth/logout", {}),
  changePassword: (currentPassword: string, newPassword: string) => request<void>("POST", "/auth/password", { currentPassword, newPassword }),
  revision: () => request<{ rev: number }>("GET", "/revision"),
  board: () => request<{ rev: number; projects: Project[]; tasks: Task[] }>("GET", "/board"),
  listUsers: () => request<User[]>("GET", "/users"),
  addUser: (u: { email: string; name: string; role: User["role"] }) => request<{ user: User; temporaryPassword: string }>("POST", "/users", u),
  resetUserPassword: (id: string) => request<{ user: User; temporaryPassword: string }>("POST", `/users/${id}/reset-password`, {}),
  removeUser: (id: string) => request<void>("DELETE", `/users/${id}`),
  createProject: (p: ProjectInput) => request<Project>("POST", "/projects", p),
  updateProject: (id: string, p: Partial<ProjectInput>) => request<Project>("PATCH", `/projects/${id}`, p),
  deleteProject: (id: string) => request<void>("DELETE", `/projects/${id}`),
  createTask: (t: TaskInput) => request<Task>("POST", "/tasks", t),
  updateTask: (id: string, t: Partial<TaskInput>) => request<Task>("PATCH", `/tasks/${id}`, t),
  deleteTask: (id: string) => request<void>("DELETE", `/tasks/${id}`),
};
