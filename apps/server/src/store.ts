import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  type Batch,
  batchInputSchema,
  batchSchema,
  type Entry,
  entrySchema,
  updateSchema,
} from "../../../packages/contract/src/index";
import { contentKey } from "../../../packages/core/src/tasks";
import { audioAccess, batches, words } from "./schema";

export class Conflict extends Error {
  constructor() {
    super("词表版本已变化，请保留草稿并重新载入");
  }
}
export class Store {
  private sqlite: Database.Database;
  readonly db: ReturnType<typeof drizzle>;
  constructor(public readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.sqlite = new Database(join(dir, "dictation.db"));
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("synchronous = FULL");
    this.db = drizzle(this.sqlite);
    try {
      migrate(this.db, { migrationsFolder: resolve("apps/server/drizzle") });
    } catch (error) {
      this.sqlite.close();
      throw error;
    }
  }
  close() {
    if (this.sqlite.open) this.sqlite.close();
  }
  list(accountId: string): Batch[] {
    return this.db
      .select()
      .from(batches)
      .where(eq(batches.accountId, accountId))
      .all()
      .map((row) => batchSchema.parse(JSON.parse(row.payload)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  get(accountId: string, id: string): Batch | undefined {
    const row = this.db
      .select()
      .from(batches)
      .where(and(eq(batches.id, id), eq(batches.accountId, accountId)))
      .get();
    return row ? batchSchema.parse(JSON.parse(row.payload)) : undefined;
  }
  private canonicalEntries(accountId: string, entries: Entry[]) {
    return entries.map((entry) => {
      const key = contentKey(entry);
      const existing = this.db
        .select()
        .from(words)
        .where(and(eq(words.accountId, accountId), eq(words.contentKey, key)))
        .get();
      const wordId = existing?.id ?? randomBytes(12).toString("base64url");
      if (existing) {
        const stored = entrySchema.parse(JSON.parse(existing.payload));
        const modes = [...new Set([...stored.modes, ...entry.modes])];
        if (modes.length !== stored.modes.length)
          this.db
            .update(words)
            .set({ payload: JSON.stringify({ ...stored, modes }) })
            .where(eq(words.id, existing.id))
            .run();
      }
      if (!existing)
        this.db
          .insert(words)
          .values({
            id: wordId,
            accountId,
            contentKey: key,
            payload: JSON.stringify({ ...entry, id: wordId, wordId }),
          })
          .run();
      return { ...entry, wordId };
    });
  }
  create(accountId: string, value: unknown) {
    const { sourceText, ...parsed } = batchInputSchema.parse(value);
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      const batch: Batch = {
        ...parsed,
        entries: this.canonicalEntries(accountId, parsed.entries),
        id: randomBytes(12).toString("base64url"),
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      this.db
        .insert(batches)
        .values({
          id: batch.id,
          accountId,
          payload: JSON.stringify(batch),
          sourceText,
          revision: 1,
        })
        .run();
      return batch;
    });
  }

  update(accountId: string, id: string, value: unknown) {
    const patch = updateSchema.parse(value);
    return this.db.transaction((tx) => {
      const old = tx
        .select()
        .from(batches)
        .where(and(eq(batches.id, id), eq(batches.accountId, accountId)))
        .get();
      if (!old) return undefined;
      if (old.revision !== patch.revision) throw new Conflict();
      const batch = batchSchema.parse({
        ...JSON.parse(old.payload),
        ...patch,
        ...(patch.entries ? { entries: this.canonicalEntries(accountId, patch.entries) } : {}),
        revision: old.revision + 1,
        updatedAt: new Date().toISOString(),
      });
      tx.update(batches)
        .set({ payload: JSON.stringify(batch), revision: batch.revision })
        .where(and(eq(batches.id, id), eq(batches.accountId, accountId)))
        .run();
      return batch;
    });
  }
  grantAudio(accountId: string, file: string) {
    this.db.insert(audioAccess).values({ accountId, file }).onConflictDoNothing().run();
  }
  hasAudio(accountId: string, file: string) {
    return !!this.db
      .select()
      .from(audioAccess)
      .where(and(eq(audioAccess.accountId, accountId), eq(audioAccess.file, file)))
      .get();
  }
  delete(accountId: string, id: string, revision: number) {
    return this.db.transaction((tx) => {
      const old = tx
        .select()
        .from(batches)
        .where(and(eq(batches.id, id), eq(batches.accountId, accountId)))
        .get();
      if (!old) return false;
      if (old.revision !== revision) throw new Conflict();
      tx.delete(batches)
        .where(and(eq(batches.id, id), eq(batches.accountId, accountId)))
        .run();
      return true;
    });
  }
}
