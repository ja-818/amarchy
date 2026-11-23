#!/bin/bash
# The packages, for real: installed with pacman into a fresh copy of a clean
# chroot (devtools), then used there by a user of its own, as you would:
#
#   - amarchy and amarchy-tailnet on the PATH, amarchy's tree read-only in
#     /usr/share/amarchy, its version the commit it was built from
#   - amarchy setup (install.sh, as the user): the CLI and the skill linked,
#     the timers written, what it set up remembered; it knows it's a package
#   - amarchy update: never git; after a new package, it sets itself up again
#   - the app's pages and the desktop app's files where the packages put them
#   - amarchy help, amarchy theme --list, amarchy key work from the package
#
#   packaging/arch/test-in-chroot.sh <chroot> <package files...>
#
# <chroot> is what makechrootpkg -r takes (it has root/). Needs sudo. Exits 0
# when every check passed.

set -uo pipefail

chroot=${1:?usage: test-in-chroot.sh <chroot> <packages...>}
shift
(($#)) || { echo "usage: test-in-chroot.sh <chroot> <packages...>" >&2; exit 2; }
copy="$chroot/pkgtest"
fails=0

check() {
  if [[ $2 == ok ]]; then echo "ok   $1"; else echo "FAIL $1${3:+: $3}"; fails=$((fails + 1)); fi
}

# A fresh copy of the clean root, the packages installed in it.
sudo rm -rf "$copy"
sudo cp -a "$chroot/root" "$copy"
sudo cp "$@" "$copy/root/"
names=()
for f in "$@"; do names+=("/root/$(basename "$f")"); done

# (systemd-nspawn's note about socket families, on every run, left out.)
quiet() { grep -v '^Note: in a future version of systemd-nspawn' >&2; }
run() { sudo arch-nspawn "$copy" "$@" 2> >(quiet); }
as_user() { sudo arch-nspawn "$copy" runuser -u tester -- env HOME=/home/tester XDG_RUNTIME_DIR=/tmp/xdg-tester bash -lc "$1" 2> >(quiet); }

out=$(run pacman -U --noconfirm "${names[@]}" 2>&1)
check "pacman installs them" "$([[ $? -eq 0 ]] && echo ok)" "$(tail -3 <<<"$out")"
# What a chat needs that isn't amarchy's to depend on: a stand-in Claude Code.
run bash -c 'useradd -m tester && mkdir -p /home/tester/.local/bin /tmp/xdg-tester &&
  printf "#!/bin/sh\necho 2.1.0 \\(Claude Code\\)\n" > /home/tester/.local/bin/claude &&
  chmod 755 /home/tester/.local/bin/claude && chown -R tester: /home/tester /tmp/xdg-tester' >/dev/null 2>&1

v=$(run cat /usr/share/amarchy/.version 2>/dev/null | tr -d '\r')
check "its version is a commit" "$([[ $v =~ ^[0-9a-f]{12}$ ]] && echo ok)" "$v"
check "amarchy on the PATH, from the package" "$(run readlink /usr/bin/amarchy | grep -q '^/usr/share/amarchy/bin/amarchy' && echo ok)"
check "its tree is root's, read only for you" "$(run bash -c 'stat -c %U /usr/share/amarchy/bin/amarchy; runuser -u tester -- touch /usr/share/amarchy/x 2>&1; true' | grep -q 'Permission denied' && echo ok)"
check "amarchy-tailnet runs" "$(run amarchy-tailnet --version 2>&1 | grep -q "amarchy-tailnet $(cut -c1-7 <<<"$v")" && echo ok)" "$(run amarchy-tailnet --version 2>&1)"
check "the desktop app's files" "$(run bash -c 'test -x /usr/bin/amarchy-desktop && test -f /usr/share/applications/amarchy.desktop && test -f /etc/xdg/autostart/amarchy.desktop && echo yes' | grep -q yes && echo ok)"
check "the app's pages" "$(run test -f /usr/share/amarchy/app/index.html && echo ok)"

out=$(as_user 'amarchy help 2>&1 | head -1')
check "amarchy help" "$([[ $out == amarchy:* ]] && echo ok)" "$out"

out=$(as_user 'amarchy setup 2>&1')
check "amarchy setup, as the user" "$(grep -q 'amarchy installed' <<<"$out" && echo ok)" "$(tail -5 <<<"$out")"
check "it says it's the package's" "$(grep -q 'Installed by amarchy-git' <<<"$out" && echo ok)" "$(grep -i installed <<<"$out")"
check "the CLI linked for you, to the package" "$(as_user 'readlink ~/.local/bin/amarchy' | grep -q '^/usr/share/amarchy/bin/amarchy' && echo ok)"
check "the skill for Claude Code" "$(as_user 'readlink ~/.claude/skills/amarchy' | grep -q '^/usr/share/amarchy/skill' && echo ok)"
check "the timers written" "$(as_user 'ls ~/.config/systemd/user/amarchy-sleep.timer ~/.config/systemd/user/amarchy-update.timer' >/dev/null 2>&1 && echo ok)"
check "the update timer says the package updates it" "$(as_user 'grep -q "updates with your packages" ~/.config/systemd/user/amarchy-update.timer' && echo ok)"
check "what it set up, remembered" "$(as_user 'cat ~/.local/state/amarchy/setup-version' | grep -qx "$v" && echo ok)"

# The app's server, from the package: its pages, in through the local key.
out=$(as_user 'export AMARCHY_HOST_APP_PORT=7911; (timeout 20 amarchy app serve >/tmp/serve.log 2>&1 &);
  for i in $(seq 40); do curl -s -o /dev/null http://127.0.0.1:7911/ && break; sleep 0.25; done
  key=$(cat ~/.local/state/amarchy/app/local.key)
  curl -s -o /dev/null -c /tmp/jar -w "%{http_code} " "http://127.0.0.1:7911/local?key=$key"
  curl -s -b /tmp/jar http://127.0.0.1:7911/ | grep -o "<title>[^<]*</title>"')
check "its app server serves the app's pages, in with the local key" "$(grep -q '^303 <title>' <<<"$out" && echo ok)" "$out"

out=$(as_user 'amarchy update 2>&1')
check "amarchy update: the package's, never git" "$(grep -q 'installed by amarchy-git: it updates with your packages' <<<"$out" && echo ok)" "$out"
out=$(as_user 'amarchy update --auto 2>&1; echo "exit $?"')
check "the timer's update: quiet" "$([[ $out == "exit 0" ]] && echo ok)" "$out"

# A new package (its version moved): set up again by itself.
run bash -c 'echo 0000000new01 > /usr/share/amarchy/.version'
out=$(as_user 'amarchy update 2>&1')
check "after a new package: set up again" "$(grep -q 'set up again for amarchy-git 0000000new01' <<<"$out" && echo ok)" "$out"
check "and remembered" "$(as_user 'cat ~/.local/state/amarchy/setup-version' | grep -qx 0000000new01 && echo ok)"

out=$(as_user 'amarchy theme --list 2>&1 | head -3; amarchy key 2>&1')
check "themes and the key, from the package" "$(grep -q 'Super+Alt+A brings amarchy to the front' <<<"$out" && grep -q 'catppuccin' <<<"$out" && echo ok)" "$out"

out=$(as_user 'amarchy setup --uninstall 2>&1')
check "amarchy setup --uninstall" "$(as_user 'test ! -e ~/.local/bin/amarchy && test ! -e ~/.claude/skills/amarchy && test ! -e ~/.config/systemd/user/amarchy-update.timer && echo gone' | grep -q gone && echo ok)" "$(tail -3 <<<"$out")"
out=$(run pacman -R --noconfirm amarchy-git amarchy-desktop-git 2>&1)
check "pacman removes them" "$(run test ! -e /usr/share/amarchy && echo ok)" "$(tail -3 <<<"$out")"

sudo rm -rf "$copy"
echo
((fails)) && echo "$fails failed" || echo "all ok"
exit $((fails > 0))
