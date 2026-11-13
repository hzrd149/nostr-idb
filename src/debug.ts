/** Library-wide diagnostics settings. Both flags default to false. */
export type DiagnosticsOptions = {
  debug?: boolean;
  timing?: boolean;
};

let debugEnabled = false;
let timingEnabled = false;
let nextTimerId = 0;
const noop = () => {};

/** Update diagnostics for this library instance; omitted flags are unchanged. */
export function configureDiagnostics(options: DiagnosticsOptions): void {
  if (options.debug !== undefined) debugEnabled = options.debug;
  if (options.timing !== undefined) timingEnabled = options.timing;
}

/** Create an internal namespaced console logger. */
function createLogger(namespace: string) {
  const log = (...args: unknown[]) => {
    if (debugEnabled) console.debug(`[${namespace}]`, ...args);
  };
  log.extend = (name: string) => createLogger(`${namespace}:${name}`);
  return log;
}

/** Internal logger shared by database, cache, and subscription operations. */
export const logger = createLogger("nostr-idb");

/** Start an optional console timer and return its idempotent completion callback. */
export function startTimer(operation: string, database?: string): () => void {
  if (!timingEnabled) return noop;
  const label = `[nostr-idb${database ? `:${database}` : ""}] ${operation} #${++nextTimerId}`;
  console.time(label);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    console.timeEnd(label);
  };
}
