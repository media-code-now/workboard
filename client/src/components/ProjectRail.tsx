import { HEALTH_LABEL, type Project, type Task } from "../types";
import { fmtDate, projectColor, today } from "../lib";
import { Icon, Rings } from "./ui";

export const NO_PROJECT = "__none";

export function ProjectRail({ projects, tasks, selected, onSelect, onEdit, stacked = false }: {
  projects: Project[]; tasks: Task[]; selected: string; stacked?: boolean;
  onSelect: (id: string) => void; onEdit: (p: Project) => void;
}) {
  const sorted = [...projects].sort((a, b) =>
    Number(a.health === "done") - Number(b.health === "done") || (a.due || "9999").localeCompare(b.due || "9999"));
  const ids = new Set(projects.map((p) => p.id));
  const orphans = tasks.filter((t) => !t.projectId || !ids.has(t.projectId)).length;
  const td = today();

  return (
    <section aria-labelledby="projH">
      <div className="sec-h">
        <h2 id="projH">Projects</h2>
        <span className="aside">{projects.length ? `${projects.filter((p) => p.health !== "done").length} active` : ""}</span>
      </div>
      <div className={"rail" + (stacked ? " stack" : "")}>
        <button type="button" className={"pcard glass all" + (selected === "" ? " sel" : "")} onClick={() => onSelect("")}>
          <div className="own">All tasks</div>
          <div className="big">{tasks.length}</div>
          <div className="row"><span>{tasks.filter((t) => t.status !== "done").length} open</span><span>{projects.length} projects</span></div>
        </button>

        {sorted.map((p) => {
          const pt = tasks.filter((t) => t.projectId === p.id);
          const done = pt.filter((t) => t.status === "done").length;
          const pct = pt.length ? Math.round((done / pt.length) * 100) : 0;
          const late = p.due && p.health !== "done" && p.due < td;
          const sel = selected === p.id;
          return (
            <div key={p.id} className={"pcard glass" + (sel ? " sel" : "")} style={{ ["--pc" as string]: projectColor(p) }}
              role="button" tabIndex={0} aria-pressed={sel}
              onClick={() => onSelect(p.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(p.id); } }}>
              <div className="top">
                <Rings size={46} rings={[{ pct, color: projectColor(p) }]} label={`${pct}% complete`} />
                <div style={{ minWidth: 0, paddingRight: 28 }}>
                  <div className="nm">{p.name}</div>
                  <div className="own">{p.owner || "No owner"}</div>
                </div>
              </div>
              <div className="row"><span className={"pill " + p.health}>{HEALTH_LABEL[p.health]}</span><span>{done}/{pt.length} · {pct}%</span></div>
              <div className="row">
                <span style={late ? { color: "var(--red)", fontWeight: 600 } : undefined}>
                  {p.due ? `${late ? "Was due" : "Due"} ${fmtDate(p.due)}` : "No target date"}
                </span>
              </div>
              <button type="button" className="edit" aria-label={`Edit ${p.name}`} onClick={(e) => { e.stopPropagation(); onEdit(p); }}>
                <Icon name="dots" width={2} />
              </button>
            </div>
          );
        })}

        {orphans > 0 && (
          <button type="button" className={"pcard glass all" + (selected === NO_PROJECT ? " sel" : "")} onClick={() => onSelect(NO_PROJECT)}>
            <div className="own">No project</div>
            <div className="big">{orphans}</div>
            <div className="row"><span>tasks</span></div>
          </button>
        )}
      </div>
    </section>
  );
}
