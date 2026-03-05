import { useCallback, useEffect, useRef, useState } from "react";
import type { NostrEvent } from "../../src/lib/nostr.js";

export type RelayStatus = "disconnected" | "connecting" | "connected" | "error";

export type LogEntry = { ts: number; kind: "info" | "ok" | "err"; msg: string };

export type RelayState = {
  status: RelayStatus;
  log: LogEntry[];
  received: number;
  connect: (url: string, filters: object[]) => void;
  disconnect: () => void;
};

export function useRelay(onEvent: (event: NostrEvent) => void): RelayState {
  const [status, setStatus] = useState<RelayStatus>("disconnected");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [received, setReceived] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const subIdRef = useRef<string>("sub-" + Math.random().toString(36).slice(2));
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const addLog = useCallback((kind: LogEntry["kind"], msg: string) => {
    setLog((prev) => [{ ts: Date.now(), kind, msg }, ...prev].slice(0, 200));
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  const connect = useCallback(
    (url: string, filters: object[]) => {
      disconnect();
      setStatus("connecting");
      setReceived(0);
      addLog("info", `Connecting to ${url}…`);

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        addLog("ok", `Connected to ${url}`);
        const req = JSON.stringify(["REQ", subIdRef.current, ...filters]);
        ws.send(req);
        addLog("info", `Subscribed with ${filters.length} filter(s)`);
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          if (!Array.isArray(msg)) return;

          if (msg[0] === "EVENT" && msg[2]) {
            onEventRef.current(msg[2] as NostrEvent);
            setReceived((n) => n + 1);
          } else if (msg[0] === "EOSE") {
            addLog("ok", "EOSE — historical events delivered");
          } else if (msg[0] === "NOTICE") {
            addLog("info", `NOTICE: ${msg[1]}`);
          } else if (msg[0] === "CLOSED") {
            addLog("err", `Subscription closed: ${msg[2] ?? ""}`);
          }
        } catch {
          /* ignore parse errors */
        }
      };

      ws.onerror = () => {
        setStatus("error");
        addLog("err", "WebSocket error");
      };

      ws.onclose = (e) => {
        if (status !== "disconnected") {
          setStatus("disconnected");
          addLog("info", `Disconnected (code ${e.code})`);
        }
      };
    },
    [addLog, disconnect],
  );

  // cleanup on unmount
  useEffect(() => () => disconnect(), [disconnect]);

  return { status, log, received, connect, disconnect };
}
