import type { DBSchema } from "idb";
import type { Event } from "nostr-tools";

export interface Schema extends DBSchema {
  events: {
    key: "id";
    value: {
      event: Event;
      tags: string[];
      firstSeen: number;
      lastUsed: number | null;
    };
    indexes: {
      id: string;
      pubkey: string;
      kind: number;
      create_at: number;
      tags: string;
      firstSeen: number;
      lastUsed: number;
    };
  };
}
