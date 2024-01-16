import {
  AbstractRelay,
  Event,
  Relay,
  VerifiedEvent,
  verifiedSymbol,
} from "nostr-tools";
import { CacheRelay, openDB } from "../../";
import {
  WebSocket,
  LOCAL_RELAY_URI,
  WORKER_RELAY_URI,
  SHARED_WORKER_RELAY_URI,
} from "../../dist/ws";
window.WebSocket = WebSocket;

const db = await openDB();
const localRelay =
  // new CacheRelay(db) ||
  new AbstractRelay(SHARED_WORKER_RELAY_URI, {
    verifyEvent: (event: Event): event is VerifiedEvent => {
      return (event[verifiedSymbol] = true);
    },
  });
await localRelay.connect();

// @ts-ignore
window.db = db;
// @ts-ignore
window.localRelay = localRelay;

export { localRelay };
export default db;
