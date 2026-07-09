#!/bin/zsh

# ONNX Runtime macOS packaging lock.
#
# Future agents: update this file whenever github.com/yalue/onnxruntime_go is
# bumped during release dependency refresh. Do not use "latest" here. Release
# packaging downloads ONNX Runtime with curl, verifies sha256, verifies Mach-O
# archs, and only then bundles Contents/Frameworks/libonnxruntime.dylib.
#
# The Go binding and the C shared library must move together. The current
# github.com/yalue/onnxruntime_go README says v1.31.0 uses ONNX Runtime C API
# headers 1.26.0, so release artifacts must bundle libonnxruntime.dylib 1.26.0.

ARLE_ONNX_RUNTIME_LOCK_GO_MODULE="github.com/yalue/onnxruntime_go"
ARLE_ONNX_RUNTIME_LOCK_GO_VERSION="v1.31.0"
ARLE_ONNX_RUNTIME_LOCK_VERSION="1.26.0"

ARLE_ONNX_RUNTIME_LOCK_ARM64_URL="https://github.com/microsoft/onnxruntime/releases/download/v1.26.0/onnxruntime-osx-arm64-1.26.0.tgz"
ARLE_ONNX_RUNTIME_LOCK_ARM64_SHA256="7a1280bbb1701ea514f71828765237e7896e0f2e1cd332f1f70dbd5c3e33aca3"

# Microsoft does not publish a standalone macOS x86_64 archive for ONNX Runtime
# 1.26.0. The pinned x86_64 runtime-deps archive is built from the official
# v1.26.0 source with upstream's shared-library build and contains a single
# standalone libonnxruntime.dylib. Release machines may override the URL/SHA
# with an internal artifact location, but the default keeps this Mac's universal
# beta release flow reproducible without a user Homebrew prerequisite.
ARLE_ONNX_RUNTIME_LOCK_X86_64_URL="${ARLE_ONNX_RUNTIME_X86_64_URL:-file://${HOME}/.config/arlecchino/runtime-deps/onnxruntime-1.26.0/dist/arle-onnxruntime-darwin-x86_64-1.26.0.tar.gz}"
ARLE_ONNX_RUNTIME_LOCK_X86_64_SHA256="${ARLE_ONNX_RUNTIME_X86_64_SHA256:-b6c00b052c00420c1a974fde1fe283b9a3b15d88562b26c8afeb29b391324170}"
