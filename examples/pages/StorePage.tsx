import React, { useRef, useState } from "react";
import {
  addEvents,
  getEventUID,
  validateEvent,
  type StoredEvent,
} from "../../src/index.ts";
import { Bars } from "../components/charts.tsx";
import { ResultsView } from "../components/ResultsView.tsx";
import { NumberField, Progress, Segmented, Stat } from "../components/ui.tsx";
import { begin } from "../lib/activity.ts";
import { manager, pendingWrites, useDB } from "../lib/db.ts";
import {
  DEFAULT_GENERATOR,
  GENERATOR_KINDS,
  createGenerator,
  type GeneratorOptions,
} from "../lib/generate.ts";
import {
  fmtMs,
  fmtNum,
  kindColor,
  kindName,
  parseEvents,
  summarize,
} from "../lib/nostr.ts";

type Method = "addEvents" | "nostr.add";

type RunState = {
  label: string;
  total: number;
  done: number;
  start: number;
  end?: number;
  batches: number[];
  flushMs?: number;
  rejected?: number;
};

async function waitForQueue() {
  while (manager.snapshot.nostr && pendingWrites(manager.snapshot.nostr) > 0)
    await new Promise((r) => setTimeout(r, 20));
}

export function StorePage() {
  const { ready } = useDB();
  const [gen, setGen] = useState<GeneratorOptions>(DEFAULT_GENERATOR);
  const [count, setCount] = useState(10_000);
  const [batchSize, setBatchSize] = useState(1000);
  const [method, setMethod] = useState<Method>("addEvents");
  const [run, setRun] = useState<RunState | null>(null);
  const [sample, setSample] = useState<StoredEvent[]>([]);
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const stopRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const setG = (patch: Partial<GeneratorOptions>) =>
    setGen((g) => ({ ...g, ...patch }));

  /** Write events in batches, reporting progress */
  async function store(
    label: string,
    total: number,
    nextBatch: (n: number) => StoredEvent[],
    rejected = 0,
  ) {
    stopRef.current = false;
    setBusy(true);
    const finish = begin("store", label, `batch ${batchSize}`);
    const state: RunState = {
      label,
      total,
      done: 0,
      start: performance.now(),
      batches: [],
      rejected,
    };
    setRun({ ...state });
    const kept: StoredEvent[] = [];
    let lastPaint = 0;
    try {
      while (state.done < total && !stopRef.current) {
        const batch = nextBatch(Math.min(batchSize, total - state.done));
        if (!batch.length) break;
        const t0 = performance.now();
        if (method === "addEvents") await addEvents(manager.db, batch);
        else for (const e of batch) await manager.nostr.add(e);
        state.batches.push(performance.now() - t0);
        state.done += batch.length;
        if (kept.length < 2000) kept.push(...batch.slice(0, 2000 - kept.length));
        // yield to the UI
        if (performance.now() - lastPaint > 60) {
          lastPaint = performance.now();
          setRun({ ...state, batches: [...state.batches] });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (method === "nostr.add") {
        const f0 = performance.now();
        await waitForQueue();
        state.flushMs = performance.now() - f0;
      }
      state.end = performance.now();
      setRun({ ...state, batches: [...state.batches] });
      const secs = (state.end - state.start) / 1000;
      finish(
        stopRef.current ? "error" : "ok",
        `${fmtNum(state.done)} events · ${fmtNum(Math.round(state.done / secs))}/s${stopRef.current ? " (stopped)" : ""}`,
      );
      setSample(kept);
    } catch (err) {
      finish("error", err instanceof Error ? err.message : String(err));
      state.end = performance.now();
      setRun({ ...state });
    } finally {
      setBusy(false);
    }
  }

  function generate() {
    const g = createGenerator(gen);
    store(
      `${method === "addEvents" ? "addEvents()" : "nostr.add()"} × ${fmtNum(count)} generated`,
      count,
      (n) => Array.from({ length: n }, g.next),
    );
  }

  function storePasted(text: string) {
    setPasteError(null);
    let events: StoredEvent[];
    try {
      events = parseEvents(text);
    } catch (e) {
      setPasteError(e instanceof Error ? e.message : String(e));
      return;
    }
    const valid = events.filter((e) => validateEvent(e));
    let offset = 0;
    store(
      `${method === "addEvents" ? "addEvents()" : "nostr.add()"} × ${fmtNum(valid.length)} pasted`,
      valid.length,
      (n) => {
        const b = valid.slice(offset, offset + n);
        offset += n;
        return b;
      },
      events.length - valid.length,
    );
  }

  const elapsed = run ? (run.end ?? performance.now()) - run.start : 0;
  const rate = run && elapsed > 0 ? run.done / (elapsed / 1000) : 0;
  const bstats = run ? summarize(run.batches) : null;

  return (
    <div className="page">
      <div className="side">
        <div className="group-title">generate</div>
        <NumberField
          label="events"
          value={count}
          onChange={setCount}
          presets={[100, 1000, 10_000, 50_000, 100_000]}
        />
        <NumberField
          label="batch"
          value={batchSize}
          min={1}
          onChange={(v) => setBatchSize(Math.max(1, v))}
          presets={[1, 100, 1000, 5000]}
        />
        <NumberField
          label="authors"
          value={gen.authors}
          min={1}
          onChange={(v) => setG({ authors: v })}
          presets={[1, 10, 100, 1000]}
        />
        <NumberField
          label="tags / event"
          value={gen.tagsPerEvent}
          onChange={(v) => setG({ tagsPerEvent: v })}
          presets={[0, 3, 10, 50]}
        />
        <NumberField
          label="hashtags"
          value={gen.hashtags}
          min={1}
          onChange={(v) => setG({ hashtags: v })}
          presets={[1, 5, 20]}
        />
        <NumberField
          label="content"
          value={gen.contentLength}
          onChange={(v) => setG({ contentLength: v })}
          presets={[0, 140, 1000, 10_000]}
          suffix="chars"
        />
        <NumberField
          label="spread"
          value={gen.spanDays}
          onChange={(v) => setG({ spanDays: v })}
          presets={[1, 30, 365]}
          suffix="days"
        />
        <div className="numfield">
          <span className="numfield-label">kinds</span>
          <span className="kind-toggles">
            {GENERATOR_KINDS.map((k) => {
              const on = gen.kinds.includes(k);
              return (
                <button
                  key={k}
                  className={on ? "on" : ""}
                  style={on ? { borderColor: kindColor(k), color: kindColor(k) } : undefined}
                  onClick={() =>
                    setG({
                      kinds: on
                        ? gen.kinds.filter((x) => x !== k)
                        : [...gen.kinds, k],
                    })
                  }
                >
                  {k} <span className="muted">{kindName(k)}</span>
                </button>
              );
            })}
          </span>
        </div>

        <Segmented
          value={method}
          onChange={setMethod}
          size="sm"
          options={[
            { value: "addEvents", label: "addEvents(db, batch)" },
            { value: "nostr.add", label: "nostr.add(event)" },
          ]}
        />

        <div className="btn-row">
          {busy ? (
            <button className="btn danger" onClick={() => (stopRef.current = true)}>
              ■ stop
            </button>
          ) : (
            <button className="btn primary" disabled={!ready} onClick={generate}>
              ▶ generate & store
            </button>
          )}
        </div>

        <div className="group-title">paste / file</div>
        <textarea
          className="paste"
          rows={6}
          spellCheck={false}
          placeholder='[{"id":…}] · JSONL · ["EVENT",…]'
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) storePasted(await file.text());
          }}
        />
        {pasteError && <div className="error">{pasteError}</div>}
        <div className="btn-row">
          <button
            className="btn"
            disabled={!ready || busy || !paste.trim()}
            onClick={() => storePasted(paste)}
          >
            store pasted
          </button>
          <label className="btn file">
            open file…
            <input
              type="file"
              accept=".json,.jsonl,.txt"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) storePasted(await f.text());
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      <div className="main">
        {run && (
          <div className="run-panel">
            <div className="run-label">{run.label}</div>
            <Progress value={run.done} max={run.total} />
            <div className="stats">
              <Stat label="stored" value={fmtNum(run.done)} />
              <Stat label="events/s" value={fmtNum(Math.round(rate))} tone="accent" />
              <Stat label="elapsed" value={fmtMs(elapsed)} />
              {bstats && <Stat label="batch p50" value={fmtMs(bstats.p50)} />}
              {bstats && <Stat label="batch max" value={fmtMs(bstats.max)} tone="warn" />}
              {run.flushMs !== undefined && (
                <Stat label="queue flush" value={fmtMs(run.flushMs)} />
              )}
              {!!run.rejected && (
                <Stat label="invalid" value={fmtNum(run.rejected)} tone="bad" />
              )}
            </div>
            {run.batches.length > 0 && (
              <Bars values={run.batches.slice(-400)} height={80} />
            )}
          </div>
        )}
        <ResultsView
          events={sample}
          header={sample.length ? <span>sample of written events</span> : null}
          onDeleted={(uid) =>
            setSample((s) => s.filter((e) => getEventUID(e) !== uid))
          }
        />
      </div>
    </div>
  );
}
