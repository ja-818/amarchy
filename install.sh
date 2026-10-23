#!/bin/bash

# Install amarchy from this checkout, on the machine that keeps your sessions
# (a server, say). Safe to run again.
#
#   - links bin/amarchy into ~/.local/bin
#   - a wl-paste that reads what you paste in the app, and a rec that is the
#     phone's or the browser's microphone while you dictate (bin/amarchy-paste,
#     bin/amarchy-rec), for the sessions' Claude
#   - installs the amarchy skill for Claude Code (skill/), so the Claude in a
#     session knows it's in amarchy and how to use the CLI
#   - a systemd user timer that puts idle sessions to sleep (their Claude Code
#     exits until you type in them again; amarchy sleep --after), and one that
#     keeps amarchy up to date (amarchy update)
#   - restarts the app (amarchy app on serves it) on what's installed now
#   - says whether dictation in the app is set up (amarchy dictation setup:
#     a speech model, not fetched by itself: 670 MB)
#   - fetches Omarchy's wallpapers for the themes from Omarchy's repository,
#     in the background (amarchy theme --refresh-wallpapers: 60 MB, kept in
#     ~/.local/state/amarchy/wallpapers)
#   - takes away what an amarchy from before left on an Omarchy desktop (its
#     Hyprland keys, shell plugin, menu entries and theme hook), and brings
#     its state up to date (amarchy migrate)
#
#   ./install.sh             install / update (--host, from when there were
#                            desktops too, does the same)
#   ./install.sh --uninstall remove all of the above, an Omarchy desktop's
#                            amarchy from before too (sessions and worktrees
#                            untouched, and the secrets you gave in the app;
#                            the dictation model and Omarchy's wallpapers,
#                            only downloads, go)
#   ./install.sh --force     either, without asking first when amarchy is
#                            installed from another session's worktree (it
#                            asks in a terminal, and stops without one)

set -euo pipefail

usage() { sed -n '3,/^$/s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"; }

uninstall=0 force=0
for arg in "$@"; do
  case $arg in
    --uninstall) uninstall=1 ;;
    --force) force=1 ;;
    --host) ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
bin_dir="$HOME/.local/bin"
skill_link="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/amarchy"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
state="${XDG_STATE_HOME:-$HOME/.local/state}/amarchy"
sessions="$state/sessions"
# What an amarchy from before put on an Omarchy desktop.
hypr_conf="$HOME/.config/hypr/hyprland.lua"
plugin_dir="$HOME/.config/omarchy/plugins/amarchy"
shell_json="$HOME/.config/omarchy/shell.json"
menu_ext="$HOME/.config/omarchy/extensions/omarchy-menu.jsonc"
theme_hook="$HOME/.config/omarchy/hooks/theme-set.d/amarchy"

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

# The checkouts the installed amarchy runs from now, one per line, as its links
# say (and an Omarchy desktop's from before: its shell plugin and Hyprland's
# load line).
live_checkouts() {
  local t
  if t=$(readlink "$bin_dir/amarchy"); then echo "${t%/bin/amarchy}"; fi
  if t=$(readlink "$plugin_dir"); then echo "${t%/omarchy/plugin}"; fi
  if [[ -f $hypr_conf ]]; then
    sed -n 's|^dofile("\(.*\)/hypr/amarchy\.lua") -- amarchy$|\1|p' "$hypr_conf"
  fi
} 2>/dev/null

# A git worktree of its own (amarchy puts a session in one), not a repo's main
# checkout.
is_worktree() {
  local dir common
  dir=$(git -C "$1" rev-parse --path-format=absolute --git-dir 2>/dev/null) || return 1
  common=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  [[ $dir != "$common" ]]
}

# Who works in a worktree: "<project> · <session>, branch <branch>".
describe() {
  local who="" branch
  if [[ -d $sessions ]] && command -v jq >/dev/null; then
    who=$(find "$sessions" -maxdepth 1 -name '*.json' -exec \
      jq -r --arg p "$1" 'select(.path == $p) | "\(.repo) · \(.title // .name)"' {} + 2>/dev/null | sed -n 1p)
  fi
  branch=$(git -C "$1" branch --show-current 2>/dev/null) || true
  echo "${who:-not an amarchy session}${branch:+, branch $branch}"
}

# Installing (or uninstalling) moves everything to this checkout at once: the
# CLI, the app and the skill. While they're on another session's worktree,
# that session is trying its changes live, and taking them away under it is
# never what you meant by updating from main. So ask first, or stop when
# there's no one to ask (Claude running it, a script), unless it's --force.
# Not asked: a checkout that's gone, a main checkout (the install you come
# back to), and the worktree of the session running this (it's putting its
# own build back).
guard_live() {
  local live mine="" busy=()
  [[ -n ${AMARCHY_PATH:-} ]] && mine=$(realpath -m "$AMARCHY_PATH")
  while IFS= read -r live; do
    [[ $live == "$repo" || $live == "$mine" ]] && continue
    if [[ ! -d $live ]]; then
      echo "amarchy was installed from $live, which is gone."
    elif is_worktree "$live"; then
      busy+=("$live")
    fi
  done < <(live_checkouts | awk '!seen[$0]++')
  ((${#busy[@]})) || return 0
  say "amarchy is installed from another session's worktree:"
  for live in "${busy[@]}"; do echo "  $live ($(describe "$live"))"; done
  echo "That build is being tried live; $1."
  if ((force)); then
    echo "Going on (--force)."
    return 0
  fi
  if [[ -t 0 && -t 1 ]]; then
    local answer
    read -rp "Go on? [y/N] " answer || answer=""
    [[ $answer == [yY]* ]] && return 0
    echo "Left as it was."
  else
    echo "Nothing changed. Run it again with --force to go on anyway."
  fi
  exit 1
}

# Take away what an amarchy from before put on an Omarchy desktop: the load
# line of its keys in hyprland.lua (and the blank lines it leaves at the
# end), its shell plugin and its place in the bar, its entries in the Omarchy
# menu, its theme hook. Each only if it's there; nothing else is touched.
remove_desktop() {
  local tmp changed=0
  if [[ -f $hypr_conf ]] && grep -q -- '-- amarchy$' "$hypr_conf"; then
    backup "$hypr_conf"
    sed -i '/-- amarchy$/d' "$hypr_conf"
    sed -i -e ':a' -e '/^\n*$/{$d;N;ba' -e '}' "$hypr_conf"
    changed=1
  fi
  if [[ -L $plugin_dir ]]; then
    rm -f "$plugin_dir"
    changed=1
  fi
  # The shell watches shell.json and applies the change live.
  if [[ -f $shell_json ]] && command -v jq >/dev/null &&
    jq -e '[.plugins[]?.id, .bar.layout[]?[]?.id] | index("amarchy")' "$shell_json" >/dev/null 2>&1; then
    tmp=$(mktemp)
    if jq '.plugins |= map(select(.id != "amarchy")) | .bar.layout |= with_entries(.value |= map(select(.id != "amarchy")))' \
      "$shell_json" >"$tmp" && jq -e '.version' "$tmp" >/dev/null; then
      replace_if_changed "$shell_json" "$tmp"
    fi
    rm -f "$tmp"
    changed=1
  fi
  if [[ -f $menu_ext ]] && grep -q '// >>> amarchy' "$menu_ext"; then
    tmp=$(mktemp)
    python3 - "$menu_ext" >"$tmp" <<'EOF'
import re, sys
from pathlib import Path
t = re.sub(r"\n?  // >>> amarchy.*?// <<< amarchy\n?", "\n", Path(sys.argv[1]).read_text(), flags=re.S)
i = t.rfind("}")
sys.stdout.write(t[:i].rstrip().rstrip(",") + "\n}\n")
EOF
    replace_if_changed "$menu_ext" "$tmp"
    rm -f "$tmp"
    command -v omarchy-menu >/dev/null && omarchy-menu refresh >/dev/null 2>&1 || true
    changed=1
  fi
  if [[ -f $theme_hook ]]; then
    rm -f "$theme_hook"
    changed=1
  fi
  if ((changed)); then
    # Hyprland drops the keys (a reload without the load line); only where it runs.
    if [[ -n ${HYPRLAND_INSTANCE_SIGNATURE:-} ]] && command -v hyprctl >/dev/null; then
      hyprctl reload >/dev/null 2>&1 || true
    fi
    say "Took away amarchy's pieces of an Omarchy desktop (keys, shell plugin, menu, theme hook)."
  fi
}

if ((uninstall)); then
  guard_live "uninstalling takes it away"
  live=$(live_checkouts | sed -n 1p)
  # The app: no longer served on the tailnet, its service gone.
  if [[ -f $units/amarchy-app.service && -x $bin_dir/amarchy ]]; then
    "$bin_dir/amarchy" app off >/dev/null 2>&1 || true
  fi
  rm -f "$bin_dir/amarchy" "$state/host"
  # The wl-paste and rec of the sessions, only if they're ours.
  [[ $(readlink "$bin_dir/wl-paste" 2>/dev/null) == */bin/amarchy-paste ]] && rm -f "$bin_dir/wl-paste"
  [[ $(readlink "$bin_dir/rec" 2>/dev/null) == */bin/amarchy-rec ]] && rm -f "$bin_dir/rec"
  for unit in amarchy-sleep amarchy-update; do
    systemctl --user disable --now "$unit.timer" >/dev/null 2>&1 || true
    rm -f "$units/$unit.timer" "$units/$unit.service"
  done
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  # Only our own link (to this checkout or the one installed): a skill of the
  # same name the user wrote stays.
  if [[ -L $skill_link ]]; then
    case $(readlink "$skill_link") in
      "$repo/skill" | "${live:-$repo}/skill") rm -f "$skill_link" ;;
    esac
  fi
  remove_desktop
  # The dictation model is only a download (670 MB): fetched again by
  # amarchy dictation setup.
  rm -rf "$state/dictation"
  # Omarchy's wallpapers too, only downloads (amarchy theme
  # --refresh-wallpapers): a fetch under way stops once they're gone.
  systemctl --user stop 'amarchy-wallpapers-*.service' >/dev/null 2>&1 || true
  rm -rf "$state/wallpapers"
  say "amarchy removed. Worktrees and ~/.local/state/amarchy were left alone (but for the dictation model and Omarchy's wallpapers)."
  # Your secrets (amarchy secret) are yours, not a download: kept, and said where.
  secrets="${XDG_CONFIG_HOME:-$HOME/.config}/amarchy/secrets"
  if compgen -G "$secrets/*.env" >/dev/null || compgen -G "$secrets/projects/*.env" >/dev/null; then
    echo "Your secrets (the keys you gave in the app) are still in $secrets: delete that folder if they shouldn't stay."
  fi
  exit 0
fi

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

guard_live "installing from $repo replaces it"

mkdir -p "$bin_dir"
ln -sf "$repo/bin/amarchy" "$bin_dir/amarchy"

# wl-paste for the sessions here, Claude's Ctrl+V and the terminal's: what you
# pasted in the app (see "clipboard" in bin/amarchy). Not over a wl-paste of
# this machine's own (amarchy's own links don't count: run from a session,
# its PATH has one).
own_wl_paste() {
  local d
  local IFS=:
  for d in $PATH; do
    [[ -x $d/wl-paste && $(basename "$(readlink -f "$d/wl-paste")") != amarchy-paste ]] && return 0
  done
  return 1
}
if [[ -L $bin_dir/wl-paste ]] || [[ ! -e $bin_dir/wl-paste ]]; then
  rm -f "$bin_dir/wl-paste"
  if ! own_wl_paste; then
    ln -s "$repo/bin/amarchy-paste" "$bin_dir/wl-paste"
  fi
fi
# rec for the sessions here, Claude's voice mode: the phone's or the browser's
# microphone while you dictate there, else the real rec, which it then runs
# (see "dictation from the phone" in bin/amarchy). Ahead of it on the PATH, so
# a Claude that's already running finds it too; never over a rec of your own.
if [[ -L $bin_dir/rec ]] || [[ ! -e $bin_dir/rec ]]; then
  ln -sfn "$repo/bin/amarchy-rec" "$bin_dir/rec"
fi

# The amarchy skill: Claude Code finds it in every session (their SessionStart
# hook points it there). A link, so it follows this checkout.
if [[ -e $skill_link && ! -L $skill_link ]]; then
  say "Left $skill_link alone (not amarchy's link); the amarchy skill isn't installed."
else
  mkdir -p "$(dirname "$skill_link")"
  ln -sfn "$repo/skill" "$skill_link"
fi

remove_desktop
# The state an amarchy from before left (a desktop's look for the app, say),
# brought up to date once.
"$bin_dir/amarchy" migrate

mkdir -p "$units"
# Sessions sleep once they've been idle, and open on no phone or browser, for
# a while (`amarchy sleep --after`): Claude Code exits and lets go of its
# memory, and comes back when you type in the session or send it something.
# The timer only checks; nothing stays running.
cat >"$units/amarchy-sleep.service" <<UNIT
# Installed by amarchy ($repo/install.sh); removed by its --uninstall.
[Unit]
Description=Put idle amarchy sessions to sleep

[Service]
Type=oneshot
Environment=PATH=$bin_dir:$PATH
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
# amarchy keeps itself up to date (amarchy update --auto), every 5 minutes:
# what's shipped to GitHub reaches it without anyone running this again.
cat >"$units/amarchy-update.service" <<UNIT
# Installed by amarchy ($repo/install.sh); removed by its --uninstall.
[Unit]
Description=Update amarchy to the latest on GitHub
After=network-online.target

[Service]
Type=oneshot
Environment=PATH=$bin_dir:$PATH
ExecStart=$bin_dir/amarchy update --auto
UNIT
cat >"$units/amarchy-update.timer" <<UNIT
# Installed by amarchy ($repo/install.sh); removed by its --uninstall.
[Unit]
Description=Update amarchy to the latest on GitHub, every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=30s

[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload >/dev/null 2>&1 || true
for timer in amarchy-sleep amarchy-update; do
  systemctl --user enable --now "$timer.timer" >/dev/null 2>&1 ||
    say "Couldn't start the $timer timer (systemctl --user enable --now $timer.timer)"
done
# The app, if it's on, runs from the checkout installed now.
systemctl --user try-restart amarchy-app.service >/dev/null 2>&1 || true
# Omarchy's wallpapers for the themes: fetched from Omarchy's repository on
# GitHub, not carried by amarchy (themes/CREDITS), in the background. Those
# already here stay; until one is, its theme wears a drawn one.
"$bin_dir/amarchy" theme --refresh-wallpapers --in-background --quiet >/dev/null 2>&1 || true

say "amarchy installed."
if [[ -f $units/amarchy-app.service ]]; then
  echo "  The app: $("$bin_dir/amarchy" app --status 2>&1 || true)"
else
  echo "  The app, on your phone and in your browser: amarchy app on (needs Tailscale with HTTPS certificates on)."
fi
echo "  Sessions serve on this machine's Tailscale address if it has one, else only on localhost;"
echo "  set NAME= and BIND= in ~/.config/amarchy/host to change it."
echo "  Idle sessions open nowhere sleep after $("$bin_dir/amarchy" sleep --after) min (amarchy sleep --after <min>|off); send one something to wake it"
# Dictation into the app's boxes, written down here (amarchy dictation): set
# up, or how.
echo "  $("$bin_dir/amarchy" dictation 2>&1 | head -1 || true)"
echo "  $("$bin_dir/amarchy" theme --list 2>/dev/null | tail -1 || true)"
