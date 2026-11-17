import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Project, Task } from "./types";

export type Connection = "connecting" | "live" | "offline";

const POLL_MS = 4000;

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];

/**
 * Loads the board and keeps it in sync with everyone else.
 * Every few seconds (while the tab is visible) it asks the server for a change counter
 * and reloads the board only when that counter moved.
 */
export function useBoard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const rev = useRef<number | null>(null);

  const reload = useCallback(async () => {
    try {
      const b = await api.board();
      rev.current = b.rev;
      setProjects(b.projects);
      setTasks(b.tasks);
      setLoadError(null);
      setConnection("live");
    } catch (e) {
      setLoadError((e as Error).message);
      setConnection("offline");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          const { rev: latest } = await api.revision();
          setConnection("live");
          if (latest !== rev.current) await reload();
        } catch {
          setConnection("offline");
        }
      }
      if (!stopped) timer = window.setTimeout(tick, POLL_MS);
    };
    const onVisible = () => { if (document.visibilityState === "visible") { clearTimeout(timer); tick(); } };
    reload().then(() => { timer = window.setTimeout(tick, POLL_MS); });
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [reload]);

  // Apply our own writes right away; the next poll confirms them.
  const applyProject = useCallback((p: Project) => setProjects((l) => upsert(l, p)), []);
  const removeProject = useCallback((id: string) => {
    setProjects((l) => l.filter((p) => p.id !== id));
    setTasks((l) => l.map((t) => (t.projectId === id ? { ...t, projectId: "" } : t)));
  }, []);
  const applyTask = useCallback((t: Task) => setTasks((l) => upsert(l, t)), []);
  const removeTask = useCallback((id: string) => setTasks((l) => l.filter((t) => t.id !== id)), []);

  return { projects, tasks, loaded, loadError, connection, reload, applyProject, removeProject, applyTask, removeTask };
}
