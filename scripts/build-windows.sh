#!/usr/bin/env bash
# Cross-builds the Windows exe (and optionally the NSIS installer) from WSL.
# Usage: scripts/build-windows.sh [--bundle] [--debug]
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1090
source "$HOME/.cargo/env"
export PATH="/home/ssafy/miniforge3/envs/winbuild/bin:$PATH"
export XWIN_ARCH=x86_64

BUNDLE=0; PROFILE=release; EXTRA=()
for a in "$@"; do
  case "$a" in
    --bundle) BUNDLE=1 ;;
    --debug) PROFILE=debug; EXTRA+=(--debug) ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done
if [ "$BUNDLE" = 0 ]; then EXTRA+=(--no-bundle); fi

npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc "${EXTRA[@]}"

EXE="src-tauri/target/x86_64-pc-windows-msvc/$PROFILE/Preview.exe"
ls -la "$EXE"
if [ "$BUNDLE" = 1 ]; then ls -la src-tauri/target/x86_64-pc-windows-msvc/$PROFILE/bundle/nsis/ || true; fi
