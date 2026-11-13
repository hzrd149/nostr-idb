import React from "react";
import { PRESET_RELAYS, useRelayState } from "../lib/pool.ts";
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
  return (
    <span className="relay-label">
      <span
        className={`status-dot ${status?.ready ? "open" : status?.connected ? "connecting" : ""}`}
        title={status?.ready ? "connected" : "idle"}
      />
      {shortUrl(url)}
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
      parse={(s) => (/^wss?:\/\//.test(s) ? s : s ? "wss://" + s : null)}
      render={(url) => <RelayLabel url={url} showNip77={showNip77} />}
      suggestions={PRESET_RELAYS.map((r) => ({
        value: r,
        label: "+ " + shortUrl(r),
      }))}
      placeholder="wss://…"
    />
  );
}
