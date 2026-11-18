import { useEffect, useRef, useState, type ReactNode } from "react";
import { initials, personColor } from "../lib";

const PATHS = {
  cal: <><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 7h11M5.5 2v3M10.5 2v3" /></>,
  check: <path d="m3.5 8.5 3 3 6-7" />,
  dots: <><circle cx="4" cy="8" r=".9" fill="currentColor" /><circle cx="8" cy="8" r=".9" fill="currentColor" /><circle cx="12" cy="8" r=".9" fill="currentColor" /></>,
  rings: <><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.5" /></>,
  bolt: <path d="M9 2 4 9h4l-1 5 5-7H8z" />,
  people: <><circle cx="6" cy="6" r="2.3" /><path d="M2 13c.6-2.2 2.1-3.3 4-3.3s3.4 1.1 4 3.3M10.5 4a2 2 0 0 1 0 4M12 10c1 .4 1.7 1.4 2 3" /></>,
  board: <><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /><path d="M6.2 2.5v11M9.8 2.5v11" /></>,
  plus: <path d="M8 3v10M3 8h10" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  folder: <><rect x="2" y="3" width="12" height="10" rx="2.5" /><path d="M2 6.5h12" /></>,
  search: <><circle cx="7" cy="7" r="4.8" /><path d="m10.6 10.6 3.2 3.2" /></>,
  grid: <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.3" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1.3" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1.3" /><rect x="9" y="9" width="4.5" height="4.5" rx="1.3" /></>,
  tasks: <><path d="m2.5 4 1.2 1.2L6 3M2.5 10l1.2 1.2L6 9" /><path d="M8.5 4.2h5M8.5 10.2h5" /></>,
  menu: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />,
  list: <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />,
  timeline: <><path d="M2.5 3.5v9h11" /><path d="M5 6h4M7 9h5" /></>,
  bell: <><path d="M4 11.5V7.5a4 4 0 0 1 8 0v4l1 1H3z" /><path d="M6.5 13.5a1.6 1.6 0 0 0 3 0" /></>,
  gear: <><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.6M8 12.6v1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M1.8 8h1.6M12.6 8h1.6M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" /></>,
  arrow: <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />,
  leads: <><circle cx="6" cy="5.5" r="2.3" /><path d="M2 13c.5-2.3 2-3.6 4-3.6s3.5 1.3 4 3.6" /><path d="M11 6.5h3.5M11 9h3.5M12.5 11.5h2" /></>,
};
export type IconName = keyof typeof PATHS;

export function Icon({ name, width = 1.8, className }: { name: IconName; width?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function Chevron() {
  return <svg className="chev" viewBox="0 0 9 13" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m2 1.5 5 5-5 5" /></svg>;
}

export function Avatar({ name, small }: { name: string; small?: boolean }) {
  return <span className={"av" + (small ? " sm" : "")} style={{ background: personColor(name) }} title={name}>{initials(name)}</span>;
}

/** Concentric progress rings, outermost first. */
export function Rings({ size, rings, label }: { size: number; rings: { pct: number; color: string }[]; label: string }) {
  const big = size > 60;
  const w = big ? 13 : 6, gap = big ? 3 : 0, c = size / 2;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={big ? "ring-svg" : "mini-ring"} role="img" aria-label={label}>
      {rings.map((r, i) => {
        const rad = c - w / 2 - i * (w + gap);
        return (
          <g key={i} transform={`rotate(-90 ${c} ${c})`}>
            <circle cx={c} cy={c} r={rad} fill="none" stroke={r.color} strokeOpacity={0.2} strokeWidth={w} />
            {r.pct > 0 && (
              <circle cx={c} cy={c} r={rad} fill="none" stroke={r.color} strokeWidth={w} strokeLinecap="round"
                pathLength={100} strokeDasharray={`${Math.min(100, Math.max(0.5, r.pct))} 100`} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** A native <dialog> rendered as an iOS-style sheet. */
export function Sheet({ open, onClose, title, onSubmit, canSave, children }: {
  open: boolean; onClose: () => void; title: string; onSubmit?: () => void; canSave: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} aria-label={title}>
      <form className="sheet" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
        <div className="sheet-h">
          <button type="button" className="round l" onClick={onClose} aria-label="Close"><Icon name="close" width={2} /></button>
          <h2>{title}</h2>
          {canSave ? <button type="submit" className="round tint r" aria-label="Save"><Icon name="check" width={2.2} /></button> : <span />}
        </div>
        <div className="sheet-body">{children}</div>
      </form>
    </dialog>
  );
}

export function ConfirmDelete({ label, warning, onDelete }: { label: string; warning: string; onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" className="danger-btn" onClick={() => setAsking(true)}>{label}</button>;
  return (
    <div className="confirm">{warning}
      <div className="btns">
        <button type="button" className="no" onClick={() => setAsking(false)}>Cancel</button>
        <button type="button" className="yes" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
