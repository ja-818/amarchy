#!/bin/sh

# Quiet the Mac while you dictate: amarchy's helper for a Mac (Settings →
# Dictation → Quiet your Mac). The amarchy app serves this file with its own
# address in it; run it on the Mac:
#
#   curl -fsS https://<amarchy>/api/hush/mac.sh | sh               install / update
#   curl -fsS https://<amarchy>/api/hush/mac.sh | sh -s uninstall  remove it
#
# It installs a helper that's always on, at login too (a LaunchAgent,
# com.amarchy.hush): it listens to amarchy over Tailscale, and while you
# dictate (on this Mac or on your phone) it mutes the Mac's sound, unless
# you're on headphones; when you're done it turns the sound back on, unless
# it was off already. The Mac's own logins and settings are left alone:
# nothing but osascript's "set volume" and system_profiler (which output it
# is) is run. Its log: ~/Library/Logs/amarchy-hush.log.

set -eu

URL="{{url}}"
LABEL=com.amarchy.hush
DIR="$HOME/Library/Application Support/amarchy"
HELPER="$DIR/hush"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/amarchy-hush.log"

if [ "$(uname)" != Darwin ]; then
  echo "This is for a Mac." >&2
  exit 1
fi

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

if [ "${1:-}" = uninstall ]; then
  rm -f "$PLIST" "$HELPER"
  rmdir "$DIR" 2>/dev/null || true
  echo "amarchy's helper is gone from this Mac."
  exit 0
fi

mkdir -p "$DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$HELPER" <<'HELPER'
#!/bin/bash
# amarchy's helper: mutes this Mac while you dictate (see Settings → Dictation
# in amarchy). Put here by amarchy's /api/hush/mac.sh; run by launchd.

URL="$1"
NAME="$(scutil --get ComputerName 2>/dev/null || hostname -s)"
muted=0         # 1: muted by us, to turn back on

say() { echo "$(date '+%F %T') $*"; }

# The output the Mac plays on is its speakers (its own, a display's): not
# headphones, AirPods or anything else, which nobody's microphone hears.
speakers() {
  local out
  out="$(system_profiler SPAudioDataType 2>/dev/null | awk '
    /^        [^ ].*:$/ { if (def) exit; name = $0; sub(/^ +/, "", name); tr = ""; src = ""; next }
    /Default Output Device: Yes/ { def = 1 }
    /Transport:/ { tr = $0; sub(/^ +/, "", tr) }
    /Output Source:/ { src = $0; sub(/^ +/, "", src) }
    END { if (def) print name " | " tr " | " src }')"
  say "playing on: ${out:-unknown}"
  case "$out" in
    *Headphone*|*headphone*|*AirPods*|*Bluetooth*) return 1 ;;
    *Speaker*|*speaker*|*HDMI*|*DisplayPort*) return 0 ;;
  esac
  return 1
}

hush() {
  [ "$muted" = 1 ] && return
  if [ "$(osascript -e 'output muted of (get volume settings)' 2>/dev/null)" = true ]; then
    say "dictating: already muted"
    return
  fi
  if ! speakers; then
    say "dictating: not on the speakers, left alone"
    return
  fi
  osascript -e 'set volume with output muted' && muted=1 && say "dictating: muted"
}

unhush() {
  [ "$muted" = 1 ] || return 0
  osascript -e 'set volume without output muted'
  muted=0
  say "done dictating: sound back on"
}

trap 'unhush; exit 0' TERM INT HUP

say "started, listening to $URL as $NAME"
while true; do
  # amarchy says "still here" every 15 s: 45 s without a byte and it's gone.
  while IFS= read -r line; do
    case "$line" in
      "data: true"*) hush ;;
      "data: false"*) unhush ;;
    esac
  done < <(curl -sfN --speed-limit 1 --speed-time 45 -H "Accept: text/event-stream" \
             --get --data-urlencode "name=$NAME" "$URL/api/hush/stream" 2>/dev/null)
  unhush      # cut off: never left muted
  sleep 5
done
HELPER
chmod +x "$HELPER"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$HELPER</string><string>$URL</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "amarchy's helper is on: this Mac goes quiet while you dictate (unless you're on headphones)."
echo "Its log: $LOG. To remove it: curl -fsS $URL/api/hush/mac.sh | sh -s uninstall"
