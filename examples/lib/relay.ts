import type { Subscription } from "rxjs";
import type { Filter, NostrEvent } from "../../src/index.ts";
import { begin } from "./activity.ts";
import { pool } from "./pool.ts";

export type ImportMode = "snapshot" | "backfill" | "live";

export type RelayRun = {
  url: string;
  status: "connecting" | "open" | "eose" | "done" | "closed" | "error";
  received: number;
  duplicates: number;
  pages: number;
  oldest?: number;
  /** time until the REQ was on the wire (near zero when the pool reuses a socket) */
  connectMs?: number;
  firstEoseMs?: number;
  error?: string;
};

export type ImportOptions = {
  mode: ImportMode;
  /** stop backfilling a relay after this many events */
  maxPerRelay: number;
};

/** Imports events from a set of relays through the shared applesauce RelayPool */
export class ImportSession {
  runs: RelayRun[];
  seen = new Set<string>();
  running = true;
  private subs = new Map<string, Subscription>();

  constructor(
    urls: string[],
    private filters: Filter[],
    private options: ImportOptions,
    private onEvent: (event: NostrEvent, relay: string) => void,
    private onUpdate: () => void,
    private onFinish: () => void,
  ) {
    this.runs = urls.map((url) => ({
      url,
      status: "connecting",
      received: 0,
      duplicates: 0,
      pages: 0,
    }));
    const t0 = performance.now();
    this.runs.forEach((run) => this.page(run, t0));
  }

  get total() {
    return this.seen.size;
  }

  /** Request one page of events from a relay */
  private page(run: RelayRun, t0: number, until?: number) {
    const relay = pool.relay(run.url);
    const filters =
      until === undefined
        ? this.filters
        : this.filters.map((f) => ({
            ...f,
            until: f.until !== undefined ? Math.min(f.until, until) : until,
          }));
    const finish = begin(
      "import",
      `REQ ${run.url} page ${run.pages + 1}`,
      until ? `until ${until}` : undefined,
    );
    const reqStart = performance.now();
    let count = 0;
    let oldest = Infinity;
    let settled = false;

    const sub = relay.req(filters as never).subscribe({
      next: (message) => {
        if (message.type === "OPEN") {
          if (run.connectMs === undefined)
            run.connectMs = performance.now() - t0;
          run.status = "open";
        } else if (message.type === "EVENT") {
          const event = message.event as NostrEvent;
          run.received++;
          count++;
          if (event.created_at < oldest) oldest = event.created_at;
          if (run.oldest === undefined || event.created_at < run.oldest)
            run.oldest = event.created_at;
          if (this.seen.has(event.id)) run.duplicates++;
          else {
            this.seen.add(event.id);
            this.onEvent(event, run.url);
          }
        } else if (message.type === "EOSE") {
          settled = true;
          run.pages++;
          run.firstEoseMs ??= performance.now() - reqStart;
          finish("ok", `${count} events`);
          const mode = this.options.mode;
          if (mode === "live") {
            run.status = "eose";
          } else {
            // closing the subscription sends CLOSE on the pooled socket
            this.subs.get(run.url)?.unsubscribe();
            if (
              mode === "backfill" &&
              count > 0 &&
              run.received < this.options.maxPerRelay &&
              this.running
            )
              return this.page(run, t0, oldest - 1);
            run.status = "done";
            this.checkDone();
          }
          this.onUpdate();
        } else if (message.type === "CLOSED") {
          this.fail(run, String(message.reason ?? "closed"));
          if (!settled) finish("error", run.error);
        }
      },
      error: (err) => {
        this.fail(run, err instanceof Error ? err.message : String(err));
        if (!settled) finish("error", run.error);
      },
    });
    this.subs.set(run.url, sub);
  }

  private fail(run: RelayRun, error: string) {
    run.status = "error";
    run.error = error;
    this.subs.get(run.url)?.unsubscribe();
    this.checkDone();
  }

  private checkDone() {
    this.onUpdate();
    if (
      this.running &&
      this.runs.every((r) => ["done", "closed", "error"].includes(r.status))
    ) {
      this.running = false;
      this.onFinish();
    }
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    for (const sub of this.subs.values()) sub.unsubscribe();
    for (const run of this.runs)
      if (run.status !== "done" && run.status !== "error")
        run.status = "closed";
    this.onUpdate();
    this.onFinish();
  }
}
