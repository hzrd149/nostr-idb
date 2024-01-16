import {
  IncomingMessage,
  OutgoingMessage,
} from "../relay/relay-message-bus.js";

export type AbstractWebSocketBackend = {
  rx: (listener: (message: OutgoingMessage) => void) => void;
  tx: (message: IncomingMessage) => void;
};

export class AbstractWebSocket extends EventTarget implements WebSocket {
  // unused properties
  binaryType: BinaryType = "blob";
  readonly bufferedAmount = 0;
  readonly extensions = "";
  readonly protocol = "";
  url: string;
  addEventListener: WebSocket["addEventListener"];
  removeEventListener: WebSocket["removeEventListener"];

  readonly CONNECTING = WebSocket.CONNECTING;
  readonly OPEN = WebSocket.OPEN;
  readonly CLOSING = WebSocket.CLOSING;
  readonly CLOSED = WebSocket.CLOSED;

  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null;
  onerror: ((this: WebSocket, ev: Event) => any) | null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null;
  onopen: ((this: WebSocket, ev: Event) => any) | null;

  readyState: number;

  private backend: AbstractWebSocketBackend;
  constructor(url: string | URL, backend: AbstractWebSocketBackend) {
    super();
    this.url = String(url);
    this.backend = backend;

    this.backend.rx((message) => {
      const event = new MessageEvent("message", {
        data: JSON.stringify(message),
      });
      if (this.onmessage) this.onmessage(event);
      this.dispatchEvent(event);
    });
  }

  close(code?: number, reason?: string) {
    // this.readyState = this.CLOSED
    // const event = new CloseEvent("close", { wasClean: true });
    // this.onclose?.(event);
    // this.dispatchEvent(event)
  }

  send(data: string): void {
    if (typeof data !== "string")
      throw new Error("AbstractWebSocket only accepts strings");

    const message = JSON.parse(data);
    if (Array.isArray(message)) this.backend.tx(message as IncomingMessage);
  }
}
