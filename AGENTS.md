# AGENTS.md — nostr-idb

Agent coding guide for the `nostr-idb` repository. Read this before writing or modifying code.

---

## Project Overview

`nostr-idb` is a TypeScript library that stores Nostr events in IndexedDB. It exposes:

- A low-level IDB access layer (`src/database/`)
- An in-memory LRU index cache (`src/cache/`)
- A high-level `NostrIDB` class (`src/nostrdb/`)
- Local Nostr types and helpers (`src/lib/nostr.ts`) — the canonical source for all runtime types

**Package manager:** `pnpm` (authoritative — use `pnpm`, not `npm` or `yarn`).
**Node version:** 20 (`.nvmrc`); CI runs Node 24.

---

## Commands

```bash
# Install dependencies
pnpm install

# Run tests in watch mode
pnpm test

# Single-shot test run (same as CI)
pnpm test:run

# Run a single test FILE
pnpm vitest run src/database/__tests__/query-filter.test.ts

# Run tests matching a NAME pattern
pnpm vitest run -t "queryForPubkeys"

# Coverage report (v8, text + JSON + HTML)
pnpm test:coverage

# Format all files in-place
pnpm format

# Type-check and emit declarations to dist/
pnpm build

# Dev server (serves examples/ via Vite)
pnpm dev
```

**Build is a single step:** `tsc` type-checks everything and emits `dist/` (JS + `.d.ts`).
**No linter** — Prettier is the only code-style enforcer. There is no ESLint or Biome config.

**Tests run in a real browser** (Playwright/Chromium via `@vitest/browser-playwright`). There is
no Node-based `fake-indexeddb` polyfill. `src/__tests__/setup.ts` is intentionally empty.

---

## TypeScript Configuration

`tsconfig.json` key settings:

- `"strict": true` — all strict checks on; never suppress with `// @ts-ignore`
- `"module": "NodeNext"` + `"moduleResolution": "NodeNext"` — **all relative imports must use `.js` extension** even though source files are `.ts`
- `"isolatedModules": true` — each file must be independently compilable; no `const enum`; use `import type` for type-only imports
- `"target": "ES2022"` — top-level await, class fields, `??=` etc. are available
- `"declaration": true` — `.d.ts` files emitted; keep public API surfaces well-typed
- Test files (`src/**/*.test.ts`, `src/**/__tests__/**/*`) are excluded from `tsc` and compiled only by vitest

---

## Code Style

### Imports

All runtime types and Nostr helpers live in **`src/lib/nostr.ts`** — import from there, not from
`nostr-tools`, for any production code. `nostr-tools` is a devDependency used only in tests.

```typescript
// Production code — always use the local lib
import type { NostrEvent, Filter } from "../lib/nostr.js"; // ✓
import { isReplaceableKind, matchFilters } from "../lib/nostr.js"; // ✓
import { matchFilters } from "nostr-tools/filter"; // ✗ — loses NIP-91 &t support
import { NostrEvent } from "nostr-tools"; // ✗ — nostr-tools is devDependency only

// Test code only — may import from nostr-tools/pure for event signing helpers
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure"; // ✓ (tests only)
```

Use `import type` for type-only imports; use the inline `type` keyword when mixing values and types:

```typescript
import type { Filter } from "../lib/nostr.js";
import { type NostrEvent, isEphemeralKind } from "../lib/nostr.js";
```

All relative imports require the `.js` extension (NodeNext module resolution):

```typescript
import { getEventUID } from "./common.js"; // ✓
import { getEventUID } from "./common"; // ✗
```

### Formatting

`.prettierrc`: `{ "tabWidth": 2, "useTabs": false }`. All other Prettier defaults apply (double
quotes, trailing commas, semicolons). Run `pnpm format` before committing.

### Naming Conventions

| Entity               | Convention                              | Example                                       |
| -------------------- | --------------------------------------- | --------------------------------------------- |
| Classes              | PascalCase                              | `NostrIDB`, `IndexCache`, `WriteQueue`        |
| Interfaces           | PascalCase with `I` prefix              | `INostrIDB`                                   |
| Functions            | camelCase                               | `getEventUID`, `queryForPubkeys`, `addEvents` |
| Exported constants   | SCREAMING_SNAKE_CASE                    | `INDEXABLE_TAGS`                              |
| Symbols              | PascalCase + `Symbol` suffix            | `EventUIDSymbol`, `IndexableTagsSymbol`       |
| Type aliases         | PascalCase                              | `Filter`, `Features`, `NostrDBOptions`        |
| Private class fields | `private` keyword + camelCase (not `#`) | `private writeInterval`                       |
| Test DB names        | `"test-<module>-" + Date.now()`         | prevents inter-test collisions                |

### Module Organization

Every directory has a barrel `index.ts` that re-exports with `export * from "./module.js"`. Barrels
contain no implementation logic.

### JSDoc

Every exported function and class gets a short JSDoc comment:

```typescript
/** Returns the event's unique ID, computing and caching it on first call. */
export function getEventUID(event: NostrEvent): string {
```

---

## Types

### `Filter` — `src/lib/nostr.ts`

The project defines its own `Filter` type with NIP-91 AND-logic keys. **Always import from
`../lib/nostr.js`**, never from `nostr-tools/filter` (which lacks the `&${string}` index signature):

```typescript
export type Filter = {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
  search?: string;
  [key: `#${string}`]: string[] | undefined; // OR tag filters (NIP-01)
  [key: `&${string}`]: string[] | undefined; // AND tag filters (NIP-91)
};
```

### Patterns in use

- **Interface + implementation:** Define the contract in `interface.ts`, implement in a class file.
- **`Required<T>` for option defaults:** Merge `defaultOptions` with caller options so the result is fully typed.
- **`ReturnType<typeof setTimeout>`** for timer handles — avoid `NodeJS.Timeout` or `number`.
- **Symbol-keyed caching on objects:** Use `Symbol.for()` + `Reflect.get/set/has` to cache derived data on events without polluting their enumerable shape (e.g. `EventUIDSymbol`, `IndexableTagsSymbol`).

---

## Error Handling

### Throw for programmer errors / precondition violations

```typescript
if (filters.length === 0) throw new Error("No Filters");
if (filter.since === undefined && filter.until === undefined)
  throw new Error("Missing since or until");
```

### Swallow non-critical errors intentionally, with a log

```typescript
try {
  sub.event(event);
} catch (error) {
  log("event handler failed with error", error);
}
```

### Do NOT catch IDB errors at the database layer

Let IDB rejected Promises propagate to the caller. No defensive `try/catch` around `idb` operations
in `src/database/`. Only catch at the application layer.

### Timeouts

- Subscription EOSE: 4400 ms default, configurable via `baseEoseTimeout` on `NostrIDB`.

---

## Testing

Tests live in `src/**/__tests__/*.test.ts` and run in Chromium via Playwright. Each test file
creates its own IDB instance with a unique name to prevent cross-test pollution:

```typescript
const db = await openDB("test-my-module-" + Date.now());
```

Helper functions in `src/__tests__/helpers.ts`:

- `createTestEvent({ kind, ...overrides })` — signed test event; `kind` is required
- `createValidEvent(kind?, created_at?, tags?, content?)` — convenience wrapper
- `createTestEvents(count, kind?)` — array of `count` signed events
- `getTestPublicKey()` — stable public key used by all test events

---

## Key Dependencies

| Package               | Role                                               |
| --------------------- | -------------------------------------------------- |
| `idb` `^8`            | Typed Promise-based IndexedDB wrapper              |
| `debug` `^4`          | Namespaced logging (`DEBUG=nostr-idb*`)            |
| `nostr-tools` `^2.23` | **devDependency only** — used in tests for signing |
| `vitest` `^4`         | Test runner (browser mode via Playwright)          |

---

## Common Pitfalls

1. **Forgetting `.js` on relative imports** — causes a module-not-found error at runtime even though `tsc` compiles cleanly.
2. **Importing `Filter` or Nostr helpers from `nostr-tools`** — use `../lib/nostr.js` instead; `nostr-tools` is dev-only and the local `Filter` type includes NIP-91 `&${string}` keys.
3. **Using `const enum`** — breaks `isolatedModules`. Use a regular `enum` or a string literal union.
4. **Putting logic in barrel files** — barrels are re-export-only; all implementation belongs in named modules.
5. **Not using `import type`** for type-only imports — required for `isolatedModules` correctness.
6. **Catching IDB errors at the database layer** — let them propagate; only catch at the application layer.
7. **Assuming Node test environment** — tests run in a real browser (Chromium). Browser APIs are native; there is no `fake-indexeddb` polyfill.
