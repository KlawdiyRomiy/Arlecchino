#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

APP_BUNDLE="/Applications/Arlecchino.app"
REPORT_PATH=""
SHOULD_LAUNCH=1
REQUIRE_NO_DEV_ORPHANS="${ARLE_WAILS3_INSTALLED_SMOKE_REQUIRE_NO_DEV_ORPHANS:-1}"
EXPECTED_BUNDLE_ID="${ARLE_WAILS3_INSTALLED_SMOKE_EXPECTED_BUNDLE_ID:-io.arlecchino.ide.local-beta}"
EXPECTED_IDENTITY_KIND="${ARLE_WAILS3_INSTALLED_SMOKE_EXPECTED_IDENTITY_KIND:-any}"

usage() {
  cat <<'EOF'
Usage: scripts/wails3-installed-app-smoke-macos.sh [options]

Validates an installed or provided Arlecchino.app bundle without creating
tracked artifacts.

Options:
  --app-bundle <path>       App bundle to inspect. Defaults to /Applications/Arlecchino.app
  --report <path>           Write JSON report to this path. Defaults to a temp file.
  --no-launch               Do not launch the app if it is not already running.
  --expected-bundle-id <id> Expected CFBundleIdentifier. Defaults to io.arlecchino.ide.local-beta.
  --allow-any-bundle-id     Do not fail on CFBundleIdentifier mismatch.
  --expected-identity-kind <kind>
                            any, adhoc, local-certificate, developer-id, or unsigned.
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
    --expected-bundle-id)
      EXPECTED_BUNDLE_ID="${2:-}"
      shift 2
      ;;
    --allow-any-bundle-id)
      EXPECTED_BUNDLE_ID=""
      shift
      ;;
    --expected-identity-kind)
      EXPECTED_IDENTITY_KIND="${2:-}"
      shift 2
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

case "$EXPECTED_IDENTITY_KIND" in
  any|adhoc|local-certificate|developer-id|unsigned)
    ;;
  *)
    echo "--expected-identity-kind must be any, adhoc, local-certificate, developer-id, or unsigned" >&2
    exit 2
    ;;
esac

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
CODESIGN_DISPLAY_OUT="$TMP_DIR/codesign-display.txt"
CODESIGN_REQUIREMENT_OUT="$TMP_DIR/codesign-requirement.txt"
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
CODESIGN_DISPLAY_EXIT=0
codesign -dv --verbose=4 "$APP_BUNDLE" >"$CODESIGN_DISPLAY_OUT" 2>&1 || CODESIGN_DISPLAY_EXIT=$?
CODESIGN_REQUIREMENT_EXIT=0
codesign -d -r- "$APP_BUNDLE" >"$CODESIGN_REQUIREMENT_OUT" 2>&1 || CODESIGN_REQUIREMENT_EXIT=$?

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
EXPECTED_BUNDLE_ID="$EXPECTED_BUNDLE_ID" \
EXPECTED_IDENTITY_KIND="$EXPECTED_IDENTITY_KIND" \
PLIST_JSON="$PLIST_JSON" \
CODESIGN_OUT="$CODESIGN_OUT" \
CODESIGN_EXIT="$CODESIGN_EXIT" \
CODESIGN_DISPLAY_OUT="$CODESIGN_DISPLAY_OUT" \
CODESIGN_DISPLAY_EXIT="$CODESIGN_DISPLAY_EXIT" \
CODESIGN_REQUIREMENT_OUT="$CODESIGN_REQUIREMENT_OUT" \
CODESIGN_REQUIREMENT_EXIT="$CODESIGN_REQUIREMENT_EXIT" \
SPCTL_OUT="$SPCTL_OUT" \
SPCTL_EXIT="$SPCTL_EXIT" \
PROCESS_OUT="$PROCESS_OUT" \
TCP_OUT="$TCP_OUT" \
MCP_SOCKETS_OUT="$MCP_SOCKETS_OUT" \
DEV_ORPHANS_OUT="$DEV_ORPHANS_OUT" \
node <<'NODE'
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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

const lipoArchsFor = (value) => {
  if (!value || !fs.existsSync(value)) return [];
  const result = spawnSync("lipo", ["-archs", value], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return [...new Set((result.stdout || "").trim().split(/\s+/).filter(Boolean))].sort();
};

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

const parseCodesignDisplay = (output) => {
  const lineValue = (key) => {
    const match = output.match(new RegExp(`^${key}=(.*)$`, "m"));
    return match ? match[1].trim() : "";
  };
  return {
    signature: lineValue("Signature"),
    cdHash: lineValue("CDHash"),
    teamIdentifier: lineValue("TeamIdentifier"),
    authorities: [...output.matchAll(/^Authority=(.*)$/gm)].map((match) => match[1].trim()),
    raw: output,
  };
};

const inferIdentityKind = ({ codesignPassed, display, designatedRequirement }) => {
  if (!codesignPassed) {
    return "unsigned";
  }
  if (display.signature === "adhoc" || /^(?:#\s*)?designated\s*=>\s*cdhash\s+/m.test(designatedRequirement.trim())) {
    return "adhoc";
  }
  if (display.authorities.some((authority) => authority.includes("Developer ID Application"))) {
    return "developer-id";
  }
  return "local-certificate";
};

const permissionStabilityForIdentity = (identityKind) => {
  if (identityKind === "developer-id") return "public-stable";
  if (identityKind === "local-certificate") return "local-machine-stable";
  return "unstable-after-update";
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
const codesignDisplayOutput = readText(process.env.CODESIGN_DISPLAY_OUT).trim();
const designatedRequirement = readText(process.env.CODESIGN_REQUIREMENT_OUT).trim();
const gatekeeperOutput = readText(process.env.SPCTL_OUT).trim();
const codesignExitCode = Number(process.env.CODESIGN_EXIT || "1");
const codesignDisplayExitCode = Number(process.env.CODESIGN_DISPLAY_EXIT || "1");
const codesignRequirementExitCode = Number(process.env.CODESIGN_REQUIREMENT_EXIT || "1");
const gatekeeperExitCode = Number(process.env.SPCTL_EXIT || "1");
const requireNoDevOrphans = process.env.REQUIRE_NO_DEV_ORPHANS === "1";
const expectedBundleId = process.env.EXPECTED_BUNDLE_ID || "";
const expectedIdentityKind = process.env.EXPECTED_IDENTITY_KIND || "any";
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
const onnxRuntimePath = path.join(appBundlePath, "Contents", "Frameworks", "libonnxruntime.dylib");
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
let onnxRuntimeReadable = false;
try {
  fs.accessSync(onnxRuntimePath, fs.constants.R_OK);
  onnxRuntimeReadable = true;
} catch {
  onnxRuntimeReadable = false;
}
let onnxRuntimeSize = 0;
try {
  onnxRuntimeSize = fs.statSync(onnxRuntimePath).size;
} catch {
  onnxRuntimeSize = 0;
}
const onnxRuntimeFile = {
  name: "libonnxruntime.dylib",
  path: onnxRuntimePath,
  exists: fs.existsSync(onnxRuntimePath),
  readable: onnxRuntimeReadable,
  size: onnxRuntimeSize,
  archs: lipoArchsFor(onnxRuntimePath),
};
const executableArchs = lipoArchsFor(executablePath);
const onnxRuntimeCoversExecutableArchs = executableArchs.every((arch) =>
  onnxRuntimeFile.archs.includes(arch),
);
const runtimeAssetsPassed = runtimeAssetFiles.every(
  (file) => file.exists && file.readable && file.size > 0,
) && onnxRuntimeFile.exists && onnxRuntimeFile.readable && onnxRuntimeFile.size > 0 && onnxRuntimeCoversExecutableArchs;
const codesignDisplay = parseCodesignDisplay(codesignDisplayOutput);
const designatedRequirementIsCdhashOnly = /^(?:#\s*)?designated\s*=>\s*cdhash\s+/m.test(designatedRequirement);
const identityKind = inferIdentityKind({
  codesignPassed: codesignExitCode === 0,
  display: codesignDisplay,
  designatedRequirement,
});
const permissionStability = permissionStabilityForIdentity(identityKind);
const bundleIdMatches = !expectedBundleId || infoPlist.CFBundleIdentifier === expectedBundleId;
const identityKindMatches = expectedIdentityKind === "any" || identityKind === expectedIdentityKind;
const localIdentityStable = identityKind !== "local-certificate" || !designatedRequirementIsCdhashOnly;
const gatekeeperExpectedWarning = identityKind !== "developer-id" && gatekeeperExitCode !== 0;

const report = {
  generatedAt: new Date().toISOString(),
  platform: "darwin",
  runtime: "wails3-local-beta",
  appBundle: {
    path: appBundlePath,
    name: appBundleName,
    expectedName: "Arlecchino.app",
    exists: appExists,
    executablePath,
    executableExists,
    executableArchs,
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
    expectedBundleIdentifier: expectedBundleId || null,
    bundleIdentifierMatches: bundleIdMatches,
  },
  codesign: {
    exitCode: codesignExitCode,
    passed: codesignExitCode === 0,
    output: codesignOutput,
    identityKind,
    expectedIdentityKind,
    identityKindMatches,
    permissionStability,
    permissionWarning:
      identityKind === "adhoc"
        ? "Ad-hoc signatures are tied to the current code instance; macOS may ask for folder access again after updates."
        : identityKind === "local-certificate"
          ? "Local certificate identity is intended to keep macOS permissions stable on this Mac, but it is not public Developer ID trust."
          : identityKind === "developer-id"
            ? "Developer ID is the public outside-App-Store identity path when paired with notarization."
            : "Unsigned apps have no stable macOS signing identity.",
    codeIdentity: {
      signature: codesignDisplay.signature || null,
      cdHash: codesignDisplay.cdHash || null,
      authorities: codesignDisplay.authorities,
      teamIdentifier: codesignDisplay.teamIdentifier || null,
      designatedRequirement,
      designatedRequirementIsCdhashOnly,
      localIdentityStable,
      displayExitCode: codesignDisplayExitCode,
      requirementExitCode: codesignRequirementExitCode,
      displayOutput: codesignDisplay.raw,
    },
  },
  gatekeeper: {
    exitCode: gatekeeperExitCode,
    status: gatekeeperExitCode === 0
      ? "accepted"
      : identityKind === "developer-id"
        ? "rejected"
        : "expected-rejected-for-no-developer-id-local-beta",
    expectedWarning: gatekeeperExpectedWarning,
    output: gatekeeperOutput,
    note:
      "No-Developer-ID local beta builds are expected to be rejected by spctl even when locally code signed.",
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
    onnxRuntime: {
      ...onnxRuntimeFile,
      coversExecutableArchs: onnxRuntimeCoversExecutableArchs,
    },
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
  report.appBundle.bundleIdentifierMatches &&
  report.appBundle.executableExists &&
  report.codesign.passed &&
  report.codesign.identityKindMatches &&
  report.codesign.codeIdentity.localIdentityStable &&
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
  identityKind: report.codesign.identityKind,
  permissionStability: report.codesign.permissionStability,
  gatekeeper: report.gatekeeper.status,
  running: report.process.running,
  runtimeAssets: report.runtimeAssets.passed,
  tcpListeners: report.network.tcpListeners.length,
  mcpBridgeSockets: report.mcpBridge.sockets.length,
  devOrphans: report.devOrphans.count,
}, null, 2));

process.exit(report.passed ? 0 : 1);
NODE
