#!/bin/bash
# amarchy on a cloud machine, set up from nothing: run once, as root, when it
# first boots (cloud-init's runcmd on Hetzner and DigitalOcean, the
# post-install script on Hostinger). See docs/plan-omarchy-and-machines.md,
# "A cloud machine (track F)", and docs/guide.md, "A cloud machine".
#
# Its settings come with it in /var/lib/amarchy-cloud/settings (0600): the
# machine's name, your user, the one-off Tailscale key, where to report.
# Each step is reported to the machine that made it (POST <REPORT_URL>
# /api/cloud/progress) once this one is on your tailnet:
#
#   1. your user (your login name there), with sudo; lingering, so its
#      services run with nobody logged in
#   2. Tailscale, and on your tailnet with the one-off key (forgotten once
#      used), named for the machine, Tailscale SSH on
#   3. the packages amarchy needs (git, tmux 3.5, python3, gh), security
#      upgrades by themselves, a swap file, and a firewall that lets in only
#      your tailnet (nothing listens on the public network; sshd off)
#   4. Claude Code (its installer), then amarchy (cloned, install.sh, its
#      app on your tailnet), and it says it's ready
#
# Safe to run again: what's done is skipped. Its log: /var/log/amarchy-cloud.log.

set -Eeuo pipefail
umask 022

DIR=/var/lib/amarchy-cloud
SETTINGS=$DIR/settings
LOG=/var/log/amarchy-cloud.log
export DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

mkdir -p "$DIR"
chmod 700 "$DIR"
touch "$LOG"
chmod 600 "$LOG"
exec > >(tee -a "$LOG") 2>&1

[[ -r $SETTINGS ]] || { echo "amarchy: no settings at $SETTINGS"; exit 1; }
# shellcheck source=/dev/null
. "$SETTINGS"
: "${AMARCHY_NAME:?}" "${AMARCHY_USER:?}" "${AMARCHY_REPO:?}"
AMARCHY_BRANCH=${AMARCHY_BRANCH:-main}
SWAP_GB=${SWAP_GB:-4}
# The tests' own (test/cloud-vm.py): what stands in for Tailscale in a VM
# that can't join a real tailnet. Never there on a real machine.
# shellcheck source=/dev/null
[[ -r $DIR/overrides.sh ]] && . "$DIR/overrides.sh"

STEP=start
ON_TAILNET=0

say() { printf '\n== %s: %s (%s)\n' "$STEP" "$*" "$(date -u +%H:%M:%S)"; }

# A JSON string, for the reports (no python or jq needed before the packages).
json() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\t'/\\t}
  s=${s//$'\r'/}
  s=$(printf '%s' "$s" | tr -d '\000-\010\013\014\016-\037')
  if command -v iconv >/dev/null; then s=$(printf '%s' "$s" | iconv -c -f UTF-8 -t UTF-8 2>/dev/null || printf '%s' "$s"); fi
  printf '"%s"' "$s"
}

# Tell the machine that made this one where it stands: a step, its words,
# and (when it failed) the end of the log. Only once on your tailnet (it's
# reached there); never fatal.
report() {
  local step=$1 words=$2 log=${3:-}
  printf '%s %s\n' "$step" "$words" >"$DIR/status"
  [[ $ON_TAILNET == 1 && -n ${REPORT_URL:-} && -n ${REPORT_TOKEN:-} ]] || return 0
  local body
  body=$(printf '{"name": %s, "step": %s, "words": %s, "log": %s}' \
    "$(json "$AMARCHY_NAME")" "$(json "$step")" "$(json "$words")" "$(json "$log")")
  curl -fsS --max-time 20 --retry 4 --retry-delay 3 --retry-all-errors \
    ${REPORT_RESOLVE:+--resolve "$REPORT_RESOLVE"} \
    -H "Authorization: Bearer $REPORT_TOKEN" -H "Content-Type: application/json" \
    --data-binary "$body" "$REPORT_URL/api/cloud/progress" >/dev/null 2>&1 || true
}

# What went wrong, in words, with the last lines of the log (no key in them).
WHAT="setting it up"
failed() {
  local line=$1 cmd=$2
  trap - ERR
  STEP=failed
  say "$WHAT failed at line $line: $cmd"
  local tail_
  tail_=$(tail -n 40 "$LOG" | sed -E 's/tskey-[A-Za-z0-9_-]+/tskey-…/g')
  printf '%s\n' "$WHAT" >"$DIR/failed"
  report failed "$WHAT failed ($cmd)" "$tail_"
  exit 1
}
trap 'failed $LINENO "$BASH_COMMAND"' ERR

# A command again, a few times, a while apart: a download over a network
# that's only just up.
retry() {
  local n
  for n in 1 2 3 4 5; do
    "$@" && return 0
    echo "  (failed, try $n of 5)"
    sleep $((n * 5))
  done
  return 1
}

apt_() { apt-get -o DPkg::Lock::Timeout=900 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "$@"; }

USER_HOME=""
USER_ID=""
as_user() {
  runuser -u "$AMARCHY_USER" -- env -i HOME="$USER_HOME" USER="$AMARCHY_USER" LOGNAME="$AMARCHY_USER" \
    SHELL=/bin/bash LANG=C.UTF-8 TERM=xterm-256color \
    PATH="$USER_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" \
    XDG_RUNTIME_DIR="/run/user/$USER_ID" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$USER_ID/bus" \
    bash -c "$1"
}

# ---- 1. your user

STEP=user WHAT="Making your user"
say "$AMARCHY_USER"
if ! id "$AMARCHY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --comment amarchy "$AMARCHY_USER"
fi
passwd -l "$AMARCHY_USER" >/dev/null 2>&1 || true
USER_HOME=$(getent passwd "$AMARCHY_USER" | cut -d: -f6)
USER_ID=$(id -u "$AMARCHY_USER")
# Its chats install what a project needs: sudo with no password (the machine
# is yours alone, reached only on your tailnet).
printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$AMARCHY_USER" >/etc/sudoers.d/90-amarchy
chmod 440 /etc/sudoers.d/90-amarchy
if command -v visudo >/dev/null && ! visudo -cf /etc/sudoers.d/90-amarchy >/dev/null; then
  rm -f /etc/sudoers.d/90-amarchy
fi
loginctl enable-linger "$AMARCHY_USER"
# Its user manager up (systemctl --user talks to it on its own socket: a
# minimal image has no user D-Bus).
user_manager() { [[ -S /run/user/$USER_ID/systemd/private || -S /run/user/$USER_ID/bus ]]; }
for _ in $(seq 120); do user_manager && break; sleep 1; done
user_manager || { WHAT="Starting your user's services (systemd --user)"; false; }

# ---- 2. Tailscale, and on your tailnet

STEP=tailnet WHAT="Installing Tailscale"
say "Tailscale"
install_tailscale() {
  command -v tailscale >/dev/null && return 0
  curl -fsSL https://tailscale.com/install.sh -o "$DIR/tailscale-install.sh"
  sh "$DIR/tailscale-install.sh"
}
join_tailnet() {
  systemctl enable --now tailscaled
  if tailscale status --json 2>/dev/null | grep -q '"BackendState": *"Running"'; then
    return 0
  fi
  [[ -n ${TS_AUTH_KEY:-} ]] || { WHAT="Joining your tailnet (no Tailscale key came with it)"; false; }
  tailscale up --auth-key="$TS_AUTH_KEY" --hostname="$AMARCHY_NAME" --ssh --timeout=180s
}
retry install_tailscale
WHAT="Joining your tailnet with the Tailscale key (used already, expired, or waiting for your approval?)"
join_tailnet
# The key is spent: forgotten here, from the settings and from cloud-init's copy.
sed -i '/^TS_AUTH_KEY=/d' "$SETTINGS"
unset TS_AUTH_KEY
tailscale set --operator="$AMARCHY_USER"
ON_TAILNET=1
report tailnet "On your tailnet"

# ---- 3. the packages, upgrades, swap, firewall

STEP=packages WHAT="Installing the packages amarchy needs (git, tmux, python3)"
say "packages"
report packages "Installing git, tmux, python3"
retry apt_ update -q
retry apt_ install -y -q --no-install-recommends git tmux python3 curl ca-certificates jq ufw unattended-upgrades
# gh: GitHub's CLI, for signing in to GitHub there (its chats clone and push
# through it). Without it, amarchy still runs.
apt_ install -y -q --no-install-recommends gh || echo "  (no gh package here: GitHub's sign-in from the app won't be offered)"
WHAT="Checking tmux (amarchy needs 3.5)"
tmux_version=$(tmux -V | grep -oE '[0-9]+\.[0-9]+' | head -1)
if ! printf '3.5\n%s\n' "$tmux_version" | sort -V -C; then
  WHAT="tmux $tmux_version is too old (amarchy needs 3.5): this system image isn't one amarchy runs on"
  false
fi
WHAT="Turning on security upgrades"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'APT'
// amarchy (cloud/bootstrap.sh): security upgrades, every day, by themselves.
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
WHAT="Making a swap file"
if [[ $SWAP_GB -gt 0 && -z $(swapon --show --noheadings 2>/dev/null) && ! -e /swapfile ]]; then
  fallocate -l "${SWAP_GB}G" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_GB * 1024)) status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
WHAT="Closing it to the public network (the firewall)"
# Only your tailnet gets in: nothing a chat serves by mistake on 0.0.0.0 is
# on the internet. Tailscale's own port for direct connections stays open.
setup_firewall() {
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow in on tailscale0 >/dev/null
  ufw allow 41641/udp >/dev/null
  ufw --force enable >/dev/null
  # Tailscale SSH (tailscale up --ssh) instead of the public sshd.
  systemctl disable --now ssh.socket ssh.service >/dev/null 2>&1 || true
  # Nor name lookups answered to the network (systemd-resolved's LLMNR and mDNS).
  if [[ -d /etc/systemd/resolved.conf.d || -x /usr/lib/systemd/systemd-resolved ]]; then
    mkdir -p /etc/systemd/resolved.conf.d
    printf '# amarchy (cloud/bootstrap.sh): nothing answered on the public network.\n[Resolve]\nLLMNR=no\nMulticastDNS=no\n' \
      >/etc/systemd/resolved.conf.d/amarchy.conf
    systemctl try-restart systemd-resolved >/dev/null 2>&1 || true
  fi
}
setup_firewall

# ---- 4. Claude Code and amarchy

STEP=claude WHAT="Installing Claude Code"
say "Claude Code"
report claude "Installing Claude Code"
if [[ -n ${GIT_NAME:-} ]]; then as_user "git config --global user.name $(printf %q "$GIT_NAME")"; fi
if [[ -n ${GIT_EMAIL:-} ]]; then as_user "git config --global user.email $(printf %q "$GIT_EMAIL")"; fi
as_user 'git config --global init.defaultBranch main'
install_claude() {
  as_user 'command -v claude >/dev/null || { curl -fsSL https://claude.ai/install.sh -o /tmp/claude-install.sh && bash /tmp/claude-install.sh; rm -f /tmp/claude-install.sh; }'
  as_user 'claude --version'
}
retry install_claude

STEP=amarchy WHAT="Installing amarchy"
say "amarchy"
report amarchy "Installing amarchy"
clone_amarchy() {
  as_user "[ -d ~/Work/amarchy/.git ] || git clone --branch $(printf %q "$AMARCHY_BRANCH") $(printf %q "$AMARCHY_REPO") ~/Work/amarchy"
}
retry clone_amarchy
# What it is on the board: a cloud, made by which machine (hello's "cloud"),
# and the logins of yours it lets in (the machine that made it has them).
CONF=$USER_HOME/.config/amarchy
install -d -o "$AMARCHY_USER" -g "$AMARCHY_USER" -m 755 "$USER_HOME/.config"
install -d -o "$AMARCHY_USER" -g "$AMARCHY_USER" -m 700 "$CONF"
echo cloud >"$CONF/icon"
printf '{"provider": %s, "by": %s, "made": %s}\n' "$(json "${AMARCHY_PROVIDER:-}")" "$(json "${AMARCHY_BY:-}")" "$(date +%s)" >"$CONF/cloud-self.json"
if [[ -n ${APP_USERS:-} ]] && ! grep -q '^APP_USERS=' "$CONF/host" 2>/dev/null; then
  printf 'APP_USERS=%s\n' "$APP_USERS" >>"$CONF/host"
fi
chown "$AMARCHY_USER:" "$CONF/icon" "$CONF/cloud-self.json" "$CONF/host" 2>/dev/null || chown "$AMARCHY_USER:" "$CONF/icon" "$CONF/cloud-self.json"
WHAT="Installing amarchy (install.sh)"
as_user '~/Work/amarchy/install.sh --no-desktop'

STEP=app WHAT="Turning amarchy's app on, on your tailnet"
say "its app"
report app "Turning its app on"
retry as_user '~/.local/bin/amarchy app on'
WHAT="Checking amarchy's app answers"
answers() { as_user 'curl -fsS --max-time 5 "http://127.0.0.1:$(. ~/.config/amarchy/host 2>/dev/null; echo "${APP_PORT:-7397}")/api/peer/hello" >/dev/null'; }
retry answers

STEP=ready WHAT="Finishing"
# Nothing secret stays: the settings (the report token) and cloud-init's own
# copies of what it was given.
report ready "amarchy is up${AMARCHY_BY:+: pairing with $AMARCHY_BY}"
rm -f "$SETTINGS" "$DIR/tailscale-install.sh" "$DIR/failed"
rm -f /var/lib/cloud/instance/user-data.txt /var/lib/cloud/instance/user-data.txt.i \
  /var/lib/cloud/instances/*/user-data.txt /var/lib/cloud/instances/*/user-data.txt.i 2>/dev/null || true
printf 'ready %s\n' "$(date -u +%FT%TZ)" >"$DIR/status"
say "done"
