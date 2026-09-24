import { resolve } from "node:path";
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // SWC (not esbuild) so Nest's decorator metadata is emitted.
  plugins: [swc.vite({ module: { type: "es6" } })],
  resolve: {
    alias: { "@flowboard/shared": resolve(__dirname, "../../packages/shared/src/index.ts") },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each file boots its own in-memory database; run files one at a time to keep memory low.
    fileParallelism: false,
  },
});
