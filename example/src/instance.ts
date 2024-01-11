import { CacheRelay, openDB } from "../../src/index";

const db = await openDB();
const relay = new CacheRelay(db);

// @ts-ignore
window.db = db;

// @ts-ignore
window.relay = relay;

export { relay };
export default db;
