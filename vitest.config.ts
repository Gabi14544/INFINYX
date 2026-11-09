import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/__tests__/*.test.ts"],
    testTimeout: 15_000,
  },
});
