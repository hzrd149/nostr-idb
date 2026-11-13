/// <reference lib="webworker" />
/**
 * Runs one database in a dedicated worker. The page talks to it through
 * `NostrIDBClient`, so IndexedDB reads, index building and filter matching
 * happen here instead of on the main thread.
 *
 * Control messages (not part of the RPC protocol):
 *   → { type: "open", name, options }   open the database and start serving
 *   → { type: "shutdown" }              flush writes and close the database
 *   ← { type: "closed" }                safe to terminate the worker
 */
import { NostrIDB, openDB, type NostrDBOptions } from "../../src/index.ts";
import { serveNostrIDB } from "../../src/worker/index.ts";

declare const self: DedicatedWorkerGlobalScope;

let nostr: NostrIDB | null = null;
let stopServing: (() => void) | null = null;

self.addEventListener("message", async (e: MessageEvent) => {
  const msg = e.data;
  if (msg?.type === "open" && !nostr) {
    const db = await openDB(msg.name as string);
    nostr = new NostrIDB(db, msg.options as NostrDBOptions);
    // serving announces "ready" so client calls queued until now go through
    stopServing = serveNostrIDB(self, nostr);
  } else if (msg?.type === "shutdown") {
    stopServing?.();
    await nostr?.stop();
    // write anything still queued before the database closes
    await nostr?.writeQueue?.flush(Infinity);
    nostr?.db?.close();
    self.postMessage({ type: "closed" });
  }
});
