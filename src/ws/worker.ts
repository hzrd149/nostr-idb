import { AbstractWebSocket } from "./abstract-websocket.js";
import { SHARED_WORKER_RELAY_URI, WORKER_RELAY_URI } from "./websocket.js";

export class WorkerWebSocket extends AbstractWebSocket {
  worker: Worker;
  constructor() {
    const worker = new Worker(new URL("../worker/index.js", import.meta.url), {
      name: "nostr-idb",
      type: "module",
    });
    super(WORKER_RELAY_URI, {
      rx: (listener) =>
        worker.addEventListener("message", (event) => listener(event.data)),
      tx: (message) => worker.postMessage(message),
    });
    this.worker = worker;

    setTimeout(() => {
      this.readyState = this.OPEN;
      const event = new Event("open");
      this.onopen?.(event);
      this.dispatchEvent(event);
    }, 0);
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
    const worker = new SharedWorker(
      new URL("../worker/shared.js", import.meta.url),
      {
        name: "nostr-idb",
        type: "module",
      },
    );
    super(SHARED_WORKER_RELAY_URI, {
      rx: (listener) => {
        worker.port.onmessage = (event) => listener(event.data);
      },
      tx: (message) => worker.port.postMessage(message),
    });
    this.worker = worker;

    setTimeout(() => {
      this.readyState = this.OPEN;
      const event = new Event("open");
      this.onopen?.(event);
      this.dispatchEvent(event);
    }, 0);
  }
}
