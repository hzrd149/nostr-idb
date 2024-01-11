import { openDB } from "../../src/index";

const db = await openDB();

// @ts-ignore
window.db = db;

export default db;
