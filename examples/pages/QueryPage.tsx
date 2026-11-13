import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  countEventsByKind,
  countEventsByPubkeys,
  getEventUID,
  type Filter,
  type StoredEvent,
} from "../../src/index.ts";
import { Bars } from "../components/charts.tsx";
import {
  FilterBuilder,
  cleanFilter,
  type FilterHints,
} from "../components/FilterBuilder.tsx";
import { ResultsView } from "../components/ResultsView.tsx";
import { ConfirmButton } from "../components/ui.tsx";
import { EngineSelect } from "../components/EngineSelect.tsx";
import { ENGINES, runEngine, type Engine } from "../lib/engines.ts";
import { begin, track } from "../lib/activity.ts";
import { manager, useDB } from "../lib/db.ts";
import {
  filterSummary,
  fmtMs,
  fmtNum,
  openSubscription,
  summarize,
} from "../lib/nostr.ts";

type HistoryEntry = {
  filters: Filter[];
  engine: Engine;
  ms: number;
  count: number;
};

export function QueryPage({
  request,
  active,
}: {
  request: { filters: Filter[]; nonce: number } | null;
  active: boolean;
}) {
  const { ready, generation } = useDB();
  const [filters, setFilters] = useState<Filter[]>([
    { kinds: [1], limit: 100 },
  ]);
  const [engine, setEngine] = useState<Engine>("query");
  const [results, setResults] = useState<StoredEvent[]>([]);
  const [last, setLast] = useState<HistoryEntry | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [hints, setHints] = useState<FilterHints>();
  const [bench, setBench] = useState<{ times: number[]; cold: boolean } | null>(
    null,
  );
  const [benchN, setBenchN] = useState(20);
  const [cold, setCold] = useState(false);
  const [live, setLive] = useState<{ close: () => void; count: number } | null>(
    null,
  );

  // load suggestions from the database
  const loadHints = useCallback(async () => {
    if (!manager.snapshot.ready) return;
    const [kinds, authors] = await Promise.all([
      track(
        "query",
        "countEventsByKind()",
        () => countEventsByKind(manager.db),
        (r) => `${Object.keys(r).length} kinds`,
      ),
      track(
        "query",
        "countEventsByPubkeys()",
        () => countEventsByPubkeys(manager.db),
        (r) => `${Object.keys(r).length} authors`,
      ),
    ]);
    setHints({
      kinds: Object.entries(kinds)
        .map(([k, n]) => [Number(k), n] as [number, number])
        .sort((a, b) => b[1] - a[1]),
      authors: Object.entries(authors).sort((a, b) => b[1] - a[1]),
    });
  }, []);

  useEffect(() => {
    if (ready && active) loadHints();
  }, [ready, active, generation, loadHints]);

  const run = useCallback(
    async (f: Filter[] = filters, e: Engine = engine) => {
      if (!manager.snapshot.ready) return;
      const clean = f.map(cleanFilter);
      setRunning(true);
      setError(null);
      const label = ENGINES.find((x) => x.value === e)!.title;
      const t0 = performance.now();
      try {
        const r = await track(
          "query",
          label,
          () => runEngine(e, clean),
          (r) =>
            typeof r === "number"
              ? `${fmtNum(r)}`
              : `${fmtNum(r.length)} events`,
          filterSummary(clean),
        );
        const ms = performance.now() - t0;
        const count = typeof r === "number" ? r : r.length;
        setResults(typeof r === "number" ? [] : r);
        const entry = { filters: f, engine: e, ms, count };
        setLast(entry);
        setHistory((h) => [entry, ...h].slice(0, 30));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    },
    [filters, engine],
  );

  // run requests from other pages
  useEffect(() => {
    if (!request) return;
    setFilters(request.filters);
    const e = engine === "count" || engine === "ids" ? "query" : engine;
    setEngine(e);
    run(request.filters, e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  async function runBench() {
    const clean = filters.map(cleanFilter);
    const finish = begin(
      "bench",
      `${benchN}× ${ENGINES.find((x) => x.value === engine)!.title}${cold ? " (cold cache)" : ""}`,
      filterSummary(clean),
    );
    setRunning(true);
    const times: number[] = [];
    setBench({ times, cold });
    try {
      for (let i = 0; i < benchN; i++) {
        if (cold) manager.nostr.indexCache.clear();
        const t0 = performance.now();
        await runEngine(engine, clean);
        times.push(performance.now() - t0);
        if (i % 5 === 4 || i === benchN - 1)
          setBench({ times: [...times], cold });
      }
      const s = summarize(times);
      finish(
        "ok",
        `p50 ${fmtMs(s.p50)} p95 ${fmtMs(s.p95)} max ${fmtMs(s.max)}`,
      );
    } catch (err) {
      finish("error", String(err));
    } finally {
      setRunning(false);
    }
  }

  function toggleLive() {
    if (live) {
      live.close();
      setLive(null);
      return;
    }
    const clean = filters.map(cleanFilter);
    const finish = begin(
      "subscribe",
      "nostr.subscribe()",
      filterSummary(clean),
    );
    const seen = new Set<string>();
    const buffer: StoredEvent[] = [];
    let count = 0;
    let flush: ReturnType<typeof setTimeout> | undefined;
    setResults([]);
    const close = openSubscription(manager.nostr, clean, (event) => {
      const uid = getEventUID(event);
      if (seen.has(uid)) return;
      seen.add(uid);
      buffer.push(event);
      count++;
      if (!flush)
        flush = setTimeout(() => {
          flush = undefined;
          const batch = buffer.splice(0);
          setResults((r) => [...batch, ...r].slice(0, 50_000));
          setLive((l) => (l ? { ...l, count } : l));
        }, 100);
    });
    setLive({
      count: 0,
      close: () => {
        close();
        clearTimeout(flush);
        finish("ok", `${count} events delivered`);
      },
    });
  }

  const liveRef = useRef(live);
  liveRef.current = live;
  useEffect(() => () => liveRef.current?.close(), []);

  async function deleteMatching() {
    const clean = filters.map(cleanFilter);
    await track(
      "delete",
      "nostr.deleteByFilters()",
      () => manager.nostr.deleteByFilters(clean),
      (n) => `${n} deleted`,
      filterSummary(clean),
    );
    run();
  }

  const benchStats = bench ? summarize(bench.times) : null;
  const isNumber = last && (last.engine === "count" || last.engine === "ids");

  return (
    <div className="page">
      <div className="side">
        <FilterBuilder
          filters={filters}
          onChange={setFilters}
          hints={hints}
          onSubmit={() => run()}
        />

        <EngineSelect value={engine} onChange={setEngine} />

        <div className="btn-row">
          <button
            className="btn primary"
            disabled={!ready || running || !!live}
            onClick={() => run()}
            title="Ctrl+Enter"
          >
            {running ? <span className="spinner" /> : "▶"} run
          </button>
          <button
            className={`btn ${live ? "live" : ""}`}
            disabled={!ready}
            onClick={toggleLive}
            title="nostr.subscribe(filters)"
          >
            {live ? `■ live ${live.count}` : "◉ subscribe"}
          </button>
          <ConfirmButton
            disabled={!ready || running}
            onConfirm={deleteMatching}
          >
            delete matching
          </ConfirmButton>
        </div>

        <div className="bench-row">
          <button
            className="btn"
            disabled={!ready || running}
            onClick={runBench}
          >
            ⏱ bench
          </button>
          <input
            type="number"
            value={benchN}
            min={1}
            onChange={(e) => setBenchN(Math.max(1, Number(e.target.value)))}
          />
          <span className="muted">×</span>
          <label className="check">
            <input
              type="checkbox"
              checked={cold}
              onChange={(e) => setCold(e.target.checked)}
            />
            cold cache
          </label>
        </div>

        {bench && benchStats && (
          <div className="bench">
            <Bars
              values={bench.times}
              height={50}
              color={(v) =>
                v > benchStats.p95 ? "var(--yellow)" : "var(--accent)"
              }
            />
            <div className="bench-stats">
              <span>min {fmtMs(benchStats.min)}</span>
              <span>p50 {fmtMs(benchStats.p50)}</span>
              <span>p95 {fmtMs(benchStats.p95)}</span>
              <span>max {fmtMs(benchStats.max)}</span>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div className="history">
            {history.map((h, i) => (
              <div
                key={i}
                className="history-row"
                onClick={() => {
                  setFilters(h.filters);
                  setEngine(h.engine);
                }}
              >
                <span className="history-engine">{h.engine}</span>
                <span className="history-filter">
                  {filterSummary(h.filters.map(cleanFilter)) || "{}"}
                </span>
                <span className="history-count">{fmtNum(h.count)}</span>
                <span className="history-ms">{fmtMs(h.ms)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <ResultsView
        events={results}
        onDeleted={(uid) =>
          setResults((r) => r.filter((e) => getEventUID(e) !== uid))
        }
        header={
          error ? (
            <span className="bad">{error}</span>
          ) : live ? (
            <span>
              <span className="live-dot" /> {fmtNum(results.length)} live
            </span>
          ) : last ? (
            <span>
              <b>{fmtNum(last.count)}</b> {isNumber ? last.engine : "events"}
              <span className="muted"> in </span>
              <b>{fmtMs(last.ms)}</b>
            </span>
          ) : null
        }
        empty={
          isNumber && last ? (
            <div className="bignum">
              {fmtNum(last.count)}
              <span>{last.engine}</span>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
