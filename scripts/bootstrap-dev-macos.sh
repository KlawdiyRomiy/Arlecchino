#!/usr/bin/env bash

set -u
set -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

INSTALLED_ITEMS=()
PRESENT_ITEMS=()
OPTIONAL_FAILED_ITEMS=()

info() {
  printf '[INFO] %s\n' "$1"
}

warn() {
  printf '[WARN] %s\n' "$1"
}

fatal() {
  printf '[ERROR] %s\n' "$1" >&2
  exit 1
}

record_installed() {
  INSTALLED_ITEMS+=("$1")
}

record_present() {
  PRESENT_ITEMS+=("$1")
}

record_optional_failed() {
  OPTIONAL_FAILED_ITEMS+=("$1")
}

print_section() {
  printf '\n== %s ==\n' "$1"
}

require_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    fatal "This bootstrap currently supports macOS only."
  fi
}

require_xcode_clt() {
  if ! xcode-select -p >/dev/null 2>&1; then
    fatal "Xcode Command Line Tools are missing. Run: xcode-select --install"
  fi
}

require_homebrew() {
  if ! command -v brew >/dev/null 2>&1; then
    fatal "Homebrew is missing. Install it from https://brew.sh and rerun this script."
  fi

  HOMEBREW_PREFIX="$(brew --prefix)"
  export PATH="$HOMEBREW_PREFIX/bin:$HOMEBREW_PREFIX/sbin:$PATH"
}

prefer_node_lts() {
  local node22_prefix
  node22_prefix="$(brew --prefix node@22 2>/dev/null || true)"
  if [[ -n "$node22_prefix" && -d "$node22_prefix/bin" ]]; then
    export PATH="$node22_prefix/bin:$PATH"
  fi
}

ensure_brew_formula() {
  local formula="$1"
  local label="$2"
  local required="${3:-yes}"

  if brew list --versions "$formula" >/dev/null 2>&1; then
    record_present "$label"
    return 0
  fi

  info "Installing $label via Homebrew..."
  if brew install "$formula"; then
    record_installed "$label"
    return 0
  fi

  if [[ "$required" == "yes" ]]; then
    fatal "Failed to install required dependency '$label' via Homebrew."
  fi

  warn "Optional dependency '$label' could not be installed."
  record_optional_failed "$label"
  return 1
}

ensure_npm_global() {
  local label="$1"
  local check_bin="$2"
  shift 2
  local packages=("$@")

  if command -v "$check_bin" >/dev/null 2>&1; then
    record_present "$label"
    return 0
  fi

  info "Installing $label via npm..."
  if npm install -g "${packages[@]}"; then
    record_installed "$label"
    return 0
  fi

  warn "Optional dependency '$label' could not be installed via npm."
  record_optional_failed "$label"
  return 1
}

ensure_vscode_langservers() {
  if command -v vscode-css-language-server >/dev/null 2>&1 \
    && command -v vscode-html-language-server >/dev/null 2>&1 \
    && command -v vscode-json-language-server >/dev/null 2>&1; then
    record_present "vscode-langservers-extracted"
    return 0
  fi

  info "Installing vscode-langservers-extracted via npm..."
  if npm install -g vscode-langservers-extracted; then
    record_installed "vscode-langservers-extracted"
    return 0
  fi

  warn "Optional dependency 'vscode-langservers-extracted' could not be installed."
  record_optional_failed "vscode-langservers-extracted"
  return 1
}

bootstrap_repo_dependencies() {
  print_section "Repository dependencies"

  info "Downloading Go modules..."
  (
    cd "$ROOT_DIR"
    go mod download
  ) || fatal "go mod download failed."

  info "Installing frontend dependencies with npm ci..."
  (
    cd "$FRONTEND_DIR"
    npm ci
  ) || fatal "frontend/npm ci failed."
}

run_wails_doctor() {
  print_section "Wails doctor"

  if command -v wails >/dev/null 2>&1; then
    if ! wails doctor; then
      warn "wails doctor reported warnings. Review the output above before relying on all optional capabilities."
    fi
  else
    fatal "wails is still not on PATH after installation."
  fi
}

print_summary() {
  print_section "Bootstrap summary"

  if ((${#INSTALLED_ITEMS[@]} > 0)); then
    printf 'Installed:\n'
    printf '  - %s\n' "${INSTALLED_ITEMS[@]}"
  else
    printf 'Installed:\n  - nothing new\n'
  fi

  if ((${#PRESENT_ITEMS[@]} > 0)); then
    printf 'Already present:\n'
    printf '  - %s\n' "${PRESENT_ITEMS[@]}"
  else
    printf 'Already present:\n  - none\n'
  fi

  if ((${#OPTIONAL_FAILED_ITEMS[@]} > 0)); then
    printf 'Optional items not installed:\n'
    printf '  - %s\n' "${OPTIONAL_FAILED_ITEMS[@]}"
  else
  printf 'Optional items not installed:\n  - none\n'
  fi

  printf '\nNext step:\n'
  printf '  ./scripts/wails-dev-macos.sh\n'
}

main() {
  require_macos
  require_xcode_clt
  require_homebrew

  print_section "Required toolchain"
  ensure_brew_formula "go" "Go" "yes"
  ensure_brew_formula "node@22" "Node.js 22 LTS" "yes"
  prefer_node_lts
  ensure_brew_formula "wails" "Wails CLI v2.12" "yes"

  print_section "Recommended extras"
  ensure_brew_formula "carapace" "carapace" "no"
  ensure_brew_formula "onnxruntime" "onnxruntime" "no"
  ensure_brew_formula "gopls" "gopls" "no"
  ensure_brew_formula "typescript-language-server" "typescript-language-server" "no"
  ensure_brew_formula "pyright" "pyright" "no"
  ensure_vscode_langservers
  ensure_npm_global "yaml-language-server" "yaml-language-server" "yaml-language-server"
  ensure_npm_global "bash-language-server" "bash-language-server" "bash-language-server"
  ensure_npm_global "dockerfile-language-server-nodejs" "docker-langserver" "dockerfile-language-server-nodejs"

  bootstrap_repo_dependencies
  run_wails_doctor
  print_summary
}

main "$@"
