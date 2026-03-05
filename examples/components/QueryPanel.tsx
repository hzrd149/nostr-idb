import React, { useState } from "react";
import type { NostrEvent } from "nostr-tools/pure";
import type { DBState } from "../hooks/useNostrIDB.ts";
import { getEventsForFilter } from "../../src/index.ts";
import type { Filter } from "../../src/types.ts";

const DEFAULT_FILTER = JSON.stringify({ kinds: [1], limit: 50 }, null, 2);

type Props = {
  dbState: DBState;
  onResults: (events: NostrEvent[]) => void;
};

export function QueryPanel({ dbState, onResults }: Props) {
  const [filterStr, setFilterStr] = useState(DEFAULT_FILTER);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);

  async function runQuery() {
    if (!dbState.db) return;
    setError("");
    setElapsed(null);
    let filter: Filter;
    try {
      filter = JSON.parse(filterStr) as Filter;
    } catch {
      setError("Invalid JSON");
      return;
    }

    setLoading(true);
    const t0 = performance.now();
    try {
      const events = await getEventsForFilter(
        dbState.db,
        filter,
        dbState.indexCache,
      );
      setElapsed(performance.now() - t0);
      onResults(events);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <p className="panel-title">Query DB</p>

      <div className="field">
        <label>Filter (JSON — NIP-01 fields supported)</label>
        <textarea
          rows={10}
          value={filterStr}
          onChange={(e) => setFilterStr(e.target.value)}
        />
        {error && (
          <div
            style={{ color: "var(--red)", fontSize: "0.75rem", marginTop: 4 }}
          >
            {error}
          </div>
        )}
      </div>

      <div className="btn-row">
        <button
          className="btn-primary"
          onClick={runQuery}
          disabled={loading || !dbState.ready}
        >
          {loading ? "Querying…" : "Run Query"}
        </button>
        <button
          className="btn-secondary"
          onClick={() => {
            onResults([]);
            setElapsed(null);
          }}
        >
          Clear
        </button>
      </div>

      {elapsed !== null && (
        <div
          style={{
            marginTop: 8,
            fontSize: "0.75rem",
            color: "var(--text-muted)",
            fontFamily: "var(--mono)",
          }}
        >
          Completed in {elapsed.toFixed(1)} ms
        </div>
      )}
    </div>
  );
}
