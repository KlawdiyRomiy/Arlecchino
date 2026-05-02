#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="main"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-release-smoke-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to write release smoke reports." >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/arlecchino-wails3-release-smoke.XXXXXX")"
REPORT_PATH="${ARLE_WAILS3_RELEASE_SMOKE_REPORT:-}"
SIGN_MODE="${ARLE_WAILS3_RELEASE_SMOKE_SIGN_MODE:-adhoc}"
STEPS_JSONL="$TMP_ROOT/steps.jsonl"

cleanup() {
  if [[ "${ARLE_WAILS3_KEEP_RELEASE_SMOKE_REPORTS:-0}" == "1" ]]; then
    echo "Keeping Wails v3 release smoke files at $TMP_ROOT" >&2
    return 0
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

usage() {
  cat <<'EOF'
Usage: scripts/wails3-release-smoke-macos.sh [options]

Options:
  --report <path>   Write a JSON report for all smoke steps.
  --sign <mode>     none, adhoc, or developer-id. Default: adhoc.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --report)
      shift
      REPORT_PATH="${1:-}"
      shift
      ;;
    --sign)
      shift
      SIGN_MODE="${1:-}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$REPORT_PATH" ]]; then
  REPORT_PATH="$TMP_ROOT/release-smoke-report.json"
fi

append_step_result() {
  local id="$1"
  local log_path="$2"
  local exit_code="$3"
  shift 3
  node -e '
const fs = require("fs");
const [jsonlPath, id, logPath, exitCode, ...command] = process.argv.slice(1);
fs.appendFileSync(jsonlPath, `${JSON.stringify({
  id,
  command,
  logPath,
  exitCode: Number(exitCode),
  passed: Number(exitCode) === 0,
})}\n`);
' "$STEPS_JSONL" "$id" "$log_path" "$exit_code" "$@"
}

write_report() {
  local passed="$1"
  node -e '
const fs = require("fs");
const path = require("path");
const [jsonlPath, reportPath, passed, signMode] = process.argv.slice(1);
const steps = fs.existsSync(jsonlPath)
  ? fs.readFileSync(jsonlPath, "utf8")
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  : [];
const report = {
  runtime: "wails-v3",
  platform: "darwin",
  generatedAt: new Date().toISOString(),
  signMode,
  passed: passed === "1",
  scope: {
    realOsHandoff: "registered-smoke-bundle",
    productionDefaultHandlerClaimed: false,
    nativeDeliveryDefaultOn: false,
  },
  steps,
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
' "$STEPS_JSONL" "$REPORT_PATH" "$passed" "$SIGN_MODE"
}

run_step() {
  local id="$1"
  shift
  local log_path="$TMP_ROOT/$id.log"
  set +e
  "$@" >"$log_path" 2>&1
  local exit_code="$?"
  set -e
  append_step_result "$id" "$log_path" "$exit_code" "$@"
  if [[ "$exit_code" != "0" ]]; then
    write_report "0"
    echo "ERROR: release smoke step failed: $id" >&2
    cat "$log_path" >&2
    exit "$exit_code"
  fi
}

run_step "packaged-app" "$ROOT_DIR/scripts/wails3-packaged-app-smoke-macos.sh" --sign "$SIGN_MODE" -- Arlecchino-v3
run_step "real-os-handoff" "$ROOT_DIR/scripts/wails3-real-os-smoke-macos.sh"
run_step "native-delivery-live" "$ROOT_DIR/scripts/wails3-native-delivery-live-smoke-macos.sh" --sign "$SIGN_MODE"
run_step "window-lease-live" "$ROOT_DIR/scripts/wails3-window-lease-live-smoke-macos.sh" --sign "$SIGN_MODE"

write_report "1"

echo "Wails v3 release smoke passed."
echo "Wails v3 release smoke report: $REPORT_PATH"
