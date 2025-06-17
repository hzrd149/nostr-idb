import type { Event } from "nostr-tools";
import { getEventTags } from "../database/ingest.js";
import { logger } from "../debug.js";

const log = logger.extend("cache:indexes");

class Index<T> extends Set<string> {
  type: "kind" | "pubkey" | "tag";
  key: T;

  constructor(
    values: Iterable<string> | null,
    type: "kind" | "pubkey" | "tag",
    key: T,
  ) {
    super(values);
    this.type = type;
    this.key = key;
  }
}

/** In-memory cache for indexes of events */
export class IndexCache {
  kinds: Map<number, Index<number>> = new Map();
  pubkeys: Map<string, Index<string>> = new Map();
  tags: Map<string, Index<string>> = new Map();

  get count() {
    return this.kinds.size + this.pubkeys.size + this.tags.size;
  }

  max: number = 1000;
  lastUsed: Index<any>[] = [];
  private useIndex(index: Index<any>) {
    const i = this.lastUsed.indexOf(index);
    if (i !== -1) this.lastUsed.splice(i, i + 1);
    this.lastUsed.push(index);
  }

  getKindIndex(kind: number): Index<number> | undefined {
    const index = this.kinds.get(kind);
    if (index) this.useIndex(index);
    return index;
  }
  setKindIndex(kind: number, uids: Iterable<string>) {
    const index = new Index<number>(uids, "kind", kind);
    this.kinds.set(kind, index);
    this.useIndex(index);
    this.pruneIndexes();
  }
  getPubkeyIndex(pubkey: string): Index<string> | undefined {
    const index = this.pubkeys.get(pubkey);
    if (index) this.useIndex(index);
    return index;
  }
  setPubkeyIndex(pubkey: string, uids: Iterable<string>) {
    const index = new Index<string>(uids, "pubkey", pubkey);
    this.pubkeys.set(pubkey, index);
    this.useIndex(index);
    this.pruneIndexes();
  }
  getTagIndex(tagAndValue: string): Index<string> | undefined {
    const index = this.tags.get(tagAndValue);
    if (index) this.useIndex(index);
    return index;
  }
  setTagIndex(tagAndValue: string, uids: Iterable<string>) {
    const index = new Index<string>(uids, "tag", tagAndValue);
    this.tags.set(tagAndValue, index);
    this.useIndex(index);
    this.pruneIndexes();
  }

  addEventToIndexes(event: Event) {
    this.getKindIndex(event.kind)?.add(event.id);
    this.getPubkeyIndex(event.pubkey)?.add(event.id);

    const tags = getEventTags(event);
    for (const tag of tags) {
      this.getTagIndex(tag)?.add(event.id);
    }
  }

  pruneIndexes() {
    while (this.lastUsed.length > 0 && this.lastUsed.length > this.max) {
      const index = this.lastUsed.shift();
      if (!index) return;
      log(`Forgetting ${index.type}:${index.key}`);

      switch (index.type) {
        case "kind":
          this.kinds.delete(index.key);
          break;
        case "pubkey":
          this.pubkeys.delete(index.key);
          break;
        case "tag":
          this.tags.delete(index.key);
          break;
      }
    }
  }
}
