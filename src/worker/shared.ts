/** @lib WebWorker */
import type { NostrIDB } from "../database/schema.js";
import { openDB } from "../database/database.js";
import { RelayCore } from "../relay/relay-core.js";
import { connectRelayToMessagePort } from "./utils.js";
import { logger } from "../debug.js";

let db: NostrIDB;
let relay: RelayCore;
let log = logger.extend("shared-worker");

let wait: Promise<RelayCore> | null = openDB().then((database) => {
  db = database;
  relay = new RelayCore(db);
  relay.start();
  wait = null;
  return relay;
});

function getRelay() {
  if (wait) return wait;
  return relay;
}

// @ts-ignore
onconnect = async (event: MessageEvent) => {
  log("Connecting to new window");
  const port = event.ports[0];
  const core = await getRelay();
  connectRelayToMessagePort(core, port);
  port.start();
  port.postMessage("hello world");
};
