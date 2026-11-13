# nostr-idb

## Unreleased

### Features

- Add generic event sidecar metadata with typed extraction/attachment hooks, explicit metadata on `add`, and independent `setMetadata` / `clearMetadata` operations.
- Preserve sidecars across duplicate saves, replace them without merging, and isolate them by exact event ID across replaceable-event versions; support pending, cached, and persisted reads and updates.
- Expose low-level sidecar writes and row-reader callbacks without requiring a database version upgrade.

### Performance Improvements

- Reduce event-body reads for limited author and kind queries while preserving timestamp ties, cached-event precedence, and filter semantics.
- Reduce IndexedDB write overhead by avoiding unused per-request Promises.
- Drain write queues in amortized linear time and support bulk enqueueing beyond JavaScript's argument limit.
- Use constant-time LRU tracking for index-cache touches and eviction.

### Fixes

- Keep index-cache eviction tracking consistent when touching or replacing entries so capacity limits remain enforced.
- Wait for write transactions to complete and propagate transaction failures from `addEvents` and `updateUsed`.

### API Notes

- `IndexCache.lastUsed` now returns an ordering snapshot. Assign a modified snapshot back to update eviction order; mutating the returned array alone no longer changes the cache.

### Maintenance

- Instruct agents to validate and commit significant changes and new features without including unrelated work.
- Update Vitest browser and coverage packages to 4.1.12 to address critical browser-mode and moderate mocker vulnerabilities.
- Remove unused Svelte development dependencies and configuration from the React-based examples setup.
- Replace Changesets with changelog-based change tracking and a manual release workflow using `pnpm publish`.

## 5.1.1

### Patch Changes

- 92d3562: Fix ID filtering, per-filter query limits, and stale caches after pruning. Add `maxMemoryEvents` to bound cached event bodies.

## 5.1.0

### Minor Changes

- e6488e0: Add support for storing unsigned events in database

## 5.0.0

### Major Changes

- 7455b1c: Update NostrIDB to match latest NIP-DB interface
- 7455b1c: Remove worker exports

## 4.1.0

### Minor Changes

- 64c7d85: Add support for NIP-91 AND tag filters

## 4.0.1

### Patch Changes

- 9d32650: Fix missing files in package

## 4.0.0

### Major Changes

- 7f9b180: Change `NostrIDB.filters` method to return `Promise<NostrEvent[]>` instead of stream handlers

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
