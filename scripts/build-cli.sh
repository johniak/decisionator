#!/bin/sh
set -eu

# Compiles the Decisionator executable: build-cli.sh OUTPUT [BUN_TARGET].
# `bun build --compile` appends the app to Bun's signed runtime, which invalidates that
# signature, and macOS kills such a binary on launch. Darwin binaries are therefore
# signed again ad hoc here, which needs `codesign` and so a macOS machine.

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  printf '%s\n' "Usage: build-cli.sh OUTPUT [BUN_TARGET]" >&2
  exit 2
fi

OUTPUT=$1
TARGET=${2:-bun}
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

case "$TARGET" in
  bun-darwin-*) DARWIN_BINARY=true ;;
  bun) [ "$(uname -s)" = "Darwin" ] && DARWIN_BINARY=true || DARWIN_BINARY=false ;;
  *) DARWIN_BINARY=false ;;
esac

if [ "$DARWIN_BINARY" = true ] && ! command -v codesign >/dev/null 2>&1; then
  printf 'Building %s needs codesign. Build macOS binaries on macOS.\n' "$TARGET" >&2
  exit 1
fi

bun build --compile --minify --target="$TARGET" "$PROJECT_DIR/src/cli.ts" --outfile "$OUTPUT"

if [ "$DARWIN_BINARY" = true ]; then
  codesign --force --sign - "$OUTPUT"
  codesign --verify --strict "$OUTPUT"
  printf 'Signed %s ad hoc.\n' "$OUTPUT"
fi
