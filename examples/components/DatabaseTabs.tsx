import React, { useCallback, useEffect, useState } from "react";
import {
  Cpu,
  Database,
  HardDrive,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import {
  DEFAULT_OPTIONS,
  listDatabases,
  manager,
  useDB,
  type Backend,
  type ExplorerOptions,
} from "../lib/db.ts";
import { ConfirmButton, Field, NumberField, Segmented } from "./ui.tsx";
import { VirtualList } from "./VirtualList.tsx";

/** Toggle state for a popover that closes on any outside click */
function usePopover() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  return [open, setOpen] as const;
}

const BACKENDS: { value: Backend; label: string; title: string }[] = [
  {
    value: "main",
    label: "main thread",
    title: "NostrIDB runs on the page; every tool and stat is available",
  },
  {
    value: "worker",
    label: "worker",
    title:
      "NostrIDB runs in a dedicated worker behind NostrIDBClient; the page stays responsive",
  },
  {
    value: "snort",
    label: "snort worker-relay",
    title:
      "@snort/worker-relay: SQLite-WASM on OPFS in a worker, for comparison. One can be open at a time.",
  },
];

/** Icon marking where a database runs, nothing for the main thread */
function BackendIcon({ backend }: { backend: Backend }) {
  if (backend === "worker")
    return (
      <Cpu size={16} className="db-tab-worker" aria-label="runs in a worker" />
    );
  if (backend === "snort")
    return (
      <HardDrive
        size={16}
        className="db-tab-worker"
        aria-label="snort worker-relay"
      />
    );
  return null;
}

function OptionsPopover({
  name,
  onClose,
}: {
  name: string;
  onClose: () => void;
}) {
  const { options, backend: current } = useDB();
  const [draft, setDraft] = useState<ExplorerOptions>(options);
  const [backend, setBackend] = useState<Backend>(current);
  const set = (k: keyof ExplorerOptions) => (v: number) =>
    setDraft((d) => ({ ...d, [k]: v }));
  return (
    <div className="popover" onClick={(e) => e.stopPropagation()}>
      <div className="popover-title">
        <Database size={16} /> {name}
      </div>
      <Field label="backend">
        <Segmented value={backend} options={BACKENDS} onChange={setBackend} />
      </Field>
      {backend === "snort" ? (
        <p className="muted">
          The snort worker-relay has no options. Switching backends opens a
          separate, empty database with the same name.
        </p>
      ) : (
        <>
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
        </>
      )}
      <div className="btn-row">
        <button
          className="btn primary"
          onClick={() => {
            manager.reopen(name, draft, backend);
            onClose();
          }}
        >
          reopen
        </button>
        <button className="btn" onClick={() => setDraft(DEFAULT_OPTIONS)}>
          defaults
        </button>
        <span style={{ flex: 1 }} />
        <ConfirmButton
          onConfirm={() => {
            onClose();
            manager.remove(name);
          }}
        >
          <Trash2 size={16} /> delete database
        </ConfirmButton>
      </div>
    </div>
  );
}

/** Create a new database or open / delete an existing one */
export function DatabasePicker({ onDone }: { onDone?: () => void }) {
  const { tabs, listVersion } = useDB();
  const [name, setName] = useState("");
  const [backend, setBackend] = useState<Backend>("main");
  const [existing, setExisting] = useState<string[] | null>(null);
  // IndexedDB does not know about the worker-relay's OPFS databases
  const snort = manager.snortDatabases();

  const refresh = useCallback(() => {
    listDatabases()
      .then(setExisting)
      .catch(() => setExisting([]));
  }, []);
  useEffect(refresh, [refresh, listVersion]);

  const trimmed = name.trim();
  const exists =
    backend === "snort"
      ? snort.includes(trimmed)
      : !!existing?.includes(trimmed);
  const submit = () => {
    if (!trimmed) return;
    manager.open(trimmed, backend);
    setName("");
    onDone?.();
  };

  return (
    <div className="db-picker">
      <form
        className="db-picker-new"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          className="grow"
          autoFocus
          placeholder="new database name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={!trimmed}>
          <Plus size={16} /> {exists ? "open" : "create"}
        </button>
      </form>
      <Field label="backend">
        <Segmented value={backend} options={BACKENDS} onChange={setBackend} />
      </Field>

      <div className="db-picker-label">databases in this browser</div>
      {existing === null ? (
        <div className="muted">loading…</div>
      ) : existing.length + snort.length === 0 ? (
        <div className="muted">no databases yet</div>
      ) : (
        <VirtualList
          className="db-picker-list"
          role="list"
          items={[
            ...existing.map((db) => ({ db, isSnort: false })),
            ...snort.map((db) => ({ db, isSnort: true })),
          ]}
          estimateSize={40}
          gap={4}
          getKey={({ db, isSnort }) => `${isSnort ? "snort" : "idb"}:${db}`}
          renderItem={({ db, isSnort }) => {
            const isOpen = tabs.includes(db);
            return (
              <div className="db-picker-item" role="listitem">
                {isSnort ? (
                  <HardDrive size={16} className="muted" />
                ) : (
                  <Database size={16} className="muted" />
                )}
                <span className="db-picker-name">{db}</span>
                {isSnort && <span className="badge">snort</span>}
                {isOpen && <span className="badge">open</span>}
                <span style={{ flex: 1 }} />
                <button
                  className="btn"
                  onClick={() => {
                    manager.open(
                      db,
                      isOpen
                        ? undefined
                        : isSnort
                          ? "snort"
                          : backend === "snort"
                            ? "main"
                            : backend,
                    );
                    onDone?.();
                  }}
                >
                  {isOpen ? "switch" : "open"}
                </button>
                <ConfirmButton onConfirm={() => manager.remove(db)}>
                  <Trash2 size={16} /> delete
                </ConfirmButton>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}

function DatabaseTab({ name }: { name: string }) {
  const { name: active, ready } = useDB();
  const [showOptions, setShowOptions] = usePopover();
  const isActive = name === active;

  return (
    <div
      className={`db-tab ${isActive ? "on" : ""}`}
      title={
        manager.backendOf(name) === "worker"
          ? `${name} · runs in a worker`
          : manager.backendOf(name) === "snort"
            ? `${name} · snort worker-relay`
            : name
      }
      onClick={() => !isActive && manager.open(name)}
      onAuxClick={(e) => {
        if (e.button === 1) manager.close(name);
      }}
    >
      <span
        className={`status-dot ${isActive ? (ready ? "open" : "connecting") : ""}`}
      />
      <span className="db-tab-name">{name}</span>
      <BackendIcon backend={manager.backendOf(name)} />
      {isActive && (
        <button
          className="db-tab-icon"
          title="database options"
          onClick={(e) => {
            e.stopPropagation();
            setShowOptions((s) => !s);
          }}
        >
          <Settings size={16} />
        </button>
      )}
      <button
        className="db-tab-icon"
        title="close database"
        onClick={(e) => {
          e.stopPropagation();
          manager.close(name);
        }}
      >
        <X size={16} />
      </button>
      {showOptions && (
        <OptionsPopover name={name} onClose={() => setShowOptions(false)} />
      )}
    </div>
  );
}

export function DatabaseTabs() {
  const { tabs } = useDB();
  const [showPicker, setShowPicker] = usePopover();

  return (
    <div className="db-tabs">
      {tabs.map((name) => (
        <DatabaseTab key={name} name={name} />
      ))}
      <div className="db-tab-add">
        <button
          className="db-tab-icon"
          title="open or create a database"
          onClick={(e) => {
            e.stopPropagation();
            setShowPicker((s) => !s);
          }}
        >
          <Plus size={18} />
        </button>
        {showPicker && (
          <div className="popover" onClick={(e) => e.stopPropagation()}>
            <DatabasePicker onDone={() => setShowPicker(false)} />
          </div>
        )}
      </div>
    </div>
  );
}
