# nostr-idb

A collection of helper methods for storing nostr events in an IndexedDB and talking to it like a nostr relay

Live Examples: https://hzrd149.github.io/nostr-idb/

- [NostrIDB Class](#nostridb-class)
- [Methods](#methods)
  - [openDB](#openDB)
  - [clearDB](#clearDB)
  - [deleteDB](#deleteDB)
- [Performance](#Performance)

## Features

- Built directly on top of IndexedDB for the lowest latency
- Caches indexes in memory
- `NostrIDB` class with NIP-DB-compatible API (`query`, `count`, `subscribe` as AsyncGenerator)
- NIP-91 AND-filter support (`&t` keys)

## NostrIDB Class

The `NostrIDB` class is the main interface for working with nostr events in IndexedDB. It provides a NIP-DB-compatible API with automatic batching, caching, and subscription management.

### Basic Usage

```javascript
import { NostrIDB, openDB } from "nostr-idb";

// Option 1: provide an existing IDB instance
const db = await openDB("my-nostr-db");
const nostrDB = new NostrIDB(db);

// Option 2: omit the db argument — opens the default "nostr-idb" database
const nostrDB = new NostrIDB();

// Add events
await nostrDB.add(event1);
await nostrDB.add(event2);

// Query events (one-shot)
const events = await nostrDB.query([{ kinds: [1], limit: 10 }]);

// Subscribe to events as an async generator
for await (const event of nostrDB.subscribe([{ kinds: [1] }])) {
  console.log("Event:", event);
  // The generator ends after delivering all stored events
}

// Get a specific event by ID
const event = await nostrDB.event("event-id");

// Count events matching filters
const count = await nostrDB.count([{ kinds: [1] }]);

// Stop background processes (flush timers, prune interval)
await nostrDB.stop();
```

### Configuration Options

```javascript
const nostrDB = new NostrIDB(db, {
  batchWrite: 1000, // Number of events to batch before writing (default: 1000)
  writeInterval: 100, // Write interval in ms (default: 100)
  cacheIndexes: 1000, // Number of indexes to cache in memory (default: 1000)
  pruneInterval: 60000, // How often to prune old events in ms (default: 60000)
  maxEvents: 10000, // Maximum number of events to store (default: 10000)
});
```

### API Methods

#### `add(event: NostrEvent): Promise<boolean>`

Add a single event to the database. Returns `true` if the event was accepted. Ephemeral events are fanned out to active subscriptions but not persisted.

#### `event(id: string): Promise<NostrEvent | undefined>`

Get a single event by its ID.

#### `replaceable(kind: number, author: string, identifier?: string): Promise<NostrEvent | undefined>`

Get the latest replaceable event for a given kind, author, and optional identifier.

#### `count(filters: Filter | Filter[]): Promise<number>`

Count the number of events matching the given filters. Accepts a single filter or an array.

#### `query(filters: Filter | Filter[]): Promise<NostrEvent[]>`

Query events matching the given filters and return them as an array. Accepts a single filter or an array.

#### `subscribe(filters: Filter | Filter[]): AsyncGenerator<NostrEvent, void, undefined>`

Subscribe to events matching the filters. Yields stored historical events first, then any new events added via `add()`. The generator ends once the subscription is closed (i.e. the caller breaks out of the `for await` loop or calls `.return()`).

```javascript
// Read all stored kind-1 events, then stop
for await (const event of nostrDB.subscribe({ kinds: [1] })) {
  console.log(event);
}

// Keep receiving live events until cancelled
const gen = nostrDB.subscribe([{ kinds: [1] }]);
for await (const event of gen) {
  console.log("Live event:", event);
  if (shouldStop) break; // cleans up the subscription
}
```

#### `supports(): Promise<string[]>`

Returns an array of supported feature strings. Currently returns `[]`. Feature strings follow the NIP-DB convention (e.g. `"search"` for NIP-50 full-text search).

#### `deleteEvent(eventId: string): Promise<boolean>`

Delete a single event by its ID.

#### `deleteReplaceable(pubkey: string, kind: number, identifier?: string): Promise<boolean>`

Delete a replaceable event by pubkey, kind, and optional identifier.

#### `deleteByFilters(filters: Filter | Filter[]): Promise<number>`

Delete all events matching the given filters. Returns the number of deleted events. Accepts a single filter or an array.

#### `deleteAllEvents(): Promise<void>`

Delete all events from the database.

#### `start(): Promise<void>`

Start background write-flush and prune timers. Called automatically by the constructor — you only need this if you called `stop()` and want to resume.

#### `stop(): Promise<void>`

Stop background write-flush and prune timers.

### Advanced Usage

```javascript
// Batch add multiple events
const events = [event1, event2, event3];
for (const event of events) {
  await nostrDB.add(event);
}

// Single-filter shorthand (no array required)
const count = await nostrDB.count({ kinds: [1], authors: ["pubkey"] });
const results = await nostrDB.query({ kinds: [1], limit: 50 });

// NIP-91 AND-filter: events must have BOTH tag values
const andResults = await nostrDB.query({ "&t": ["bitcoin", "nostr"] });

// Query replaceable events
const profile = await nostrDB.replaceable(0, "pubkey");
const contactList = await nostrDB.replaceable(3, "pubkey");

// Delete events by filters
const deletedCount = await nostrDB.deleteByFilters([
  { kinds: [1], authors: ["pubkey"] },
]);
console.log(`Deleted ${deletedCount} events`);
```

## Methods

NOTE: all methods are async unless specified otherwise

### openDB

Opens a database with `name` and optional `callbacks`. See [openDB](https://www.npmjs.com/package/idb#opendb)

If no name is provided it will default to `nostr-idb`.

```javascript
import { openDB, NostrIDB } from "nostr-idb";

// Open the database
const db = await openDB("nostr-idb");

// Create a NostrIDB instance
const nostrDB = new NostrIDB(db);

// Use the NostrIDB instance
await nostrDB.add(event);
```

### clearDB

Remove all events from the database without deleting it.

### deleteDB

Calls `deleteDB` from `idb`. See [deleteDB](https://www.npmjs.com/package/idb#deletedb)

### pruneLastUsed

Removes the least recently used events until the database is at or below a size limit.

The `NostrIDB` class automatically handles pruning based on the `maxEvents` option. You can also prune manually:

```javascript
import { openDB, pruneLastUsed } from "nostr-idb";

const db = await openDB("nostr-idb");

// Keep only the 1000 most recently used events
await pruneLastUsed(db, 1000);
```
