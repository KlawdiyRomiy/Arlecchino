#!/bin/bash

# setup-carapace.sh - Install carapace-bin for Arlecchino terminal completions
# Supports: macOS (Homebrew), Linux (apt/dnf/pacman), Windows (scoop/choco)

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

check_carapace() {
    if command -v carapace &> /dev/null; then
        info "carapace is already installed: $(carapace --version)"
        return 0
    fi
    return 1
}

install_macos() {
    if ! command -v brew &> /dev/null; then
        error "Homebrew not found. Install it from https://brew.sh"
    fi
    
    info "Installing carapace via Homebrew..."
    brew install carapace
}

install_linux() {
    if command -v apt &> /dev/null; then
        info "Detected apt-based system (Debian/Ubuntu)"
        warn "Adding carapace PPA..."
        sudo add-apt-repository -y ppa:carapace/carapace-bin
        sudo apt update
        sudo apt install -y carapace-bin
    elif command -v dnf &> /dev/null; then
        info "Detected dnf-based system (Fedora/RHEL)"
        sudo dnf copr enable -y carapace/carapace-bin
        sudo dnf install -y carapace-bin
    elif command -v pacman &> /dev/null; then
        info "Detected pacman-based system (Arch)"
        if command -v yay &> /dev/null; then
            yay -S carapace-bin
        elif command -v paru &> /dev/null; then
            paru -S carapace-bin
        else
            error "Please install yay or paru to install from AUR"
        fi
    else
        install_binary
    fi
}

install_windows() {
    if command -v scoop &> /dev/null; then
        info "Installing carapace via Scoop..."
        scoop install carapace-bin
    elif command -v choco &> /dev/null; then
        info "Installing carapace via Chocolatey..."
        choco install carapace-bin
    else
        error "Please install Scoop or Chocolatey first"
    fi
}

install_binary() {
    info "Installing carapace from GitHub releases..."
    
    # Detect OS and architecture
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)
    
    case "$ARCH" in
        x86_64) ARCH="amd64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        *) error "Unsupported architecture: $ARCH" ;;
    esac
    
    # Get latest release
    LATEST=$(curl -s https://api.github.com/repos/carapace-sh/carapace-bin/releases/latest | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    
    if [ -z "$LATEST" ]; then
        error "Could not determine latest version"
    fi
    
    info "Downloading carapace $LATEST for ${OS}_${ARCH}..."
    
    FILENAME="carapace-bin_${OS}_${ARCH}.tar.gz"
    URL="https://github.com/carapace-sh/carapace-bin/releases/download/${LATEST}/${FILENAME}"
    
    TMP_DIR=$(mktemp -d)
    cd "$TMP_DIR"
    
    curl -sLO "$URL" || error "Download failed"
    tar -xzf "$FILENAME" || error "Extraction failed"
    
    # Install to /usr/local/bin
    if [ -w /usr/local/bin ]; then
        mv carapace /usr/local/bin/
    else
        sudo mv carapace /usr/local/bin/
    fi
    
    rm -rf "$TMP_DIR"
    info "Installed to /usr/local/bin/carapace"
}

setup_shell() {
    info "Setting up shell integration..."
    
    SHELL_NAME=$(basename "$SHELL")
    
    case "$SHELL_NAME" in
        bash)
            INIT='source <(carapace _carapace bash)'
            RC_FILE="$HOME/.bashrc"
            ;;
        zsh)
            INIT='source <(carapace _carapace zsh)'
            RC_FILE="$HOME/.zshrc"
            ;;
        fish)
            INIT='carapace _carapace fish | source'
            RC_FILE="$HOME/.config/fish/config.fish"
            ;;
        *)
            warn "Shell $SHELL_NAME not auto-configured. See: https://carapace-sh.github.io/carapace-bin/setup.html"
            return
            ;;
    esac
    
    if grep -q "carapace" "$RC_FILE" 2>/dev/null; then
        info "Shell integration already configured in $RC_FILE"
    else
        echo "" >> "$RC_FILE"
        echo "# Carapace shell completions" >> "$RC_FILE"
        echo "$INIT" >> "$RC_FILE"
        info "Added carapace initialization to $RC_FILE"
        warn "Restart your shell or run: source $RC_FILE"
    fi
}

main() {
    echo "=== Carapace Installation for Arlecchino ==="
    echo ""
    
    if check_carapace; then
        setup_shell
        echo ""
        info "Carapace is ready! Arlecchino will use it for terminal completions."
        exit 0
    fi
    
    OS=$(uname -s)
    case "$OS" in
        Darwin)
            install_macos
            ;;
        Linux)
            install_linux
            ;;
        MINGW*|CYGWIN*|MSYS*)
            install_windows
            ;;
        *)
            error "Unsupported OS: $OS"
            ;;
    esac
    
    if check_carapace; then
        setup_shell
        echo ""
        info "Installation complete!"
        info "Carapace is ready for Arlecchino terminal completions."
    else
        error "Installation failed. Please install manually: https://carapace-sh.github.io/carapace-bin/install.html"
    fi
}

main "$@"
