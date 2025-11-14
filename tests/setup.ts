import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { TextEncoder, TextDecoder } from "util";

// Set up fake IndexedDB for all tests
globalThis.indexedDB = new IDBFactory();

// Ensure TextEncoder/TextDecoder are properly available
// @ts-ignore
globalThis.TextEncoder = TextEncoder;
// @ts-ignore
globalThis.TextDecoder = TextDecoder;
