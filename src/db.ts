import { openDatabase } from "./nostr-idb";

const db = await openDatabase();

// @ts-ignore
window.db = db;

export default db
