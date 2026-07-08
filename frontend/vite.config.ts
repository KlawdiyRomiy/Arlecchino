import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react-swc";
import { visualizer } from "rollup-plugin-visualizer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, "..");
const internalReportDir = path.resolve(dirname, ".internal-reports");

const goEnv = (name: string): string => {
  try {
    return execFileSync("go", ["env", name], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

const resolveBundledWailsRuntime = (): string => {
  const override = process.env.ARLECCHINO_WAILS_RUNTIME_JS;
  if (override) {
    const absoluteOverride = path.resolve(override);
    if (!fs.existsSync(absoluteOverride)) {
      throw new Error(
        `ARLECCHINO_WAILS_RUNTIME_JS points to a missing file: ${absoluteOverride}`,
      );
    }
    return absoluteOverride;
  }

  const goMod = fs.readFileSync(path.resolve(projectRoot, "go.mod"), "utf8");
  const version = goMod.match(
    /^\s*github\.com\/wailsapp\/wails\/v3\s+(v[^\s]+)\s*$/m,
  )?.[1];
  if (!version) {
    throw new Error(
      "Unable to resolve github.com/wailsapp/wails/v3 from go.mod",
    );
  }

  const goPath =
    process.env.GOPATH || goEnv("GOPATH") || path.join(os.homedir(), "go");
  const goModCache =
    process.env.GOMODCACHE ||
    goEnv("GOMODCACHE") ||
    path.join(goPath, "pkg", "mod");
  const runtimePath = path.join(
    goModCache,
    `github.com/wailsapp/wails/v3@${version}`,
    "internal",
    "assetserver",
    "bundledassets",
    "runtime.js",
  );
  if (!fs.existsSync(runtimePath)) {
    throw new Error(
      `Official Wails runtime was not found at ${runtimePath}. Run Go module download/bootstrap before ARLECCHINO_REAL_WAILS_RUNTIME=1 dev mode.`,
    );
  }
  return runtimePath;
};

export default defineConfig(({ command, mode }) => {
  const internalAnalyze =
    command === "build" &&
    (process.env.ARLECCHINO_BUNDLE_ANALYZE === "1" ||
      mode === "internal-analyze");
  const useWailsRuntimeStub =
    process.env.ARLECCHINO_TEST_WAILS_RUNTIME === "1" ||
    process.env.ARLECCHINO_WEB_ONLY_WAILS_RUNTIME === "1" ||
    process.env.ARLECCHINO_REAL_WAILS_RUNTIME !== "1";
  const wailsRuntimeModule =
    command === "serve"
      ? useWailsRuntimeStub
        ? path.resolve(dirname, "src/wails/runtimeTestStub.ts")
        : resolveBundledWailsRuntime()
      : null;
  const wailsRuntimeModuleDir = wailsRuntimeModule
    ? path.dirname(wailsRuntimeModule)
    : null;

  const plugins: PluginOption[] = [react()];
  if (internalAnalyze) {
    plugins.push(
      visualizer({
        filename: path.join(internalReportDir, "bundle", "stats.html"),
        title: "Arlecchino internal bundle report",
        template: "treemap",
        gzipSize: true,
        brotliSize: true,
        open: false,
        projectRoot,
      }) as PluginOption,
    );
  }

  return {
    plugins,
    resolve: {
      alias: [
        ...(command === "serve"
          ? [
              {
                find: "/wails/runtime.js",
                replacement: wailsRuntimeModule ?? "/wails/runtime.js",
              },
            ]
          : []),
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
      fs:
        useWailsRuntimeStub || !wailsRuntimeModuleDir
          ? undefined
          : {
              allow: [projectRoot, wailsRuntimeModuleDir],
            },
      watch: {
        ignored: ["**/.arlecchino/**"],
      },
    },
    build: {
      rolldownOptions: {
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
  };
});
