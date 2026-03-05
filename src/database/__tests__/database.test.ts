import { describe, it, expect, beforeEach } from "vitest";
import { openDB, clearDB, deleteDB, NOSTR_IDB_NAME } from "../database.js";
import { addEvents } from "../insert.js";
import { countEvents } from "../query-misc.js";
import type { NostrIDBDatabase } from "../schema.js";
import { createTestEvent } from "../../__tests__/helpers.js";

describe("database", () => {
  describe("openDB", () => {
    it("should create a database with both required object stores", async () => {
      const name = "test-opendb-stores-" + Date.now();
      const db = await openDB(name);

      const storeNames = Array.from(db.objectStoreNames);
      expect(storeNames).toContain("events");
      expect(storeNames).toContain("used");

      db.close();
    });

    it("should create events store with all expected indexes", async () => {
      const name = "test-opendb-indexes-" + Date.now();
      const db = await openDB(name);

      const tx = db.transaction("events", "readonly");
      const store = tx.objectStore("events");
      const indexNames = Array.from(store.indexNames);

      expect(indexNames).toContain("id");
      expect(indexNames).toContain("pubkey");
      expect(indexNames).toContain("kind");
      expect(indexNames).toContain("created_at");
      expect(indexNames).toContain("tags");

      db.close();
    });

    it("should create a used store with a date index", async () => {
      const name = "test-opendb-used-" + Date.now();
      const db = await openDB(name);

      const tx = db.transaction("used", "readonly");
      const store = tx.objectStore("used");
      const indexNames = Array.from(store.indexNames);

      expect(indexNames).toContain("date");

      db.close();
    });

    it("should open a database with a custom name without error", async () => {
      const name = "test-opendb-custom-" + Date.now();
      const db = await openDB(name);

      expect(db).toBeDefined();
      expect(db.name).toBe(name);

      db.close();
    });

    it("should use the default name when called with no arguments", async () => {
      // Use a unique name override to avoid polluting the default DB
      const db = await openDB(NOSTR_IDB_NAME + "-test-" + Date.now());
      expect(db).toBeDefined();
      db.close();
    });

    it("should be idempotent — reopening the same DB returns a usable handle", async () => {
      const name = "test-opendb-reopen-" + Date.now();
      const db1 = await openDB(name);
      const event = createTestEvent({ kind: 1 });
      await addEvents(db1, [event]);
      db1.close();

      const db2 = await openDB(name);
      const stored = await db2.get("events", event.id);
      expect(stored?.event.id).toBe(event.id);
      db2.close();
    });
  });

  describe("clearDB", () => {
    let db: NostrIDBDatabase;

    beforeEach(async () => {
      db = await openDB("test-cleardb-" + Date.now());
    });

    it("should remove all events from the events store", async () => {
      await addEvents(db, [
        createTestEvent({ kind: 1 }),
        createTestEvent({ kind: 1 }),
        createTestEvent({ kind: 1 }),
      ]);

      await clearDB(db);

      expect(await db.getAll("events")).toHaveLength(0);
    });

    it("should remove all entries from the used store", async () => {
      await db.put("used", { uid: "abc", date: 1000 });
      await db.put("used", { uid: "def", date: 2000 });

      await clearDB(db);

      expect(await db.getAll("used")).toHaveLength(0);
    });

    it("should leave the object stores intact (not drop them)", async () => {
      await clearDB(db);

      // Stores should still be accessible
      const storeNames = Array.from(db.objectStoreNames);
      expect(storeNames).toContain("events");
      expect(storeNames).toContain("used");
    });

    it("should work without error on an already-empty database", async () => {
      await expect(clearDB(db)).resolves.toBeUndefined();
    });
  });

  describe("deleteDB", () => {
    it("should allow deleting a named database without error", async () => {
      const name = "test-deletedb-" + Date.now();
      const db = await openDB(name);
      db.close();

      await expect(deleteDB(name)).resolves.toBeUndefined();
    });

    it("should produce an empty database when reopened after deletion", async () => {
      const name = "test-deletedb-reopen-" + Date.now();

      // Populate and then delete
      const db1 = await openDB(name);
      await addEvents(db1, [createTestEvent({ kind: 1 })]);
      expect(await countEvents(db1)).toBe(1);
      db1.close();

      await deleteDB(name);

      // Reopening should start fresh
      const db2 = await openDB(name);
      expect(await countEvents(db2)).toBe(0);
      db2.close();
    });
  });
});
