#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

APP_BUNDLE="/Applications/Arlecchino.app"
REPORT_PATH=""
SHOULD_LAUNCH=1
REQUIRE_NO_DEV_ORPHANS="${ARLE_WAILS3_INSTALLED_SMOKE_REQUIRE_NO_DEV_ORPHANS:-1}"

usage() {
  cat <<'EOF'
Usage: scripts/wails3-installed-app-smoke-macos.sh [options]

Validates an installed or provided Arlecchino.app bundle without creating
tracked artifacts.

Options:
  --app-bundle <path>       App bundle to inspect. Defaults to /Applications/Arlecchino.app
  --report <path>           Write JSON report to this path. Defaults to a temp file.
  --no-launch               Do not launch the app if it is not already running.
  --allow-dev-orphans       Warn about stale dev mcp-server processes without failing.
  --require-no-dev-orphans  Fail when stale dev mcp-server processes are present. Default.
  --help                    Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-bundle)
      APP_BUNDLE="${2:-}"
      shift 2
      ;;
    --report)
      REPORT_PATH="${2:-}"
      shift 2
      ;;
    --no-launch)
      SHOULD_LAUNCH=0
      shift
      ;;
    --allow-dev-orphans)
      REQUIRE_NO_DEV_ORPHANS=0
      shift
      ;;
    --require-no-dev-orphans)
      REQUIRE_NO_DEV_ORPHANS=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "wails3-installed-app-smoke-macos.sh only supports macOS" >&2
  exit 1
fi

if [[ -z "$APP_BUNDLE" ]]; then
  echo "--app-bundle requires a path" >&2
  exit 2
fi

if [[ -z "$REPORT_PATH" ]]; then
  REPORT_PATH="$(mktemp -t arlecchino-installed-app-smoke.XXXXXX.json)"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to write the smoke report" >&2
  exit 1
fi

INFO_PLIST="$APP_BUNDLE/Contents/Info.plist"
APP_EXECUTABLE=""
if [[ -f "$INFO_PLIST" ]]; then
  EXECUTABLE_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$INFO_PLIST" 2>/dev/null || true)"
  if [[ -n "$EXECUTABLE_NAME" ]]; then
    APP_EXECUTABLE="$APP_BUNDLE/Contents/MacOS/$EXECUTABLE_NAME"
  fi
fi

find_app_processes() {
  local exe="$1"
  if [[ -z "$exe" ]]; then
    return 0
  fi
  ps -axo pid=,ppid=,rss=,command= | awk -v exe="$exe" '
    {
      command = $0
      sub(/^[[:space:]]*[0-9]+[[:space:]]+[0-9]+[[:space:]]+[0-9]+[[:space:]]+/, "", command)
      if (command == exe || index(command, exe " ") == 1) {
        print
      }
    }
  '
}

LAUNCHED_BY_SMOKE=0
if [[ "$SHOULD_LAUNCH" == "1" && -d "$APP_BUNDLE" ]]; then
  if [[ -z "$APP_EXECUTABLE" || -z "$(find_app_processes "$APP_EXECUTABLE" 2>/dev/null || true)" ]]; then
    open -n "$APP_BUNDLE"
    LAUNCHED_BY_SMOKE=1
    for _ in {1..40}; do
      if [[ -n "$APP_EXECUTABLE" && -n "$(find_app_processes "$APP_EXECUTABLE" 2>/dev/null || true)" ]]; then
        break
      fi
      sleep 0.25
    done
  fi
fi

TMP_DIR="$(mktemp -d -t arlecchino-installed-smoke.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

PLIST_JSON="$TMP_DIR/info-plist.json"
CODESIGN_OUT="$TMP_DIR/codesign.txt"
SPCTL_OUT="$TMP_DIR/spctl.txt"
PROCESS_OUT="$TMP_DIR/processes.txt"
TCP_OUT="$TMP_DIR/tcp-listeners.txt"
MCP_SOCKETS_OUT="$TMP_DIR/mcp-sockets.txt"
DEV_ORPHANS_OUT="$TMP_DIR/dev-orphans.txt"

if [[ -f "$INFO_PLIST" ]]; then
  plutil -convert json -o "$PLIST_JSON" "$INFO_PLIST" 2>/dev/null || printf '{}\n' > "$PLIST_JSON"
else
  printf '{}\n' > "$PLIST_JSON"
fi

CODESIGN_EXIT=0
codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE" >"$CODESIGN_OUT" 2>&1 || CODESIGN_EXIT=$?

SPCTL_EXIT=0
spctl -a -vv --type execute "$APP_BUNDLE" >"$SPCTL_OUT" 2>&1 || SPCTL_EXIT=$?

if [[ -n "$APP_EXECUTABLE" ]]; then
  find_app_processes "$APP_EXECUTABLE" > "$PROCESS_OUT" || true
else
  : > "$PROCESS_OUT"
fi

lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | rg -i 'Arlecchino|wails' > "$TCP_OUT" || true

find "$HOME/Library/Caches/arlecchino" -maxdepth 1 -type s -name 'mcp-bridge-*.sock' -print > "$MCP_SOCKETS_OUT" 2>/dev/null || true

ps -axo pid=,ppid=,rss=,command= \
  | awk -v target="/tmp/Arlecchino-wails-build/bin/Arlecchino-v3 mcp-server" '
      {
        command = $0
        sub(/^[[:space:]]*[0-9]+[[:space:]]+[0-9]+[[:space:]]+[0-9]+[[:space:]]+/, "", command)
        if (command == target || index(command, target " ") == 1) {
          print
        }
      }
    ' \
  > "$DEV_ORPHANS_OUT" || true

REPORT_PATH="$REPORT_PATH" \
APP_BUNDLE="$APP_BUNDLE" \
INFO_PLIST="$INFO_PLIST" \
APP_EXECUTABLE="$APP_EXECUTABLE" \
LAUNCHED_BY_SMOKE="$LAUNCHED_BY_SMOKE" \
SHOULD_LAUNCH="$SHOULD_LAUNCH" \
REQUIRE_NO_DEV_ORPHANS="$REQUIRE_NO_DEV_ORPHANS" \
PLIST_JSON="$PLIST_JSON" \
CODESIGN_OUT="$CODESIGN_OUT" \
CODESIGN_EXIT="$CODESIGN_EXIT" \
SPCTL_OUT="$SPCTL_OUT" \
SPCTL_EXIT="$SPCTL_EXIT" \
PROCESS_OUT="$PROCESS_OUT" \
TCP_OUT="$TCP_OUT" \
MCP_SOCKETS_OUT="$MCP_SOCKETS_OUT" \
DEV_ORPHANS_OUT="$DEV_ORPHANS_OUT" \
node <<'NODE'
const fs = require("fs");
const path = require("path");

const readText = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

const readLines = (file) =>
  readText(file)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const parseProcessLine = (line) => {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
  if (!match) {
    return { raw: line };
  }
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    rssKB: Number(match[3]),
    command: match[4],
  };
};

let infoPlist = {};
try {
  infoPlist = JSON.parse(readText(process.env.PLIST_JSON));
} catch {
  infoPlist = {};
}

const processRows = readLines(process.env.PROCESS_OUT).map(parseProcessLine);
const tcpListeners = readLines(process.env.TCP_OUT);
const mcpSockets = readLines(process.env.MCP_SOCKETS_OUT);
const devOrphans = readLines(process.env.DEV_ORPHANS_OUT).map(parseProcessLine);
const codesignOutput = readText(process.env.CODESIGN_OUT).trim();
const gatekeeperOutput = readText(process.env.SPCTL_OUT).trim();
const codesignExitCode = Number(process.env.CODESIGN_EXIT || "1");
const gatekeeperExitCode = Number(process.env.SPCTL_EXIT || "1");
const requireNoDevOrphans = process.env.REQUIRE_NO_DEV_ORPHANS === "1";
const appBundlePath = process.env.APP_BUNDLE;
const appBundleName = path.basename(appBundlePath);
const appExists = fs.existsSync(appBundlePath);
const executablePath = process.env.APP_EXECUTABLE || "";
const executableExists = executablePath ? fs.existsSync(executablePath) : false;
const hasTCPListener = tcpListeners.length > 0;
const hasDevOrphans = devOrphans.length > 0;
const shouldLaunch = process.env.SHOULD_LAUNCH === "1";
const runtimeAssetNames = ["arle_model.onnx", "arle_tokenizer.json"];
const runtimeAssetsDir = path.join(appBundlePath, "Contents", "Resources", "assets");
const runtimeAssetFiles = runtimeAssetNames.map((name) => {
  const assetPath = path.join(runtimeAssetsDir, name);
  let readable = false;
  try {
    fs.accessSync(assetPath, fs.constants.R_OK);
    readable = true;
  } catch {
    readable = false;
  }
  let size = 0;
  try {
    size = fs.statSync(assetPath).size;
  } catch {
    size = 0;
  }
  return {
    name,
    path: assetPath,
    exists: fs.existsSync(assetPath),
    readable,
    size,
  };
});
const runtimeAssetsPassed = runtimeAssetFiles.every(
  (file) => file.exists && file.readable && file.size > 0,
);

const report = {
  generatedAt: new Date().toISOString(),
  platform: "darwin",
  runtime: "wails3-local-alpha",
  appBundle: {
    path: appBundlePath,
    name: appBundleName,
    expectedName: "Arlecchino.app",
    exists: appExists,
    executablePath,
    executableExists,
    infoPlistPath: process.env.INFO_PLIST,
    infoPlist: {
      CFBundleName: infoPlist.CFBundleName || null,
      CFBundleDisplayName: infoPlist.CFBundleDisplayName || null,
      CFBundleExecutable: infoPlist.CFBundleExecutable || null,
      CFBundleIdentifier: infoPlist.CFBundleIdentifier || null,
      CFBundleShortVersionString: infoPlist.CFBundleShortVersionString || null,
      CFBundleVersion: infoPlist.CFBundleVersion || null,
      LSMinimumSystemVersion: infoPlist.LSMinimumSystemVersion || null,
      CFBundleURLTypes: infoPlist.CFBundleURLTypes || [],
      CFBundleDocumentTypes: infoPlist.CFBundleDocumentTypes || [],
    },
  },
  codesign: {
    exitCode: codesignExitCode,
    passed: codesignExitCode === 0,
    output: codesignOutput,
  },
  gatekeeper: {
    exitCode: gatekeeperExitCode,
    status: gatekeeperExitCode === 0 ? "accepted" : "expected-rejected-for-adhoc-local-alpha",
    output: gatekeeperOutput,
    note:
      "Ad-hoc local alpha builds are expected to be rejected by spctl when they are not Developer ID signed and notarized.",
  },
  process: {
    launchedBySmoke: process.env.LAUNCHED_BY_SMOKE === "1",
    running: processRows.length > 0,
    rows: processRows,
    webviewProcessHint:
      "Activity Monitor may show wails://localhost for the WebView renderer; this smoke checks real TCP listeners separately.",
  },
  runtimeAssets: {
    assetsDir: runtimeAssetsDir,
    files: runtimeAssetFiles,
    passed: runtimeAssetsPassed,
  },
  network: {
    tcpListeners,
    hasArlecchinoOrWailsTCPListener: hasTCPListener,
  },
  mcpBridge: {
    sockets: mcpSockets,
    present: mcpSockets.length > 0,
  },
  devOrphans: {
    pattern: "/tmp/Arlecchino-wails-build/bin/Arlecchino-v3 mcp-server",
    requireAbsent: requireNoDevOrphans,
    present: hasDevOrphans,
    count: devOrphans.length,
    rows: devOrphans,
  },
};

report.passed =
  report.appBundle.exists &&
  report.appBundle.name === report.appBundle.expectedName &&
  report.appBundle.executableExists &&
  report.codesign.passed &&
  report.runtimeAssets.passed &&
  (!shouldLaunch || report.process.running) &&
  !report.network.hasArlecchinoOrWailsTCPListener &&
  (!shouldLaunch || report.mcpBridge.present) &&
  (!requireNoDevOrphans || !report.devOrphans.present);

fs.mkdirSync(path.dirname(process.env.REPORT_PATH), { recursive: true });
fs.writeFileSync(process.env.REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Installed app smoke report: ${process.env.REPORT_PATH}`);
console.log(JSON.stringify({
  passed: report.passed,
  appBundle: report.appBundle.path,
  codesign: report.codesign.passed,
  gatekeeper: report.gatekeeper.status,
  running: report.process.running,
  runtimeAssets: report.runtimeAssets.passed,
  tcpListeners: report.network.tcpListeners.length,
  mcpBridgeSockets: report.mcpBridge.sockets.length,
  devOrphans: report.devOrphans.count,
}, null, 2));

process.exit(report.passed ? 0 : 1);
NODE
