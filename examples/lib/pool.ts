import { RelayPool, type RelayStatus } from "applesauce-relay";
import { useEffect, useState } from "react";

/** One connection pool shared by every page so relay sockets are reused */
export const pool = new RelayPool();

export const PRESET_RELAYS = [
  "wss://relay.ditto.pub",
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://relay.nostr.band",
  "wss://nostr.wine",
  "wss://purplepag.es",
];

export type RelayState = {
  status?: RelayStatus;
  /** NIPs from the NIP-11 document, null when the relay publishes none */
  supported?: number[] | null;
};

/** Live connection state and NIP-11 support for a relay in the pool */
export function useRelayState(url: string): RelayState {
  const [state, setState] = useState<RelayState>({});
  useEffect(() => {
    const relay = pool.relay(url);
    const subs = [
      relay.status$.subscribe((status) => setState((s) => ({ ...s, status }))),
      relay.supported$.subscribe((supported) =>
        setState((s) => ({ ...s, supported })),
      ),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  }, [url]);
  return state;
}
