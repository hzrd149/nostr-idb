import React, { useMemo, useState } from "react";
import { clearActivity, useActivity, type Activity } from "../lib/activity.ts";
import { fmtMs } from "../lib/nostr.ts";

function durationTone(ms?: number) {
  if (ms === undefined) return "";
  if (ms < 16) return "fast";
  if (ms < 200) return "ok";
  if (ms < 1000) return "slow";
  return "veryslow";
}

function Row({ a, max }: { a: Activity; max: number }) {
  const d = a.duration;
  return (
    <div className={`act-row ${a.status}`}>
      <span className="act-time">
        {new Date(a.time).toLocaleTimeString(undefined, { hour12: false })}
      </span>
      <span className={`act-cat cat-${a.category}`}>{a.category}</span>
      <span className="act-label" title={a.detail}>
        {a.label}
        {a.detail && <span className="muted"> {a.detail}</span>}
      </span>
      <span className="act-result" title={a.result}>
        {a.result}
      </span>
      <span className="act-bar">
        {d !== undefined && (
          <span
            className={`act-bar-fill ${durationTone(d)}`}
            style={{
              width: `${Math.max(1, (Math.log1p(d) / Math.log1p(max)) * 100)}%`,
            }}
          />
        )}
      </span>
      <span className={`act-dur ${durationTone(d)}`}>
        {a.status === "running" ? <span className="spinner" /> : fmtMs(d)}
      </span>
    </div>
  );
}

export function ActivityLog() {
  const entries = useActivity();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries)
      counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    return [...counts];
  }, [entries]);

  const visible = category
    ? entries.filter((e) => e.category === category)
    : entries;
  const max = Math.max(1, ...visible.slice(0, 300).map((e) => e.duration ?? 0));
  const running = entries.filter((e) => e.status === "running").length;
  const latest = entries[0];

  return (
    <div className={`activity ${open ? "open" : ""}`}>
      <div className="activity-bar" onClick={() => setOpen((o) => !o)}>
        <span className="activity-toggle">{open ? "▾" : "▴"}</span>
        <span className="activity-title">Activity</span>
        <span className="pill">{entries.length}</span>
        {running > 0 && (
          <span className="pill warn">
            <span className="spinner" /> {running}
          </span>
        )}
        {!open && latest && (
          <span className="activity-latest">
            <span className={`act-cat cat-${latest.category}`}>
              {latest.category}
            </span>
            {latest.label}
            <span className="muted">{latest.result}</span>
            <span className={`act-dur ${durationTone(latest.duration)}`}>
              {latest.status === "running" ? "…" : fmtMs(latest.duration)}
            </span>
          </span>
        )}
        {open && (
          <span
            className="activity-filters"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className={category === null ? "on" : ""}
              onClick={() => setCategory(null)}
            >
              all
            </button>
            {categories.map(([c, n]) => (
              <button
                key={c}
                className={`cat-${c} ${category === c ? "on" : ""}`}
                onClick={() => setCategory(category === c ? null : c)}
              >
                {c} <span className="muted">{n}</span>
              </button>
            ))}
            <button onClick={clearActivity}>clear</button>
          </span>
        )}
      </div>
      {open && (
        <div className="activity-list">
          {visible.slice(0, 500).map((a) => (
            <Row key={a.id} a={a} max={max} />
          ))}
        </div>
      )}
    </div>
  );
}
