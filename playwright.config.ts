import { chromium, defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5180",
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ??
        (existsSync("/usr/bin/chromium")
          ? "/usr/bin/chromium"
          : chromium.executablePath()),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
  },
  webServer: {
    command: "pnpm run dev --port 5180 --strictPort",
    url: "http://127.0.0.1:5180",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "https://test-project.supabase.co",
      VITE_SUPABASE_ANON_KEY: "browser-test-public-placeholder",
    },
  },
});
