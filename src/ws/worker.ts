import { logger } from "../debug.js";
import { NostrIDBSharedWorker, NostrIDBWorker } from "../worker/index.js";
import { AbstractWebSocket } from "./abstract-websocket.js";
import { SHARED_WORKER_RELAY_URI, WORKER_RELAY_URI } from "./common.js";

function handleWorkerStartup(
  ws: WorkerWebSocket | SharedWorkerWebSocket,
  log: debug.Debugger,
) {
  ws.worker.onerror = () => {
    log("Failed to start worker");
    const event = new Event("error");
    ws.readyState = ws.CLOSED;
    ws.onerror?.(event);
    ws.dispatchEvent(event);
  };

  (ws.worker instanceof SharedWorker
    ? ws.worker.port
    : ws.worker
  ).addEventListener("message", (e) => {
    if (e.data === "hello world") {
      log("Received start message");
      ws.readyState = ws.OPEN;
      const event = new Event("open");
      ws.onopen?.(event);
      ws.dispatchEvent(event);
    }
  });
}

const workerLog = logger.extend("ws:worker");
const sharedWorkerLog = logger.extend("ws:shared-worker");

export class WorkerWebSocket extends AbstractWebSocket {
  worker: Worker;
  constructor() {
    const worker = new NostrIDBWorker();
    super(WORKER_RELAY_URI, {
      rx: (listener) =>
        (worker.onmessage = (event) =>
          event.data !== "hello world" && listener(event.data)),
      tx: (message) => worker.postMessage(message),
    });
    this.worker = worker;

    handleWorkerStartup(this, workerLog);
  }

  close() {
    workerLog("Stopping");
    this.worker.terminate();
    this.readyState = this.CLOSED;
    const event = new CloseEvent("close", { wasClean: true });
    this.onclose?.(event);
    this.dispatchEvent(event);
  }
}

export class SharedWorkerWebSocket extends AbstractWebSocket {
  worker: SharedWorker;
  constructor() {
    const worker = new NostrIDBSharedWorker();
    super(SHARED_WORKER_RELAY_URI, {
      rx: (listener) => {
        worker.port.onmessage = (event) =>
          event.data !== "hello world" && listener(event.data);
      },
      tx: (message) => worker.port.postMessage(message),
    });
    this.worker = worker;

    handleWorkerStartup(this, sharedWorkerLog);
  }

  close() {
    sharedWorkerLog("Disconnecting");
    this.worker.port.close();
    this.readyState = this.CLOSED;
    const event = new CloseEvent("close", { wasClean: true });
    this.onclose?.(event);
    this.dispatchEvent(event);
  }
}
