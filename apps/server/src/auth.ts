import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { accounts, metadata, sessions } from "./schema";
import type { Store } from "./store";

const derive = promisify(scrypt);
export const digestToken = (token: string) => createHash("sha256").update(token).digest("hex");
async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
async function matches(password: string, stored: string) {
  const [salt, encoded] = stored.split(":");
  const key = (await derive(password, salt, 64)) as Buffer;
  return timingSafeEqual(key, Buffer.from(encoded, "hex"));
}
export class Auth {
  constructor(private store: Store) {}
  async setDevicePin(accountId: string, deviceId: string, pin: string) {
    const key = `parent-pin:${accountId}:${deviceId}`;
    const value = await hashPassword(pin);
    this.store.db.insert(metadata).values({ key, value }).onConflictDoUpdate({ target: metadata.key, set: { value } }).run();
  }
  async verifyDevicePin(accountId: string, deviceId: string, pin: string) {
    const key = `parent-pin:${accountId}:${deviceId}`;
    const record = this.store.db.select().from(metadata).where(eq(metadata.key, key)).get();
    return record ? await matches(pin, record.value) : null;
  }
  async register(username: string, password: string) {
    const passwordHash = await hashPassword(password);
    return this.store.db
      .insert(accounts)
      .values({
        id: randomBytes(12).toString("base64url"),
        username,
        passwordHash,
      })
      .onConflictDoNothing({ target: accounts.username })
      .returning({ id: accounts.id, username: accounts.username })
      .get();
  }
  async login(username: string, password: string) {
    const account = this.store.db
      .select()
      .from(accounts)
      .where(eq(accounts.username, username))
      .get();
    if (!account || !(await matches(password, account.passwordHash))) return;
    return { id: account.id, username: account.username };
  }
  createSession(accountId: string) {
    const token = randomBytes(32).toString("base64url");
    this.store.db
      .insert(sessions)
      .values({
        tokenHash: digestToken(token),
        accountId,
        expiresAt: Date.now() + 30 * 86400000,
      })
      .run();
    return token;
  }
  current(token: string) {
    return this.store.db
      .select({ id: accounts.id, username: accounts.username })
      .from(sessions)
      .innerJoin(accounts, eq(accounts.id, sessions.accountId))
      .where(and(eq(sessions.tokenHash, digestToken(token)), gt(sessions.expiresAt, Date.now())))
      .get();
  }
  logout(token: string) {
    this.store.db
      .delete(sessions)
      .where(eq(sessions.tokenHash, digestToken(token)))
      .run();
  }
  async changePassword(accountId: string, currentPassword: string, newPassword: string) {
    const account = this.store.db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!account || !(await matches(currentPassword, account.passwordHash))) return false;
    await this.resetPassword(account.username, newPassword);
    return true;
  }
  async resetPassword(username: string, password: string) {
    const passwordHash = await hashPassword(password);
    return this.store.db.transaction((tx) => {
      const account = tx
        .update(accounts)
        .set({ passwordHash })
        .where(eq(accounts.username, username))
        .returning({ id: accounts.id })
        .get();
      if (!account) return false;
      tx.delete(sessions).where(eq(sessions.accountId, account.id)).run();
      return true;
    });
  }
}
