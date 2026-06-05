#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="main"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-custom-protocol-repro-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: Wails custom protocol repro is macOS-only." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to write the repro report." >&2
  exit 1
fi

MODULE_ROOT="$(go env GOMODCACHE)/github.com/wailsapp/wails/v3@v3.0.0-alpha.98"
EXAMPLE_ROOT="$MODULE_ROOT/examples/custom-protocol-example"
if [[ ! -d "$EXAMPLE_ROOT" ]]; then
  echo "ERROR: pinned Wails custom protocol example not found: $EXAMPLE_ROOT" >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/arlecchino-wails3-custom-protocol-repro.XXXXXX")"
WORK_DIR="$TMP_ROOT/custom-protocol-example"
OUTPUT="$TMP_ROOT/bin/custom-protocol-example"
APP_BUNDLE="$TMP_ROOT/WailsCustomProtocolRepro.app"
APP_PROCESS_BIN="$APP_BUNDLE/Contents/MacOS/custom-protocol-example"
APP_PROCESS_NAME="custom-protocol-example"
REPORT="$TMP_ROOT/report.json"
BUNDLE_ID="${ARLE_WAILS3_CUSTOM_PROTOCOL_REPRO_BUNDLE_ID:-dev.arlecchino.wailscustomprotocolrepro}"
SCHEME="${ARLE_WAILS3_CUSTOM_PROTOCOL_REPRO_SCHEME:-wailsexample}"
TARGET_URL="${ARLE_WAILS3_CUSTOM_PROTOCOL_REPRO_URL:-$SCHEME://open?file=main.go}"
OPEN_ROUTE="open -b bundle-id -u"

cleanup() {
  pkill -f "$APP_PROCESS_BIN" >/dev/null 2>&1 || true
  pkill -x "$APP_PROCESS_NAME" >/dev/null 2>&1 || true
  if [[ "${ARLE_WAILS3_KEEP_CUSTOM_PROTOCOL_REPRO:-0}" == "1" ]]; then
    echo "Keeping Wails custom protocol repro files at $TMP_ROOT" >&2
    return 0
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

mkdir -p "$TMP_ROOT/bin"
cp -R "$EXAMPLE_ROOT" "$WORK_DIR"
chmod -R u+w "$WORK_DIR"

perl -0pi -e 's/app\.Event\.Emit\("frontend:ShowURL", e\.Context\(\)\.URL\(\)\)/log.Printf("WAILS_CUSTOM_PROTOCOL_EVENT %s", e.Context().URL())\n\t\tapp.Event.Emit("frontend:ShowURL", e.Context().URL())/' "$WORK_DIR/main.go"

(cd "$WORK_DIR" && \
  go mod init arlecchino-wails-custom-protocol-repro >/dev/null && \
  go mod edit -require github.com/wailsapp/wails/v3@v3.0.0-alpha.98 && \
  go mod edit -replace github.com/wailsapp/wails/v3="$MODULE_ROOT" && \
  go mod tidy >/dev/null && \
  go build -o "$OUTPUT" .)

mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"
cp "$OUTPUT" "$APP_PROCESS_BIN"
cp "$WORK_DIR/build/darwin/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
cp "$WORK_DIR/build/darwin/icons.icns" "$APP_BUNDLE/Contents/Resources/icons.icns"

/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$APP_BUNDLE/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName Wails Custom Protocol Repro" "$APP_BUNDLE/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable custom-protocol-example" "$APP_BUNDLE/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleURLTypes:0:CFBundleURLSchemes:0 $SCHEME" "$APP_BUNDLE/Contents/Info.plist"

codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null
codesign --verify --deep --strict "$APP_BUNDLE" >/dev/null

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [[ ! -x "$LSREGISTER" ]]; then
  echo "ERROR: lsregister not found; cannot run custom protocol repro." >&2
  exit 1
fi
"$LSREGISTER" -f "$APP_BUNDLE"
sleep 1

open -n \
  --stdout "$TMP_ROOT/app.stdout" \
  --stderr "$TMP_ROOT/app.stderr" \
  "$APP_BUNDLE" \
  --args

for _ in {1..200}; do
  if pgrep -f "$APP_PROCESS_BIN" >/dev/null 2>&1 || pgrep -x "$APP_PROCESS_NAME" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
if ! pgrep -f "$APP_PROCESS_BIN" >/dev/null 2>&1 && ! pgrep -x "$APP_PROCESS_NAME" >/dev/null 2>&1; then
  echo "ERROR: Wails custom protocol repro app did not start." >&2
  cat "$TMP_ROOT/app.stderr" >&2 2>/dev/null || true
  exit 1
fi

if open -b "$BUNDLE_ID" -u "$TARGET_URL" 2> "$TMP_ROOT/open-b-url.err"; then
  OPEN_ROUTE="open -b bundle-id -u"
elif osascript -e "open location \"$TARGET_URL\"" 2> "$TMP_ROOT/osascript-open-location.err"; then
  OPEN_ROUTE="osascript open location"
elif open -a "$APP_BUNDLE" "$TARGET_URL" 2> "$TMP_ROOT/open-a-url.err"; then
  OPEN_ROUTE="open -a app-bundle"
else
  echo "ERROR: LaunchServices could not route target to $BUNDLE_ID: $TARGET_URL" >&2
  cat "$TMP_ROOT/open-b-url.err" >&2 2>/dev/null || true
  cat "$TMP_ROOT/osascript-open-location.err" >&2 2>/dev/null || true
  cat "$TMP_ROOT/open-a-url.err" >&2 2>/dev/null || true
  exit 1
fi

PASSED=0
for _ in {1..240}; do
  if rg -F -q "WAILS_CUSTOM_PROTOCOL_EVENT $TARGET_URL" "$TMP_ROOT/app.stderr" "$TMP_ROOT/app.stdout" >/dev/null 2>&1; then
    PASSED=1
    break
  fi
  sleep 0.25
done

node -e '
const fs = require("fs");
const [reportPath, bundleId, appBundle, targetURL, openRoute, passed, stdoutPath, stderrPath] = process.argv.slice(1);
const read = (path) => {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return "";
  }
};
const report = {
  runtime: "wails-v3",
  version: "v3.0.0-alpha.98",
  example: "custom-protocol-example",
  platform: "darwin",
  generatedAt: new Date().toISOString(),
  bundleId,
  appBundle,
  targetURL,
  openRoute,
  passed: passed === "1",
  stdout: read(stdoutPath),
  stderr: read(stderrPath),
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
' "$REPORT" "$BUNDLE_ID" "$APP_BUNDLE" "$TARGET_URL" "$OPEN_ROUTE" "$PASSED" "$TMP_ROOT/app.stdout" "$TMP_ROOT/app.stderr"

cat "$REPORT"
echo "PASS wails-custom-protocol-repro: $REPORT" >&2
