import type { DBSchema, IDBPDatabase } from "idb";
import type { NostrEvent } from "../lib/nostr.js";
import type { EncryptedEventPayload } from "./encryption.js";

export type NostrIDBDatabase = IDBPDatabase<Schema>;
export type EncryptedNostrIDBDatabase = IDBPDatabase<EncryptedSchema>;
export type PrivateNostrIDBDatabase = IDBPDatabase<PrivateSchema>;

export type EncryptedEventRecord = {
  event: Pick<NostrEvent, "id" | "pubkey" | "kind" | "created_at">;
  tags: string[];
  encrypted: EncryptedEventPayload;
};

export type PrivateEventRecord = {
  indexes: {
    id: string;
    pubkey: string;
    kind: string;
    created_at: number;
    tags: string[];
  };
  encrypted: EncryptedEventPayload;
};

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

/** Schema type for the encrypted database with clear query metadata */
export interface EncryptedSchema extends DBSchema {
  events: {
    key: string;
    value: EncryptedEventRecord;
    indexes: {
      id: string;
      pubkey: string;
      kind: number;
      created_at: number;
      tags: string;
    };
  };
  used: Schema["used"];
}

/** Schema type for the encrypted database with HMAC-tokenized query indexes */
export interface PrivateSchema extends DBSchema {
  events: {
    key: string;
    value: PrivateEventRecord;
    indexes: {
      id: string;
      pubkey: string;
      kind: string;
      created_at: number;
      tags: string;
    };
  };
  used: Schema["used"];
}
