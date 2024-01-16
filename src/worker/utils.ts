import { RelayCore } from "../relay/relay-core.js";
import {
  IncomingMessage,
  sendMessageToRelay,
} from "../relay/relay-message-bus.js";

export function connectRelayToWorkerContext(
  core: RelayCore,
  rx: (listener: (event: MessageEvent) => void) => void,
  tx: (message: any) => void,
) {
  rx((event) => {
    const isString = typeof event.data === "string";
    let data = event.data as string | IncomingMessage;
    try {
      if (typeof data === "string") data = JSON.parse(data) as IncomingMessage;
      if (Array.isArray(data)) {
        sendMessageToRelay(core, data, (message) => {
          if (isString) tx(JSON.stringify(message));
          else tx(message);
        });
      }
    } catch (e) {}
  });
}
export function connectRelayToMessagePort(core: RelayCore, port: MessagePort) {
  connectRelayToWorkerContext(
    core,
    (listener) => port.addEventListener("message", listener),
    (message) => port.postMessage(message),
  );
}
