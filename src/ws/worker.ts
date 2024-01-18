import { NostrIDBSharedWorker, NostrIDBWorker } from "../worker/index.js";
import { AbstractWebSocket } from "./abstract-websocket.js";
import { SHARED_WORKER_RELAY_URI, WORKER_RELAY_URI } from "./common.js";

function handleWorkerStartup(ws: WorkerWebSocket | SharedWorkerWebSocket) {
  ws.worker.onerror = () => {
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
      ws.readyState = ws.OPEN;
      const event = new Event("open");
      ws.onopen?.(event);
      ws.dispatchEvent(event);
    }
  });
}

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

    handleWorkerStartup(this);
  }

  close() {
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

    handleWorkerStartup(this);
  }

  close() {
    this.worker.port.close();
    this.readyState = this.CLOSED;
    const event = new CloseEvent("close", { wasClean: true });
    this.onclose?.(event);
    this.dispatchEvent(event);
  }
}
