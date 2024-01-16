/** @lib WebWorker */
import { NostrIDB } from "../database/schema.js";
import { RelayCore, openDB } from "../index.js";
import { connectRelayToMessagePort } from "./utils.js";

let db: NostrIDB;
let relay: RelayCore;

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
  const port = event.ports[0];
  const core = await getRelay();
  connectRelayToMessagePort(core, port);
  port.start();
};

console.log("Worker started");
