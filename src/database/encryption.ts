import type { NostrEvent } from "../lib/nostr.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type EncryptedEventPayload = {
  version: 1;
  algorithm: "AES-GCM";
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

/** Derives an AES-GCM encryption key from a password and salt. */
export async function deriveEncryptionKey(
  password: string,
  salt: BufferSource,
  iterations = 250_000,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Derives an HMAC-SHA-256 key from a password and salt for private indexes. */
export async function deriveIndexKey(
  password: string,
  salt: BufferSource,
  iterations = 250_000,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    baseKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

/** Imports raw bytes as an AES-GCM encryption key. */
export async function importEncryptionKey(
  raw: BufferSource,
): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Imports raw bytes as an HMAC-SHA-256 private index key. */
export async function importIndexKey(raw: BufferSource): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Encrypts a Nostr event with AES-GCM and caller-provided associated data. */
export async function encryptEvent(
  event: NostrEvent,
  key: CryptoKey,
  associatedData: string,
): Promise<EncryptedEventPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(associatedData),
    },
    key,
    encoder.encode(JSON.stringify(event)),
  );

  return {
    version: 1,
    algorithm: "AES-GCM",
    iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
    ciphertext,
  };
}

/** Decrypts an AES-GCM encrypted Nostr event. */
export async function decryptEvent(
  payload: EncryptedEventPayload,
  key: CryptoKey,
  associatedData: string,
): Promise<NostrEvent> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: payload.algorithm,
      iv: payload.iv,
      additionalData: encoder.encode(associatedData),
    },
    key,
    payload.ciphertext,
  );

  return JSON.parse(decoder.decode(plaintext)) as NostrEvent;
}

/** Returns a deterministic opaque token for an indexed value. */
export async function hmacIndexToken(
  key: CryptoKey,
  namespace: string,
  value: string | number,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${namespace}:${value}`),
  );
  return bytesToHex(new Uint8Array(signature));
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
