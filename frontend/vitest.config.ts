import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "/wails/runtime.js",
        replacement: path.resolve(dirname, "src/wails/runtimeTestStub.ts"),
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
    passWithNoTests: false,
    setupFiles: ["tests/setup/vitest.ts"],
    testTimeout: 10_000,
    watch: false,
  },
});
