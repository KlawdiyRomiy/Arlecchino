import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ["**/.arlecchino/**", "**/wailsjs/**"],
    },
  },
  build: {
    rollupOptions: {
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
