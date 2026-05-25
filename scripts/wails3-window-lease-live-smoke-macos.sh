#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="main"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-window-lease-live-smoke-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to validate smoke JSON reports." >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/arlecchino-wails3-window-lease-smoke.XXXXXX")"
OUTPUT="$TMP_ROOT/bin/Arlecchino-v3"
APP_BUNDLE="$TMP_ROOT/Arlecchino-v3.app"
REPORT="$TMP_ROOT/window-lease-report.json"
STDOUT_LOG="$TMP_ROOT/stdout.log"
STDERR_LOG="$TMP_ROOT/stderr.log"
BUNDLE_ID="${ARLE_WAILS3_WINDOW_LEASE_SMOKE_BUNDLE_ID:-dev.arlecchino.v3windowleasesmoke}"
SIGN_MODE="${ARLE_WAILS3_WINDOW_LEASE_SMOKE_SIGN_MODE:-adhoc}"

cleanup() {
  osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  if [[ "${ARLE_WAILS3_KEEP_WINDOW_LEASE_SMOKE_REPORTS:-0}" == "1" ]]; then
    echo "Keeping Wails v3 Window Lease smoke files at $TMP_ROOT" >&2
    return 0
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
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
Usage: scripts/wails3-window-lease-live-smoke-macos.sh [options]

Options:
  --output <path>       Intermediate Wails v3 binary path.
  --app-bundle <path>   Temporary .app path.
  --report <path>       JSON report path.
  --bundle-id <id>      Temporary bundle id.
  --sign <mode>         none, adhoc, or developer-id.
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
  --version "0.0.0-window-lease-smoke" \
  --build "1" \
  --sign "$SIGN_MODE" >&2

rm -f "$REPORT" "$STDOUT_LOG" "$STDERR_LOG"
open -n \
  --stdout "$STDOUT_LOG" \
  --stderr "$STDERR_LOG" \
  --env "ARLECCHINO_PACKAGED_BUILD=1" \
  --env "ARLECCHINO_DISABLE_SINGLE_INSTANCE=1" \
  --env "ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE=1" \
  --env "ARLECCHINO_WAILS3_WINDOW_LEASE_SMOKE_REPORT=$REPORT" \
  --env "ARLECCHINO_WAILS3_WINDOW_LEASE_SMOKE_QUIT=1" \
  "$APP_BUNDLE"

for _ in {1..300}; do
  if [[ -s "$REPORT" ]] && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$REPORT" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

if [[ ! -s "$REPORT" ]]; then
  echo "ERROR: Window Lease live smoke report was not written: $REPORT" >&2
  if [[ -s "$STDERR_LOG" ]]; then
    cat "$STDERR_LOG" >&2
  fi
  exit 1
fi

node -e '
const fs = require("fs");
const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const check = (condition, message) => {
  if (!condition) fail(message);
};
const required = new Set(["preview", "git-helper", "problems-helper", "terminal-helper"]);
check(report.runtime === "wails-v3", "runtime must be wails-v3");
check(report.spikeEnabled === true, "window lease spike must be enabled");
check(Array.isArray(report.detachProbes) && report.detachProbes.length === 4, "expected four detach probes");
check(Array.isArray(report.returnProbes) && report.returnProbes.length === 4, "expected four return probes");
for (const probe of report.detachProbes) {
  check(probe.handled === true, `detach probe was not handled: ${probe.surfaceId}`);
  check(typeof probe.nativeWindowId === "string" && probe.nativeWindowId.length > 0, `missing nativeWindowId: ${probe.surfaceId}`);
  required.delete(probe.role);
}
check(required.size === 0, `missing roles: ${Array.from(required).join(", ")}`);
for (const probe of report.returnProbes) {
  check(probe.handled === true, `return probe was not handled: ${probe.surfaceId}`);
}
const detachedAfterReturn = (report.afterReturn?.leases || []).filter((lease) => lease.status === "detached");
check(detachedAfterReturn.length === 0, "no leases should remain detached after return");
const failedChecks = (report.checks || []).filter((item) => !item.passed);
check(failedChecks.length === 0, `failed checks: ${failedChecks.map((item) => item.name).join(", ")}`);
' "$REPORT"

cat "$REPORT"
echo "PASS window-lease-live: $REPORT" >&2
