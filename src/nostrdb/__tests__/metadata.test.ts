import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NostrIDB } from "../nostrdb.js";
import { openDB, deleteDB } from "../../database/database.js";
import { addEvents } from "../../database/insert.js";
import { getEventUID } from "../../database/common.js";
import { getReplaceableEvents } from "../../database/query-misc.js";
import { getEventsForFilter } from "../../database/query-filter.js";
import { setEventMetadata } from "../../database/metadata.js";
import type { NostrIDBDatabase } from "../../database/schema.js";
import type { NostrEvent } from "../../lib/nostr.js";
import { createTestEvent } from "../../__tests__/helpers.js";

const sidecar = Symbol("test-sidecar");
type Metadata = { relays?: string[]; verified?: boolean };
type Event = NostrEvent & { [sidecar]?: Metadata };
const hooks = {
  read: (event: Event) => event[sidecar],
  attach: (event: Event, metadata: Metadata | undefined) => {
    if (metadata === undefined) delete event[sidecar];
    else event[sidecar] = metadata;
  },
};

describe("event sidecar metadata", () => {
  let database: NostrIDBDatabase;
  let db: NostrIDB<Event, Metadata>;
  let name: string;

  beforeEach(async () => {
    name = "test-metadata-" + Date.now() + Math.random();
    database = await openDB(name);
    db = new NostrIDB<Event, Metadata>(database, {
      metadata: hooks,
      writeInterval: 100000,
      pruneInterval: 100000,
    });
    // Let the constructor's initial flush finish, then control flushing explicitly.
    await db.writeQueue!.flush();
    await db.stop();
  });

  afterEach(async () => {
    await db.stop();
    database.close();
    await deleteDB(name);
  });

  const event = (kind = 1, created_at = 100): Event =>
    createTestEvent({ kind, created_at });
  const flush = () => db.writeQueue!.flush();

  it("extracts symbols, snapshots before awaiting, and restores after reopening", async () => {
    const input = event();
    input[sidecar] = { relays: ["wss://one"], verified: true };
    const adding = db.add(input);
    input[sidecar].relays!.push("wss://later");
    await adding;
    await flush();
    expect((await database.get("events", input.id))?.metadata).toEqual({
      relays: ["wss://one"],
      verified: true,
    });
    database.close();
    database = await openDB(name);
    db = new NostrIDB(database, { metadata: hooks, writeInterval: 100000 });
    await db.writeQueue!.flush();
    await db.stop();
    expect((await db.event(input.id))?.[sidecar]).toEqual({
      relays: ["wss://one"],
      verified: true,
    });
    expect((await db.query({ ids: [input.id] }))[0][sidecar]).toEqual({
      relays: ["wss://one"],
      verified: true,
    });
  });

  it("explicit metadata wins, is snapshotted, and replaces rather than merges", async () => {
    const input = event();
    input[sidecar] = { verified: true };
    const metadata = { relays: ["wss://explicit"] };
    const adding = db.add(input, metadata);
    metadata.relays.push("wss://later");
    await adding;
    expect((await db.query({ kinds: [1] }))[0][sidecar]).toEqual({
      relays: ["wss://explicit"],
    });
    await flush();
    await db.add({ ...input }, { verified: false });
    await flush();
    expect((await db.event(input.id))?.[sidecar]).toEqual({ verified: false });
  });

  it("preserves missing metadata on duplicate pending and persisted events", async () => {
    const input = event();
    await db.add(input, { verified: true });
    const plain = structuredClone(input);
    await db.add(plain);
    expect((await db.query({ kinds: [1] }))[0][sidecar]).toEqual({
      verified: true,
    });
    await flush();
    await db.add(structuredClone(input));
    await flush();
    expect((await db.event(input.id))?.[sidecar]).toEqual({ verified: true });
  });

  it("explicit undefined suppresses extraction but preserves existing metadata", async () => {
    const input = event();
    await db.add(input, { verified: true });
    await flush();
    input[sidecar] = { verified: false };
    await db.add(input, undefined);
    await flush();
    expect((await db.event(input.id))?.[sidecar]).toEqual({ verified: true });
  });

  it("updates and clears pending metadata, including retained cached objects", async () => {
    const input = event();
    await db.add(input, { verified: true });
    const cached = (await db.query({ kinds: [1] }))[0];
    expect(await db.setMetadata(input.id, { relays: ["wss://new"] })).toBe(
      true,
    );
    expect(cached[sidecar]).toEqual({ relays: ["wss://new"] });
    expect(await db.clearMetadata(input.id)).toBe(true);
    expect(cached[sidecar]).toBeUndefined();
    await flush();
    expect((await database.get("events", input.id))?.metadata).toBeUndefined();
    expect((await db.event(input.id))?.[sidecar]).toBeUndefined();
  });

  it("updates persisted metadata without emitting another subscription event", async () => {
    const input = event();
    await db.add(input, { verified: true });
    await flush();
    const iterator = db.subscribe({ ids: [input.id] });
    const first = await iterator.next();
    const emit = vi.fn();
    const sub = [...db.subscriptions.values()][0];
    const handler = sub.event!;
    sub.event = (value) => {
      emit(value);
      handler(value);
    };
    await db.setMetadata(input.id, { verified: false });
    expect(first.value?.[sidecar]).toEqual({ verified: false });
    expect((await db.event(input.id))?.[sidecar]).toEqual({ verified: false });
    await db.clearMetadata(input.id);
    expect(first.value?.[sidecar]).toBeUndefined();
    expect((await db.query({ kinds: [1] }))[0][sidecar]).toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
    await iterator.return();
  });

  it("hydrates historical subscriptions from disk and handles legacy rows", async () => {
    const input = event();
    await addEvents(
      database,
      [input],
      new Map([[input.id, { verified: true }]]),
    );
    const iterator = db.subscribe({ ids: [input.id] });
    expect((await iterator.next()).value?.[sidecar]).toEqual({
      verified: true,
    });
    await iterator.return();
    const legacy = event();
    await addEvents(database, [legacy]);
    expect((await db.event(legacy.id))?.[sidecar]).toBeUndefined();
  });

  it.each([0, 30001])(
    "isolates metadata by exact ID for replaceable kind %i",
    async (kind) => {
      const older = event(kind, 100);
      const newer = event(kind, 200);
      await db.add(older, { verified: true });
      await flush();
      await db.add(newer);
      await flush();
      expect(
        (await db.replaceable(kind, newer.pubkey))?.[sidecar],
      ).toBeUndefined();
      expect(await db.setMetadata(older.id, { verified: true })).toBe(false);
      expect(await db.setMetadata(newer.id, { verified: false })).toBe(true);
      expect((await db.event(newer.id))?.[sidecar]).toEqual({
        verified: false,
      });
      await db.add(older, { relays: ["wss://stale"] });
      await flush();
      expect((await db.query({ kinds: [kind] }))[0].id).toBe(newer.id);
      expect((await db.replaceable(kind, newer.pubkey))?.[sidecar]).toEqual({
        verified: false,
      });
      expect(await db.setMetadata(getEventUID(newer), {})).toBe(false);
    },
  );

  it("retains the newer queued replacement and accepts metadata-only re-adds", async () => {
    const older = event(0, 100);
    const newer = event(0, 200);
    await db.add(older, { verified: true });
    await db.add(newer);
    expect((await db.query({ kinds: [0] }))[0].id).toBe(newer.id);
    expect((await db.query({ kinds: [0] }))[0][sidecar]).toBeUndefined();
    await db.add(newer, { verified: false });
    await flush();
    await db.add(structuredClone(newer), { relays: ["wss://new"] });
    await flush();
    expect((await db.replaceable(0, newer.pubkey))?.[sidecar]).toEqual({
      relays: ["wss://new"],
    });
  });

  it("orders independent updates after an in-flight flush", async () => {
    const input = event();
    await db.add(input, { verified: true });
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    db.writeQueue!.processEvents = async () => {
      started();
      await gate;
    };
    const flushing = flush();
    await entered;
    const updating = db.setMetadata(input.id, { verified: false });
    release();
    await flushing;
    expect(await updating).toBe(true);
    expect((await db.event(input.id))?.[sidecar]).toEqual({ verified: false });
    expect((await db.query({ kinds: [1] }))[0][sidecar]).toEqual({
      verified: false,
    });
  });

  it("returns false for absent or deleted events and does not create orphans", async () => {
    const input = event();
    expect(await db.setMetadata(input.id, {})).toBe(false);
    expect(await db.clearMetadata(input.id)).toBe(false);
    await db.add(input, { verified: true });
    await flush();
    await db.deleteEvent(input.id);
    expect(await db.setMetadata(input.id, {})).toBe(false);
    expect(await database.count("events")).toBe(0);
  });

  it("rejects uncloneable metadata before enqueueing or changing existing data", async () => {
    const input = event();
    await expect(
      db.add(input, { callback: () => {} } as Metadata),
    ).rejects.toMatchObject({ name: "DataCloneError" });
    expect(db.writeQueue!.matchPending([{}])).toEqual([]);
    await db.add(input, { verified: true });
    await flush();
    await expect(
      db.setMetadata(input.id, { callback: () => {} } as Metadata),
    ).rejects.toMatchObject({ name: "DataCloneError" });
    expect((await db.event(input.id))?.[sidecar]).toEqual({ verified: true });
  });

  it("supports falsy sidecars and structured-clone types", async () => {
    const input = event();
    const value = { relays: new Set(["wss://one"]), time: new Date(0) };
    await addEvents(database, [input], new Map([[input.id, value]]));
    expect((await database.get("events", input.id))?.metadata).toEqual(value);
    for (const metadata of [false, 0, "", null]) {
      await setEventMetadata(database, input.id, metadata);
      await addEvents(database, [input]);
      expect((await database.get("events", input.id))?.metadata).toEqual(
        metadata,
      );
    }
  });

  it("restores sidecars through low-level readers and limited-query optimization", async () => {
    const base = event();
    const events = Array.from({ length: 140 }, (_, i) => ({
      ...base,
      id: i.toString(16).padStart(64, "0"),
      created_at: i,
    }));
    await addEvents(
      database,
      events,
      new Map(events.map((event) => [event.id, { verified: true }])),
    );
    const reader = (row: { event: NostrEvent; metadata?: unknown }) => {
      const result: Event = row.event;
      hooks.attach(result, row.metadata as Metadata | undefined);
      return result;
    };
    const limited = await getEventsForFilter(
      database,
      { kinds: [1], limit: 2 },
      undefined,
      undefined,
      reader,
    );
    expect(limited.map((event) => event.created_at)).toEqual([139, 138]);
    expect(limited.every((event) => event[sidecar]?.verified)).toBe(true);
    const replaceable = event(0);
    await addEvents(
      database,
      [replaceable],
      new Map([[replaceable.id, { verified: true }]]),
    );
    const loaded = await getReplaceableEvents(
      database,
      [{ kind: 0, pubkey: replaceable.pubkey }],
      reader,
    );
    expect(loaded[0][sidecar]).toEqual({ verified: true });
  });

  it("atomically preserves metadata on concurrent low-level duplicate writes", async () => {
    const input = event();
    await Promise.all([
      addEvents(database, [input], new Map([[input.id, { verified: true }]])),
      addEvents(database, [input]),
    ]);
    expect((await database.get("events", input.id))?.metadata).toEqual({
      verified: true,
    });
  });

  it("does not turn a preserving queued save into a stale metadata replacement", async () => {
    const input = event();
    await db.add(input, { verified: true });
    await flush();
    await db.add(structuredClone(input));
    await setEventMetadata(database, input.id, { verified: false });
    await flush();
    expect((await db.event(input.id))?.[sidecar]).toEqual({ verified: false });
  });

  it("keeps ordinary adds batched when no metadata hooks are configured", async () => {
    const plain = new NostrIDB<Event>(database, { writeInterval: 100000 });
    await plain.writeQueue!.flush();
    await plain.stop();
    const read = vi.spyOn(database, "get");
    try {
      await plain.add(event());
      expect(read).not.toHaveBeenCalled();
      await plain.writeQueue!.flush();
    } finally {
      read.mockRestore();
      await plain.stop();
    }
  });
});
