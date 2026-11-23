import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.RELAY_URL ?? "http://127.0.0.1:3100", headless: true },
});
