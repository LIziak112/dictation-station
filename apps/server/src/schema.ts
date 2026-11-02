import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const batches = sqliteTable("batches", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  sourceText: text("source_text").notNull().default(""),
  revision: integer("revision").notNull().default(1),
});
export const metadata = sqliteTable("metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
