import type { Priority, User, View } from "../types";
import type { Connection } from "../useBoard";
import { Avatar, Icon, Sheet, type IconName } from "./ui";

export type MobileTab = "overview" | "projects" | "tasks";

const TABS: { id: MobileTab; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "projects", label: "Projects", icon: "folder" },
  { id: "tasks", label: "Tasks", icon: "tasks" },
];

/** Floating glass tab bar plus a separate add button, shown on phones only. */
export function TabBar({ tab, menuOpen, onTab, onMenu, onAdd, badge }: {
  tab: MobileTab; menuOpen: boolean; badge: number;
  onTab: (t: MobileTab) => void; onMenu: () => void; onAdd: () => void;
}) {
  return (
    <>
      <nav className="tabbar glass" aria-label="Main">
        {TABS.map((t) => (
          <button key={t.id} type="button" className="tab" aria-current={tab === t.id && !menuOpen ? "page" : undefined} onClick={() => onTab(t.id)}>
            <span className="tab-ico">
              <Icon name={t.icon} width={1.7} />
              {t.id === "tasks" && badge > 0 && <span className="badge" aria-label={`${badge} overdue`}>{badge > 99 ? "99+" : badge}</span>}
            </span>
            <span className="tab-lbl">{t.label}</span>
          </button>
        ))}
        <button type="button" className="tab" aria-current={menuOpen ? "page" : undefined} aria-haspopup="dialog" onClick={onMenu}>
          <span className="tab-ico"><Icon name="menu" width={1.7} /></span>
          <span className="tab-lbl">Menu</span>
        </button>
      </nav>
      <button type="button" className="fab" onClick={onAdd} aria-label="New task"><Icon name="plus" width={2.2} /></button>
    </>
  );
}

const VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: "board", label: "Board", icon: "board" },
  { id: "list", label: "List", icon: "list" },
  { id: "timeline", label: "Timeline", icon: "timeline" },
];

export function MenuSheet({ open, onClose, view, onView, people, assignee, onAssignee, prio, onPrio, connection, onNewTask, onNewProject, user, onSignOut }: {
  open: boolean; onClose: () => void;
  view: View; onView: (v: View) => void;
  people: string[]; assignee: string; onAssignee: (v: string) => void;
  prio: string; onPrio: (v: Priority | "") => void;
  connection: Connection; onNewTask: () => void; onNewProject: () => void;
  user: User; onSignOut: () => void;
}) {
  const filtersOn = Boolean(assignee || prio);
  return (
    <Sheet open={open} onClose={onClose} title="Menu" canSave={false}>
      <div className="form-group me-card">
        <Avatar name={user.name} /><div className="me-txt"><b>{user.name}</b><small>{user.email}</small></div>
      </div>

      <div className="menu-sec">
        <div className="menu-h">Create</div>
        <div className="form-group">
          <button type="button" className="mrow" onClick={onNewTask}><span className="mico" style={{ background: "var(--blue)" }}><Icon name="plus" width={2.2} /></span>New Task</button>
          <button type="button" className="mrow" onClick={onNewProject}><span className="mico" style={{ background: "var(--indigo)" }}><Icon name="folder" width={2} /></span>New Project</button>
        </div>
      </div>

      <div className="menu-sec">
        <div className="menu-h">Show tasks as</div>
        <div className="view-pick">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => onView(v.id)}>
              <Icon name={v.icon} width={1.7} /><span>{v.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="menu-sec">
        <div className="menu-h"><span>Filters</span>{filtersOn && <button type="button" className="link" onClick={() => { onAssignee(""); onPrio(""); }}>Clear</button>}</div>
        <div className="form-group">
          <div className="frow"><label htmlFor="mPerson">Person</label>
            <select id="mPerson" value={assignee} onChange={(e) => onAssignee(e.target.value)}>
              <option value="">Everyone</option>
              {people.map((n) => <option key={n} value={n}>{n}</option>)}
            </select></div>
          <div className="frow"><label htmlFor="mPrio">Priority</label>
            <select id="mPrio" value={prio} onChange={(e) => onPrio(e.target.value as Priority | "")}>
              <option value="">All</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select></div>
        </div>
      </div>

      <div className="form-group">
        <button type="button" className="mrow danger" onClick={onSignOut}>Sign Out</button>
      </div>

      <div className="menu-foot">
        <span className={"sync " + (connection === "live" ? "live" : "warn")}>
          {connection === "live" ? "Live: changes sync automatically" : connection === "connecting" ? "Connecting…" : "Offline"}
        </span>
      </div>
    </Sheet>
  );
}
