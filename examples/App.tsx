import React, { useEffect, useMemo, useState } from "react";
import type { Filter } from "../src/index.ts";
import { ActivityLog } from "./components/ActivityLog.tsx";
import { Field, NumberField } from "./components/ui.tsx";
import { AppCtx, type Tab } from "./lib/app.ts";
import {
  DEFAULT_OPTIONS,
  manager,
  useDB,
  useLiveStats,
  type ExplorerOptions,
} from "./lib/db.ts";
import { fmtBytes, fmtNum } from "./lib/nostr.ts";
import { ImportPage } from "./pages/ImportPage.tsx";
import { InspectPage } from "./pages/InspectPage.tsx";
import { QueryPage } from "./pages/QueryPage.tsx";
import { StorePage } from "./pages/StorePage.tsx";
import { StressPage } from "./pages/StressPage.tsx";

const TABS: { tab: Tab; icon: string; label: string; key: string }[] = [
  { tab: "query", icon: "⌕", label: "Query", key: "1" },
  { tab: "store", icon: "＋", label: "Store", key: "2" },
  { tab: "import", icon: "⇣", label: "Import", key: "3" },
  { tab: "stress", icon: "⚡", label: "Stress", key: "4" },
  { tab: "inspect", icon: "◫", label: "Inspect", key: "5" },
];

function OptionsPopover({ onClose }: { onClose: () => void }) {
  const { options, name } = useDB();
  const [draft, setDraft] = useState<ExplorerOptions>(options);
  const [dbName, setDbName] = useState(name);
  const set = (k: keyof ExplorerOptions) => (v: number) =>
    setDraft((d) => ({ ...d, [k]: v }));
  return (
    <div className="popover" onClick={(e) => e.stopPropagation()}>
      <Field label="database">
        <input
          className="grow"
          value={dbName}
          onChange={(e) => setDbName(e.target.value)}
        />
      </Field>
      <NumberField
        label="maxEvents"
        value={draft.maxEvents}
        onChange={set("maxEvents")}
        presets={[1000, 10_000, 1_000_000]}
      />
      <NumberField
        label="maxMemoryEvents"
        value={draft.maxMemoryEvents}
        onChange={set("maxMemoryEvents")}
        presets={[0, 1000, 10_000]}
      />
      <NumberField
        label="cacheIndexes"
        value={draft.cacheIndexes}
        onChange={set("cacheIndexes")}
        presets={[0, 100, 1000, 10_000]}
      />
      <NumberField
        label="writeInterval"
        value={draft.writeInterval}
        onChange={set("writeInterval")}
        presets={[10, 100, 1000]}
        suffix="ms"
      />
      <NumberField
        label="pruneInterval"
        value={draft.pruneInterval}
        onChange={set("pruneInterval")}
        presets={[5000, 60_000]}
        suffix="ms"
      />
      <div className="btn-row">
        <button
          className="btn primary"
          onClick={() => {
            manager.open(dbName.trim() || name, draft);
            onClose();
          }}
        >
          reopen
        </button>
        <button className="btn" onClick={() => setDraft(DEFAULT_OPTIONS)}>
          defaults
        </button>
      </div>
    </div>
  );
}

function Header() {
  const { name, ready } = useDB();
  const stats = useLiveStats(1000);
  const [showOptions, setShowOptions] = useState(false);

  useEffect(() => {
    if (!showOptions) return;
    const close = () => setShowOptions(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [showOptions]);

  return (
    <header className="header">
      <span className="logo">nostr-idb</span>
      <span
        className="dbname"
        onClick={(e) => {
          e.stopPropagation();
          setShowOptions((s) => !s);
        }}
      >
        <span className={`status-dot ${ready ? "open" : "connecting"}`} />
        {name} ⚙
        {showOptions && (
          <OptionsPopover onClose={() => setShowOptions(false)} />
        )}
      </span>
      <span style={{ flex: 1 }} />
      {stats && (
        <span className="header-stats">
          <span title="events in IndexedDB">
            <b>{fmtNum(stats.events)}</b> events
          </span>
          <span
            title="events waiting in the write queue"
            className={stats.pendingWrites ? "warn" : ""}
          >
            <b>{fmtNum(stats.pendingWrites)}</b> queued
          </span>
          <span title="indexes in the in-memory index cache">
            <b>{fmtNum(stats.cachedIndexes)}</b> indexes
          </span>
          <span title="events held in memory">
            <b>{fmtNum(stats.memoryEvents)}</b> in memory
          </span>
          <span title="open subscriptions">
            <b>{stats.subscriptions}</b> subs
          </span>
          <span title="origin storage usage">
            <b>{fmtBytes(stats.usage)}</b>
          </span>
        </span>
      )}
    </header>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("query");
  const [request, setRequest] = useState<{
    filters: Filter[];
    nonce: number;
  } | null>(null);

  useEffect(() => {
    manager.open();
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
              <span className="nav-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <main className="app-content">
          <div className="tab" hidden={tab !== "query"}>
            <QueryPage request={request} active={tab === "query"} />
          </div>
          <div className="tab" hidden={tab !== "store"}>
            <StorePage />
          </div>
          <div className="tab" hidden={tab !== "import"}>
            <ImportPage />
          </div>
          <div className="tab" hidden={tab !== "stress"}>
            <StressPage />
          </div>
          <div className="tab" hidden={tab !== "inspect"}>
            <InspectPage active={tab === "inspect"} />
          </div>
        </main>
        <ActivityLog />
      </div>
    </AppCtx.Provider>
  );
}
