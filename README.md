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
