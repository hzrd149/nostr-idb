# AGENTS.md — nostr-idb

Agent coding guide for the `nostr-idb` repository. Read this before writing or modifying code.

---

## Project Overview

`nostr-idb` is a TypeScript library that stores Nostr events in IndexedDB. It exposes:

- A low-level IDB access layer (`src/database/`)
- An in-memory LRU index cache (`src/cache/`)
- A high-level `NostrIDB` class (`src/nostrdb/`)
- Worker and SharedWorker proxies (`src/worker/`)

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

# Type-check + emit declarations + worker bundles
pnpm build

# Dev server (serves examples/ via Vite)
pnpm dev
```

**Two-stage build:**

1. `tsc` — type-checks everything and emits `dist/` (JS + `.d.ts`)
2. `node build.js` — esbuild re-bundles `worker.ts` and `shared.ts` into fully self-contained worker scripts

**No linter** — Prettier is the only code-style enforcer. There is no ESLint or Biome config.

---

## TypeScript Configuration

`tsconfig.json` key settings:

- `"strict": true` — all strict checks on (never disable with `// @ts-ignore` except in polyfills)
- `"module": "NodeNext"` + `"moduleResolution": "NodeNext"` — **all relative imports must use `.js` extension** even though source files are `.ts`
- `"isolatedModules": true` — each file must be independently compilable; no `const enum`; use `import type` for type-only imports
- `"target": "ES2022"` — top-level await, class fields, `??=` etc. are available
- `"declaration": true` — `.d.ts` files emitted; keep public API surfaces well-typed
- Test files (`src/**/*.test.ts`, `src/**/__tests__/**/*`) are excluded from `tsc` and compiled only by vitest

---

## Code Style

### Imports

Use **sub-path imports** from `nostr-tools` — never import from the root:

```typescript
import type { NostrEvent } from "nostr-tools/pure"; // ✓
import { matchFilters } from "nostr-tools/filter"; // ✓
import { isReplaceableKind } from "nostr-tools/kinds"; // ✓
import { NostrEvent } from "nostr-tools"; // ✗
```

Use `import type` for type-only imports; use inline `type` keyword when mixing values and types:

```typescript
import type { Filter } from "../lib/nostr.js";
import { type NostrEvent, validateEvent } from "nostr-tools/pure";
```

All relative imports require the `.js` extension (NodeNext module resolution):

```typescript
import { getEventUID } from "./common.js"; // ✓
import { getEventUID } from "./common"; // ✗
```

### Formatting

`.prettierrc`: `{ "tabWidth": 2, "useTabs": false }`. All other Prettier defaults apply (double quotes, trailing commas, semicolons). Run `pnpm format` before committing.

### Naming Conventions

| Entity               | Convention                              | Example                                       |
| -------------------- | --------------------------------------- | --------------------------------------------- |
| Classes              | PascalCase                              | `NostrIDB`, `IndexCache`, `WriteQueue`        |
| Interfaces           | PascalCase with `I` prefix              | `INostrIDB`                                   |
| Functions            | camelCase                               | `getEventUID`, `queryForPubkeys`, `addEvents` |
| Exported constants   | SCREAMING_SNAKE_CASE                    | `INDEXABLE_TAGS`, `NOSTR_IDB_VERSION`         |
| Symbols              | PascalCase + `Symbol` suffix            | `EventUIDSymbol`                              |
| Type aliases         | PascalCase                              | `Filter`, `Features`, `RPCMethod`             |
| Private class fields | `private` keyword + camelCase (not `#`) | `private writeInterval`                       |
| Test DB names        | `"test-<module>-" + Date.now()`         | prevents inter-test collisions                |

### Module Organization

Every directory has a barrel `index.ts` that re-exports with `export * from "./module.js"`. Barrels contain no implementation.

### JSDoc

Every exported function and class gets a short JSDoc comment:

```typescript
/** Returns the event's unique ID, computing and caching it on first call. */
export function getEventUID(event: NostrEvent): string {
```

---

## Types

### Local `Filter` type (`src/types.ts`)

The project defines its own `Filter` type extending the nostr-tools type with NIP-91 AND-logic keys:

```typescript
export type Filter = {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
  search?: string;
  [key: `#${string}`]: string[] | undefined; // standard OR tag filters
  [key: `&${string}`]: string[] | undefined; // NIP-91 AND tag filters
};
```

Import this `Filter` from `"../lib/nostr.js"` (not from `nostr-tools`) whenever NIP-91 `&t` support is needed.

### Patterns in use

- **Interface + implementation:** Define the contract in `interface.ts`, implement in a class file.
- **Discriminated unions for RPC:** Each `method` string fully narrows its `params` type.
- **`Required<T>` for option defaults:** Merge `defaultOptions` with caller-provided options so the merged result is fully typed.
- **`ReturnType<typeof setTimeout>`** for interval/timer handles — avoid `NodeJS.Timeout` or `number`.
- **Symbol-keyed caching on objects:** Use `Symbol.for()` + `Reflect.get/set/has` to cache derived data on events without polluting their enumerable shape.

---

## Error Handling

### Throw for programmer errors / precondition violations

```typescript
if (!isReplaceableKind(kind))
  throw new Error(`Kind ${kind} is not replaceable`);
if (filters.length === 0) throw new Error("No Filters");
```

### Serialize errors across the Worker boundary

```typescript
// Server: catch, serialize to string
return { id, error: error instanceof Error ? error.message : String(error) };
// Client: re-hydrate
reject(new Error(data.error));
```

### Swallow non-critical errors intentionally, with a log

```typescript
try {
  sub.event(event);
} catch (error) {
  log("event handler failed", error);
}
```

### Do NOT catch IDB errors at the database layer

Let IDB rejected Promises propagate to the caller. No defensive `try/catch` around `idb` operations in `src/database/`.

### Timeouts

- RPC requests: 30-second hard timeout, rejects with `"Request timeout"`.
- Worker EOSE: 4400 ms default, configurable via `baseEoseTimeout`.

---

## Testing

Tests live in `src/**/__tests__/*.test.ts`. There is a shared setup file at `src/__tests__/setup.ts` that installs `fake-indexeddb` and `TextEncoder`/`TextDecoder` polyfills for Node.

Helper functions in `src/__tests__/helpers.ts`:

- `createTestEvent(overrides?)` — unsigned test event
- `createValidEvent(overrides?)` — signed, valid event (uses a deterministic test key)
- `createTestEvents(n)` — array of n valid events
- `getTestPublicKey()` — stable public key for test assertions

Each test file creates its own IDB instance with a unique name to prevent cross-test pollution:

```typescript
const db = await openDatabase("test-my-module-" + Date.now());
```

---

## Key Dependencies

| Package                 | Role                                          |
| ----------------------- | --------------------------------------------- |
| `idb` `^8`              | Typed Promise-based IndexedDB wrapper         |
| `nostr-tools` `~2.17.2` | Nostr protocol types and helpers              |
| `debug` `^4`            | Namespaced logging (`DEBUG=nostr-idb*`)       |
| `vitest` `^4`           | Test runner and coverage                      |
| `fake-indexeddb` `^6`   | IDB polyfill for Node-based tests             |
| `esbuild`               | Worker bundle step (self-contained, minified) |

---

## Common Pitfalls

1. **Forgetting `.js` on relative imports** — the build will fail with a module-not-found error at runtime even though `tsc` succeeds with `skipLibCheck`.
2. **Importing `Filter` from `nostr-tools/filter`** instead of `../lib/nostr.js` — loses NIP-91 `&t` support.
3. **Using `const enum`** — breaks `isolatedModules`. Use a regular `enum` or a union of string literals.
4. **Putting logic in barrel files** — barrels are re-export-only; implementation belongs in named modules.
5. **Not using `import type`** for type-only imports — required for `isolatedModules` correctness.
6. **Catching IDB errors at the database layer** — let them propagate; only catch at the application layer.
