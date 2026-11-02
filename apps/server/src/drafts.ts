import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { agentDraftInputSchema, serverDraftSchema } from "../../../packages/contract/src/index";
import { drafts } from "./schema";
import type { Store } from "./store";

export class Drafts {
  constructor(readonly store: Store) {}
  list(accountId: string) {
    return this.store.db
      .select()
      .from(drafts)
      .where(eq(drafts.accountId, accountId))
      .all()
      .map((row) => serverDraftSchema.parse(JSON.parse(row.payload)));
  }
  get(accountId: string, id: string) {
    const row = this.store.db
      .select()
      .from(drafts)
      .where(and(eq(drafts.accountId, accountId), eq(drafts.id, id)))
      .get();
    if (!row) throw new HTTPException(404, { message: "草稿不存在或已经确认" });
    return serverDraftSchema.parse(JSON.parse(row.payload));
  }
  create(accountId: string, value: unknown) {
    const input = agentDraftInputSchema.parse(value);
    const draft = {
      ...input,
      id: randomBytes(12).toString("base64url"),
      createdAt: new Date().toISOString(),
    };
    this.store.db
      .insert(drafts)
      .values({ id: draft.id, accountId, payload: JSON.stringify(draft) })
      .run();
    return draft;
  }
  remove(accountId: string, id: string) {
    this.store.db
      .delete(drafts)
      .where(and(eq(drafts.accountId, accountId), eq(drafts.id, id)))
      .run();
  }
  publish(accountId: string, id: string, value: unknown) {
    return this.store.db.transaction(() => {
      this.get(accountId, id);
      const batch = this.store.create(accountId, value);
      this.remove(accountId, id);
      return batch;
    });
  }
}
