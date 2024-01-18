/// <reference lib="webworker" />
import { openDB } from "../database/database.js";
import { logger } from "../debug.js";
import { RelayCore } from "../relay/relay-core.js";
import { connectRelayToWorkerContext } from "./utils.js";

const db = await openDB();
const relay = new RelayCore(db);
const log = logger.extend("worker");

relay.start();

// connect the relay to the worker context
connectRelayToWorkerContext(
  relay,
  (listener) => addEventListener("message", listener),
  (message) => postMessage(message),
);

log("Started");
postMessage("hello world");
