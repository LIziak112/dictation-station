import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import {
  type ChildTokenInfo,
  childTokenInfoSchema,
  tokenCreateSchema,
  tokenInfoSchema,
} from "../../../packages/contract/src/index";
import { digestToken } from "./auth";
import { accounts, apiTokens } from "./schema";
import type { Store } from "./store";

function summarizeAgent(ua: string) {
  if (!ua) return "浏览器";
  if (/iPad/i.test(ua)) return "iPad";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return "安卓平板/手机";
  if (/Macintosh|Mac OS/i.test(ua)) return "Mac 浏览器";
  if (/Windows/i.test(ua)) return "Windows 浏览器";
  return "其他设备";
}

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
      .flatMap((row) => {
        const raw: unknown = JSON.parse(row.payload);
        if (typeof raw === "object" && raw !== null && "kind" in raw && raw.kind === "child")
          return [];
        const parsed = tokenInfoSchema.safeParse(raw);
        return parsed.success ? [parsed.data] : [];
      });
  }
  authenticate(token: string) {
    if (!token || token.startsWith("ct_")) return null;
    const row = this.store.db
      .select({ id: accounts.id, username: accounts.username, payload: apiTokens.payload })
      .from(apiTokens)
      .innerJoin(accounts, eq(accounts.id, apiTokens.accountId))
      .where(and(eq(apiTokens.tokenHash, digestToken(token)), gt(apiTokens.expiresAt, Date.now())))
      .get();
    if (!row) return null;
    const raw: unknown = JSON.parse(row.payload);
    if (typeof raw === "object" && raw !== null && "kind" in raw && raw.kind === "child")
      return null;
    const parsed = tokenInfoSchema.safeParse(raw);
    return parsed.success
      ? {
          account: { id: row.id, username: row.username },
          scopes: parsed.data.scopes,
        }
      : null;
  }
  revoke(accountId: string, id: string) {
    this.store.db
      .delete(apiTokens)
      .where(and(eq(apiTokens.accountId, accountId), eq(apiTokens.id, id)))
      .run();
  }
  createChildToken(accountId: string, expiresInDays = 30) {
    const token = `ct_${randomBytes(24).toString("base64url")}`;
    const info: ChildTokenInfo = {
      id: randomBytes(12).toString("base64url"),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expiresInDays * 86400000).toISOString(),
      lastAccessedAt: null,
      lastAccessAgent: "",
    };
    this.store.db
      .insert(apiTokens)
      .values({
        id: info.id,
        accountId,
        tokenHash: digestToken(token),
        payload: JSON.stringify({ kind: "child", ...info }),
        expiresAt: new Date(info.expiresAt).getTime(),
      })
      .run();
    return { token, info };
  }
  listChildTokens(accountId: string): ChildTokenInfo[] {
    const now = Date.now();
    return this.store.db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.accountId, accountId), gt(apiTokens.expiresAt, now)))
      .all()
      .flatMap((row) => {
        const raw: unknown = JSON.parse(row.payload);
        if (typeof raw !== "object" || raw === null || !("kind" in raw) || raw.kind !== "child")
          return [];
        const parsed = childTokenInfoSchema.safeParse(raw);
        return parsed.success ? [parsed.data] : [];
      });
  }
  rotateChildToken(accountId: string, expiresInDays = 30) {
    return this.store.db.transaction(() => {
      const rows = this.store.db
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.accountId, accountId))
        .all();
      for (const row of rows) {
        const raw: unknown = JSON.parse(row.payload);
        if (typeof raw === "object" && raw !== null && "kind" in raw && raw.kind === "child") {
          this.store.db.delete(apiTokens).where(eq(apiTokens.id, row.id)).run();
        }
      }
      this.store.logAudit(
        accountId,
        "child_token.rotated",
        "重置孩子区专属免密链接与二维码",
        "parent",
      );
      return this.createChildToken(accountId, expiresInDays);
    });
  }
  authenticateChild(token: string, userAgent = "") {
    if (!token) return null;
    const row = this.store.db
      .select({
        tokenId: apiTokens.id,
        id: accounts.id,
        username: accounts.username,
        payload: apiTokens.payload,
      })
      .from(apiTokens)
      .innerJoin(accounts, eq(accounts.id, apiTokens.accountId))
      .where(and(eq(apiTokens.tokenHash, digestToken(token)), gt(apiTokens.expiresAt, Date.now())))
      .get();
    if (!row) return null;
    const raw: unknown = JSON.parse(row.payload);
    if (typeof raw !== "object" || raw === null || !("kind" in raw) || raw.kind !== "child")
      return null;
    const parsed = childTokenInfoSchema.safeParse(raw);
    if (!parsed.success) return null;
    const now = new Date().toISOString();
    const lastMs = parsed.data.lastAccessedAt ? new Date(parsed.data.lastAccessedAt).getTime() : 0;
    const agent = summarizeAgent(userAgent);
    if (Date.now() - lastMs > 10_000 || parsed.data.lastAccessAgent !== agent) {
      const updated: ChildTokenInfo = {
        ...parsed.data,
        lastAccessedAt: now,
        lastAccessAgent: agent,
      };
      this.store.db
        .update(apiTokens)
        .set({ payload: JSON.stringify({ kind: "child", ...updated }) })
        .where(eq(apiTokens.id, row.tokenId))
        .run();
      return { account: { id: row.id, username: row.username }, info: updated };
    }
    return { account: { id: row.id, username: row.username }, info: parsed.data };
  }
}
