#!/bin/bash

# Install amarchy from this checkout. Safe to run again.
#
#   - links bin/amarchy into ~/.local/bin
#   - loads hypr/amarchy.lua from your Hyprland config (keys, Claude's column)
#   - installs the Omarchy shell plugin (omarchy/plugin): your sessions beside
#     Claude and under an Ⓐ in the bar
#   - adds Amarchy to the Omarchy menu (Super+Space): the amarchy menu, from
#     `amarchy menu --omarchy`
#   - adds an Omarchy theme-set hook, so amarchy keeps its own theme when you
#     switch your desktop's
#   - installs the amarchy skill for Claude Code (skill/), so the Claude in a
#     session knows it's in amarchy and how to use the CLI
#   - adds a systemd user timer that puts idle sessions to sleep (their Claude
#     Code exits until you type in them again; amarchy sleep --after)
#
#   ./install.sh             install / update
#   ./install.sh --host      on a machine without a desktop that keeps sessions
#                            for your desktops (amarchy remote): command + skill
#   ./install.sh --uninstall remove all of the above (sessions and worktrees untouched)

set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
bin_dir="$HOME/.local/bin"
hypr_conf="$HOME/.config/hypr/hyprland.lua"
load_line="dofile(\"$repo/hypr/amarchy.lua\") -- amarchy"
plugin_dir="$HOME/.config/omarchy/plugins/amarchy"
shell_json="$HOME/.config/omarchy/shell.json"
menu_ext="$HOME/.config/omarchy/extensions/omarchy-menu.jsonc"
theme_hook="$HOME/.config/omarchy/hooks/theme-set.d/amarchy"
skill_link="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/amarchy"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

say() { printf '\033[1m%s\033[0m\n' "$*"; }

# Keep only the newest three of the files starting with $1.
prune() {
  local f
  # || true: with none there yet, ls fails and pipefail would end the install.
  { ls -1t "$1"* 2>/dev/null || true; } | tail -n +4 | while IFS= read -r f; do rm -f -- "$f"; done
}

# A copy of a file before amarchy changes it, as <file>.amarchy-bak.<time>; the
# last three are kept.
backup() {
  [[ -f $1 ]] || return 0
  cp "$1" "$1.amarchy-bak.$(date +%s)"
  prune "$1.amarchy-bak."
}

# Write $2 over $1 if it says something new, with a backup of what was there.
replace_if_changed() {
  cmp -s "$2" "$1" && return 0
  backup "$1"
  cp "$2" "$1"
}

# Take the amarchy dofile line out of hyprland.lua, and the blank lines it
# leaves at the end, so putting it back doesn't pile up one more each time.
drop_load_line() {
  sed -i '/-- amarchy$/d' "$hypr_conf"
  sed -i -e ':a' -e '/^\n*$/{$d;N;ba' -e '}' "$hypr_conf"
}

# Rewrite shell.json with a jq filter, keeping a backup; the shell watches it
# and applies the change live.
edit_shell_json() {
  [[ -f $shell_json ]] || return 0
  local tmp
  tmp=$(mktemp)
  if jq "$1" "$shell_json" >"$tmp" && jq -e '.version' "$tmp" >/dev/null; then
    replace_if_changed "$shell_json" "$tmp"
  fi
  rm -f "$tmp"
}

# Put (or, with no block, remove) the amarchy entries in the menu extensions.
edit_menu() {
  mkdir -p "$(dirname "$menu_ext")"
  [[ -f $menu_ext ]] || echo "{}" >"$menu_ext"
  local tmp
  tmp=$(mktemp)
  python3 - "$menu_ext" "${1:-}" >"$tmp" <<'EOF'
import re, sys
from pathlib import Path
f, block = Path(sys.argv[1]), (Path(sys.argv[2]).read_text().rstrip("\n") if sys.argv[2] else "")
t = re.sub(r"\n?  // >>> amarchy.*?// <<< amarchy\n?", "\n", f.read_text(), flags=re.S)
i = t.rfind("}")
body = t[:i].rstrip()
if block and not body.endswith((",", "{")):
    body += ","
sys.stdout.write(body + ("\n\n" + block if block else "") + "\n}\n")
EOF
  replace_if_changed "$menu_ext" "$tmp"
  rm -f "$tmp"
}

if [[ ${1:-} == --uninstall ]]; then
  # Back to your Omarchy theme everywhere (the watcher then ends on its own).
  [[ -x $bin_dir/amarchy ]] && "$bin_dir/amarchy" theme system || true
  rm -f "$bin_dir/amarchy" "${XDG_STATE_HOME:-$HOME/.local/state}/amarchy/host"
  [[ -f $hypr_conf ]] && drop_load_line
  rm -f "$plugin_dir" "$theme_hook"
  systemctl --user disable --now amarchy-sleep.timer >/dev/null 2>&1 || true
  rm -f "$units/amarchy-sleep.timer" "$units/amarchy-sleep.service"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  # Only our own link: a skill of the same name the user wrote stays.
  [[ -L $skill_link && $(readlink "$skill_link") == "$repo/skill" ]] && rm -f "$skill_link"
  edit_shell_json '.plugins |= map(select(.id != "amarchy")) | .bar.layout |= with_entries(.value |= map(select(.id != "amarchy")))'
  [[ -f $menu_ext ]] && edit_menu ""
  hyprctl reload >/dev/null 2>&1 || true
  say "amarchy removed. Worktrees and ~/.local/state/amarchy were left alone."
  exit 0
fi

install_skill() {
  # The amarchy skill: Claude Code finds it in every session (their SessionStart
  # hook points it there). A link, so it follows this checkout.
  if [[ -e $skill_link && ! -L $skill_link ]]; then
    say "Left $skill_link alone (not amarchy's link); the amarchy skill isn't installed."
  else
    mkdir -p "$(dirname "$skill_link")"
    ln -sfn "$repo/skill" "$skill_link"
  fi
}

# A host: a machine without a desktop (a server, say) that keeps sessions for
# your desktops to show (`amarchy remote <host>` on them). Only the command and
# the skill; each session's Claude and terminal run in tmux there.
if [[ ${1:-} == --host ]]; then
  missing=()
  for cmd in python3 git tmux claude; do
    command -v "$cmd" >/dev/null || missing+=("$cmd")
  done
  if ((${#missing[@]})); then
    say "Missing: ${missing[*]}"
    echo "Claude Code: https://docs.claude.com/en/docs/claude-code"
    exit 1
  fi
  # amarchy's tmux settings (extended keys, passthrough) need 3.5.
  tmux_version=$(tmux -V | grep -oE '[0-9]+\.[0-9]+' | head -1)
  if ! printf '3.5\n%s\n' "$tmux_version" | sort -V -C; then
    say "tmux $tmux_version is too old: amarchy needs 3.5 or newer."
    exit 1
  fi
  mkdir -p "$bin_dir"
  ln -sf "$repo/bin/amarchy" "$bin_dir/amarchy"
  install_skill
  # What makes it a host, also with Hyprland installed (amarchy reads it).
  mkdir -p "${XDG_STATE_HOME:-$HOME/.local/state}/amarchy"
  touch "${XDG_STATE_HOME:-$HOME/.local/state}/amarchy/host"
  say "amarchy installed as a host."
  echo "  On your desktop: amarchy remote <how ssh reaches this machine>"
  echo "  ssh has to get in without a password. Keep this machine on a private network"
  echo "  (Tailscale, say). Sessions serve on its Tailscale address if it has one, else"
  echo "  only on localhost; set NAME= and BIND= in ~/.config/amarchy/host to change it."
  exit 0
fi

missing=()
for cmd in python3 git hyprctl jq omarchy-menu-select omarchy-shell omarchy-plugin-validate claude; do
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

# Installs before amarchy-bak left a <file>.bak.<time> of these every time:
# down to the newest three.
for f in "$shell_json" "$menu_ext" "$hypr_conf"; do prune "$f.bak."; done

if ! grep -qF "$load_line" "$hypr_conf"; then
  backup "$hypr_conf"
  drop_load_line
  printf '\n%s\n' "$load_line" >>"$hypr_conf"
fi

# Shell plugin: the Ⓐ bar widget (at the end of the bar's left section).
omarchy-plugin-validate "$repo/omarchy/plugin" >/dev/null
mkdir -p "$(dirname "$plugin_dir")"
ln -sfn "$repo/omarchy/plugin" "$plugin_dir"
edit_shell_json '.plugins = ((.plugins // []) + [{"id":"amarchy"}] | unique_by(.id))
  | if ([.bar.layout[]?[]?.id] | index("amarchy")) then .
    else .bar.layout.left = ((.bar.layout.left // []) + [{"id":"amarchy"}]) end'
omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true

# Omarchy menu entries: the amarchy menu, as `amarchy menu` defines it.
menu_block=$(mktemp)
"$repo/bin/amarchy" menu --omarchy >"$menu_block"
edit_menu "$menu_block"
rm -f "$menu_block"
omarchy-menu refresh >/dev/null 2>&1 || true

# Omarchy runs this once it has finished switching your desktop's theme, which
# repaints the shell and recolors every terminal, amarchy's included.
mkdir -p "$(dirname "$theme_hook")"
cat >"$theme_hook" <<HOOK
#!/bin/bash
# Installed by amarchy ($repo/install.sh); removed by its --uninstall.
[[ -x $bin_dir/amarchy ]] && "$bin_dir/amarchy" theme --refresh
exit 0
HOOK

install_skill

# Sessions sleep once they've been idle and off screen for a while (`amarchy
# sleep --after`): Claude Code exits and lets go of its memory, and comes back
# when you type in the session. The timer only checks; nothing stays running.
mkdir -p "$units"
cat >"$units/amarchy-sleep.service" <<UNIT
# Installed by amarchy ($repo/install.sh); removed by its --uninstall.
[Unit]
Description=Put idle amarchy sessions to sleep

[Service]
Type=oneshot
ExecStart=$bin_dir/amarchy sleep --idle
UNIT
cat >"$units/amarchy-sleep.timer" <<UNIT
# Installed by amarchy ($repo/install.sh); removed by its --uninstall.
[Unit]
Description=Put idle amarchy sessions to sleep, every 30 seconds

[Timer]
OnActiveSec=30s
OnUnitActiveSec=30s
AccuracySec=5s

[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now amarchy-sleep.timer >/dev/null 2>&1 ||
  say "Couldn't start the sleep timer (systemctl --user enable --now amarchy-sleep.timer)"

# Sizes the zen column for this monitor and reloads Hyprland.
"$bin_dir/amarchy" layout
hyprctl reload >/dev/null

# The amarchy theme, if one is set: render it again for this Omarchy and
# monitor, and make sure its watcher is running.
theme=$("$bin_dir/amarchy" theme --show)
[[ $theme == system ]] || "$bin_dir/amarchy" theme "$theme"

say "amarchy installed."
echo "  Super+Alt+A  open amarchy (your last session)"
echo "  Super+Alt+N  new session (projects from ${AMARCHY_WORK:-~/Work})"
echo "  Ctrl+Alt+Z   zen mode: Claude alone, without the sessions and the terminal beside it"
echo "  Ctrl+Alt+Return  between Claude and the terminal (leaves zen mode)"
echo "  Ctrl+Alt+J/K move between sessions · S search · N new session · P new project · T theme · E rename · X close"
echo "  Ctrl+Alt+Up/Down  raise / lower this session's priority (higher ones come first)"
echo "  Ctrl+Alt+M   the amarchy menu: every action with its key"
echo "  Idle sessions off screen sleep after $("$bin_dir/amarchy" sleep --after) min (amarchy sleep --after <min>|off); type in one to wake it"
echo "  Super+Space  Amarchy menu · Ⓐ in the bar"
echo "Change the keys with an \`amarchy = { ... }\` table, see hypr/amarchy.lua."
