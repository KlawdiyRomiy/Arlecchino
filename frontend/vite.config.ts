import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "use-sync-external-store/shim/with-selector",
        replacement: "use-sync-external-store/with-selector",
      },
      {
        find: "../cjs/use-sync-external-store-shim/with-selector.production.js",
        replacement: path.resolve(
          dirname,
          "node_modules/use-sync-external-store/cjs/use-sync-external-store-with-selector.production.js",
        ),
      },
      {
        find: "../cjs/use-sync-external-store-shim/with-selector.development.js",
        replacement: path.resolve(
          dirname,
          "node_modules/use-sync-external-store/cjs/use-sync-external-store-with-selector.development.js",
        ),
      },
    ],
  },
  server: {
    watch: {
      ignored: ["**/.arlecchino/**", "**/wailsjs/**"],
    },
  },
  build: {
    rollupOptions: {
      external: ["/wails/runtime.js"],
      onwarn(warning, warn) {
        if (
          warning.code === "UNRESOLVED_IMPORT" &&
          warning.message.includes("@codingame/monaco-vscode")
        ) {
          return;
        }
        warn(warning);
      },
    },
  },
});
