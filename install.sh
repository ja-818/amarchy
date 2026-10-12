#!/bin/bash

# Install amarchy from this checkout. Safe to run again.
#
#   - links bin/amarchy into ~/.local/bin
#   - loads hypr/amarchy.lua from your Hyprland config (keys, zen column)
#   - installs the Omarchy shell plugin (omarchy/plugin): your sessions under
#     an Ⓐ in the bar
#   - adds Amarchy to the Omarchy menu (Super+Space), from omarchy/menu.jsonc
#
#   ./install.sh             install / update
#   ./install.sh --uninstall remove all of the above (sessions and worktrees untouched)

set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
bin_dir="$HOME/.local/bin"
hypr_conf="$HOME/.config/hypr/hyprland.lua"
load_line="dofile(\"$repo/hypr/amarchy.lua\") -- amarchy"
plugin_dir="$HOME/.config/omarchy/plugins/amarchy"
shell_json="$HOME/.config/omarchy/shell.json"
menu_ext="$HOME/.config/omarchy/extensions/omarchy-menu.jsonc"

say() { printf '\033[1m%s\033[0m\n' "$*"; }

backup() { [[ -f $1 ]] && cp "$1" "$1.bak.$(date +%s)"; }

# Rewrite shell.json with a jq filter, keeping a backup; the shell watches it
# and applies the change live.
edit_shell_json() {
  [[ -f $shell_json ]] || return 0
  local tmp
  tmp=$(mktemp)
  if jq "$1" "$shell_json" >"$tmp" && jq -e '.version' "$tmp" >/dev/null; then
    backup "$shell_json"
    cp "$tmp" "$shell_json"
  fi
  rm -f "$tmp"
}

# Put (or, with no block, remove) the amarchy entries in the menu extensions.
edit_menu() {
  mkdir -p "$(dirname "$menu_ext")"
  [[ -f $menu_ext ]] || echo "{}" >"$menu_ext"
  backup "$menu_ext"
  python3 - "$menu_ext" "${1:-}" <<'EOF'
import re, sys
from pathlib import Path
f, block = Path(sys.argv[1]), (Path(sys.argv[2]).read_text().rstrip("\n") if sys.argv[2] else "")
t = re.sub(r"\n?  // >>> amarchy.*?// <<< amarchy\n?", "\n", f.read_text(), flags=re.S)
i = t.rfind("}")
body = t[:i].rstrip()
if block and not body.endswith((",", "{")):
    body += ","
f.write_text(body + ("\n\n" + block if block else "") + "\n}\n")
EOF
}

if [[ ${1:-} == --uninstall ]]; then
  rm -f "$bin_dir/amarchy"
  [[ -f $hypr_conf ]] && sed -i '/-- amarchy$/d' "$hypr_conf"
  rm -f "$plugin_dir"
  edit_shell_json '.plugins |= map(select(.id != "amarchy")) | .bar.layout |= with_entries(.value |= map(select(.id != "amarchy")))'
  [[ -f $menu_ext ]] && edit_menu ""
  hyprctl reload >/dev/null 2>&1 || true
  say "amarchy removed. Worktrees and ~/.local/state/amarchy were left alone."
  exit 0
fi

missing=()
for cmd in python3 git hyprctl jq omarchy-menu-select omarchy-shell claude; do
  command -v "$cmd" >/dev/null || missing+=("$cmd")
done
if ! command -v foot >/dev/null && ! command -v kitty >/dev/null &&
  ! command -v alacritty >/dev/null && ! command -v ghostty >/dev/null; then
  missing+=("a terminal (foot, kitty, alacritty or ghostty)")
fi
if ((${#missing[@]})); then
  say "Missing: ${missing[*]}"
  echo "amarchy needs Omarchy 4+ (omarchy-shell, omarchy-menu-select). Claude Code: https://docs.claude.com/en/docs/claude-code"
  exit 1
fi

if [[ ! -f $hypr_conf ]]; then
  say "No $hypr_conf. amarchy needs Omarchy's Lua Hyprland config."
  exit 1
fi

mkdir -p "$bin_dir"
ln -sf "$repo/bin/amarchy" "$bin_dir/amarchy"

if ! grep -qF "$load_line" "$hypr_conf"; then
  backup "$hypr_conf"
  sed -i '/-- amarchy$/d' "$hypr_conf"
  printf '\n%s\n' "$load_line" >>"$hypr_conf"
fi

# Shell plugin: the Ⓐ bar widget (next to the tray).
omarchy-plugin-validate "$repo/omarchy/plugin" >/dev/null
mkdir -p "$(dirname "$plugin_dir")"
ln -sfn "$repo/omarchy/plugin" "$plugin_dir"
edit_shell_json '.plugins = ((.plugins // []) + [{"id":"amarchy"}] | unique_by(.id))
  | if ([.bar.layout[]?[]?.id] | index("amarchy")) then .
    else .bar.layout.right = ((.bar.layout.right // [])[:1] + [{"id":"amarchy"}] + (.bar.layout.right // [])[1:]) end'
omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true

# Omarchy menu entries.
edit_menu "$repo/omarchy/menu.jsonc"

# Sizes the zen column for this monitor and reloads Hyprland.
"$bin_dir/amarchy" layout
hyprctl reload >/dev/null

say "amarchy installed."
echo "  Super+Alt+A  open amarchy (your last session)"
echo "  Super+Alt+N  new session (projects from ${AMARCHY_WORK:-~/Work})"
echo "  Ctrl+Alt+Return  toggle the session terminal"
echo "  Ctrl+Alt+J/K move between sessions · N new · A add project · X close"
echo "  Super+Space  Amarchy menu · Ⓐ in the bar"
echo "Change the keys with an \`amarchy = { ... }\` table, see hypr/amarchy.lua."
