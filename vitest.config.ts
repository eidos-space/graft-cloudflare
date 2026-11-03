import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: process.env.GRAFT_REMOTE_SOURCE_ROOT
      ? Object.fromEntries(["graft-remote", "graft-remote-hono", "graft-remote-cloudflare"].map(name => [`@eidos.space/${name}`, resolve(process.env.GRAFT_REMOTE_SOURCE_ROOT!, "packages", name, "src/index.ts")]))
      : {},
  },
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
