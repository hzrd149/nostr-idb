import React, { useCallback, useEffect, useState } from "react";
import { Cpu, FileDown, HardDrive, Scissors } from "lucide-react";
import {
  clearDB,
  countEventsByKind,
  countEventsByPubkeys,
  pruneLastUsed,
} from "../../src/index.ts";
import { Bars, HBars } from "../components/charts.tsx";
import { KindBadge, Pubkey } from "../components/ResultsView.tsx";
import {
  ConfirmButton,
  NumberField,
  Section,
  Stat,
} from "../components/ui.tsx";
import { begin, track } from "../lib/activity.ts";
import { useApp } from "../lib/app.ts";
import { manager, useDB, useLiveStats } from "../lib/db.ts";
import { SnortStore } from "../lib/snort-store.ts";
import {
  fmtBytes,
  fmtNum,
  kindColor,
  pubkeyColor,
  shortHex,
  tagFilter,
} from "../lib/nostr.ts";

type Data = {
  kinds: [number, number][];
  authors: [string, number][];
  usedCount: number;
};

type TagStats = { top: [string, number][]; distinct: number; total: number };
type Timeline = { days: number[]; start: number };

/** The worker-relay only reports event counts per kind */
function SnortInspect({ active }: { active: boolean }) {
  const { store, name, generation } = useDB();
  const { openQuery } = useApp();
  const live = useLiveStats(1000);
  const [kinds, setKinds] = useState<[number, number][] | null>(null);

  const load = useCallback(async () => {
    if (!(store instanceof SnortStore)) return;
    const summary = await track(
      "inspect",
      "worker-relay.summary()",
      () => store.summary(),
      (s) => `${Object.keys(s).length} kinds`,
    );
    setKinds(
      Object.entries(summary)
        .map(([k, n]) => [Number(k), n] as [number, number])
        .sort((a, b) => b[1] - a[1]),
    );
  }, [store]);

  useEffect(() => {
    if (active) load().catch(() => {});
  }, [active, load, generation]);

  return (
    <div className="page inspect">
      <div className="side">
        <div className="stats col">
          <Stat label="events" value={fmtNum(live?.events ?? 0)} />
          <Stat label="origin storage" value={fmtBytes(live?.usage)} />
        </div>
        <p className="muted">
          <HardDrive size={16} /> {name} runs on @snort/worker-relay
          (SQLite-WASM on OPFS). It only reports counts per kind, so the
          IndexedDB tools on this page are not available.
        </p>
        <ConfirmButton disabled={!store} onConfirm={() => manager.drop()}>
          delete all events
        </ConfirmButton>
      </div>
      <div className="main">
        <Section
          title={`kinds · ${kinds?.length ?? 0}`}
          right={
            <button className="btn" onClick={load}>
              refresh
            </button>
          }
        >
          <HBars
            items={(kinds ?? []).slice(0, 30).map(([k, n]) => ({
              key: String(k),
              label: <KindBadge kind={k} />,
              value: n,
              color: kindColor(k),
              onClick: () => openQuery([{ kinds: [k], limit: 500 }]),
            }))}
          />
        </Section>
      </div>
    </div>
  );
}

export function InspectPage({ active }: { active: boolean }) {
  const { backend } = useDB();
  if (backend === "snort") return <SnortInspect active={active} />;
  return <IDBInspect active={active} />;
}

function IDBInspect({ active }: { active: boolean }) {
  const { ready, generation, name, worker, options } = useDB();
  const { openQuery } = useApp();
  const live = useLiveStats(1000);
  const [data, setData] = useState<Data | null>(null);
  const [tags, setTags] = useState<TagStats | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [cacheView, setCacheView] = useState(0);
  const [pruneTo, setPruneTo] = useState(1000);

  const load = useCallback(async () => {
    if (!manager.snapshot.ready || manager.snapshot.worker) return;
    const db = manager.db;
    const [kinds, authors, usedCount] = await Promise.all([
      track(
        "inspect",
        "countEventsByKind()",
        () => countEventsByKind(db),
        (r) => `${Object.keys(r).length} kinds`,
      ),
      track(
        "inspect",
        "countEventsByPubkeys()",
        () => countEventsByPubkeys(db),
        (r) => `${Object.keys(r).length} authors`,
      ),
      db.count("used"),
    ]);
    setData({
      kinds: Object.entries(kinds)
        .map(([k, n]) => [Number(k), n] as [number, number])
        .sort((a, b) => b[1] - a[1]),
      authors: Object.entries(authors).sort((a, b) => b[1] - a[1]),
      usedCount,
    });
  }, []);

  useEffect(() => {
    if (ready && active) load();
  }, [ready, active, generation, load]);

  async function scanTags() {
    const counts = await track(
      "inspect",
      'scan index("tags")',
      async () => {
        const counts = new Map<string, number>();
        let cursor = await manager.db
          .transaction("events")
          .store.index("tags")
          .openKeyCursor();
        while (cursor) {
          const k = cursor.key as string;
          counts.set(k, (counts.get(k) ?? 0) + 1);
          cursor = await cursor.continue();
        }
        return counts;
      },
      (c) => `${fmtNum(c.size)} distinct`,
    );
    let total = 0;
    for (const n of counts.values()) total += n;
    setTags({
      top: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 25),
      distinct: counts.size,
      total,
    });
  }

  async function scanTimeline() {
    const days = await track(
      "inspect",
      'scan index("created_at")',
      async () => {
        const values: number[] = [];
        let cursor = await manager.db
          .transaction("events")
          .store.index("created_at")
          .openKeyCursor();
        while (cursor) {
          values.push(cursor.key as number);
          cursor = await cursor.continue();
        }
        return values;
      },
      (v) => `${fmtNum(v.length)} timestamps`,
    );
    if (!days.length) return setTimeline({ days: [], start: 0 });
    const start = Math.floor(days[0] / 86400);
    const end = Math.floor(days[days.length - 1] / 86400);
    const span = Math.min(730, end - start + 1);
    const first = end - span + 1;
    const buckets = new Array(span).fill(0);
    for (const t of days) {
      const d = Math.floor(t / 86400) - first;
      if (d >= 0) buckets[d]++;
    }
    setTimeline({ days: buckets, start: first });
  }

  const cache = manager.snapshot.nostr?.indexCache;
  const cacheIndexes = cache ? cache.lastUsed.reverse().slice(0, 60) : [];

  const usagePct =
    live?.usage && live.quota ? (live.usage / live.quota) * 100 : 0;

  // everything on this page reads IndexedDB or NostrIDB internals directly
  if (worker)
    return (
      <div className="no-database">
        <div className="no-database-card">
          <h2>
            <Cpu size={22} /> {name} runs in a worker
          </h2>
          <p className="muted">
            Inspect scans IndexedDB indexes and reads NostrIDB's caches
            directly. A worker only exposes the public API through
            NostrIDBClient, so these tools need the database on the main thread.
          </p>
          <div className="btn-row">
            <button
              className="btn primary"
              onClick={() => manager.reopen(name, options, "main")}
            >
              move to main thread
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="page inspect">
      <div className="side">
        <div className="stats col">
          <Stat
            label="events"
            value={fmtNum(live?.events ?? 0)}
            tone="accent"
          />
          <Stat label="used records" value={fmtNum(data?.usedCount ?? 0)} />
          <Stat
            label="pending writes"
            value={fmtNum(live?.pendingWrites ?? 0)}
          />
          <Stat label="eventMap" value={fmtNum(live?.memoryEvents ?? 0)} />
          <Stat
            label="subscriptions"
            value={fmtNum(live?.subscriptions ?? 0)}
          />
          <Stat label="storage" value={fmtBytes(live?.usage)} />
        </div>
        <div
          className="progress"
          title={`${fmtBytes(live?.usage)} / ${fmtBytes(live?.quota)}`}
        >
          <div
            className="progress-bar"
            style={{ width: Math.max(0.5, usagePct) + "%" }}
          />
        </div>
        <div className="muted small">
          {fmtBytes(live?.usage)} of {fmtBytes(live?.quota)} · {name}
        </div>

        <div className="group-title">maintenance</div>
        <div className="prune">
          <NumberField
            label="keep"
            value={pruneTo}
            onChange={setPruneTo}
            presets={[100, 1000, 10_000]}
          />
          <button
            className="btn"
            disabled={!ready}
            onClick={async () => {
              const uids = await track(
                "prune",
                `pruneLastUsed(db, ${pruneTo})`,
                () => pruneLastUsed(manager.db, pruneTo),
                (u) => `${fmtNum(u.length)} removed`,
              );
              for (const uid of uids) manager.nostr.eventMap.delete(uid);
              manager.nostr.indexCache.clear();
              load();
            }}
          >
            <Scissors size={16} /> prune
          </button>
        </div>
        <div className="btn-row">
          <button
            className="btn"
            disabled={!ready}
            onClick={async () => {
              const finish = begin("inspect", "export events.jsonl");
              const rows = await manager.db.getAll("events");
              const blob = new Blob(
                rows.map((r) => JSON.stringify(r.event) + "\n"),
                { type: "application/jsonl" },
              );
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `${name}.jsonl`;
              a.click();
              URL.revokeObjectURL(a.href);
              finish(
                "ok",
                `${fmtNum(rows.length)} events · ${fmtBytes(blob.size)}`,
              );
            }}
          >
            <FileDown size={16} /> export jsonl
          </button>
          <button
            className="btn"
            disabled={!ready}
            onClick={() => {
              track("inspect", "indexCache.clear()", () =>
                manager.nostr.indexCache.clear(),
              );
              setCacheView((v) => v + 1);
            }}
          >
            clear index cache
          </button>
        </div>
        <div className="btn-row">
          <ConfirmButton
            disabled={!ready}
            onConfirm={async () => {
              await track("delete", "nostr.deleteAllEvents()", () =>
                manager.nostr.deleteAllEvents(),
              );
              load();
            }}
          >
            delete all events
          </ConfirmButton>
          <ConfirmButton
            disabled={!ready}
            onConfirm={async () => {
              await track("delete", "clearDB(db)", () => clearDB(manager.db));
              manager.nostr.indexCache.clear();
              manager.nostr.eventMap.clear();
              load();
            }}
          >
            clearDB
          </ConfirmButton>
          <ConfirmButton disabled={!ready} onConfirm={() => manager.drop()}>
            deleteDB
          </ConfirmButton>
        </div>
      </div>

      <div className="main scroll">
        <div className="inspect-grid">
          <Section
            title={`kinds · ${data?.kinds.length ?? 0}`}
            right={
              <button className="btn" onClick={load}>
                refresh
              </button>
            }
          >
            <HBars
              items={(data?.kinds ?? []).slice(0, 30).map(([k, n]) => ({
                key: String(k),
                label: <KindBadge kind={k} />,
                value: n,
                color: kindColor(k),
                onClick: () => openQuery([{ kinds: [k], limit: 500 }]),
              }))}
            />
          </Section>

          <Section title={`authors · ${fmtNum(data?.authors.length ?? 0)}`}>
            <HBars
              items={(data?.authors ?? []).slice(0, 30).map(([pk, n]) => ({
                key: pk,
                label: <Pubkey pubkey={pk} />,
                value: n,
                color: pubkeyColor(pk),
                onClick: () => openQuery([{ authors: [pk], limit: 500 }]),
              }))}
            />
          </Section>

          <Section
            title={
              tags
                ? `tags · ${fmtNum(tags.distinct)} distinct · ${fmtNum(tags.total)} entries`
                : "tags"
            }
            right={
              <button className="btn" disabled={!ready} onClick={scanTags}>
                scan
              </button>
            }
          >
            {tags && (
              <HBars
                items={tags.top.map(([key, n]) => ({
                  key,
                  label: (
                    <span className="mono">
                      <b>#{key[0]}</b> {shortHex(key.slice(1), 16)}
                    </span>
                  ),
                  value: n,
                  onClick: () =>
                    openQuery([tagFilter(key[0], key.slice(1), 500)]),
                }))}
              />
            )}
          </Section>

          <Section
            title="created_at"
            right={
              <button className="btn" disabled={!ready} onClick={scanTimeline}>
                scan
              </button>
            }
          >
            {timeline && timeline.days.length > 0 && (
              <>
                <Bars
                  values={timeline.days}
                  height={90}
                  format={(n) => fmtNum(Math.round(n)) + "/day"}
                />
                <div className="histogram-axis">
                  <span>
                    {new Date(timeline.start * 86400000).toLocaleDateString()}
                  </span>
                  <span>
                    {new Date(
                      (timeline.start + timeline.days.length - 1) * 86400000,
                    ).toLocaleDateString()}
                  </span>
                </div>
              </>
            )}
          </Section>

          <Section
            title={`index cache · ${cache?.count ?? 0} / ${cache?.max ?? 0}`}
            right={
              <button
                className="btn"
                onClick={() => setCacheView((v) => v + 1)}
              >
                refresh
              </button>
            }
          >
            <div className="cache-list">
              {cacheIndexes.map((index, i) => (
                <div
                  key={i}
                  className="cache-row clickable"
                  onClick={() =>
                    openQuery([
                      index.type === "kind"
                        ? { kinds: [index.key], limit: 500 }
                        : index.type === "pubkey"
                          ? { authors: [index.key], limit: 500 }
                          : tagFilter(
                              String(index.key)[0],
                              String(index.key).slice(1),
                              500,
                            ),
                    ])
                  }
                >
                  <span className={`cache-type ${index.type}`}>
                    {index.type}
                  </span>
                  <span className="mono">
                    {index.type === "kind" ? (
                      <KindBadge kind={index.key} />
                    ) : index.type === "pubkey" ? (
                      <Pubkey pubkey={index.key} />
                    ) : (
                      shortHex(String(index.key), 20)
                    )}
                  </span>
                  <span className="cache-size">{fmtNum(index.size)}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
