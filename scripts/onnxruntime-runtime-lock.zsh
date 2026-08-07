#!/bin/zsh

# ONNX Runtime macOS packaging lock.
#
# Future agents: update this file whenever github.com/yalue/onnxruntime_go is
# bumped during release dependency refresh. Do not use "latest" here. Release
# packaging downloads ONNX Runtime with curl, verifies sha256, verifies Mach-O
# archs, and only then bundles Contents/Frameworks/libonnxruntime.dylib.
#
# The Go binding and the C shared library must move together. The current
# github.com/yalue/onnxruntime_go README says v1.32.0 uses ONNX Runtime C API
# headers 1.28.0, so release artifacts must bundle libonnxruntime.dylib 1.28.0.

ARLE_ONNX_RUNTIME_LOCK_GO_MODULE="github.com/yalue/onnxruntime_go"
ARLE_ONNX_RUNTIME_LOCK_GO_VERSION="v1.32.0"
ARLE_ONNX_RUNTIME_LOCK_VERSION="1.28.0"

ARLE_ONNX_RUNTIME_LOCK_ARM64_URL="https://github.com/microsoft/onnxruntime/releases/download/v1.28.0/onnxruntime-osx-arm64-1.28.0.tgz"
ARLE_ONNX_RUNTIME_LOCK_ARM64_SHA256="1268b359718099bde2cedb55787f182a130067bc4f31e8c88478c445b850d3d8"

# Microsoft does not publish a standalone macOS x86_64 archive for ONNX Runtime
# 1.28.0. The pinned x86_64 runtime-deps archive is built from the official
# v1.28.0 source with upstream's shared-library build and contains a single
# standalone libonnxruntime.dylib. Release machines may override the URL/SHA
# with an internal artifact location, but the default keeps this Mac's universal
# beta release flow reproducible without a user Homebrew prerequisite.
ARLE_ONNX_RUNTIME_LOCK_X86_64_URL="${ARLE_ONNX_RUNTIME_X86_64_URL:-file://${HOME}/.config/arlecchino/runtime-deps/onnxruntime-1.28.0/dist/arle-onnxruntime-darwin-x86_64-1.28.0.tar.gz}"
ARLE_ONNX_RUNTIME_LOCK_X86_64_SHA256="${ARLE_ONNX_RUNTIME_X86_64_SHA256:-63dd1507cef120a6aaaa7a70837b9bac12635310902b05008d0fb3d7433e9e02}"
