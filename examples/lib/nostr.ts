import type { Filter, NostrIDB, StoredEvent } from "../../src/index.ts";

export const KIND_NAMES: Record<number, string> = {
  0: "profile",
  1: "note",
  3: "contacts",
  4: "dm",
  5: "delete",
  6: "repost",
  7: "reaction",
  16: "repost",
  1111: "comment",
  1984: "report",
  9735: "zap",
  10000: "mutes",
  10002: "relays",
  30023: "article",
  30078: "app data",
};

export function kindName(kind: number) {
  return KIND_NAMES[kind] ?? "";
}

export function kindColor(kind: number) {
  const hue = (kind * 137.508) % 360;
  return `hsl(${hue} 70% 65%)`;
}

export function pubkeyColor(pubkey: string) {
  const hue = parseInt(pubkey.slice(0, 4), 16) % 360;
  return `hsl(${hue} 65% 60%)`;
}

export function shortHex(hex: string, n = 8) {
  return hex.length > n ? hex.slice(0, n) : hex;
}

export function fmtMs(ms: number | undefined) {
  if (ms === undefined) return "…";
  if (ms < 1) return ms.toFixed(2) + "ms";
  if (ms < 100) return ms.toFixed(1) + "ms";
  if (ms < 10_000) return Math.round(ms) + "ms";
  return (ms / 1000).toFixed(1) + "s";
}

export function fmtNum(n: number) {
  return n.toLocaleString();
}

export function fmtBytes(n?: number) {
  if (n === undefined) return "?";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return n.toFixed(i ? 1 : 0) + units[i];
}

export function reltime(ts: number) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 0) return "future";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 365) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 86400 / 365)}y`;
}

export function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    avg: values.length ? total / values.length : 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    total,
  };
}

/** Parse a JSON string into an array of filters */
export function parseFilters(text: string): Filter[] {
  const parsed = JSON.parse(text);
  const filters = Array.isArray(parsed) ? parsed : [parsed];
  for (const f of filters) {
    if (typeof f !== "object" || f === null || Array.isArray(f))
      throw new Error("Filters must be objects");
  }
  return filters as Filter[];
}

/** Parse pasted events: JSON array, single object, or JSON lines */
export function parseEvents(text: string): StoredEvent[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const v = JSON.parse(l);
        // accept relay messages ["EVENT", sub, event]
        return Array.isArray(v) ? v[v.length - 1] : v;
      });
  }
}

export function filterSummary(filters: Filter[]) {
  return filters
    .map((f) =>
      Object.entries(f)
        .map(([k, v]) =>
          Array.isArray(v)
            ? `${k}:${v.length > 2 ? v.length + "×" : v.map((x) => shortHex(String(x), 8)).join(",")}`
            : `${k}:${v}`,
        )
        .join(" "),
    )
    .join(" | ");
}

/**
 * Opens a subscription using the public NostrIDB.subscribe() async generator
 * and returns a function that closes it.
 */
export function openSubscription(
  nostr: NostrIDB,
  filters: Filter[],
  onEvent: (event: StoredEvent) => void,
) {
  const before = new Set(nostr.subscriptions.keys());
  const iterator = nostr.subscribe(filters);
  let closed = false;

  // the generator body (and the internal subscription) starts on the first next()
  const pump = async () => {
    for (;;) {
      const r = await iterator.next();
      if (r.done || closed) return;
      onEvent(r.value);
    }
  };
  pump();
  const id = [...nostr.subscriptions.keys()].find((k) => !before.has(k));

  return () => {
    closed = true;
    // closing the internal subscription completes the generator
    if (id) nostr.subscriptions.get(id)?.close();
  };
}
