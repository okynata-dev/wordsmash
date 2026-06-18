import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTestDb, type NodeSqliteDb } from "../src/db.js";

const here = dirname(fileURLToPath(import.meta.url));
export const SCHEMA = readFileSync(join(here, "..", "schema.sql"), "utf8");

export async function freshDb(): Promise<NodeSqliteDb> {
  return createTestDb(SCHEMA);
}

export const A = {
  alice: "0x1111111111111111111111111111111111111111",
  bob: "0x2222222222222222222222222222222222222222",
  carol: "0x3333333333333333333333333333333333333333",
  zero: "0x0000000000000000000000000000000000000000",
};
