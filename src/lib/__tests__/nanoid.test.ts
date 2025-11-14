import { describe, it, expect } from "vitest";
import { nanoid } from "../nanoid.js";

describe("nanoid", () => {
  it("should generate a string of default length 21", () => {
    const id = nanoid();
    expect(id).toHaveLength(21);
  });

  it("should generate a string of custom length", () => {
    const id = nanoid(10);
    expect(id).toHaveLength(10);
  });

  it("should generate unique IDs", () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      ids.add(nanoid());
    }
    expect(ids.size).toBe(1000);
  });

  it("should only contain valid characters", () => {
    const validChars = /^[a-zA-Z0-9_-]+$/;
    for (let i = 0; i < 100; i++) {
      const id = nanoid();
      expect(id).toMatch(validChars);
    }
  });

  it("should generate different IDs on consecutive calls", () => {
    const id1 = nanoid();
    const id2 = nanoid();
    expect(id1).not.toBe(id2);
  });

  it("should handle size of 1", () => {
    const id = nanoid(1);
    expect(id).toHaveLength(1);
  });

  it("should handle large sizes", () => {
    const id = nanoid(100);
    expect(id).toHaveLength(100);
  });
});
