import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

// End-to-end tests drive the real till in a real browser against the
// "restoran testing" Supabase project — never production. The keys come from
// .env.e2e (gitignored), not .env.local, which points at production.
const TESTING_PROJECT = "bmqilobhdbipnpkyzomb";

function loadEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnv(".env.e2e");
if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes(TESTING_PROJECT)) {
  throw new Error(`.env.e2e must point at the testing project (${TESTING_PROJECT}), never production`);
}
// The tests themselves read these to set up and clean up.
Object.assign(process.env, env);

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  // One till, one database: tests that share a restaurant must not interleave.
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // The tablet most restaurants use the browser till on.
    { name: "tablet", use: { ...devices["Galaxy Tab S4"] } },
  ],
  webServer: {
    // Values already in the environment win over .env.local, so this server
    // talks to the testing project even though .env.local names production.
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    env,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
