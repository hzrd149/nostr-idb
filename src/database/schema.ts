import type { DBSchema, IDBPDatabase } from "idb";
import type { NostrEvent } from "nostr-tools/pure";

export type NostrIDBDatabase = IDBPDatabase<Schema>;

/** Schema type for `idb` package */
export interface Schema extends DBSchema {
  events: {
    key: string;
    value: {
      event: NostrEvent;
      tags: string[];
    };
    indexes: {
      id: string;
      pubkey: string;
      kind: number;
      created_at: number;
      tags: string;
    };
  };
  used: {
    key: string;
    value: {
      uid: string;
      date: number;
    };
    indexes: {
      uid: string;
      date: number;
    };
  };
}
