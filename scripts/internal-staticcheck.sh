#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [ "$#" -eq 0 ]; then
  set -- ./internal/...
fi

go run honnef.co/go/tools/cmd/staticcheck@v0.7.0 "$@"
