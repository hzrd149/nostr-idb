/** @lib WebWorker */
import type { NostrIDBDatabase } from "../database/schema.js";
import { openDB } from "../database/database.js";
import { NostrIDB } from "../nostrdb/nostrdb.js";
import { logger } from "../debug.js";
import { WorkerRPCServer, RPCRequest } from "./utils.js";

let db: NostrIDBDatabase;
let nostrdb: NostrIDB;
let log = logger.extend("shared-worker");

let wait: Promise<NostrIDB> | null = openDB().then((database) => {
  db = database;
  nostrdb = new NostrIDB(db);
  wait = null;
  return nostrdb;
});

function getNostrDB() {
  if (wait) return wait;
  return nostrdb;
}

// @ts-ignore
onconnect = async (event: MessageEvent) => {
  log("Connecting to new window");
  const port = event.ports[0];
  const core = await getNostrDB();

  // Create RPC server with port's postMessage function
  const rpcServer = new WorkerRPCServer(core, (message) =>
    port.postMessage(message),
  );

  // Handle messages from the connected port
  port.onmessage = async (event: MessageEvent) => {
    const data = event.data as RPCRequest;

    if (data && typeof data === "object" && "method" in data && "id" in data) {
      const response = await rpcServer.handleRequest(data);
      port.postMessage(response);
    }
  };

  port.start();
  port.postMessage("hello world");
};
