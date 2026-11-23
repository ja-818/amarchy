# amarchy-desktop-git (Arch, AUR, omarchy-pkgs)

The desktop app's package is built with amarchy's own, from one PKGBUILD:
[packaging/arch](../../../packaging/arch/PKGBUILD) (`pkgbase=amarchy-git`, the
packages `amarchy-git` and `amarchy-desktop-git`). It installs
`/usr/bin/amarchy-desktop`, its launcher entry and icon, `amarchy://` links, and
the tray from login (`/etc/xdg/autostart/amarchy.desktop`). `desktop/install.sh`
leaves the desktop app to the package when it's installed.

How it's built, checked and published: [packaging/README.md](../../../packaging/README.md).
