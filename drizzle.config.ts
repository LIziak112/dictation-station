import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  schema: "./apps/server/src/schema.ts",
  out: "./apps/server/drizzle",
});
