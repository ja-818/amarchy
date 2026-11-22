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
  MagicDNS short name (`amarchy`, `omarchy`), kept once it's paired
  (`~/.config/amarchy/name`), so a tailnet that renames it breaks no pair; its **label** is what the app
  shows (the name until you change it). The label is kept on the machine
  itself (`~/.config/amarchy/label`), so every machine shows the same one:
  renaming another machine asks it to rename itself.
- `GET /api/peer/hello` → `{"name", "label", "version" (git commit),
  "protocol": 1, "user" (its owner's Tailscale login), "users" (every login
  it lets in), "merges"}`, to you before pairing too. Pairing checks
  `protocol` and that `user` is one of the caller's.
- **Yours** is a machine's owner on Tailscale plus the logins in its
  `APP_USERS=` (one person's other login, on another tailnet). Nothing names a
  tailnet or a login in the code.
- Paired machines live in `~/.config/amarchy/machines.json` (0600):
  `[{"name", "label", "url": "https://<name>.<tailnet>.ts.net", "key"}]`.
  **One key per pair, the same on both**, so either machine calls the other
  with it.
- **Pairing**: the machine that adds asks the other's `/api/peer/hello`, makes
  the key and sends `POST /api/peer/pair` `{"name", "label", "url",
  "protocol"}` (its own; the new key as `Authorization: Bearer`, its name as
  `X-Amarchy-Peer`); the other keeps it and answers its hello. Pairing needs no
  app server on the machine that adds (a desktop that runs no chats yet can
  pair with the server). `POST /api/peer/unpair` (a peer forgets the caller)
  and `POST /api/peer/label` `{"label"}` (rename the machine called) need the
  peer's key.
- A request between machines carries `X-Amarchy-Protocol: 1`; a machine on
  another protocol answers 409 with what to update ("Update amarchy on
  <label>"). It also carries `X-Amarchy-Peer-URL` (where the caller is
  reached now): the other keeps it when it's on its own tailnet, so a machine
  that moved tailnets is followed; one that stops answering at its address is
  also looked for at its name's address on this tailnet.
- `amarchy machines [--json]`, `amarchy machines add <name|url>`,
  `amarchy machines remove <name>`, `amarchy machines rename <name> <label>`.
  Settings → Machines in the app: the list, each one's state, Add (machines of
  yours on the tailnet that answer `/api/peer/hello`), Remove, Rename.

### Who may call

- **The browser** (phone, any browser): as today, through `tailscale serve`.
- **A peer machine**: through the other machine's `tailscale serve` (so it
  carries the Tailscale login), plus `X-Amarchy-Peer: <caller's name>` and
  `Authorization: Bearer <pairing key>`. A web page can't send those headers
  without a CORS yes, which the server never gives. A peer's writes need no
  Origin. Two amarchys on one machine (the tests) call each other straight on
  `127.0.0.1:<port>` with the same headers, from the same user (`URL=` in the
  host settings is the address a machine gives its peers).
  In the app's server: `self.allowed(write)` takes it, then `self.via ==
  "peer"` and `self.peer` is the caller's name. Calling one:
  `peer_request(machine, method, path, body=, headers=)`.
- **The desktop app on the same machine**: straight to `127.0.0.1:<APP_PORT>`,
  no Tailscale needed (works offline). It reads `STATE/app/local.key` (0600)
  and opens `http://127.0.0.1:<port>/local?key=<key>`, which sets an HttpOnly,
  SameSite=Strict cookie and sends it on to `/`. Requests from 127.0.0.1 with
  that cookie (and, for writes, Origin `http://127.0.0.1:<port>`) are allowed.

### Chats from every machine

- Every chat in `/api/state` and `/api/events` carries `"machine": "<name>"`.
  The board also has `"machine"` (this server's name), `"merges": true` and
  `"machines"`: this one first, then each paired one, `{"name", "label",
  "me", "on", "seen" (it has answered once), "since", "error", "update"
  (words, or null), "version", "projects": [{"name", "github"
  (owner/repo, or null)}]}`.
- `/api/peer/state` and `/api/peer/events` (event `state`): `{"machine"
  (its hello), "sessions", "projects", "tasks"}`, the machine's **own** chats
  only (never ones it passes through, so machines don't echo each other).
- An app server merges its own chats with each peer's (and its agents' tasks,
  each with `"machine"`). A peer that doesn't answer keeps its last chats,
  marked `"machine_off": true` (kept on disk too); one silent for 45 s is off.
- **The pass-through**: `/api/m/<machine>/<rest>` on any app server is
  `/<rest>` on that machine: REST, SSE streamed as it comes, WebSockets tunneled
  both ways, uploads and images too.
- The app builds every chat path with one helper,
  `chatPath(chat, "/stream")` → `/api/session/<id>/stream` for this machine's,
  `/api/m/<machine>/api/session/<id>/stream` for another's (and
  `machinePath(chat, path)` for the rest of a chat's machine: its clipboard,
  its secrets, its agents' tasks, its pictures).
- Board keys (order, seen, per-chat settings) use `<machine>:<id>`. A chat with
  no machine is this machine's (old data keeps working): the app keys this
  machine's chats by their id alone and another's as `<machine>:<id>`, and
  reads `<this machine>:<id>` as `<id>`. So a chat's route is `#/s/<id>` or
  `#/s/<machine>:<id>`, and a notification's `tag` and `ask` are that key.
- **A new chat on another machine** (the app's Where, `amarchy new --on`): the
  pass-through's `/api/add` `{repo: "<owner/repo>"}` there first when the
  project isn't on it (cloned from GitHub), then its `/api/new` (which takes
  `"name"` too). `amarchy send <machine>:<id>` is `POST /api/peer/send`
  `{"id", "text", "from": "<machine>:<chat>"}` (peers only): `amarchy send`
  there, noted as from that chat. `/api/search` on a machine asks every
  paired one too (not when a peer asks), each result with `"machine"`.

### Omarchy: the bar, the key, the theme live

- **`amarchy open [<id> | <machine>/<id> | amarchy://chat/<machine>/<id>]`**
  is what the Ⓐ in the bar, Super+Alt+A and the Omarchy menu run: the window of
  class `amarchy` to the front (Hyprland), else `amarchy-desktop [link]`
  started; without the desktop app, the board in a browser window at the
  chat, by the routes below. It finds the board in the desktop app's order.
- **`amarchy bar --follow`** (the Ⓐ's process): one JSON line each time what
  the Ⓐ shows changes, `{"up": true, "board", "needs", "chats": [{"machine",
  "id", "name", "why", "link"}]}` (at most 8, the board's order), or `{"up":
  false, "board", "why"}`. It reads the board's `/api/events` (this machine's
  with the local key; a paired one's as a plain GET through its tailscale
  serve) and counts with the app's own test (`asks_you`, `needs_you`).
- **`PUT /api/peer/look`**, from a paired machine only (`X-Amarchy-Peer` and
  its key; a page or the local key gets 403): `{"key": "omarchy-live",
  "theme": <theme.json: name, mode, vars (the app's tokens), terminal,
  wallpaper {phone, wide} | null, font {family, nerd, files {regular, bold}} |
  null, from, omarchy {theme, machine}>, "files": {<name>: <base64>}}`, every
  file it names and nothing else (wallpaper[-wide].jpg|png|webp,
  regular|bold.ttf|otf|woff|woff2, checked by their bytes), 48 MB at most.
  The machine keeps it as the theme of yours `omarchy-live` ("Omarchy
  (live)"), replacing the last one in one step, and answers `{"key", "worn"}`;
  400 says what's wrong with it. Only `omarchy-live` comes this way (syncing
  the rest of your look is track D's).

### The desktop app: how it's opened, what it opens

- **One way in**: `amarchy-desktop [amarchy://chat/<machine>/<id>]`. One
  instance: a second one hands its link to the first, which shows its window
  (from the tray too) and opens that chat; with no link it just shows it.
  Wayland app id and X11 class `amarchy`, launcher entry `amarchy.desktop`
  (its `MimeType=x-scheme-handler/amarchy`). The bar widget, the Hyprland
  key and the Omarchy menu all open it this way (`amarchy open`).
- **What it opens**, the first that applies, decided when it starts (and
  again from the tray's Reload):
  1. `--url <url>` or `AMARCHY_URL`.
  2. **This machine's amarchy**, when its board has something and its app
     server answers on `127.0.0.1:<APP_PORT>`: `amarchy list --compact` isn't
     empty (chats here), or `amarchy machines --json` has more than one row
     (row 0 is this machine, `me: true`; the others are paired machines whose
     chats it merges in) **and** that `me` row says `"merges": true` (its app
     acts on other machines' chats: `chatPath`, `<machine>:<id>` routes;
     absent is false; also in `/api/peer/hello` and `/api/state`). Opened
     with the local key: the desktop app calls `/local?key=` itself and hands
     the cookie to its web view (as `SameSite=Lax`: WebKit counts the
     window's first load as coming from another site, its own page, and
     holds a Strict cookie back), so the key is never in an address the web
     view keeps.
  3. The first paired machine (`amarchy machines --json`, not `me`) whose
     `state` is `on`.
  4. The address set by hand, `amarchy-desktop --server <url>` (kept in
     `~/.config/amarchy/desktop.json`, `{"server"}`).
  5. Found on the tailnet: `amarchy machines found --json`. One: paired with
     `amarchy machines add <name>` and opened, and the window says so once.
     Several: the window asks which, once.
  Else the window says why (Tailscale isn't there or on, nothing answers) and
  takes an address.
- **A chat's link** `amarchy://chat/<machine>/<id>`: on this machine's
  amarchy, `/local?key=…&next=/%23/s/<id>` when `<machine>` is this
  machine's name, else `next=/%23/s/<machine>:<id>`; on a server's address,
  `/#/s/<id>` when it's that server's chat, else `/#/s/<machine>:<id>`.
- **The page knows it's in the desktop app**: `window.amarchyDesktop`
  (`{"version", "platform"}`), set before the app's scripts run. There the
  app's own browser notifications are off: the desktop app shows them,
  natively, window closed or not.
- **Its notifications**: every notification an app server sends the phones
  (a chat that needs you or is done, another machine's chat, an agent's task,
  `amarchy notify`, Settings' test) is also kept for the desktop apps, and
  `GET /api/notices` (an SSE stream, let in as `/api/events` is) sends each
  as `event: notice`, never one from before it connected. Its data is the
  phone's (`title`, `body`, `tag`, `url`, `ask`, `icon`, `waiting`, `urgent`)
  plus `id`, `at`, `session` (`<id>`, or `<machine>:<id>` for another
  machine's), `sound` (the chime it rings with) and `actions`: up to three
  `{"label", "path", "body"}`, each a POST of `body` to `path` on the same
  server, as the app's own page would make it (Allow and Deny:
  `/api/session/<id>/answer`; a question's options; a done reply's choices:
  `/api/session/<id>/send`; another machine's chat through
  `/api/m/<machine>/…`). A desktop app listening counts as a device notified
  (`amarchy notify`, a task's `--notify`, the test). In the desktop app the
  page rings no chime of its own: the desktop app rings `sound` when it shows
  the notice (window closed or not).

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

**Priority (Julian, 2026-11-22): amarchy running on his Omarchy desktop first.**
Everything in wave 1 is ordered to reach these two milestones as soon as each
piece is complete and verified; the rest comes after.

1. **On Omarchy, with the server's chats**: the desktop app installed on his
   Omarchy (B), opening the server's chats; its key, the Ⓐ in the bar and the
   live theme (C).
2. **On Omarchy, running chats of its own**: the desktop's own amarchy, the
   local key, its chats and the server's on one board, "Where" for a new chat
   (A, with B loading the local machine).

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

In this order, once both milestones are on Julian's Omarchy: D, E, H, I, F,
and the phone apps (G) last.

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

**G. Phone apps and the push relay** (last; Julian has an Apple Developer
account; the iOS build needs a Mac with Xcode): thin iOS and Android shells around `app/` (Tauri 2 mobile,
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
