export class NostrIDBWorker extends Worker {
  constructor() {
    super(new URL("./worker.js", import.meta.url), {
      name: "nostr-idb-worker",
      type: "module",
    });
  }
}
export class NostrIDBSharedWorker extends SharedWorker {
  constructor() {
    super(new URL("./shared.js", import.meta.url), {
      name: "nostr-idb-shared-worker",
      type: "module",
    });
  }
}
