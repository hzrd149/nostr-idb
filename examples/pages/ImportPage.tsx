import React, { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import type { Filter, NostrEvent } from "../../src/index.ts";
import { Bars } from "../components/charts.tsx";
import { FilterBuilder, cleanFilter } from "../components/FilterBuilder.tsx";
import { ResultsView } from "../components/ResultsView.tsx";
import { VirtualList } from "../components/VirtualList.tsx";
import { RelayPicker } from "../components/RelayPicker.tsx";
import { NumberField, Segmented, Stat } from "../components/ui.tsx";
import { begin, record } from "../lib/activity.ts";
import { manager, useDB, writeEvents } from "../lib/db.ts";
import { PRESET_RELAYS } from "../lib/pool.ts";
import { filterSummary, fmtMs, fmtNum } from "../lib/nostr.ts";
import { ImportSession, type ImportMode } from "../lib/relay.ts";

type Sink = "nostr.add" | "addEvents";

export function ImportPage() {
  const { ready } = useDB();
  const [relays, setRelays] = useState<string[]>(PRESET_RELAYS.slice(0, 2));
  const [filters, setFilters] = useState<Filter[]>([
    { kinds: [1], limit: 500 },
  ]);
  const [mode, setMode] = useState<ImportMode>("backfill");
  const [maxPerRelay, setMaxPerRelay] = useState(5000);
  const [sink, setSink] = useState<Sink>("addEvents");
  const [session, setSession] = useState<ImportSession | null>(null);
  const [, setTick] = useState(0);
  const [feed, setFeed] = useState<NostrEvent[]>([]);
  const [rates, setRates] = useState<number[]>([]);
  const [stored, setStored] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const bufferRef = useRef<NostrEvent[]>([]);
  const feedRef = useRef<NostrEvent[]>([]);
  const perSecond = useRef(0);

  // flush buffered events into the database, the feed and the rate chart
  useEffect(() => {
    if (!session) return;
    let writing = false;
    const flush = async () => {
      if (feedRef.current.length) {
        const add = feedRef.current.splice(0);
        setFeed((f) => [...add.reverse(), ...f].slice(0, 5000));
      }
      if (sink === "addEvents" && !writing && bufferRef.current.length) {
        writing = true;
        const batch = bufferRef.current.splice(0);
        const t0 = performance.now();
        try {
          await writeEvents(batch);
          record(
            "store",
            `addEvents() × ${batch.length}`,
            performance.now() - t0,
            "from relays",
          );
          setStored((s) => s + batch.length);
        } catch (e) {
          record(
            "store",
            `addEvents() × ${batch.length}`,
            performance.now() - t0,
            String(e),
            "error",
          );
        }
        writing = false;
      }
      setTick((t) => t + 1);
    };
    const flushTimer = setInterval(flush, 500);
    const rateTimer = setInterval(() => {
      if (!session.running) return;
      const n = perSecond.current;
      perSecond.current = 0;
      setRates((r) => [...r, n].slice(-120));
    }, 1000);
    return () => {
      clearInterval(flushTimer);
      clearInterval(rateTimer);
      flush();
    };
  }, [session, sink]);

  // stop the session when leaving the page for good
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => () => sessionRef.current?.stop(), []);

  function start() {
    const clean = filters.map(cleanFilter);
    bufferRef.current = [];
    feedRef.current = [];
    setFeed([]);
    setRates([]);
    setStored(0);
    setStartedAt(performance.now());
    setEndedAt(null);
    const finish = begin(
      "import",
      `import ${mode} from ${relays.length} relays`,
      filterSummary(clean),
    );
    const s = new ImportSession(
      relays,
      clean,
      { mode, maxPerRelay },
      (event) => {
        perSecond.current++;
        feedRef.current.push(event);
        if (sink === "nostr.add") {
          manager.store.add(event);
          setStored((n) => n + 1);
        } else bufferRef.current.push(event);
      },
      () => setTick((t) => t + 1),
      () => {
        setEndedAt(performance.now());
        finish("ok", `${fmtNum(s.total)} unique events`);
      },
    );
    setSession(s);
  }

  const runs = session?.runs ?? [];
  const total = runs.reduce((a, r) => a + r.received, 0);
  const elapsed = startedAt ? (endedAt ?? performance.now()) - startedAt : 0;

  return (
    <div className="page">
      <div className="side">
        <div className="group-title">relays</div>
        <RelayPicker relays={relays} onChange={setRelays} />

        <div className="group-title">filter</div>
        <FilterBuilder
          filters={filters}
          onChange={setFilters}
          onSubmit={start}
        />

        <Segmented
          value={mode}
          onChange={setMode}
          wide
          options={[
            { value: "snapshot", label: "until EOSE" },
            { value: "backfill", label: "backfill pages" },
            { value: "live", label: "live stream" },
          ]}
        />
        {mode === "backfill" && (
          <NumberField
            label="max / relay"
            value={maxPerRelay}
            onChange={setMaxPerRelay}
            presets={[1000, 5000, 20_000, 100_000]}
          />
        )}
        <Segmented
          value={sink}
          onChange={setSink}
          wide
          options={[
            { value: "addEvents", label: "addEvents() every 500ms" },
            { value: "nostr.add", label: "nostr.add() each" },
          ]}
        />

        <div className="btn-row">
          {session?.running ? (
            <button className="btn danger" onClick={() => session.stop()}>
              <Square size={16} /> stop
            </button>
          ) : (
            <button
              className="btn primary"
              disabled={!ready || !relays.length}
              onClick={start}
            >
              <Play size={16} /> import
            </button>
          )}
        </div>
      </div>

      <div className="main">
        {runs.length > 0 && (
          <div className="run-panel">
            <div className="stats">
              <Stat label="received" value={fmtNum(total)} />
              <Stat
                label="unique"
                value={fmtNum(session?.total ?? stored)}
                tone="accent"
              />
              <Stat label="stored" value={fmtNum(stored)} tone="good" />
              <Stat label="elapsed" value={fmtMs(elapsed)} />
              <Stat
                label="events/s"
                value={fmtNum(
                  Math.round(total / Math.max(0.001, elapsed / 1000)),
                )}
              />
            </div>
            <div className="relay-table">
              <div className="relay-table-row relay-table-head">
                <span />
                <span>relay</span>
                <span>received</span>
                <span>dupes</span>
                <span>pages</span>
                <span>connect</span>
                <span>1st EOSE</span>
                <span>oldest</span>
              </div>
              <VirtualList
                className="relay-table-body"
                items={runs}
                estimateSize={33}
                getKey={(r) => r.url}
                renderItem={(r) => (
                  <div className="relay-table-row" title={r.error}>
                    <span>
                      <span
                        className={`status-dot ${r.status}`}
                        title={r.status}
                      />
                    </span>
                    <span className="relay-table-url">
                      {r.url.replace("wss://", "")}
                    </span>
                    <span>{fmtNum(r.received)}</span>
                    <span className="muted">{fmtNum(r.duplicates)}</span>
                    <span>{r.pages}</span>
                    <span>
                      {r.connectMs !== undefined ? fmtMs(r.connectMs) : "–"}
                    </span>
                    <span>
                      {r.firstEoseMs !== undefined ? fmtMs(r.firstEoseMs) : "–"}
                    </span>
                    <span className="muted">
                      {r.oldest
                        ? new Date(r.oldest * 1000).toLocaleDateString()
                        : "–"}
                    </span>
                  </div>
                )}
              />
            </div>
            {rates.length > 1 && (
              <Bars
                values={rates}
                height={50}
                format={(n) => Math.round(n) + "/s"}
              />
            )}
          </div>
        )}
        <ResultsView
          events={feed}
          header={
            feed.length ? (
              <span>{fmtNum(feed.length)} latest imported</span>
            ) : null
          }
        />
      </div>
    </div>
  );
}
