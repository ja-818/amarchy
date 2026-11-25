#!/bin/bash

# amarchy at home on an Omarchy desktop (Omarchy 4: its shell, and Hyprland's
# config in Lua). install.sh runs this; safe to run again.
#
#   - the Ⓐ in the bar: the shell plugin amarchy.chats (omarchy/plugin),
#     linked into ~/.config/omarchy/plugins and put on the bar the first
#     time (where you move it, or whether you take it off, is yours after)
#   - the key, Super+Shift+R unless `amarchy key` says another (or off), and
#     the desktop app's window see-through as Omarchy's terminals are:
#     omarchy/hypr/amarchy.lua, loaded from ~/.config/hypr/hyprland.lua by a
#     line ending in "-- amarchy"
#   - Amarchy in the Omarchy menu (Super+Space), a block of its own in
#     ~/.config/omarchy/extensions/omarchy-menu.jsonc
#   - the theme live: "Omarchy (live)" made again (amarchy theme --omarchy)
#     when Omarchy's look changes, by events: its theme-set hook
#     (~/.config/omarchy/hooks/theme-set.d/amarchy) and a systemd path unit,
#     amarchy-omarchy-look.path (the wallpaper, the font, the theme's name,
#     your shell.toml and looknfeel.lua); made once now
#   - takes away what an amarchy from before left (its plugin "amarchy")
#
#   omarchy/install.sh             put them in place, on an Omarchy desktop
#                                  (elsewhere, take away any left)
#   omarchy/install.sh --uninstall take them all away
#   omarchy/install.sh --menu      only the Omarchy menu's entry, its key
#                                  hint again (amarchy key runs it)
#
# Each file it changes is backed up first (<file>.amarchy-bak.<time>, the
# last three kept), and only when what it writes is new. The running shell
# and Hyprland take the change at once; without them (over ssh), the files
# are read when they start.

set -euo pipefail

uninstall=0 menu_only=0
for arg in "$@"; do
  case $arg in
    --uninstall) uninstall=1 ;;
    --menu) menu_only=1 ;;
    -h | --help) sed -n '3,/^$/s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "usage: omarchy/install.sh [--uninstall | --menu]" >&2; exit 2 ;;
  esac
done

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
bin_dir="$HOME/.local/bin"
# Omarchy's own files are under $HOME/.config whatever XDG says (as its
# scripts and its shell read them); systemd's follow XDG.
config="$HOME/.config"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
state="${XDG_STATE_HOME:-$HOME/.local/state}/amarchy"
hypr_conf="$config/hypr/hyprland.lua"
shell_json="$config/omarchy/shell.json"
menu_ext="$config/omarchy/extensions/omarchy-menu.jsonc"
plugin_id="amarchy.chats"
plugin_dir="$config/omarchy/plugins/$plugin_id"
# The Ⓐ was put on the bar once: never again by an update (you may have
# moved it, or taken it off).
placed="$state/omarchy-bar-placed"
# shell.json was made by amarchy from Omarchy's defaults (there was none):
# gone again on --uninstall while it's still just those.
shell_made="$state/omarchy-shell-json-made"
load_line="dofile(\"$repo/omarchy/hypr/amarchy.lua\") -- amarchy"
# What omarchy/hypr/amarchy.lua said when Hyprland last read it: an update
# that changes it (not the line that loads it) has Hyprland read it again.
hypr_read="$state/omarchy-hypr-read"
# What the amarchy from before put here (its plugin, "amarchy", and a theme
# hook that ran a command it no longer has).
old_plugin_dir="$config/omarchy/plugins/amarchy"
old_theme_hook="$config/omarchy/hooks/theme-set.d/amarchy"
# The theme live: Omarchy's hook (the same name as the old one's) and the
# unit that makes it again.
theme_hook="$config/omarchy/hooks/theme-set.d/amarchy"
look_unit="amarchy-omarchy-look"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
did=()
omarchy_root=""

# A temporary file beside $1 (its own folder: the same disk, and never a
# full /tmp's problem).
tmp_beside() {
  mkdir -p "$(dirname "$1")"
  mktemp "$(dirname "$1")/.amarchy.XXXXXX"
}

# Keep only the newest three of the files starting with $1.
prune() {
  local f
  { ls -1t "$1"* 2>/dev/null || true; } | tail -n +4 | while IFS= read -r f; do rm -f -- "$f"; done
}

backup() {
  [[ -f $1 ]] || return 0
  cp "$1" "$1.amarchy-bak.$(date +%s%N)"
  prune "$1.amarchy-bak."
}

# Write $2 over $1 if it says something new, with a backup of what was
# there. Says whether it changed anything.
replace_if_changed() {
  cmp -s "$2" "$1" && return 1
  backup "$1"
  cp "$2" "$1"
}

# Omarchy 4 is here: its shell, and Hyprland's config in Lua. Its commands
# go on the PATH when they aren't (a session's terminal, a systemd unit).
omarchy_here() {
  local root=${OMARCHY_PATH:-}
  if [[ -z $root && -f /etc/omarchy.conf ]]; then
    root=$(. /etc/omarchy.conf 2>/dev/null; echo "${OMARCHY_PATH:-}")
  fi
  root=${root:-/usr/share/omarchy}
  [[ -d $root/shell && -f $hypr_conf ]] || return 1
  omarchy_root=$root
  [[ :$PATH: == *":$root/bin:"* ]] || PATH="$PATH:$root/bin"
  command -v omarchy-shell >/dev/null
}

# The running shell, asked something (omarchy-shell shell <method> ...): its
# answer, or nothing when there's no shell to ask.
shell_ask() {
  command -v omarchy-shell >/dev/null || return 1
  OMARCHY_SHELL_IPC_TIMEOUT=${OMARCHY_SHELL_IPC_TIMEOUT:-3} omarchy-shell shell "$@" 2>/dev/null
}

# shell.json changed by a jq filter, when there is one and the result reads.
edit_shell_json() {
  [[ -f $shell_json ]] && command -v jq >/dev/null || return 1
  local tmp
  tmp=$(tmp_beside "$shell_json")
  if jq "$1" "$shell_json" >"$tmp" 2>/dev/null && jq -e '.version' "$tmp" >/dev/null 2>&1; then
    replace_if_changed "$shell_json" "$tmp" || true
  fi
  rm -f "$tmp"
}

# Whether shell.json has a plugin, on the bar or in plugins[].
in_shell_json() {
  [[ -f $shell_json ]] && command -v jq >/dev/null &&
    jq -e --arg id "$1" '[.plugins[]?.id, .bar.layout[]?[]?.id] | index($id)' "$shell_json" >/dev/null 2>&1
}

# A plugin off the bar and out of shell.json: through the running shell,
# which writes shell.json and shows it at once, and then in the file itself
# (no shell running, or an old one).
plugin_off() {
  in_shell_json "$1" || return 0
  shell_ask setPluginEnabled "$1" false >/dev/null || true
  in_shell_json "$1" || return 0
  edit_shell_json "$(printf '.plugins |= map(select(.id != "%s")) | .bar.layout |= with_entries(.value |= map(select(.id != "%s")))' "$1" "$1")" || true
}

# Hyprland reads its config again: the running one (this session's, else
# the newest found, as a systemd timer or ssh has none). Fails only when one
# runs and didn't take it; with none running, it reads it when it starts.
hypr_reload() {
  command -v hyprctl >/dev/null || return 0
  local sig=${HYPRLAND_INSTANCE_SIGNATURE:-} sock
  if [[ -z $sig ]]; then
    sock=$(ls -1t "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"/hypr/*/.socket.sock 2>/dev/null | head -n 1 || true)
    [[ -n $sock ]] || return 0
    sig=$(basename "$(dirname "$sock")")
  fi
  HYPRLAND_INSTANCE_SIGNATURE=$sig hyprctl reload >/dev/null 2>&1
}

# The line in hyprland.lua that loads $1 (none: takes it away), in place of
# any other amarchy line (one to another checkout, the amarchy from before's
# hypr/amarchy.lua), at the end, where Omarchy's `o` is set up. Hyprland
# reloads when it changed, or when amarchy.lua itself did (an update).
hypr_line() {
  [[ -f $hypr_conf ]] || return 0
  local tmp reload=0 said=""
  tmp=$(tmp_beside "$hypr_conf")
  sed '/-- amarchy$/d' "$hypr_conf" >"$tmp"
  # The blank lines left at the end go too.
  sed -i -e ':a' -e '/^\n*$/{$d;N;ba' -e '}' "$tmp"
  [[ -n ${1:-} ]] && printf '\n%s\n' "$1" >>"$tmp"
  if replace_if_changed "$hypr_conf" "$tmp"; then
    did+=("the key")
    reload=1
  fi
  rm -f "$tmp"
  if [[ -n ${1:-} ]]; then
    said=$(cksum <"$repo/omarchy/hypr/amarchy.lua")
    [[ $(cat "$hypr_read" 2>/dev/null) == "$said" ]] || reload=1
  fi
  [[ -n ${1:-} ]] || rm -f "$hypr_read"
  ((reload)) || return 0
  # Kept once Hyprland has read it (or will, when it starts): a reload that
  # didn't go is tried again next time.
  if hypr_reload && [[ -n $said ]]; then
    mkdir -p "$state"
    echo "$said" >"$hypr_read"
  fi
}

# amarchy's block in the Omarchy menu's extensions ($1; none: taken away),
# between "// >>> amarchy" and "// <<< amarchy". The shell reads the file
# again when it changes.
menu_block() {
  [[ -n ${1:-} || -f $menu_ext ]] || return 0
  mkdir -p "$(dirname "$menu_ext")"
  [[ -f $menu_ext ]] || echo "{}" >"$menu_ext"
  local tmp
  tmp=$(tmp_beside "$menu_ext")
  python3 - "$menu_ext" "${1:-}" >"$tmp" <<'EOF'
import re, sys
from pathlib import Path
f, block = Path(sys.argv[1]), sys.argv[2].rstrip("\n")
t = re.sub(r"\n?[ \t]*// >>> amarchy.*?// <<< amarchy[^\n]*\n?", "\n", f.read_text(), flags=re.S)
i = t.rfind("}")
body = t[:i].rstrip() if i >= 0 else "{"
if block and not body.endswith((",", "{")):
    body += ","
sys.stdout.write(body + ("\n\n" + block if block else "") + "\n}\n")
EOF
  if replace_if_changed "$menu_ext" "$tmp"; then
    did+=("Amarchy in the Omarchy menu")
  fi
  rm -f "$tmp"
}

# What the amarchy from before put here: its plugin off the bar and its link
# gone; its theme hook (only one amarchy wrote).
old_plugin_off() {
  plugin_off amarchy
  if [[ -L $old_plugin_dir ]]; then
    rm -f "$old_plugin_dir"
    did+=("the old bar plugin")
  fi
  if [[ -f $old_theme_hook ]] && grep -q 'Installed by amarchy' "$old_theme_hook" && grep -q 'theme --refresh' "$old_theme_hook"; then
    rm -f "$old_theme_hook"
    did+=("the old theme hook")
  fi
}

# systemctl --user, when there's a user manager to ask.
user_systemd() {
  command -v systemctl >/dev/null && systemctl --user "$@" >/dev/null 2>&1
}

# $1 written from stdin, when it says something new (amarchy's own file: no
# backup). Says whether it changed.
write_ours() {
  local tmp
  tmp=$(tmp_beside "$1")
  cat >"$tmp"
  if cmp -s "$tmp" "$1"; then
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$1"
  chmod 644 "$1"
}

# The theme live, made again by events (see "the theme live" in bin/amarchy):
# a systemd path unit for the files Omarchy changes, and Omarchy's theme-set
# hook, which runs once a theme is all in place (Hyprland's corners too).
look_install() {
  local changed=0
  write_ours "$units/$look_unit.service" <<UNIT && changed=1
# amarchy's ($repo/omarchy/install.sh puts it here; its --uninstall takes it away).
[Unit]
Description=Make the theme Omarchy (live) again from Omarchy's look, and send it to your machines

[Service]
Type=oneshot
Environment=PATH=$bin_dir:/usr/local/bin:/usr/bin:/bin
ExecStart=$bin_dir/amarchy theme --omarchy --quiet
UNIT
  write_ours "$units/$look_unit.path" <<UNIT && changed=1
# amarchy's ($repo/omarchy/install.sh puts it here; its --uninstall takes it away).
[Unit]
Description=Omarchy's look changed: its wallpaper, font or theme, or your shell.toml or looknfeel.lua

[Path]
# The folder, not its background link: Omarchy swaps the link (ln -nsf), and a
# watch on the link itself would follow it to the old picture. The theme's
# folder is swapped in there too, and theme.name written.
PathChanged=%h/.local/state/omarchy/current
PathChanged=%h/.local/state/omarchy/current/theme.name
PathChanged=%h/.config/fontconfig/fonts.conf
PathChanged=%h/.config/omarchy/shell.toml
PathChanged=%h/.config/hypr/looknfeel.lua
Unit=$look_unit.service

[Install]
WantedBy=default.target
UNIT
  if ((changed)); then
    user_systemd daemon-reload || true
    did+=("Omarchy (live)")
  fi
  user_systemd enable --now "$look_unit.path" || true
  write_ours "$theme_hook" <<'HOOK' || true
#!/bin/bash
# amarchy's (its install.sh puts it here; its --uninstall takes it away): the
# theme Omarchy just set, made into "Omarchy (live)" (amarchy-omarchy-look).
systemctl --user start --no-block amarchy-omarchy-look.service 2>/dev/null ||
  "$HOME/.local/bin/amarchy" theme --omarchy --in-background --quiet
exit 0
HOOK
  chmod 755 "$theme_hook"
  # Made now, from the theme on the desktop now.
  user_systemd start --no-block "$look_unit.service" ||
    "$bin_dir/amarchy" theme --omarchy --in-background --quiet >/dev/null 2>&1 || true
}

look_remove() {
  local gone=0
  if [[ -f $units/$look_unit.path || -f $units/$look_unit.service ]]; then
    user_systemd disable --now "$look_unit.path" || true
    user_systemd stop "$look_unit.service" || true
    rm -f "$units/$look_unit.path" "$units/$look_unit.service"
    user_systemd daemon-reload || true
    gone=1
  fi
  if [[ -f $theme_hook ]] && grep -q "$look_unit" "$theme_hook"; then
    rm -f "$theme_hook"
    gone=1
  fi
  ((gone)) && did+=("Omarchy (live)'s events")
  return 0
}

install_home() {
  old_plugin_off
  # The Ⓐ: the plugin, a link to this checkout (an update reaches it, and the
  # shell reloads a plugin whose files change).
  mkdir -p "$(dirname "$plugin_dir")"
  if [[ $(readlink "$plugin_dir" 2>/dev/null) != "$repo/omarchy/plugin" ]]; then
    rm -rf "$plugin_dir"
    ln -s "$repo/omarchy/plugin" "$plugin_dir"
    did+=("the Ⓐ in the bar")
  fi
  shell_ask rescanPlugins >/dev/null || true
  # On the bar the first time, at the end of its left side: through the
  # running shell, else in shell.json (read when the shell starts).
  if [[ ! -f $placed ]]; then
    local put
    put=$(shell_ask putBarWidget "$plugin_id" '{"section":"left"}' || true)
    if [[ $put != ok ]] && ! in_shell_json "$plugin_id"; then
      # No shell.json yet (the bar as Omarchy ships it): Omarchy's own
      # defaults, as the shell writes them when it first saves a change.
      if [[ ! -f $shell_json && -f $omarchy_root/config/omarchy/shell.json ]]; then
        mkdir -p "$(dirname "$shell_json")" "$state"
        cp "$omarchy_root/config/omarchy/shell.json" "$shell_json"
        touch "$shell_made"
      fi
      edit_shell_json "$(printf 'if ([.bar.layout[]?[]?.id] | index("%s")) then . else .bar.layout.left = ((.bar.layout.left // []) + [{"id":"%s"}]) end' "$plugin_id" "$plugin_id")" || true
    fi
    if [[ $put == ok ]] || in_shell_json "$plugin_id"; then
      mkdir -p "$state"
      date -Is >"$placed"
    fi
  fi
  hypr_line "$load_line"
  menu_entry
  look_install
}

# The key that brings amarchy to the front, in words (amarchy key: the
# setting in ~/.config/amarchy/key, else Super+Shift+R), or nothing when off.
key_words() {
  python3 - "${XDG_CONFIG_HOME:-$HOME/.config}/amarchy/key" <<'PY'
import re, sys
try:
    said = open(sys.argv[1]).read().strip()
except OSError:
    said = ""
if said != "off":
    chord = said if said and re.fullmatch(r"\w+[\w +:]*", said) else "SUPER + SHIFT + R"
    print("+".join(p.capitalize() if p.isupper() and len(p) > 1 else p for p in chord.split(" + ")))
PY
}

# Amarchy in the Omarchy menu, its key as the hint under it.
menu_entry() {
  local action entry
  action=$(printf "'%s' open" "${bin_dir//\'/\'\\\'\'}/amarchy")
  entry=$(python3 -c 'import json, sys; print(json.dumps({"icon": "Ⓐ", "label": "Amarchy",
    "description": "Your chats" + (" · " + sys.argv[2] if sys.argv[2] else "") + ". Stop babysitting your agents.",
    "action": sys.argv[1]}, ensure_ascii=False))' "$action" "$(key_words)")
  menu_block "  // >>> amarchy (amarchy's install.sh puts this here; its --uninstall takes it away)
  \"amarchy\": $entry,
  // <<< amarchy"
}

remove_home() {
  old_plugin_off
  plugin_off "$plugin_id"
  if [[ -f $shell_made ]]; then
    if [[ -n $omarchy_root && -f $shell_json ]] && command -v jq >/dev/null &&
      jq -e --slurpfile d "$omarchy_root/config/omarchy/shell.json" '. == $d[0]' "$shell_json" >/dev/null 2>&1; then
      rm -f "$shell_json"
    fi
    rm -f "$shell_made"
  fi
  if [[ -L $plugin_dir ]]; then
    rm -f "$plugin_dir"
    did+=("the Ⓐ in the bar")
  fi
  shell_ask rescanPlugins >/dev/null || true
  rm -f "$placed"
  hypr_line ""
  menu_block ""
  look_remove
}

if ((menu_only)); then
  if omarchy_here; then menu_entry; fi
  exit 0
fi

if ((uninstall)); then
  omarchy_here || true
  remove_home
  ((${#did[@]})) && say "Took away amarchy's pieces of Omarchy: $(IFS=,; echo "${did[*]}" | sed 's/,/, /g')."
  exit 0
fi

if omarchy_here; then
  install_home
  ((${#did[@]})) && say "On Omarchy: $(IFS=,; echo "${did[*]}" | sed 's/,/, /g')."
  key=$(key_words)
  echo "  ${key:-No key}${key:+  amarchy at the front (the desktop app); another: amarchy key <keys>}${key:-: amarchy key <keys> sets one}"
  # Something else of this machine's Hyprland on that key too (its own
  # bindings, a newer Omarchy): said, with how to pick another.
  [[ -x $bin_dir/amarchy ]] && "$bin_dir/amarchy" key --check 2>/dev/null | sed 's/^/  /' || true
  echo "  Ⓐ in the bar: lights up when a chat needs you, and says how many"
else
  remove_home
  ((${#did[@]})) && say "Took away what an amarchy from before left on Omarchy: $(IFS=,; echo "${did[*]}" | sed 's/,/, /g')."
fi
exit 0
