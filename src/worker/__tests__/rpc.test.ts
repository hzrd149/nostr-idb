import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEvent } from "../../__tests__/helpers.js";
import { openDB } from "../../database/database.js";
import type { NostrEvent } from "../../lib/nostr.js";
import { NostrIDB } from "../../nostrdb/nostrdb.js";
import { NostrIDBClient } from "../client.js";
import { serveNostrIDB, serverMetadata } from "../server.js";

type Meta = { relays: string[] };
const metaSymbol = Symbol("test-meta");
type MetaEvent = NostrEvent & { [metaSymbol]?: Meta };

describe("NostrIDBClient over a MessageChannel", () => {
  let nostr: NostrIDB<MetaEvent, Meta>;
  let client: NostrIDBClient<MetaEvent, Meta>;
  let stopServer: () => void;
  let channel: MessageChannel;

  beforeEach(async () => {
    const db = await openDB("test-rpc-" + Date.now() + Math.random());
    nostr = new NostrIDB<MetaEvent, Meta>(db, {
      writeInterval: 10,
      pruneInterval: 100_000,
      metadata: serverMetadata,
    });
    channel = new MessageChannel();
    // the client connects before the server is listening
    client = new NostrIDBClient<MetaEvent, Meta>(channel.port1, {
      metadata: {
        read: (e) => e[metaSymbol],
        attach(e, m) {
          if (m === undefined) delete e[metaSymbol];
          else e[metaSymbol] = m;
        },
      },
    });
    stopServer = serveNostrIDB(channel.port2, nostr);
    await client.ready;
  });

  /** Write queued events so event() and replaceable() can read them */
  async function flush() {
    await nostr.stop();
    await nostr.start();
  }

  afterEach(async () => {
    client.close();
    stopServer();
    channel.port1.close();
    channel.port2.close();
    await nostr.stop();
  });

  it("adds, queries, counts and deletes events", async () => {
    const a = createTestEvent({ kind: 1 });
    const b = createTestEvent({ kind: 7 });
    expect(await client.add(a)).toBe(true);
    expect(await client.add(b)).toBe(true);
    await flush();

    expect((await client.query({ kinds: [1] })).map((e) => e.id)).toEqual([
      a.id,
    ]);
    expect((await client.event(b.id))?.id).toBe(b.id);
    expect(await client.count({ kinds: [1, 7] })).toBe(2);
    expect(await client.supports()).toEqual(await nostr.supports());

    expect(await client.deleteEvent(a.id)).toBe(true);
    expect(await client.event(a.id)).toBeUndefined();
  });

  it("returns replaceable events", async () => {
    const profile = createTestEvent({ kind: 0 });
    await client.add(profile);
    await flush();
    expect((await client.replaceable(0, profile.pubkey))?.id).toBe(profile.id);
  });

  it("carries metadata both ways", async () => {
    const explicit = createTestEvent({ kind: 1 }) as MetaEvent;
    await client.add(explicit, { relays: ["wss://a"] });

    const extracted = createTestEvent({ kind: 1 }) as MetaEvent;
    extracted[metaSymbol] = { relays: ["wss://b"] };
    await client.add(extracted);
    await flush();

    const read = await client.event(explicit.id);
    expect(read?.[metaSymbol]).toEqual({ relays: ["wss://a"] });

    const all = await client.query({ kinds: [1] });
    const byId = new Map(all.map((e) => [e.id, e[metaSymbol]]));
    expect(byId.get(extracted.id)).toEqual({ relays: ["wss://b"] });

    await client.setMetadata(explicit.id, { relays: ["wss://c"] });
    expect((await client.event(explicit.id))?.[metaSymbol]).toEqual({
      relays: ["wss://c"],
    });
    await client.clearMetadata(explicit.id);
    expect((await client.event(explicit.id))?.[metaSymbol]).toBeUndefined();
  });

  it("pages through results and continues from a cursor", async () => {
    for (let i = 0; i < 5; i++)
      await client.add(createTestEvent({ kind: 1, created_at: 1000 + i }));
    await flush();

    const first = await client.queryPage({ kinds: [1] }, { pageSize: 2 });
    expect(first.events.map((e) => e.created_at)).toEqual([1004, 1003]);
    const rest = await client.queryPage(
      { kinds: [1] },
      { pageSize: 10, cursor: first.nextCursor },
    );
    expect(rest.events.map((e) => e.created_at)).toEqual([1002, 1001, 1000]);

    const pages = [];
    for await (const page of client.pages({ kinds: [1] }, { pageSize: 2 }))
      pages.push(page.events.length);
    expect(pages.reduce((a, b) => a + b, 0)).toBe(5);

    const times = [];
    for await (const e of client.iterate({ kinds: [1] }, { pageSize: 2 }))
      times.push(e.created_at);
    expect(times).toEqual([1004, 1003, 1002, 1001, 1000]);
  });

  it("stops a page stream early", async () => {
    for (let i = 0; i < 6; i++) await client.add(createTestEvent({ kind: 1 }));
    await flush();
    let seen = 0;
    for await (const _ of client.iterate({ kinds: [1] }, { pageSize: 2 })) {
      if (++seen === 3) break;
    }
    expect(seen).toBe(3);
    // the client still works after cancelling
    expect(await client.count({ kinds: [1] })).toBe(6);
  });

  it("rejects with server errors", async () => {
    await expect(
      client.queryPage({ kinds: [1], limit: 2 }, { pageSize: 2 }),
    ).rejects.toThrow("Pagination uses pageSize, not filter.limit");

    const pages = client.pages({ kinds: [1], limit: 2 });
    await expect(pages.next()).rejects.toThrow("pageSize");
  });

  it("aborts page traversal with a signal", async () => {
    for (let i = 0; i < 4; i++) await client.add(createTestEvent({ kind: 1 }));
    await flush();
    const controller = new AbortController();
    const iter = client.iterate(
      { kinds: [1] },
      { pageSize: 1, signal: controller.signal },
    );
    await iter.next();
    controller.abort();
    await expect(iter.next()).rejects.toThrow();
  });

  it("streams stored and live events to subscriptions", async () => {
    const stored = createTestEvent({ kind: 1 });
    await client.add(stored);

    const controller = new AbortController();
    const received: string[] = [];
    const done = (async () => {
      for await (const e of client.subscribe(
        { kinds: [1] },
        { signal: controller.signal },
      ))
        received.push(e.id);
    })();

    await expect.poll(() => received).toEqual([stored.id]);
    const live = createTestEvent({ kind: 1 });
    await client.add(live);
    await expect.poll(() => received).toEqual([stored.id, live.id]);

    // aborting ends an idle subscription and closes it on the server
    controller.abort();
    await done;
    await expect.poll(() => nostr.subscriptions.size).toBe(0);
  });

  it("rejects pending calls when closed", async () => {
    const pending = client.query({ kinds: [1] });
    client.close();
    await expect(pending).rejects.toThrow("closed");
    await expect(client.count({})).rejects.toThrow("closed");
  });

  it("cancels idle subscriptions when the client closes", async () => {
    const subscription = client.subscribe({ kinds: [1] });
    const next = subscription.next();
    const rejected = expect(next).rejects.toThrow("closed");
    await expect.poll(() => nostr.subscriptions.size).toBe(1);
    client.close();
    await rejected;
    await expect.poll(() => nostr.subscriptions.size).toBe(0);
  });

  it("cancels page streams suspended at a yield when the client closes", async () => {
    let returned = false;
    vi.spyOn(nostr, "pages").mockImplementation(async function* () {
      try {
        yield { events: [], done: false, scanned: 0 };
      } finally {
        returned = true;
      }
    });
    const pages = client.pages();
    await pages.next();
    client.close();
    await expect.poll(() => returned).toBe(true);
    await pages.return();
  });

  it("aborts an outstanding queryPage on both sides", async () => {
    let serverSignal: AbortSignal | undefined;
    vi.spyOn(nostr, "queryPage").mockImplementation((_filters, options) => {
      serverSignal = options!.signal!;
      return new Promise((_resolve, reject) => {
        serverSignal!.addEventListener(
          "abort",
          () => reject(serverSignal!.reason),
          { once: true },
        );
      });
    });
    const controller = new AbortController();
    const result = client.queryPage({}, { signal: controller.signal });
    const rejected = expect(result).rejects.toThrow("cancel query");
    await expect.poll(() => !!serverSignal).toBe(true);
    controller.abort(new Error("cancel query"));
    await rejected;
    await expect.poll(() => serverSignal?.aborted).toBe(true);
  });

  it("aborts a pending page pull without yielding its result", async () => {
    let serverSignal: AbortSignal | undefined;
    let returned = false;
    vi.spyOn(nostr, "pages").mockImplementation(
      async function* (_filters, options) {
        serverSignal = options!.signal!;
        try {
          await new Promise<void>((resolve) => {
            serverSignal!.addEventListener("abort", () => resolve(), {
              once: true,
            });
          });
          yield { events: [], done: false, scanned: 0 };
        } finally {
          returned = true;
        }
      },
    );
    const controller = new AbortController();
    const pages = client.pages({}, { signal: controller.signal });
    const rejected = expect(pages.next()).rejects.toThrow("cancel page");
    await expect.poll(() => !!serverSignal).toBe(true);
    controller.abort(new Error("cancel page"));
    await rejected;
    await expect.poll(() => returned).toBe(true);
  });

  it("fails and cancels a subscription when metadata attachment throws", async () => {
    client.close();
    client = new NostrIDBClient(channel.port1, {
      metadata: {
        attach() {
          throw new Error("attachment failed");
        },
      },
    });
    const subscription = client.subscribe({ kinds: [1] });
    const rejected = expect(subscription.next()).rejects.toThrow(
      "attachment failed",
    );
    await expect.poll(() => nostr.subscriptions.size).toBe(1);
    await client.add(createTestEvent({ kind: 1 }), { relays: ["wss://a"] });
    await rejected;
    await expect.poll(() => nostr.subscriptions.size).toBe(0);
    expect(await client.supports()).toEqual([]);
  });

  it("honors aborts while waiting for the server to become ready", async () => {
    const isolated = new MessageChannel();
    const waiting = new NostrIDBClient(isolated.port1);
    const controller = new AbortController();
    try {
      const options = { signal: controller.signal };
      const subscription = waiting.subscribe({}, options).next();
      const page = expect(waiting.queryPage({}, options)).rejects.toThrow(
        "not ready",
      );
      const pages = expect(waiting.pages({}, options).next()).rejects.toThrow(
        "not ready",
      );
      controller.abort(new Error("not ready"));
      expect(await subscription).toEqual({ done: true, value: undefined });
      await Promise.all([page, pages]);
    } finally {
      waiting.close();
      isolated.port1.close();
      isolated.port2.close();
    }
  });
});

describe("NostrIDB.subscribe signal", () => {
  it("ends an idle subscription when aborted", async () => {
    const nostr = new NostrIDB(await openDB("test-sub-signal-" + Date.now()));
    const controller = new AbortController();
    const done = (async () => {
      const seen = [];
      for await (const e of nostr.subscribe(
        { kinds: [1] },
        { signal: controller.signal },
      ))
        seen.push(e);
      return seen;
    })();
    await expect.poll(() => nostr.subscriptions.size).toBe(1);
    controller.abort();
    expect(await done).toEqual([]);
    expect(nostr.subscriptions.size).toBe(0);
    await nostr.stop();
  });
});

describe("NostrIDBClient with a Worker", () => {
  it("talks to a database served from a dedicated worker", async () => {
    const worker = new Worker(new URL("./fixture-worker.ts", import.meta.url), {
      type: "module",
    });
    const client = new NostrIDBClient(worker);
    try {
      const event = createTestEvent({ kind: 1 });
      expect(await client.add(event)).toBe(true);
      // the worker's write queue flushes on its own interval
      await expect
        .poll(async () => (await client.event(event.id))?.id)
        .toBe(event.id);
      expect(await client.count({ kinds: [1] })).toBe(1);
    } finally {
      client.close();
      worker.terminate();
    }
  });
});
