#!/bin/bash

# amarchy's desktop app (desktop/, track B of docs/plan-omarchy-and-machines.md),
# built here and installed for you, on a computer with a desktop. amarchy's
# install.sh runs it there (and --uninstall takes it away); so can you.
#
#   - builds desktop/ (Rust and WebKitGTK), in ~/.cache/amarchy/desktop-build:
#     a few minutes the first time, and only again when desktop/ changed
#   - ~/.local/bin/amarchy-desktop, its launcher entry (amarchy.desktop), its
#     icon, and amarchy:// links opening it
#   - it starts at login, in the tray (~/.config/autostart/amarchy.desktop),
#     so its notifications come with its window closed (delete that file and
#     it isn't put back)
#   - a running one starts again on the new build, where it was
#   - on Arch (Omarchy), what it needs to build is installed with pacman,
#     asked first (sudo)
#
#   desktop/install.sh                build if desktop/ changed, and install
#   desktop/install.sh --background   the same in the background, its log in
#                                     ~/.local/state/amarchy/desktop/build.log
#                                     (an update's install.sh ends at once)
#   desktop/install.sh --force        build again even if nothing changed
#   desktop/install.sh --uninstall    take it all away (it quits first)

set -euo pipefail

usage() { sed -n '3,/^$/s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"; }

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(dirname "$here")
bin_dir="$HOME/.local/bin"
data="${XDG_DATA_HOME:-$HOME/.local/share}"
apps="$data/applications"
icons="$data/icons/hicolor"
autostart="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/amarchy.desktop"
state="${XDG_STATE_HOME:-$HOME/.local/state}/amarchy/desktop"
target="${XDG_CACHE_HOME:-$HOME/.cache}/amarchy/desktop-build"
app="$bin_dir/amarchy-desktop"
marker="# Installed by amarchy ($repo/desktop/install.sh); removed by its --uninstall."
unit="amarchy-desktop-build"

uninstall=0 background=0 force=0
for arg in "$@"; do
  case $arg in
    --uninstall) uninstall=1 ;;
    --background) background=1 ;;
    --force) force=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

say() { printf '\033[1m%s\033[0m\n' "$*"; }
running() { pgrep -u "$(id -u)" -x amarchy-desktop >/dev/null 2>&1; }

if ((uninstall)); then
  systemctl --user stop "$unit.service" >/dev/null 2>&1 || true
  if running; then
    pkill -u "$(id -u)" -x amarchy-desktop || true
    for _ in $(seq 50); do running || break; sleep 0.1; done
  fi
  removed=0
  for f in "$app" "$apps/amarchy.desktop" "$autostart"; do
    if [[ -e $f ]] && { [[ $f == "$app" ]] || grep -qF "Installed by amarchy" "$f"; }; then
      rm -f "$f"
      removed=1
    fi
  done
  for size in 32 64 128 256 512; do rm -f "$icons/${size}x${size}/apps/amarchy.png"; done
  rm -f "$icons/scalable/apps/amarchy.svg"
  # amarchy:// links: no longer this app's.
  if [[ -f ${XDG_CONFIG_HOME:-$HOME/.config}/mimeapps.list ]]; then
    sed -i '/^x-scheme-handler\/amarchy=amarchy\.desktop;\?$/d' "${XDG_CONFIG_HOME:-$HOME/.config}/mimeapps.list"
  fi
  command -v update-desktop-database >/dev/null && update-desktop-database -q "$apps" 2>/dev/null || true
  command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$icons" 2>/dev/null || true
  # What it kept: its web view's data, its build, its settings and state.
  rm -rf "$data/io.github.ja818.amarchy" "${XDG_CACHE_HOME:-$HOME/.cache}/io.github.ja818.amarchy" \
    "${XDG_CACHE_HOME:-$HOME/.cache}/amarchy-desktop" "$target" "$state" \
    "${XDG_CONFIG_HOME:-$HOME/.config}/amarchy/desktop.json"
  ((removed)) && say "The desktop app is gone."
  exit 0
fi

# Installed by your packages (the amarchy-desktop package): they keep it.
if [[ -x /usr/bin/amarchy-desktop ]] && command -v pacman >/dev/null && pacman -Qqo /usr/bin/amarchy-desktop >/dev/null 2>&1; then
  mkdir -p "$state"
  printf '%s\n' "installed by the $(pacman -Qqo /usr/bin/amarchy-desktop) package (it updates with your packages)" >"$state/status"
  exit 0
fi

# In the background (an update): the same, as a user unit of its own, once.
if ((background)); then
  mkdir -p "$state"
  if systemctl --user is-active --quiet "$unit.service" 2>/dev/null; then
    printf '%s\n' "being built in the background already (its log: $state/build.log)" >"$state/status"
    exit 0
  fi
  printf '%s\n' "being built in the background when it changed (its log: $state/build.log)" >"$state/status"
  args=()
  ((force)) && args+=(--force)
  if command -v systemd-run >/dev/null &&
    systemd-run --user --quiet --collect --unit="$unit" -p Nice=10 -p StandardOutput="truncate:$state/build.log" \
      -p StandardError=inherit -E PATH="$PATH" "$here/install.sh" ${args[@]+"${args[@]}"} 2>/dev/null; then
    :
  else
    nohup setsid "$here/install.sh" ${args[@]+"${args[@]}"} >"$state/build.log" 2>&1 </dev/null &
  fi
  exit 0
fi

[[ -d $HOME/.cargo/bin ]] && PATH="$HOME/.cargo/bin:$PATH"
mkdir -p "$state"

# How it went, in a line amarchy's install.sh says at its end ("The desktop
# app: ..."): installed, not built and why, or what it still waits on.
told() { printf '%s\n' "$*" >"$state/status"; }
not_built() {
  say "The desktop app isn't built: $*"
  told "not built: $*"
  exit 1
}

# ---- what building it needs, and what its sounds and microphone need

# Rust's cargo: on the PATH, in ~/.cargo, or mise's (Omarchy has mise).
cargo=""
find_cargo() {
  cargo=$(command -v cargo 2>/dev/null || true)
  [[ -z $cargo && -x $HOME/.cargo/bin/cargo ]] && cargo=$HOME/.cargo/bin/cargo
  if [[ -z $cargo ]] && command -v mise >/dev/null; then
    cargo=$(mise which cargo 2>/dev/null || true)
  fi
  [[ -n $cargo ]] || return 1
  # Its rustc beside it, for cargo to find (its folder on the PATH, if not already).
  case ":$PATH:" in *":$(dirname "$cargo"):"*) ;; *) PATH="$(dirname "$cargo"):$PATH" ;; esac
}

# What building it needs that isn't here, as Arch's packages (Omarchy is Arch).
build_missing() {
  local m=()
  find_cargo || m+=(rust)
  command -v cc >/dev/null || m+=(base-devel)
  command -v pkg-config >/dev/null || m+=(pkgconf)
  if command -v pkg-config >/dev/null; then
    pkg-config --exists webkit2gtk-4.1 || m+=(webkit2gtk-4.1)
    pkg-config --exists ayatana-appindicator3-0.1 || pkg-config --exists appindicator3-0.1 || m+=(libayatana-appindicator)
  else
    m+=(webkit2gtk-4.1 libayatana-appindicator)
  fi
  echo "${m[@]}"
}

# What its sounds and microphone (dictation) need, only when it runs:
# GStreamer's good plugins (the audio WebKit plays through: without them a
# sound would end the page, so the app plays its chimes itself and its page
# no media), its base plugins (the .oga chimes) and its PipeWire source (the
# microphone). Never in the way of building it.
media_missing() {
  command -v pacman >/dev/null || return 0
  local m=()
  pacman -Qq gst-plugin-pipewire >/dev/null 2>&1 || m+=(gst-plugin-pipewire)
  pacman -Qq gst-plugins-base >/dev/null 2>&1 || m+=(gst-plugins-base)
  pacman -Qq gst-plugins-good >/dev/null 2>&1 || m+=(gst-plugins-good)
  echo "${m[@]}"
}

# pacman -S for these packages (sudo asks for your password); when it
# fails, why in words ($why): never a system update of its own (-Sy, -Syu),
# which only you decide on.
why=""
pacman_get() {
  local log rc=0
  log=$(mktemp)
  # shellcheck disable=SC2068
  sudo pacman -S --needed $@ 2> >(tee "$log" >&2) || rc=$?
  sleep 0.2      # (tee's last words in)
  if ((rc == 0)); then
    rm -f "$log"
    return 0
  fi
  if grep -qiE 'error: 404|returned error: 404|failed retrieving file|failed to retrieve some files' "$log"; then
    why="pacman couldn't download them: this computer's list of packages is older than its mirror, which has newer versions now (a 404). Bringing it up to date is a system update (pacman -Syu), yours to decide; this install never does one. Nothing was installed."
  elif grep -qi 'target not found' "$log"; then
    why="pacman doesn't know $(sed -n 's/.*target not found: //p' "$log" | head -3 | paste -sd ' ' -) on this computer."
  elif grep -qiE 'breaks dependency|could not satisfy dependencies' "$log"; then
    # Some packages newer than the ones that need them: a system update
    # half done. Finished, these install; it's yours to run (on Apple
    # Silicon, its own kernel and boot packages held back).
    local held
    held=$(pacman -Qq 2>/dev/null | grep -E '^(linux|m1n1|uboot)-(aurora|asahi)' | paste -sd, - || true)
    why="pacman won't install them: this computer is halfway through a system update ($(grep -iE 'breaks dependency' "$log" | head -1 | sed 's/^:: //'); some of its packages are newer than the ones that need them). Finish it first, sudo pacman -Syu${held:+ --ignore $held}, then run install.sh again. This install never updates your system."
  elif grep -qiE 'could not satisfy|conflicting' "$log"; then
    why="pacman wouldn't install them: $(grep -iE 'could not satisfy|conflicting' "$log" | head -1 | sed 's/^error: //')."
  else
    why="pacman didn't install them$(grep -i '^error' "$log" | tail -1 | sed 's/^error: */: /')."
  fi
  rm -f "$log"
  return 1
}

need=$(build_missing)
if [[ -n $need ]]; then
  if ! command -v pacman >/dev/null; then
    say "The desktop app needs Rust (cargo), WebKitGTK 4.1 and libayatana-appindicator to build (and GStreamer's good, base and PipeWire plugins for its sounds and microphone)."
    echo "On Debian or Ubuntu: sudo apt install cargo libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev gstreamer1.0-plugins-good gstreamer1.0-plugins-base gstreamer1.0-pipewire"
    echo "On Fedora: sudo dnf install cargo webkit2gtk4.1-devel libayatana-appindicator-gtk3-devel gstreamer1-plugins-good gstreamer1-plugins-base pipewire-gstreamer"
    echo "Then run $here/install.sh."
    not_built "it needs $need to build"
  fi
  if [[ ! -t 0 || ! -t 1 ]]; then
    not_built "it needs $need to build: run $repo/install.sh in a terminal, which installs them (sudo pacman)"
  fi
  say "To build the desktop app this computer needs: $need"
  pacman_get $need || true
  need=$(build_missing)
  # Rust alone, and pacman can't get it: Rust for you alone, from mise.
  if [[ $need == rust ]] && command -v mise >/dev/null; then
    [[ -n $why ]] && echo "$why"
    read -rp "Install Rust for you alone with mise instead (mise use -g rust; no system packages)? [Y/n] " answer || answer=n
    if [[ ! $answer =~ ^[Nn] ]] && mise use -g rust@stable; then
      need=$(build_missing)
    fi
  fi
  if [[ -n $need ]]; then
    [[ -n $why ]] || why="They weren't installed."
    not_built "it needs $need to build. $why Once they are, run $here/install.sh again."
  fi
fi

# The sounds' and microphone's, apart: if pacman can't get them, the app is
# built anyway, and says what it lacks without them (no microphone, no video;
# its chimes it plays itself).
media=$(media_missing)
if [[ -n $media && -t 0 && -t 1 ]]; then
  say "For its sounds and dictation the desktop app needs: $media"
  why=""
  # One transaction is all or nothing: after a failure, each on its own,
  # so the ones pacman can get still come (PipeWire's is what hears you).
  if ! pacman_get $media; then
    for p in $media; do
      [[ $(media_missing) == *"$p"* ]] && { pacman_get "$p" || true; }
    done
  fi
  media=$(media_missing)
  [[ -n $media && -n $why ]] && echo "$why"
fi

# ---- built only when desktop/ changed (what's in it, the build not)

# What the app is built from: desktop/ but its build, what the build makes
# (gen/) and its tests.
sources() {
  (cd "$here" && find . \( -path ./target -o -path ./gen -o -path ./test \) -prune -o -type f -print |
    LC_ALL=C sort | xargs -d '\n' sha1sum | sha1sum | cut -c1-40)
}
want=$(sources)
built=$(cat "$state/built" 2>/dev/null || true)
fresh=0
if ((force)) || [[ $want != "$built" || ! -x $app ]]; then
  say "Building the desktop app (a few minutes the first time)…"
  find_cargo || not_built "Rust (cargo) isn't installed"
  if ! CARGO_TARGET_DIR="$target" "$cargo" build --release --locked --manifest-path "$here/Cargo.toml"; then
    not_built "cargo failed (above)"
  fi
  mkdir -p "$bin_dir"
  # In place at once: a running one keeps the build it started with.
  install -m 755 "$target/release/amarchy-desktop" "$bin_dir/.amarchy-desktop.new"
  mv -f "$bin_dir/.amarchy-desktop.new" "$app"
  echo "$want" >"$state/built"
  fresh=1
fi

# ---- its launcher entry, icon, links, and the tray at login

mkdir -p "$apps"
entry=$(mktemp)
{ echo "$marker"; sed "s|^Exec=amarchy-desktop |Exec=$app |" "$here/amarchy.desktop"; } >"$entry"
cmp -s "$entry" "$apps/amarchy.desktop" || cp "$entry" "$apps/amarchy.desktop"
rm -f "$entry"
for f in 32x32:32x32.png 64x64:64x64.png 128x128:128x128.png 256x256:128x128@2x.png 512x512:icon.png; do
  mkdir -p "$icons/${f%%:*}/apps"
  cmp -s "$here/icons/${f#*:}" "$icons/${f%%:*}/apps/amarchy.png" || cp "$here/icons/${f#*:}" "$icons/${f%%:*}/apps/amarchy.png"
done
mkdir -p "$icons/scalable/apps"
cmp -s "$repo/app/icon.svg" "$icons/scalable/apps/amarchy.svg" || cp "$repo/app/icon.svg" "$icons/scalable/apps/amarchy.svg"
command -v update-desktop-database >/dev/null && update-desktop-database -q "$apps" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$icons" 2>/dev/null || true
command -v xdg-mime >/dev/null && xdg-mime default amarchy.desktop x-scheme-handler/amarchy 2>/dev/null || true

# At login, in the tray: put there once; if you take it away, it stays away.
if [[ ! -e $state/autostart-placed || -f $autostart ]] && { [[ ! -e $autostart ]] || grep -qF "Installed by amarchy" "$autostart"; }; then
  mkdir -p "$(dirname "$autostart")"
  cat >"$autostart.new" <<ENTRY
[Desktop Entry]
$marker
Type=Application
Name=Amarchy
Comment=amarchy in the tray, so its notifications come with its window closed
Exec=$app --hidden
Icon=amarchy
NoDisplay=true
X-GNOME-Autostart-enabled=true
ENTRY
  if cmp -s "$autostart.new" "$autostart"; then rm -f "$autostart.new"; else mv -f "$autostart.new" "$autostart"; fi
  touch "$state/autostart-placed"
fi

# A running one, on the new build: it starts again where it was.
if ((fresh)) && running; then
  timeout 15 "$app" --restart >/dev/null 2>&1 || echo "Quit Amarchy (its tray) and open it again for the new build."
fi

if ((fresh)); then
  say "The desktop app is installed: Amarchy in your launcher, or amarchy-desktop."
fi
if [[ -n $media ]]; then
  # Without them its web view has no audio at all: the app plays its chimes
  # itself and its page makes no media (one would end it), so no microphone
  # and no video until they're here.
  say "The desktop app has no microphone (dictation) and no video until these are installed: $media"
  echo "Its chimes play anyway (the app plays them itself) and its page is safe. Once they're in (sudo pacman -S --needed $media), it sees them and starts again: no rebuild."
  told "installed (Amarchy in your launcher); no microphone and no video in it until $media are installed (its chimes play): ${why:-sudo pacman -S --needed $media}"
else
  told "installed (Amarchy in your launcher, or amarchy-desktop)"
fi
