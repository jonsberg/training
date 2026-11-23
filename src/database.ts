import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { backup, validate } from "./schema.ts";
import type { Assignment, Day, Measurement, Workout } from "./schema.ts";

type Table = "workouts" | "plan" | "metrics";
const tables = ["workouts", "plan", "metrics"] as const;
type Snapshot = { version: 2; workouts: Workout[]; plan: Assignment[]; metrics: Measurement[]; context: string };
type LegacySnapshot = Omit<Snapshot, "version" | "context"> & { version: 1 };
export const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
export const exerciseKey = (name: string) => name.normalize("NFC").trim().toLowerCase();

export class Diary {
  db: DatabaseSync;

  constructor(path = process.env.TRAINING_DB ?? fileURLToPath(new URL("../data/training.db", import.meta.url))) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS workouts (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plan (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metrics (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS context (id INTEGER PRIMARY KEY CHECK (id = 1), content TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS initialization (id INTEGER PRIMARY KEY CHECK (id = 1));
    `);
    try {
      const seed = process.env.TRAINING_SEED;
      if (seed) this.initialize(seed);
      if (path !== ":memory:") this.initializeContext();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  rows<T>(table: Table): T[] {
    return this.db.prepare(`SELECT payload FROM ${table} ORDER BY rowid`).all()
      .map(row => JSON.parse(String(row.payload)));
  }

  getContext(): string {
    return String(this.db.prepare("SELECT content FROM context WHERE id = 1").get()?.content ?? "");
  }

  setContext(content: string): string {
    this.db.prepare("INSERT INTO context (id, content) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content")
      .run(content);
    return content;
  }

  save<T extends { id: string }>(table: Table, record: T, mode: "create" | "correct"): T {
    return this.transaction(() => {
      const current = this.db.prepare(`SELECT payload FROM ${table} WHERE id = ?`).get(record.id);
      if (mode === "create" && current) {
        if (isDeepStrictEqual(JSON.parse(String(current.payload)), record)) return record;
        throw new Error(`ID already exists: ${record.id}`);
      }
      if (mode === "correct" && !current) throw new Error(`Unknown ID: ${record.id}`);
      this.db.prepare(`INSERT INTO ${table} (id, payload) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`).run(record.id, JSON.stringify(record));
      return record;
    });
  }

  updatePlan(change: { action: "add"; entry: Assignment; position?: number } |
    { action: "remove"; id: string } |
    { action: "move" | "modify"; id: string; day?: Day; position?: number; sets?: number; min?: number; max?: number }) {
    return this.transaction(() => {
      const plan = this.rows<Assignment>("plan");
      const index = plan.findIndex(entry => entry.id === ("entry" in change ? change.entry.id : change.id));
      if (change.action === "add" && index !== -1) {
        if (isDeepStrictEqual(plan[index], change.entry)) return plan;
        throw new Error(`ID already exists: ${change.entry.id}`);
      }
      if (change.action !== "add" && index === -1) throw new Error(`Unknown plan ID: ${change.id}`);
      if (change.action === "remove") {
        plan.splice(index, 1);
      } else {
        const entry = change.action === "add" ? change.entry : plan[index];
        const next = change.action === "add" ? entry : {
          ...entry, day: change.day ?? entry.day, sets: change.sets ?? entry.sets,
          min: change.min ?? entry.min, max: change.max ?? entry.max,
        };
        if (next.min > next.max) throw new Error("Minimum reps exceed maximum reps");
        if (change.action === "modify") {
          plan[index] = next;
        } else {
          if (index !== -1) plan.splice(index, 1);
          const dayIndices = plan.flatMap((item, i) => item.day === next.day ? [i] : []);
          const position = change.position ?? dayIndices.length;
          if (position > dayIndices.length) throw new Error("Position exceeds the number of exercises on that day");
          plan.splice(dayIndices[position] ?? (dayIndices.at(-1) ?? plan.length - 1) + 1, 0, next);
        }
      }
      this.replaceRows("plan", plan);
      return plan;
    });
  }

  snapshot(): Snapshot {
    return this.transaction(() => ({
      version: 2, workouts: this.rows("workouts"), plan: this.rows("plan"), metrics: this.rows("metrics"), context: this.getContext(),
    }));
  }

  restore(input: unknown, replace = false): void {
    this.transaction(() => {
      if (!replace && this.hasRecords()) {
        throw new Error("Database contains data. Use explicit replacement to restore over it.");
      }
      this.loadSnapshot(input);
    });
  }

  private initialize(path: string): void {
    this.transaction(() => {
      if (this.db.prepare("SELECT 1 FROM initialization WHERE id = 1").get()) return;
      if (!this.hasRecords()) {
        let seed: string | undefined;
        try {
          seed = readFileSync(path, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (seed !== undefined) this.loadSnapshot(JSON.parse(seed));
      }
      this.db.exec("INSERT INTO initialization (id) VALUES (1)");
    });
  }

  private initializeContext(): void {
    this.transaction(() => {
      if (this.db.prepare("SELECT 1 FROM context WHERE id = 1").get()) return;
      let content: string;
      try {
        content = readFileSync(fileURLToPath(new URL("../init/context.md", import.meta.url)), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      this.setContext(content);
    });
  }

  private hasRecords(): boolean {
    return tables.some(table => Boolean(this.db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())) ||
      Boolean(this.db.prepare("SELECT 1 FROM context WHERE id = 1").get());
  }

  private loadSnapshot(input: unknown): void {
    validate(backup, input);
    const data = input as Snapshot | LegacySnapshot;
    if (data.plan.some(entry => entry.min > entry.max)) throw new Error("Minimum reps exceed maximum reps");
    for (const table of tables) this.replaceRows(table, data[table]);
    if (data.version === 2) this.setContext(data.context);
    else this.db.exec("DELETE FROM context");
  }

  private replaceRows(table: Table, rows: { id: string }[]) {
    this.db.exec(`DELETE FROM ${table}`);
    const insert = this.db.prepare(`INSERT INTO ${table} (id, payload) VALUES (?, ?)`);
    for (const row of rows) insert.run(row.id, JSON.stringify(row));
  }
}
