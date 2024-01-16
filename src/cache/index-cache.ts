import type { Event } from "nostr-tools";
import { getEventTags } from "../database/ingest.js";

export class IndexCache {
  kinds: Map<number, Set<string>> = new Map();
  pubkeys: Map<string, Set<string>> = new Map();
  tags: Map<string, Set<string>> = new Map();

  get count() {
    return this.kinds.size + this.pubkeys.size + this.tags.size;
  }

  max: number = 1000;
  lastUsed: Set<string>[] = [];
  private useIndex(index: Set<string>) {
    const i = this.lastUsed.indexOf(index);
    if (i !== -1) this.lastUsed.splice(i, i + 1);
    this.lastUsed.push(index);
  }

  getKindIndex(kind: number): Set<string> | undefined {
    const index = this.kinds.get(kind);
    if (index) this.useIndex(index);
    return index;
  }
  setKindIndex(kind: number, index: Set<string>) {
    this.kinds.set(kind, index);
    this.useIndex(index);
    this.pruneIndexes();
  }
  getPubkeyIndex(pubkey: string): Set<string> | undefined {
    const index = this.pubkeys.get(pubkey);
    if (index) this.useIndex(index);
    return index;
  }
  setPubkeyIndex(pubkey: string, index: Set<string>) {
    this.pubkeys.set(pubkey, index);
    this.useIndex(index);
    this.pruneIndexes();
  }
  getTagIndex(tagAndValue: string): Set<string> | undefined {
    const index = this.tags.get(tagAndValue);
    if (index) this.useIndex(index);
    return index;
  }
  setTagIndex(tagAndValue: string, index: Set<string>) {
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
      this.lastUsed.shift();
    }
  }
}
