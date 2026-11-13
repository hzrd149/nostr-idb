import React, { useEffect, useRef, useState } from "react";
import type { Filter } from "../../src/index.ts";
import { KIND_NAMES, kindColor, parseFilters, shortHex } from "../lib/nostr.ts";
import { Pubkey } from "./ResultsView.tsx";
import { ChipInput, Segmented } from "./ui.tsx";

export type FilterHints = {
  kinds: [number, number][];
  authors: [string, number][];
};

type AnyFilter = Record<string, unknown> & Filter;

const HEX64 = /^[0-9a-f]{64}$/;
const COMMON_KINDS = [0, 1, 3, 6, 7, 30023];

/** Remove empty fields so the filter is valid to run */
export function cleanFilter(filter: Filter): Filter {
  const out: AnyFilter = {};
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined || v === "" || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

const RANGES: [string, number][] = [
  ["1 hour ago", 3600],
  ["24 hours ago", 86400],
  ["7 days ago", 86400 * 7],
  ["30 days ago", 86400 * 30],
  ["1 year ago", 86400 * 365],
];

/** datetime input with a dropdown of relative times */
function TimeRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div className="fb-row">
      <span className="fb-key">{label}</span>
      <input
        type="datetime-local"
        value={toLocalInput(value)}
        onChange={(e) =>
          onChange(
            e.target.value
              ? Math.floor(new Date(e.target.value).getTime() / 1000)
              : undefined,
          )
        }
      />
      <select
        className="quick"
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (v === "clear") onChange(undefined);
          else if (v) onChange(Math.floor(Date.now() / 1000) - Number(v));
        }}
      >
        <option value="">quick…</option>
        {RANGES.map(([l, secs]) => (
          <option key={l} value={secs}>
            {l}
          </option>
        ))}
        <option value="clear">clear</option>
      </select>
    </div>
  );
}

function toLocalInput(ts?: number) {
  if (ts === undefined) return "";
  const d = new Date(ts * 1000);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

function SingleFilter({
  filter,
  onChange,
  hints,
}: {
  filter: AnyFilter;
  onChange: (f: AnyFilter) => void;
  hints?: FilterHints;
}) {
  const set = (key: string, value: unknown) => {
    const next = { ...filter } as AnyFilter;
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const tagKeys = Object.keys(filter).filter(
    (k) => k.startsWith("#") || k.startsWith("&"),
  );

  const kindSuggestions = (
    hints?.kinds.length ? hints.kinds.slice(0, 6).map(([k]) => k) : COMMON_KINDS
  ).map((k) => ({
    value: String(k),
    label: (
      <span style={{ color: kindColor(k) }}>
        {k}
        {KIND_NAMES[k] ? " " + KIND_NAMES[k] : ""}
      </span>
    ),
  }));

  return (
    <div className="fb">
      <div className="fb-row">
        <span className="fb-key">kinds</span>
        <ChipInput
          values={(filter.kinds ?? []).map(String)}
          onChange={(v) => set("kinds", v.length ? v.map(Number) : undefined)}
          parse={(s) => (/^\d+$/.test(s) ? s : null)}
          render={(v) => (
            <span style={{ color: kindColor(Number(v)) }}>
              {v} {KIND_NAMES[Number(v)] ?? ""}
            </span>
          )}
          suggestions={kindSuggestions}
          placeholder="1, 7…"
        />
      </div>

      <div className="fb-row">
        <span className="fb-key">authors</span>
        <ChipInput
          values={filter.authors ?? []}
          onChange={(v) => set("authors", v.length ? v : undefined)}
          parse={(s) => (HEX64.test(s.toLowerCase()) ? s.toLowerCase() : null)}
          render={(v) => <Pubkey pubkey={v} />}
          suggestions={hints?.authors.slice(0, 4).map(([pk]) => ({
            value: pk,
            label: <Pubkey pubkey={pk} n={4} />,
          }))}
          placeholder="hex pubkey"
        />
      </div>

      <div className="fb-row">
        <span className="fb-key">ids</span>
        <ChipInput
          values={filter.ids ?? []}
          onChange={(v) => set("ids", v.length ? v : undefined)}
          parse={(s) => (s ? s.toLowerCase() : null)}
          render={(v) => <span className="mono">{shortHex(v, 10)}</span>}
          placeholder="event id / uid"
        />
      </div>

      {tagKeys.map((key) => {
        const op = key[0];
        const letter = key.slice(1);
        const values = (filter[key] as string[] | undefined) ?? [];
        const rename = (nextKey: string) => {
          if (nextKey === key) return;
          const next: AnyFilter = {};
          for (const [k, v] of Object.entries(filter))
            next[k === key ? nextKey : k] = v;
          onChange(next);
        };
        return (
          <div className="fb-row" key={key}>
            <span className="fb-key fb-tagkey">
              <button
                type="button"
                className={`tagop ${op === "&" ? "and" : "or"}`}
                title={op === "&" ? "AND (NIP-91)" : "OR"}
                onClick={() => rename((op === "&" ? "#" : "&") + letter)}
              >
                {op}
              </button>
              <input
                className="tagletter"
                value={letter}
                maxLength={1}
                onChange={(e) => e.target.value && rename(op + e.target.value)}
              />
            </span>
            <ChipInput
              values={values}
              onChange={(v) => set(key, v)}
              render={(v) => (HEX64.test(v) ? shortHex(v, 10) : v)}
              placeholder="values"
            />
            <button
              type="button"
              className="icon"
              title="remove"
              onClick={() => set(key, undefined)}
            >
              ×
            </button>
          </div>
        );
      })}
      <div className="fb-row">
        <span className="fb-key" />
        <select
          className="fb-addtag"
          value=""
          onChange={(e) => e.target.value && set(e.target.value, [])}
        >
          <option value="">+ tag filter…</option>
          {["#t", "#p", "#e", "#d", "#a", "&t", "&p"].map((k) => (
            <option key={k} value={k} disabled={k in filter}>
              {k} {k[0] === "&" ? "(all of)" : "(any of)"}
            </option>
          ))}
        </select>
      </div>

      <TimeRow
        label="since"
        value={filter.since}
        onChange={(v) => set("since", v)}
      />
      <TimeRow
        label="until"
        value={filter.until}
        onChange={(v) => set("until", v)}
      />

      <div className="fb-row">
        <span className="fb-key">limit</span>
        <input
          type="number"
          className="limit"
          value={filter.limit ?? ""}
          placeholder="none"
          onChange={(e) =>
            set("limit", e.target.value ? Number(e.target.value) : undefined)
          }
        />
        <Segmented
          value={filter.limit ?? 0}
          onChange={(n) => set("limit", n || undefined)}
          options={[10, 100, 1000, 0].map((n) => ({
            value: n,
            label: n ? String(n) : "none",
          }))}
        />
      </div>
    </div>
  );
}

/** Visual builder + JSON editor for a list of filters, kept in sync */
export function FilterBuilder({
  filters,
  onChange,
  hints,
  onSubmit,
}: {
  filters: Filter[];
  onChange: (f: Filter[]) => void;
  hints?: FilterHints;
  onSubmit?: () => void;
}) {
  const [active, setActive] = useState(0);
  const [text, setText] = useState(() => JSON.stringify(filters, null, 2));
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) {
      setText(JSON.stringify(filters, null, 2));
      setError(null);
    }
  }, [filters]);

  const idx = Math.min(active, filters.length - 1);

  return (
    <div
      className="filter-builder"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onSubmit?.();
        }
      }}
    >
      <div className="fb-tabs">
        {filters.map((_, i) => (
          <button
            type="button"
            key={i}
            className={i === idx ? "on" : ""}
            onClick={() => setActive(i)}
          >
            filter {i + 1}
            {filters.length > 1 && (
              <span
                className="x"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(filters.filter((_, j) => j !== i));
                  setActive(Math.max(0, i - 1));
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            onChange([...filters, { limit: 100 }]);
            setActive(filters.length);
          }}
        >
          +
        </button>
      </div>

      {filters[idx] && (
        <SingleFilter
          filter={filters[idx] as AnyFilter}
          hints={hints}
          onChange={(f) => onChange(filters.map((x, i) => (i === idx ? f : x)))}
        />
      )}

      <textarea
        className={`fb-json ${error ? "invalid" : ""}`}
        spellCheck={false}
        value={text}
        rows={Math.min(14, text.split("\n").length + 1)}
        onFocus={() => (editing.current = true)}
        onBlur={() => {
          editing.current = false;
          if (!error) setText(JSON.stringify(filters, null, 2));
        }}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = parseFilters(e.target.value);
            setError(null);
            onChange(parsed.length ? parsed : [{}]);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
      {error && <div className="error">{error}</div>}
    </div>
  );
}
