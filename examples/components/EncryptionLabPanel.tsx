import React, { useState } from "react";
import {
  addEncryptedEvents,
  addEvents,
  addPrivateEvents,
  countEncryptedEventsForFilters,
  countEventsForFilter,
  countPrivateEventsForFilters,
  deleteAllEncryptedEvents,
  deleteAllEvents,
  getEncryptedEvent,
  getEncryptedEventsForFilters,
  getEventsForFilter,
  getPrivateEvent,
  getPrivateEventsForFilters,
  importEncryptionKey,
  importIndexKey,
  openDB,
  openEncryptedDB,
  openPrivateDB,
} from "../../src/index.ts";
import type {
  EncryptedNostrIDBDatabase,
  NostrIDBDatabase,
  PrivateNostrIDBDatabase,
} from "../../src/database/schema.ts";
import type { Filter, NostrEvent } from "../../src/lib/nostr.js";

type BackendName = "Plaintext" | "Encrypted" | "Private";

type BenchmarkResult = {
  backend: BackendName;
  insertMs: number;
  countMs: number;
  queryMs: number;
  eventMs: number;
  count: number;
  queryCount: number;
  sampleContent: string;
  storedPreview: string;
  leakSummary: string;
};

const DB_NAMES = {
  plaintext: "nostr-idb-encryption-lab-plain",
  encrypted: "nostr-idb-encryption-lab-encrypted",
  private: "nostr-idb-encryption-lab-private",
};

const TEST_PUBKEY = "0".repeat(63) + "1";
const OTHER_PUBKEY = "0".repeat(63) + "2";

type Props = {
  onResults: (events: NostrEvent[], label: string) => void;
};

export function EncryptionLabPanel({ onResults }: Props) {
  const [eventCount, setEventCount] = useState(1000);
  const [contentBytes, setContentBytes] = useState(240);
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  async function runBenchmark() {
    setRunning(true);
    setError("");
    setStatus("Generating events...");
    setResults([]);

    try {
      const events = createBenchmarkEvents(eventCount, contentBytes);
      const filter: Filter = {
        kinds: [1],
        authors: [TEST_PUBKEY],
        "#t": ["encrypted-lab"],
        limit: 50,
      };
      const firstEvent = events[0];
      const encryptionKey = await importEncryptionKey(
        new Uint8Array(32).fill(7),
      );
      const indexKey = await importIndexKey(new Uint8Array(32).fill(8));

      setStatus("Opening benchmark databases...");
      const [plainDb, encryptedDb, privateDb] = await Promise.all([
        openDB(DB_NAMES.plaintext),
        openEncryptedDB(DB_NAMES.encrypted),
        openPrivateDB(DB_NAMES.private),
      ]);

      await clearDatabases(plainDb, encryptedDb, privateDb);

      const nextResults: BenchmarkResult[] = [];

      setStatus("Running plaintext baseline...");
      nextResults.push(
        await benchmarkPlaintext(plainDb, events, filter, firstEvent),
      );
      setResults([...nextResults]);

      setStatus("Running encrypted metadata-clear backend...");
      nextResults.push(
        await benchmarkEncrypted(
          encryptedDb,
          events,
          filter,
          firstEvent,
          encryptionKey,
        ),
      );
      setResults([...nextResults]);

      setStatus("Running private token-index backend...");
      nextResults.push(
        await benchmarkPrivate(
          privateDb,
          events,
          filter,
          firstEvent,
          encryptionKey,
          indexKey,
        ),
      );
      setResults([...nextResults]);

      const privateEvents = await getPrivateEventsForFilters(
        privateDb,
        [filter],
        encryptionKey,
        indexKey,
      );
      onResults(privateEvents, "Encryption Lab Results");
      setStatus("Complete");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("Failed");
    } finally {
      setRunning(false);
    }
  }

  async function clearLabDatabases() {
    setRunning(true);
    setError("");
    setStatus("Clearing benchmark databases...");
    try {
      const [plainDb, encryptedDb, privateDb] = await Promise.all([
        openDB(DB_NAMES.plaintext),
        openEncryptedDB(DB_NAMES.encrypted),
        openPrivateDB(DB_NAMES.private),
      ]);
      await clearDatabases(plainDb, encryptedDb, privateDb);
      setResults([]);
      onResults([], "Encryption Lab Results");
      setStatus("Cleared");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("Failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="panel encryption-lab">
      <p className="panel-title">Encryption Lab</p>

      <p className="hint-text">
        Runs the same synthetic workload against plaintext IndexedDB, AES-GCM
        encrypted payloads with clear indexes, and AES-GCM payloads with
        HMAC-tokenized equality indexes.
      </p>

      <div className="field">
        <label>Events to generate</label>
        <input
          type="number"
          min={1}
          max={20000}
          value={eventCount}
          onChange={(e) => setEventCount(Number(e.target.value))}
        />
      </div>

      <div className="field">
        <label>Approx content bytes per event</label>
        <input
          type="number"
          min={1}
          max={5000}
          value={contentBytes}
          onChange={(e) => setContentBytes(Number(e.target.value))}
        />
      </div>

      <div className="btn-row">
        <button
          className="btn-primary"
          onClick={runBenchmark}
          disabled={running}
        >
          {running ? "Running..." : "Run benchmark"}
        </button>
        <button
          className="btn-secondary"
          onClick={clearLabDatabases}
          disabled={running}
        >
          Clear lab DBs
        </button>
      </div>

      <div className="stat-row" style={{ marginTop: 10 }}>
        <span className="stat-label">Status</span>
        <span className="stat-value">{status}</span>
      </div>

      {error && <div className="error-text">{error}</div>}

      {results.length > 0 && (
        <div className="benchmark-table-wrap">
          <table className="benchmark-table">
            <thead>
              <tr>
                <th>Backend</th>
                <th>Insert</th>
                <th>Count</th>
                <th>Query</th>
                <th>Event</th>
                <th>Rows</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.backend}>
                  <td>{result.backend}</td>
                  <td>{formatMs(result.insertMs)}</td>
                  <td>{formatMs(result.countMs)}</td>
                  <td>{formatMs(result.queryMs)}</td>
                  <td>{formatMs(result.eventMs)}</td>
                  <td>
                    {result.queryCount}/{result.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results.map((result) => (
        <details className="stored-preview" key={result.backend}>
          <summary>{result.backend} stored row preview</summary>
          <div className="hint-text">{result.leakSummary}</div>
          <pre>{result.storedPreview}</pre>
        </details>
      ))}
    </div>
  );
}

async function benchmarkPlaintext(
  db: NostrIDBDatabase,
  events: NostrEvent[],
  filter: Filter,
  firstEvent: NostrEvent,
): Promise<BenchmarkResult> {
  const insertMs = await time(() => addEvents(db, events));
  let count = 0;
  const countMs = await time(async () => {
    count = await countEventsForFilter(db, filter);
  });
  let queried: NostrEvent[] = [];
  const queryMs = await time(async () => {
    queried = await getEventsForFilter(db, filter);
  });
  let sample: NostrEvent | undefined;
  const eventMs = await time(async () => {
    sample = (await db.get("events", firstEvent.id))?.event;
  });
  const row = await db.get("events", firstEvent.id);

  return {
    backend: "Plaintext",
    insertMs,
    countMs,
    queryMs,
    eventMs,
    count,
    queryCount: queried.length,
    sampleContent: sample?.content ?? "",
    storedPreview: preview(row),
    leakSummary:
      "Stores full event, content, signature, pubkey, kind, time, and tags in cleartext.",
  };
}

async function benchmarkEncrypted(
  db: EncryptedNostrIDBDatabase,
  events: NostrEvent[],
  filter: Filter,
  firstEvent: NostrEvent,
  encryptionKey: CryptoKey,
): Promise<BenchmarkResult> {
  const insertMs = await time(() =>
    addEncryptedEvents(db, events, encryptionKey),
  );
  let count = 0;
  const countMs = await time(async () => {
    count = await countEncryptedEventsForFilters(db, [filter]);
  });
  let queried: NostrEvent[] = [];
  const queryMs = await time(async () => {
    queried = await getEncryptedEventsForFilters(db, [filter], encryptionKey);
  });
  let sample: NostrEvent | undefined;
  const eventMs = await time(async () => {
    sample = await getEncryptedEvent(db, firstEvent.id, encryptionKey);
  });
  const row = await db.get("events", firstEvent.id);

  return {
    backend: "Encrypted",
    insertMs,
    countMs,
    queryMs,
    eventMs,
    count,
    queryCount: queried.length,
    sampleContent: sample?.content ?? "",
    storedPreview: preview(row),
    leakSummary:
      "Encrypts full event payload, but leaves id/pubkey/kind/time and indexable tags visible for native IndexedDB indexes.",
  };
}

async function benchmarkPrivate(
  db: PrivateNostrIDBDatabase,
  events: NostrEvent[],
  filter: Filter,
  firstEvent: NostrEvent,
  encryptionKey: CryptoKey,
  indexKey: CryptoKey,
): Promise<BenchmarkResult> {
  const insertMs = await time(() =>
    addPrivateEvents(db, events, encryptionKey, indexKey),
  );
  let count = 0;
  const countMs = await time(async () => {
    count = await countPrivateEventsForFilters(db, [filter], indexKey);
  });
  let queried: NostrEvent[] = [];
  const queryMs = await time(async () => {
    queried = await getPrivateEventsForFilters(
      db,
      [filter],
      encryptionKey,
      indexKey,
    );
  });
  let sample: NostrEvent | undefined;
  const eventMs = await time(async () => {
    sample = await getPrivateEvent(db, firstEvent.id, encryptionKey, indexKey);
  });
  const row = (await db.getAll("events"))[0];

  return {
    backend: "Private",
    insertMs,
    countMs,
    queryMs,
    eventMs,
    count,
    queryCount: queried.length,
    sampleContent: sample?.content ?? "",
    storedPreview: preview(row),
    leakSummary:
      "Encrypts full event payload and stores HMAC tokens for equality indexes. created_at remains clear for range queries.",
  };
}

async function clearDatabases(
  plainDb: NostrIDBDatabase,
  encryptedDb: EncryptedNostrIDBDatabase,
  privateDb: PrivateNostrIDBDatabase,
) {
  await Promise.all([
    deleteAllEvents(plainDb),
    plainDb.clear("used"),
    deleteAllEncryptedEvents(encryptedDb),
    encryptedDb.clear("used"),
    deleteAllEncryptedEvents(privateDb),
    privateDb.clear("used"),
  ]);
}

function createBenchmarkEvents(
  count: number,
  contentBytes: number,
): NostrEvent[] {
  const now = Math.floor(Date.now() / 1000);
  const content = "x".repeat(Math.max(1, contentBytes));
  const events: NostrEvent[] = [];

  for (let i = 0; i < count; i++) {
    const id = i.toString(16).padStart(64, "0");
    const pubkey = i % 4 === 0 ? OTHER_PUBKEY : TEST_PUBKEY;
    const kind = i % 10 === 0 ? 7 : 1;
    events.push({
      id,
      pubkey,
      kind,
      created_at: now - i,
      tags: [
        ["t", i % 3 === 0 ? "other-tag" : "encrypted-lab"],
        ["e", (i % 25).toString(16).padStart(64, "0")],
      ],
      content: `${content}:${i}`,
      sig: "f".repeat(128),
    });
  }

  return events;
}

async function time(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

function formatMs(ms: number): string {
  return `${ms.toFixed(ms < 10 ? 2 : 1)} ms`;
}

function preview(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, nestedValue) => {
      if (nestedValue instanceof ArrayBuffer) {
        return `<ArrayBuffer ${nestedValue.byteLength} bytes>`;
      }
      return nestedValue;
    },
    2,
  ).slice(0, 1800);
}
