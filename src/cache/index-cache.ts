import type { StoredEvent } from "../lib/nostr.js";
import { logger } from "../debug.js";
import { getEventTags, getEventUID } from "../database/common.js";

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

type IndexNode = {
  index: Index<any>;
  previous?: IndexNode;
  next?: IndexNode;
};

/** In-memory cache for indexes of events */
export class IndexCache {
  kinds: Map<number, Index<number>> = new Map();
  pubkeys: Map<string, Index<string>> = new Map();
  tags: Map<string, Index<string>> = new Map();

  get count() {
    return this.kinds.size + this.pubkeys.size + this.tags.size;
  }

  max: number = 1000;
  private nodes = new Map<Index<any>, IndexNode>();
  private oldest?: IndexNode;
  private newest?: IndexNode;

  /**
   * Snapshot in least-to-most recently used order (O(n)). Mutating the returned
   * array is not supported for changing eviction order; assign it back instead.
   */
  get lastUsed(): Index<any>[] {
    const indexes: Index<any>[] = [];
    for (let node = this.oldest; node; node = node.next) {
      indexes.push(node.index);
    }
    return indexes;
  }

  /**
   * Rebuilds LRU order in O(live indexes + assigned entries). Stale objects are
   * ignored and the last occurrence of a duplicate wins. Omitted live indexes
   * stay oldest in their previous order; untracked live indexes follow them.
   * Assigned live indexes become newest in the supplied order, then max is enforced.
   */
  set lastUsed(indexes: Index<any>[]) {
    const live = new Set<Index<any>>([
      ...this.kinds.values(),
      ...this.pubkeys.values(),
      ...this.tags.values(),
    ]);
    const previous = this.lastUsed;
    this.nodes.clear();
    this.oldest = undefined;
    this.newest = undefined;
    for (const index of previous) {
      if (live.has(index)) this.useIndex(index);
    }
    for (const index of live) {
      if (!this.nodes.has(index)) this.useIndex(index);
    }
    for (const index of indexes) {
      if (live.has(index)) this.useIndex(index);
    }
    this.pruneIndexes();
  }

  private unlink(node: IndexNode) {
    if (node.previous) node.previous.next = node.next;
    else this.oldest = node.next;
    if (node.next) node.next.previous = node.previous;
    else this.newest = node.previous;
    node.previous = undefined;
    node.next = undefined;
  }

  private forgetIndex(index: Index<any> | undefined) {
    if (!index) return;
    const node = this.nodes.get(index);
    if (!node) return;
    this.unlink(node);
    this.nodes.delete(index);
  }

  private useIndex(index: Index<any>) {
    if (this.newest?.index === index) return;
    let node = this.nodes.get(index);
    if (node) this.unlink(node);
    else {
      node = { index };
      this.nodes.set(index, node);
    }
    node.previous = this.newest;
    if (this.newest) this.newest.next = node;
    else this.oldest = node;
    this.newest = node;
  }

  getKindIndex(kind: number): Index<number> | undefined {
    const index = this.kinds.get(kind);
    if (index) this.useIndex(index);
    return index;
  }
  setKindIndex(kind: number, uids: Iterable<string>) {
    const index = new Index<number>(uids, "kind", kind);
    this.forgetIndex(this.kinds.get(kind));
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
    this.forgetIndex(this.pubkeys.get(pubkey));
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
    this.forgetIndex(this.tags.get(tagAndValue));
    this.tags.set(tagAndValue, index);
    this.useIndex(index);
    this.pruneIndexes();
  }

  addEventToIndexes(event: StoredEvent) {
    const uid = getEventUID(event);
    this.getKindIndex(event.kind)?.add(uid);
    this.getPubkeyIndex(event.pubkey)?.add(uid);

    const tags = getEventTags(event);
    for (const tag of tags) {
      this.getTagIndex(tag)?.add(uid);
    }
  }

  removeEvent(event: StoredEvent) {
    const uid = getEventUID(event);
    this.getKindIndex(event.kind)?.delete(uid);
    this.getPubkeyIndex(event.pubkey)?.delete(uid);

    const tags = getEventTags(event);
    for (const tag of tags) {
      this.getTagIndex(tag)?.delete(uid);
    }
  }

  clear() {
    this.kinds.clear();
    this.pubkeys.clear();
    this.tags.clear();
    this.nodes.clear();
    this.oldest = undefined;
    this.newest = undefined;
  }

  pruneIndexes() {
    while (this.oldest && this.nodes.size > this.max) {
      const index = this.oldest.index;
      this.forgetIndex(index);
      log(`Forgetting ${index.type}:${index.key}`);

      switch (index.type) {
        case "kind":
          if (this.kinds.get(index.key) === index) this.kinds.delete(index.key);
          break;
        case "pubkey":
          if (this.pubkeys.get(index.key) === index)
            this.pubkeys.delete(index.key);
          break;
        case "tag":
          if (this.tags.get(index.key) === index) this.tags.delete(index.key);
          break;
      }
    }
  }
}
