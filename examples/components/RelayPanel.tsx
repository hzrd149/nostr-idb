import React, { useState } from "react";
import type { DBState } from "../hooks/useNostrIDB.ts";
import type { RelayState } from "../hooks/useRelay.ts";
import type { NostrEvent } from "nostr-tools/pure";
import { addEvents } from "../../src/index.ts";

const DEFAULT_RELAY = "wss://relay.damus.io";

const DEFAULT_FILTERS = JSON.stringify([{ kinds: [1], limit: 100 }], null, 2);

type Props = {
  relay: RelayState;
  dbState: DBState;
  liveEvents: NostrEvent[];
};

export function RelayPanel({ relay, dbState, liveEvents }: Props) {
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY);
  const [filterStr, setFilterStr] = useState(DEFAULT_FILTERS);
  const [filterErr, setFilterErr] = useState("");

  function handleConnect() {
    setFilterErr("");
    let filters: object[];
    try {
      const parsed = JSON.parse(filterStr);
      filters = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      setFilterErr("Invalid JSON in filter");
      return;
    }
    relay.connect(relayUrl, filters);
  }

  const dotClass =
    relay.status === "connected"
      ? "dot dot-green"
      : relay.status === "connecting"
        ? "dot dot-yellow"
        : relay.status === "error"
          ? "dot dot-red"
          : "dot dot-red";

  return (
    <div className="panel">
      <p className="panel-title">Relay Connection</p>

      <div className="stat-row">
        <span className="stat-label">Status</span>
        <span className="stat-value">
          <span className={dotClass} />
          {relay.status}
        </span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Received</span>
        <span className="stat-value">{relay.received}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Stored (DB)</span>
        <span className="stat-value">{dbState.eventCount}</span>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>Relay URL</label>
        <input
          type="text"
          value={relayUrl}
          onChange={(e) => setRelayUrl(e.target.value)}
          placeholder="wss://relay.damus.io"
        />
      </div>

      <div className="field">
        <label>Subscription filters (JSON array)</label>
        <textarea
          rows={6}
          value={filterStr}
          onChange={(e) => setFilterStr(e.target.value)}
        />
        {filterErr && (
          <div
            style={{ color: "var(--red)", fontSize: "0.75rem", marginTop: 4 }}
          >
            {filterErr}
          </div>
        )}
      </div>

      <div className="btn-row">
        {relay.status === "connected" || relay.status === "connecting" ? (
          <button className="btn-danger" onClick={relay.disconnect}>
            Disconnect
          </button>
        ) : (
          <button className="btn-primary" onClick={handleConnect}>
            Connect
          </button>
        )}
        <button
          className="btn-secondary"
          disabled={liveEvents.length === 0 || !dbState.db}
          onClick={async () => {
            if (!dbState.db) return;
            await addEvents(dbState.db, liveEvents);
            await dbState.refreshCount();
          }}
        >
          Save {liveEvents.length} to DB
        </button>
      </div>

      {relay.log.length > 0 && (
        <div className="scrollbox" style={{ marginTop: 12 }}>
          {relay.log.map((entry) => (
            <div key={entry.ts} className={`log-line ${entry.kind}`}>
              {entry.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
