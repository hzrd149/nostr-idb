import { RelayPool, type RelayStatus } from "applesauce-relay";
import { useEffect, useState } from "react";

/** One connection pool shared by every page so relay sockets are reused */
export const pool = new RelayPool();

export const PRESET_RELAYS = [
  "ws://localhost:4869",
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

/** Loopback hosts that browsers let https pages reach over plain ws:// */
export function isLoopbackRelay(url: string) {
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "[::1]" ||
      /^127\./.test(host)
    );
  } catch {
    return false;
  }
}

/** Turn typed input into a relay url, defaulting local hosts to ws:// */
export function parseRelayInput(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^wss?:\/\//i.test(s)) return s;
  const local =
    /^(localhost|127\.|\[::1\]|[^/]+\.local(:|\/|$)|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
      s,
    );
  return (local ? "ws://" : "wss://") + s;
}

export type LocalNetworkPermission = PermissionState | "unsupported";

/**
 * State of the browser's Local Network Access permission (Chrome and Firefox
 * gate public https sites from reaching localhost until the user allows it)
 */
export function useLocalNetworkPermission(enabled: boolean) {
  const [state, setState] = useState<LocalNetworkPermission>();
  useEffect(() => {
    if (!enabled) return;
    let status: PermissionStatus | undefined;
    const update = () => status && setState(status.state);
    (async () => {
      for (const name of ["loopback-network", "local-network-access"]) {
        try {
          status = await navigator.permissions.query({
            name: name as PermissionName,
          });
          update();
          status.addEventListener("change", update);
          return;
        } catch {
          // permission name not known to this browser
        }
      }
      setState("unsupported");
    })();
    return () => status?.removeEventListener("change", update);
  }, [enabled]);
  return state;
}
