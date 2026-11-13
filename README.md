# nostr-idb

A TypeScript library for storing and querying Nostr events locally in the browser
with IndexedDB. It provides a NIP-DB-compatible API, in-memory caching, batched
writes, live subscriptions, NIP-91 AND-tag filters, and app-defined event sidecar metadata.

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
| `add(event, metadata?)`                        | Accept an event and optionally replace its sidecar metadata.       |
| `setMetadata(eventId, metadata)`               | Replace metadata for an exact stored or pending event ID.          |
| `clearMetadata(eventId)`                       | Remove metadata for an exact stored or pending event ID.           |
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
sharing the boundary timestamp if you subtract one second. There is currently no
continuation-cursor API.

### Event sidecar metadata

Store app-defined data, such as relay sightings or signature-check results,
alongside an event. Metadata is generic, structured-cloneable, and separate from
the signed event fields. Use synchronous hooks to extract it from event properties
or symbols and attach it when events are read:

```ts
import { NostrIDB, type NostrEvent } from "nostr-idb";

type Metadata = { relays?: string[]; verified?: boolean };
const metadataSymbol = Symbol.for("my-app.event-metadata");
type AppEvent = NostrEvent & { [metadataSymbol]?: Metadata };

const db = new NostrIDB<AppEvent, Metadata>(undefined, {
  metadata: {
    read: (event) => event[metadataSymbol],
    attach(event, metadata) {
      if (metadata === undefined) delete event[metadataSymbol];
      else event[metadataSymbol] = metadata;
    },
  },
});

// `event` is an AppEvent supplied by your application.
await db.add(event, { relays: ["wss://relay.example"], verified: true });
await db.add(event); // Extract metadata using read(event)
await db.setMetadata(event.id, { relays: ["wss://another.example"] });
await db.clearMetadata(event.id);
```

- Explicit metadata takes precedence over extraction and replaces the entire
  sidecar; values are never merged. Explicit `undefined` skips extraction.
  Missing/undefined metadata preserves the existing sidecar for that exact event;
  use `clearMetadata` to remove it.
- Values are snapshotted when passed to `add` or `setMetadata`. Mutating an
  attached value does not persist it automatically. Non-cloneable metadata rejects
  the operation. `attach` receives a separate copy and must remove old metadata
  when passed `undefined`; it must not change signed fields. Symbol or
  non-enumerable attachments stay out of event JSON.
- `event`, `replaceable`, `query`, and historical subscriptions restore metadata.
  Updates also refresh pending events and objects retained in this instance's
  cache, without emitting another subscription event. Other instances' caches and
  objects no longer cached are not synchronized.
- `setMetadata` and `clearMetadata` return `false` when the event is neither
  persisted nor pending. Pass the exact event ID, not a replaceable address/UID.
  Newer replaceable events do not inherit the previous event's metadata.
- Adds and updates to pending events use the write queue; updates to persisted
  events wait for the metadata write. Updates are serialized with flushes, so a
  `writeQueue.processEvents` hook must not await `add`, metadata updates, or another
  flush on the same instance.
- Existing rows remain readable without a database migration. Deleting or pruning
  a persisted row removes its sidecar too. Verification flags are app-provided
  assertions; storing them does not verify signatures.

For low-level access, `addEvents(db, events, metadataById?)` accepts a
`ReadonlyMap<string, unknown>` keyed by event ID. Missing entries preserve existing
sidecars; an explicit `undefined` entry clears one.
`setEventMetadata(db, eventId, value)` updates a persisted sidecar independently
(`undefined` clears). Event query helpers accept an optional final `EventReader`
callback receiving `{ event, tags, metadata? }` to restore metadata onto returned
events. Low-level writes do not synchronize `NostrIDB` caches.

### Other exports

All database helpers are available from both `nostr-idb` and `nostr-idb/database`.

| Exports                                                           | Purpose                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `openDB`, `clearDB`, `deleteDB`                                   | Open, empty, or delete an IndexedDB database.                      |
| `addEvents`, `updateUsed`, `pruneLastUsed`                        | Bulk storage, usage tracking, and eviction.                        |
| `setEventMetadata`                                                | Replace or clear a persisted event's sidecar by exact ID.          |
| [Query helpers](./src/database/query-filter.ts)                   | Query indexes, retrieve IDs/events, and count matches for filters. |
| [Miscellaneous queries](./src/database/query-misc.ts)             | Get replaceable events; count by author, kind, or database.        |
| [Deletion helpers](./src/database/delete.ts)                      | Delete by ID, filter, or replaceable-event address.                |
| `getEventUID`, `getEventTags`, `INDEXABLE_TAGS`, `EventUIDSymbol` | Event identity and index-tag utilities.                            |
| `NOSTR_IDB_NAME`, `NOSTR_IDB_VERSION`                             | Default database name and schema version.                          |
| `IndexCache`, `WriteQueue`                                        | Low-level cache and batched-write utilities (root export only).    |

**Types:** `NostrEvent`, `UnsignedEvent`, `RumorEvent`, `StoredEvent`,
`EventTemplate`, `Filter`, `INostrIDB`, `NostrDBOptions`, `Features`,
`NostrIDBDatabase`, `Schema`, `EventMetadataOptions`, and `EventReader`. Subscription implementation types
`InternalSubscription` and `InternalSubscriptionFor` are also exported.

[Live examples](https://hzrd149.github.io/nostr-idb/) ·
[Changelog](./CHANGELOG.md)
