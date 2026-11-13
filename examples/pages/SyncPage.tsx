import { SyncDirection } from "applesauce-relay";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  GitCompareArrows,
  Play,
  Square,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import type { Subscription } from "rxjs";
import { getEventUID, type Filter, type NostrEvent } from "../../src/index.ts";
import { Bars, HBars } from "../components/charts.tsx";
import { FilterBuilder, cleanFilter } from "../components/FilterBuilder.tsx";
import { RelayLabel, RelayPicker } from "../components/RelayPicker.tsx";
import { ResultsView } from "../components/ResultsView.tsx";
import { NumberField, Segmented, Stat } from "../components/ui.tsx";
import { begin, record } from "../lib/activity.ts";
import { manager, useDB, writeEvents } from "../lib/db.ts";
import { IdbSyncStore } from "../lib/idb-store.ts";
import { filterSummary, fmtMs, fmtNum } from "../lib/nostr.ts";
import { pool } from "../lib/pool.ts";
import { ImportSession } from "../lib/relay.ts";

type Direction = "pull" | "push" | "both";

const DIRECTIONS: Record<Direction, SyncDirection> = {
  pull: SyncDirection.RECEIVE,
  push: SyncDirection.SEND,
  both: SyncDirection.BOTH,
};

type RunStatus = "negotiating" | "transferring" | "done" | "error" | "stopped";

type RelaySync = {
  url: string;
  status: RunStatus;
  rounds: number;
  /** ids only the local database has */
  localOnly: number;
  /** ids only the relay has */
  relayOnly: number;
  received: number;
  sent: number;
  rejected: number;
  /** how events were pulled, REQ when the relay lacks NIP-77 */
  method: "negentropy" | "REQ";
  /** REQ fallback events skipped because they were already local */
  skipped: number;
  negotiateMs?: number;
  transferMs?: number;
  error?: string;
};

type Session = {
  compareOnly: boolean;
  direction: Direction;
  runs: RelaySync[];
  local?: number;
  inventoryMs?: number;
  stored: number;
  start: number;
  end?: number;
  rejections: Map<string, number>;
};

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error)
    return String((error as { message: unknown }).message);
  return String(error);
}

export function SyncPage() {
  const { ready } = useDB();
  const [relays, setRelays] = useState<string[]>([
    "wss://relay.ditto.pub",
    "wss://nos.lol",
  ]);
  const [filters, setFilters] = useState<Filter[]>([
    { kinds: [1], since: Math.floor(Date.now() / 1000) - 3600 },
  ]);
  const [direction, setDirection] = useState<Direction>("pull");
  const [concurrency, setConcurrency] = useState(4);
  const [batchSize, setBatchSize] = useState(500);
  const [fallbackMax, setFallbackMax] = useState(10_000);
  const [session, setSession] = useState<Session | null>(null);
  const [running, setRunning] = useState(false);
  const [feed, setFeed] = useState<NostrEvent[]>([]);
  const [rates, setRates] = useState<number[]>([]);
  const [, setTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const subsRef = useRef<Subscription[]>([]);

  // stop everything when the page unmounts
  useEffect(
    () => () => {
      abortRef.current?.abort();
      subsRef.current.forEach((s) => s.unsubscribe());
    },
    [],
  );

  async function start(compareOnly: boolean) {
    const filter = cleanFilter(filters[0] ?? {});
    const controller = new AbortController();
    abortRef.current = controller;
    subsRef.current = [];
    setRunning(true);
    setFeed([]);
    setRates([]);

    const s: Session = {
      compareOnly,
      direction,
      start: performance.now(),
      stored: 0,
      rejections: new Map(),
      runs: relays.map((url) => ({
        url,
        status: "negotiating",
        rounds: 0,
        localOnly: 0,
        relayOnly: 0,
        received: 0,
        sent: 0,
        rejected: 0,
        method: "negentropy",
        skipped: 0,
      })),
    };
    setSession(s);
    const repaint = () => setTick((t) => t + 1);

    const label = compareOnly ? "compare" : `sync ${direction}`;
    const finishAll = begin(
      "sync",
      `${label} with ${relays.length} relay${relays.length > 1 ? "s" : ""}`,
      filterSummary([filter]),
    );

    const store = new IdbSyncStore(manager.store);
    store.onInventory = (_f, n, ms) => {
      s.local = n;
      s.inventoryMs = ms;
      record(
        "sync",
        "getSyncPairs() local inventory",
        ms,
        `${fmtNum(n)} events`,
      );
      repaint();
    };

    // received events are buffered and written to IndexedDB in batches
    let buffer: NostrEvent[] = [];
    let feedBuffer: NostrEvent[] = [];
    let perSecond = 0;
    let writing: Promise<void> = Promise.resolve();
    const flush = () => {
      if (feedBuffer.length) {
        const add = feedBuffer;
        feedBuffer = [];
        setFeed((f) => [...add.reverse(), ...f].slice(0, 5000));
      }
      if (!buffer.length) return writing;
      const batch = buffer;
      buffer = [];
      writing = writing.then(async () => {
        const t0 = performance.now();
        try {
          await writeEvents(batch);
          s.stored += batch.length;
          record(
            "store",
            `addEvents() × ${batch.length}`,
            performance.now() - t0,
            "from sync",
          );
        } catch (e) {
          record(
            "store",
            `addEvents() × ${batch.length}`,
            performance.now() - t0,
            errorText(e),
            "error",
          );
        }
        repaint();
      });
      return writing;
    };
    const flushTimer = setInterval(flush, 300);
    const rateTimer = setInterval(() => {
      const n = perSecond;
      perSecond = 0;
      setRates((r) => [...r, n].slice(-120));
    }, 1000);

    const syncRelay = (run: RelaySync) =>
      new Promise<void>((resolve) => {
        const relay = pool.relay(run.url);
        const finish = begin("sync", `${label} ${run.url}`);
        // relays without NIP-77 can still be pulled from with paged REQs
        const fallback = async () => {
          run.method = "REQ";
          run.status = "transferring";
          run.error = undefined;
          repaint();
          await store.getSyncPairs(filter as never);
          const t0 = performance.now();
          const session = new ImportSession(
            [run.url],
            [filter],
            { mode: "backfill", maxPerRelay: fallbackMax },
            (event) => {
              perSecond++;
              if (store.has(event.id)) {
                run.skipped++;
                return;
              }
              run.received++;
              buffer.push(event);
              feedBuffer.push(event);
            },
            repaint,
            () => {
              const page = session.runs[0];
              run.transferMs = performance.now() - t0;
              if (page.status === "error") run.error = page.error;
              run.status = controller.signal.aborted
                ? "stopped"
                : page.status === "error"
                  ? "error"
                  : "done";
              finish(
                run.status === "error" ? "error" : "ok",
                `REQ fallback ↓ ${fmtNum(run.received)} new, ${fmtNum(run.skipped)} already local`,
              );
              repaint();
              resolve();
            },
          );
          controller.signal.addEventListener("abort", () => session.stop());
        };

        const fail = (error: unknown) => {
          if (
            !compareOnly &&
            direction !== "push" &&
            !controller.signal.aborted &&
            /NIP-77/.test(errorText(error))
          ) {
            fallback();
            return;
          }
          run.status = controller.signal.aborted ? "stopped" : "error";
          run.error = errorText(error);
          finish("error", run.error);
          repaint();
          resolve();
        };

        // phase 1: NIP-77 negotiation, ids only
        const n0 = performance.now();
        const negotiate = relay
          .negentropy(store, filter as never, { signal: controller.signal })
          .subscribe({
            next: ({ have, need }) => {
              run.rounds++;
              run.localOnly += have.length;
              run.relayOnly += need.length;
              repaint();
            },
            error: fail,
            complete: () => {
              run.negotiateMs = performance.now() - n0;
              const summary = `${fmtNum(run.localOnly)} local only · ${fmtNum(run.relayOnly)} relay only`;
              const work =
                (direction !== "push" && run.relayOnly > 0) ||
                (direction !== "pull" && run.localOnly > 0);
              if (compareOnly || !work || controller.signal.aborted) {
                run.status = controller.signal.aborted ? "stopped" : "done";
                finish("ok", summary);
                repaint();
                return resolve();
              }

              // phase 2: transfer the difference
              run.status = "transferring";
              repaint();
              const t0 = performance.now();
              const transfer = relay
                .sync(store, filter as never, DIRECTIONS[direction], {
                  concurrency,
                  batchSize,
                  signal: controller.signal,
                })
                .subscribe({
                  next: (message) => {
                    perSecond++;
                    if (message.type === "received") {
                      run.received++;
                      buffer.push(message.event as unknown as NostrEvent);
                      feedBuffer.push(message.event as unknown as NostrEvent);
                    } else if (message.type === "sent") {
                      run.sent++;
                    } else if (message.type === "send-failed") {
                      run.rejected++;
                      const reason =
                        message.response?.message || errorText(message.error);
                      s.rejections.set(
                        reason,
                        (s.rejections.get(reason) ?? 0) + 1,
                      );
                    }
                  },
                  error: fail,
                  complete: () => {
                    run.transferMs = performance.now() - t0;
                    run.status = controller.signal.aborted ? "stopped" : "done";
                    finish(
                      "ok",
                      `↓ ${fmtNum(run.received)} ↑ ${fmtNum(run.sent)}${run.rejected ? ` ✗ ${fmtNum(run.rejected)}` : ""}`,
                    );
                    repaint();
                    resolve();
                  },
                });
              subsRef.current.push(transfer);
            },
          });
        subsRef.current.push(negotiate);
      });

    await Promise.all(s.runs.map(syncRelay));
    clearInterval(flushTimer);
    clearInterval(rateTimer);
    await flush();
    s.end = performance.now();
    const totals = s.runs.reduce(
      (t, r) => ({ received: t.received + r.received, sent: t.sent + r.sent }),
      { received: 0, sent: 0 },
    );
    finishAll(
      s.runs.some((r) => r.status === "error") ? "error" : "ok",
      compareOnly
        ? `${fmtNum(s.local ?? 0)} local events compared`
        : `↓ ${fmtNum(totals.received)} stored ${fmtNum(s.stored)} ↑ ${fmtNum(totals.sent)}`,
    );
    setRunning(false);
    repaint();
  }

  function stop() {
    abortRef.current?.abort();
  }

  const runs = session?.runs ?? [];
  const sum = (k: keyof RelaySync) =>
    runs.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  const elapsed = session
    ? (session.end ?? performance.now()) - session.start
    : 0;
  const moved = sum("received") + sum("sent");
  const maxSide = Math.max(
    1,
    ...runs.map((r) => (session?.local ?? 0) + r.relayOnly),
  );

  return (
    <div className="page">
      <div className="side">
        <div className="group-title">relays</div>
        <RelayPicker relays={relays} onChange={setRelays} showNip77 />

        <div className="group-title">filter</div>
        <FilterBuilder filters={filters} onChange={setFilters} single />

        <div className="group-title">direction</div>
        <Segmented
          value={direction}
          onChange={setDirection}
          wide
          options={[
            {
              value: "pull",
              label: (
                <>
                  <ArrowDown size={16} /> pull
                </>
              ),
            },
            {
              value: "push",
              label: (
                <>
                  <ArrowUp size={16} /> push
                </>
              ),
            },
            {
              value: "both",
              label: (
                <>
                  <ArrowDownUp size={16} /> both
                </>
              ),
            },
          ]}
        />
        <NumberField
          label="concurrency"
          value={concurrency}
          min={1}
          onChange={(v) => setConcurrency(Math.max(1, v))}
          presets={[1, 4, 16]}
        />
        <NumberField
          label="ids per REQ"
          value={batchSize}
          min={1}
          onChange={(v) => setBatchSize(Math.max(1, v))}
          presets={[100, 500, 2000]}
        />
        {direction !== "push" && (
          <NumberField
            label="REQ fallback max / relay"
            value={fallbackMax}
            min={1}
            onChange={(v) => setFallbackMax(Math.max(1, v))}
            presets={[1000, 10_000, 100_000]}
          />
        )}

        <div className="btn-row">
          {running ? (
            <button className="btn danger" onClick={stop}>
              <Square size={16} /> stop
            </button>
          ) : (
            <>
              <button
                className="btn primary"
                disabled={!ready || !relays.length}
                onClick={() => start(false)}
              >
                <Play size={16} /> sync
              </button>
              <button
                className="btn"
                disabled={!ready || !relays.length}
                onClick={() => start(true)}
                title="negentropy only, no transfers"
              >
                <GitCompareArrows size={16} /> compare
              </button>
            </>
          )}
        </div>
      </div>

      <div className="main">
        {session && (
          <div className="run-panel">
            <div className="stats">
              <Stat
                label="local matches"
                value={
                  session.local === undefined ? "…" : fmtNum(session.local)
                }
              />
              <Stat
                label="relay only"
                value={fmtNum(sum("relayOnly"))}
                tone="accent"
              />
              <Stat label="local only" value={fmtNum(sum("localOnly"))} />
              {!session.compareOnly && (
                <>
                  <Stat label="↓ received" value={fmtNum(sum("received"))} />
                  <Stat
                    label="stored"
                    value={fmtNum(session.stored)}
                    tone="good"
                  />
                  <Stat
                    label="↑ sent"
                    value={fmtNum(sum("sent"))}
                    tone="good"
                  />
                  {sum("rejected") > 0 && (
                    <Stat
                      label="rejected"
                      value={fmtNum(sum("rejected"))}
                      tone="bad"
                    />
                  )}
                  <Stat
                    label="events/s"
                    value={fmtNum(
                      Math.round(moved / Math.max(0.001, elapsed / 1000)),
                    )}
                  />
                </>
              )}
              <Stat label="elapsed" value={fmtMs(elapsed)} />
            </div>

            <div className="sync-legend">
              <span>
                <i className="seg-local" /> local only
              </span>
              <span>
                <i className="seg-both" /> both
              </span>
              <span>
                <i className="seg-relay" /> relay only
              </span>
            </div>
            <div className="sync-table">
              {runs.map((r) => {
                const local = session.local ?? 0;
                const negotiated = r.method === "negentropy" && !r.error;
                const both = negotiated ? Math.max(0, local - r.localOnly) : 0;
                const pullTotal = direction !== "push" ? r.relayOnly : 0;
                const pushTotal = direction !== "pull" ? r.localOnly : 0;
                return (
                  <div
                    className={`sync-row ${r.status}`}
                    key={r.url}
                    title={r.error}
                  >
                    <div className="sync-relay">
                      <RelayLabel url={r.url} showNip77 />
                      <span className="sync-status">
                        {r.status === "negotiating" ||
                        r.status === "transferring" ? (
                          <span className="spinner" />
                        ) : null}{" "}
                        {r.status}
                      </span>
                    </div>
                    <div className="diff-bar">
                      <span
                        className="seg-local"
                        style={{ width: `${(r.localOnly / maxSide) * 100}%` }}
                      />
                      <span
                        className="seg-both"
                        style={{ width: `${(both / maxSide) * 100}%` }}
                      />
                      <span
                        className="seg-relay"
                        style={{ width: `${(r.relayOnly / maxSide) * 100}%` }}
                      />
                    </div>
                    <div className="sync-numbers">
                      {negotiated && (
                        <span>
                          {fmtNum(r.localOnly)} · {fmtNum(both)} ·{" "}
                          {fmtNum(r.relayOnly)}
                        </span>
                      )}
                      {r.method === "REQ" && (
                        <span>
                          paged REQ · ↓ {fmtNum(r.received)} new ·{" "}
                          <span className="muted">
                            {fmtNum(r.skipped)} already local
                          </span>
                        </span>
                      )}
                      {!session.compareOnly && negotiated && pullTotal > 0 && (
                        <span>
                          ↓ {fmtNum(r.received)} / {fmtNum(pullTotal)}
                        </span>
                      )}
                      {!session.compareOnly && pushTotal > 0 && (
                        <span>
                          ↑ {fmtNum(r.sent)} / {fmtNum(pushTotal)}
                          {r.rejected > 0 && (
                            <span className="bad"> ✗ {fmtNum(r.rejected)}</span>
                          )}
                        </span>
                      )}
                      <span className="muted">
                        {r.negotiateMs !== undefined &&
                          `negotiate ${fmtMs(r.negotiateMs)}`}
                        {r.transferMs !== undefined &&
                          ` · transfer ${fmtMs(r.transferMs)}`}
                      </span>
                    </div>
                    {r.error && <div className="error">{r.error}</div>}
                  </div>
                );
              })}
            </div>

            {rates.length > 1 && (
              <Bars
                values={rates}
                height={50}
                format={(n) => Math.round(n) + "/s"}
              />
            )}

            {session.rejections.size > 0 && (
              <HBars
                items={[...session.rejections]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([reason, n]) => ({
                    key: reason,
                    label: <span title={reason}>{reason}</span>,
                    value: n,
                    color: "var(--red)",
                  }))}
              />
            )}
          </div>
        )}
        <ResultsView
          events={feed}
          header={
            feed.length ? (
              <span>{fmtNum(feed.length)} latest pulled</span>
            ) : null
          }
          onDeleted={(uid) =>
            setFeed((f) => f.filter((e) => getEventUID(e) !== uid))
          }
        />
      </div>
    </div>
  );
}
