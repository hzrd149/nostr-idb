# nostr-idb

A TypeScript library for storing and querying Nostr events locally in the browser
with IndexedDB. It provides a NIP-DB-compatible API, in-memory caching, batched
writes, live subscriptions, and NIP-91 AND-tag filters.

## Install

```sh
pnpm add nostr-idb
```

## Usage

JavaScript-style pseudocode (`event` comes from your app or a relay):

```javascript
import { NostrIDB } from "nostr-idb";

const db = new NostrIDB();

await db.add(event);
const notes = await db.query({ kinds: [1], limit: 20 });
const savedEvent = await db.event(event.id);

// Stream stored and newly added notes; break when finished.
for await (const note of db.subscribe({ kinds: [1] })) {
  display(note);
  if (done) break;
}

await db.stop();
```

## API overview

### Diagnostics

```ts
import { configureDiagnostics } from "nostr-idb";

configureDiagnostics({ debug: true, timing: true });
configureDiagnostics({ timing: false }); // Leave debug logging enabled
```

Both flags default to `false` and apply to all instances in this loaded copy of
the library, including standalone helpers. The same function and its
`DiagnosticsOptions` type are exported from `nostr-idb/database`. Omitted flags
keep their current values; changes take effect at runtime.

`debug` enables namespaced `console.debug` messages (enable the browser console's
Verbose level if needed). It replaces the previous `DEBUG` environment variable
and `localStorage.debug` configuration, which are no longer read.

`timing` independently enables `console.time` / `console.timeEnd` for database
operations, index queries, event loading, nonempty write-queue flushes, and
subscription historical reads. Labels include the operation, database name when
available, and a unique invocation number. Nested timings overlap and should not
be added together. Timers close on success or failure, even if timing is disabled
while an operation is running. Timings include asynchronous waiting; console
instrumentation itself adds overhead.

### `NostrIDB`

`new NostrIDB(db?, options?)` opens the default database or wraps one returned by
`openDB(name)`. Accepts signed events and unsigned rumors.

| Method                                         | Purpose                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `add(event)`                                   | Accept an event and queue it for storage.                          |
| `event(id)`                                    | Look up an event by ID.                                            |
| `replaceable(kind, author, identifier?)`       | Get the latest replaceable event.                                  |
| `query(filters)`                               | Return matching events as an array.                                |
| `count(filters)`                               | Count matching events.                                             |
| `subscribe(filters)`                           | Async generator of stored and newly added events.                  |
| `supports()`                                   | Return supported optional feature names.                           |
| `deleteEvent(id)`                              | Delete an event by ID or UID.                                      |
| `deleteReplaceable(pubkey, kind, identifier?)` | Delete a replaceable event.                                        |
| `deleteByFilters(filters)`                     | Delete matching events.                                            |
| `deleteAllEvents()`                            | Remove all events.                                                 |
| `start()` / `stop()`                           | Start or stop background writes and pruning; starts automatically. |

Filters accept one `Filter` or an array, including standard Nostr `#tag` filters
and NIP-91 `&tag` AND filters. Options control batching, write/prune intervals,
index-cache size, stored-event limits, and in-memory event limits.
See [options and implementation](./src/nostrdb/nostrdb.ts).

An empty filter matches all stored kinds: `await db.query({})` returns every
event, newest first. Use `await db.query({ limit: 100 })` to bound the result.
Unlimited empty queries and subscriptions emit a console warning because their
results can load the entire database into application memory. `db.count({})`
counts all persisted events; `db.deleteByFilters({})` deletes all persisted events.
An empty filter array (`[]`) remains invalid.

Time filters such as `{ until: timestamp, limit: 100 }` also match all kinds.
`until` is inclusive: timestamp-only pagination can repeat events, or skip events
sharing the boundary timestamp if you subtract one second. Use cursor pagination
for reliable continuation through timestamp ties.

### Cursor pagination and finite traversal

```ts
let cursor;
do {
  const page = await db.queryPage({ kinds: [1] }, { pageSize: 100, cursor });
  await processBatch(page.events);
  cursor = page.nextCursor;
} while (cursor);

// Omit filters (or use {}) to traverse all committed events.
for await (const event of db.iterate(undefined, { pageSize: 500 })) {
  await processEvent(event);
}

// Page-oriented generators also support early break and cancellation.
for await (const page of db.pages({}, { signal: controller.signal })) {
  await processBatch(page.events);
}
```

- `queryPage(filters?, options?)` returns `{ events, nextCursor, done, scanned }`.
  `pages()` yields these pages; `iterate()` yields individual events and finishes.
- Defaults: `pageSize: 100`, `scanLimit: 4096`, `direction: "prev"` (newest first).
  `"next"` reads oldest first. Timestamp ties are ordered by stored UID in the same
  direction. Both sizes must be positive safe integers.
- Each page examines at most `scanLimit` candidate rows and returns at most
  `pageSize` events. Sparse filters can produce **empty pages with a cursor**;
  only `done` or absence of `nextCursor` means completion.
- Cursors are opaque serializable strings tied to database name/version, filters,
  and direction. Keep these unchanged when resuming; page/scan sizes can change.
  Do not reuse cursors after clearing or recreating a database.
- Filters have OR semantics across an array, with overlapping matches returned
  once. `[]` is invalid. `filter.limit` and `search` are rejected: use `pageSize`
  and stop the iterator when enough events have been processed.
- Reads include **committed data only**, not pending writes or cached bodies.
  `add()` queues writes; if needed, await `db.writeQueue?.flush()` after adding
  events before starting traversal. Reads do not populate event/index caches.
- Transactions finish before a page is returned or yielded, so slow consumers
  can safely await other work. Generators buffer only one page and do not prefetch.
- This is live traversal, not a snapshot. Concurrent insertions, replacements,
  deletions, and pruning can change later results; a replacement can move across
  the cursor. Exactly-once traversal is guaranteed only for unchanged data.
- The current reader seeks through the time index, with time bounds pushed down.
  Other predicates are matched incrementally: memory stays bounded, but sparse
  author/kind/tag filters may scan many rows. There is no full candidate-ID set.

Low-level equivalents are `getEventsPage(db, filters?, options?)`,
`iterateEventPages(db, filters?, options?)`, and `iterateEvents(db, filters?, options?)`,
exported from both entry points with `QueryCursor`, `QueryPage`, and `QueryPageOptions`.

### Other exports

All database helpers are available from both `nostr-idb` and `nostr-idb/database`.

| Exports                                                           | Purpose                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `openDB`, `clearDB`, `deleteDB`                                   | Open, empty, or delete an IndexedDB database.                      |
| `addEvents`, `updateUsed`, `pruneLastUsed`                        | Bulk storage, usage tracking, and eviction.                        |
| [Query helpers](./src/database/query-filter.ts)                   | Query indexes, retrieve IDs/events, and count matches for filters. |
| [Miscellaneous queries](./src/database/query-misc.ts)             | Get replaceable events; count by author, kind, or database.        |
| [Deletion helpers](./src/database/delete.ts)                      | Delete by ID, filter, or replaceable-event address.                |
| `getEventUID`, `getEventTags`, `INDEXABLE_TAGS`, `EventUIDSymbol` | Event identity and index-tag utilities.                            |
| `NOSTR_IDB_NAME`, `NOSTR_IDB_VERSION`                             | Default database name and schema version.                          |
| `IndexCache`, `WriteQueue`                                        | Low-level cache and batched-write utilities (root export only).    |

**Types:** `NostrEvent`, `UnsignedEvent`, `RumorEvent`, `StoredEvent`,
`EventTemplate`, `Filter`, `INostrIDB`, `NostrDBOptions`, `Features`,
`NostrIDBDatabase`, and `Schema`. Subscription implementation types
`InternalSubscription` and `InternalSubscriptionFor` are also exported.

[Live examples](https://hzrd149.github.io/nostr-idb/) ·
[Changelog](./CHANGELOG.md)
