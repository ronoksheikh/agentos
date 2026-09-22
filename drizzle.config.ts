import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/database/src/schema.ts",
  out: "./packages/database/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgresql://agentos:agentos@localhost:5432/agentos" },
  strict: true,
});
