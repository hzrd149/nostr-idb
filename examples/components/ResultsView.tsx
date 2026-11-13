import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Inbox, X } from "lucide-react";
import { getEventUID, type StoredEvent } from "../../src/index.ts";
import { track } from "../lib/activity.ts";
import { useApp } from "../lib/app.ts";
import { manager, useDB } from "../lib/db.ts";
import {
  kindColor,
  kindName,
  pubkeyColor,
  reltime,
  shortHex,
} from "../lib/nostr.ts";
import { ConfirmButton, Segmented } from "./ui.tsx";

const ROW_HEIGHT = 36;

export function KindBadge({ kind }: { kind: number }) {
  return (
    <span className="kind-badge" style={{ color: kindColor(kind) }}>
      {kind}
      <span className="kind-name">{kindName(kind)}</span>
    </span>
  );
}

export function Pubkey({ pubkey, n = 8 }: { pubkey: string; n?: number }) {
  return (
    <span className="pubkey">
      <i style={{ background: pubkeyColor(pubkey) }} />
      {shortHex(pubkey, n)}
    </span>
  );
}

type Sort = "newest" | "oldest" | "kind";

export function ResultsView({
  events,
  header,
  onDeleted,
  empty,
}: {
  events: StoredEvent[];
  header?: ReactNode;
  onDeleted?: (uid: string) => void;
  empty?: ReactNode;
}) {
  const [selected, setSelected] = useState<StoredEvent | null>(null);
  const [sort, setSort] = useState<Sort>("newest");
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => {
    let list = events;
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.content.toLowerCase().includes(s) ||
          e.pubkey.startsWith(s) ||
          e.id.startsWith(s),
      );
    }
    const sorted = [...list];
    if (sort === "newest") sorted.sort((a, b) => b.created_at - a.created_at);
    else if (sort === "oldest")
      sorted.sort((a, b) => a.created_at - b.created_at);
    else sorted.sort((a, b) => a.kind - b.kind || b.created_at - a.created_at);
    return sorted;
  }, [events, sort, search]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
  const last = Math.min(
    rows.length,
    Math.ceil((scrollTop + height) / ROW_HEIGHT) + 10,
  );

  // keyboard navigation
  function onKeyDown(e: React.KeyboardEvent) {
    if (!rows.length) return;
    const idx = selected ? rows.indexOf(selected) : -1;
    let next = idx;
    if (e.key === "ArrowDown" || e.key === "j") next = idx + 1;
    else if (e.key === "ArrowUp" || e.key === "k") next = idx - 1;
    else if (e.key === "Escape") return setSelected(null);
    else return;
    e.preventDefault();
    next = Math.max(0, Math.min(rows.length - 1, next));
    setSelected(rows[next]);
    const el = scrollRef.current;
    if (el) {
      const y = next * ROW_HEIGHT;
      if (y < el.scrollTop) el.scrollTop = y;
      else if (y + ROW_HEIGHT > el.scrollTop + el.clientHeight)
        el.scrollTop = y + ROW_HEIGHT - el.clientHeight;
    }
  }

  return (
    <div className="results">
      <div className="results-main">
        <div className="results-head">
          <div className="results-title">{header}</div>
          <input
            className="results-search"
            placeholder="filter shown…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            <option value="newest">newest</option>
            <option value="oldest">oldest</option>
            <option value="kind">kind</option>
          </select>
        </div>
        <div
          className="results-scroll"
          ref={scrollRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          {rows.length === 0 ? (
            <div className="results-empty">{empty ?? <Inbox size={32} />}</div>
          ) : (
            <div
              style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}
            >
              {rows.slice(first, last).map((e, i) => (
                <div
                  key={e.id}
                  className={`row ${selected === e ? "selected" : ""}`}
                  style={{ top: (first + i) * ROW_HEIGHT, height: ROW_HEIGHT }}
                  onClick={() => setSelected(selected === e ? null : e)}
                >
                  <KindBadge kind={e.kind} />
                  <Pubkey pubkey={e.pubkey} n={6} />
                  <span className="row-content">
                    {e.content.slice(0, 200).replace(/\s+/g, " ") || (
                      <span className="muted">
                        {e.tags
                          .slice(0, 4)
                          .map((t) => `${t[0]} ${shortHex(t[1] ?? "", 8)}`)
                          .join(" ")}
                      </span>
                    )}
                  </span>
                  <span
                    className="row-time"
                    title={new Date(e.created_at * 1000).toISOString()}
                  >
                    {reltime(e.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {selected && (
        <EventDetail
          event={selected}
          onClose={() => setSelected(null)}
          onDeleted={(uid) => {
            setSelected(null);
            onDeleted?.(uid);
          }}
        />
      )}
    </div>
  );
}

function EventDetail({
  event,
  onClose,
  onDeleted,
}: {
  event: StoredEvent;
  onClose: () => void;
  onDeleted: (uid: string) => void;
}) {
  const { openQuery } = useApp();
  const { db, nostr } = useDB();
  const uid = getEventUID(event);
  const [stored, setStored] = useState<{
    tags?: string[];
    used?: number;
    inMemory: boolean;
    missing?: boolean;
  } | null>(null);
  const [view, setView] = useState<"fields" | "json">("fields");

  useEffect(() => {
    if (!db || !nostr) return;
    let cancel = false;
    Promise.all([db.get("events", uid), db.get("used", uid)]).then(
      ([row, used]) => {
        if (cancel) return;
        setStored({
          tags: row?.tags,
          used: used?.date,
          inMemory: nostr.eventMap.has(uid),
          missing: !row,
        });
      },
    );
    return () => {
      cancel = true;
    };
  }, [db, nostr, uid]);

  const q = (filter: object) => openQuery([{ ...filter, limit: 200 }]);

  return (
    <aside className="detail">
      <div className="detail-head">
        <KindBadge kind={event.kind} />
        <span style={{ flex: 1 }} />
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "fields", label: "fields" },
            { value: "json", label: "JSON" },
          ]}
        />
        <button
          className="btn"
          onClick={() => navigator.clipboard.writeText(JSON.stringify(event))}
        >
          copy
        </button>
        <button className="icon" title="close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      {view === "json" ? (
        <pre className="detail-json">{JSON.stringify(event, null, 2)}</pre>
      ) : (
        <div className="detail-body">
          <dl className="fields">
            <dt>id</dt>
            <dd
              className="mono clickable"
              onClick={() => q({ ids: [event.id] })}
            >
              {event.id}
            </dd>
            {uid !== event.id && (
              <>
                <dt>uid</dt>
                <dd className="mono">{uid}</dd>
              </>
            )}
            <dt>pubkey</dt>
            <dd
              className="mono clickable"
              onClick={() => q({ authors: [event.pubkey] })}
            >
              <Pubkey pubkey={event.pubkey} n={64} />
            </dd>
            <dt>kind</dt>
            <dd
              className="clickable"
              onClick={() => q({ kinds: [event.kind] })}
            >
              <KindBadge kind={event.kind} />
            </dd>
            <dt>created</dt>
            <dd
              className="mono clickable"
              onClick={() =>
                q({ until: event.created_at, since: event.created_at - 3600 })
              }
            >
              {new Date(event.created_at * 1000).toLocaleString()}{" "}
              <span className="muted">{event.created_at}</span>
            </dd>
          </dl>

          {event.tags.length > 0 && (
            <table className="tags-table">
              <tbody>
                {event.tags.slice(0, 200).map((t, i) => {
                  const indexable = t[0]?.length === 1 && t[1] !== undefined;
                  return (
                    <tr
                      key={i}
                      className={indexable ? "clickable" : ""}
                      onClick={() => indexable && q({ [`#${t[0]}`]: [t[1]] })}
                    >
                      <td className="tag-name">{t[0]}</td>
                      <td className="mono">{t.slice(1).join(" · ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {event.content && <pre className="content">{event.content}</pre>}

          <div className="stored">
            <div className="stored-title">IndexedDB record</div>
            {stored === null ? (
              <span className="spinner" />
            ) : stored.missing ? (
              <span className="bad">not stored</span>
            ) : (
              <>
                <div className="stored-flags">
                  <span className={stored.inMemory ? "on" : ""}>eventMap</span>
                  <span className={stored.used ? "on" : ""}>
                    used {stored.used ? reltime(stored.used) + " ago" : "never"}
                  </span>
                </div>
                <div className="stored-tags">
                  {stored.tags?.map((t) => (
                    <code key={t}>
                      {t.length > 24 ? t.slice(0, 24) + "…" : t}
                    </code>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="detail-actions">
        <button className="btn" onClick={() => q({ authors: [event.pubkey] })}>
          author
        </button>
        <button className="btn" onClick={() => q({ "#e": [event.id] })}>
          #e refs
        </button>
        <button
          className="btn"
          onClick={() => q({ kinds: [event.kind], authors: [event.pubkey] })}
        >
          kind+author
        </button>
        <ConfirmButton
          onConfirm={async () => {
            await track(
              "delete",
              `deleteEvent(${shortHex(uid, 12)})`,
              () => manager.nostr.deleteEvent(uid),
              (ok) => (ok ? "deleted" : "not found"),
            );
            onDeleted(uid);
          }}
        >
          delete
        </ConfirmButton>
      </div>
    </aside>
  );
}
