# nostr-idb

A collection of helper methods for storing nostr events in IndexedDB

## Features

- Built directly on top of IndexedDB for the lowest latency
- CacheRelay class that has a similar API to to nostr-tool`s Relay class
- Caches indexes in memory

## Using the CacheRelay class

The `CacheRelay` class is lightweight in-memory relay that syncs with the IndexedDB database.

There are a few benefits to using it instead of the underlying `getEventsForFilters` or `addEvents` methods

- Caches indexes in memory.
- Batches write transactions
- Almost interchangeable with nostr-tool's `Relay` class

```javascript
import { openDB, CacheRelay } from "nostr-idb";
const db = await openDB("events");

const cacheRelay = new CacheRelay(db);

for (let event of events) {
  cacheRelay.publish(event);
}

const sub = cacheRelay.subscribe([{ kinds: [1] }], {
  onevent: (event) => {
    console.log("got event", event);
  },
  oneose: () => {
    console.log("no more events in cache");
  },
});
```

## Methods

NOTE: all methods are async unless specified otherwise

### openDB

Opens a database with `name` and optional `callbacks`. see [openDB](https://www.npmjs.com/package/idb#opendb)

```javascript
import { openDB, addEvents } from "nostr-idb";
const db = await openDB("events");
await addEvents(db, [...])
```

### deleteDB

Calls `deleteDB` from idb under the hood

### getEventsForFilter / getEventsForFilters

Both methods returns a sorted array of events that match the filters

```javascript
import { openDB, addEvents, getEventsForFilters } from "nostr-idb";
const db = await openDB("events");

// add events to db
await addEvents(db, [...])

// query db
const events = await getEventsForFilters(db, [
	{
		kinds: [1, 6],
		limit: 30
	}
])
```

### addEvent / addEvents

`addEvent` and `addEvents` methods can be used to add events to the database.

If possible its better to use `addEvents` and batch writes. since writing single events to the database can cause performance issues

### countEventsForFilter / countEventsForFilters

Similar to `getEventsForFilters` but returns just the number of events

### pruneDatabaseToSize(db, limit)

Removes the least used events until the database is under the size limit

## Index Cache

Normally this is created when you create a new `CacheRelay`. but if you want to maintain your own you can use the `IndexCache` class

```javascript
import { openDB, addEvents, getEventsForFilters, IndexCache } from "nostr-idb";

const indexCache = new IndexCache()
const db = await openDB("events");

// add events to db
await addEvents(db, [...])

// if indexCache is passed in getEventsForFilters will check it first and save any indexes to it
const events = await getEventsForFilters(db, [
	{
		kinds: [1, 6],
		limit: 30
	}
], indexCache)

// add more events
await addEvents(db, [...])
// NOTE: don't forget to add events to in-memory indexes
// otherwise your indexes will get out of sync
for(let event of events){
	indexCache.addEventToIndexes(event)
}
```
