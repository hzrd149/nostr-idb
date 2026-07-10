import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openEncryptedDB, openPrivateDB } from "../../database/database.js";
import {
  importEncryptionKey,
  importIndexKey,
} from "../../database/encryption.js";
import type {
  EncryptedNostrIDBDatabase,
  PrivateNostrIDBDatabase,
} from "../../database/schema.js";
import { createTestEvent, getTestPublicKey } from "../../__tests__/helpers.js";
import { EncryptedNostrIDB, PrivateNostrIDB } from "../encrypted.js";

describe("EncryptedNostrIDB", () => {
  let db: EncryptedNostrIDBDatabase;
  let nostrDB: EncryptedNostrIDB;
  let encryptionKey: CryptoKey;

  beforeEach(async () => {
    encryptionKey = await importEncryptionKey(new Uint8Array(32).fill(1));
    db = await openEncryptedDB("test-encrypted-nostrdb-" + Date.now());
    nostrDB = new EncryptedNostrIDB(db, encryptionKey, {
      writeInterval: 10,
      pruneInterval: 100000,
    });
  });

  afterEach(async () => {
    await nostrDB.stop();
  });

  it("encrypts payload while keeping query metadata indexed", async () => {
    const event = createTestEvent({
      kind: 1,
      content: "private message body",
      tags: [["t", "secret-tag"]],
    });

    await nostrDB.add(event);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const row = await db.get("events", event.id);
    expect(row?.event.pubkey).toBe(event.pubkey);
    expect(row?.event.kind).toBe(event.kind);
    expect(row?.tags).toContain("tsecret-tag");
    expect(JSON.stringify(row)).not.toContain("private message body");
    expect(row?.encrypted.ciphertext).toBeInstanceOf(ArrayBuffer);

    const queried = await nostrDB.query({ kinds: [1], "#t": ["secret-tag"] });
    expect(queried).toHaveLength(1);
    expect(queried[0].content).toBe("private message body");
  });

  it("throws when decrypting with the wrong encryption key", async () => {
    const event = createTestEvent({ kind: 1, content: "secret" });
    await nostrDB.add(event);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const wrongKey = await importEncryptionKey(new Uint8Array(32).fill(2));
    const wrongDb = new EncryptedNostrIDB(db, wrongKey, {
      writeInterval: 10,
      pruneInterval: 100000,
    });

    await expect(wrongDb.event(event.id)).rejects.toThrow();
    await wrongDb.stop();
  });
});

describe("PrivateNostrIDB", () => {
  let db: PrivateNostrIDBDatabase;
  let nostrDB: PrivateNostrIDB;
  let encryptionKey: CryptoKey;
  let indexKey: CryptoKey;

  beforeEach(async () => {
    encryptionKey = await importEncryptionKey(new Uint8Array(32).fill(3));
    indexKey = await importIndexKey(new Uint8Array(32).fill(4));
    db = await openPrivateDB("test-private-nostrdb-" + Date.now());
    nostrDB = new PrivateNostrIDB(db, encryptionKey, indexKey, {
      writeInterval: 10,
      pruneInterval: 100000,
    });
  });

  afterEach(async () => {
    await nostrDB.stop();
  });

  it("stores tokenized indexes and encrypted payloads", async () => {
    const pubkey = getTestPublicKey();
    const event = createTestEvent({
      kind: 1,
      content: "private indexed body",
      tags: [["t", "private-tag"]],
    });

    await nostrDB.add(event);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const rows = await db.getAll("events");
    expect(rows).toHaveLength(1);
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain(pubkey);
    expect(serialized).not.toContain(event.id);
    expect(serialized).not.toContain("private-tag");
    expect(serialized).not.toContain("private indexed body");
    expect(rows[0].indexes.kind).not.toBe(String(event.kind));
    expect(rows[0].encrypted.ciphertext).toBeInstanceOf(ArrayBuffer);

    const byAuthor = await nostrDB.query({ authors: [pubkey] });
    expect(byAuthor).toHaveLength(1);
    expect(byAuthor[0].id).toBe(event.id);

    const byKindAndTag = await nostrDB.query({
      kinds: [1],
      "#t": ["private-tag"],
    });
    expect(byKindAndTag).toHaveLength(1);
    expect(byKindAndTag[0].content).toBe("private indexed body");
  });

  it("returns no matches with the wrong private index key", async () => {
    const event = createTestEvent({ kind: 1 });
    await nostrDB.add(event);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const wrongIndexKey = await importIndexKey(new Uint8Array(32).fill(5));
    const wrongDb = new PrivateNostrIDB(db, encryptionKey, wrongIndexKey, {
      writeInterval: 10,
      pruneInterval: 100000,
    });

    await expect(wrongDb.query({ kinds: [1] })).resolves.toHaveLength(0);
    await wrongDb.stop();
  });
});
