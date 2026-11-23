#!/bin/bash

# Install amarchy from this checkout, on the machine that keeps your sessions
# (a server, say). Safe to run again.
#
#   - links bin/amarchy into ~/.local/bin
#   - a wl-paste that reads what you paste in the app (bin/amarchy-paste), for
#     the sessions' Claude
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
#     ~/.local/state/amarchy/wallpapers), and cuts the fonts and your own
#     wallpapers smaller for the app (amarchy theme --cut: kept in
#     ~/.local/state/amarchy/cuts)
#   - on an Omarchy desktop (Omarchy 4), omarchy/install.sh: the Ⓐ in the
#     bar, Super+Alt+A and Amarchy in the Omarchy menu; elsewhere, it takes
#     away what an amarchy from before left there. Brings the state of an
#     amarchy from before up to date (amarchy migrate)
#   - on a computer with a desktop (Omarchy, or any Wayland or X session):
#     the desktop app, amarchy-desktop (desktop/install.sh: built here, in
#     your launcher, amarchy:// links, in the tray from login), kept up to
#     date with amarchy; an update builds it in the background
#
#   ./install.sh             install / update (--host, from when there were
#                            desktops too, does the same)
#   ./install.sh --uninstall remove all of the above, amarchy's pieces of
#                            Omarchy too (sessions and worktrees
#                            untouched, and the secrets you gave in the app;
#                            the dictation model, Omarchy's wallpapers and
#                            the look's cuts, only downloads, go)
#   ./install.sh --force     either, without asking first when amarchy is
#                            installed from another session's worktree (it
#                            asks in a terminal, and stops without one)
#   ./install.sh --desktop   the desktop app too, wherever this runs (over
#                            SSH, say); --no-desktop: not it

set -euo pipefail

usage() { sed -n '3,/^$/s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"; }

uninstall=0 force=0 desktop=auto
for arg in "$@"; do
  case $arg in
    --uninstall) uninstall=1 ;;
    --force) force=1 ;;
    --desktop) desktop=yes ;;
    --no-desktop) desktop=no ;;
    --host) ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# ---- a packaged amarchy (packaging/arch): /usr/share/amarchy, no .git. It
# updates with your packages, so the timer below only checks Claude Code;
# `amarchy setup` runs this.
packaged=""
if [[ ! -e $repo/.git ]]; then
  packaged=$(pacman -Qqo "$repo/bin/amarchy" 2>/dev/null | head -1 || true)
  packaged=${packaged:-a package}
fi
# ---- end of a packaged amarchy
bin_dir="$HOME/.local/bin"
skill_link="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/amarchy"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
state="${XDG_STATE_HOME:-$HOME/.local/state}/amarchy"
sessions="$state/sessions"
# ---- Omarchy home (track C): what amarchy puts on an Omarchy desktop
# (omarchy/install.sh), read here only to know which checkout it runs from.
hypr_conf="$HOME/.config/hypr/hyprland.lua"
omarchy_plugins="$HOME/.config/omarchy/plugins"
# ---- end of Omarchy home

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
# say (and on Omarchy: its bar plugin and Hyprland's load line, today's or
# those of an amarchy from before).
live_checkouts() {
  local t
  if t=$(readlink "$bin_dir/amarchy"); then echo "${t%/bin/amarchy}"; fi
  for t in amarchy.chats amarchy; do
    if t=$(readlink "$omarchy_plugins/$t"); then echo "${t%/omarchy/plugin}"; fi
  done
  if [[ -f $hypr_conf ]]; then
    sed -n -e 's|^dofile("\(.*\)/omarchy/hypr/amarchy\.lua") -- amarchy$|\1|p' \
      -e 's|^dofile("\(.*\)/hypr/amarchy\.lua") -- amarchy$|\1|p' "$hypr_conf"
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

if ((uninstall)); then
  guard_live "uninstalling takes it away"
  # ---- amarchy's own Tailscale node (track H): stopped and gone (its sign-in kept).
  [[ -x $repo/tailnet/install.sh ]] && "$repo/tailnet/install.sh" --uninstall || true
  # ---- the desktop app (track B): gone with amarchy, wherever it was installed.
  [[ -x $repo/desktop/install.sh ]] && "$repo/desktop/install.sh" --uninstall || true
  # ---- end of the desktop app (track B)
  live=$(live_checkouts | sed -n 1p)
  # The chats' previews: stopped, and off the tailnet (nothing would look after them).
  [[ -x $bin_dir/amarchy ]] && "$bin_dir/amarchy" previews-off >/dev/null 2>&1 || true
  # The app: no longer served on the tailnet, its service gone.
  if [[ -f $units/amarchy-app.service && -x $bin_dir/amarchy ]]; then
    "$bin_dir/amarchy" app off >/dev/null 2>&1 || true
  fi
  rm -f "$bin_dir/amarchy" "$state/host"
  # The wl-paste of the sessions, only if it's ours.
  [[ $(readlink "$bin_dir/wl-paste" 2>/dev/null) == */bin/amarchy-paste ]] && rm -f "$bin_dir/wl-paste"
  for unit in amarchy-sleep amarchy-update; do
    systemctl --user disable --now "$unit.timer" >/dev/null 2>&1 || true
    rm -f "$units/$unit.timer" "$units/$unit.service" "$units/$unit.timer.d/zz-amarchy-paused.conf"
    rmdir "$units/$unit.timer.d" 2>/dev/null || true
  done
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  # Automations you paused in the app stay paused (that was your choice): said,
  # with how to resume each one without amarchy.
  for paused in "$units"/*.timer.d/zz-amarchy-paused.conf; do
    [[ -f $paused ]] || continue
    timer=$(basename "$(dirname "$paused")" .d)
    say "$timer stays paused: rm $paused && systemctl --user daemon-reload && systemctl --user start $timer"
  done
  # Only our own link (to this checkout or the one installed): a skill of the
  # same name the user wrote stays.
  if [[ -L $skill_link ]]; then
    case $(readlink "$skill_link") in
      "$repo/skill" | "${live:-$repo}/skill") rm -f "$skill_link" ;;
    esac
  fi
  # ---- Omarchy home (track C): its pieces of Omarchy, all of them.
  "$repo/omarchy/install.sh" --uninstall || say "Couldn't take away all of amarchy's pieces of Omarchy (omarchy/install.sh --uninstall)"
  # ---- end of Omarchy home
  # The dictation model is only a download (670 MB), and the whisper.cpp
  # built there where no package has it: both made again by amarchy
  # dictation setup.
  rm -rf "$state/dictation"
  # Omarchy's wallpapers too, only downloads (amarchy theme
  # --refresh-wallpapers): a fetch under way stops once they're gone.
  systemctl --user stop 'amarchy-wallpapers-*.service' >/dev/null 2>&1 || true
  rm -rf "$state/wallpapers"
  # The look's files cut smaller (amarchy theme --cut): made again when wanted.
  systemctl --user stop 'amarchy-cuts-*.service' >/dev/null 2>&1 || true
  rm -rf "$state/cuts"
  say "amarchy removed. Worktrees and ~/.local/state/amarchy were left alone (but for the dictation model and Omarchy's wallpapers)."
  # Your secrets (amarchy secret) are yours, not a download: kept, and said where.
  secrets="${XDG_CONFIG_HOME:-$HOME/.config}/amarchy/secrets"
  if compgen -G "$secrets/*.env" >/dev/null || compgen -G "$secrets/projects/*.env" >/dev/null; then
    echo "Your secrets (the keys you gave in the app) are still in $secrets: delete that folder if they shouldn't stay."
  fi
  # The machines paired with this one (amarchy machines) and their keys: kept,
  # for an install again; the other machines show this one as off meanwhile.
  machines="${XDG_CONFIG_HOME:-$HOME/.config}/amarchy/machines.json"
  if [[ -s $machines ]] && [[ $(<"$machines") != "[]" ]]; then
    echo "The machines paired with this one stay paired ($machines, with their keys): they show it as off. To unpair, run amarchy machines remove <name> before uninstalling, or on each of them."
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
# The rec that amarchy used to put here for Claude's voice mode is gone (dictation
# is the host's now): take its link away, but never a rec of your own.
[[ $(readlink "$bin_dir/rec" 2>/dev/null) == */bin/amarchy-rec ]] && rm -f "$bin_dir/rec"

# The amarchy skill: Claude Code finds it in every session (their SessionStart
# hook points it there). A link, so it follows this checkout.
if [[ -e $skill_link && ! -L $skill_link ]]; then
  say "Left $skill_link alone (not amarchy's link); the amarchy skill isn't installed."
else
  mkdir -p "$(dirname "$skill_link")"
  ln -sfn "$repo/skill" "$skill_link"
fi

# ---- Omarchy home (track C): on an Omarchy desktop, the Ⓐ in the bar, the key
# and the menu entry; elsewhere, what an amarchy from before left there goes.
"$repo/omarchy/install.sh" || say "Couldn't set amarchy up on Omarchy (omarchy/install.sh)"
# ---- end of Omarchy home
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
X-Amarchy-Name=Sleep
X-Amarchy-About=Every 30 seconds, puts to sleep the chats that have been idle a while and are open on no phone or browser: their Claude Code exits and lets go of its memory, and comes back when you type in the chat or send it something. Paused, idle chats stay awake and keep using memory.

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
if [[ -n $packaged ]]; then
  update_about="Every 5 minutes, checks whether Claude Code changed (then tests amarchy's chat with it again). amarchy itself is installed by $packaged: it updates with your packages (pacman -Syu, or your AUR helper)."
else
  update_about="Every 5 minutes, brings amarchy up to the latest on GitHub (its main), when the checkout it runs from is on main with nothing uncommitted, and installs it; the app reloads by itself. Paused, amarchy stays as it is until you run amarchy update."
fi
cat >"$units/amarchy-update.timer" <<UNIT
# Installed by amarchy ($repo/install.sh); removed by its --uninstall.
[Unit]
Description=Update amarchy to the latest on GitHub, every 5 minutes
X-Amarchy-Name=Updates
X-Amarchy-About=$update_about

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
# The fonts cut in two (their text, and their icons fetched only when drawn)
# and your own wallpapers cut for a phone, in the background: until they
# are, the app is sent them whole.
"$bin_dir/amarchy" theme --cut --in-background --quiet >/dev/null 2>&1 || true

# ---- the desktop app (track B): on a computer with a desktop (Omarchy, or a
# Wayland or X session; or asked with --desktop), or kept up to date where
# it's installed. Built here (desktop/install.sh): in a terminal you see it
# build (the first time takes minutes); else (an update) in the background,
# so this ends at once. Its failing never fails amarchy's install.
desktop_here() {
  case $desktop in yes) return 0 ;; no) return 1 ;; esac
  [[ -x $bin_dir/amarchy-desktop || -n ${WAYLAND_DISPLAY:-} || -n ${DISPLAY:-} || -d $HOME/.local/share/omarchy ]] && return 0
  systemctl --user is-active --quiet graphical-session.target 2>/dev/null
}
# ---- amarchy's own Tailscale node (track H): on a computer without the
# system's Tailscale, amarchy's own (tailnet/install.sh: built here, its user
# service); with the system's, nothing (and a node of amarchy's from before
# stops). Before the desktop app, which reaches the tailnet through it.
tailnet_said=""
if [[ -x $repo/tailnet/install.sh ]]; then
  rm -f "$state/tailnet-install/status"
  if [[ -t 0 && -t 1 ]]; then
    "$repo/tailnet/install.sh" || true
  else
    "$repo/tailnet/install.sh" --background || true
  fi
  tailnet_said=$(cat "$state/tailnet-install/status" 2>/dev/null || true)
fi
# ---- end of amarchy's own Tailscale node (track H)

desktop_said=""
if [[ -x $repo/desktop/install.sh ]] && desktop_here; then
  rm -f "$state/desktop/status"
  if [[ -t 0 && -t 1 ]]; then
    "$repo/desktop/install.sh" || true
  else
    "$repo/desktop/install.sh" --background || true
  fi
  # How it went, for the summary below ("The desktop app: ...").
  desktop_said=$(cat "$state/desktop/status" 2>/dev/null || echo "not built (desktop/install.sh stopped without saying why)")
  # A computer with the desktop app is a machine (the plan's decision 2): its
  # app server on, once (amarchy app on: for this machine alone until
  # Tailscale is up, then on your tailnet too; it says what's missing). Turned
  # off since (amarchy app off), it stays off.
  app_on_once="$state/desktop/app-on"
  if [[ ! -e $app_on_once ]]; then
    if ! systemctl --user is-active --quiet amarchy-app.service 2>/dev/null; then
      say "This computer runs chats too: its app server, on."
      "$bin_dir/amarchy" app on || true
    fi
    mkdir -p "$state/desktop" && touch "$app_on_once"
  fi
fi
# ---- end of the desktop app (track B)

# What this set up, so a package's update is set up again by itself (amarchy
# update --auto, see "a packaged amarchy").
mkdir -p "$state"
if [[ -n $packaged ]]; then
  cat "$repo/.version" 2>/dev/null >"$state/setup-version" || true
else
  git -C "$repo" rev-parse --short=12 HEAD 2>/dev/null >"$state/setup-version" || true
fi

say "amarchy installed."
[[ -n $packaged ]] && echo "  Installed by $packaged: it updates with your packages, and sets itself up again after (amarchy update)."
# ---- amarchy's own Tailscale node (track H): how it went, when it's this computer's.
if [[ -n $tailnet_said && $tailnet_said != "not needed"* ]]; then
  echo "  amarchy's own Tailscale node: $tailnet_said"
fi
# ---- end of amarchy's own Tailscale node (track H)
# ---- the desktop app (track B): how it went, said plainly when it wasn't built.
if [[ $desktop_said == "not built"* ]]; then
  say "  The desktop app: $desktop_said"
elif [[ -n $desktop_said ]]; then
  echo "  The desktop app: $desktop_said"
fi
# ---- end of the desktop app (track B)
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
