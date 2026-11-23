#!/usr/bin/env bash
# amarchy's chimes (sounds/, bin/amarchy's CHIMES) as the iPhone app rings
# them on its notifications: Core Audio files of 16-bit PCM (iOS plays a
# notification's sound only from the app's bundle, and not Ogg Vorbis).
# Made with ffmpeg; run it again when a chime changes.
#
#   phone/ios/sounds.sh      writes phone/ios/App/Sounds/<chime>.caf
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(cd "$here/../.." && pwd)
out="$here/App/Sounds"
mkdir -p "$out"
for name in kalimba vibraphone tine fairy ocean elementary herald; do
  src="$root/sounds/$name.oga"
  [ -f "$src" ] || src="$root/sounds/$name.wav"
  ffmpeg -v error -y -i "$src" -ac 1 -ar 44100 -c:a pcm_s16be -f caf "$out/$name.caf"
  echo "$out/$name.caf"
done
