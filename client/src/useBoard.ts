import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Project, Task } from "./types";

export type Connection = "connecting" | "live" | "offline";

type ServerEvent =
  | { type: "project.upsert"; project: Project }
  | { type: "project.delete"; id: string }
  | { type: "task.upsert"; task: Task }
  | { type: "task.delete"; id: string };

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];

/** Loads the board and keeps it in sync with every other open browser via Server-Sent Events. */
export function useBoard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");

  const reload = useCallback(async () => {
    try {
      const b = await api.board();
      setProjects(b.projects);
      setTasks(b.tasks);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/events");
    // Reload on every (re)connect so nothing missed while offline is lost.
    es.onopen = () => { setConnection("live"); reload(); };
    es.onerror = () => setConnection(es.readyState === EventSource.CLOSED ? "offline" : "connecting");
    es.onmessage = (msg) => {
      const ev = JSON.parse(msg.data) as ServerEvent;
      switch (ev.type) {
        case "project.upsert": setProjects((l) => upsert(l, ev.project)); break;
        case "project.delete":
          setProjects((l) => l.filter((p) => p.id !== ev.id));
          setTasks((l) => l.map((t) => (t.projectId === ev.id ? { ...t, projectId: "" } : t)));
          break;
        case "task.upsert": setTasks((l) => upsert(l, ev.task)); break;
        case "task.delete": setTasks((l) => l.filter((t) => t.id !== ev.id)); break;
      }
    };
    return () => es.close();
  }, [reload]);

  // Apply our own writes right away instead of waiting for the broadcast.
  const applyProject = useCallback((p: Project) => setProjects((l) => upsert(l, p)), []);
  const removeProject = useCallback((id: string) => {
    setProjects((l) => l.filter((p) => p.id !== id));
    setTasks((l) => l.map((t) => (t.projectId === id ? { ...t, projectId: "" } : t)));
  }, []);
  const applyTask = useCallback((t: Task) => setTasks((l) => upsert(l, t)), []);
  const removeTask = useCallback((id: string) => setTasks((l) => l.filter((t) => t.id !== id)), []);

  return { projects, tasks, loaded, loadError, connection, reload, applyProject, removeProject, applyTask, removeTask };
}
