// SQLite storage using Node's built-in driver (no native build step).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const STATUSES = ["todo", "doing", "review", "done"];
export const PRIORITIES = ["high", "medium", "low"];
export const HEALTH = ["on-track", "at-risk", "off-track", "done"];
export const COLORS = ["blue", "indigo", "purple", "pink", "red", "orange", "yellow", "green", "teal"];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  owner       TEXT NOT NULL DEFAULT '',
  start       TEXT NOT NULL DEFAULT '',
  due         TEXT NOT NULL DEFAULT '',
  health      TEXT NOT NULL DEFAULT 'on-track',
  color       TEXT NOT NULL DEFAULT 'blue',
  description TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
  assignee     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'todo',
  priority     TEXT NOT NULL DEFAULT 'medium',
  due          TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  completed_at INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ValidationError extends Error {}

function str(v, field, { max, required = false } = {}) {
  if (v == null) v = "";
  if (typeof v !== "string") throw new ValidationError(`${field} must be text`);
  v = v.trim();
  if (required && !v) throw new ValidationError(`${field} is required`);
  if (max && v.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return v;
}
function date(v, field) {
  v = str(v, field);
  if (v && !DATE_RE.test(v)) throw new ValidationError(`${field} must be a date like 2026-01-31`);
  return v;
}
function oneOf(v, field, list, fallback) {
  if (v == null || v === "") return fallback;
  if (!list.includes(v)) throw new ValidationError(`${field} must be one of: ${list.join(", ")}`);
  return v;
}

const projectRow = (r) => r && ({
  id: r.id, name: r.name, owner: r.owner, start: r.start, due: r.due, health: r.health,
  color: r.color, description: r.description, createdAt: r.created_at, updatedAt: r.updated_at,
});
const taskRow = (r) => r && ({
  id: r.id, title: r.title, projectId: r.project_id ?? "", assignee: r.assignee, status: r.status,
  priority: r.priority, due: r.due, notes: r.notes, completedAt: r.completed_at ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export function openDb(file) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);

  const q = {
    listProjects: db.prepare("SELECT * FROM projects ORDER BY created_at"),
    getProject: db.prepare("SELECT * FROM projects WHERE id = ?"),
    insertProject: db.prepare(`INSERT INTO projects (id, name, owner, start, due, health, color, description, created_at, updated_at)
      VALUES (:id, :name, :owner, :start, :due, :health, :color, :description, :createdAt, :updatedAt)`),
    updateProject: db.prepare(`UPDATE projects SET name=:name, owner=:owner, start=:start, due=:due, health=:health,
      color=:color, description=:description, updated_at=:updatedAt WHERE id=:id`),
    deleteProject: db.prepare("DELETE FROM projects WHERE id = ?"),
    listTasks: db.prepare("SELECT * FROM tasks ORDER BY created_at"),
    getTask: db.prepare("SELECT * FROM tasks WHERE id = ?"),
    insertTask: db.prepare(`INSERT INTO tasks (id, title, project_id, assignee, status, priority, due, notes, completed_at, created_at, updated_at)
      VALUES (:id, :title, :projectId, :assignee, :status, :priority, :due, :notes, :completedAt, :createdAt, :updatedAt)`),
    updateTask: db.prepare(`UPDATE tasks SET title=:title, project_id=:projectId, assignee=:assignee, status=:status,
      priority=:priority, due=:due, notes=:notes, completed_at=:completedAt, updated_at=:updatedAt WHERE id=:id`),
    deleteTask: db.prepare("DELETE FROM tasks WHERE id = ?"),
  };

  function cleanProject(input, prev) {
    const m = { ...prev, ...input };
    return {
      name: str(m.name, "Name", { max: 120, required: true }),
      owner: str(m.owner, "Owner", { max: 80 }),
      start: date(m.start, "Start date"),
      due: date(m.due, "Target date"),
      health: oneOf(m.health, "Health", HEALTH, "on-track"),
      color: oneOf(m.color, "Color", COLORS, "blue"),
      description: str(m.description, "Description", { max: 2000 }),
    };
  }

  function cleanTask(input, prev) {
    const m = { ...prev, ...input };
    let projectId = m.projectId || null;
    if (projectId) {
      if (typeof projectId !== "string") throw new ValidationError("Project is invalid");
      if (!q.getProject.get(projectId)) throw new ValidationError("That project no longer exists");
    }
    const status = oneOf(m.status, "Status", STATUSES, "todo");
    return {
      title: str(m.title, "Title", { max: 200, required: true }),
      projectId,
      assignee: str(m.assignee, "Assignee", { max: 80 }),
      status,
      priority: oneOf(m.priority, "Priority", PRIORITIES, "medium"),
      due: date(m.due, "Due date"),
      notes: str(m.notes, "Notes", { max: 4000 }),
      completedAt: status === "done" ? (prev?.status === "done" && prev.completedAt ? prev.completedAt : Date.now()) : null,
    };
  }

  return {
    raw: db,
    close: () => db.close(),

    listProjects: () => q.listProjects.all().map(projectRow),
    getProject: (id) => projectRow(q.getProject.get(id)),
    createProject(input) {
      const now = Date.now();
      const p = { id: randomUUID(), ...cleanProject(input), createdAt: now, updatedAt: now };
      q.insertProject.run(p);
      return this.getProject(p.id);
    },
    updateProject(id, input) {
      const prev = this.getProject(id);
      if (!prev) return null;
      q.updateProject.run({ id, ...cleanProject(input, prev), updatedAt: Date.now() });
      return this.getProject(id);
    },
    deleteProject(id) {
      // ON DELETE SET NULL leaves the project's tasks in place.
      return q.deleteProject.run(id).changes > 0;
    },

    listTasks: () => q.listTasks.all().map(taskRow),
    getTask: (id) => taskRow(q.getTask.get(id)),
    createTask(input) {
      const now = Date.now();
      const t = { id: randomUUID(), ...cleanTask(input), createdAt: now, updatedAt: now };
      q.insertTask.run(t);
      return this.getTask(t.id);
    },
    updateTask(id, input) {
      const prev = this.getTask(id);
      if (!prev) return null;
      q.updateTask.run({ id, ...cleanTask(input, prev), updatedAt: Date.now() });
      return this.getTask(id);
    },
    deleteTask(id) {
      return q.deleteTask.run(id).changes > 0;
    },
  };
}
