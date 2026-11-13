import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  CirclePlus,
  Download,
  Zap,
  ChartPie,
  RefreshCw,
  Database,
  type LucideIcon,
} from "lucide-react";
import type { Filter } from "../src/index.ts";
import { ActivityLog } from "./components/ActivityLog.tsx";
import { DatabasePicker, DatabaseTabs } from "./components/DatabaseTabs.tsx";
import { AppCtx, type Tab } from "./lib/app.ts";
import { manager, useDB, useLiveStats } from "./lib/db.ts";
import { useFrameLag } from "./lib/lag.ts";
import { fmtBytes, fmtNum } from "./lib/nostr.ts";
import { ImportPage } from "./pages/ImportPage.tsx";
import { InspectPage } from "./pages/InspectPage.tsx";
import { QueryPage } from "./pages/QueryPage.tsx";
import { StorePage } from "./pages/StorePage.tsx";
import { StressPage } from "./pages/StressPage.tsx";
import { SyncPage } from "./pages/SyncPage.tsx";

const TABS: { tab: Tab; icon: LucideIcon; label: string; key: string }[] = [
  { tab: "query", icon: Search, label: "Query", key: "1" },
  { tab: "store", icon: CirclePlus, label: "Store", key: "2" },
  { tab: "import", icon: Download, label: "Import", key: "3" },
  { tab: "sync", icon: RefreshCw, label: "Sync", key: "4" },
  { tab: "stress", icon: Zap, label: "Stress", key: "5" },
  { tab: "inspect", icon: ChartPie, label: "Inspect", key: "6" },
];

function Header() {
  const stats = useLiveStats(1000);
  const { worker, backend } = useDB();
  const lag = useFrameLag();

  return (
    <header className="header">
      <span className="logo">nostr-idb</span>
      <DatabaseTabs />
      <span style={{ flex: 1 }} />
      <span className="header-stats">
        {stats && (
          <>
            {backend === "snort" && (
              <span
                className="badge"
                title="@snort/worker-relay: SQLite-WASM on OPFS in a worker"
              >
                snort worker-relay
              </span>
            )}
            <span
              title={
                backend === "snort"
                  ? "events in the worker-relay's SQLite database"
                  : "events in IndexedDB"
              }
            >
              <b>{fmtNum(stats.events)}</b> events
            </span>
            {/* NostrIDB internals are only readable on the main thread */}
            {stats.pendingWrites !== undefined && (
              <span
                title="events waiting in the write queue"
                className={stats.pendingWrites ? "warn" : ""}
              >
                <b>{fmtNum(stats.pendingWrites)}</b> queued
              </span>
            )}
            {stats.cachedIndexes !== undefined && (
              <span title="indexes in the in-memory index cache">
                <b>{fmtNum(stats.cachedIndexes)}</b> indexes
              </span>
            )}
            {stats.memoryEvents !== undefined && (
              <span title="events held in memory">
                <b>{fmtNum(stats.memoryEvents)}</b> in memory
              </span>
            )}
            {stats.subscriptions !== undefined && (
              <span title="open subscriptions">
                <b>{stats.subscriptions}</b> subs
              </span>
            )}
            <span title="origin storage usage">
              <b>{fmtBytes(stats.usage)}</b>
            </span>
          </>
        )}
        <span
          title={
            "Longest gap between frames in the last second. " +
            (backend === "snort"
              ? "This database runs in the snort worker-relay's worker, so its work does not block the page."
              : worker
                ? "This database runs in a worker, so its work does not block the page."
                : "This database runs on the main thread, so heavy work stalls the page.")
          }
          className={lag > 200 ? "bad" : lag > 50 ? "warn" : ""}
        >
          <b>{lag}ms</b> UI lag
        </span>
      </span>
    </header>
  );
}

function NoDatabase() {
  return (
    <div className="no-database">
      <div className="no-database-card">
        <h2>
          <Database size={22} /> No database open
        </h2>
        <p className="muted">
          Create a new database or open one that already exists in this browser.
        </p>
        <DatabasePicker />
      </div>
    </div>
  );
}

export default function App() {
  const { name } = useDB();
  const [tab, setTab] = useState<Tab>("query");
  const [request, setRequest] = useState<{
    filters: Filter[];
    nonce: number;
  } | null>(null);

  useEffect(() => {
    manager.init();
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const t = TABS.find((t) => t.key === e.key);
      if (t) {
        e.preventDefault();
        setTab(t.tab);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ctx = useMemo(
    () => ({
      tab,
      goto: setTab,
      openQuery: (filters: Filter[]) => {
        setRequest({ filters, nonce: Date.now() });
        setTab("query");
      },
    }),
    [tab],
  );

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <Header />
        <nav className="nav">
          {TABS.map((t) => (
            <button
              key={t.tab}
              className={tab === t.tab ? "on" : ""}
              onClick={() => setTab(t.tab)}
              title={`Alt+${t.key}`}
            >
              <t.icon className="nav-icon" size={22} />
              {t.label}
            </button>
          ))}
        </nav>
        <main className="app-content" key={name}>
          {name ? (
            <>
              <div className="tab" hidden={tab !== "query"}>
                <QueryPage request={request} active={tab === "query"} />
              </div>
              <div className="tab" hidden={tab !== "store"}>
                <StorePage />
              </div>
              <div className="tab" hidden={tab !== "import"}>
                <ImportPage />
              </div>
              <div className="tab" hidden={tab !== "sync"}>
                <SyncPage />
              </div>
              <div className="tab" hidden={tab !== "stress"}>
                <StressPage />
              </div>
              <div className="tab" hidden={tab !== "inspect"}>
                <InspectPage active={tab === "inspect"} />
              </div>
            </>
          ) : (
            <NoDatabase />
          )}
        </main>
        <ActivityLog />
      </div>
    </AppCtx.Provider>
  );
}
