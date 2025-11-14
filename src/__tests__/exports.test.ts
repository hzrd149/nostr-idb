import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected members", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "EventUIDSymbol",
        "INDEXABLE_TAGS",
        "IndexCache",
        "NOSTR_IDB_NAME",
        "NOSTR_IDB_VERSION",
        "NostrIDB",
        "WriteQueue",
        "addEvents",
        "clearDB",
        "countEvents",
        "countEventsByKind",
        "countEventsByPubkeys",
        "countEventsForFilter",
        "countEventsForFilters",
        "deleteAllEvents",
        "deleteAllReplaceable",
        "deleteByFilter",
        "deleteByFilters",
        "deleteDB",
        "deleteEvent",
        "deleteEventsByIds",
        "deleteReplaceable",
        "getEventTags",
        "getEventUID",
        "getEventsForFilter",
        "getEventsForFilters",
        "getIdsForFilter",
        "getIdsForFilters",
        "getReplaceableEvents",
        "openDB",
        "pruneLastUsed",
        "queryForKinds",
        "queryForPubkeys",
        "queryForTag",
        "queryForTime",
        "updateUsed",
      ]
    `);
  });
});
