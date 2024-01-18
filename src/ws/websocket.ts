import {
  LOCAL_RELAY_URI,
  SHARED_WORKER_RELAY_URI,
  WORKER_RELAY_URI,
} from "./common.js";
import { LocalWebSocket } from "./local-websocket.js";
import { SharedWorkerWebSocket, WorkerWebSocket } from "./worker.js";

class OverrideWebSocket extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    if (String(url).startsWith(LOCAL_RELAY_URI)) {
      return new LocalWebSocket(url);
    } else if (String(url).startsWith(WORKER_RELAY_URI)) {
      return new WorkerWebSocket();
    } else if (String(url).startsWith(SHARED_WORKER_RELAY_URI)) {
      return new SharedWorkerWebSocket();
    } else super(url, protocols);
  }
}

export { OverrideWebSocket as WebSocket };
