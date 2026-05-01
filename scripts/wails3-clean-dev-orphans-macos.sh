#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

TARGET_COMMAND="${ARLE_WAILS3_DEV_ORPHAN_COMMAND:-/tmp/Arlecchino-wails-build/bin/Arlecchino-v3 mcp-server}"
DRY_RUN=0
JSON_REPORT=""

usage() {
  cat <<'EOF'
Usage: scripts/wails3-clean-dev-orphans-macos.sh [options]

Terminates stale Wails v3 dev mcp-server processes. It only matches commands
that start with /tmp/Arlecchino-wails-build/bin/Arlecchino-v3 mcp-server and
never targets installed /Applications/Arlecchino.app processes.

Options:
  --dry-run          List matching processes without terminating them.
  --json <path>      Write a JSON cleanup report to this path.
  --help             Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --json)
      JSON_REPORT="${2:-}"
      shift 2
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
  echo "wails3-clean-dev-orphans-macos.sh only supports macOS" >&2
  exit 1
fi

find_orphan_rows() {
  ps -axo pid=,ppid=,rss=,command= | awk -v target="$TARGET_COMMAND" -v self="$$" '
    {
      pid = $1
      ppid = $2
      rss = $3
      command = $0
      sub(/^[[:space:]]*[0-9]+[[:space:]]+[0-9]+[[:space:]]+[0-9]+[[:space:]]+/, "", command)
      if (pid == self) {
        next
      }
      if (command == target || index(command, target " ") == 1) {
        print pid "\t" ppid "\t" rss "\t" command
      }
    }
  '
}

terminate_pid() {
  local pid="$1"
  if [[ -z "${pid:-}" || "$pid" == "$$" ]]; then
    return 0
  fi
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  kill "$pid" >/dev/null 2>&1 || true

  local attempt
  for attempt in {1..20}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done

  kill -KILL "$pid" >/dev/null 2>&1 || true
}

ROWS="$(find_orphan_rows | sed '/^[[:space:]]*$/d')"
PIDS=()
if [[ -n "${ROWS:-}" ]]; then
  while IFS=$'\t' read -r pid _ppid _rss _command; do
    [[ -n "${pid:-}" ]] && PIDS+=("$pid")
  done <<< "$ROWS"
fi

TERMINATED=()
if [[ "$DRY_RUN" != "1" ]]; then
  for pid in "${PIDS[@]}"; do
    terminate_pid "$pid"
    TERMINATED+=("$pid")
  done
fi

REMAINING_ROWS="$(find_orphan_rows | sed '/^[[:space:]]*$/d')"

if [[ -n "$ROWS" ]]; then
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "Matching stale Wails v3 dev mcp-server processes:"
  else
    echo "Terminated stale Wails v3 dev mcp-server processes:"
  fi
  echo "$ROWS"
else
  echo "No stale Wails v3 dev mcp-server processes found."
fi

if [[ -n "$JSON_REPORT" ]]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to write JSON report" >&2
    exit 1
  fi

  JSON_REPORT="$JSON_REPORT" \
  TARGET_COMMAND="$TARGET_COMMAND" \
  DRY_RUN="$DRY_RUN" \
  ROWS="$ROWS" \
  TERMINATED="${(j:,:)TERMINATED}" \
  REMAINING_ROWS="$REMAINING_ROWS" \
  node <<'NODE'
const fs = require("fs");
const path = require("path");

const parseRows = (value) =>
  (value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, ppid, rssKB, ...commandParts] = line.split("\t");
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        rssKB: Number(rssKB),
        command: commandParts.join("\t"),
      };
    });

const report = {
  generatedAt: new Date().toISOString(),
  targetCommand: process.env.TARGET_COMMAND,
  dryRun: process.env.DRY_RUN === "1",
  matched: parseRows(process.env.ROWS),
  terminatedPids: (process.env.TERMINATED || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number),
  remaining: parseRows(process.env.REMAINING_ROWS),
};

report.passed = report.remaining.length === 0;
fs.mkdirSync(path.dirname(process.env.JSON_REPORT), { recursive: true });
fs.writeFileSync(process.env.JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`);
NODE
fi

if [[ "$DRY_RUN" != "1" && -n "$REMAINING_ROWS" ]]; then
  echo "Some stale Wails v3 dev mcp-server processes are still running." >&2
  exit 1
fi
