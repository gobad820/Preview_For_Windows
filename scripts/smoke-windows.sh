#!/usr/bin/env bash
# Copies the built exe (and optionally a PDF) to the Windows host and screenshots the running window.
# Usage: scripts/smoke-windows.sh [path/to.pdf] [waitMs] [frameTimesMs e.g. "800,2000"] [focus]
# The window pops up on the host for ~waitMs; it is NOT focused unless "focus" is passed, so
# keyboard/mouse input from whoever is using the desktop never lands in it.
set -euo pipefail
cd "$(dirname "$0")/.."
EXE="src-tauri/target/x86_64-pc-windows-msvc/release/Preview.exe"
PDF="${1:-}"; WAIT="${2:-3000}"; FRAMES="${3:-}"; FOCUS="${4:-}"
WIN_DIR="/mnt/c/Users/Public/pfw-smoke"
mkdir -p "$WIN_DIR"
cp "$EXE" "$WIN_DIR/Preview.exe"
cp scripts/smoke-windows.ps1 "$WIN_DIR/smoke.ps1"
ARGS=(-Exe 'C:\Users\Public\pfw-smoke\Preview.exe' -WaitMs "$WAIT")
if [ -n "$FRAMES" ]; then ARGS+=(-Frames "$FRAMES"); fi
if [ "$FOCUS" = "focus" ]; then ARGS+=(-Focus); fi
if [ -n "$PDF" ]; then
  cp "$PDF" "$WIN_DIR/$(basename "$PDF")"
  ARGS+=(-Pdf "C:\\Users\\Public\\pfw-smoke\\$(basename "$PDF")")
fi
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\Public\pfw-smoke\smoke.ps1' "${ARGS[@]}" | tr -d '\r'
echo "screenshot: $WIN_DIR/shot.png"
