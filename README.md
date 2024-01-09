# nostr-idb

A collection of helper methods for storing nostr events in IndexedDB

# Methods

## openDB

Opens a database with `name` and optional `callbacks`. see [openDB](https://www.npmjs.com/package/idb#opendb)

```javascript
import { openDB, addEvents } from "nostr-idb";
const db = await openDB("events");
await addEvents(db, [...])
```

## deleteDB

Calls `deleteDB` from idb under the hood

## getEventsForFilters

Returns a sorted array of events that match the filters

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
