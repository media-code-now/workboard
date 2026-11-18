import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { useBoard } from "./useBoard";
import { COLORS, STATUSES, type Project, type Status, type Task, type User, type View } from "./types";
import { Widgets } from "./components/Widgets";
import { NO_PROJECT, ProjectRail } from "./components/ProjectRail";
import { BoardView, ListView, TimelineView } from "./components/TaskViews";
import { ProjectSheet, TaskSheet } from "./components/Sheets";
import { Icon } from "./components/ui";
import { AccountMenu, PasswordSheet, TeamSheet } from "./components/Account";
import { NotificationBell, useNotifications } from "./components/Notifications";
import { SettingsSheet } from "./components/Settings";
import { MenuSheet, TabBar, type MobileTab } from "./components/MobileNav";
import { useMediaQuery } from "./useMediaQuery";
import { today } from "./lib";

const readView = (): View => {
  try { const v = localStorage.getItem("wb.view"); if (v === "board" || v === "list" || v === "timeline") return v; } catch { /* storage unavailable */ }
  return "board";
};

export default function App({ user, onSignOut, onUserChange }: { user: User; onSignOut: () => void; onUserChange: (u: User) => void }) {
  const board = useBoard();
  const { projects, tasks, loaded, loadError, connection } = board;

  const [view, setViewState] = useState<View>(readView);
  const [selected, setSelected] = useState("");
  const [q, setQ] = useState("");
  const [assignee, setAssignee] = useState("");
  const [prio, setPrio] = useState("");
  const [taskSheet, setTaskSheet] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });
  const [projSheet, setProjSheet] = useState<{ open: boolean; project: Project | null }>({ open: false, project: null });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number>(undefined);
  const isMobile = useMediaQuery("(max-width: 640px)");
  const [mobileTab, setMobileTab] = useState<MobileTab>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [team, setTeam] = useState<string[]>([]);
  const notes = useNotifications(board.unread, board.setUnread);
  useEffect(() => { api.team().then((t) => setTeam(t.map((u) => u.name))).catch(() => {}); }, [user.name, teamOpen]);
  const goTab = (t: MobileTab) => { setMenuOpen(false); setMobileTab(t); window.scrollTo({ top: 0 }); };
  const shows = (t: MobileTab) => !isMobile || mobileTab === t;
  const newTask = () => { setMenuOpen(false); setTaskSheet({ open: true, task: null }); };
  const newProject = () => { setMenuOpen(false); setProjSheet({ open: true, project: null }); };

  const setView = (v: View) => { setViewState(v); try { localStorage.setItem("wb.view", v); } catch { /* ignore */ } };
  const notify = (msg: string) => { setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 2400); };

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const people = useMemo(() => {
    const s = new Set<string>();
    // Team members first-class, plus any other names already used on the board.
    const seen = new Set<string>();
    for (const n of [...team, ...tasks.map((t) => t.assignee), ...projects.map((p) => p.owner)]) {
      const k = n?.trim().toLowerCase();
      if (k && !seen.has(k)) { seen.add(k); s.add(n.trim()); }
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [tasks, projects, team]);

  useEffect(() => { if (assignee && !people.includes(assignee)) setAssignee(""); }, [people, assignee]);
  useEffect(() => { if (selected && selected !== NO_PROJECT && !projectsById.has(selected)) setSelected(""); }, [projectsById, selected]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (selected === NO_PROJECT) { if (t.projectId && projectsById.has(t.projectId)) return false; }
      else if (selected && t.projectId !== selected) return false;
      if (assignee && t.assignee !== assignee) return false;
      if (prio && t.priority !== prio) return false;
      if (needle && !`${t.title} ${t.notes} ${t.assignee}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [tasks, selected, assignee, prio, q, projectsById]);

  const moveTask = async (id: string, status: Status) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || t.status === status) return;
    board.applyTask({ ...t, status }); // optimistic
    try {
      board.applyTask(await api.updateTask(id, { status }));
      notify(status === "done" ? "Completed" : `Moved to ${STATUSES.find((s) => s.id === status)!.label}`);
    } catch (e) {
      board.applyTask(t);
      notify((e as Error).message);
    }
  };

  const openTaskById = (id: string) => {
    const t = tasks.find((x) => x.id === id);
    if (t) setTaskSheet({ open: true, task: t }); else notify("That task was deleted.");
  };

  const selectProject = (id: string) => {
    if (isMobile) { setSelected(id); goTab("tasks"); return; }
    setSelected((cur) => (cur === id && id !== "" ? "" : id));
  };
  const overdueCount = tasks.filter((t) => t.status !== "done" && t.due && t.due < today()).length;
  const filterNote = [assignee, prio && `${prio[0].toUpperCase() + prio.slice(1)} priority`].filter(Boolean).join(" · ");
  const empty = loaded && !loadError && !projects.length && !tasks.length;
  const offline = connection !== "live";
  const syncLabel = connection === "live" ? "Synced" : connection === "connecting" ? "Connecting" : "Offline";
  const selectedName = selected === NO_PROJECT ? "No project" : projectsById.get(selected)?.name ?? "";

  return (
    <>
      <div className="wall" aria-hidden="true"><i /><i /><i /></div>
      <div className="wrap">
        <header className="nav">
          <div className="ttl">
            <div className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
            <h1>Workboard</h1>
          </div>
          <div className="acts">
            <span className={"sync glass " + (connection === "live" ? "live" : "warn")} role="status">{syncLabel}</span>
            <a className="capsule glass leads-link" href="/leads/" aria-label="Leads">
              <Icon name="leads" /><span className="label-txt">Leads</span>
            </a>
            <button className="capsule glass" type="button" onClick={newProject} aria-label="New project">
              <Icon name="folder" /><span className="label-txt">Project</span>
            </button>
            <button className="capsule tint" type="button" onClick={newTask} aria-label="New task">
              <Icon name="plus" width={2.2} /><span className="label-txt">New Task</span>
            </button>
            <NotificationBell unread={board.unread} isMobile={isMobile} state={notes} onOpenTask={openTaskById} />
            <AccountMenu user={user} onSettings={() => setSettingsOpen(true)} onTeam={() => setTeamOpen(true)} onSignOut={onSignOut} />
          </div>
        </header>

        {loadError && (
          <div className="load-err glass" role="alert">
            <p>{loadError}</p>
            <button className="capsule glass" type="button" onClick={board.reload}>Try again</button>
          </div>
        )}
        {!loadError && offline && loaded && (
          <div className="banner glass"><span className="dot" /><p>Can't reach the server. Retrying, and changes from others will appear once you're back online.</p></div>
        )}

        {shows("overview") && <Widgets projects={projects} tasks={tasks} />}

        {shows("projects") && (
          <ProjectRail projects={projects} tasks={tasks} selected={selected} onSelect={selectProject} stacked={isMobile}
            onEdit={(p) => setProjSheet({ open: true, project: p })} />
        )}

        {shows("tasks") && <section aria-labelledby="tasksH">
          <div className="sec-h"><h2 id="tasksH">Tasks</h2><span className="aside">{selectedName}</span></div>
          {isMobile && (selected || filterNote) && (
            <div className="chips">
              {selected && <button type="button" className="chip-btn glass" onClick={() => setSelected("")}>{selectedName}<Icon name="close" width={2} /></button>}
              {assignee && <button type="button" className="chip-btn glass" onClick={() => setAssignee("")}>{assignee}<Icon name="close" width={2} /></button>}
              {prio && <button type="button" className="chip-btn glass" onClick={() => setPrio("")}>{prio[0].toUpperCase() + prio.slice(1)} priority<Icon name="close" width={2} /></button>}
            </div>
          )}
          <div className="toolbar">
            {!isMobile && <div className="segmented glass" role="group" aria-label="View">
              {(["board", "list", "timeline"] as View[]).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
              ))}
            </div>}
            <label className="search glass">
              <Icon name="search" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search tasks" />
            </label>
            {!isMobile && <>
            <select className="menu glass" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Filter by person">
              <option value="">Everyone</option>
              {people.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <select className="menu glass" value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="Filter by priority">
              <option value="">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
            </>}
          </div>

          {!loaded ? (
            <div className="empty glass"><h3>Loading your workboard</h3><p>Fetching projects and tasks.</p></div>
          ) : empty ? (
            <div className="empty glass">
              <div className="ico"><Icon name="board" width={1.6} /></div>
              <h3>Start your first project</h3>
              <p>Create a project, then add tasks to it. Everyone using Workboard sees the same board, updated live.</p>
              <div className="acts">
                <button type="button" className="capsule glass" onClick={newProject}>New Project</button>
                <button type="button" className="capsule tint" onClick={newTask}>New Task</button>
              </div>
            </div>
          ) : view === "board" ? (
            <BoardView tasks={filtered} projectsById={projectsById} selectedProject={selected} canEdit onOpen={(t) => setTaskSheet({ open: true, task: t })} onMove={moveTask} />
          ) : view === "list" ? (
            <ListView tasks={filtered} projectsById={projectsById} selectedProject={selected} canEdit onOpen={(t) => setTaskSheet({ open: true, task: t })} onMove={moveTask} />
          ) : (
            <TimelineView projects={projects} tasks={tasks} onSelect={(id) => { setSelected(id); setView("board"); }} />
          )}
        </section>}
      </div>

      {isMobile && (
        <TabBar tab={mobileTab} menuOpen={menuOpen} badge={overdueCount} onTab={goTab} onMenu={() => setMenuOpen(true)} onAdd={newTask} />
      )}
      <MenuSheet open={menuOpen && isMobile} onClose={() => setMenuOpen(false)}
        view={view} onView={(v) => { setView(v); goTab("tasks"); }}
        people={people} assignee={assignee} onAssignee={setAssignee} prio={prio} onPrio={setPrio}
        connection={connection} onNewTask={newTask} onNewProject={newProject}
        user={user} onSignOut={() => { setMenuOpen(false); onSignOut(); }}
        onSettings={() => { setMenuOpen(false); setSettingsOpen(true); }}
        onTeam={() => { setMenuOpen(false); setTeamOpen(true); }} />
      <SettingsSheet open={settingsOpen} user={user} onClose={() => setSettingsOpen(false)} notify={notify}
        onUserChange={(u) => { onUserChange(u); board.reload(); }}
        onPassword={() => { setSettingsOpen(false); setPasswordOpen(true); }}
        onTeam={() => { setSettingsOpen(false); setTeamOpen(true); }}
        onSignOut={() => { setSettingsOpen(false); onSignOut(); }} />
      <PasswordSheet open={passwordOpen} onClose={() => setPasswordOpen(false)} onDone={() => { setPasswordOpen(false); notify("Password changed"); }} />
      {user.role === "admin" && <TeamSheet open={teamOpen} me={user} onClose={() => setTeamOpen(false)} />}

      <datalist id="peopleList">{people.map((n) => <option key={n} value={n} />)}</datalist>

      <TaskSheet open={taskSheet.open} task={taskSheet.task} projects={projects} readOnly={false}
        defaultProjectId={projectsById.has(selected) ? selected : ""}
        onClose={() => setTaskSheet((s) => ({ ...s, open: false }))}
        onSave={async (input) => {
          const t = taskSheet.task ? await api.updateTask(taskSheet.task.id, input) : await api.createTask(input);
          board.applyTask(t);
          setTaskSheet((s) => ({ ...s, open: false }));
          notify(taskSheet.task ? "Task saved" : "Task added");
        }}
        onDelete={async () => {
          await api.deleteTask(taskSheet.task!.id);
          board.removeTask(taskSheet.task!.id);
          setTaskSheet((s) => ({ ...s, open: false }));
          notify("Task deleted");
        }} />

      <ProjectSheet open={projSheet.open} project={projSheet.project} colorHint={COLORS[projects.length % COLORS.length]}
        onClose={() => setProjSheet((s) => ({ ...s, open: false }))}
        onSave={async (input) => {
          const p = projSheet.project ? await api.updateProject(projSheet.project.id, input) : await api.createProject(input);
          board.applyProject(p);
          setProjSheet((s) => ({ ...s, open: false }));
          notify(projSheet.project ? "Project saved" : "Project created");
        }}
        onDelete={async () => {
          await api.deleteProject(projSheet.project!.id);
          board.removeProject(projSheet.project!.id);
          setProjSheet((s) => ({ ...s, open: false }));
          notify("Project deleted");
        }} />

      {toast && <div className="toast glass" role="status">{toast}</div>}
    </>
  );
}
