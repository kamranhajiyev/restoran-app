import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

// Database tests: real logins doing real writes on "restoran testing", to check
// who may do what. Run with `npm run test:db`; tests-db/setup.ts refuses any
// other database. Kept apart from `npm test` so that stays fast and offline.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests-db/**/*.test.ts"],
    environment: "node",
    // .env.local only, over anything the shell has: a shell left with another
    // project's SUPABASE_ACCESS_TOKEN sent the database check there (2026-11-01).
    env: parseEnv(readFileSync(".env.local", "utf8")) as Record<string, string>,
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
