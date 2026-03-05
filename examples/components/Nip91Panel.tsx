import React, { useState } from "react";
import type { NostrEvent } from "nostr-tools/pure";
import type { DBState } from "../hooks/useNostrIDB.ts";
import { getEventsForFilter, getIdsForFilter } from "../../src/index.ts";
import type { Filter } from "../../src/lib/nostr.js";

type TagEntry = { tag: string; value: string };

type Props = {
  dbState: DBState;
  onResults: (events: NostrEvent[], label: string) => void;
};

function TagChipList({
  chips,
  variant,
  onRemove,
}: {
  chips: TagEntry[];
  variant: "and" | "or";
  onRemove: (i: number) => void;
}) {
  return (
    <div style={{ minHeight: 28, flexWrap: "wrap", display: "flex" }}>
      {chips.map((c, i) => (
        <span key={i} className={`tag-chip tag-${variant}`}>
          {variant === "and" ? "&" : "#"}
          {c.tag}={c.value}
          <button className="remove" onClick={() => onRemove(i)}>
            ×
          </button>
        </span>
      ))}
      {chips.length === 0 && (
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          none
        </span>
      )}
    </div>
  );
}

function AddTagRow({ onAdd }: { onAdd: (tag: string, value: string) => void }) {
  const [tag, setTag] = useState("t");
  const [value, setValue] = useState("");

  function submit() {
    if (tag && value) {
      onAdd(tag.trim(), value.trim());
      setValue("");
    }
  }

  return (
    <div className="add-row">
      <input
        type="text"
        className="sm"
        style={{ width: 40 }}
        maxLength={1}
        value={tag}
        onChange={(e) => setTag(e.target.value)}
        placeholder="t"
      />
      <span style={{ color: "var(--text-muted)" }}>=</span>
      <input
        type="text"
        className="sm"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="value"
      />
      <button
        className="btn-secondary"
        style={{ padding: "4px 10px" }}
        onClick={submit}
      >
        +
      </button>
    </div>
  );
}

export function Nip91Panel({ dbState, onResults }: Props) {
  const [andTags, setAndTags] = useState<TagEntry[]>([]);
  const [orTags, setOrTags] = useState<TagEntry[]>([]);
  const [kinds, setKinds] = useState("1");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [andCount, setAndCount] = useState<number | null>(null);
  const [orCount, setOrCount] = useState<number | null>(null);
  const [error, setError] = useState("");

  function buildFilter(): Filter {
    const filter: Filter = {};

    const kindList = kinds
      .split(",")
      .map((k) => parseInt(k.trim(), 10))
      .filter((k) => !isNaN(k));
    if (kindList.length) filter.kinds = kindList;

    // Group AND tags by tag name
    const andByTag: Record<string, string[]> = {};
    for (const { tag, value } of andTags) {
      andByTag[tag] = andByTag[tag] ?? [];
      andByTag[tag].push(value);
    }
    for (const [tag, values] of Object.entries(andByTag)) {
      (filter as Record<string, unknown>)[`&${tag}`] = values;
    }

    // Group OR tags by tag name
    const orByTag: Record<string, string[]> = {};
    for (const { tag, value } of orTags) {
      orByTag[tag] = orByTag[tag] ?? [];
      orByTag[tag].push(value);
    }
    for (const [tag, values] of Object.entries(orByTag)) {
      (filter as Record<string, unknown>)[`#${tag}`] = values;
    }

    return filter;
  }

  async function runQuery() {
    if (!dbState.db) return;
    setError("");
    setElapsed(null);
    setAndCount(null);
    setOrCount(null);

    setLoading(true);
    const t0 = performance.now();
    try {
      const filter = buildFilter();
      const events = await getEventsForFilter(
        dbState.db,
        filter,
        dbState.indexCache,
      );
      setElapsed(performance.now() - t0);
      onResults(events, "NIP-91 Results");

      // Also compute OR-only count for comparison
      if (andTags.length > 0 && orTags.length === 0) {
        const orFilter: Filter = { ...filter };
        for (const [tag, values] of Object.entries(
          filter as Record<string, unknown>,
        )) {
          if (tag.startsWith("&")) {
            const orKey = `#${tag.slice(1)}`;
            (orFilter as Record<string, unknown>)[orKey] = values;
            delete (orFilter as Record<string, unknown>)[tag];
          }
        }
        const orIds = await getIdsForFilter(
          dbState.db,
          orFilter,
          dbState.indexCache,
        );
        const andIds = await getIdsForFilter(
          dbState.db,
          filter,
          dbState.indexCache,
        );
        setOrCount(orIds.size);
        setAndCount(andIds.size);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const filterPreview = JSON.stringify(buildFilter(), null, 2);

  return (
    <div className="panel">
      <p className="panel-title">NIP-91 AND Filter Demo</p>

      <p
        style={{
          fontSize: "0.75rem",
          color: "var(--text-muted)",
          margin: "0 0 12px",
        }}
      >
        <strong style={{ color: "var(--accent)" }}>&amp;t</strong> values must
        ALL be present (AND).{" "}
        <strong style={{ color: "var(--green)" }}>#t</strong> values match any
        one (OR). AND takes precedence; &amp;t values are excluded from the OR
        pass.
      </p>

      <div className="field">
        <label>Kinds (comma-separated)</label>
        <input
          type="text"
          value={kinds}
          onChange={(e) => setKinds(e.target.value)}
          placeholder="1, 6, 7"
        />
      </div>

      <div className="field">
        <label>
          <span className="tag-chip tag-and" style={{ marginRight: 6 }}>
            &amp;
          </span>
          AND tags — event must have ALL of these
        </label>
        <TagChipList
          chips={andTags}
          variant="and"
          onRemove={(i) =>
            setAndTags((prev) => prev.filter((_, idx) => idx !== i))
          }
        />
        <AddTagRow
          onAdd={(tag, value) =>
            setAndTags((prev) => [...prev, { tag, value }])
          }
        />
      </div>

      <div className="field">
        <label>
          <span className="tag-chip tag-or" style={{ marginRight: 6 }}>
            #
          </span>
          OR tags — event must have AT LEAST ONE of these
        </label>
        <TagChipList
          chips={orTags}
          variant="or"
          onRemove={(i) =>
            setOrTags((prev) => prev.filter((_, idx) => idx !== i))
          }
        />
        <AddTagRow
          onAdd={(tag, value) => setOrTags((prev) => [...prev, { tag, value }])}
        />
      </div>

      <div className="field">
        <label>Effective filter (live preview)</label>
        <textarea
          rows={8}
          readOnly
          value={filterPreview}
          style={{ opacity: 0.7, cursor: "default" }}
        />
      </div>

      {error && (
        <div
          style={{ color: "var(--red)", fontSize: "0.75rem", marginBottom: 8 }}
        >
          {error}
        </div>
      )}

      <div className="btn-row">
        <button
          className="btn-primary"
          onClick={runQuery}
          disabled={
            loading ||
            !dbState.ready ||
            (andTags.length === 0 && orTags.length === 0)
          }
        >
          {loading ? "Querying…" : "Run NIP-91 Query"}
        </button>
        <button
          className="btn-secondary"
          onClick={() => {
            setAndTags([]);
            setOrTags([]);
            setAndCount(null);
            setOrCount(null);
            setElapsed(null);
            onResults([], "");
          }}
        >
          Reset
        </button>
      </div>

      {elapsed !== null && (
        <div
          style={{
            marginTop: 10,
            fontSize: "0.78rem",
            fontFamily: "var(--mono)",
          }}
        >
          <div style={{ color: "var(--text-muted)" }}>
            Completed in {elapsed.toFixed(1)} ms
          </div>
          {andCount !== null && orCount !== null && (
            <div style={{ marginTop: 6 }}>
              <div>
                <span style={{ color: "var(--accent)" }}>AND result:</span>{" "}
                <strong>{andCount}</strong> event{andCount !== 1 ? "s" : ""}
              </div>
              <div>
                <span style={{ color: "var(--green)" }}>OR equivalent:</span>{" "}
                <strong>{orCount}</strong> event{orCount !== 1 ? "s" : ""}
              </div>
              <div style={{ color: "var(--text-muted)", marginTop: 2 }}>
                AND is{" "}
                {orCount > 0 ? ((andCount / orCount) * 100).toFixed(0) : "—"}%
                of OR results
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
