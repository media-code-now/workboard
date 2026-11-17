import type { Project, Task } from "../types";
import { addDays, fmtShort, personColor, today } from "../lib";
import { Avatar, Icon, Rings, type IconName } from "./ui";

function Title({ text, icon, color }: { text: string; icon: IconName; color: string }) {
  return <div className="w-title"><span className="sym" style={{ background: color }}><Icon name={icon} width={2} /></span>{text}</div>;
}
function Stat({ value, label, color }: { value: number; label: string; color?: string }) {
  return <div className="stat"><div className="v" style={value && color ? { color } : undefined}>{value}</div><div className="k">{label}</div></div>;
}

export function Widgets({ projects, tasks }: { projects: Project[]; tasks: Task[] }) {
  const td = today(), wk = addDays(7), weekAgo = Date.now() - 7 * 86400000;
  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.length - open.length;
  const overdue = open.filter((t) => t.due && t.due < td).length;
  const dueWeek = open.filter((t) => t.due && t.due >= td && t.due <= wk).length;
  const doneWeek = tasks.filter((t) => t.status === "done" && (t.completedAt ?? 0) >= weekAgo).length;
  const inProg = tasks.filter((t) => t.status === "doing" || t.status === "review").length;
  const active = projects.filter((p) => p.health !== "done");
  const onTrack = active.filter((p) => p.health === "on-track").length;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const pDone = pct(done, tasks.length), pProg = pct(inProg, tasks.length), pTrack = pct(onTrack, active.length);

  const counts = new Map<string, number>();
  for (const t of open) counts.set(t.assignee || "Unassigned", (counts.get(t.assignee || "Unassigned") ?? 0) + 1);
  const load = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxLoad = Math.max(1, ...load.map((r) => r[1]));

  return (
    <section className="widgets" aria-label="Summary">
      <div className="widget glass">
        <Title text="Progress" icon="rings" color="var(--green)" />
        <div className="rings">
          <Rings size={132} label={`${pDone}% of tasks done, ${pProg}% in progress, ${pTrack}% of projects on track`}
            rings={[{ pct: pDone, color: "var(--green)" }, { pct: pProg, color: "var(--blue)" }, { pct: pTrack, color: "var(--pink)" }]} />
          <div className="ring-legend">
            <div><div className="k">Done</div><div className="v" style={{ color: "var(--green)" }}>{pDone}%<small> {done}/{tasks.length} tasks</small></div></div>
            <div><div className="k">In progress</div><div className="v" style={{ color: "var(--blue)" }}>{pProg}%<small> {inProg} tasks</small></div></div>
            <div><div className="k">Projects on track</div><div className="v" style={{ color: "var(--pink)" }}>{pTrack}%<small> {onTrack}/{active.length}</small></div></div>
          </div>
        </div>
      </div>

      <div className="widget glass">
        <Title text="This Week" icon="bolt" color="var(--orange)" />
        <div className="stats">
          <Stat value={open.length} label="Open" />
          <Stat value={overdue} label="Overdue" color="var(--red)" />
          <Stat value={dueWeek} label={`Due by ${fmtShort(wk)}`} color="var(--orange)" />
          <Stat value={doneWeek} label="Completed" color="var(--green)" />
        </div>
      </div>

      <div className="widget glass">
        <Title text="Workload" icon="people" color="var(--indigo)" />
        {load.length ? (
          <div className="load">
            {load.map(([name, n]) => (
              <div className="load-row" key={name}>
                <Avatar name={name === "Unassigned" ? "?" : name} />
                <div style={{ minWidth: 0 }}>
                  <div className="nm">{name}</div>
                  <div className="track"><span style={{ width: `${(n / maxLoad) * 100}%`, background: name === "Unassigned" ? "var(--label-3)" : personColor(name) }} /></div>
                </div>
                <span className="n">{n} open</span>
              </div>
            ))}
          </div>
        ) : <div className="w-empty">Open tasks per person show up here.</div>}
      </div>
    </section>
  );
}
