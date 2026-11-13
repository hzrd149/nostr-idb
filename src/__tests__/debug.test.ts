import { afterEach, describe, expect, it, vi } from "vitest";
import { configureDiagnostics, logger, startTimer } from "../debug.js";
import { configureDiagnostics as configureDatabase } from "../database/index.js";
import {
  addEvents,
  deleteDB,
  openDB,
  queryForTime,
} from "../database/index.js";
import { WriteQueue } from "../cache/write-queue.js";

afterEach(() => {
  configureDiagnostics({ debug: false, timing: false });
  vi.restoreAllMocks();
});

describe("console diagnostics", () => {
  it("is silent by default", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const time = vi.spyOn(console, "time").mockImplementation(() => {});
    const end = vi.spyOn(console, "timeEnd").mockImplementation(() => {});
    logger("hidden");
    startTimer("hidden")();
    expect(debug).not.toHaveBeenCalled();
    expect(time).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it("shares configuration across entrypoints and controls flags independently", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const time = vi.spyOn(console, "time").mockImplementation(() => {});
    vi.spyOn(console, "timeEnd").mockImplementation(() => {});
    expect(configureDatabase).toBe(configureDiagnostics);
    const log = logger.extend("test");
    configureDatabase({ debug: true });
    log("visible", { count: 2 });
    startTimer("hidden")();
    expect(debug).toHaveBeenCalledWith("[nostr-idb:test]", "visible", {
      count: 2,
    });
    expect(time).not.toHaveBeenCalled();
    configureDiagnostics({ timing: true });
    log("still visible");
    expect(debug).toHaveBeenCalledTimes(2);
    configureDiagnostics({ debug: false });
    log("hidden");
    startTimer("visible")();
    expect(debug).toHaveBeenCalledTimes(2);
    expect(time).toHaveBeenCalledTimes(1);
  });

  it("pairs concurrent timers exactly once across runtime flag changes", () => {
    const time = vi.spyOn(console, "time").mockImplementation(() => {});
    const end = vi.spyOn(console, "timeEnd").mockImplementation(() => {});
    configureDiagnostics({ timing: true });
    const first = startTimer("query", "db");
    const second = startTimer("query", "db");
    configureDiagnostics({ timing: false });
    second();
    first();
    first();
    expect(time.mock.calls[0][0]).not.toBe(time.mock.calls[1][0]);
    expect(end.mock.calls).toEqual([...time.mock.calls].reverse());
  });

  it("closes timers on real database success and failure, and skips idle flushes", async () => {
    const time = vi.spyOn(console, "time").mockImplementation(() => {});
    const end = vi.spyOn(console, "timeEnd").mockImplementation(() => {});
    const db = await openDB("test-diagnostics-" + Date.now());
    try {
      configureDiagnostics({ timing: true });
      await new WriteQueue(db).flush();
      expect(time).not.toHaveBeenCalled();
      await expect(addEvents(db, [])).resolves.toBeUndefined();
      await expect(queryForTime(db, undefined, undefined)).rejects.toThrow(
        "Missing since or until",
      );
      db.close();
      await expect(addEvents(db, [])).rejects.toThrow();
      expect(time).toHaveBeenCalledTimes(3);
      expect(end.mock.calls).toEqual(time.mock.calls);
    } finally {
      configureDiagnostics({ timing: false });
      db.close();
      await deleteDB(db.name);
    }
  });
});
