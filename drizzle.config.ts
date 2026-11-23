import { defineConfig } from "drizzle-kit";

// Reads the connection string from the environment: `DATABASE_URL=postgres://… npx drizzle-kit push`.
// No credentials are hardcoded, and a missing DATABASE_URL fails loudly instead of silently no-op'ing.
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for drizzle-kit (e.g. DATABASE_URL=postgres://user:pass@host:5432/db npx drizzle-kit push)");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: { url: process.env.DATABASE_URL },
});
