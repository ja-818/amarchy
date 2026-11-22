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
  echo "The desktop app is installed by the $(pacman -Qqo /usr/bin/amarchy-desktop) package; it updates with your packages."
  exit 0
fi

# In the background (an update): the same, as a user unit of its own, once.
if ((background)); then
  mkdir -p "$state"
  if systemctl --user is-active --quiet "$unit.service" 2>/dev/null; then
    echo "The desktop app is being built already."
    exit 0
  fi
  args=()
  ((force)) && args+=(--force)
  if command -v systemd-run >/dev/null &&
    systemd-run --user --quiet --collect --unit="$unit" -p Nice=10 -p StandardOutput="truncate:$state/build.log" \
      -p StandardError=inherit -E PATH="$PATH" "$here/install.sh" ${args[@]+"${args[@]}"} 2>/dev/null; then
    echo "The desktop app is being built in the background (its log: $state/build.log)."
  else
    nohup setsid "$here/install.sh" ${args[@]+"${args[@]}"} >"$state/build.log" 2>&1 </dev/null &
    echo "The desktop app is being built in the background (its log: $state/build.log)."
  fi
  exit 0
fi

[[ -d $HOME/.cargo/bin ]] && PATH="$HOME/.cargo/bin:$PATH"

# ---- what it needs to build

# What's missing, as Arch's packages (Omarchy is Arch), else in words.
missing() {
  local m=()
  command -v cargo >/dev/null || m+=(rust)
  command -v cc >/dev/null || m+=(base-devel)
  command -v pkg-config >/dev/null || m+=(pkgconf)
  if command -v pkg-config >/dev/null; then
    pkg-config --exists webkit2gtk-4.1 || m+=(webkit2gtk-4.1)
    pkg-config --exists ayatana-appindicator3-0.1 || pkg-config --exists appindicator3-0.1 || m+=(libayatana-appindicator)
  else
    m+=(webkit2gtk-4.1 libayatana-appindicator)
  fi
  # The microphone (dictation) comes through GStreamer: PipeWire's source, or Pulse's.
  if command -v pacman >/dev/null; then
    pacman -Qq gst-plugin-pipewire >/dev/null 2>&1 || m+=(gst-plugin-pipewire)
    pacman -Qq gst-plugins-good >/dev/null 2>&1 || m+=(gst-plugins-good)
  fi
  echo "${m[@]}"
}

need=$(missing)
if [[ -n $need ]]; then
  if command -v pacman >/dev/null; then
    say "The desktop app needs: $need"
    if [[ -t 0 && -t 1 ]]; then
      echo "Installing them with pacman (sudo asks for your password)."
      # shellcheck disable=SC2086
      sudo pacman -S --needed $need
      need=$(missing)
    fi
    if [[ -n $need ]]; then
      echo "Not built. Install them (sudo pacman -S --needed $need), then run $here/install.sh."
      exit 1
    fi
  else
    say "The desktop app needs Rust (cargo), WebKitGTK 4.1, libayatana-appindicator and GStreamer's PipeWire plugin to build."
    echo "On Debian or Ubuntu: sudo apt install cargo libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev gstreamer1.0-pipewire"
    echo "On Fedora: sudo dnf install cargo webkit2gtk4.1-devel libayatana-appindicator-gtk3-devel gstreamer1-plugins-good"
    echo "Then run $here/install.sh."
    exit 1
  fi
fi

# ---- built only when desktop/ changed (what's in it, the build not)

# What the app is built from: desktop/ but its build, what the build makes
# (gen/) and its tests.
sources() {
  (cd "$here" && find . \( -path ./target -o -path ./gen -o -path ./test \) -prune -o -type f -print |
    LC_ALL=C sort | xargs -d '\n' sha1sum | sha1sum | cut -c1-40)
}
mkdir -p "$state"
want=$(sources)
built=$(cat "$state/built" 2>/dev/null || true)
fresh=0
if ((force)) || [[ $want != "$built" || ! -x $app ]]; then
  say "Building the desktop app (a few minutes the first time)…"
  if ! CARGO_TARGET_DIR="$target" cargo build --release --locked --manifest-path "$here/Cargo.toml"; then
    echo "The desktop app didn't build (above). amarchy itself is installed."
    exit 1
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
