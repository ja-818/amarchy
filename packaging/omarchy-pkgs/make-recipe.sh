#!/bin/bash
# omarchy-pkgs' recipe for amarchy (pkgbuilds/amarchy-git/), made from
# packaging/arch/PKGBUILD pinned to a commit of amarchy's main, the way
# omarchy-pkgs wants every git source (tests/pinned-sources.sh): `_commit`,
# `#commit=`, a fixed pkgver (r<commits>.g<sha>, what their git_branch watch
# writes for every new commit after this one) and the source's checksum.
#
#   packaging/omarchy-pkgs/make-recipe.sh [<commit>]   (default: origin/main)
#
# Writes packaging/omarchy-pkgs/amarchy-git/. Needs makepkg (the checksum).

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(dirname "$(dirname "$here")")
out="$here/amarchy-git"
commit=$(git -C "$repo" rev-parse "${1:-origin/main}")
count=$(git -C "$repo" rev-list --count "$commit")
pkgver="r$count.g${commit:0:7}"

mkdir -p "$out/.omarchy"
python3 - "$repo/packaging/arch/PKGBUILD" "$commit" "$pkgver" >"$out/PKGBUILD" <<'PY'
import re, sys
text, commit, pkgver = open(sys.argv[1]).read(), sys.argv[2], sys.argv[3]
head = """# Maintainer: Julian Arango <julianarango1818 at gmail dot com>
# amarchy's main, pinned by the upstream watch in .omarchy/package.json
# (bin/sync-upstream): every new commit on main becomes a commit pin here,
# versioned r<commits on main>.g<sha>, built and checksummed like a release.
# The recipe is amarchy's packaging/arch/PKGBUILD (made by its
# packaging/omarchy-pkgs/make-recipe.sh).
"""
body = text[text.index("pkgbase="):]
body = body.replace("pkgver=r0\n", f"pkgver={pkgver}\n", 1)
body = body.replace("pkgrel=1\n", f"pkgrel=1\n_commit={commit}\n", 1)
body = body.replace('source=("git+https://github.com/ja-818/amarchy.git")',
                    'source=("$_repo::git+$url.git#commit=${_commit}")', 1)
body = re.sub(r"\npkgver\(\) \{.*?\n\}\n\n", "\n", body, count=1, flags=re.S)
sys.stdout.write(head + "\n" + body)
PY
cp "$repo/packaging/arch/amarchy.install" "$out/amarchy.install"
cat >"$out/.omarchy/package.json" <<'JSON'
{
  "source": "local",
  "min_release_age": "1h",
  "upstream": {
    "watch": {
      "git_branch": "https://github.com/ja-818/amarchy.git",
      "branch": "main",
      "version": "r{count}.g{commit:.7}",
      "variables": {
        "_commit": "{commit}"
      }
    }
  }
}
JSON
# The source's checksum (a git source's, as updpkgsums makes it), and its
# clone gone again.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp "$out/PKGBUILD" "$out/amarchy.install" "$work/"
sum=$(cd "$work" && makepkg -g 2>/dev/null | sed -n "s/^sha256sums=('\(.*\)')$/\1/p")
[[ $sum =~ ^[0-9a-f]{64}$ ]] || { echo "no checksum came out of makepkg -g" >&2; exit 1; }
sed -i "s/^sha256sums=('SKIP')$/sha256sums=('$sum')/" "$out/PKGBUILD"
(cd "$out" && makepkg --printsrcinfo >/dev/null)
echo "amarchy-git $pkgver ($commit): $out"
