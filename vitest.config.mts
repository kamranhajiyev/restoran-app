import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Fast tests: the till's logic without a browser, a server or a database.
// Run with `npm test`. The slow, real-browser tests live in e2e/ (Playwright).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
