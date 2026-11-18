import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AppNotification } from "../types";
import { desktopAlertsOn } from "../theme";
import { Icon, Sheet, type IconName } from "./ui";

const TYPE_ICON: Record<AppNotification["type"], { icon: IconName; color: string }> = {
  assigned: { icon: "people", color: "var(--blue)" },
  status: { icon: "arrow", color: "var(--indigo)" },
  due: { icon: "cal", color: "var(--orange)" },
  completed: { icon: "check", color: "var(--green)" },
  lead: { icon: "leads", color: "var(--teal)" },
  leaddue: { icon: "leads", color: "var(--orange)" },
};

function timeAgo(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "Just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Loads the list on demand, and shows desktop alerts when new ones arrive (if turned on). */
export function useNotifications(unread: number, setUnread: (n: number) => void) {
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prevUnread = useRef<number | null>(null);
  const shown = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const r = await api.notifications();
      setItems(r.items); setUnread(r.unread); setError(null);
      return r.items;
    } catch (e) { setError((e as Error).message); return null; }
  }, [setUnread]);

  // When the unread count goes up, fetch the new items and (optionally) alert.
  useEffect(() => {
    const before = prevUnread.current;
    prevUnread.current = unread;
    if (before === null) { load().then((list) => list?.forEach((n) => shown.current.add(n.id))); return; }
    if (unread <= before) return;
    load().then((list) => {
      if (!list) return;
      const fresh = list.filter((n) => !n.read && !shown.current.has(n.id));
      fresh.forEach((n) => shown.current.add(n.id));
      const canAlert = desktopAlertsOn() && "Notification" in window && Notification.permission === "granted";
      if (canAlert && (document.visibilityState !== "visible" || !document.hasFocus())) {
        for (const n of fresh.slice(0, 3)) {
          try { new Notification(n.title, { body: n.body || "Workboard", tag: n.id }); } catch { /* some browsers refuse */ }
        }
      }
    });
  }, [unread, load]);

  const markRead = useCallback(async (opts: { ids?: string[]; all?: boolean }) => {
    setItems((list) => list?.map((n) => (opts.all || opts.ids?.includes(n.id) ? { ...n, read: true } : n)) ?? null);
    try { setUnread((await api.markRead(opts)).unread); } catch { /* next poll corrects it */ }
  }, [setUnread]);

  return { items, error, load, markRead };
}

function List({ items, error, onOpen, onMarkAll, hasUnread }: {
  items: AppNotification[] | null; error: string | null; hasUnread: boolean;
  onOpen: (n: AppNotification) => void; onMarkAll: () => void;
}) {
  return (
    <>
      <div className="nt-head">
        <b>Notifications</b>
        {hasUnread && <button type="button" className="link" onClick={onMarkAll}>Mark all read</button>}
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {!items && !error && <p className="hint nt-empty">Loading…</p>}
      {items && !items.length && (
        <div className="nt-empty">
          <div className="nt-empty-ico"><Icon name="bell" width={1.6} /></div>
          <b>You're all caught up</b>
          <span>Tasks assigned to you, changes to them, finished work, lead follow-ups and due-date reminders show up here.</span>
        </div>
      )}
      {items && items.length > 0 && (
        <ul className="nt-list">
          {items.map((n) => (
            <li key={n.id}>
              <button type="button" className={"nt-item" + (n.read ? "" : " unread")} onClick={() => onOpen(n)}>
                <span className="nt-ico" style={{ background: TYPE_ICON[n.type].color }}><Icon name={TYPE_ICON[n.type].icon} width={2} /></span>
                <span className="nt-txt">
                  <span className="nt-title">{n.title}</span>
                  <span className="nt-meta">{[n.body, timeAgo(n.createdAt)].filter(Boolean).join(" · ")}</span>
                </span>
                {!n.read && <span className="nt-dot" aria-label="Unread" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Bell button with unread badge. Desktop: dropdown panel. Phone: bottom sheet. */
export function NotificationBell({ unread, isMobile, state, onOpenTask }: {
  unread: number; isMobile: boolean;
  state: ReturnType<typeof useNotifications>;
  onOpenTask: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || isMobile) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest(".bell-wrap")) setOpen(false);
    };
    document.addEventListener("click", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", close); };
  }, [open, isMobile]);

  const toggle = () => { if (!open) state.load(); setOpen((o) => !o); };
  const openItem = (n: AppNotification) => {
    if (!n.read) state.markRead({ ids: [n.id] });
    setOpen(false);
    if (n.link) { location.href = n.link; return; }
    if (n.taskId) onOpenTask(n.taskId);
  };
  const list = <List items={state.items} error={state.error} hasUnread={unread > 0} onOpen={openItem} onMarkAll={() => state.markRead({ all: true })} />;

  return (
    <div className="bell-wrap">
      <button type="button" className="bell glass" onClick={toggle} aria-haspopup="dialog" aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
        <Icon name="bell" width={1.8} />
        {unread > 0 && <span className="badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {!isMobile && open && <div className="nt-pop glass" role="dialog" aria-label="Notifications">{list}</div>}
      {isMobile && <Sheet open={open} onClose={() => setOpen(false)} title="Notifications" canSave={false}><div className="nt-sheet">{list}</div></Sheet>}
    </div>
  );
}
