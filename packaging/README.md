# amarchy as packages, and for Omarchy

Everything here is prepared, not published: publishing on the AUR, in
omarchy-pkgs or to Omarchy needs Julian's accounts and his OK.

| What | Where | Goes to |
| --- | --- | --- |
| `PKGBUILD`, `amarchy.install`, `.SRCINFO` | [arch/](arch) | The AUR (`amarchy-git`), and any Arch: `makepkg -si` |
| The omarchy-pkgs recipe, and its PR's text | [omarchy-pkgs/](omarchy-pkgs) | A draft PR to omacom/omarchy-pkgs |
| `omarchy-install-ai-amarchy`, `omarchy-remove-ai-amarchy`, their menu rows | [omarchy/](omarchy) | A PR to omacom/omarchy, once they want it |
| The pitch, and `post-pitch.sh` | [omarchy/pitch.md](omarchy/pitch.md) | A discussion in Omarchy's Suggestions |

## The packages

One PKGBUILD (`pkgbase=amarchy-git`), two packages:

- **amarchy-git**: amarchy itself in `/usr/share/amarchy` (the CLI, the app's
  server and pages, themes, fonts, chimes, the skill for Claude Code, Omarchy's
  pieces, the installers), `/usr/bin/amarchy`, its own Tailscale node,
  `/usr/bin/amarchy-tailnet`, and dictation's speech engine in
  `/usr/lib/amarchy/transcribe.cpp`: a release of
  [transcribe.cpp](https://github.com/handy-computer/transcribe.cpp) (MIT)
  pinned by its hash for each processor (`source_x86_64`, `source_aarch64`; the
  same release `bin/amarchy` pins, which `check()` makes sure of), its CPU code
  only (about 20 MB; the Vulkan module is left out). The speech model (740 MB)
  isn't in it: it's fetched the first time it's wanted. No desktop
  dependencies, so a server takes it as it is. Your part of it (the timers, the skill, the Ⓐ, the key, the live
  theme) is `amarchy setup`, run as you; a package's update is set up again by
  itself within five minutes (`amarchy update`), and the app reloads.
- **amarchy-desktop-git**: the desktop app, `/usr/bin/amarchy-desktop`, its
  launcher entry, icons, `amarchy://` links, and the tray from login.

A packaged amarchy never pulls itself from git: it updates with your packages.
`install.sh` (`amarchy setup`), `tailnet/install.sh` and `desktop/install.sh`
see the packages and use them instead of building.

### How they were checked

- Built in a clean chroot (devtools), from GitHub exactly as the AUR builds
  it: `makechrootpkg -c -r <chroot>` in `arch/`. Its `check()` compiles
  `bin/amarchy`, parses the installers, runs the node and the desktop app's
  tests.
- `namcap PKGBUILD`: clean. `namcap` on the packages warns only about what it
  can't see: commands amarchy runs rather than links (`git`, `tmux`, `jq`),
  libraries the desktop app opens at run time (`libayatana-appindicator`,
  GStreamer's plugins, `xdg-utils`), optional features (fontTools,
  Quickshell) and Omarchy's own QML modules (`qs.Commons`, `qs.Ui`); and,
  for dictation's engine, how transcribe.cpp's release was linked (no full
  RELRO, `libdl`/`libm` linked but unused: built for any Linux from glibc
  2.27 on, not by Arch's flags).
- makepkg's one warning, "Package contains reference to $srcdir": Tauri's
  generated code keeps the desktop app's source folder as a string (its
  config's folder); rustc's `--remap-path-prefix` can't reach it, and it's
  never used at run time.
- [arch/test-in-chroot.sh](arch/test-in-chroot.sh): the packages installed
  with pacman in a fresh copy of the chroot and used there by a user of its
  own: `amarchy setup`, the app server serving its pages through the local
  key, `amarchy update` leaving updates to pacman and setting itself up again
  after a new package, the themes and the key, `amarchy setup --uninstall`,
  `pacman -R`. 23 checks.
- Not built for aarch64 here; the Rust and Go parts are arch-neutral, and
  dictation's engine for aarch64 is transcribe.cpp's own release (checked by
  its hash), the one a checkout fetches there too.
- With `DICTATION_MODEL` (the model's GGUF) and `DICTATION_PCM` (JFK's speech,
  16 kHz 16-bit mono), `test-in-chroot.sh` has the package's engine write it
  down in the chroot.

## Publishing

### The AUR

`~/Work/aur/amarchy-git` on the server is the AUR repository, ready: the
PKGBUILD (with the version it was built at), `amarchy.install`, `.SRCINFO`,
committed, its remote `ssh://aur@aur.archlinux.org/amarchy-git.git`. The
server has a key of its own for it (`~/.ssh/aur`, in `~/.ssh/config` for
aur.archlinux.org, the AUR's host key checked against its published
fingerprint). Once that key's public half is on your AUR account (My Account
→ SSH Public Key):

```sh
cd ~/Work/aur/amarchy-git && git push origin master
```

After a change to `arch/PKGBUILD`: copy it there, `makepkg --printsrcinfo >
.SRCINFO`, commit, push. Users then install with `yay -S amarchy-git
amarchy-desktop-git` and run `amarchy setup`.

### omarchy-pkgs

`omarchy-pkgs/amarchy-git/` is the recipe: `arch/PKGBUILD` pinned to a commit
of main (their rule; [make-recipe.sh](omarchy-pkgs/make-recipe.sh) makes it),
and `.omarchy/package.json` with a `git_branch` watch on main, the way
`omarchy-settings-dev` follows `quattro`: their bot turns each new commit into
a pinned build. It's committed, with its line in `release/owners.json`, on the
branch `add-amarchy-git` of the fork `ja-818/omarchy-pkgs`. Open it as a
draft (a green non-draft PR there merges and publishes itself):

```sh
gh pr create -R omacom/omarchy-pkgs --draft --base master --head ja-818:add-amarchy-git \
  --title "Add amarchy-git: run a dozen Claude Code agents from one board" \
  --body-file ~/Work/amarchy/packaging/omarchy-pkgs/PR.md
```

### Omarchy

Omarchy takes ideas as discussions (its issues are for verified bugs). The
pitch goes to Suggestions:

```sh
~/Work/amarchy/packaging/omarchy/post-pitch.sh      # --dry-run first, to see where
```

The installer and its menu rows in `omarchy/` are for the PR that follows, if
Omarchy wants amarchy in Install › AI.
