#!/bin/bash

# Install amarchy from this checkout: link the script into ~/.local/bin and
# load hypr/amarchy.lua from your Hyprland config. Safe to run again.
#
#   ./install.sh             install / update
#   ./install.sh --uninstall remove the link and the config line (sessions untouched)

set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
bin_dir="$HOME/.local/bin"
hypr_conf="$HOME/.config/hypr/hyprland.lua"
load_line="dofile(\"$repo/hypr/amarchy.lua\") -- amarchy"

say() { printf '\033[1m%s\033[0m\n' "$*"; }

if [[ ${1:-} == --uninstall ]]; then
  rm -f "$bin_dir/amarchy"
  [[ -f $hypr_conf ]] && sed -i '/-- amarchy$/d' "$hypr_conf"
  hyprctl reload >/dev/null 2>&1 || true
  say "amarchy removed. Worktrees and ~/.local/state/amarchy were left alone."
  exit 0
fi

missing=()
for cmd in python3 git hyprctl omarchy-menu-select claude; do
  command -v "$cmd" >/dev/null || missing+=("$cmd")
done
if ! command -v foot >/dev/null && ! command -v kitty >/dev/null &&
  ! command -v alacritty >/dev/null && ! command -v ghostty >/dev/null; then
  missing+=("a terminal (foot, kitty, alacritty or ghostty)")
fi
if ((${#missing[@]})); then
  say "Missing: ${missing[*]}"
  echo "amarchy needs Omarchy 4+ (omarchy-menu-select). Claude Code: https://docs.claude.com/en/docs/claude-code"
  exit 1
fi

if [[ ! -f $hypr_conf ]]; then
  say "No $hypr_conf. amarchy needs Omarchy's Lua Hyprland config."
  exit 1
fi

mkdir -p "$bin_dir"
ln -sf "$repo/bin/amarchy" "$bin_dir/amarchy"

if ! grep -qF "$load_line" "$hypr_conf"; then
  cp "$hypr_conf" "$hypr_conf.bak.$(date +%s)"
  sed -i '/-- amarchy$/d' "$hypr_conf"
  printf '\n%s\n' "$load_line" >>"$hypr_conf"
fi

# Sizes the zen column for this monitor and reloads Hyprland.
"$bin_dir/amarchy" layout
hyprctl reload >/dev/null

say "amarchy installed."
echo "  Super+Alt+A  open amarchy (last session, or cycle to the next)"
echo "  Super+Alt+N  new session (repos from ${AMARCHY_WORK:-~/Work})"
echo "  Super+Alt+M  toggle the cockpit (Mission Control + terminal)"
echo "Change the keys with an \`amarchy = { ... }\` table, see hypr/amarchy.lua."
