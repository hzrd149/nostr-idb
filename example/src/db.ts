import { openDatabase } from "../../src/index";

const db = await openDatabase();

// @ts-ignore
window.db = db;

export default db;
