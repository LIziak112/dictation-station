import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { tokenCreateSchema, tokenInfoSchema } from "../../../packages/contract/src/index";
import { digestToken } from "./auth";
import { accounts, apiTokens } from "./schema";
import type { Store } from "./store";

export class Tokens {
  constructor(readonly store: Store) {}
  create(accountId: string, value: unknown) {
    const input = tokenCreateSchema.parse(value),
      token = `own_${randomBytes(32).toString("base64url")}`;
    const info = {
      id: randomBytes(12).toString("base64url"),
      name: input.name,
      scopes: input.scopes,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + input.expiresInDays * 86400000).toISOString(),
    };
    this.store.db
      .insert(apiTokens)
      .values({
        id: info.id,
        accountId,
        tokenHash: digestToken(token),
        payload: JSON.stringify(info),
        expiresAt: new Date(info.expiresAt).getTime(),
      })
      .run();
    return { token, info };
  }
  list(accountId: string) {
    return this.store.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.accountId, accountId))
      .all()
      .map((row) => tokenInfoSchema.parse(JSON.parse(row.payload)));
  }
  authenticate(token: string) {
    const row = this.store.db
      .select({ id: accounts.id, username: accounts.username, payload: apiTokens.payload })
      .from(apiTokens)
      .innerJoin(accounts, eq(accounts.id, apiTokens.accountId))
      .where(and(eq(apiTokens.tokenHash, digestToken(token)), gt(apiTokens.expiresAt, Date.now())))
      .get();
    return row
      ? {
          account: { id: row.id, username: row.username },
          scopes: tokenInfoSchema.parse(JSON.parse(row.payload)).scopes,
        }
      : null;
  }
  revoke(accountId: string, id: string) {
    this.store.db
      .delete(apiTokens)
      .where(and(eq(apiTokens.accountId, accountId), eq(apiTokens.id, id)))
      .run();
  }
}
