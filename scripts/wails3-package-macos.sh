#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ONNX_RUNTIME_LOCK_FILE="$ROOT_DIR/scripts/onnxruntime-runtime-lock.zsh"
if [[ -r "$ONNX_RUNTIME_LOCK_FILE" ]]; then
  source "$ONNX_RUNTIME_LOCK_FILE"
fi
EXPECTED_BRANCH="main"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-package-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

APP_NAME="$(plutil -extract outputfilename raw -o - "$ROOT_DIR/wails.json")"
BUILD_DIR_RAW="$(plutil -extract 'build:dir' raw -o - "$ROOT_DIR/wails.json")"
if [[ "$BUILD_DIR_RAW" = /* ]]; then
  BUILD_DIR="$BUILD_DIR_RAW"
else
  BUILD_DIR="$ROOT_DIR/$BUILD_DIR_RAW"
fi

VERSION="${ARLE_WAILS3_APP_VERSION:-0.0.0-beta}"
BUILD_NUMBER="${ARLE_WAILS3_APP_BUILD:-1}"
BUNDLE_ID="${ARLE_WAILS3_BUNDLE_ID:-io.arlecchino.ide}"
DISPLAY_NAME="${ARLE_WAILS3_APP_DISPLAY_NAME:-Arlecchino}"
MIN_MACOS_VERSION="${ARLE_WAILS3_MIN_MACOS:-11.0}"
SIGN_MODE="${ARLE_WAILS3_SIGN_MODE:-none}"
OUTPUT="${ARLE_WAILS3_OUTPUT:-$BUILD_DIR/bin/$APP_NAME-v3}"
APP_BUNDLE="${ARLE_WAILS3_APP_BUNDLE:-$BUILD_DIR/bin/$APP_NAME.app}"
BUNDLE_ONNX_RUNTIME="${ARLE_WAILS3_BUNDLE_ONNX_RUNTIME:-1}"
DOWNLOAD_ONNX_RUNTIME="${ARLE_WAILS3_DOWNLOAD_ONNX_RUNTIME:-1}"
ONNX_RUNTIME_VERSION="${ARLE_ONNX_RUNTIME_VERSION:-${ARLE_ONNX_RUNTIME_LOCK_VERSION:-1.26.0}}"
ONNX_RUNTIME_ARCH="${ARLE_ONNX_RUNTIME_ARCH:-}"
LOCKED_ONNX_RUNTIME="${ARLE_WAILS3_LOCKED_ONNX_RUNTIME:-1}"
SKIP_BUILD="0"
SKIP_FRONTEND="0"

usage() {
  cat <<'EOF'
Usage: scripts/wails3-package-macos.sh [options]

Options:
  --app-bundle <path>   Output .app path.
  --output <path>       Intermediate Wails v3 binary path.
  --bundle-id <id>      CFBundleIdentifier.
  --version <version>   CFBundleShortVersionString.
  --build <number>      CFBundleVersion.
  --min-macos <version> LSMinimumSystemVersion.
  --skip-build          Reuse an existing --output binary.
  --skip-frontend       Pass --skip-frontend to the v3 build script.
  --sign <mode>         none, adhoc, local-identity, or developer-id.
  --skip-onnx-runtime   Do not bundle libonnxruntime.dylib.

Build artifacts are written outside the repository by default through wails.json build:dir.

ONNX Runtime:
  Packaging bundles Contents/Frameworks/libonnxruntime.dylib from
  scripts/onnxruntime-runtime-lock.zsh by default. Universal app binaries
  require ONNX Runtime coverage for every app binary architecture. The lock
  provides a pinned x86_64 runtime-deps archive for ONNX Runtime 1.26.0; release
  machines may override it with ARLE_ONNX_RUNTIME_X86_64_URL/SHA256.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-bundle)
      shift
      APP_BUNDLE="${1:-}"
      shift
      ;;
    --output)
      shift
      OUTPUT="${1:-}"
      shift
      ;;
    --bundle-id)
      shift
      BUNDLE_ID="${1:-}"
      shift
      ;;
    --version)
      shift
      VERSION="${1:-}"
      shift
      ;;
    --build)
      shift
      BUILD_NUMBER="${1:-}"
      shift
      ;;
    --min-macos)
      shift
      MIN_MACOS_VERSION="${1:-}"
      shift
      ;;
    --skip-build)
      SKIP_BUILD="1"
      shift
      ;;
    --skip-frontend)
      SKIP_FRONTEND="1"
      shift
      ;;
    --sign)
      shift
      SIGN_MODE="${1:-}"
      shift
      ;;
    --skip-onnx-runtime)
      BUNDLE_ONNX_RUNTIME="0"
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

if [[ -z "$APP_BUNDLE" || "$APP_BUNDLE" != *.app ]]; then
  echo "ERROR: --app-bundle must end with .app" >&2
  exit 1
fi

copy_runtime_assets() {
  local assets_dir="$RESOURCES_DIR/assets"
  local asset source dest source_sha dest_sha
  local runtime_assets=(arle_model.onnx arle_tokenizer.json)

  mkdir -p "$assets_dir"
  chmod 0755 "$assets_dir"

  for asset in "${runtime_assets[@]}"; do
    source="$ROOT_DIR/assets/$asset"
    dest="$assets_dir/$asset"
    if [[ ! -s "$source" ]]; then
      echo "ERROR: required runtime asset is missing or empty: $source" >&2
      exit 1
    fi

    cp -Xf "$source" "$dest"
    chmod 0644 "$dest"
    xattr -cr "$dest" >/dev/null 2>&1 || true

    if [[ ! -r "$dest" || ! -s "$dest" ]]; then
      echo "ERROR: packaged runtime asset is missing, unreadable, or empty: $dest" >&2
      exit 1
    fi
    if ! /usr/bin/cmp -s "$source" "$dest"; then
      echo "ERROR: packaged runtime asset differs from source: $asset" >&2
      exit 1
    fi
    source_sha="$(shasum -a 256 "$source" | awk '{print $1}')"
    dest_sha="$(shasum -a 256 "$dest" | awk '{print $1}')"
    if [[ "$source_sha" != "$dest_sha" ]]; then
      echo "ERROR: packaged runtime asset checksum mismatch: $asset" >&2
      exit 1
    fi
  done
}

normalize_runtime_arch() {
  case "$1" in
    amd64|x64|x86-64)
      echo "x86_64"
      ;;
    arm64|x86_64)
      echo "$1"
      ;;
    *)
      echo "$1"
      ;;
  esac
}

binary_archs() {
  if [[ -n "$ONNX_RUNTIME_ARCH" ]]; then
    local arch
    for arch in ${(z)ONNX_RUNTIME_ARCH}; do
      if [[ "$arch" == "universal" ]]; then
        echo "arm64"
        echo "x86_64"
      else
        normalize_runtime_arch "$arch"
      fi
    done | awk '!seen[$0]++'
    return 0
  fi
  if command -v lipo >/dev/null 2>&1; then
    local archs
    archs="$(lipo -archs "$OUTPUT" 2>/dev/null || true)"
    if [[ -n "$archs" ]]; then
      local arch
      for arch in ${(z)archs}; do
        normalize_runtime_arch "$arch"
      done | awk '!seen[$0]++'
      return 0
    fi
  fi
  normalize_runtime_arch "$(uname -m)"
}

verify_runtime_arch() {
  local path="$1"
  local arch="$2"
  if ! command -v lipo >/dev/null 2>&1; then
    return 0
  fi
  local archs
  archs="$(lipo -archs "$path" 2>/dev/null || true)"
  if [[ " $archs " != *" $arch "* ]]; then
    echo "ERROR: ONNX Runtime dylib does not contain required architecture $arch: $path ($archs)" >&2
    exit 1
  fi
}

verify_runtime_archs() {
  local path="$1"
  shift
  local arch
  for arch in "$@"; do
    verify_runtime_arch "$path" "$arch"
  done
}

copy_onnx_runtime() {
  if [[ "$BUNDLE_ONNX_RUNTIME" != "1" ]]; then
    return 0
  fi

  # ONNX Runtime is part of the .app runtime contract, not a user's package
  # manager dependency. Future agents: keep this tied to
  # scripts/onnxruntime-runtime-lock.zsh and do not ship a universal app unless
  # libonnxruntime.dylib contains every arch that the app binary contains.
  local arch source dest tmp_dir slice
  local archs=("${(@f)$(binary_archs)}")
  local slices=()
  if [[ ${#archs[@]} -eq 0 ]]; then
    echo "ERROR: could not determine target architecture for ONNX Runtime." >&2
    exit 1
  fi

  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/arlecchino-onnxruntime-slices.XXXXXX")"
  mkdir -p "$FRAMEWORKS_DIR"
  chmod 0755 "$FRAMEWORKS_DIR"
  dest="$FRAMEWORKS_DIR/libonnxruntime.dylib"

  for arch in "${archs[@]}"; do
    local resolver_args=(--arch "$arch" --version "$ONNX_RUNTIME_VERSION" --cache-dir "$BUILD_DIR/onnxruntime")
    if [[ "$DOWNLOAD_ONNX_RUNTIME" == "1" ]]; then
      resolver_args+=(--download)
      if [[ "$LOCKED_ONNX_RUNTIME" == "1" ]]; then
        resolver_args+=(--locked-only --require-checksum)
      fi
    fi

    source="$("$ROOT_DIR/scripts/resolve-onnxruntime-macos.sh" "${resolver_args[@]}")"
    if [[ ! -s "$source" ]]; then
      echo "ERROR: ONNX Runtime resolver returned a missing dylib: $source" >&2
      rm -rf "$tmp_dir"
      exit 1
    fi
    verify_runtime_arch "$source" "$arch"

    slice="$tmp_dir/libonnxruntime-$arch.dylib"
    if command -v lipo >/dev/null 2>&1; then
      local source_archs
      source_archs="$(lipo -archs "$source" 2>/dev/null || true)"
      local source_arch_list=("${(z)source_archs}")
      if [[ "${#source_arch_list[@]}" -gt 1 ]]; then
        lipo "$source" -thin "$arch" -output "$slice"
      else
        cp -Xf "$source" "$slice"
      fi
    else
      cp -Xf "$source" "$slice"
    fi
    slices+=("$slice")
  done

  if [[ ${#slices[@]} -eq 1 ]]; then
    cp -Xf "$slices[1]" "$dest"
  else
    lipo -create -output "$dest" "${slices[@]}"
  fi
  rm -rf "$tmp_dir"

  chmod 0755 "$dest"
  xattr -cr "$dest" >/dev/null 2>&1 || true

  if [[ ! -r "$dest" || ! -s "$dest" ]]; then
    echo "ERROR: packaged ONNX Runtime is missing, unreadable, or empty: $dest" >&2
    exit 1
  fi
  verify_runtime_archs "$dest" "${archs[@]}"
}

copy_icon_assets() {
  local asset source dest
  local icon_assets=(iconfile.icns Assets.car appicon-light.png appicon-dark.png)

  for asset in "${icon_assets[@]}"; do
    source="$ROOT_DIR/build/darwin/$asset"
    dest="$RESOURCES_DIR/$asset"
    if [[ ! -s "$source" ]]; then
      echo "ERROR: required icon asset is missing or empty: $source" >&2
      exit 1
    fi

    cp -Xf "$source" "$dest"
    chmod 0644 "$dest"
    xattr -cr "$dest" >/dev/null 2>&1 || true
  done

  rm -f "$RESOURCES_DIR/appicon.icns"
}

if [[ "$SKIP_BUILD" != "1" ]]; then
  BUILD_ARGS=(--build-only --output "$OUTPUT")
  if [[ "$SKIP_FRONTEND" == "1" ]]; then
    BUILD_ARGS+=(--skip-frontend)
  fi
  "$ROOT_DIR/scripts/wails3-dev-macos.sh" "${BUILD_ARGS[@]}"
elif [[ ! -x "$OUTPUT" ]]; then
  echo "ERROR: --skip-build requires an executable --output binary: $OUTPUT" >&2
  exit 1
fi

INFO_TEMPLATE="$ROOT_DIR/build/darwin/Info.wails3.plist"
if [[ ! -f "$INFO_TEMPLATE" ]]; then
  echo "ERROR: missing Info.plist template: $INFO_TEMPLATE" >&2
  exit 1
fi

rm -rf "$APP_BUNDLE"
MACOS_DIR="$APP_BUNDLE/Contents/MacOS"
RESOURCES_DIR="$APP_BUNDLE/Contents/Resources"
FRAMEWORKS_DIR="$APP_BUNDLE/Contents/Frameworks"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR" "$FRAMEWORKS_DIR"

cp "$OUTPUT" "$MACOS_DIR/$APP_NAME"
chmod +x "$MACOS_DIR/$APP_NAME"

cp "$INFO_TEMPLATE" "$APP_BUNDLE/Contents/Info.plist"
export ARLE_TEMPLATE_APP_DISPLAY_NAME="$DISPLAY_NAME"
export ARLE_TEMPLATE_APP_EXECUTABLE="$APP_NAME"
export ARLE_TEMPLATE_BUNDLE_ID="$BUNDLE_ID"
export ARLE_TEMPLATE_APP_NAME="$APP_NAME"
export ARLE_TEMPLATE_APP_VERSION="$VERSION"
export ARLE_TEMPLATE_APP_BUILD="$BUILD_NUMBER"
export ARLE_TEMPLATE_MIN_MACOS_VERSION="$MIN_MACOS_VERSION"
export ARLE_TEMPLATE_COPYRIGHT_YEAR="$(date +%Y)"
perl -0pi -e '
s/__APP_DISPLAY_NAME__/$ENV{ARLE_TEMPLATE_APP_DISPLAY_NAME}/g;
s/__APP_EXECUTABLE__/$ENV{ARLE_TEMPLATE_APP_EXECUTABLE}/g;
s/__BUNDLE_ID__/$ENV{ARLE_TEMPLATE_BUNDLE_ID}/g;
s/__APP_NAME__/$ENV{ARLE_TEMPLATE_APP_NAME}/g;
s/__APP_VERSION__/$ENV{ARLE_TEMPLATE_APP_VERSION}/g;
s/__APP_BUILD__/$ENV{ARLE_TEMPLATE_APP_BUILD}/g;
s/__MIN_MACOS_VERSION__/$ENV{ARLE_TEMPLATE_MIN_MACOS_VERSION}/g;
s/__COPYRIGHT_YEAR__/$ENV{ARLE_TEMPLATE_COPYRIGHT_YEAR}/g;
' "$APP_BUNDLE/Contents/Info.plist"

copy_icon_assets
copy_runtime_assets
copy_onnx_runtime
xattr -cr "$APP_BUNDLE" >/dev/null 2>&1 || true

/usr/bin/plutil -lint "$APP_BUNDLE/Contents/Info.plist" >/dev/null

if [[ "$SIGN_MODE" != "none" ]]; then
  "$ROOT_DIR/scripts/wails3-sign-macos.sh" --app-bundle "$APP_BUNDLE" --mode "$SIGN_MODE"
fi

echo "Packaged Wails v3 app bundle: $APP_BUNDLE"
