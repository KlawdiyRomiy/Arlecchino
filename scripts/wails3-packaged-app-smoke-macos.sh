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
APP_BUNDLE="$TMP_ROOT/ArlecchinoV3Smoke.app"
REPORT="$TMP_ROOT/report.json"
FIXTURE_DIR="$TMP_ROOT/fixture"
BUNDLE_ID="${ARLE_WAILS3_APP_SMOKE_BUNDLE_ID:-dev.arlecchino.v3smoke}"
REGISTER_OS_HANDLERS="0"
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
      if [[ $# -eq 0 ]]; then
        echo "ERROR: --output requires a path." >&2
        exit 1
      fi
      OUTPUT="$1"
      shift
      ;;
    --app-bundle)
      shift
      if [[ $# -eq 0 ]]; then
        echo "ERROR: --app-bundle requires a path." >&2
        exit 1
      fi
      APP_BUNDLE="$1"
      shift
      ;;
    --report)
      shift
      if [[ $# -eq 0 ]]; then
        echo "ERROR: --report requires a path." >&2
        exit 1
      fi
      REPORT="$1"
      shift
      ;;
    --working-dir)
      shift
      if [[ $# -eq 0 ]]; then
        echo "ERROR: --working-dir requires a path." >&2
        exit 1
      fi
      FIXTURE_DIR="$1"
      shift
      ;;
    --bundle-id)
      shift
      if [[ $# -eq 0 ]]; then
        echo "ERROR: --bundle-id requires a value." >&2
        exit 1
      fi
      BUNDLE_ID="$1"
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

ARLE_WAILS3_OUTPUT="$OUTPUT" "$ROOT_DIR/scripts/wails3-packaged-smoke-macos.sh" --build-only >&2

MACOS_DIR="$APP_BUNDLE/Contents/MacOS"
RESOURCES_DIR="$APP_BUNDLE/Contents/Resources"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"
cp "$OUTPUT" "$MACOS_DIR/Arlecchino-v3-bin"
chmod +x "$MACOS_DIR/Arlecchino-v3-bin"

cat > "$APP_BUNDLE/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Arlecchino v3 Smoke</string>
  <key>CFBundleExecutable</key>
  <string>ArlecchinoV3Smoke</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Arlecchino v3 Smoke</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.0.0-smoke</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>Arlecchino Smoke URL</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>arlecchino</string>
      </array>
    </dict>
  </array>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key>
      <string>Arlecchino Smoke File</string>
      <key>CFBundleTypeRole</key>
      <string>Viewer</string>
      <key>LSItemContentTypes</key>
      <array>
        <string>public.data</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
EOF

cat > "$MACOS_DIR/ArlecchinoV3Smoke" <<'EOF'
#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_BUNDLE="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPORT=""
ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arle-smoke-report)
      REPORT="$2"
      shift 2
      ;;
    --arle-env)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --arle-env requires NAME=VALUE." >&2
        exit 1
      fi
      export "$2"
      shift 2
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

export ARLECCHINO_PACKAGED_BUILD="${ARLECCHINO_PACKAGED_BUILD:-1}"
export ARLECCHINO_ENABLE_PACKAGED_OS_SPIKE="${ARLECCHINO_ENABLE_PACKAGED_OS_SPIKE:-1}"
export ARLECCHINO_WAILS3_SMOKE_BUILD_TARGET="$SCRIPT_DIR/Arlecchino-v3-bin"
export ARLECCHINO_WAILS3_SMOKE_LAUNCH_MODE="packaged-app"
export ARLECCHINO_WAILS3_SMOKE_APP_BUNDLE="$APP_BUNDLE"

if [[ -n "$REPORT" ]]; then
  mkdir -p "$(dirname "$REPORT")"
  exec "$SCRIPT_DIR/Arlecchino-v3-bin" "${ARGS[@]}" > "$REPORT" 2> "$REPORT.stderr"
fi

exec "$SCRIPT_DIR/Arlecchino-v3-bin" "${ARGS[@]}"
EOF
chmod +x "$MACOS_DIR/ArlecchinoV3Smoke"

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
  --arle-env "ARLECCHINO_PACKAGED_BUILD=${ARLECCHINO_PACKAGED_BUILD:-1}"
  --arle-env "ARLECCHINO_ENABLE_PACKAGED_OS_SPIKE=${ARLECCHINO_ENABLE_PACKAGED_OS_SPIKE:-1}"
  --arle-env "ARLECCHINO_ENABLE_SINGLE_INSTANCE_SPIKE=${ARLECCHINO_ENABLE_SINGLE_INSTANCE_SPIKE:-0}"
  --arle-env "ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE=${ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE:-0}"
  --arle-env "ARLECCHINO_ENABLE_NATIVE_TRAY=${ARLECCHINO_ENABLE_NATIVE_TRAY:-0}"
  --arle-env "ARLECCHINO_ENABLE_NATIVE_NOTIFICATIONS=${ARLECCHINO_ENABLE_NATIVE_NOTIFICATIONS:-0}"
  --arle-env "ARLECCHINO_ENABLE_DOCK_BADGES=${ARLECCHINO_ENABLE_DOCK_BADGES:-0}"
  --arle-env "ARLECCHINO_AUTO_UPDATE_MANIFEST=${ARLECCHINO_AUTO_UPDATE_MANIFEST:-}"
  --arle-env "ARLECCHINO_WAILS3_SMOKE_BUNDLE_ID=$BUNDLE_ID"
  --arle-env "ARLECCHINO_WAILS3_SMOKE_OS_HANDLERS=$REGISTER_OS_HANDLERS"
)

rm -f "$REPORT" "$REPORT.stderr"
open -n "$APP_BUNDLE" --args \
  "${APP_ENV_ARGS[@]}" \
  --arle-smoke-report "$REPORT" \
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
