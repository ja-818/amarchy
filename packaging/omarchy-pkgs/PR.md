Adds `amarchy-git`, one recipe for two packages:

- **amarchy-git**: [amarchy](https://github.com/ja-818/amarchy), "stop babysitting your agents, manage them": Claude Code chats in parallel, each in its own git worktree, on one board that says which needs you and what for, from the desktop and the phone. The CLI, the app server and its pages, the Omarchy pieces (the Ⓐ bar widget, Super+Shift+R, an Omarchy menu row, a theme that follows the desktop's) and its own Tailscale node (Go, tsnet) for computers without Tailscale. No GUI dependencies, so a home server takes it too.
- **amarchy-desktop-git**: its desktop app (Tauri 2 on WebKitGTK): the board and the chats in a window, native notifications, `amarchy://` links, the tray.

It tracks amarchy's `main` with a `git_branch` watch, the way `omarchy-settings-dev` tracks `quattro`: `_commit` pinned, versioned `r<commits>.g<sha>` (`helpers/upstream-watch.py check` says it's current), `min_release_age` 1h. amarchy has no tagged releases yet. It never changes Omarchy's own files: `amarchy setup --uninstall` takes its pieces away.

How it was tested:

- Built in a clean Arch chroot (devtools `makechrootpkg`), x86_64. The same PKGBUILD unpinned is on its way to the AUR as `amarchy-git`.
- `namcap`: the PKGBUILD is clean. On the packages, only what namcap can't see: commands amarchy runs (`git`, `tmux`, `jq`), libraries the desktop app opens at run time (the tray, GStreamer), optional features (fontTools, Quickshell) and Omarchy's own QML modules (`qs.Commons`, `qs.Ui`).
- Installed with `pacman -U` in a fresh copy of the chroot and used there by a user of its own: `amarchy setup`, the app server serving its pages, `amarchy update` leaving updates to pacman and setting itself up again after a new package, `amarchy setup --uninstall`, `pacman -R` (amarchy's `packaging/arch/test-in-chroot.sh`, 23 checks).
- `tests/pinned-sources.sh`, `pkgname-unique.sh`, `package-metadata.sh`, `package-owners.sh` pass; `release/owners.json` from `bin/release-owners amarchy-git`.
- Not built here for aarch64 (no emulation on hand); the Go and Rust parts are arch-neutral, and your CI builds aarch64 natively.

It's a draft so it doesn't merge itself before you've looked.
