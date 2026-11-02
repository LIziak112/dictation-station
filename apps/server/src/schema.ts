import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
});
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  expiresAt: integer("expires_at").notNull(),
});
export const audioAccess = sqliteTable(
  "audio_access",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    file: text("file").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.file] })],
);
export const batches = sqliteTable("batches", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  payload: text("payload").notNull(),
  sourceText: text("source_text").notNull().default(""),
  revision: integer("revision").notNull().default(1),
});
export const metadata = sqliteTable("metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
