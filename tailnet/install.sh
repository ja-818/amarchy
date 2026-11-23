#!/bin/bash

# amarchy's own Tailscale node (tailnet/, track H of
# docs/plan-omarchy-and-machines.md), on a computer without the system's
# Tailscale: amarchy's install.sh runs this there, and --uninstall takes it
# away. With the system's Tailscale it does nothing (amarchy uses that one),
# and stops a node of amarchy's from before.
#
#   - builds amarchy-tailnet (Go, Tailscale's tsnet) into ~/.local/bin, in
#     ~/.cache/amarchy/tailnet-build, only again when tailnet/ changed; on
#     Arch it offers to install Go with pacman (asked first), or mise's
#   - the user service amarchy-tailnet.service, on, from login
#   - says how to sign in: amarchy-tailnet login (Tailscale's own sign-in)
#
#   tailnet/install.sh               build if it changed, and run it
#   tailnet/install.sh --background  the same in the background (an update)
#   tailnet/install.sh --uninstall   stop it and take it away (its sign-in is
#                                    kept in ~/.local/state/amarchy/tailnet)

set -euo pipefail

usage() { sed -n '3,/^$/s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"; }

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(dirname "$here")
bin_dir="$HOME/.local/bin"
app="$bin_dir/amarchy-tailnet"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit="amarchy-tailnet.service"
state="${XDG_STATE_HOME:-$HOME/.local/state}/amarchy"
node_state="$state/tailnet"
mine="$state/tailnet-install"           # its own: what it was built from, how it went
build="${XDG_CACHE_HOME:-$HOME/.cache}/amarchy/tailnet-build"

uninstall=0 background=0
for arg in "$@"; do
  case $arg in
    --uninstall) uninstall=1 ;;
    --background) background=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

say() { printf '\033[1m%s\033[0m\n' "$*"; }
mkdir -p "$mine"
told() { printf '%s\n' "$*" >"$mine/status"; }

stop_node() {
  systemctl --user disable --now "$unit" >/dev/null 2>&1 || true
}

if ((uninstall)); then
  stop_node
  rm -f "$units/$unit" "$app"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  rm -rf "$build" "$mine"
  [[ -d $node_state ]] && echo "amarchy's own Tailscale node is gone; its sign-in is kept in $node_state (delete it to forget it)."
  exit 0
fi

# The system's Tailscale answers: it's the one (and a node of amarchy's stops).
system_tailscale() {
  command -v tailscale >/dev/null || return 1
  tailscale status --json 2>/dev/null | grep -q '"BackendState"'
}
if system_tailscale; then
  if systemctl --user is-active --quiet "$unit" 2>/dev/null; then
    stop_node
    say "The system's Tailscale is here: amarchy uses it, and its own node is off (its sign-in kept)."
  fi
  told "not needed: the system's Tailscale is here"
  exit 0
fi

if ((background)); then
  told "being built in the background when it changed (its log: $mine/build.log)"
  if command -v systemd-run >/dev/null &&
    systemd-run --user --quiet --collect --unit=amarchy-tailnet-build -p Nice=10 \
      -p StandardOutput="truncate:$mine/build.log" -p StandardError=inherit -E PATH="$PATH" "$here/install.sh" 2>/dev/null; then
    :
  else
    nohup setsid "$here/install.sh" >"$mine/build.log" 2>&1 </dev/null &
  fi
  exit 0
fi

# ---- Go: the system's, ~/go's, or mise's
go=""
find_go() {
  go=$(command -v go 2>/dev/null || true)
  [[ -z $go && -x /usr/lib/go/bin/go ]] && go=/usr/lib/go/bin/go
  if [[ -z $go ]] && command -v mise >/dev/null; then go=$(mise which go 2>/dev/null || true); fi
  [[ -n $go ]]
}

if ! find_go; then
  if [[ ! -t 0 || ! -t 1 ]]; then
    told "not built: it needs Go (run amarchy's install.sh in a terminal, which installs it)"
    exit 1
  fi
  say "amarchy's own Tailscale node needs Go to build (this computer has no Tailscale of its own)."
  if command -v pacman >/dev/null; then
    sudo pacman -S --needed go || true
  fi
  if ! find_go && command -v mise >/dev/null; then
    read -rp "Install Go for you alone with mise instead (mise use -g go)? [Y/n] " answer || answer=n
    [[ $answer =~ ^[Nn] ]] || mise use -g go@latest || true
  fi
  if ! find_go; then
    say "amarchy's own Tailscale node isn't built: it needs Go."
    told "not built: it needs Go (sudo pacman -S --needed go, or mise use -g go), then run $here/install.sh"
    exit 1
  fi
fi

# ---- built when tailnet/ changed
sources() {
  (cd "$here" && find . -type f \( -name '*.go' -o -name go.mod -o -name go.sum \) ! -name '*_test.go' -print |
    LC_ALL=C sort | xargs -d '\n' sha1sum | sha1sum | cut -c1-40)
}
want=$(sources)
fresh=0
if [[ $want != "$(cat "$mine/built" 2>/dev/null || true)" || ! -x $app ]]; then
  say "Building amarchy's own Tailscale node (a minute or two the first time)…"
  commit=$(git -C "$repo" rev-parse --short HEAD 2>/dev/null || echo dev)
  mkdir -p "$bin_dir" "$build"
  if ! (cd "$here" && GOFLAGS=-mod=readonly GOCACHE="$build/cache" GOPATH="${GOPATH:-$HOME/go}" \
    "$go" build -trimpath -ldflags "-s -w -X main.version=$commit" -o "$bin_dir/.amarchy-tailnet.new" ./cmd/amarchy-tailnet); then
    say "amarchy's own Tailscale node isn't built: go build failed (above)."
    told "not built: go build failed"
    exit 1
  fi
  mv -f "$bin_dir/.amarchy-tailnet.new" "$app"
  echo "$want" >"$mine/built"
  fresh=1
fi

# ---- its service, on from login
mkdir -p "$units"
cat >"$units/$unit.new" <<UNIT
# Installed by amarchy ($here/install.sh); removed by its --uninstall.
[Unit]
Description=amarchy's own Tailscale node (this computer has no Tailscale of its own)
After=network-online.target
X-Amarchy-Name=Tailscale node
X-Amarchy-About=This computer's node on your tailnet, amarchy's own (it has no Tailscale of its own): your phone and your other machines reach its amarchy through it. It stays off while the system's Tailscale answers.

[Service]
ExecStart=$app run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT
if cmp -s "$units/$unit.new" "$units/$unit"; then rm -f "$units/$unit.new"; else mv -f "$units/$unit.new" "$units/$unit"; fi
systemctl --user daemon-reload >/dev/null 2>&1 || true
if ((fresh)); then
  systemctl --user enable "$unit" >/dev/null 2>&1 || true
  systemctl --user restart "$unit" >/dev/null 2>&1 || true
else
  systemctl --user enable --now "$unit" >/dev/null 2>&1 || true
fi
for _ in $(seq 20); do [[ -S $node_state/tailscaled.sock ]] && break; sleep 0.25; done
words=$("$app" status 2>/dev/null | sed 's/^amarchy.s own Tailscale node: //' || true)
if [[ ! -S $node_state/tailscaled.sock ]]; then
  say "amarchy's own Tailscale node is installed, but its service isn't running (systemctl --user status $unit)."
  told "installed, but its service isn't running (systemctl --user status $unit)"
elif [[ $words == *"sign in"* ]]; then
  say "amarchy's own Tailscale node is on: sign in to Tailscale with amarchy-tailnet login (or the desktop app's Sign in)."
  told "on; waits for you to sign in (amarchy-tailnet login)"
else
  told "on: ${words:-starting}"
fi
