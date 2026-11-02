import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
export const words = sqliteTable(
  "words",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    contentKey: text("content_key").notNull(),
    payload: text("payload").notNull(),
  },
  (table) => [uniqueIndex("words_account_content").on(table.accountId, table.contentKey)],
);
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  payload: text("payload").notNull(),
});
export const attempts = sqliteTable("attempts", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  payload: text("payload").notNull(),
});
