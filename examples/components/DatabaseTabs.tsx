import React, { useCallback, useEffect, useState } from "react";
import { Database, Plus, Settings, Trash2, X } from "lucide-react";
import {
  DEFAULT_OPTIONS,
  listDatabases,
  manager,
  useDB,
  type ExplorerOptions,
} from "../lib/db.ts";
import { ConfirmButton, NumberField } from "./ui.tsx";

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

function OptionsPopover({
  name,
  onClose,
}: {
  name: string;
  onClose: () => void;
}) {
  const { options } = useDB();
  const [draft, setDraft] = useState<ExplorerOptions>(options);
  const set = (k: keyof ExplorerOptions) => (v: number) =>
    setDraft((d) => ({ ...d, [k]: v }));
  return (
    <div className="popover" onClick={(e) => e.stopPropagation()}>
      <div className="popover-title">
        <Database size={16} /> {name}
      </div>
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
            manager.reopen(name, draft);
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
  const [existing, setExisting] = useState<string[] | null>(null);

  const refresh = useCallback(() => {
    listDatabases()
      .then(setExisting)
      .catch(() => setExisting([]));
  }, []);
  useEffect(refresh, [refresh, listVersion]);

  const trimmed = name.trim();
  const exists = !!existing?.includes(trimmed);
  const submit = () => {
    if (!trimmed) return;
    manager.open(trimmed);
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

      <div className="db-picker-label">databases in this browser</div>
      {existing === null ? (
        <div className="muted">loading…</div>
      ) : existing.length === 0 ? (
        <div className="muted">no databases yet</div>
      ) : (
        <ul className="db-picker-list">
          {existing.map((db) => {
            const isOpen = tabs.includes(db);
            return (
              <li key={db}>
                <Database size={16} className="muted" />
                <span className="db-picker-name">{db}</span>
                {isOpen && <span className="badge">open</span>}
                <span style={{ flex: 1 }} />
                <button
                  className="btn"
                  onClick={() => {
                    manager.open(db);
                    onDone?.();
                  }}
                >
                  {isOpen ? "switch" : "open"}
                </button>
                <ConfirmButton onConfirm={() => manager.remove(db)}>
                  <Trash2 size={16} /> delete
                </ConfirmButton>
              </li>
            );
          })}
        </ul>
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
      title={name}
      onClick={() => !isActive && manager.open(name)}
      onAuxClick={(e) => {
        if (e.button === 1) manager.close(name);
      }}
    >
      <span
        className={`status-dot ${isActive ? (ready ? "open" : "connecting") : ""}`}
      />
      <span className="db-tab-name">{name}</span>
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
