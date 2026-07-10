#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_FILE="$ROOT_DIR/scripts/onnxruntime-runtime-lock.zsh"
if [[ -r "$LOCK_FILE" ]]; then
  source "$LOCK_FILE"
fi

VERSION="${ARLE_ONNX_RUNTIME_VERSION:-${ARLE_ONNX_RUNTIME_LOCK_VERSION:-1.26.0}}"
ARCH="${ARLE_ONNX_RUNTIME_ARCH:-$(uname -m)}"
CACHE_DIR="${ARLE_ONNX_RUNTIME_CACHE_DIR:-${TMPDIR:-/tmp}/arlecchino-onnxruntime}"
DOWNLOAD="${ARLE_ONNX_RUNTIME_DOWNLOAD:-0}"
LOCKED_ONLY="${ARLE_ONNX_RUNTIME_LOCKED_ONLY:-0}"
REQUIRE_CHECKSUM="${ARLE_ONNX_RUNTIME_REQUIRE_CHECKSUM:-0}"
LIB_NAME="libonnxruntime.dylib"

usage() {
  cat <<'EOF'
Usage: scripts/resolve-onnxruntime-macos.sh [options]

Options:
  --arch <arch>       Target architecture, usually arm64 or x86_64.
  --version <ver>     ONNX Runtime version. Default: lock file version.
  --cache-dir <dir>   Download/cache directory.
  --download          Download locked runtime archive if no local runtime is found.
  --locked-only       Do not fall back to package-manager installs.
  --require-checksum  Require sha256 for downloaded archives.

Resolution order:
  ARLE_ONNX_RUNTIME_PATH, ARLE_ONNX_RUNTIME_DIR, repo runtime assets, cache,
  locked curl downloads, then Homebrew, MacPorts, Conda/Mamba, and Nix profile
  locations unless --locked-only is set.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      shift
      ARCH="${1:-}"
      shift
      ;;
    --version)
      shift
      VERSION="${1:-}"
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
    --locked-only)
      LOCKED_ONLY="1"
      shift
      ;;
    --require-checksum)
      REQUIRE_CHECKSUM="1"
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
  echo "ERROR: ONNX Runtime macOS resolver only supports Darwin." >&2
  exit 1
fi

if [[ -z "$ARCH" ]]; then
  echo "ERROR: target architecture is empty." >&2
  exit 1
fi

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

ARCH="$(normalize_runtime_arch "$ARCH")"

locked_archive_url() {
  case "$ARCH" in
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

locked_archive_sha256() {
  case "$ARCH" in
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

candidate_paths=()

add_path() {
  local path="${1:-}"
  if [[ -n "$path" ]]; then
    candidate_paths+=("$path")
  fi
}

add_dir() {
  local dir="${1:-}"
  if [[ -n "$dir" ]]; then
    add_path "$dir/$LIB_NAME"
  fi
}

add_path "${ARLE_ONNX_RUNTIME_PATH:-}"
add_dir "${ARLE_ONNX_RUNTIME_DIR:-}"
add_dir "$ROOT_DIR/assets/onnxruntime/darwin-$ARCH"
add_dir "$ROOT_DIR/assets/onnxruntime/macos-$ARCH"
add_dir "$ROOT_DIR/assets/onnxruntime"
add_dir "$CACHE_DIR/onnxruntime-osx-$ARCH-$VERSION/lib"
add_dir "$CACHE_DIR/onnxruntime-osx-$ARCH-$VERSION/onnxruntime-osx-$ARCH-$VERSION/lib"

add_installer_candidates() {
  if command -v brew >/dev/null 2>&1; then
    brew_prefix="$(brew --prefix onnxruntime 2>/dev/null || true)"
    add_dir "$brew_prefix/lib"
  fi

  add_dir "/opt/homebrew/opt/onnxruntime/lib"
  add_dir "/opt/homebrew/lib"
  add_dir "/usr/local/opt/onnxruntime/lib"
  add_dir "/usr/local/lib"
  add_dir "/opt/local/lib"
  add_dir "${CONDA_PREFIX:-}/lib"
  add_dir "${MAMBA_ROOT_PREFIX:-}/lib"

  for profile in ${(z)${NIX_PROFILES:-}}; do
    add_dir "$profile/lib"
  done
  add_dir "$HOME/.nix-profile/lib"
  add_dir "/run/current-system/sw/lib"
}

arch_matches() {
  local path="$1"
  if ! command -v lipo >/dev/null 2>&1; then
    return 0
  fi
  local archs
  archs="$(lipo -archs "$path" 2>/dev/null || true)"
  [[ " $archs " == *" $ARCH "* ]]
}

first_existing_runtime() {
  local seen=""
  local path
  for path in "${candidate_paths[@]}"; do
    if [[ -z "$path" ]]; then
      continue
    fi
    if [[ "$seen" == *"|$path|"* ]]; then
      continue
    fi
    seen="${seen}|$path|"
    if [[ -s "$path" ]]; then
      if arch_matches "$path"; then
        echo "$path"
        return 0
      fi
    fi
  done
  return 1
}

runtime_path="$(first_existing_runtime || true)"
if [[ -n "$runtime_path" ]]; then
  echo "$runtime_path"
  exit 0
fi

verify_archive_checksum() {
  local archive_path="$1"
  local expected_sha="$2"
  if [[ -z "$expected_sha" ]]; then
    if [[ "$REQUIRE_CHECKSUM" == "1" ]]; then
      echo "ERROR: missing sha256 for ONNX Runtime archive: $archive_path" >&2
      return 1
    fi
    return 0
  fi

  local actual_sha
  actual_sha="$(shasum -a 256 "$archive_path" | awk '{print $1}')"
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    echo "ERROR: ONNX Runtime archive checksum mismatch: $archive_path" >&2
    echo "Expected: $expected_sha" >&2
    echo "Actual:   $actual_sha" >&2
    return 1
  fi
}

verify_archive() {
  local archive_path="$1"
  local expected_sha="$2"

  if ! verify_archive_checksum "$archive_path" "$expected_sha"; then
    return 1
  fi
  if ! tar -tzf "$archive_path" >/dev/null 2>&1; then
    echo "ERROR: ONNX Runtime archive is truncated or unreadable: $archive_path" >&2
    return 1
  fi
}

download_locked_runtime() {
  local archive_url archive_sha archive_name archive_path archive_stem extract_dir runtime_path partial_path
  archive_url="$(locked_archive_url)"
  archive_sha="$(locked_archive_sha256)"
  if [[ -z "$archive_url" ]]; then
    echo "ERROR: no locked ONNX Runtime archive URL is configured for $ARCH $VERSION." >&2
    if [[ "$ARCH" == "x86_64" ]]; then
      echo "Set ARLE_ONNX_RUNTIME_X86_64_URL and ARLE_ONNX_RUNTIME_X86_64_SHA256 to a pinned x86_64 runtime-deps artifact." >&2
    fi
    exit 1
  fi

  if [[ -z "$archive_sha" && "$REQUIRE_CHECKSUM" == "1" ]]; then
    echo "ERROR: no locked ONNX Runtime archive sha256 is configured for $ARCH $VERSION." >&2
    exit 1
  fi

  archive_name="$(basename "$archive_url")"
  if [[ -z "$archive_name" || "$archive_name" == "/" || "$archive_name" == "." ]]; then
    archive_name="onnxruntime-$ARCH-$VERSION.tgz"
  fi
  archive_path="$CACHE_DIR/$archive_name"
  archive_stem="${archive_name%.tgz}"
  archive_stem="${archive_stem%.tar.gz}"
  extract_dir="$CACHE_DIR/$archive_stem"
  partial_path="${archive_path}.part.$$"

  mkdir -p "$CACHE_DIR"
  if [[ -s "$archive_path" ]] && ! verify_archive "$archive_path" "$archive_sha" >/dev/null 2>&1; then
    echo "WARNING: discarding invalid cached ONNX Runtime archive: $archive_path" >&2
    rm -f "$archive_path"
  fi
  if [[ ! -s "$archive_path" ]]; then
    echo "Downloading locked ONNX Runtime $VERSION for $ARCH..." >&2
    rm -f "$partial_path"
    if ! curl -fL --retry 3 --connect-timeout 10 --max-time 240 "$archive_url" -o "$partial_path"; then
      rm -f "$partial_path"
      exit 1
    fi
    if ! verify_archive "$partial_path" "$archive_sha"; then
      rm -f "$partial_path"
      exit 1
    fi
    mv -f "$partial_path" "$archive_path"
  fi

  rm -rf "$extract_dir"
  mkdir -p "$extract_dir"
  tar -xzf "$archive_path" -C "$extract_dir"

  runtime_path="$(find "$extract_dir" -name "$LIB_NAME" -type f -print | sort | head -1)"
  if [[ ! -s "$runtime_path" ]]; then
    echo "ERROR: downloaded archive did not contain $LIB_NAME" >&2
    exit 1
  fi
  if ! arch_matches "$runtime_path"; then
    echo "ERROR: downloaded runtime does not contain architecture $ARCH: $runtime_path" >&2
    exit 1
  fi

  echo "$runtime_path"
}

if [[ "$DOWNLOAD" == "1" ]]; then
  download_locked_runtime
  exit 0
fi

if [[ "$LOCKED_ONLY" == "1" ]]; then
  echo "ERROR: locked ONNX Runtime archive was not downloaded because --download was not set." >&2
  exit 1
fi

add_installer_candidates
runtime_path="$(first_existing_runtime || true)"
if [[ -n "$runtime_path" ]]; then
  echo "$runtime_path"
  exit 0
fi

echo "ERROR: libonnxruntime.dylib was not found for $ARCH." >&2
echo "Set ARLE_ONNX_RUNTIME_PATH/ARLE_ONNX_RUNTIME_DIR, install ONNX Runtime with your package manager, or pass --download." >&2
exit 1
