#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="feature/wails3-shell-spike"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-packaged-smoke-matrix-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to validate smoke JSON reports." >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/arlecchino-wails3-smoke-matrix.XXXXXX")"
OUTPUT="$TMP_ROOT/Arlecchino-v3"
FIXTURE_DIR="$TMP_ROOT/fixture"
REPORT_DIR="$TMP_ROOT/reports"
MAIN_FILE="$FIXTURE_DIR/main.go"
PROJECT_DIR="$FIXTURE_DIR/project"

cleanup() {
  if [[ "${ARLE_WAILS3_KEEP_SMOKE_REPORTS:-0}" == "1" ]]; then
    echo "Keeping Wails v3 smoke matrix reports at $TMP_ROOT" >&2
    return 0
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

mkdir -p "$FIXTURE_DIR" "$PROJECT_DIR" "$REPORT_DIR"
printf 'package main\n' > "$MAIN_FILE"
printf '# smoke fixture\n' > "$PROJECT_DIR/README.md"

ARLE_WAILS3_OUTPUT="$OUTPUT" "$ROOT_DIR/scripts/wails3-packaged-smoke-macos.sh" --build-only

validate_report() {
  local report="$1"
  local name="$2"
  node -e '
const fs = require("fs");
const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const name = process.argv[2];
const fail = (message) => {
  console.error(`${name}: ${message}`);
  process.exit(1);
};
const check = (condition, message) => {
  if (!condition) fail(message);
};
const intent = report.openIntent || {};
check(report.runtime === "wails-v3", "runtime must be wails-v3");
check(report.platform === "darwin", "platform must be darwin for this macOS smoke");
check(report.shellCapabilities && report.shellCapabilities.runtime === "wails-v3", "missing shell capabilities");
check(report.packagedOSIntegration && report.packagedOSIntegration.runtime === "wails-v3", "missing packaged OS snapshot");
check(Array.isArray(report.checks) && report.checks.length > 0, "missing smoke checks");
switch (name) {
  case "default":
    check(!report.openIntent, "default case must not produce an open intent");
    check(report.singleInstance && report.singleInstance.enabled === false, "single-instance must be default-off");
    break;
  case "open-file":
  case "file-url":
  case "protocol-file":
    check(intent.kind === "openFile", "expected openFile intent");
    check(typeof intent.path === "string" && intent.path.endsWith("/main.go"), "openFile path must target fixture main.go");
    check(intent.source === "packaged-smoke", "open intent source must be packaged-smoke");
    break;
  case "preview":
    check(intent.kind === "openPreview", "expected openPreview intent");
    check(intent.surface === "browser", "preview surface must be browser");
    check(intent.url === "https://example.test/app", "preview URL mismatch");
    break;
  case "focus":
    check(intent.kind === "focusSurface", "expected focusSurface intent");
    check(intent.surfaceId === "panel:aiChat", "focus surface must be canonical panel:aiChat");
    break;
  case "gated":
    check(report.singleInstance && report.singleInstance.enabled === true, "single-instance gate must be enabled");
    check(report.windowLease && report.windowLease.available === true, "window lease gate must be available");
    check(report.packagedOSIntegration.packagedBuild === true, "packaged build flag must be true");
    check(report.packagedOSIntegration.spikeEnabled === true, "packaged OS spike flag must be true");
    check(report.packagedOSIntegration.adapters.tray.enabled === true, "tray adapter must be enabled");
    check(report.packagedOSIntegration.adapters.notifications.enabled === true, "notifications adapter must be enabled");
    check(report.packagedOSIntegration.adapters.dockBadges.enabled === true, "dock badge adapter must be enabled");
    break;
  case "app-single-instance":
    check(report.appBundle && report.appBundle.launchMode === "packaged-app", "expected packaged .app launch");
    check(report.singleInstance && report.singleInstance.enabled === true, "single-instance gate must be enabled");
    check(report.secondInstance && report.secondInstance.enabled === true, "second-instance probe must be enabled");
    check(report.secondInstance.openIntentQueued === true, "second-instance probe must queue before frontend-ready");
    check(report.secondInstance.openIntent && report.secondInstance.openIntent.kind === "openFile", "second-instance probe expected openFile intent");
    check(typeof report.secondInstance.openIntent.path === "string" && report.secondInstance.openIntent.path.endsWith("/main.go"), "second-instance openFile path must target fixture main.go");
    check(report.secondInstance.openIntent.source === "single-instance", "second-instance source must be single-instance");
    break;
  case "app-file-url":
  case "app-protocol-file":
    check(report.appBundle && report.appBundle.launchMode === "packaged-app", "expected packaged .app launch");
    check(intent.kind === "openFile", "expected packaged .app openFile intent");
    check(typeof intent.path === "string" && intent.path.endsWith("/main.go"), "packaged .app openFile path must target fixture main.go");
    check(intent.source === "packaged-smoke", "packaged .app open intent source must be packaged-smoke");
    break;
  case "app-protocol-preview":
    check(report.appBundle && report.appBundle.launchMode === "packaged-app", "expected packaged .app launch");
    check(intent.kind === "openPreview", "expected packaged .app openPreview intent");
    check(intent.surface === "browser", "packaged .app preview surface must be browser");
    check(intent.url === "https://example.test/app", "packaged .app preview URL mismatch");
    break;
  case "app-protocol-focus":
    check(report.appBundle && report.appBundle.launchMode === "packaged-app", "expected packaged .app launch");
    check(intent.kind === "focusSurface", "expected packaged .app focusSurface intent");
    check(intent.surfaceId === "panel:aiChat", "packaged .app focus surface must be canonical panel:aiChat");
    break;
  case "app-native-delivery":
    check(report.appBundle && report.appBundle.launchMode === "packaged-app", "expected packaged .app launch");
    check(report.packagedOSIntegration.adapters.tray.enabled === true, "tray adapter must be enabled");
    check(report.packagedOSIntegration.adapters.notifications.enabled === true, "notifications adapter must be enabled");
    check(report.packagedOSIntegration.adapters.dockBadges.enabled === true, "dock badge adapter must be enabled");
    check(report.nativeDelivery && report.nativeDelivery.enabled === true, "native delivery probe must be enabled");
    check(report.nativeDelivery.tray.actionIds.length > 0, "tray probe must expose Background Shell actions only");
    check(report.nativeDelivery.notifications.candidateIds.length > 0, "notification probe must expose dedupe candidates");
    check(report.nativeDelivery.dockBadge.label === "1", "dock badge probe must mirror attention count");
    check(report.nativeDelivery.trackedFailureStates.includes("no-permission"), "native delivery must track no-permission");
    check(report.nativeDelivery.trackedFailureStates.includes("startup-failed"), "native delivery must track startup-failed");
    check(report.nativeDelivery.trackedFailureStates.includes("delivery-failed"), "native delivery must track delivery-failed");
    check(report.nativeDelivery.trackedFailureStates.includes("action-rejected"), "native delivery must track action-rejected");
    break;
  default:
    fail(`unknown validation case ${name}`);
}
' "$report" "$name"
}

run_case() {
  local name="$1"
  shift
  local report="$REPORT_DIR/$name.json"
  "$OUTPUT" wails3-packaged-smoke --pretty --working-dir "$FIXTURE_DIR" -- "$@" > "$report"
  validate_report "$report" "$name"
  echo "PASS $name: $report"
}

run_gated_case() {
  local report="$REPORT_DIR/gated.json"
  env \
    ARLECCHINO_PACKAGED_BUILD=1 \
    ARLECCHINO_ENABLE_PACKAGED_OS_SPIKE=1 \
    ARLECCHINO_ENABLE_SINGLE_INSTANCE_SPIKE=1 \
    ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE=1 \
    ARLECCHINO_ENABLE_NATIVE_TRAY=1 \
    ARLECCHINO_ENABLE_NATIVE_NOTIFICATIONS=1 \
    ARLECCHINO_ENABLE_DOCK_BADGES=1 \
    "$OUTPUT" wails3-packaged-smoke --pretty --working-dir "$FIXTURE_DIR" -- \
      Arlecchino-v3 --open-preview https://example.test/app > "$report"
  validate_report "$report" "gated"
  echo "PASS gated: $report"
}

run_app_single_instance_case() {
  local report="$REPORT_DIR/app-single-instance.json"
  env \
    ARLECCHINO_ENABLE_SINGLE_INSTANCE_SPIKE=1 \
    ARLECCHINO_WAILS3_SMOKE_SECOND_INSTANCE_ARGS='["Arlecchino-v3","--open-file","main.go"]' \
    "$ROOT_DIR/scripts/wails3-packaged-app-smoke-macos.sh" \
      --output "$OUTPUT" \
      --working-dir "$FIXTURE_DIR" > "$report"
  validate_report "$report" "app-single-instance"
  echo "PASS app-single-instance: $report"
}

run_app_case() {
  local name="$1"
  shift
  local report="$REPORT_DIR/$name.json"
  "$ROOT_DIR/scripts/wails3-packaged-app-smoke-macos.sh" \
    --output "$OUTPUT" \
    --working-dir "$FIXTURE_DIR" \
    -- "$@" > "$report"
  validate_report "$report" "$name"
  echo "PASS $name: $report"
}

run_app_native_delivery_case() {
  local report="$REPORT_DIR/app-native-delivery.json"
  env \
    ARLECCHINO_ENABLE_NATIVE_TRAY=1 \
    ARLECCHINO_ENABLE_NATIVE_NOTIFICATIONS=1 \
    ARLECCHINO_ENABLE_DOCK_BADGES=1 \
    ARLECCHINO_WAILS3_SMOKE_BACKGROUND_SAMPLE=1 \
    "$ROOT_DIR/scripts/wails3-packaged-app-smoke-macos.sh" \
      --output "$OUTPUT" \
      --working-dir "$FIXTURE_DIR" > "$report"
  validate_report "$report" "app-native-delivery"
  echo "PASS app-native-delivery: $report"
}

FILE_URL="file://$MAIN_FILE"
PROTOCOL_FILE_URL="arlecchino://open?file=main.go"
FOCUS_URL="arlecchino://focus?surface=panel:ai-chat"

run_case "default" Arlecchino-v3
run_case "open-file" Arlecchino-v3 --open-file main.go
run_case "file-url" Arlecchino-v3 "$FILE_URL"
run_case "protocol-file" Arlecchino-v3 "$PROTOCOL_FILE_URL"
run_case "preview" Arlecchino-v3 --open-preview https://example.test/app
run_case "focus" Arlecchino-v3 "$FOCUS_URL"
run_gated_case
run_app_single_instance_case
run_app_case "app-file-url" Arlecchino-v3 "$FILE_URL"
run_app_case "app-protocol-file" Arlecchino-v3 "$PROTOCOL_FILE_URL"
run_app_case "app-protocol-preview" Arlecchino-v3 "arlecchino://open?preview=https%3A%2F%2Fexample.test%2Fapp"
run_app_case "app-protocol-focus" Arlecchino-v3 "$FOCUS_URL"
run_app_native_delivery_case

echo "Wails v3 packaged smoke matrix passed."
