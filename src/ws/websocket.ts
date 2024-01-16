import { LocalWebSocket } from "./local-websocket.js";
import { SharedWorkerWebSocket, WorkerWebSocket } from "./worker.js";

export const LOCAL_RELAY_URI = "ws://nostr-idb-local";
export const WORKER_RELAY_URI = "ws://nostr-idb-worker";
export const SHARED_WORKER_RELAY_URI = "ws://nostr-idb-shared-worker";

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
