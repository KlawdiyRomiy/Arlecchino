#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_FILE="$ROOT_DIR/scripts/onnxruntime-runtime-lock.zsh"
ARCH_TARGET="${ARLE_WAILS3_RELEASE_ARCH:-universal}"
CACHE_DIR="${ARLE_ONNX_RUNTIME_CACHE_DIR:-${TMPDIR:-/tmp}/arlecchino-onnxruntime}"
DOWNLOAD="0"

usage() {
  cat <<'EOF'
Usage: scripts/onnxruntime-release-preflight-macos.sh [options]

Options:
  --arch <target>     arm64, amd64, x86_64, or universal. Default: universal.
  --cache-dir <dir>   ONNX Runtime download/cache directory.
  --download          Also resolve/download locked archives during preflight.

This gate keeps release dependency refresh honest: when onnxruntime_go changes,
the pinned ONNX Runtime dylib version and checksums must be updated before a
macOS release can be built.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      shift
      ARCH_TARGET="${1:-}"
      shift
      ;;
    --cache-dir)
      shift
      CACHE_DIR="${1:-}"
      shift
      ;;
    --download)
      DOWNLOAD="1"
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

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: ONNX Runtime release preflight is macOS-only." >&2
  exit 1
fi

for HOMEBREW_PREFIX in /opt/homebrew /usr/local; do
  if [[ -d "$HOMEBREW_PREFIX/bin" ]]; then
    export PATH="$HOMEBREW_PREFIX/bin:$PATH"
  fi
  if [[ -d "$HOMEBREW_PREFIX/sbin" ]]; then
    export PATH="$HOMEBREW_PREFIX/sbin:$PATH"
  fi
done

if [[ ! -r "$LOCK_FILE" ]]; then
  echo "ERROR: missing ONNX Runtime lock: $LOCK_FILE" >&2
  exit 1
fi
source "$LOCK_FILE"

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

target_archs() {
  case "$ARCH_TARGET" in
    universal)
      echo "arm64"
      echo "x86_64"
      ;;
    arm64|amd64|x64|x86_64|x86-64)
      normalize_runtime_arch "$ARCH_TARGET"
      ;;
    *)
      echo "ERROR: unsupported ONNX Runtime release arch target: $ARCH_TARGET" >&2
      exit 1
      ;;
  esac
}

locked_url_for_arch() {
  case "$(normalize_runtime_arch "$1")" in
    arm64)
      echo "${ARLE_ONNX_RUNTIME_LOCK_ARM64_URL:-}"
      ;;
    x86_64)
      echo "${ARLE_ONNX_RUNTIME_LOCK_X86_64_URL:-}"
      ;;
    *)
      echo ""
      ;;
  esac
}

locked_sha_for_arch() {
  case "$(normalize_runtime_arch "$1")" in
    arm64)
      echo "${ARLE_ONNX_RUNTIME_LOCK_ARM64_SHA256:-}"
      ;;
    x86_64)
      echo "${ARLE_ONNX_RUNTIME_LOCK_X86_64_SHA256:-}"
      ;;
    *)
      echo ""
      ;;
  esac
}

if ! command -v go >/dev/null 2>&1; then
  echo "ERROR: go is required for ONNX Runtime dependency preflight." >&2
  exit 1
fi

module_version="$(go list -m -f '{{.Version}}' "$ARLE_ONNX_RUNTIME_LOCK_GO_MODULE")"
module_dir="$(go list -m -f '{{.Dir}}' "$ARLE_ONNX_RUNTIME_LOCK_GO_MODULE")"

if [[ "$module_version" != "$ARLE_ONNX_RUNTIME_LOCK_GO_VERSION" ]]; then
  echo "ERROR: $ARLE_ONNX_RUNTIME_LOCK_GO_MODULE version drifted: lock=$ARLE_ONNX_RUNTIME_LOCK_GO_VERSION current=$module_version" >&2
  echo "Update scripts/onnxruntime-runtime-lock.zsh after dependency refresh." >&2
  exit 1
fi

if [[ ! -r "$module_dir/README.md" ]]; then
  echo "ERROR: cannot inspect $ARLE_ONNX_RUNTIME_LOCK_GO_MODULE README: $module_dir/README.md" >&2
  exit 1
fi

expected_runtime_version="$(sed -nE 's/.*uses version ([0-9]+\.[0-9]+\.[0-9]+) of the onnxruntime.*/\1/p' "$module_dir/README.md" | head -1)"
if [[ -z "$expected_runtime_version" ]]; then
  echo "ERROR: could not infer ONNX Runtime version from $ARLE_ONNX_RUNTIME_LOCK_GO_MODULE README." >&2
  echo "Inspect the binding headers/README and update scripts/onnxruntime-runtime-lock.zsh explicitly." >&2
  exit 1
fi

if [[ "$expected_runtime_version" != "$ARLE_ONNX_RUNTIME_LOCK_VERSION" ]]; then
  echo "ERROR: ONNX Runtime version drifted: lock=$ARLE_ONNX_RUNTIME_LOCK_VERSION binding=$expected_runtime_version" >&2
  echo "Update scripts/onnxruntime-runtime-lock.zsh and runtime artifact URLs/checksums." >&2
  exit 1
fi

for arch in "${(@f)$(target_archs)}"; do
  url="$(locked_url_for_arch "$arch")"
  sha="$(locked_sha_for_arch "$arch")"
  if [[ -z "$url" || -z "$sha" ]]; then
    echo "ERROR: missing locked ONNX Runtime archive URL or sha256 for $arch." >&2
    echo "For x86_64 ONNX Runtime $ARLE_ONNX_RUNTIME_LOCK_VERSION, provide ARLE_ONNX_RUNTIME_X86_64_URL and ARLE_ONNX_RUNTIME_X86_64_SHA256." >&2
    exit 1
  fi
  if [[ "$DOWNLOAD" == "1" ]]; then
    "$ROOT_DIR/scripts/resolve-onnxruntime-macos.sh" \
      --arch "$arch" \
      --version "$ARLE_ONNX_RUNTIME_LOCK_VERSION" \
      --cache-dir "$CACHE_DIR" \
      --download \
      --locked-only \
      --require-checksum >/dev/null
  fi
done

echo "ONNX Runtime release preflight passed: $ARLE_ONNX_RUNTIME_LOCK_GO_MODULE $module_version -> ONNX Runtime $ARLE_ONNX_RUNTIME_LOCK_VERSION ($ARCH_TARGET)"
