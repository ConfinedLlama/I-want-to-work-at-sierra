import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Nothing in the unit suite should touch the network. Tests that need HTTP
    // pass a fake fetch into the client instead.
    restoreMocks: true,
  },
});
