import React, { useRef, useState, type ReactNode } from "react";
import { Play, Square } from "lucide-react";
import type { Filter, StoredEvent } from "../../src/index.ts";
import { Bars, HBars, Histogram, Scatter } from "../components/charts.tsx";
import { Field, NumberField, Segmented, Stat } from "../components/ui.tsx";
import { begin } from "../lib/activity.ts";
import { manager, pendingWrites, useDB } from "../lib/db.ts";
import {
  DEFAULT_GENERATOR,
  createGenerator,
  pick,
  randomInt,
} from "../lib/generate.ts";
import {
  filterSummary,
  fmtMs,
  fmtNum,
  openSubscription,
  summarize,
} from "../lib/nostr.ts";
import { EngineSelect } from "../components/EngineSelect.tsx";
import { VirtualList } from "../components/VirtualList.tsx";
import { runEngine, type Engine } from "../lib/engines.ts";

type Shape =
  "kind" | "author" | "tag" | "kind+author" | "kind+tag" | "&and" | "window";
const SHAPES: Shape[] = [
  "kind",
  "author",
  "tag",
  "kind+author",
  "kind+tag",
  "&and",
  "window",
];

type Sample = {
  kinds: number[];
  authors: string[];
  tags: [string, string][];
  tagPairs: [string, string, string][];
  minTime: number;
  maxTime: number;
};

/** Read a slice of the database to build realistic random filters */
async function loadSample(): Promise<Sample> {
  // the public API works on either thread; a limit-only filter returns the newest
  const events = await manager.store.query({ limit: 2000 });
  const kinds = new Set<number>();
  const authors = new Set<string>();
  const tags: [string, string][] = [];
  const tagPairs: [string, string, string][] = [];
  let minTime = Infinity;
  let maxTime = 0;
  for (const event of events) {
    kinds.add(event.kind);
    authors.add(event.pubkey);
    minTime = Math.min(minTime, event.created_at);
    maxTime = Math.max(maxTime, event.created_at);
    const single = event.tags.filter((t) => t[0]?.length === 1 && t[1]);
    for (const t of single.slice(0, 3)) tags.push([t[0], t[1]]);
    const byName = new Map<string, string[]>();
    for (const t of single)
      byName.set(t[0], [...(byName.get(t[0]) ?? []), t[1]]);
    for (const [name, values] of byName)
      if (values.length >= 2 && values[0] !== values[1])
        tagPairs.push([name, values[0], values[1]]);
  }
  if (!events.length)
    throw new Error("Database is empty — store some events first");
  return {
    kinds: [...kinds],
    authors: [...authors],
    tags,
    tagPairs,
    minTime,
    maxTime,
  };
}

function randomFilter(s: Sample, shapes: Shape[]): Filter {
  const shape = pick(shapes.length ? shapes : SHAPES);
  const f: Record<string, unknown> = {};
  const tag = () => {
    const [n, v] = pick(s.tags.length ? s.tags : [["t", "nostr"]]);
    f["#" + n] = [v];
  };
  switch (shape) {
    case "kind":
      f.kinds = [pick(s.kinds)];
      break;
    case "author":
      f.authors = [pick(s.authors)];
      break;
    case "tag":
      tag();
      break;
    case "kind+author":
      f.kinds = [pick(s.kinds)];
      f.authors = [pick(s.authors)];
      break;
    case "kind+tag":
      f.kinds = [pick(s.kinds)];
      tag();
      break;
    case "&and": {
      if (s.tagPairs.length) {
        const [n, a, b] = pick(s.tagPairs);
        f["&" + n] = [a, b];
      } else tag();
      break;
    }
    case "window": {
      const span = Math.max(1, s.maxTime - s.minTime);
      const since = s.minTime + randomInt(span);
      f.since = since;
      f.until = since + Math.ceil(span / 20);
      break;
    }
  }
  const limit = pick([undefined, 10, 100, 500]);
  if (limit) f.limit = limit;
  return f as Filter;
}

type Result = {
  id: number;
  title: string;
  params: string;
  status: "running" | "done" | "error";
  error?: string;
  stats?: {
    label: string;
    value: ReactNode;
    tone?: "good" | "warn" | "bad" | "accent";
  }[];
  chart?: ReactNode;
};

type Workload = "storm" | "mixed" | "subs" | "cache";

export function StressPage() {
  const { ready, worker } = useDB();
  const [chosenWorkload, setWorkload] = useState<Workload>("storm");
  // the cache workload clears NostrIDB's index cache, which a worker keeps
  const workload: Workload =
    worker && chosenWorkload === "cache" ? "storm" : chosenWorkload;
  const [queries, setQueries] = useState(500);
  const [concurrency, setConcurrency] = useState(8);
  const [engine, setEngine] = useState<Engine>("query");
  const [shapes, setShapes] = useState<Shape[]>(SHAPES);
  const [writes, setWrites] = useState(5000);
  const [writeBatch, setWriteBatch] = useState(100);
  const [subs, setSubs] = useState(100);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const stopRef = useRef(false);
  const nextId = useRef(1);
  const mainRef = useRef<HTMLDivElement>(null);

  function update(id: number, patch: Partial<Result>) {
    setResults((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function launch(
    title: string,
    params: string,
    fn: (id: number) => Promise<void>,
  ) {
    const id = nextId.current++;
    stopRef.current = false;
    setBusy(true);
    setResults((rs) =>
      [{ id, title, params, status: "running" as const }, ...rs].slice(0, 20),
    );
    const finish = begin("stress", title, params);
    try {
      await fn(id);
      update(id, { status: "done" });
      finish("ok", stopRef.current ? "stopped" : undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      update(id, { status: "error", error: msg });
      finish("error", msg);
    } finally {
      setBusy(false);
    }
  }

  /** run `total` random queries with `concurrency` workers */
  async function storm(
    sample: Sample,
    total: number,
    onQuery: (t: number, ms: number, n: number, f: Filter) => void,
    keepGoing: () => boolean = () => true,
  ) {
    let issued = 0;
    const t0 = performance.now();
    const worker = async () => {
      while (issued < total && !stopRef.current && keepGoing()) {
        issued++;
        const f = randomFilter(sample, shapes);
        const q0 = performance.now();
        const r = await runEngine(engine, [f]);
        onQuery(
          q0 - t0,
          performance.now() - q0,
          typeof r === "number" ? r : r.length,
          f,
        );
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    return performance.now() - t0;
  }

  function stormStats(lat: number[], wall: number, rows: number) {
    const s = summarize(lat);
    return [
      { label: "queries", value: fmtNum(s.count) },
      {
        label: "q/s",
        value: fmtNum(Math.round(s.count / (wall / 1000))),
        tone: "accent" as const,
      },
      { label: "p50", value: fmtMs(s.p50) },
      { label: "p95", value: fmtMs(s.p95), tone: "warn" as const },
      { label: "p99", value: fmtMs(s.p99), tone: "warn" as const },
      { label: "max", value: fmtMs(s.max), tone: "bad" as const },
      { label: "rows", value: fmtNum(rows) },
    ];
  }

  const runStorm = () =>
    launch(
      "query storm",
      `${queries} queries · ${concurrency} parallel · ${engine}`,
      async (id) => {
        const sample = await loadSample();
        const lat: number[] = [];
        const points: [number, number][] = [];
        let rows = 0;
        let slowest: { ms: number; f: Filter } = { ms: 0, f: {} };
        let lastPaint = 0;
        const paint = (wall: number) =>
          update(id, {
            stats: stormStats(lat, wall, rows),
            chart: (
              <>
                <Scatter
                  series={[
                    {
                      name: "query latency",
                      color: "var(--accent)",
                      points: [...points],
                    },
                  ]}
                />
                <Histogram values={[...lat]} />
                <div className="slowest">
                  slowest {fmtMs(slowest.ms)}:{" "}
                  <code>{filterSummary([slowest.f])}</code>
                </div>
              </>
            ),
          });
        const wall = await storm(sample, queries, (t, ms, n, f) => {
          lat.push(ms);
          points.push([t + ms, ms]);
          rows += n;
          if (ms > slowest.ms) slowest = { ms, f };
          if (t - lastPaint > 200) {
            lastPaint = t;
            paint(t);
          }
        });
        paint(wall);
      },
    );

  const runMixed = () =>
    launch(
      "read + write",
      `${writes} writes (batch ${writeBatch}) while querying · ${concurrency} parallel`,
      async (id) => {
        const sample = await loadSample();
        const gen = createGenerator({ ...DEFAULT_GENERATOR, authors: 200 });
        const qPoints: [number, number][] = [];
        const wPoints: [number, number][] = [];
        const qLat: number[] = [];
        const wLat: number[] = [];
        let written = 0;
        let writing = true;
        const t0 = performance.now();
        const paint = () =>
          update(id, {
            stats: [
              { label: "written", value: fmtNum(written) },
              { label: "queries", value: fmtNum(qLat.length) },
              { label: "query p50", value: fmtMs(summarize(qLat).p50) },
              {
                label: "query p95",
                value: fmtMs(summarize(qLat).p95),
                tone: "warn",
              },
              { label: "write p50", value: fmtMs(summarize(wLat).p50) },
              {
                label: "write max",
                value: fmtMs(summarize(wLat).max),
                tone: "bad",
              },
            ],
            chart: (
              <Scatter
                series={[
                  {
                    name: "query",
                    color: "var(--accent)",
                    points: [...qPoints],
                  },
                  {
                    name: `write ×${writeBatch} → flushed`,
                    color: "var(--yellow)",
                    points: [...wPoints],
                  },
                ]}
              />
            ),
          });
        const timer = setInterval(paint, 250);
        const writer = (async () => {
          while (written < writes && !stopRef.current) {
            const batch = Array.from(
              { length: Math.min(writeBatch, writes - written) },
              gen.next,
            );
            const w0 = performance.now();
            if (manager.snapshot.worker) {
              // a worker's write queue is not visible here, so this measures
              // until the worker has accepted the batch
              await Promise.all(batch.map((e) => manager.store.add(e)));
            } else {
              for (const e of batch) await manager.nostr.add(e);
              // measure until the write queue has flushed the batch to IndexedDB
              while (pendingWrites(manager.nostr) > 0)
                await new Promise((r) => setTimeout(r, 5));
            }
            const ms = performance.now() - w0;
            wLat.push(ms);
            wPoints.push([w0 - t0 + ms, ms]);
            written += batch.length;
            await new Promise((r) => setTimeout(r, 0));
          }
          writing = false;
        })();
        await Promise.all([
          writer,
          storm(
            sample,
            Infinity,
            (t, ms) => {
              qLat.push(ms);
              qPoints.push([t + ms, ms]);
            },
            () => writing,
          ),
        ]);
        clearInterval(timer);
        paint();
      },
    );

  const runSubs = () =>
    launch(
      "subscription fan-out",
      `${subs} subscriptions · ${writes} adds`,
      async (id) => {
        const sample = await loadSample();
        const gen = createGenerator({ ...DEFAULT_GENERATOR, authors: 50 });
        const half = Math.floor(writes / 2);
        // generated events reuse authors/tags from the sample so subscriptions match
        const make = () => {
          const e = gen.next();
          if (Math.random() < 0.5) e.pubkey = pick(sample.authors);
          if (sample.tags.length && Math.random() < 0.5)
            e.tags.push(pick(sample.tags));
          if (Math.random() < 0.3)
            e.kind = pick(
              sample.kinds.filter((k) => k < 10000 || k >= 40000).concat(1),
            );
          return e;
        };
        const addAll = async (n: number) => {
          const t0 = performance.now();
          for (let i = 0; i < n && !stopRef.current; i++)
            await manager.store.add(make());
          return performance.now() - t0;
        };

        update(id, { stats: [{ label: "phase", value: "0 subs" }] });
        const baseline = await addAll(half);

        let deliveries = 0;
        const perSub = new Array(subs).fill(0);
        const closers: (() => void)[] = [];
        const o0 = performance.now();
        const subFilters = Array.from({ length: subs }, () =>
          randomFilter(sample, shapes),
        );
        subFilters.forEach((f, i) =>
          closers.push(
            openSubscription(manager.store, [f], () => {
              deliveries++;
              perSub[i]++;
            }),
          ),
        );
        const openMs = performance.now() - o0;
        // let the historical queries settle
        let prev = -1;
        while (performance.now() - o0 < 10000) {
          await new Promise((r) => setTimeout(r, 300));
          if (deliveries === prev) break;
          prev = deliveries;
        }
        const settleMs = performance.now() - o0 - 300;
        const historical = deliveries;
        update(id, { stats: [{ label: "phase", value: `${subs} subs` }] });
        const withSubs = await addAll(writes - half);
        const live = deliveries - historical;
        closers.forEach((c) => c());

        const perAddA = (baseline / Math.max(1, half)) * 1000;
        const perAddB = (withSubs / Math.max(1, writes - half)) * 1000;
        update(id, {
          stats: [
            { label: "add() no subs", value: perAddA.toFixed(1) + "µs" },
            {
              label: `add() ${subs} subs`,
              value: perAddB.toFixed(1) + "µs",
              tone: "warn",
            },
            {
              label: "overhead",
              value: (perAddB / Math.max(0.001, perAddA)).toFixed(1) + "×",
              tone: "accent",
            },
            { label: "open subs", value: fmtMs(openMs) },
            { label: "historical settle", value: fmtMs(settleMs) },
            { label: "historical", value: fmtNum(historical) },
            { label: "live deliveries", value: fmtNum(live), tone: "good" },
          ],
          chart: (
            <>
              <HBars
                items={[
                  {
                    key: "a",
                    label: "0 subs",
                    value: perAddA,
                    color: "var(--green)",
                  },
                  {
                    key: "b",
                    label: `${subs} subs`,
                    value: perAddB,
                    color: "var(--yellow)",
                  },
                ]}
                format={(n) => n.toFixed(1) + "µs"}
              />
              <Bars
                values={perSub}
                height={50}
                color="var(--green)"
                format={(n) => fmtNum(Math.round(n))}
              />
            </>
          ),
        });
      },
    );

  const runCache = () =>
    launch(
      "cold vs warm index cache",
      `${Math.min(queries, 60)} filters · ${engine}`,
      async (id) => {
        const sample = await loadSample();
        const n = Math.min(queries, 60);
        const filters = Array.from({ length: n }, () =>
          randomFilter(sample, shapes),
        );
        const cold: number[] = [];
        const warm: number[] = [];
        for (const f of filters) {
          if (stopRef.current) break;
          manager.nostr.indexCache.clear();
          let t = performance.now();
          await runEngine(engine, [f]);
          cold.push(performance.now() - t);
          t = performance.now();
          await runEngine(engine, [f]);
          warm.push(performance.now() - t);
          update(id, {
            chart: (
              <CachePairs
                cold={[...cold]}
                warm={[...warm]}
                filters={filters}
                scrollParent={mainRef}
              />
            ),
          });
        }
        const c = summarize(cold);
        const w = summarize(warm);
        update(id, {
          stats: [
            { label: "cold p50", value: fmtMs(c.p50), tone: "warn" },
            { label: "warm p50", value: fmtMs(w.p50), tone: "good" },
            { label: "cold total", value: fmtMs(c.total) },
            { label: "warm total", value: fmtMs(w.total) },
            {
              label: "speedup",
              value: (c.total / Math.max(0.001, w.total)).toFixed(1) + "×",
              tone: "accent",
            },
            {
              label: "cached indexes",
              value: fmtNum(manager.nostr.indexCache.count),
            },
          ],
        });
      },
    );

  const RUN: Record<Workload, () => void> = {
    storm: runStorm,
    mixed: runMixed,
    subs: runSubs,
    cache: runCache,
  };

  return (
    <div className="page">
      <div className="side">
        <Segmented
          value={workload}
          onChange={setWorkload}
          wide
          options={[
            { value: "storm", label: "query storm" },
            { value: "mixed", label: "read+write" },
            { value: "subs", label: "subs" },
            ...(worker ? [] : [{ value: "cache" as const, label: "cache" }]),
          ]}
        />

        {(workload === "storm" || workload === "cache") && (
          <NumberField
            label={workload === "cache" ? "filters" : "queries"}
            value={queries}
            onChange={setQueries}
            presets={
              workload === "cache" ? [10, 30, 60] : [100, 500, 2000, 10_000]
            }
          />
        )}
        {(workload === "storm" || workload === "mixed") && (
          <NumberField
            label="parallel"
            value={concurrency}
            min={1}
            onChange={(v) => setConcurrency(Math.max(1, v))}
            presets={[1, 4, 16, 64]}
          />
        )}
        {(workload === "mixed" || workload === "subs") && (
          <NumberField
            label="writes"
            value={writes}
            onChange={setWrites}
            presets={[1000, 5000, 20_000]}
          />
        )}
        {workload === "mixed" && (
          <NumberField
            label="write batch"
            value={writeBatch}
            min={1}
            onChange={(v) => setWriteBatch(Math.max(1, v))}
            presets={[1, 10, 100, 1000]}
          />
        )}
        {workload === "subs" && (
          <NumberField
            label="subscriptions"
            value={subs}
            min={1}
            onChange={(v) => setSubs(Math.max(1, v))}
            presets={[1, 10, 100, 1000]}
          />
        )}

        {workload !== "subs" && (
          <EngineSelect value={engine} onChange={setEngine} />
        )}

        <Field label="filter shapes">
          <span className="toggles">
            {SHAPES.map((s) => (
              <button
                key={s}
                className={shapes.includes(s) ? "on" : ""}
                onClick={() =>
                  setShapes(
                    shapes.includes(s)
                      ? shapes.filter((x) => x !== s)
                      : [...shapes, s],
                  )
                }
              >
                {s}
              </button>
            ))}
          </span>
        </Field>

        <div className="btn-row">
          {busy ? (
            <button
              className="btn danger"
              onClick={() => (stopRef.current = true)}
            >
              <Square size={16} /> stop
            </button>
          ) : (
            <button
              className="btn primary"
              disabled={!ready}
              onClick={RUN[workload]}
            >
              <Play size={16} /> run
            </button>
          )}
          {results.length > 0 && !busy && (
            <button className="btn" onClick={() => setResults([])}>
              clear
            </button>
          )}
        </div>
      </div>

      <div className="main scroll" ref={mainRef}>
        {results.length === 0 && (
          <div className="results-empty">
            <Play size={32} />
          </div>
        )}
        <VirtualList
          scrollParent={mainRef}
          items={results}
          estimateSize={240}
          gap={16}
          overscan={2}
          getKey={(r) => r.id}
          renderItem={(r) => (
            <div className={`run-panel ${r.status}`}>
              <div className="run-label">
                {r.status === "running" && <span className="spinner" />}{" "}
                {r.title}
                <span className="muted"> {r.params}</span>
              </div>
              {r.error && <div className="error">{r.error}</div>}
              {r.stats && (
                <div className="stats">
                  {r.stats.map((s) => (
                    <Stat
                      key={s.label}
                      label={s.label}
                      value={s.value}
                      tone={s.tone}
                    />
                  ))}
                </div>
              )}
              {r.chart}
            </div>
          )}
        />
      </div>
    </div>
  );
}

function CachePairs({
  cold,
  warm,
  filters,
  scrollParent,
}: {
  cold: number[];
  warm: number[];
  filters: Filter[];
  scrollParent: React.RefObject<HTMLElement | null>;
}) {
  const max = Math.max(1e-6, ...cold, ...warm);
  return (
    <VirtualList
      className="pairs"
      scrollParent={scrollParent}
      items={cold}
      estimateSize={24}
      gap={4}
      getKey={(_, i) => i}
      renderItem={(c, i) => (
        <div className="pair" title={filterSummary([filters[i]])}>
          <span className="pair-label">{filterSummary([filters[i]])}</span>
          <span className="pair-bars">
            <span
              className="pair-bar cold"
              style={{ width: `${(c / max) * 100}%` }}
            />
            <span
              className="pair-bar warm"
              style={{ width: `${(warm[i] / max) * 100}%` }}
            />
          </span>
          <span className="pair-ms">
            <span className="warn">{fmtMs(c)}</span> →{" "}
            <span className="good">{fmtMs(warm[i])}</span>
          </span>
        </div>
      )}
    />
  );
}
