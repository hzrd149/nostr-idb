import { CacheRelay, openDB } from "../../src/index";

const db = await openDB();
const localRelay = new CacheRelay(db);

await localRelay.connect();

// @ts-ignore
window.db = db;

// @ts-ignore
window.localRelay = localRelay;

export { localRelay };
export default db;
