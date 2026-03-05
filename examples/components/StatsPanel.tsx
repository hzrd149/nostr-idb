import React, { useState } from "react";
import type { DBState } from "../hooks/useNostrIDB.ts";
import {
  countEventsByKind,
  countEventsByPubkeys,
  deleteAllEvents,
} from "../../src/index.ts";

type Props = { dbState: DBState };

export function StatsPanel({ dbState }: Props) {
  const [kindStats, setKindStats] = useState<Record<string, number> | null>(
    null,
  );
  const [pubkeyStats, setPubkeyStats] = useState<Record<string, number> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  async function loadStats() {
    if (!dbState.db) return;
    setLoading(true);
    const [k, p] = await Promise.all([
      countEventsByKind(dbState.db),
      countEventsByPubkeys(dbState.db),
    ]);
    setKindStats(k);
    setPubkeyStats(p);
    setLoading(false);
  }

  async function clearDB() {
    if (!dbState.db) return;
    if (!confirm("Delete ALL events from IndexedDB?")) return;
    await deleteAllEvents(dbState.db);
    await dbState.refreshCount();
    setKindStats(null);
    setPubkeyStats(null);
  }

  const topKinds = kindStats
    ? Object.entries(kindStats)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
    : [];

  const topPubkeys = pubkeyStats
    ? Object.entries(pubkeyStats)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
    : [];

  return (
    <div className="panel">
      <p className="panel-title">Database Stats</p>

      <div className="stat-row">
        <span className="stat-label">Total events</span>
        <span className="stat-value" style={{ fontFamily: "var(--mono)" }}>
          {dbState.eventCount.toLocaleString()}
        </span>
      </div>

      <div className="btn-row" style={{ marginTop: 10 }}>
        <button
          className="btn-secondary"
          onClick={loadStats}
          disabled={loading || !dbState.ready}
        >
          {loading ? "Loading…" : "Load Stats"}
        </button>
        <button
          className="btn-danger"
          onClick={clearDB}
          disabled={!dbState.ready}
        >
          Clear DB
        </button>
      </div>

      {topKinds.length > 0 && (
        <>
          <p
            style={{
              margin: "14px 0 6px",
              fontSize: "0.7rem",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              letterSpacing: "0.08em",
            }}
          >
            Top kinds
          </p>
          {topKinds.map(([kind, count]) => (
            <div className="stat-row" key={kind}>
              <span
                className="stat-label"
                style={{ fontFamily: "var(--mono)" }}
              >
                kind {kind}
              </span>
              <span
                className="stat-value"
                style={{ fontFamily: "var(--mono)" }}
              >
                {count.toLocaleString()}
              </span>
            </div>
          ))}
        </>
      )}

      {topPubkeys.length > 0 && (
        <>
          <p
            style={{
              margin: "14px 0 6px",
              fontSize: "0.7rem",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              letterSpacing: "0.08em",
            }}
          >
            Top authors
          </p>
          {topPubkeys.map(([pubkey, count]) => (
            <div className="stat-row" key={pubkey}>
              <span
                className="stat-label"
                style={{ fontFamily: "var(--mono)" }}
              >
                {pubkey.slice(0, 12)}…
              </span>
              <span
                className="stat-value"
                style={{ fontFamily: "var(--mono)" }}
              >
                {count.toLocaleString()}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
