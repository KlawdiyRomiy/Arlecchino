#!/bin/bash
# Setup tree-sitter header symlinks for CGO compilation
# Run this after `go mod vendor` if using vendor mode

set -e

BASE="$(dirname "$0")/../vendor/github.com/smacker/go-tree-sitter"

if [ ! -d "$BASE" ]; then
    echo "Vendor directory not found. Run 'go mod vendor' first."
    exit 1
fi

# Languages that need tree_sitter/ subdirectory with header symlinks
LANGUAGES=(php python golang javascript typescript)

for lang in "${LANGUAGES[@]}"; do
    LANG_DIR="$BASE/$lang"
    if [ -d "$LANG_DIR" ]; then
        echo "Setting up symlinks for $lang..."
        mkdir -p "$LANG_DIR/tree_sitter"
        
        for h in "$BASE"/*.h; do
            filename=$(basename "$h")
            ln -sf "../../$filename" "$LANG_DIR/tree_sitter/$filename" 2>/dev/null || true
        done
    fi
done

echo "Tree-sitter symlinks created successfully!"
echo ""
echo "Supported languages: ${LANGUAGES[*]}"
