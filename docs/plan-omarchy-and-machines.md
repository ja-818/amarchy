# Plan: amarchy everywhere, chats on every machine

Status: **approved** by Julian on 2026-11-22 (decisions below). Being built in
parallel chats; each track ships on its own.

Goal: amarchy is one app on every device (Omarchy, Mac, Windows, iPhone,
Android, any browser), and every computer you have can run chats: your
always-on server, your Omarchy desktop, a laptop, a cloud machine. Every chat
from every machine is on one board.

The rule from CLAUDE.md holds everywhere: **the phone and the computer are one
app**. One UI (`app/`), inside a thin native shell per platform. A shell only
adds what a web page can't do; it never adds screens of its own.

---

## Decisions

Approved 2026-11-22:

1. **One UI, a native shell per platform.** The desktop shell is **Tauri 2**
   (the system's own web engine: WebKitGTK on Linux, WKWebView on macOS,
   WebView2 on Windows). **Not Electron.** Not a Qt rewrite of the UI.
2. **Every computer can run chats.** The desktop app comes with amarchy's
   engine (`bin/amarchy` and the app server); installing it makes the computer
   a machine.
3. **A chat lives on its machine.** Moving one is something you choose, never
   automatic: a chat that changes this machine (Omarchy's config, say) is only
   testable here. While a desktop chat works, amarchy holds off the desktop's
   idle sleep (closing the lid still sleeps it).
4. **No main machine.** Every machine keeps a copy of what's yours (board
   order, look, streaks, goals, project order, new-chat defaults) and they
   sync. Any one can go away; the others keep working.
5. **Tailscale is the network, each user's own account** (the free Personal
   plan: 6 users, unlimited devices, non-commercial). The apps set it up for
   you: install, start, "Sign in". Later, Tailscale inside the apps (tsnet /
   libtailscale), so nothing else gets installed.
6. **Phone: real apps** (App Store, Play Store) around the same UI, with
   notification buttons, a lock-screen live status, widgets and the share
   sheet. Their notifications go through **a tiny open-source push relay** the
   project runs for free (anyone can run their own), as Home Assistant does.
   The home-screen web app keeps working, with Web Push and no relay.
7. **Cloud: one click into the user's own account**, never machines we run or
   bill for. Real VMs: Hetzner, DigitalOcean, Hostinger VPS. Not Vercel
   (serverless). Railway (containers) maybe later. 8 GB of memory is the floor
   for a dozen chats.
8. **Notifications you act on, on one device.** Allow, Deny, an answer, Ship it
   on the notification itself; only the device you're using buzzes.
9. **Omarchy is a first-class home**: in Omarchy's Install menu, its theme live,
   the Ⓐ in the bar, its keys, launcher and menu entries.

## Where we are today

- **One machine.** `bin/amarchy` (Python, stdlib only) runs everything on the
  server: chats as tmux sessions on the chat engine (`claude -p` stream-json
  broker), worktrees in `~/Work/.worktrees`, previews as systemd units, state in
  `~/.local/state/amarchy`.
- **The app server** (`amarchy-app.service`, `app_serve`) listens on
  127.0.0.1:7397; `tailscale serve` puts it on `https://<machine>.<tailnet>.ts.net`.
  Who's asking comes from Tailscale (`Tailscale-User-Login`), writes only from
  the app's own pages (Origin, `Sec-Fetch-Site`): `Handler.allowed`.
- **The API is clean to pass through**: REST (`/api/state`,
  `/api/session/<id>/...`), SSE (`/api/events`, `/api/session/<id>/stream`)
  and WebSockets (the terminals `tty/claude|term`, dictation). The app reaches
  it through `api()` and `streamURL()` (`app/app.js`) and `wsURL()`
  (`app/desk.js`); about 40 places build a chat's `/api/session/<id>` path.
- **A chat's id** is `<repo>-<name>`, unique on one machine only.
- **Web Push** from the server's VAPID key (`STATE/app/push.json`).
- **The old desktop** (deleted in `46b6389`): an Omarchy bar widget
  (`omarchy/plugin/*.qml`), Hyprland keys (`hypr/amarchy.lua`) and
  `amarchy remote`. All in git history (`git show 46b6389^:<path>`) to reuse.
- **Omarchy 4** (branch `quattro`): Quickshell QML plugins for the bar
  (`~/.config/omarchy/plugins/<id>`, skill `omarchy-make-plugin`), its theme in
  `~/.local/state/omarchy/current/theme/colors.toml`, notifications through
  `omarchy-notification-send`, Hyprland config in Lua (`bindings.lua`).

## The contract between machines and apps (protocol 1)

Every track builds against this. Change it only here, in a commit of its own,
and tell the other tracks.

### Machines

- A **machine** is a computer running amarchy. Its **name** is its Tailscale
  MagicDNS short name (`amarchy`, `omarchy`); its **label** is what the app
  shows (the name until you change it).
- `GET /api/peer/hello` → `{"name", "label", "version" (git commit),
  "protocol": 1, "user" (Tailscale login)}`. Pairing checks `protocol` and that
  `user` is the caller's.
- Paired machines live in `~/.config/amarchy/machines.json`:
  `[{"name", "label", "url": "https://<name>.<tailnet>.ts.net", "key"}]`.
- `amarchy machines [--json]`, `amarchy machines add <name|url>`,
  `amarchy machines remove <name>`, `amarchy machines rename <name> <label>`.
  Settings → Machines in the app: the list, each one's state, Add (machines of
  yours on the tailnet that answer `/api/peer/hello`), Remove, Rename.

### Who may call

- **The browser** (phone, any browser): as today, through `tailscale serve`.
- **A peer machine**: through the other machine's `tailscale serve` (so it
  carries the Tailscale login), plus `X-Amarchy-Peer: <caller's name>` and
  `Authorization: Bearer <pairing key>`. A web page can't send those headers
  without a CORS yes, which the server never gives.
- **The desktop app on the same machine**: straight to `127.0.0.1:<APP_PORT>`,
  no Tailscale needed (works offline). It reads `STATE/app/local.key` (0600)
  and opens `http://127.0.0.1:<port>/local?key=<key>`, which sets an HttpOnly,
  SameSite=Strict cookie and sends it on to `/`. Requests from 127.0.0.1 with
  that cookie (and, for writes, Origin `http://127.0.0.1:<port>`) are allowed.

### Chats from every machine

- Every chat in `/api/state` and `/api/events` carries `"machine": "<name>"`.
- `/api/peer/state` and `/api/peer/events`: the machine's **own** chats only
  (never ones it passes through, so machines don't echo each other).
- An app server merges its own chats with each peer's. A peer that doesn't
  answer keeps its last chats, marked `"machine_off": true`.
- **The pass-through**: `/api/m/<machine>/<rest>` on any app server is
  `/<rest>` on that machine: REST, SSE streamed as it comes, WebSockets tunneled
  both ways, uploads and images too.
- The app builds every chat path with one helper,
  `chatPath(chat, "/stream")` → `/api/session/<id>/stream` for this machine's,
  `/api/m/<machine>/api/session/<id>/stream` for another's.
- Board keys (order, seen, per-chat settings) use `<machine>:<id>`. A chat with
  no machine is this machine's (old data keeps working).

### What lives where

| What | Where |
| --- | --- |
| A chat: worktree, Claude, terminal, previews, the secrets it asked for | The machine it runs on |
| Projects (git checkouts) | Each machine its own; listed together by GitHub address |
| Board order, look, missions, streaks, goal, project order, new-chat defaults | Every machine, synced (no main machine) |
| Agents (Jaken...) and their tasks | The machine they run on (the server, by default) |
| Automations | The machine they run on; listed together |
| Web Push to a phone | The machine the phone subscribed on, for every machine's chats |
| Desktop notifications | The desktop app, for every machine's chats |
| Claude's usage limits | Shared (same account): shown once |

## The tracks

Each is its own chat, on its own branch, and ships when done (CLAUDE.md: tests
in both layouts, verified in the real app). Wave 1 runs in parallel now; wave 2
starts when what it needs has landed.

### Wave 1

**A. Machines: chats from every machine on one board.** (`bin/amarchy`, `app/`)
- The contract above: hello, pairing, machines.json, the peer key, the local
  key, `/api/peer/*`, the merge, the pass-through (REST, SSE, WebSocket).
- The board: the machine pill on a card (only with two or more machines), a
  dimmed card and "<label> is off" for a machine that doesn't answer (read, not
  send), Settings → Machines, the new chat's "Where" (the last one used for that
  project first; a project not on that machine is cloned there first, saying so).
- CLI: `amarchy machines`, `amarchy new <project> --on <machine>`,
  `amarchy list --all`, `amarchy send <machine>:<id>`.
- Versions: a peer on another protocol says "update amarchy on <label>".
- Tests: two amarchy app servers on one box (their own state, ports, names);
  a peer going away mid-stream and coming back; view tests with chats from two
  machines, one off, in both layouts.

**B. The desktop app (Tauri 2).** (`desktop/`, `install.sh`)
- First, a spike that decides go or no-go on WebKitGTK: the terminal (speed,
  keys, paste), the mic for dictation (WebKitGTK denies it unless the app
  handles the permission request), notifications, scrolling, the look. On
  NVIDIA, `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Fixes for WebKitGTK go into
  `app/` (the phone runs WebKit too).
- The shell: one window that loads this machine's amarchy (the local key) or a
  server's address when this machine doesn't run chats; single instance; it
  stays in the tray when the window closes; `amarchy://chat/<machine>/<id>`
  opens a chat.
- Native notifications with buttons, from the app server's `/api/events` (in
  the shell, so they come with the window closed); the window's own browser
  notifications off, so nothing comes twice.
- Packaging: builds on Linux (the AUR, and a package for omarchy-pkgs), macOS
  and Windows from CI; `install.sh` installs it when there's a desktop.
- Tests: the shell's own, and screenshots of the real window (Xvfb).

**C. Omarchy home.** (`omarchy/`, `install.sh`, `bin/amarchy`)
- The Ⓐ bar widget, brought back from `46b6389^:omarchy/plugin` and up to
  Omarchy 4: lights up when a chat needs you, says how many, opens the app on
  that chat. It follows the app server's events, no polling.
- A Hyprland key to open or focus amarchy (Super+A is Omarchy's), entries in the
  launcher and the Omarchy menu.
- The theme live: a theme "Omarchy (live)" made from the desktop's current
  Omarchy theme (colors, wallpaper, rounding, font), changing when it does.
- Hold off idle sleep while a chat on this machine works (`systemd-inhibit`).
- `amarchy tailscale`: install Tailscale, start it, sign in, check HTTPS and
  MagicDNS, and open the admin page at the right setting when one's off.
- A desktop chat's terminal in Ghostty with one key (`tmux attach`).
- install.sh: all of it when Omarchy is there; `--uninstall` takes it away.

### Wave 2

**D. Your stuff on every machine** (after A): board order, look, missions,
streaks, goal, project order, new-chat defaults kept on every machine and
synced, last change wins per item; works with any machine off.

**E. Move a chat** (after A): "Move to <machine>" in a chat's menu. Commit
(work in progress) and push the branch, make the worktree there from it, copy
Claude's conversation file (same `$HOME` and `~/Work` layout), resume; its card
keeps its place. Only after Claude's current step ends.

**F. A cloud machine in one click** (after A; Julian's OK to spend): Settings →
Machines → "Add a cloud machine": provider (Hetzner, DigitalOcean, Hostinger),
size; the provider's token through `amarchy secret ask`; the machine made in
the user's account, amarchy installed by cloud-init, joined to their tailnet,
then "Sign in to Claude" there.

**G. Phone apps and the push relay** (needs a Mac with Xcode and an Apple
Developer account): thin iOS and Android shells around `app/` (Tauri 2 mobile,
or Swift and Kotlin), widgets, live status, share sheet, notification buttons;
the relay (open source, free, self-hostable) between the machines and Apple's
and Google's push.

**H. Tailscale inside the apps** (after B): the desktop and phone apps join the
tailnet themselves (tsnet / libtailscale), so the user installs nothing else.

**I. Omarchy upstream** (after B and C): the package in omarchy-pkgs, amarchy
in Omarchy's Install menu, and a pitch to Omarchy as its agent manager.

## Risks

- **WebKitGTK** may not be good enough for the terminal or the mic on Linux:
  the spike in B decides early. The fallback is Qt WebEngine for the Linux
  shell only.
- **Passing streams through Python's stdlib server** (SSE, WebSockets both
  ways) needs care with threads and connections that hang: A tests it first.
- **Parallel tracks touch `bin/amarchy` and `install.sh`**: each keeps its
  changes in sections of its own and catches up with main before shipping.
- **Apple's review** for the phone app; **Tailscale's free plan** is
  non-commercial.
