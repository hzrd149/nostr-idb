/// <reference lib="webworker" />
import { openDB } from "../database/database.js";
import { logger } from "../debug.js";
import { NostrIDB } from "../nostrdb/nostrdb.js";
import { WorkerRPCServer, RPCRequest } from "./utils.js";

const log = logger.extend("worker");

let nostrdb: NostrIDB | null = null;
async function getNostrDB() {
  if (nostrdb) return nostrdb;

  log("Opening database");
  const db = await openDB();
  nostrdb = new NostrIDB(db);
  return nostrdb;
}

async function getRPCServer() {
  const nostrdb = await getNostrDB();
  return new WorkerRPCServer(nostrdb);
}

// Handle messages from the main thread
addEventListener("message", async (event) => {
  const data = event.data as RPCRequest;

  if (data && typeof data === "object" && "method" in data && "id" in data) {
    const rpc = await getRPCServer();
    const response = await rpc.handleRequest(data);
    postMessage(response);
  }
});

log("Started");
