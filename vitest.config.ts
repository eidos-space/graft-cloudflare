import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          GRAFT_REMOTE_TOKEN: "personal-test-token-0123456789abcdef0123456789abcdef",
        },
      },
    }),
  ],
  test: {
    coverage: { enabled: false },
  },
});
