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
- `NostrIDB` class with full nostr relay-like API

## NostrIDB Class

The `NostrIDB` class is the main interface for working with nostr events in IndexedDB. It provides a complete nostr relay-like API with automatic batching, caching, and subscription management.

### Basic Usage

```javascript
import { NostrIDB, openDB } from "nostr-idb";

// Create a new NostrIDB instance
const db = await openDB("my-nostr-db");
const nostrDB = new NostrIDB(db);

// Start the database (starts background processes)
await nostrDB.start();

// Add events
await nostrDB.add(event1);
await nostrDB.add(event2);

// Query events
const subscription = nostrDB.subscribe([{ kinds: [1], limit: 10 }], {
  event: (event) => console.log("New event:", event),
  complete: () => console.log("Subscription complete"),
});

// Get a specific event
const event = await nostrDB.event("event-id");

// Count events matching filters
const count = await nostrDB.count([{ kinds: [1] }]);

// Stop the database
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

Add a single event to the database. Returns `true` if the event was added.

#### `event(id: string): Promise<NostrEvent | undefined>`

Get a single event by its ID.

#### `replaceable(kind: number, author: string, identifier?: string): Promise<NostrEvent | undefined>`

Get the latest replaceable event for a given kind, author, and optional identifier.

#### `count(filters: Filter[]): Promise<number>`

Count the number of events matching the given filters.

#### `subscribe(filters: Filter[], handlers: StreamHandlers): Subscription`

Subscribe to events matching the filters. Returns a subscription object with a `close()` method.

#### `filters(filters: Filter[], handlers: StreamHandlers): Subscription`

Same as `subscribe` but automatically closes after EOSE (End of Stored Events).

#### `deleteEvent(eventId: string): Promise<boolean>`

Delete a single event by its ID.

#### `deleteReplaceable(pubkey: string, kind: number, identifier?: string): Promise<boolean>`

Delete a replaceable event by pubkey, kind, and optional identifier.

#### `deleteByFilters(filters: Filter[]): Promise<number>`

Delete all events matching the given filters. Returns the number of deleted events.

#### `deleteAllEvents(): Promise<void>`

Delete all events from the database.

#### `supports(): Promise<Features[]>`

Check which features the database supports.

### Advanced Usage

```javascript
// Batch add multiple events
const events = [event1, event2, event3];
for (const event of events) {
  await nostrDB.add(event);
}

// Subscribe with error handling
const subscription = nostrDB.subscribe([{ kinds: [1] }], {
  event: (event) => {
    console.log("Received event:", event);
  },
  error: (error) => {
    console.error("Subscription error:", error);
  },
  complete: () => {
    console.log("Subscription completed");
  },
});

// Clean up subscription
subscription.close();

// Query replaceable events
const profile = await nostrDB.replaceable(0, "pubkey");
const contactList = await nostrDB.replaceable(3, "pubkey", "contacts");

// Delete events by filters
const deletedCount = await nostrDB.deleteByFilters([
  { kinds: [1], authors: ["pubkey"] },
]);
console.log(`Deleted ${deletedCount} events`);
```

## Methods

NOTE: all methods are async unless specified otherwise

### openDB

Opens a database with `name` and optional `callbacks`. see [openDB](https://www.npmjs.com/package/idb#opendb)

If no name is provided it will default to `nostr-idb`

```javascript
import { openDB, NostrIDB } from "nostr-idb";

// Open the database
const db = await openDB("nostr-idb");

// Create a NostrIDB instance
const nostrDB = new NostrIDB(db);
await nostrDB.start();

// Use the NostrIDB instance
await nostrDB.add(event);
```

### clearDB

Remove all events from the database without deleting it

### deleteDB

Calls `deleteDB` from `idb`. see [deleteDB](https://www.npmjs.com/package/idb#deletedb)

### getEventsForFilter / getEventsForFilters

Returns a sorted array of events that match the filter/filters

```javascript
import { openDB, NostrIDB } from "nostr-idb";

const db = await openDB("events");
const nostrDB = new NostrIDB(db);
await nostrDB.start();

// add events to db
await nostrDB.add(event1);
await nostrDB.add(event2);

// query db using subscription
const subscription = nostrDB.subscribe(
  [
    {
      kinds: [1, 6],
      limit: 30,
    },
  ],
  {
    event: (event) => console.log("Found event:", event),
    complete: () => console.log("Query complete"),
  },
);
```

### countEventsForFilter / countEventsForFilters

Similar to `getEventsForFilters` but returns just the number of events

```javascript
import { openDB, NostrIDB } from "nostr-idb";

const db = await openDB("events");
const nostrDB = new NostrIDB(db);
await nostrDB.start();

// count events matching filters
const count = await nostrDB.count([
  {
    kinds: [1, 6],
    limit: 30,
  },
]);
console.log(`Found ${count} events`);
```

### addEvent / addEvents

Add events to the database

The `NostrIDB` class automatically batches events for better performance. Use `nostrDB.add(event)` for individual events.

### pruneDatabaseToSize(db, limit)

Removes the least used events until the database is under the size limit

The `NostrIDB` class automatically handles pruning based on the `maxEvents` option. You can also manually prune:

```javascript
import { pruneLastUsed } from "nostr-idb";

// Manually prune to keep only 1000 events
await pruneLastUsed(db, 1000);
```
