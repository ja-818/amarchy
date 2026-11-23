# amarchy-desktop-git (Arch, AUR, omarchy-pkgs)

The desktop app built from amarchy's `main`, as a package: `/usr/bin/amarchy-desktop`,
its launcher entry and icon, `amarchy://` links, and in the tray from login
(`/etc/xdg/autostart/amarchy.desktop`). amarchy's own `install.sh` leaves the
desktop app to the package when it's installed.

Prepared, not published: publishing to the AUR or omarchy-pkgs needs Julian's OK.

```sh
makepkg -si          # build it here and install it
```

To publish on the AUR: an AUR account with an SSH key, `git clone
ssh://aur@aur.archlinux.org/amarchy-desktop-git.git`, copy this PKGBUILD in,
`makepkg --printsrcinfo > .SRCINFO`, commit, push.
