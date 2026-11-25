**Stop babysitting your agents. Manage them.**

One Claude Code at a time, you babysit it: you watch it, wait on it and read
every word. A dozen at once, you manage them. [amarchy](https://github.com/ja-818/amarchy)
is the tool for that: every task is a chat, each in its own git worktree, on a
board that says which chat needs you and what for. Every reply opens with a
briefing, and you answer, approve and ship with a tap, from the desktop or from
your phone, while the chats keep working on a machine that never sleeps.

It's open source (MIT), and it was made on Omarchy, for Omarchy.

## Why it belongs in Omarchy 4

Omarchy 4 made agents part of the desktop: `omarchy agent`, the Agents panel,
a default agent, installers for Herdr, Hermes and T3 Code. They're about one
agent in front of you. amarchy is the next step: many of them, working while
you're elsewhere, and you only where you're needed.

It's built out of Omarchy's own parts, and changes none of Omarchy's files:

- **The Ⓐ in the bar**: a shell plugin (Quickshell, `omarchy plugin` rules,
  its strings in `i18n/`) that lights up when a chat needs you and says how
  many. It follows amarchy's events; it never polls.
- **Super + Shift + R**: one key in Omarchy's Lua bindings (a free one, on
  the Super + Shift and a letter Omarchy opens its apps with; a setting),
  through `o.bind`. A row in the Omarchy menu, through the user's
  `omarchy-menu.jsonc`.
- **The theme live**: "Omarchy (live)" is amarchy's look made from the
  desktop's current theme (its `colors.toml`, its `shell.toml`, Hyprland's
  rounding, the wallpaper, the font), redone by the `theme-set` hook and a
  path unit whenever Omarchy's changes. The phone wears your desktop's theme.
- **Tailscale** the Omarchy way (`omarchy-install-service-tailscale`, its bar
  panel); without it, amarchy has a node of its own.
- **Ghostty**: any chat in a Ghostty window with one key (tmux underneath).
- While a chat works, idle sleep waits (`systemd-inhibit --what=idle`); the
  screen still locks and the lid still sleeps.

`amarchy setup --uninstall` takes every piece away again; the files it
touches are backed up first.

## How it installs

Two packages from one PKGBUILD: `amarchy-git` (the CLI, the app server, the
Omarchy pieces; no GUI dependencies, so a home server takes it too) and
`amarchy-desktop-git` (the app: Tauri 2 on WebKitGTK, native notifications).

- On the AUR: `yay -S amarchy-git amarchy-desktop-git`, then `amarchy setup`.
- For omarchy-pkgs: a recipe tracking amarchy's `main` the way
  `omarchy-settings-dev` tracks `quattro` (a `git_branch` watch, every commit a
  pinned build), ready as a PR.
- An installer in Omarchy's style, for Install › AI:
  `omarchy-install-ai-amarchy` (and `omarchy-remove-ai-amarchy`), drafted
  below.

```bash
#!/bin/bash

# omarchy:summary=Install amarchy: run a dozen Claude Code agents from one board, on your desktop and your phone
# omarchy:requires-sudo=true

set -euo pipefail

if (( EUID == 0 )); then
  echo "Run this command as your desktop user, without sudo." >&2
  exit 1
fi

# Every chat amarchy runs is Claude Code, signed in with your own plan.
if ! omarchy-cmd-present claude; then
  echo "Installing Claude Code..."
  omarchy-default-agent claude
fi

echo "Installing amarchy..."
omarchy-pkg-add amarchy-git amarchy-desktop-git

echo "Setting amarchy up..."
amarchy setup

if omarchy-installed-service-tailscale; then
  amarchy app on || true
else
  echo "For your phone: omarchy-install-service-tailscale, or amarchy tailscale."
fi

echo "Opening amarchy..."
setsid uwsm-app -- /usr/bin/amarchy-desktop >/dev/null 2>&1 &

echo ""
echo "amarchy has been installed. Super+Shift+R brings it up; the Ⓐ in the bar lights up when a chat needs you."
```

```jsonc
"install.ai.amarchy": {"icon":"Ⓐ","label":"Amarchy","disabled":"omarchy-pkg-present amarchy-git","action":"omarchy-launch-floating-terminal-with-presentation omarchy-install-ai-amarchy"},
```

## What we'd ask

1. Take the omarchy-pkgs recipe (a draft PR there, `amarchy-git`: both
   packages, built in a clean chroot and tested installed).
2. If you like it, the installer above and its row in Install › AI. Happy to
   send that PR too, in Omarchy's style, with its i18n.
3. Anything about it that doesn't feel like Omarchy: we'd rather fix it than
   argue it.

Repository and guide: https://github.com/ja-818/amarchy ·
[What it does on Omarchy](https://github.com/ja-818/amarchy/blob/main/docs/guide.md#on-omarchy)
