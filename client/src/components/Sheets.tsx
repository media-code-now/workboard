import { useEffect, useState } from "react";
import { COLORS, STATUSES, type Color, type Health, type Priority, type Project, type ProjectInput, type Status, type Task, type TaskInput } from "../types";
import { cap, today } from "../lib";
import { ConfirmDelete, Sheet } from "./ui";

const blankTask = (projectId: string): TaskInput => ({ title: "", projectId, assignee: "", status: "todo", priority: "medium", due: "", notes: "" });

export function TaskSheet({ open, task, defaultProjectId, projects, readOnly, onClose, onSave, onDelete }: {
  open: boolean; task: Task | null; defaultProjectId: string; projects: Project[]; readOnly: boolean;
  onClose: () => void; onSave: (input: TaskInput) => Promise<void>; onDelete: () => Promise<void>;
}) {
  const [f, setF] = useState<TaskInput>(blankTask(""));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(task ? { title: task.title, projectId: task.projectId, assignee: task.assignee, status: task.status, priority: task.priority, due: task.due, notes: task.notes }
      : blankTask(defaultProjectId));
    setError(null);
  }, [open, task, defaultProjectId]);

  const set = <K extends keyof TaskInput>(k: K, v: TaskInput[K]) => setF((s) => ({ ...s, [k]: v }));
  const run = async (fn: () => Promise<void>) => {
    setSaving(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };
  const save = () => {
    if (!f.title.trim()) { setError("Give the task a title."); return; }
    run(() => onSave(f));
  };

  return (
    <Sheet open={open} onClose={onClose} title={task ? (readOnly ? "Task" : "Edit Task") : "New Task"} onSubmit={save} canSave={!readOnly && !saving}>
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 18, minWidth: 0 }}>
        <input className="title-in" value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={200} placeholder="Task title" aria-label="Title" autoFocus={!task} />
        <div className="form-group">
          <div className="frow"><label htmlFor="tProject">Project</label>
            <select id="tProject" value={f.projectId} onChange={(e) => set("projectId", e.target.value)}>
              <option value="">None</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div className="frow"><label htmlFor="tAssignee">Assignee</label>
            <input id="tAssignee" list="peopleList" value={f.assignee} onChange={(e) => set("assignee", e.target.value)} maxLength={80} placeholder="Name" /></div>
        </div>
        <div className="form-group">
          <div className="frow"><label htmlFor="tStatus">Status</label>
            <select id="tStatus" value={f.status} onChange={(e) => set("status", e.target.value as Status)}>
              {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select></div>
          <div className="frow"><label htmlFor="tPrio">Priority</label>
            <select id="tPrio" value={f.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
              {(["high", "medium", "low"] as Priority[]).map((p) => <option key={p} value={p}>{cap(p)}</option>)}
            </select></div>
          <div className="frow"><label htmlFor="tDue">Due</label>
            <input id="tDue" type="date" value={f.due} onChange={(e) => set("due", e.target.value)} /></div>
        </div>
        <div className="form-group">
          <textarea className="notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} maxLength={4000} placeholder="Notes" aria-label="Notes" />
        </div>
      </fieldset>
      {error && <p className="err" role="alert">{error}</p>}
      {task && !readOnly && <ConfirmDelete label="Delete Task" warning="This task will be deleted for everyone." onDelete={() => run(onDelete)} />}
    </Sheet>
  );
}

export function ProjectSheet({ open, project, colorHint, onClose, onSave, onDelete }: {
  open: boolean; project: Project | null; colorHint: Color;
  onClose: () => void; onSave: (input: ProjectInput) => Promise<void>; onDelete: () => Promise<void>;
}) {
  const [f, setF] = useState<ProjectInput>({ name: "", owner: "", start: "", due: "", health: "on-track", color: "blue", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(project ? { name: project.name, owner: project.owner, start: project.start, due: project.due, health: project.health, color: project.color, description: project.description }
      : { name: "", owner: "", start: today(), due: "", health: "on-track", color: colorHint, description: "" });
    setError(null);
  }, [open, project, colorHint]);

  const set = <K extends keyof ProjectInput>(k: K, v: ProjectInput[K]) => setF((s) => ({ ...s, [k]: v }));
  const run = async (fn: () => Promise<void>) => {
    setSaving(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };
  const save = () => {
    if (!f.name.trim()) { setError("Give the project a name."); return; }
    if (f.start && f.due && f.due < f.start) { setError("The target date is before the start date."); return; }
    run(() => onSave(f));
  };

  return (
    <Sheet open={open} onClose={onClose} title={project ? "Edit Project" : "New Project"} onSubmit={save} canSave={!saving}>
      <input className="title-in" value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={120} placeholder="Project name" aria-label="Project name" autoFocus={!project} />
      <div className="form-group">
        <div className="swatches" role="group" aria-label="Color">
          {COLORS.map((c) => (
            <button key={c} type="button" className="swatch" style={{ ["--c" as string]: `var(--${c})` }} aria-label={cap(c)} aria-pressed={f.color === c} onClick={() => set("color", c)} />
          ))}
        </div>
      </div>
      <div className="form-group">
        <div className="frow"><label htmlFor="pOwner">Owner</label><input id="pOwner" list="peopleList" value={f.owner} onChange={(e) => set("owner", e.target.value)} maxLength={80} placeholder="Name" /></div>
        <div className="frow"><label htmlFor="pStart">Start</label><input id="pStart" type="date" value={f.start} onChange={(e) => set("start", e.target.value)} /></div>
        <div className="frow"><label htmlFor="pDue">Target</label><input id="pDue" type="date" value={f.due} onChange={(e) => set("due", e.target.value)} /></div>
        <div className="frow"><label htmlFor="pHealth">Health</label>
          <select id="pHealth" value={f.health} onChange={(e) => set("health", e.target.value as Health)}>
            <option value="on-track">On track</option><option value="at-risk">At risk</option><option value="off-track">Off track</option><option value="done">Completed</option>
          </select></div>
      </div>
      <div className="form-group"><textarea className="notes" value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} placeholder="Goal and scope" aria-label="Description" /></div>
      {error && <p className="err" role="alert">{error}</p>}
      {project && <ConfirmDelete label="Delete Project" warning="The project is removed. Its tasks stay, without a project." onDelete={() => run(onDelete)} />}
    </Sheet>
  );
}
