import { logger } from "../debug.js";
import {
  LOCAL_RELAY_URI,
  SHARED_WORKER_RELAY_URI,
  WORKER_RELAY_URI,
} from "./common.js";
import { LocalWebSocket } from "./local-websocket.js";
import { SharedWorkerWebSocket, WorkerWebSocket } from "./worker.js";

const log = logger.extend("ws");

class OverrideWebSocket extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    if (String(url).startsWith(LOCAL_RELAY_URI)) {
      log(`Creating LocalWebSocket`);
      return new LocalWebSocket(url);
    } else if (String(url).startsWith(WORKER_RELAY_URI)) {
      log(`Creating WorkerWebSocket`);
      return new WorkerWebSocket();
    } else if (String(url).startsWith(SHARED_WORKER_RELAY_URI)) {
      log(`Creating SharedWorkerWebSocket`);
      return new SharedWorkerWebSocket();
    } else super(url, protocols);
  }
}

export { OverrideWebSocket as WebSocket };
