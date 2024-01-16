import { Event, Filter } from "nostr-tools";
import { RelayCore } from "./relay-core.js";

type IncomingEventMessage = ["EVENT", Event];
type OKMessage = ["OK", string, boolean, string];
type OutgoingEventMessage = ["EVENT", string, Event];
type RequestMessage = ["REQ", string, ...Filter[]];
type EOSEMessage = ["EOSE", string];
type IncomingCountMessage = ["COUNT", string, ...Filter[]];
type OutgoingCountMessage = ["COUNT", string, { count: number }];
type CloseMessage = ["CLOSE", string];
type ClosedMessage = ["CLOSED", string, string];
type NoticeMessage = ["NOTICE", string];

export type IncomingMessage =
  | IncomingEventMessage
  | RequestMessage
  | IncomingCountMessage
  | CloseMessage;
export type OutgoingMessage =
  | OutgoingEventMessage
  | OKMessage
  | EOSEMessage
  | ClosedMessage
  | NoticeMessage
  | OutgoingCountMessage;

export async function sendMessageToRelay(
  core: RelayCore,
  message: IncomingMessage,
  respond: (message: OutgoingMessage) => void,
) {
  switch (message[0]) {
    case "EVENT":
      if (message[1]) {
        core.publish(message[1]);
        respond(["OK", message[1].id, true, "Accepted"]);
      }
      break;
    case "REQ": {
      const id = message[1];
      const filters = message.slice(2) as Filter[];
      core.subscribe(filters, {
        id,
        onevent: (event) => {
          respond(["EVENT", id, event]);
        },
        oneose: () => respond(["EOSE", id]),
      });
      break;
    }
    case "CLOSE": {
      const id = message[1];
      if (!id) return;
      core.unsubscribe(message[1]);
      respond(["CLOSED", id, "Closed by client"]);
      break;
    }
    case "COUNT": {
      const id = message[1];
      const filters = message.slice(2) as Filter[];
      if (!id) return;
      if (filters.length === 0) return respond(["NOTICE", "No Filters"]);
      const count = await core.count(filters);
      respond(["COUNT", id, { count }]);
      break;
    }
  }
}
