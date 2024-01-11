import type { Event } from "nostr-tools";
import { addEvents, updateUsed } from "./ingest";
import { NostrIDB } from "./schema";

export class WriteQueue {
  db: NostrIDB;
  queue: Event[] = [];
  constructor(db: NostrIDB) {
    this.db = db;
  }

  addEvent(event: Event) {
    this.queue.push(event);
  }
  addEvents(events: Event[]) {
    this.queue.push(...events);
  }

  async flush(count = 1000) {
    const events: Event[] = [];
    for (let i = 0; i < count; i++) {
      const event = this.queue.shift();
      if (!event) break;
      events.push(event);
    }

    await addEvents(this.db, events);
    await updateUsed(
      this.db,
      events.map((e) => e.id),
    );
  }

  clear() {
    this.queue = [];
  }
}
