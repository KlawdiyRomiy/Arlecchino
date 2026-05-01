#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="feature/wails3-shell-spike"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-native-delivery-live-smoke-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to validate smoke JSON reports." >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/arlecchino-wails3-native-smoke.XXXXXX")"
OUTPUT="$TMP_ROOT/bin/Arlecchino-v3"
APP_BUNDLE="$TMP_ROOT/Arlecchino-v3.app"
REPORT="$TMP_ROOT/native-delivery-report.json"
STDOUT_LOG="$TMP_ROOT/stdout.log"
STDERR_LOG="$TMP_ROOT/stderr.log"
BUNDLE_ID="${ARLE_WAILS3_NATIVE_SMOKE_BUNDLE_ID:-dev.arlecchino.v3nativesmoke}"
SIGN_MODE="${ARLE_WAILS3_NATIVE_SMOKE_SIGN_MODE:-adhoc}"
INCLUDE_NOTIFICATIONS="0"

cleanup() {
  osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  if [[ "${ARLE_WAILS3_KEEP_NATIVE_SMOKE_REPORTS:-0}" == "1" ]]; then
    echo "Keeping Wails v3 native delivery smoke files at $TMP_ROOT" >&2
    return 0
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --include-notifications)
      INCLUDE_NOTIFICATIONS="1"
      shift
      ;;
    --output)
      shift
      OUTPUT="${1:-}"
      shift
      ;;
    --app-bundle)
      shift
      APP_BUNDLE="${1:-}"
      shift
      ;;
    --report)
      shift
      REPORT="${1:-}"
      shift
      ;;
    --bundle-id)
      shift
      BUNDLE_ID="${1:-}"
      shift
      ;;
    --sign)
      shift
      SIGN_MODE="${1:-}"
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: scripts/wails3-native-delivery-live-smoke-macos.sh [options]

Options:
  --include-notifications   Also request native notification delivery. This may show a macOS permission prompt.
  --output <path>           Intermediate Wails v3 binary path.
  --app-bundle <path>       Temporary .app path.
  --report <path>           JSON report path.
  --bundle-id <id>          Temporary bundle id.
  --sign <mode>             none, adhoc, or developer-id.
EOF
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$(dirname "$OUTPUT")" "$(dirname "$REPORT")"

"$ROOT_DIR/scripts/wails3-package-macos.sh" \
  --output "$OUTPUT" \
  --app-bundle "$APP_BUNDLE" \
  --bundle-id "$BUNDLE_ID" \
  --version "0.0.0-native-smoke" \
  --build "1" \
  --sign "$SIGN_MODE" >&2

rm -f "$REPORT" "$STDOUT_LOG" "$STDERR_LOG"
open -n \
  --stdout "$STDOUT_LOG" \
  --stderr "$STDERR_LOG" \
  --env "ARLECCHINO_PACKAGED_BUILD=1" \
  --env "ARLECCHINO_ENABLE_PACKAGED_OS_SPIKE=1" \
  --env "ARLECCHINO_ENABLE_NATIVE_TRAY=1" \
  --env "ARLECCHINO_ENABLE_NATIVE_NOTIFICATIONS=$INCLUDE_NOTIFICATIONS" \
  --env "ARLECCHINO_ENABLE_DOCK_BADGES=1" \
  --env "ARLECCHINO_WAILS3_NATIVE_DELIVERY_SMOKE_REPORT=$REPORT" \
  --env "ARLECCHINO_WAILS3_NATIVE_DELIVERY_SMOKE_QUIT=1" \
  "$APP_BUNDLE"

for _ in {1..250}; do
  if [[ -s "$REPORT" ]] && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$REPORT" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

if [[ ! -s "$REPORT" ]]; then
  echo "ERROR: native delivery live smoke report was not written: $REPORT" >&2
  if [[ -s "$STDERR_LOG" ]]; then
    cat "$STDERR_LOG" >&2
  fi
  exit 1
fi

node -e '
const fs = require("fs");
const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const includeNotifications = process.argv[2] === "1";
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const check = (condition, message) => {
  if (!condition) fail(message);
};
check(report.runtime === "wails-v3", "runtime must be wails-v3");
check(report.packagedBuild === true, "packagedBuild must be true");
check(report.spikeEnabled === true, "spikeEnabled must be true");
check(report.nativeDelivery && report.nativeDelivery.enabled === true, "native delivery must be enabled");
check(report.nativeDelivery.deliveryAttempted === true, "native delivery must be attempted");
check(report.nativeDelivery.trayReady === true, "tray must be ready");
check(Array.isArray(report.nativeDelivery.trayActionIds) && report.nativeDelivery.trayActionIds.length > 0, "tray must expose Background Shell actions");
check(report.actionProbe && report.actionProbe.accepted === true, "accepted action path must pass");
check(report.actionProbe && report.actionProbe.rejected === true, "rejected action path must be recorded");
check(report.nativeDelivery.dockReady === true, "dock badge service must be ready");
check(report.nativeDelivery.dockBadgeLabel === "1", "dock badge must mirror attention count");
if (includeNotifications) {
  check(report.nativeDelivery.notificationStartupAttempted === true, "notification startup must be attempted");
  check(
    report.nativeDelivery.notificationReady === true ||
      (Array.isArray(report.nativeDelivery.failureStates) && report.nativeDelivery.failureStates.length > 0),
    "notification smoke must either be ready or record a failure state"
  );
}
' "$REPORT" "$INCLUDE_NOTIFICATIONS"

cat "$REPORT"
echo "PASS native-delivery-live: $REPORT" >&2
