#!/bin/sh
# The Xcode project (Amarchy.xcodeproj) from project.yml, with XcodeGen
# (brew install xcodegen); with amarchy's own Tailscale node when its
# framework has been built into Frameworks/ (tailnet.yml says how).
set -eu
cd "$(dirname "$0")"
if [ -d Frameworks/Tailnet.xcframework ]; then
  export AMARCHY_TAILNET=YES
else
  export AMARCHY_TAILNET=NO
fi
exec xcodegen generate "$@"
