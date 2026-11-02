import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";
import {
  type Batch,
  batchInputSchema,
  batchSchema,
  updateSchema,
} from "../../../packages/contract/src/index";
import { batches, metadata } from "./schema";

export class Conflict extends Error {
  constructor() {
    super("词表版本已变化，请保留草稿并重新载入");
  }
}
export class Store {
  private sqlite: Database.Database;
  private db: ReturnType<typeof drizzle>;
  constructor(public readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.sqlite = new Database(join(dir, "dictation.db"));
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("synchronous = FULL");
    this.db = drizzle(this.sqlite);
    try {
      migrate(this.db, { migrationsFolder: resolve("apps/server/drizzle") });
      this.importLegacy();
    } catch (error) {
      this.sqlite.close();
      throw error;
    }
  }
  close() {
    if (this.sqlite.open) this.sqlite.close();
  }
  private importLegacy() {
    if (this.db.select().from(metadata).where(eq(metadata.key, "legacy_imported")).get()) return;
    const file = join(this.dir, "batches.json");
    if (!existsSync(file)) return;
    let legacy: Record<string, unknown>;
    try {
      legacy = z
        .object({ batches: z.record(z.string(), z.unknown()) })
        .parse(JSON.parse(readFileSync(file, "utf8"))).batches;
    } catch {
      throw new Error("旧词表文件无法读取，请恢复备份或修复 batches.json 后重启；原文件未修改");
    }
    try {
      this.db.transaction((tx) => {
        for (const [id, value] of Object.entries(legacy)) {
          const old = z
            .object({
              createdAt: z.iso.datetime().optional(),
              updatedAt: z.iso.datetime().optional(),
            })
            .passthrough()
            .parse(value);
          const { id: _id, createdAt, updatedAt, ...payload } = old;
          const { sourceText, ...parsed } = batchInputSchema.parse(payload);
          const now = new Date().toISOString();
          const batch = batchSchema.parse({
            ...parsed,
            id,
            revision: 1,
            createdAt: createdAt ?? now,
            updatedAt: updatedAt ?? now,
          });
          tx.insert(batches)
            .values({ id, payload: JSON.stringify(batch), sourceText, revision: 1 })
            .run();
        }
        tx.insert(metadata)
          .values({ key: "legacy_imported", value: new Date().toISOString() })
          .run();
      });
    } catch (error) {
      throw new Error("旧词表导入失败，未修改原文件，请修复数据后重启", { cause: error });
    }
  }
  list(): Batch[] {
    return this.db
      .select()
      .from(batches)
      .all()
      .map((row) => batchSchema.parse(JSON.parse(row.payload)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  get(id: string): Batch | undefined {
    const row = this.db.select().from(batches).where(eq(batches.id, id)).get();
    return row ? batchSchema.parse(JSON.parse(row.payload)) : undefined;
  }
  create(value: unknown) {
    const { sourceText, ...parsed } = batchInputSchema.parse(value);
    const now = new Date().toISOString();
    const batch = batchSchema.parse({
      ...parsed,
      id: randomBytes(12).toString("base64url"),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    this.db
      .insert(batches)
      .values({ id: batch.id, payload: JSON.stringify(batch), sourceText, revision: 1 })
      .run();
    return batch;
  }
  update(id: string, value: unknown) {
    const patch = updateSchema.parse(value);
    return this.db.transaction((tx) => {
      const old = tx.select().from(batches).where(eq(batches.id, id)).get();
      if (!old) return undefined;
      if (old.revision !== patch.revision) throw new Conflict();
      const batch = batchSchema.parse({
        ...JSON.parse(old.payload),
        ...patch,
        revision: old.revision + 1,
        updatedAt: new Date().toISOString(),
      });
      tx.update(batches)
        .set({ payload: JSON.stringify(batch), revision: batch.revision })
        .where(eq(batches.id, id))
        .run();
      return batch;
    });
  }
  delete(id: string, revision: number) {
    return this.db.transaction((tx) => {
      const old = tx.select().from(batches).where(eq(batches.id, id)).get();
      if (!old) return false;
      if (old.revision !== revision) throw new Conflict();
      tx.delete(batches).where(eq(batches.id, id)).run();
      return true;
    });
  }
}
