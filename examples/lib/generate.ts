import type { NostrEvent } from "../../src/index.ts";

const HEX = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0"),
);

const pool = new Uint8Array(64 * 1024);
let poolOffset = pool.length;

function randomBytes(n: number) {
  if (poolOffset + n > pool.length) {
    crypto.getRandomValues(pool);
    poolOffset = 0;
  }
  const out = pool.subarray(poolOffset, poolOffset + n);
  poolOffset += n;
  return out;
}

export function randomHex(bytes: number) {
  const b = randomBytes(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += HEX[b[i]];
  return s;
}

export function randomInt(max: number) {
  return Math.floor(Math.random() * max);
}

export function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)];
}

const WORDS =
  "nostr bitcoin relay zap note sats freedom keys client protocol signal follow event pubkey filter index database browser lightning value block node mesh sovereign open speech wallet cache query store sync stream".split(
    " ",
  );

export const HASHTAGS =
  "nostr bitcoin art music photography dev memes news food travel gm plebchain zap grownostr asknostr coffee science books running cats".split(
    " ",
  );

export const GENERATOR_KINDS = [0, 1, 3, 6, 7, 10002, 30023] as const;

export type GeneratorOptions = {
  authors: number;
  kinds: number[];
  tagsPerEvent: number;
  hashtags: number;
  contentLength: number;
  spanDays: number;
};

export const DEFAULT_GENERATOR: GeneratorOptions = {
  authors: 50,
  kinds: [1, 7, 6, 0, 30023],
  tagsPerEvent: 3,
  hashtags: 12,
  contentLength: 140,
  spanDays: 30,
};

function words(length: number) {
  let s = "";
  while (s.length < length) s += (s ? " " : "") + pick(WORDS);
  return s.slice(0, length);
}

/** Creates a stateful generator of fake (unsigned but structurally valid) events */
export function createGenerator(opts: GeneratorOptions) {
  const authors = Array.from({ length: Math.max(1, opts.authors) }, () =>
    randomHex(32),
  );
  const hashtags = HASHTAGS.slice(
    0,
    Math.max(1, Math.min(HASHTAGS.length, opts.hashtags)),
  );
  const recentIds: string[] = [];
  const now = Math.floor(Date.now() / 1000);
  const span = Math.max(1, opts.spanDays * 86400);
  const kinds = opts.kinds.length ? opts.kinds : [1];

  function event(kind: number, tags: string[][], content: string): NostrEvent {
    const id = randomHex(32);
    recentIds.push(id);
    if (recentIds.length > 500) recentIds.shift();
    return {
      id,
      pubkey: pick(authors),
      created_at: now - randomInt(span),
      kind,
      tags,
      content,
      sig: randomHex(64),
    };
  }

  function someTags(n: number) {
    const tags: string[][] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      if (r < 0.5) tags.push(["t", pick(hashtags)]);
      else if (r < 0.8) tags.push(["p", pick(authors)]);
      else if (recentIds.length) tags.push(["e", pick(recentIds)]);
    }
    return tags;
  }

  function next(): NostrEvent {
    const kind = pick(kinds);
    const n = opts.tagsPerEvent;
    switch (kind) {
      case 0:
        return event(
          0,
          [],
          JSON.stringify({ name: words(12), about: words(opts.contentLength) }),
        );
      case 3:
        return event(
          3,
          Array.from({ length: n * 5 }, () => ["p", pick(authors)]),
          "",
        );
      case 6:
      case 7: {
        const target = recentIds.length ? pick(recentIds) : randomHex(32);
        return event(
          kind,
          [
            ["e", target],
            ["p", pick(authors)],
          ],
          kind === 7 ? pick(["+", "🤙", "⚡", "❤️"]) : "",
        );
      }
      case 10002:
        return event(
          10002,
          Array.from({ length: Math.max(1, n) }, (_, i) => [
            "r",
            `wss://relay${i}.example.com`,
          ]),
          "",
        );
      case 30023:
        return event(
          30023,
          [
            ["d", "article-" + randomInt(5)],
            ["title", words(30)],
            ...someTags(n),
          ],
          words(opts.contentLength * 10),
        );
      default:
        return event(kind, someTags(n), words(opts.contentLength));
    }
  }

  return { next, authors };
}
