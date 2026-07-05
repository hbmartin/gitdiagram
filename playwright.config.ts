import { defineConfig, devices } from "@playwright/test";

const APP_PORT = 3100;
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;

/**
 * E2E smoke tests run the real Next app (next backend mode) against fully
 * mocked external services (AI provider, GitHub API, S3, Redis) started from
 * tests/e2e/mock-services.mjs — no network, no keys, deterministic output.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 180_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Sandboxes with a pre-installed Chromium can point at it instead of
        // downloading a matching build (e.g. /opt/pw-browsers/chromium).
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? {
              launchOptions: {
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
              },
            }
          : {}),
      },
    },
  ],
  webServer: [
    {
      command: "bun tests/e2e/mock-services.mjs",
      url: "http://127.0.0.1:4801/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `bun --bun next build && bun --bun next start -p ${APP_PORT}`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 600_000,
      env: {
        NEXT_PUBLIC_GENERATION_BACKEND: "next",
        AI_PROVIDER: "atlas",
        ATLAS_API_KEY: "e2e-test-key",
        ATLAS_BASE_URL: "http://127.0.0.1:4801/v1",
        ATLAS_MODEL: "mock-model",
        GITHUB_API_BASE_URL: "http://127.0.0.1:4802",
        R2_ENDPOINT: "http://127.0.0.1:4803",
        R2_ACCOUNT_ID: "e2e",
        R2_ACCESS_KEY_ID: "e2e",
        R2_SECRET_ACCESS_KEY: "e2e",
        R2_PUBLIC_BUCKET: "e2e-public",
        R2_PRIVATE_BUCKET: "e2e-private",
        CACHE_KEY_SECRET: "e2e-secret",
        UPSTASH_REDIS_REST_URL: "http://127.0.0.1:4804",
        UPSTASH_REDIS_REST_TOKEN: "e2e-token",
        OPENAI_COMPLIMENTARY_GATE_ENABLED: "false",
      },
    },
  ],
});
