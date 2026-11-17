// Projects and tasks, stored in Postgres.
import { randomUUID } from "node:crypto";

export const STATUSES = ["todo", "doing", "review", "done"];
export const PRIORITIES = ["high", "medium", "low"];
export const HEALTH = ["on-track", "at-risk", "off-track", "done"];
export const COLORS = ["blue", "indigo", "purple", "pink", "red", "orange", "yellow", "green", "teal"];

// One statement per entry: the Neon HTTP driver runs a single statement per call.
// Timestamps are milliseconds stored as float8 so they come back as JS numbers.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    owner       TEXT NOT NULL DEFAULT '',
    start       TEXT NOT NULL DEFAULT '',
    due         TEXT NOT NULL DEFAULT '',
    health      TEXT NOT NULL DEFAULT 'on-track',
    color       TEXT NOT NULL DEFAULT 'blue',
    description TEXT NOT NULL DEFAULT '',
    created_at  FLOAT8 NOT NULL,
    updated_at  FLOAT8 NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
    assignee     TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'todo',
    priority     TEXT NOT NULL DEFAULT 'medium',
    due          TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    completed_at FLOAT8,
    created_at   FLOAT8 NOT NULL,
    updated_at   FLOAT8 NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id)`,
  // A single counter bumped on every change, so browsers can cheaply ask "anything new?".
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value FLOAT8 NOT NULL)`,
  `INSERT INTO meta (key, value) VALUES ('rev', 0) ON CONFLICT (key) DO NOTHING`,
];

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

/** @param {import("./sql.js").Sql} sql */
export function createStore(sql) {
  const one = async (text, params) => (await sql.query(text, params))[0];
  const bump = () => sql.query("UPDATE meta SET value = value + 1 WHERE key = 'rev'");

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

  async function cleanTask(input, prev) {
    const m = { ...prev, ...input };
    const projectId = m.projectId || null;
    if (projectId) {
      if (typeof projectId !== "string") throw new ValidationError("Project is invalid");
      if (!(await one("SELECT 1 FROM projects WHERE id = $1", [projectId]))) throw new ValidationError("That project no longer exists");
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
    async revision() { return (await one("SELECT value FROM meta WHERE key = 'rev'"))?.value ?? 0; },

    async listProjects() { return (await sql.query("SELECT * FROM projects ORDER BY created_at")).map(projectRow); },
    async getProject(id) { return projectRow(await one("SELECT * FROM projects WHERE id = $1", [id])); },
    async createProject(input) {
      const p = cleanProject(input), now = Date.now();
      const row = await one(
        `INSERT INTO projects (id, name, owner, start, due, health, color, description, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
        [randomUUID(), p.name, p.owner, p.start, p.due, p.health, p.color, p.description, now]);
      await bump();
      return projectRow(row);
    },
    async updateProject(id, input) {
      const prev = await this.getProject(id);
      if (!prev) return null;
      const p = cleanProject(input, prev);
      const row = await one(
        `UPDATE projects SET name=$2, owner=$3, start=$4, due=$5, health=$6, color=$7, description=$8, updated_at=$9
         WHERE id=$1 RETURNING *`,
        [id, p.name, p.owner, p.start, p.due, p.health, p.color, p.description, Date.now()]);
      await bump();
      return projectRow(row);
    },
    async deleteProject(id) {
      // ON DELETE SET NULL keeps the project's tasks.
      const gone = (await sql.query("DELETE FROM projects WHERE id = $1 RETURNING id", [id])).length > 0;
      if (gone) await bump();
      return gone;
    },

    async listTasks() { return (await sql.query("SELECT * FROM tasks ORDER BY created_at")).map(taskRow); },
    async getTask(id) { return taskRow(await one("SELECT * FROM tasks WHERE id = $1", [id])); },
    async createTask(input) {
      const t = await cleanTask(input), now = Date.now();
      const row = await one(
        `INSERT INTO tasks (id, title, project_id, assignee, status, priority, due, notes, completed_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
        [randomUUID(), t.title, t.projectId, t.assignee, t.status, t.priority, t.due, t.notes, t.completedAt, now]);
      await bump();
      return taskRow(row);
    },
    async updateTask(id, input) {
      const prev = await this.getTask(id);
      if (!prev) return null;
      const t = await cleanTask(input, prev);
      const row = await one(
        `UPDATE tasks SET title=$2, project_id=$3, assignee=$4, status=$5, priority=$6, due=$7, notes=$8, completed_at=$9, updated_at=$10
         WHERE id=$1 RETURNING *`,
        [id, t.title, t.projectId, t.assignee, t.status, t.priority, t.due, t.notes, t.completedAt, Date.now()]);
      await bump();
      return taskRow(row);
    },
    async deleteTask(id) {
      const gone = (await sql.query("DELETE FROM tasks WHERE id = $1 RETURNING id", [id])).length > 0;
      if (gone) await bump();
      return gone;
    },
  };
}
