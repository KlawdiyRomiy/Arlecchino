#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="main"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-real-os-smoke-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: real OS handoff smoke is macOS-only." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to validate smoke traces." >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/arlecchino-wails3-real-os-smoke.XXXXXX")"
OUTPUT="$TMP_ROOT/bin/Arlecchino-v3"
APP_BUNDLE="$TMP_ROOT/Arlecchino-v3.app"
APP_BUNDLE_REAL="$APP_BUNDLE"
APP_PROCESS_BIN="$APP_BUNDLE/Contents/MacOS/Arlecchino"
FIXTURE_DIR="$TMP_ROOT/fixture"
MAIN_FILE="$FIXTURE_DIR/main.go"
TRACE="$TMP_ROOT/open-intent.jsonl"
ROUTES="$TMP_ROOT/routes.jsonl"
REPORT="$TMP_ROOT/report.json"
BUNDLE_ID="${ARLE_WAILS3_REAL_OS_SMOKE_BUNDLE_ID:-dev.arlecchino.v3realossmoke}"
SIGN_MODE="${ARLE_WAILS3_REAL_OS_SMOKE_SIGN_MODE:-adhoc}"
OS_OPEN_ROUTE="open -b bundle-id"

cleanup() {
  pkill -f "$APP_PROCESS_BIN" >/dev/null 2>&1 || true
  if [[ "${ARLE_WAILS3_KEEP_REAL_OS_SMOKE:-0}" == "1" ]]; then
    echo "Keeping Wails v3 real OS smoke files at $TMP_ROOT" >&2
    return 0
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

urlencode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"
}

applescript_escape() {
  node -e 'process.stdout.write(process.argv[1].replace(/\\/g, "\\\\").replace(/"/g, "\\\""))' "$1"
}

record_open_route() {
  local label="$1"
  local target="$2"
  local route="$3"
  node -e '
const fs = require("fs");
const [path, label, target, route] = process.argv.slice(1);
fs.appendFileSync(path, `${JSON.stringify({
  label,
  target,
  route,
  timestamp: new Date().toISOString()
})}\n`);
' "$ROUTES" "$label" "$target" "$route"
}

wait_for_app_pid() {
  for _ in {1..200}; do
    if pgrep -f "$APP_PROCESS_BIN" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  echo "ERROR: packaged app did not start." >&2
  if [[ -s "$TMP_ROOT/app.stdout" ]]; then
    echo "--- app stdout ---" >&2
    cat "$TMP_ROOT/app.stdout" >&2
  fi
  if [[ -s "$TMP_ROOT/app.stderr" ]]; then
    echo "--- app stderr ---" >&2
    cat "$TMP_ROOT/app.stderr" >&2
  fi
  exit 1
}

write_failure_report() {
  local label="$1"
  local route="${OS_OPEN_ROUTE:-unknown}"
  node -e '
const fs = require("fs");
const { spawnSync } = require("child_process");

const [
  tracePath,
  reportPath,
  bundleId,
  appBundle,
  appProcessBin,
  route,
  label,
  stdoutPath,
  stderrPath,
  routesPath,
] = process.argv.slice(1);

const readText = (path) => {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return "";
  }
};
const tail = (text) => {
  const lines = text.split(/\n/);
  return lines.slice(Math.max(0, lines.length - 80)).join("\n").trim();
};
const readTrace = () => {
  try {
    return fs.readFileSync(tracePath, "utf8")
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};
const readRoutes = () => {
  try {
    return fs.readFileSync(routesPath, "utf8")
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};
const readPlist = () => {
  const infoPath = `${appBundle}/Contents/Info.plist`;
  const result = spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", infoPath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return {
      path: infoPath,
      error: result.stderr.trim() || result.stdout.trim() || `plutil exited ${result.status}`,
    };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return {
      path: infoPath,
      CFBundleIdentifier: parsed.CFBundleIdentifier,
      CFBundleExecutable: parsed.CFBundleExecutable,
      CFBundleURLTypes: parsed.CFBundleURLTypes,
      CFBundleDocumentTypes: parsed.CFBundleDocumentTypes,
    };
  } catch (error) {
    return { path: infoPath, error: String(error) };
  }
};

const entries = readTrace();
const report = {
  runtime: "wails-v3",
  platform: "darwin",
  passed: false,
  failedCase: label,
  generatedAt: new Date().toISOString(),
  launchServices: {
    bundleId,
    appBundle,
    appProcessBin,
    route,
    infoPlist: readPlist(),
  },
  tracePath,
  traceExists: fs.existsSync(tracePath),
  traceEventCount: entries.length,
  traceStages: [...new Set(entries.map((entry) => entry.stage).filter(Boolean))],
  traceSources: [...new Set(entries.map((entry) => entry.source).filter(Boolean))],
  traceEntries: entries,
  routes: readRoutes(),
  appStdoutTail: tail(readText(stdoutPath)),
  appStderrTail: tail(readText(stderrPath)),
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.error(JSON.stringify(report, null, 2));
' "$TRACE" "$REPORT" "$BUNDLE_ID" "$APP_BUNDLE_REAL" "$APP_PROCESS_BIN" "$route" "$label" "$TMP_ROOT/app.stdout" "$TMP_ROOT/app.stderr" "$ROUTES"
}

wait_for_trace_match() {
  local label="$1"
  local expression="$2"
  for _ in {1..240}; do
    if [[ -s "$TRACE" ]] && node -e '
const fs = require("fs");
const trace = process.argv[1];
const expression = process.argv[2];
const entries = fs.readFileSync(trace, "utf8")
  .split(/\n+/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const ok = Function("entries", `return (${expression});`)(entries);
process.exit(ok ? 0 : 1);
' "$TRACE" "$expression" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  echo "ERROR: timed out waiting for trace case: $label" >&2
  write_failure_report "$label"
  if [[ -f "$TRACE" ]]; then
    cat "$TRACE" >&2
  fi
  if [[ -s "$TMP_ROOT/app.stdout" ]]; then
    echo "--- app stdout ---" >&2
    cat "$TMP_ROOT/app.stdout" >&2
  fi
  if [[ -s "$TMP_ROOT/app.stderr" ]]; then
    echo "--- app stderr ---" >&2
    cat "$TMP_ROOT/app.stderr" >&2
  fi
  exit 1
}

open_registered_target() {
  local label="$1"
  local target="$2"
  local escaped_target
  escaped_target="$(applescript_escape "$target")"
  if [[ "$target" == *"://"* ]]; then
    if open -b "$BUNDLE_ID" -u "$target" 2> "$TMP_ROOT/open-b-url.err"; then
      OS_OPEN_ROUTE="open -b bundle-id -u"
      record_open_route "$label" "$target" "$OS_OPEN_ROUTE"
      return 0
    fi
    if osascript -e "tell application id \"$BUNDLE_ID\" to open location \"$escaped_target\"" > "$TMP_ROOT/osascript-url.out" 2> "$TMP_ROOT/osascript-url.err"; then
      OS_OPEN_ROUTE="osascript open location"
      record_open_route "$label" "$target" "$OS_OPEN_ROUTE"
      return 0
    fi
  else
    if osascript -e "tell application id \"$BUNDLE_ID\" to open POSIX file \"$escaped_target\"" > "$TMP_ROOT/osascript-file.out" 2> "$TMP_ROOT/osascript-file.err"; then
      OS_OPEN_ROUTE="osascript open POSIX file"
      record_open_route "$label" "$target" "$OS_OPEN_ROUTE"
      return 0
    fi
  fi
  if open -b "$BUNDLE_ID" "$target" 2> "$TMP_ROOT/open-b.err"; then
    OS_OPEN_ROUTE="open -b bundle-id"
    record_open_route "$label" "$target" "$OS_OPEN_ROUTE"
    return 0
  fi
  OS_OPEN_ROUTE="open -a app-bundle"
  if open -a "$APP_BUNDLE_REAL" "$target" 2> "$TMP_ROOT/open-a.err"; then
    record_open_route "$label" "$target" "$OS_OPEN_ROUTE"
    return 0
  fi
  echo "ERROR: LaunchServices could not route target to $BUNDLE_ID: $target" >&2
  if [[ -s "$TMP_ROOT/open-b.err" ]]; then
    cat "$TMP_ROOT/open-b.err" >&2
  fi
  if [[ -s "$TMP_ROOT/open-b-url.err" ]]; then
    cat "$TMP_ROOT/open-b-url.err" >&2
  fi
  if [[ -s "$TMP_ROOT/osascript-url.err" ]]; then
    cat "$TMP_ROOT/osascript-url.err" >&2
  fi
  if [[ -s "$TMP_ROOT/osascript-file.err" ]]; then
    cat "$TMP_ROOT/osascript-file.err" >&2
  fi
  if [[ -s "$TMP_ROOT/open-a.err" ]]; then
    cat "$TMP_ROOT/open-a.err" >&2
  fi
  exit 1
}

mkdir -p "$(dirname "$OUTPUT")" "$FIXTURE_DIR"
printf 'package main\n' > "$MAIN_FILE"
printf '# smoke fixture\n' > "$FIXTURE_DIR/README.md"

"$ROOT_DIR/scripts/wails3-package-macos.sh" \
  --output "$OUTPUT" \
  --app-bundle "$APP_BUNDLE" \
  --bundle-id "$BUNDLE_ID" \
  --version "0.0.0-real-os-smoke" \
  --build "1" \
  --sign "$SIGN_MODE" >&2

APP_PROCESS_BIN="$(cd "$APP_BUNDLE/Contents/MacOS" && pwd -P)/Arlecchino"
APP_BUNDLE_REAL="$(cd "$APP_BUNDLE" && pwd -P)"

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [[ ! -x "$LSREGISTER" ]]; then
  echo "ERROR: lsregister not found; cannot run real LaunchServices smoke." >&2
  exit 1
fi
"$LSREGISTER" -f "$APP_BUNDLE_REAL"
sleep 1

open -n \
  --stdout "$TMP_ROOT/app.stdout" \
  --stderr "$TMP_ROOT/app.stderr" \
  --env "ARLECCHINO_DISABLE_MCP_BOOTSTRAP=1" \
  --env "ARLECCHINO_DATA_DIR=$TMP_ROOT/app-data" \
  --env "ARLECCHINO_OPEN_INTENT_TRACE=$TRACE" \
  --env "ARLECCHINO_PACKAGED_BUILD=1" \
  --env "ARLECCHINO_ENABLE_PACKAGED_OS_SPIKE=1" \
  --env "ARLECCHINO_ENABLE_SINGLE_INSTANCE_SPIKE=1" \
  --env "ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE=1" \
  "$APP_BUNDLE" \
  --args
wait_for_app_pid

sleep 1

PROTOCOL_FILE_URL="arlecchino://open?file=$(urlencode "$MAIN_FILE")"
PROTOCOL_PREVIEW_URL="arlecchino://open?preview=https%3A%2F%2Fexample.test%2Fapp"
PROTOCOL_FOCUS_URL="arlecchino://focus?surface=panel:ai-chat"
PROTOCOL_REJECTED_URL="arlecchino://open?command=rm%20-rf%20%2F"

open_registered_target "protocol-open-file" "$PROTOCOL_FILE_URL"
wait_for_trace_match "protocol-open-file" 'entries.some((e) => e.source === "os-url-open" && e.kind === "openFile" && e.payload && e.payload.path && e.payload.path.endsWith("/main.go") && e.stage === "emitted")'

open_registered_target "protocol-open-preview" "$PROTOCOL_PREVIEW_URL"
wait_for_trace_match "protocol-open-preview" 'entries.some((e) => e.source === "os-url-open" && e.kind === "openPreview" && e.payload && e.payload.url === "https://example.test/app" && e.stage === "emitted")'

open_registered_target "protocol-focus" "$PROTOCOL_FOCUS_URL"
wait_for_trace_match "protocol-focus" 'entries.some((e) => e.source === "os-url-open" && e.kind === "focusSurface" && e.payload && e.payload.surfaceId === "panel:aiChat" && e.stage === "emitted")'

open_registered_target "protocol-rejected-command" "$PROTOCOL_REJECTED_URL"
wait_for_trace_match "protocol-rejected-command" 'entries.some((e) => e.source === "os-url-open" && e.stage === "rejected" && e.target && e.target.includes("command="))'

open_registered_target "file-association" "$MAIN_FILE"
wait_for_trace_match "file-association" 'entries.some((e) => e.source === "os-file-open" && e.kind === "openFile" && e.payload && e.payload.path && e.payload.path.endsWith("/main.go") && e.stage === "emitted")'

open -n \
  --env "ARLECCHINO_DISABLE_MCP_BOOTSTRAP=1" \
  --env "ARLECCHINO_DATA_DIR=$TMP_ROOT/app-data" \
  --env "ARLECCHINO_OPEN_INTENT_TRACE=$TRACE" \
  --env "ARLECCHINO_PACKAGED_BUILD=1" \
  --env "ARLECCHINO_ENABLE_PACKAGED_OS_SPIKE=1" \
  --env "ARLECCHINO_ENABLE_SINGLE_INSTANCE_SPIKE=1" \
  "$APP_BUNDLE" --args \
  --open-file "$MAIN_FILE"
wait_for_trace_match "single-instance-open-file" 'entries.some((e) => e.source === "single-instance" && e.kind === "openFile" && e.payload && e.payload.path && e.payload.path.endsWith("/main.go") && e.stage === "emitted")'

node -e '
const fs = require("fs");
const tracePath = process.argv[1];
const reportPath = process.argv[2];
const bundleId = process.argv[3];
const appBundle = process.argv[4];
const route = process.argv[5];
const routesPath = process.argv[6];
const entries = fs.readFileSync(tracePath, "utf8")
  .split(/\n+/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const has = (name, fn) => ({ id: name, passed: entries.some(fn) });
const checks = [
  has("protocol-url-handler-entry", (e) => e.source === "os-url-open" && e.stage === "application-event"),
  has("protocol-open-file", (e) => e.source === "os-url-open" && e.kind === "openFile" && e.stage === "emitted"),
  has("protocol-open-preview", (e) => e.source === "os-url-open" && e.kind === "openPreview" && e.stage === "emitted"),
  has("protocol-focus", (e) => e.source === "os-url-open" && e.kind === "focusSurface" && e.stage === "emitted"),
  has("protocol-rejects-arbitrary-command", (e) => e.source === "os-url-open" && e.stage === "rejected"),
  has("file-handler-entry", (e) => e.source === "os-file-open" && e.stage === "application-event"),
  has("file-association-open", (e) => e.source === "os-file-open" && e.kind === "openFile" && e.stage === "emitted"),
  has("single-instance-handoff", (e) => e.source === "single-instance" && e.kind === "openFile" && e.stage === "emitted"),
];
const routes = fs.existsSync(routesPath)
  ? fs.readFileSync(routesPath, "utf8")
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  : [];
const report = {
  runtime: "wails-v3",
  platform: "darwin",
  generatedAt: new Date().toISOString(),
  scope: {
    launchServices: "registered-smoke-bundle",
    productionDefaultHandlerClaimed: false,
    strictOpenIntentAllowlist: true
  },
  launchServices: {
    bundleId,
    appBundle,
    registered: true,
    route
  },
  tracePath,
  traceEventCount: entries.length,
  routes,
  checks,
  passed: checks.every((check) => check.passed)
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
' "$TRACE" "$REPORT" "$BUNDLE_ID" "$APP_BUNDLE_REAL" "$OS_OPEN_ROUTE" "$ROUTES"

cat "$REPORT"
echo "PASS real-os: $REPORT" >&2
