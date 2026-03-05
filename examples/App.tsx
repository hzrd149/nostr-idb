import React, { useCallback, useState } from "react";
import type { NostrEvent } from "nostr-tools/pure";
import { useNostrIDB } from "./hooks/useNostrIDB.ts";
import { useRelay } from "./hooks/useRelay.ts";
import { RelayPanel } from "./components/RelayPanel.tsx";
import { QueryPanel } from "./components/QueryPanel.tsx";
import { Nip91Panel } from "./components/Nip91Panel.tsx";
import { StatsPanel } from "./components/StatsPanel.tsx";
import { EventList } from "./components/EventList.tsx";
import { addEvents } from "../src/index.ts";

type Tab = "relay" | "query" | "nip91" | "stats";

export default function App() {
  const [tab, setTab] = useState<Tab>("relay");
  const [results, setResults] = useState<NostrEvent[]>([]);
  const [resultsLabel, setResultsLabel] = useState("Events");
  const [liveEvents, setLiveEvents] = useState<NostrEvent[]>([]);

  const dbState = useNostrIDB();

  const handleRelayEvent = useCallback(
    async (event: NostrEvent) => {
      setLiveEvents((prev) => {
        // deduplicate by id
        if (prev.find((e) => e.id === event.id)) return prev;
        return [event, ...prev].slice(0, 1000);
      });
      // auto-persist to IndexedDB
      if (dbState.db) {
        await addEvents(dbState.db, [event]);
        dbState.refreshCount();
      }
    },
    [dbState],
  );

  const relay = useRelay(handleRelayEvent);

  function handleQueryResults(events: NostrEvent[], label = "Query Results") {
    setResults(events);
    setResultsLabel(label);
  }

  const visibleEvents: NostrEvent[] = tab === "relay" ? liveEvents : results;

  const visibleLabel =
    tab === "relay"
      ? `Live stream (${liveEvents.length} buffered)`
      : resultsLabel;

  return (
    <div className="app">
      <header className="app-header">
        <h1>nostr-idb</h1>
        <span className="badge">IndexedDB explorer</span>
        {!dbState.ready && (
          <span className="badge" style={{ color: "var(--yellow)" }}>
            opening db…
          </span>
        )}
      </header>

      <div className="app-body">
        {/* ── Sidebar ── */}
        <aside className="sidebar">
          <RelayPanel relay={relay} dbState={dbState} liveEvents={liveEvents} />
          <StatsPanel dbState={dbState} />
        </aside>

        {/* ── Main ── */}
        <div className="main-content">
          <div className="tabs">
            <button
              className={`tab${tab === "relay" ? " active" : ""}`}
              onClick={() => setTab("relay")}
            >
              Live Stream
            </button>
            <button
              className={`tab${tab === "query" ? " active" : ""}`}
              onClick={() => setTab("query")}
            >
              Query DB
            </button>
            <button
              className={`tab${tab === "nip91" ? " active" : ""}`}
              onClick={() => setTab("nip91")}
            >
              NIP-91 AND Filter
            </button>
          </div>

          <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
            {/* panel column */}
            <div
              style={{
                width: 340,
                borderRight: "1px solid var(--border)",
                overflowY: "auto",
                background: "var(--bg-panel)",
                flexShrink: 0,
              }}
            >
              {tab === "relay" && (
                <div className="panel">
                  <p className="panel-title">Live Stream</p>
                  <p
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--text-muted)",
                      margin: 0,
                    }}
                  >
                    Events are automatically stored in IndexedDB as they arrive.
                    Use the Relay panel on the left to connect and subscribe.
                  </p>
                  <div style={{ marginTop: 12 }}>
                    <div className="stat-row">
                      <span className="stat-label">Buffered in view</span>
                      <span
                        className="stat-value"
                        style={{ fontFamily: "var(--mono)" }}
                      >
                        {liveEvents.length}
                      </span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">Relay received</span>
                      <span
                        className="stat-value"
                        style={{ fontFamily: "var(--mono)" }}
                      >
                        {relay.received}
                      </span>
                    </div>
                  </div>
                  {liveEvents.length > 0 && (
                    <div className="btn-row" style={{ marginTop: 10 }}>
                      <button
                        className="btn-secondary"
                        onClick={() => setLiveEvents([])}
                      >
                        Clear view
                      </button>
                    </div>
                  )}
                </div>
              )}
              {tab === "query" && (
                <QueryPanel dbState={dbState} onResults={handleQueryResults} />
              )}
              {tab === "nip91" && (
                <Nip91Panel dbState={dbState} onResults={handleQueryResults} />
              )}
            </div>

            {/* event list column */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <EventList events={visibleEvents} label={visibleLabel} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
