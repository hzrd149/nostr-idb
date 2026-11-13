import type { Filter, NostrEvent } from "../../src/index.ts";
import { begin, record } from "./activity.ts";

export type ImportMode = "snapshot" | "backfill" | "live";

export type RelayRun = {
  url: string;
  status: "connecting" | "open" | "eose" | "done" | "closed" | "error";
  received: number;
  duplicates: number;
  pages: number;
  oldest?: number;
  connectMs?: number;
  firstEoseMs?: number;
  error?: string;
};

export type ImportOptions = {
  mode: ImportMode;
  /** stop backfilling a relay after this many events */
  maxPerRelay: number;
};

/** Imports events from a set of relays */
export class ImportSession {
  runs: RelayRun[];
  seen = new Set<string>();
  running = true;
  private sockets: WebSocket[] = [];

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
    this.runs.forEach((run) => this.connect(run));
  }

  get total() {
    return this.seen.size;
  }

  private connect(run: RelayRun) {
    const finishConnect = begin("import", `connect ${run.url}`);
    const t0 = performance.now();
    let ws: WebSocket;
    try {
      ws = new WebSocket(run.url);
    } catch (e) {
      run.status = "error";
      run.error = String(e);
      finishConnect("error", run.error);
      this.checkDone();
      return;
    }
    this.sockets.push(ws);

    let subId = "";
    let page = 0;
    let pageCount = 0;
    let pageOldest = Infinity;
    let reqStart = 0;
    let finishPage: ReturnType<typeof begin> | null = null;

    const req = (until?: number) => {
      subId = "imp" + page;
      pageCount = 0;
      pageOldest = Infinity;
      reqStart = performance.now();
      const filters =
        until === undefined
          ? this.filters
          : this.filters.map((f) => ({
              ...f,
              until: f.until !== undefined ? Math.min(f.until, until) : until,
            }));
      finishPage = begin(
        "import",
        `REQ ${run.url} page ${page + 1}`,
        until ? `until ${until}` : undefined,
      );
      ws.send(JSON.stringify(["REQ", subId, ...filters]));
    };

    ws.onopen = () => {
      run.status = "open";
      run.connectMs = performance.now() - t0;
      finishConnect("ok");
      req();
      this.onUpdate();
    };

    ws.onmessage = (msg) => {
      let data: unknown;
      try {
        data = JSON.parse(msg.data as string);
      } catch {
        return;
      }
      if (!Array.isArray(data)) return;
      const [type, sid] = data;

      if (type === "EVENT" && sid === subId) {
        const event = data[2] as NostrEvent;
        run.received++;
        pageCount++;
        if (event.created_at < pageOldest) pageOldest = event.created_at;
        if (run.oldest === undefined || event.created_at < run.oldest)
          run.oldest = event.created_at;
        if (this.seen.has(event.id)) {
          run.duplicates++;
        } else {
          this.seen.add(event.id);
          this.onEvent(event, run.url);
        }
      } else if (type === "EOSE" && sid === subId) {
        page++;
        run.pages = page;
        if (run.firstEoseMs === undefined)
          run.firstEoseMs = performance.now() - reqStart;
        finishPage?.("ok", `${pageCount} events`);
        finishPage = null;

        const mode = this.options.mode;
        if (mode === "live") {
          run.status = "eose";
        } else if (
          mode === "backfill" &&
          pageCount > 0 &&
          run.received < this.options.maxPerRelay &&
          this.running
        ) {
          ws.send(JSON.stringify(["CLOSE", subId]));
          req(pageOldest - 1);
        } else {
          run.status = "done";
          ws.close();
          this.checkDone();
        }
        this.onUpdate();
      } else if (type === "CLOSED" && sid === subId) {
        finishPage?.("error", String(data[2] ?? "closed"));
        finishPage = null;
        run.status = "error";
        run.error = String(data[2] ?? "CLOSED");
        ws.close();
        this.checkDone();
      } else if (type === "NOTICE") {
        record("import", `NOTICE ${run.url}`, 0, String(data[1]));
      }
    };

    ws.onerror = () => {
      if (run.status === "connecting") finishConnect("error", "failed");
      run.status = "error";
      run.error = "websocket error";
      this.onUpdate();
    };

    ws.onclose = () => {
      finishPage?.("error", "socket closed");
      finishPage = null;
      if (run.status !== "done" && run.status !== "error")
        run.status = "closed";
      this.checkDone();
    };
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
    for (const ws of this.sockets) ws.close();
    for (const run of this.runs)
      if (run.status !== "done" && run.status !== "error")
        run.status = "closed";
    this.onUpdate();
    this.onFinish();
  }
}
