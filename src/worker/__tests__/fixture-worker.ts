/// <reference lib="webworker" />
import { openDB } from "../../database/database.js";
import { NostrIDB } from "../../nostrdb/nostrdb.js";
import { serveNostrIDB } from "../server.js";

// opened asynchronously: the client's early calls wait for the server
const db = await openDB("test-rpc-worker-" + Date.now());
serveNostrIDB(self as unknown as DedicatedWorkerGlobalScope, new NostrIDB(db));
