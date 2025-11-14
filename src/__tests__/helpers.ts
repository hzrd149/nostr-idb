import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { NostrEvent, EventTemplate } from "nostr-tools/pure";

const testSecretKey = generateSecretKey();
const testPublicKey = getPublicKey(testSecretKey);

// Counter to ensure unique events (affects content to make unique event IDs)
let eventCounter = 0;

/**
 * Process timestamp - if negative, subtract from current time
 * This allows creating events with relative timestamps like -1, -2, etc.
 */
function processTimestamp(created_at: number | undefined): number {
  if (created_at === undefined) {
    eventCounter++;
    return Math.floor(Date.now() / 1000) + eventCounter;
  }

  if (created_at < 0) {
    // Negative timestamp means "subtract from now"
    return Math.floor(Date.now() / 1000) + created_at;
  }

  return created_at;
}

/**
 * Create a valid, signed Nostr event for testing
 */
export function createTestEvent(
  partial: Partial<EventTemplate> & { kind: number },
): NostrEvent {
  // Increment counter to ensure each event is unique
  eventCounter++;

  const template: EventTemplate = {
    kind: partial.kind,
    created_at: processTimestamp(partial.created_at),
    tags: partial.tags ?? [],
    content: partial.content ?? `test-${eventCounter}`,
  };

  return finalizeEvent(template, testSecretKey);
}

/**
 * Create a test event with a specific ID (for testing purposes)
 * Note: This creates a properly signed event, but you can't control the ID
 * Use this when you need valid events and don't care about the specific ID
 */
export function createValidEvent(
  kind = 1,
  created_at = Math.floor(Date.now() / 1000),
  tags: string[][] = [],
  content = "test",
): NostrEvent {
  return createTestEvent({ kind, created_at, tags, content });
}

/**
 * Get the test public key used for all test events
 */
export function getTestPublicKey(): string {
  return testPublicKey;
}

/**
 * Create multiple test events
 */
export function createTestEvents(count: number, kind = 1): NostrEvent[] {
  return Array.from({ length: count }, (_, i) =>
    createTestEvent({
      kind,
      content: `test event ${i}`,
      created_at: Math.floor(Date.now() / 1000) + i,
    }),
  );
}
