// Minimal D1-shaped database interface so all queries are written once and run
// against either Cloudflare's D1Database (in the Worker) or a node:sqlite-backed
// adapter (in tests). The surface is intentionally a subset of D1's API.

export interface DbStatement {
  bind(...args: unknown[]): DbStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  // `meta.changes` = rows actually written (D1 shape). Used for atomic
  // insert-and-check (e.g. the replay guard treats 0 changes as "already seen").
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface Db {
  prepare(sql: string): DbStatement;
}

// Cloudflare's D1Database already satisfies `Db` structurally. This is a typed
// pass-through used in the Worker so we don't depend on the workers-types import
// from query modules.
export function asDb(d1: Db): Db {
  return d1;
}

// ---------------------------------------------------------------------------
// node:sqlite adapter (tests only). Node 24 ships `node:sqlite` (DatabaseSync).
// Requires running node with --experimental-sqlite (set in the test script).
// ---------------------------------------------------------------------------

// Structural type for the bits of DatabaseSync we use, to avoid hard-depending
// on @types/node's sqlite typings (which may lag the runtime).
interface SqliteStatement {
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown;
  run(...args: unknown[]): unknown;
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
}

class NodeSqliteStatement implements DbStatement {
  constructor(
    private readonly stmt: SqliteStatement,
    private args: unknown[] = [],
  ) {}

  bind(...args: unknown[]): DbStatement {
    // node:sqlite cannot bind bigint or boolean directly; coerce to safe types.
    const coerced = args.map((a) => {
      if (typeof a === "bigint") return a.toString();
      if (typeof a === "boolean") return a ? 1 : 0;
      return a;
    });
    return new NodeSqliteStatement(this.stmt, coerced);
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.stmt.all(...this.args) as T[] };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.stmt.get(...this.args);
    return (row ?? null) as T | null;
  }

  async run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
    const r = this.stmt.run(...this.args) as { changes?: number | bigint } | undefined;
    return { success: true, meta: { changes: Number(r?.changes ?? 0) } };
  }
}

export class NodeSqliteDb implements Db {
  constructor(private readonly db: SqliteDatabase) {}

  prepare(sql: string): DbStatement {
    return new NodeSqliteStatement(this.db.prepare(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }
}

/**
 * Create an in-memory node:sqlite Db for tests and apply the given schema SQL.
 * `schemaSql` is the contents of schema.sql.
 */
export async function createTestDb(schemaSql: string): Promise<NodeSqliteDb> {
  // Load node:sqlite via a runtime require so bundlers (Vite/esbuild) never try
  // to resolve/pre-bundle the built-in module. `node:module` is a recognized
  // builtin in every runtime that has node:sqlite.
  const mod = await import("node:module");
  const require = mod.createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const raw = new DatabaseSync(":memory:");
  raw.exec(schemaSql);
  return new NodeSqliteDb(raw);
}
