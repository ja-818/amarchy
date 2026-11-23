# amarchy as packages, and for Omarchy

Everything here is prepared, not published: publishing on the AUR, in
omarchy-pkgs or to Omarchy needs Julian's accounts and his OK.

| What | Where | For |
| --- | --- | --- |
| `PKGBUILD`, `amarchy.install`, `.SRCINFO` | [arch/](arch) | The AUR (`amarchy-git`), and any Arch: `makepkg -si` |
| The omarchy-pkgs recipe | [omarchy-pkgs/amarchy-git/](omarchy-pkgs/amarchy-git) | A PR to omacom/omarchy-pkgs (pinned to a commit) |
| `omarchy-install-ai-amarchy`, `omarchy-remove-ai-amarchy`, the menu rows | [omarchy/](omarchy) | A PR to basecamp/omarchy, in its style |
| The pitch | [omarchy/pitch.md](omarchy/pitch.md) | An issue or discussion on basecamp/omarchy |

## The packages

One PKGBUILD (`pkgbase=amarchy-git`), two packages:

- **amarchy-git**: amarchy itself in `/usr/share/amarchy` (the CLI, the app's
  server and pages, themes, fonts, chimes, the skill for Claude Code, Omarchy's
  pieces, the installers), `/usr/bin/amarchy`, and its own Tailscale node,
  `/usr/bin/amarchy-tailnet`. No desktop dependencies, so a server takes it as
  it is. Your part of it (the timers, the skill, the Ⓐ, the key, the live
  theme) is `amarchy setup`, run as you; a package's update is set up again by
  itself within five minutes (`amarchy update`), and the app reloads.
- **amarchy-desktop-git**: the desktop app, `/usr/bin/amarchy-desktop`, its
  launcher entry, icons, `amarchy://` links, and the tray from login.

A packaged amarchy never pulls itself from git: it updates with your packages.
`install.sh` (`amarchy setup`), `tailnet/install.sh` and `desktop/install.sh`
see the packages and use them instead of building.

Built and checked in a clean chroot (devtools' `makechrootpkg`), `namcap`
clean, installed there and `amarchy setup` run as a user:

```sh
cd packaging/arch
makechrootpkg -c -r <chroot>       # or makepkg -si on your own Arch
namcap PKGBUILD *.pkg.tar.zst
```

### On the AUR

The AUR's `amarchy-git` is `arch/` as it is. With an AUR account and an SSH
key on it:

```sh
git clone ssh://aur@aur.archlinux.org/amarchy-git.git && cd amarchy-git
cp ../amarchy/packaging/arch/{PKGBUILD,amarchy.install,.SRCINFO} .
git add PKGBUILD amarchy.install .SRCINFO && git commit -m "amarchy-git: first upload" && git push
```

`makepkg --printsrcinfo > .SRCINFO` after any change to the PKGBUILD. The
desktop app's own `amarchy-desktop-git` comes with it (one pkgbase).

### In omarchy-pkgs

`omarchy-pkgs/amarchy-git/` is the recipe: the same PKGBUILD pinned to a
commit (their rule), and `.omarchy/package.json` with a `git_branch` watch on
amarchy's `main`, the way `omarchy-settings-dev` follows `quattro`: every new
commit becomes a pinned build by their bot, versioned `r<count>.g<sha>`. The PR
adds `pkgbuilds/amarchy-git/` and its lines in `release/owners.json`
(`bin/release-owners amarchy-git`). Open it as a draft: a green non-draft PR
there merges and publishes itself.
