import { useState } from "react";
import { PRIORITY_RANK, STATUSES, type Project, type Status, type Task } from "../types";
import { addDays, cap, dayDiff, dueClass, fmtDate, fmtShort, iso, parseDate, projectColor, today } from "../lib";
import { Avatar, Chevron, Icon } from "./ui";

const byPriorityThenDue = (a: Task, b: Task) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.due || "9999").localeCompare(b.due || "9999");

function Meta({ task, project, showProject }: { task: Task; project?: Project; showProject: boolean }) {
  const dc = dueClass(task);
  return (
    <>
      {project && showProject && (
        <span className="tag" style={{ color: projectColor(project) }}>
          <i style={{ background: projectColor(project) }} /><span>{project.name}</span>
        </span>
      )}
      {task.priority !== "medium" && <span className={"flag " + task.priority}>{cap(task.priority)}</span>}
      {task.due && (
        <span className={"due " + dc}><Icon name="cal" />{dc === "over" ? "Overdue · " : ""}{fmtDate(task.due)}</span>
      )}
    </>
  );
}

interface ViewProps {
  tasks: Task[];
  projectsById: Map<string, Project>;
  selectedProject: string;
  canEdit: boolean;
  onOpen: (t: Task) => void;
  onMove: (id: string, status: Status) => void;
}

export function BoardView({ tasks, projectsById, selectedProject, canEdit, onOpen, onMove }: ViewProps) {
  const [dropTarget, setDropTarget] = useState<Status | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  return (
    <div className="board">
      {STATUSES.map((s) => {
        const items = tasks.filter((t) => t.status === s.id).sort(byPriorityThenDue);
        return (
          <div key={s.id} className={"col glass" + (dropTarget === s.id ? " drop" : "")}
            onDragOver={canEdit ? (e) => { e.preventDefault(); setDropTarget(s.id); } : undefined}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null); }}
            onDrop={(e) => { e.preventDefault(); setDropTarget(null); onMove(e.dataTransfer.getData("text/plain"), s.id); }}>
            <div className="col-h"><span className="dot" style={{ background: s.color }} />{s.label}<span className="n">{items.length}</span></div>
            {items.map((t) => {
              const p = projectsById.get(t.projectId);
              return (
                <div key={t.id} className={"card" + (dragging === t.id ? " dragging" : "")} role="button" tabIndex={0}
                  draggable={canEdit}
                  onDragStart={(e) => { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; setDragging(t.id); }}
                  onDragEnd={() => setDragging(null)}
                  onClick={() => onOpen(t)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(t); }}>
                  <div className="t">{t.title}</div>
                  <div className="meta">
                    <Meta task={t} project={p} showProject={selectedProject !== t.projectId} />
                    {t.assignee && <Avatar name={t.assignee} small />}
                  </div>
                </div>
              );
            })}
            {!items.length && <div className="col-empty">{canEdit ? "Drag tasks here" : "Nothing here"}</div>}
          </div>
        );
      })}
    </div>
  );
}

export function ListView({ tasks, projectsById, selectedProject, canEdit, onOpen, onMove }: ViewProps) {
  if (!tasks.length) return <div className="empty glass"><p>No tasks match these filters.</p></div>;
  return (
    <div className="groups">
      {STATUSES.map((s) => {
        const items = tasks.filter((t) => t.status === s.id).sort(byPriorityThenDue);
        if (!items.length) return null;
        return (
          <div key={s.id}>
            <div className="group-h"><span>{s.label}</span><span>{items.length}</span></div>
            <div className="inset glass">
              {items.map((t) => {
                const isDone = t.status === "done";
                return (
                  <div key={t.id} className={"cell" + (isDone ? " is-done" : "")} role="button" tabIndex={0}
                    onClick={() => onOpen(t)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(t); }}>
                    <button type="button" className={"check" + (isDone ? " on" : "")} disabled={!canEdit}
                      aria-label={isDone ? "Mark as not done" : "Mark as done"}
                      onClick={(e) => { e.stopPropagation(); onMove(t.id, isDone ? "todo" : "done"); }}>
                      {isDone && <Icon name="check" width={2.6} />}
                    </button>
                    <div className="body">
                      <div className="t">{t.title}</div>
                      <div className="sub"><Meta task={t} project={projectsById.get(t.projectId)} showProject={selectedProject !== t.projectId} /></div>
                    </div>
                    <div className="trail">{t.assignee && <Avatar name={t.assignee} small />}<Chevron /></div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TimelineView({ projects, tasks, onSelect }: { projects: Project[]; tasks: Task[]; onSelect: (id: string) => void }) {
  const td = today();
  const rows = projects.map((p) => {
    const pt = tasks.filter((t) => t.projectId === p.id);
    const dues = pt.map((t) => t.due).filter(Boolean).sort();
    const start = p.start || [iso(new Date(p.createdAt)), dues[0]].filter(Boolean).sort()[0] || td;
    const end = p.due || dues[dues.length - 1] || addDays(14, start);
    const [a, b] = start <= end ? [start, end] : [end, start];
    return { p, start: a, end: b, pct: pt.length ? pt.filter((t) => t.status === "done").length / pt.length : 0 };
  }).sort((x, y) => x.start.localeCompare(y.start));

  if (!rows.length) return <div className="empty glass"><p>Add projects with start and target dates to see them on the timeline.</p></div>;

  const min = addDays(-3, rows.reduce((m, r) => (r.start < m ? r.start : m), td));
  const max = addDays(5, rows.reduce((m, r) => (r.end > m ? r.end : m), td));
  const span = Math.max(14, dayDiff(min, max));
  const pos = (d: string) => (dayDiff(min, d) / span) * 100;
  const step = span > 120 ? 30 : span > 50 ? 14 : 7;
  const ticks: string[] = [];
  for (let d = addDays(step, min); parseDate(d) <= parseDate(max); d = addDays(step, d)) ticks.push(d);

  return (
    <div className="tl-wrap glass">
      <div className="tl">
        <div className="tl-scale">{ticks.map((d) => <span key={d} style={{ left: `${pos(d)}%` }}>{fmtShort(d)}</span>)}</div>
        <div style={{ position: "relative" }}>
          {rows.map(({ p, start, end, pct }) => {
            const left = pos(start), width = Math.max(1.5, pos(end) - left);
            return (
              <div key={p.id} className="tl-row" role="button" tabIndex={0} style={{ ["--pc" as string]: projectColor(p) }}
                onClick={() => onSelect(p.id)} onKeyDown={(e) => { if (e.key === "Enter") onSelect(p.id); }}>
                <div className="tl-name"><b>{p.name}</b><small>{fmtShort(start)} – {fmtShort(end)}</small></div>
                <div className="tl-lane">
                  <div className="tl-bar" style={{ left: `${left}%`, width: `${width}%` }} title={`${Math.round(pct * 100)}% done`}>
                    <i style={{ width: `${pct * 100}%` }} /><span>{Math.round(pct * 100)}%</span>
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 180, right: 0, pointerEvents: "none" }}>
            <div className="tl-today" style={{ left: `${pos(td)}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
