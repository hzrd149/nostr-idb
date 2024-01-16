import { NostrIDB } from "../database/schema.js";
import { openDB } from "../index.js";
import { RelayCore } from "../relay/relay-core.js";
import {
  OutgoingMessage,
  sendMessageToRelay,
} from "../relay/relay-message-bus.js";
import {
  AbstractWebSocket,
  AbstractWebSocketBackend,
} from "./abstract-websocket.js";

/** This websocket will create a NostrIDB and RelayCore instance and run it in the window context */
export class LocalWebSocket extends AbstractWebSocket {
  db?: NostrIDB;
  core?: RelayCore;
  constructor(url: string | URL, protocols?: string | string[]) {
    let listener: ((message: OutgoingMessage) => void) | null = null;
    const backend: AbstractWebSocketBackend = {
      rx: (fn) => (listener = fn),
      tx: (message) => {
        if (this.core) sendMessageToRelay(this.core, message, listener);
      },
    };
    super(url, backend);

    // open the database
    openDB().then((db) => {
      this.db = db;
      this.core = new RelayCore(db);

      const event = new Event("open");
      this.onopen?.(event);
      this.dispatchEvent(event);
    });

    this.readyState = this.CONNECTING;
  }
}
