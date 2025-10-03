# nostr-idb

## 3.0.0

### Major Changes

- 6f4d8ae: Rename `getEventsFromAddressPointers` to `getReplaceableEvents`
- 6f4d8ae: Rename `NostrIDB` type to `NostrIDBDatabase`
- 6f4d8ae: Bump `nostr-tools` to `2.17`
- 6f4d8ae: Remove the websocket interfaces
- 6f4d8ae: Rename `GENERIC_TAGS` to `INDEXABLE_TAGS`
- 6f4d8ae: Replace `RelayCore` with simpler `NostrIDB` class

### Minor Changes

- 6f4d8ae: Add stricter types

## 2.4.0

### Minor Changes

- d4cdfc9: Remove event validation when inserting events
- d4cdfc9: Update replaceable events UID to follow NIP-01 addresses

## 2.3.0

### Minor Changes

- e21466a: Bump `nostr-tools` to `2.14` and lock minor version

### Patch Changes

- 98377e6: Export `NostrIDB` type
- e21466a: Cache event UID on event

## 2.2.0

### Minor Changes

- 9be773e: Add `processEvents` method to `WriteQueue`

## 2.1.6

### Patch Changes

- Add error handler for onevent callback

## 2.1.5

### Patch Changes

- Add timeout for subscriptions

## 2.1.4

### Patch Changes

- Add missing fire method to subscription type

## 2.1.1

### Patch Changes

- 890f64a: don't rebroadcast duplicate events

## 2.1.0

### Minor Changes

- 55e853c: Add in memory eventMap to relay core

## 2.0.1

### Patch Changes

- e4ec1d1: Fix multiple filters being interpreted as and

## 2.0.0

### Major Changes

- d7c74fb: Remove single `addEvent` method
- e09e98c: Add `WebSocket` class
- e09e98c: Add `LocalWebSocket` class
- e09e98c: Add `WorkerWebSocket` class
- e09e98c: Add `SharedWorkerWebSocket` class
- e09e98c: Add `NostrIDBWorker` and `NostrIDBSharedWorker` classes

## 1.1.1

### Patch Changes

- ec4b4e2: Fix event UID

## 1.1.0

### Minor Changes

- 7004c24: Add simple prune methods

## 1.0.0

### Major Changes

- 9bbdbc7: Upgrade nostr-tools to v2

### Minor Changes

- 9bbdbc7: Support ephemeral events
- 446cb1e: Support replaceable and parameterized replaceable events

## 0.2.0

### Minor Changes

- f223129: Added `CacheRelay` class
- 6c04558: Add `IndexCache` for relay
