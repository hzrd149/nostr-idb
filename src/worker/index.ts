/// <reference lib="webworker" />
import { RelayCore, openDB } from "../index.js";
import { connectRelayToWorkerContext } from "./utils.js";

const db = await openDB();
const relay = new RelayCore(db);

relay.start();

// connect the relay to the worker context
connectRelayToWorkerContext(
  relay,
  (listener) => addEventListener("message", listener),
  (message) => postMessage(message),
);
