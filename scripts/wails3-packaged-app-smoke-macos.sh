#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="feature/wails3-shell-spike"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-packaged-app-smoke-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to validate smoke JSON reports." >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/arlecchino-wails3-app-smoke.XXXXXX")"
OUTPUT="$TMP_ROOT/bin/Arlecchino-v3"
APP_BUNDLE="$TMP_ROOT/Arlecchino-v3.app"
REPORT="$TMP_ROOT/report.json"
FIXTURE_DIR="$TMP_ROOT/fixture"
BUNDLE_ID="${ARLE_WAILS3_APP_SMOKE_BUNDLE_ID:-dev.arlecchino.v3smoke}"
REGISTER_OS_HANDLERS="0"
SIGN_MODE="${ARLE_WAILS3_APP_SMOKE_SIGN_MODE:-adhoc}"
SMOKE_ARGS=()

cleanup() {
  if [[ "${ARLE_WAILS3_KEEP_APP_SMOKE_REPORTS:-0}" == "1" ]]; then
    echo "Keeping Wails v3 packaged app smoke files at $TMP_ROOT" >&2
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
    --working-dir)
      shift
      FIXTURE_DIR="${1:-}"
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
    --register-os-handlers)
      REGISTER_OS_HANDLERS="1"
      shift
      ;;
    --)
      shift
      SMOKE_ARGS=("$@")
      break
      ;;
    *)
      SMOKE_ARGS+=("$1")
      shift
      ;;
  esac
done

mkdir -p "$(dirname "$OUTPUT")" "$FIXTURE_DIR" "$(dirname "$REPORT")"
printf 'package main\n' > "$FIXTURE_DIR/main.go"
printf '# smoke fixture\n' > "$FIXTURE_DIR/README.md"

"$ROOT_DIR/scripts/wails3-package-macos.sh" \
  --output "$OUTPUT" \
  --app-bundle "$APP_BUNDLE" \
  --bundle-id "$BUNDLE_ID" \
  --version "0.0.0-smoke" \
  --build "1" \
  --sign "$SIGN_MODE" >&2

if [[ "$REGISTER_OS_HANDLERS" == "1" ]]; then
  LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
  if [[ -x "$LSREGISTER" ]]; then
    "$LSREGISTER" -f "$APP_BUNDLE"
  else
    echo "WARN: lsregister not found; OS handler registration smoke is skipped." >&2
    REGISTER_OS_HANDLERS="0"
  fi
fi

APP_ENV_ARGS=(
  --env "ARLECCHINO_PACKAGED_BUILD=${ARLECCHINO_PACKAGED_BUILD:-1}"
  --env "ARLECCHINO_ENABLE_PACKAGED_OS_SPIKE=${ARLECCHINO_ENABLE_PACKAGED_OS_SPIKE:-1}"
  --env "ARLECCHINO_ENABLE_SINGLE_INSTANCE_SPIKE=${ARLECCHINO_ENABLE_SINGLE_INSTANCE_SPIKE:-0}"
  --env "ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE=${ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE:-0}"
  --env "ARLECCHINO_ENABLE_NATIVE_TRAY=${ARLECCHINO_ENABLE_NATIVE_TRAY:-0}"
  --env "ARLECCHINO_ENABLE_NATIVE_NOTIFICATIONS=${ARLECCHINO_ENABLE_NATIVE_NOTIFICATIONS:-0}"
  --env "ARLECCHINO_ENABLE_DOCK_BADGES=${ARLECCHINO_ENABLE_DOCK_BADGES:-0}"
  --env "ARLECCHINO_AUTO_UPDATE_MANIFEST=${ARLECCHINO_AUTO_UPDATE_MANIFEST:-}"
  --env "ARLECCHINO_AUTO_UPDATE_CHANNEL=${ARLECCHINO_AUTO_UPDATE_CHANNEL:-alpha}"
  --env "ARLECCHINO_AUTO_UPDATE_PUBLIC_KEY=${ARLECCHINO_AUTO_UPDATE_PUBLIC_KEY:-}"
  --env "ARLECCHINO_ENABLE_AUTO_UPDATE_APPLY_SMOKE=${ARLECCHINO_ENABLE_AUTO_UPDATE_APPLY_SMOKE:-0}"
  --env "ARLECCHINO_WAILS3_SMOKE_SECOND_INSTANCE_ARGS=${ARLECCHINO_WAILS3_SMOKE_SECOND_INSTANCE_ARGS:-}"
  --env "ARLECCHINO_WAILS3_SMOKE_BACKGROUND_SAMPLE=${ARLECCHINO_WAILS3_SMOKE_BACKGROUND_SAMPLE:-0}"
  --env "ARLECCHINO_WAILS3_SMOKE_BUNDLE_ID=$BUNDLE_ID"
  --env "ARLECCHINO_WAILS3_SMOKE_OS_HANDLERS=$REGISTER_OS_HANDLERS"
  --env "ARLECCHINO_WAILS3_SMOKE_BUILD_TARGET=$APP_BUNDLE/Contents/MacOS/Arlecchino"
  --env "ARLECCHINO_WAILS3_SMOKE_LAUNCH_MODE=packaged-app"
  --env "ARLECCHINO_WAILS3_SMOKE_APP_BUNDLE=$APP_BUNDLE"
)

rm -f "$REPORT" "$REPORT.stderr"
open -n \
  --stdout "$REPORT" \
  --stderr "$REPORT.stderr" \
  "${APP_ENV_ARGS[@]}" \
  "$APP_BUNDLE" --args \
  wails3-packaged-smoke --pretty --working-dir "$FIXTURE_DIR" -- \
  "${SMOKE_ARGS[@]}"

for _ in {1..150}; do
  if [[ -s "$REPORT" ]] && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$REPORT" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

if [[ ! -s "$REPORT" ]]; then
  echo "ERROR: packaged app smoke report was not written: $REPORT" >&2
  if [[ -s "$REPORT.stderr" ]]; then
    cat "$REPORT.stderr" >&2
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
if (report.runtime !== "wails-v3") fail("runtime must be wails-v3");
if (!report.appBundle || report.appBundle.launchMode !== "packaged-app") {
  fail("appBundle.launchMode must be packaged-app");
}
if (report.appBundle.bundleId !== process.argv[2]) {
  fail(`bundle id mismatch: ${report.appBundle.bundleId}`);
}
if (!report.appBundle.path || !report.appBundle.path.endsWith(".app")) {
  fail("appBundle.path must point to a .app");
}
' "$REPORT" "$BUNDLE_ID"

cat "$REPORT"
echo "PASS packaged-app: $REPORT" >&2
