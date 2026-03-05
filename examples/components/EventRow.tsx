import React, { useState } from "react";
import type { NostrEvent } from "nostr-tools/pure";

function reltime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function EventRow({ event }: { event: NostrEvent }) {
  const [expanded, setExpanded] = useState(false);

  const preview = event.content.replace(/\n/g, " ").slice(0, 120);

  return (
    <>
      <div
        className={`event-row${expanded ? " expanded" : ""}`}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="event-kind">k:{event.kind}</span>
        <span className="event-pubkey">{event.pubkey.slice(0, 6)}</span>
        <span className="event-content">
          {preview || (
            <em style={{ color: "var(--text-muted)" }}>(no content)</em>
          )}
        </span>
        <span className="event-time">{reltime(event.created_at)}</span>
      </div>
      {expanded && (
        <div className="event-expanded">
          <pre className="event-json">{JSON.stringify(event, null, 2)}</pre>
        </div>
      )}
    </>
  );
}
