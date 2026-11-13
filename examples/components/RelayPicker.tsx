import React from "react";
import {
  PRESET_RELAYS,
  isLoopbackRelay,
  parseRelayInput,
  useLocalNetworkPermission,
  useRelayState,
} from "../lib/pool.ts";
import { ChipInput } from "./ui.tsx";

function shortUrl(url: string) {
  return url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
}

/** Relay label with its pool connection state and optional NIP-77 support */
export function RelayLabel({
  url,
  showNip77,
}: {
  url: string;
  showNip77?: boolean;
}) {
  const { status, supported } = useRelayState(url);
  const nip77 = supported?.includes(77);
  const loopback = isLoopbackRelay(url);
  // only public https pages need the local network permission
  const lna = useLocalNetworkPermission(
    loopback && location.protocol === "https:",
  );
  return (
    <span className="relay-label">
      <span
        className={`status-dot ${status?.ready ? "open" : status?.connected ? "connecting" : ""}`}
        title={status?.ready ? "connected" : "idle"}
      />
      {shortUrl(url)}
      {lna && lna !== "unsupported" && (
        <span
          className={`nip-badge ${lna === "granted" ? "yes" : lna === "denied" ? "no" : "pending"}`}
          title={`local network access: ${lna}`}
        >
          local
        </span>
      )}
      {showNip77 && (
        <span
          className={`nip-badge ${supported === undefined ? "" : nip77 ? "yes" : "no"}`}
          title="NIP-77 negentropy"
        >
          77
        </span>
      )}
    </span>
  );
}

export function RelayPicker({
  relays,
  onChange,
  showNip77,
}: {
  relays: string[];
  onChange: (relays: string[]) => void;
  showNip77?: boolean;
}) {
  return (
    <ChipInput
      values={relays}
      onChange={onChange}
      parse={parseRelayInput}
      render={(url) => <RelayLabel url={url} showNip77={showNip77} />}
      suggestions={PRESET_RELAYS.map((r) => ({
        value: r,
        label: "+ " + shortUrl(r),
      }))}
      placeholder="wss://…"
    />
  );
}
