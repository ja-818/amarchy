# Plan: amarchy everywhere, chats on every machine

Status: **approved** by Julian on 2026-11-22 (decisions below). Wave 1 is done
and running on his Omarchy; wave 2 is being built in parallel chats, each track
shipping on its own.

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
  it lets in), "merges", "kind", "icon"}`, to you before pairing too.
- **Its icon**: one of `server`, `desktop`, `laptop`, `cloud`, `tower`,
  `mini`, kept on the machine itself (`~/.config/amarchy/icon`) like its
  label; until you pick one, its `kind`'s (a battery: laptop; a cloud's VM:
  cloud; another VM, or no desktop: server; else desktop). Picked for
  another machine with `POST /api/peer/icon` `{"icon"}` (peers only);
  `amarchy machines icon <name> <icon>`. The board's `machines` carry it,
  and `"machines_as"` (`icon` or `name`: how a chat shows its machine,
  `amarchy machines show icon|name`; yours, so synced by track D). Pairing checks
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

### Moving a chat (track E)

- **Only when you say so**: "Move to <label>" in a chat's menu, or
  `amarchy move [<id>] --to <machine>`; never on its own (sleep, a lid shut).
  Not your assistant or an agent: they live on their machine. Only once its
  Claude's step is over: nothing waiting on you, no turn under way, nothing it
  runs in the background, no message on its way in. Busy, it says why and
  offers to move once it's free (`--when-free`; from the chat's own Claude,
  always so). `hello` says `"moves": true` on a machine that takes moves;
  one that doesn't: "Update amarchy on <label>".
- **The old machine (A)** stops the chat's Claude (as sleep does) and its
  previews, commits what's uncommitted as one commit on the chat's branch
  (`WIP: moving to <label> (amarchy move)`, the index as it was kept, to put
  back), and pushes the branch to `origin` (only forward: origin's branch
  with commits it hasn't is refused, saying so). The project needs `origin`.
- **`POST /api/peer/move`** (peers only), body `application/x-amarchy-move`:
  a gzipped tar (1 GB at most) of `move.json` and the files. `move.json`:
  `{"move": <token, 32 hex>, "from": {"machine", "id", "label"}, "session":
  <the chat's record: name, title, priority, created, base, previews...>,
  "repo", "github" (owner/repo), "branch", "commit", "conversation" (its
  Claude's session id), "seen", "unseen", "status_at", "secrets": [{"name",
  "scope": "project"|"all", "value"}] (only those you said to copy), "run":
  {"command", "saved": {name: command}}, "previews": [<record>, "local"],
  "merges": <its merges entry>, "wip" (the WIP commit, or null)}`, and four
  folders: `claude-projects/` (its conversations, `<id>.jsonl` and `<id>/`),
  `claude-home/` (`file-history/<id>/`, `todos/<id>-*.json`), `chat/`
  (amarchy's own of it: model, title, draft, what's waiting for its Claude,
  `sent-by.jsonl`, `quiet-turns.jsonl`) and `worktree/` (what git doesn't
  carry: `.amarchy/` and the files git ignores, but dependencies and builds:
  `node_modules/`, `.venv/`, `dist/`..., made again there).
  The other machine (B) finds the project by its GitHub address (A has it
  cloned there first, as Where does: `/api/add`), fetches the branch and
  checks it's at `commit`, makes the worktree at
  `~/Work/.worktrees/<project>/<name>` on that branch (tracking origin's),
  puts the conversation where its Claude looks for it
  (`~/.claude/projects/<the worktree's path, as Claude names it>/`), keeps the
  chat's record (name, task, priority, `created`: its card's place), seen and
  unread, the run commands and secrets it hasn't got (its own win), and the
  previews (registered at this machine's address, not started), then starts
  the chat on the chat engine (`--resume <conversation>`) and answers
  `{"id", "key": "<B>:<id>", "notes": [words]}` once its Claude is up. Its
  Claude is told, with the next message, that it moved and what the WIP commit
  is. Anything wrong: all of it undone, and `{"error"}` (409 for what you can
  fix: "a chat called <name> is on <label> already"). The same `move` again
  answers as the first time.
- **`POST /api/peer/move/abort`** `{"move"}` (peers only): A lost B's answer
  (it timed out, the network went), so it asks B to drop what it took:
  `{"dropped": true}`, `{"dropped": false}` for a move B never took, 409 when
  the chat was used there since (it stays there; A says so). A keeps asking
  each minute until B answers. A machine that died while taking a move drops
  it when it starts again.
- **A, once B answered**: the chat's tmux, its worktree (never with work not
  committed: then the folder stays, and it says so), its local branch (when
  origin has it) and amarchy's state of it go; its conversation files stay in
  `~/.claude/projects`, as closing leaves them. It isn't a mission completed,
  and its merges go with it (counted once). Anything that fails before B's
  answer is rolled back (the WIP commit undone with the index as it was,
  origin's branch as it was, its previews started again), saying what happened.
- **Moved chats**: `STATE/moved.json` on A, `[{"from": "<A>:<id>", "to":
  "<B>:<id>", "at", "row"}]`, kept 30 days. `/api/peer/state` and
  `/api/peer/events` carry this machine's `"moved"`; the board has every
  machine's, merged, as `"moved": {"<machine>:<id>": "<machine>:<id>"}`
  (followed to the last, for a chat moved twice). The app opens the new key
  for a route, a notification or a link to the old one, and its drafts go
  with it. `amarchy send <id>` (and `/api/peer/send`) to a moved chat goes on
  to where it is now. Until B's chats reach a board, the board shows the
  chat as it was on A under its new key (`row`, for 2 minutes): its card
  keeps its place.
- A chat while it moves has `"moving": {"to", "label", "step", "since",
  "when": "now"|"free"}`; one that couldn't, `"move_error": {"to", "label",
  "error", "at"}` (until dismissed or moved).
- **The app**: `GET /api/session/<id>/move?to=<machine>` says what moving it
  would do: `{"to", "label", "on", "busy": [words], "refused" (words, or
  null), "changes" (files not committed), "secrets": [names it asked for],
  "previews": [labels], "left": [what isn't carried], "size"}`.
  `POST /api/session/<id>/move` `{"to", "secrets": bool, "when": "now"|"free"}`
  starts it (409 `{"busy"}` when it's busy and `when` is now),
  `{"cancel": true}` (one waiting to be free), `{"dismiss": true}` (an error).
- **CLI**: `amarchy move [<id>] --to <machine> [--when-free] [--secrets |
  --no-secrets]`, `amarchy move [<id>] --cancel`, `amarchy move [<id>]
  --check --to <machine> [--json]` (what it would do).

### Omarchy: the bar, the key, the theme live

- **`amarchy open [<id> | <machine>/<id> | amarchy://chat/<machine>/<id>]`**
  is what the Ⓐ in the bar, the key (Super+D; amarchy key) and the Omarchy menu run: the window of
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
  (`{"version", "platform", "omarchy"}`), set before the app's scripts run. There the
  app's own browser notifications are off: the desktop app shows them,
  natively, window closed or not. `omarchy`: the window is on an Omarchy
  desktop (Hyprland's session, Omarchy's current theme); the window is then
  see-through (what the page leaves unpainted shows the desktop), `<html>` is
  marked `on-omarchy` before the page is drawn, and theme.css, when the look
  is Omarchy (live) with its own wallpaper, takes the wallpaper and the ground
  under it away there (`html.on-omarchy { --wallpaper: none; ...;
  --wallpaper-ground: transparent; }`): the desktop's own wallpaper shows
  through the app's panes, and Hyprland fades the window as the terminals
  (`omarchy/hypr/amarchy.lua`).
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

### Tailscale inside the apps (track H)

- **Which Tailscale.** The system's, whenever there is one: its daemon
  answers (`tailscale status --json` has a `BackendState`, signed in or
  not). amarchy uses it as today and never runs a node of its own beside it.
  Only on a computer without it, **amarchy's own node**: `amarchy-tailnet`,
  a small Go program on Tailscale's tsnet (a sidecar, not linked into the
  apps: the node is the computer's, up for its app server whether a window is
  open or not, and no Go runtime inside the WebKit process), run by the
  user's service manager (`amarchy-tailnet.service`). Its state is
  `~/.local/state/amarchy/tailnet/` (0700). When the system's Tailscale
  starts answering, amarchy's node stops (its sign-in is kept, unused).
- **One node per computer**, signed in as the user (Tailscale's own login
  page, in the browser), named for the computer (its hostname), so it shows
  in the board and in `amarchy machines` as any other machine.
- **The same API as the system's.** The node serves Tailscale's own LocalAPI
  on `~/.local/state/amarchy/tailnet/tailscaled.sock` (0600), and
  `amarchy-tailnet cli …` is Tailscale's own CLI pointed at it. So every
  `tailscale …` amarchy runs (status, serve, the app and the previews)
  runs as `amarchy-tailnet cli …` on a computer that uses amarchy's node,
  unchanged. The node does what `tailscale serve` sets (HTTPS on the
  tailnet with the tailnet's certificates, proxied to `127.0.0.1:<port>`
  with `Tailscale-User-Login` and its siblings), so the app server lets the
  tailnet in exactly as it does through the system's; it already trusts
  connections from its own user.
- **Reaching the tailnet** without the system's (the app server's calls to
  its peers, `amarchy machines found`, the desktop app's window and its
  notices): the node's proxy, HTTP `CONNECT` on `127.0.0.1`, its address and
  credential in `~/.local/state/amarchy/tailnet/proxy.json` (0600,
  `{"url": "http://amarchy:<secret>@127.0.0.1:<port>"}`), for tailnet names
  and addresses only (`*.ts.net`, `100.64.0.0/10`, `fd7a:115c:a1e0::/48`);
  never for `127.0.0.1`.
- **Signing in**: `amarchy-tailnet login` prints Tailscale's login address
  (and opens it on a desktop); `amarchy tailscale` and the desktop app's own
  page ("Sign in to Tailscale", when the node waits for it) use it.
  `amarchy-tailnet status` says where it stands in words.
- **Phones (G)**: the same Go package (`tailnet/`), bound with gomobile, a
  node of the phone's own and its proxy for the app's web view (no serving).

### The phone apps and the push relay (track G)

**Swift and Kotlin, not Tauri mobile** (decided 2026-11-22). Everything a
phone shell adds lives in the system's own extension points, each a native
target of its own whatever wraps the web view: the Notification Service
Extension that decrypts a notification, WidgetKit's widgets, the Share
Extension; on Android, Firebase's messaging service, an app widget, a share
intent. Tauri would wrap only the web view, and add a Rust toolchain for
three architectures and its own generated Xcode and Gradle projects to fight
for every one of those targets, while sharing nothing with `desktop/` (its
Rust is the tray, one instance, the local key and the notices' stream, none
of which a phone has). So each shell is a small native app: a web view on
the machine's app (`app/`, never a second UI), the desktop's own page
(`desktop/dist`, the same files) while it isn't showing amarchy, and the
extensions. `phone/ios` (Swift, an XcodeGen project, iOS 17 and newer) and
`phone/android` (Kotlin, Android 8 and newer); app id
`io.github.ja818.amarchy` on both.

- **The page knows it's in the phone app**: `window.amarchyPhone`
  (`{"version", "platform": "ios"|"android", "relay"}`), set before the app's
  scripts run, with `call(command, args)` → a promise of the shell's answer:
  - `push.state` → `"on"|"off"|"denied"|"unsupported"`;
  - `push.subscribe {"key"}` (the machine's VAPID key, `/api/state`'s `key`)
    → a subscription as a browser's, `{"endpoint", "keys": {"p256dh",
    "auth"}}`, plus `"app": {"platform", "version", "device"}`; it asks the
    system for notifications first, while it's still your tap;
  - `push.unsubscribe` → `{"endpoint"}` it dropped (or null);
  - `notes.clear {"tags": [...]}` → that chat's notifications off the lock
    screen (the page opened it);
  - `status {"needs", "chats": [{"key", "name", "why"}]}` → the widget's
    count and names, each time the board changes.
  The shell tells the page with `amarchy-open` events (`{"go", "ask"}`, as
  the service worker's message: a notification tapped, a chat's link), and
  loads `/?ask=<key>#/s/<key>` when the page isn't up yet. There the page
  registers no service worker for notifications (none can reach a web view)
  and never says "add it to your Home Screen".
- **A phone on a machine** is a subscription as a browser's: the page sends
  `POST /api/push` with what `push.subscribe` gave. Its `endpoint` is the
  relay's (`<relay>/v1/push/<handle>`), so the machine sends to it as to any
  push service (RFC 8030, RFC 8291's aes128gcm, VAPID), and 404 or 410 ends
  it the same way. `"app"` marks it a phone app's, kept with it, with
  `"server"`: the address it was registered at (`https://<Host>`).
- **What a phone app's notification carries**: a browser's (`title`,
  `body`, `tag`, `url`, `ask`, `icon`, `waiting`, `urgent`) plus `server`,
  `session`, `sound` and `actions` (the desktop notice's: up to three
  `{"label", "path", "body"}`, each a POST of `body` to `server + path` as
  the app's page would make it, with `Origin: <server>`). At most 2,700
  bytes of JSON: the body is cut first, then the actions go. Sent with
  `Topic` (the tag's SHA-256, its first 16 bytes in base64url: a newer
  notification for a chat replaces the older), `Urgency: high`, `TTL`.
- **The relay** (`relay/`, `amarchy-relay`: Go, its standard library only,
  open source, anyone can run one) is a Web Push service in front of APNs
  and FCM, and keeps nothing:
  - `POST /v1/register` `{"platform": "apns"|"apns-sandbox"|"fcm",
    "token", "app" (the app id), "server_key" (the machine's VAPID key,
    65 bytes base64url)}` → `{"endpoint"}`. The handle in it is all of that
    sealed with the relay's secret (AES-256-GCM): no database, and only the
    machine with that key can send to it, as with Web Push.
  - `POST /v1/push/<handle>`: `Content-Encoding: aes128gcm` (anything else
    is refused: it never takes what it could read), at most 2,900 bytes;
    `Authorization: vapid t=<JWT>, k=<key>`, the handle's key, its `aud` the
    relay's address and `exp` within 24 hours; `TTL`, `Urgency`, `Topic`.
    To APNs: `{"aps": {"alert": {"title": "Amarchy", "body": "Something
    needs you"}, "mutable-content": 1, "sound": "default"}, "p": <the body,
    base64url>}`, `apns-collapse-id` the topic; to FCM: a data message
    `{"p"}`, `collapse_key` the topic, high priority. Answers 201; 404 a
    handle it didn't make; 410 the token is gone (APNs or FCM say so); 400,
    401, 403, 413, 415 what's wrong with the request; 429 with
    `Retry-After` over its limits (per device 30 at once then 15 a minute,
    per address 20 registrations an hour, all set by its environment); 502
    when APNs or FCM failed.
  - `GET /v1/health` → `{"ok", "apns", "fcm"}` (which it can send to).
  - Never logs a token or a payload (a device is the first bytes of its
    handle's hash). Its secret (`RELAY_SECRET`, older ones in
    `RELAY_SECRETS` still opened), the APNs key (`APNS_KEY`, `APNS_KEY_ID`,
    `APNS_TEAM_ID`, `APNS_TOPICS`), FCM's project (`FCM_PROJECT`, its
    credentials from `FCM_CREDENTIALS` or Google Cloud's own) come from its
    environment. Deploys: Google Cloud Run's free tier (one instance, so its
    limits hold), any container host, or a systemd unit.
- **On the phone**: its push key pair (P-256) and auth secret are made on
  the phone and never leave it (iOS: the Keychain, shared with its
  Notification Service Extension; Android: wrapped by the Keystore). The
  extension (iOS) or the messaging service (Android) decrypts `p` and shows
  the notification: its buttons (iOS: a category made for them, each asking
  for Face ID on a locked phone), the badge (`waiting`), the widget's count.
  Nothing it can decrypt: "Amarchy: open it to see", never content.
- **A button pressed**: the shell (started in the background for it) POSTs
  `body` to `server + path` with `Origin: <server>` and `Content-Type:
  application/json`, as the page does. It fails: a notification says so, and
  tapped opens the chat.
- **Reaching the machine**: the Tailscale app, when its VPN is on; else
  amarchy's own node in the app (`tailnet/mobile`, gomobile: the node and
  its proxy), its proxy set on the web view (iOS 17's
  `WKWebsiteDataStore.proxyConfigurations`, Android's `ProxyController`) and
  on the shell's own requests. The machine's address: `amarchy://open?server=<url>`
  (Settings in the web app has it), typed on its own page, or found on the
  tailnet with its own node (each peer's `/api/peer/hello`). Chat links:
  `amarchy://chat/<machine>/<id>`, as on the desktop.
- **The share sheet**: what you share (text, a link, pictures) goes to that
  machine's `POST /api/share?key=<share key>` (`GET /api/share/key`, kept by
  the shell), as the iPhone's Shortcut does, and the app opens on "Send it
  to a chat".
- **The widget** (home and lock screen on iOS, an app widget on Android):
  "2 need you", from each notification's `waiting` and the page's `status`.
  No Live Activity: the system shows one from its push as it comes, so the
  relay and Apple would read it.

### Your stuff on every machine (track D)

What's yours, not a chat's, is the same on every machine: each keeps a copy,
changes go to the others as they're made, and a machine that was off catches
up when it's back. No main machine; any one can be off.

- **Items**, last change wins: `{"key", "value", "at" (seconds, when it was
  changed, wherever), "by" (the machine it was changed on)}`. The later `at`
  wins; the same `at`, the greater `by`, so every machine picks the same. A
  machine applies an item it takes as if it had been changed there (its file,
  then the board), without stamping it again. The keys:
  - `look`: the choice (`theme`, `font`, `wallpaper`, `background`), your own
    wallpaper by its files' hashes;
  - `project-order`: your projects' names, in your order (a name a machine
    hasn't: kept in its place, for when it has it);
  - `new-model`, `new-effort`: what a new chat starts on;
  - `alerts`, `sound`, `sound-assistant`, `show-terminals`, `machines-as`;
  - `missions-goal`, `missions-since` (a reset: from then on, the same on
    every machine), `missions-told` (the streak's reminder and the week's
    recap: told once, on the machine that told it).
- **Sets**, kept whole (nothing taken back by a machine that hadn't seen it):
  - `missions`: every machine's records (a merge, a chat completed, an all
    clear, a reply), each with `"rid": "<machine>:<n>"` (its machine's
    count, rising; a record from before machines: its line's), learned once
    each; the score is made from all of them on every machine (a chat named
    in another machine's record is `<machine>:<id>` there);
  - `badges`: key → when first earned (the earliest wins);
  - `sounds`: your own chimes, name → the file's hash;
  - `themes`: your own themes (`omarchy-live` among them), key → its
    `theme.json` and its files' hashes; the newest of each wins.
- **Files** (a wallpaper, a chime, a theme's font) go by their SHA-256:
  `GET /api/peer/sync/file/<sha256>` (peers only), fetched by a machine that
  hasn't it, checked against the hash.
- **The exchange** (peers only, `X-Amarchy-Peer` and the key):
  `GET /api/peer/sync?have=<{"<machine>": n, ...}>` → `{"items", "badges",
  "sounds", "themes", "missions": [records it has that `have` hasn't],
  "have"}`: everything the machine knows, its own and what it learned from
  others (a change reaches a machine that was off through any other), and
  `POST /api/peer/sync` with the same shape: what just changed, pushed to each
  machine that answers. A machine pulls from each peer when it's paired, when
  that peer comes back on, and every 5 minutes; it pushes each change at once.
- **Per device on purpose** (never synced): a browser's layout (phone or
  wide), its notifications on or off, its drafts, the side panel and what's
  folded (the app's own storage). **Per machine on purpose**: when its idle
  chats sleep (its memory), dictation (its model), secrets (its projects'),
  the loops file (on your assistant's machine), the phones it notifies, its
  automations, Claude's arguments (`claude-args`). Per chat, as before, on
  its machine: its priority (Now, For later, pinned), seen and unread, its
  name: the same on every board already.

### A cloud machine (track F)

A machine made for you in **your own** cloud account (Hetzner Cloud,
DigitalOcean, Hostinger VPS), from Settings → Machines → **Add a cloud
machine** or `amarchy machines cloud add`. The project never runs a machine
or bills anyone: the provider bills you, and Remove deletes it there.

- **Made by one of your machines** (the one you asked: its CLI, or its app
  server for the app), which keeps it in `~/.config/amarchy/cloud.json`
  (0600): `[{"name", "provider", "id" (the provider's), "region", "size",
  "cores", "memory_gb", "disk_gb", "monthly", "currency", "billing"
  (`hourly`: billed by the hour up to the monthly price, Hetzner and
  DigitalOcean; `subscription`: paid ahead each period, Hostinger), "image", "user",
  "made", "step", "steps": {<step>: at}, "error", "detail", "log", "ip",
  "node" (its MagicDNS name once on the tailnet), "report" (its report
  token)}]`. Steps, in order: `creating` → `booting` (the provider made it)
  → `installing` (it runs: cloud-init at work) → `tailnet` (on your tailnet;
  the report's `detail` says what it's installing) → `pairing` (its
  amarchy answers) → `paired`; or `failed` (with `error`, words that say
  what to do) and `removing` → gone. A watcher of its own
  (`amarchy-cloud-<name>.service`, a user unit: it outlives the app
  server's restarts; the app server starts it again for one left
  unfinished) takes it through them.
- **Tokens stay on that machine**: the provider's API token and the
  Tailscale key in `~/.config/amarchy/secrets/cloud.env` (0600; never given
  to a chat's commands, masked wherever the app would show one), each
  under its usual name (`HCLOUD_TOKEN`, `DIGITALOCEAN_TOKEN`,
  `HOSTINGER_API_TOKEN`, `TAILSCALE_AUTH_KEY`). Given in the app's own
  password field, in a terminal (not echoed), or asked of you by a chat's
  Claude with `amarchy secret ask <NAME> --cloud` (the card, as any
  secret's): never in a chat.
- **Joining the tailnet: a one-off auth key**, made by you on Tailscale's
  Keys page (the app links straight to it: one-off, pre-approved, a day's
  expiry), kept until the machine joins and then forgotten (spent). The
  soundest way: it can add one device, once, and expires; nothing with
  standing power over your tailnet is kept anywhere or handed to the
  provider (an API token or an OAuth client would be: a tagged OAuth key
  also makes a node that isn't yours, so it couldn't pair). The node is
  yours (the key's), named for the machine. Not the VM signing in by itself
  (track H's node): its sign-in link would be on a machine nothing can
  reach yet.
- **Its setup**: `cloud/bootstrap.sh`, one script for every provider,
  carried by cloud-init (Hetzner, DigitalOcean: user data with the script
  and its settings, `amarchy machines cloud user-data <name>` shows it,
  secrets masked) or as the post-install script (Hostinger, which has no
  cloud-init). On Debian 13 (tmux 3.5; else Ubuntu 26.04), as root:
  Tailscale (its install script, then `tailscale up --auth-key --hostname
  <name> --ssh`, the operator set to your user), a swap file, git, tmux,
  python3, gh, unattended security upgrades; a user of your login name with
  sudo, lingering, and your git name and email (this machine's); Claude
  Code (its installer) and amarchy (`git clone` of this machine's origin,
  `install.sh --no-desktop`, `amarchy app on`), its icon `cloud`, and
  `~/.config/amarchy/cloud-self.json` `{"provider", "by", "made"}`.
  Nothing listens on the public network: the firewall lets in only
  `tailscale0` and Tailscale's UDP port, and sshd is off (Tailscale SSH
  instead). Secrets are wiped from the VM once used.
- **Its reports**: `POST /api/cloud/progress` on the machine that made it,
  over the tailnet (`--resolve` to that machine's Tailscale address), with
  `Authorization: Bearer <report token>` and `{"name", "step" (tailnet,
  packages, claude, amarchy, app, ready, failed), "words", "log"}` (the last
  lines of its log when it failed): let in through tailscale serve as you
  (or straight, from you, on 127.0.0.1: the tests), no Origin (it isn't a
  page). What the watcher can see for itself (the provider's state, the
  node on `tailscale status`, its hello) moves it on without them.
- **Pairing**: once its `/api/peer/hello` answers, the machine that made it
  pairs as `amarchy machines add <node>` does. Then the board's row says
  **Sign in to Claude** until its Claude is signed in, and **Sign in to
  GitHub** until `gh` is (its chats clone, push and move through it).
- **`hello`** says `"claude": "in" | "out" | null` (its Claude signed in,
  `claude auth status`, read at most once a minute), `"github": "in" |
  "out" | null` (`gh auth status`, the same) and `"cloud": {"provider",
  "by", "made"} | null` (a cloud machine amarchy made). The board's
  `machines` rows carry `claude` and `github`, and `cloud` for a cloud
  machine:
  `{"provider", "provider_label", "size", "cores", "memory_gb", "region",
  "region_label", "monthly", "currency", "billing", "step", "steps", "error",
  "detail", "made_here": true}` from `cloud.json` on the machine that made
  it (a machine still being made is a row too, `"making": true`), else
  just `{"provider", "provider_label"}` from its hello.
- **Signing in on a machine** to Claude or GitHub, any machine (through the
  pass-through for another): `GET /api/signin/<claude|github>` →
  `{"signed_in", "who", "plan", "login": {"url", "code", "since", "error"}
  | null}`; `POST /api/signin/<claude|github>` `{"do": "login"}` starts
  `claude auth login` (or `gh auth login --web`) there, in amarchy's tmux,
  and answers `{"url"}` (Anthropic's sign-in page) or `{"url", "code"}`
  (GitHub's device page and the code to type there); `{"do": "code",
  "code"}` types the code Anthropic's page gives into Claude's and answers
  once signed in (`{"signed_in", "who"}`, or `{"error"}`); `{"do":
  "cancel"}`. GitHub's ends by itself once you've typed its code (then
  `gh auth setup-git`, so git pushes as you). Never a credential copied
  between machines (each signs in on its own: a shared refresh token would
  sign the other out).
- **Removing one** (`amarchy machines cloud remove <name>`, or its sheet's
  Remove): it says what's lost (its chats: their worktrees, what isn't
  pushed, their conversations) and offers to move them to this machine
  first (`--move-chats`: each as `amarchy move` would, waiting for each to
  be free). Then `POST /api/peer/cloud/leave` (peers only, on a cloud
  machine amarchy made: it logs out of Tailscale), unpaired, and deleted at
  the provider, which stops its billing (Hostinger can't delete one at
  once: it's stopped, and its subscription isn't renewed, so it ends with
  the period you paid for).
- **The app** (this machine's own API): `GET /api/cloud` → `{"providers":
  [{"key", "label", "connected", "token_name", "token_url", "token_how",
  "notes"}], "tailscale_key": bool, "keys_url", "machines": [...]}`;
  `GET /api/cloud/options?provider=&region=` → `{"regions": [{"id",
  "label"}], "sizes": [{"id", "label", "cores", "memory_gb", "disk_gb",
  "monthly", "currency", "arch", "recommended"}]}` (the provider's own
  prices); `POST /api/cloud` `{"action": "token", "provider", "value"}`
  (checked with the provider first), `{"action": "tailscale-key",
  "value"}`, `{"action": "forget", "provider"}`, `{"action": "create",
  "provider", "region", "size", "name"}`, `{"action": "remove", "name",
  "move_chats"}`, `{"action": "dismiss", "name"}` (a failed one that was
  never made).
- **CLI**: `amarchy machines cloud [list] [--json]`, `amarchy machines cloud
  providers`, `... regions <provider>`, `... sizes <provider> <region>`,
  `... token <provider|tailscale>`, `... add [--provider p --region r
  --size s --name n] [--wait]`, `... status <name>`, `... remove <name>
  [--move-chats | --lose-chats] [--yes]`, `... user-data <name>` (what
  cloud-init would get, secrets masked).

### What lives where

| What | Where |
| --- | --- |
| A chat: worktree, Claude, terminal, previews, the secrets it asked for | The machine it runs on, until you move it |
| Projects (git checkouts) | Each machine its own; listed together by GitHub address |
| Board order, look, missions, streaks, goal, project order, new-chat defaults | Every machine, synced (no main machine) |
| Agents (Jaken...) and their tasks | The machine they run on (the server, by default) |
| Automations | The machine they run on; listed together |
| Web Push to a phone | The machine the phone subscribed on, for every machine's chats |
| A phone app's notifications | The machine it registered on, for every machine's chats, through the relay (encrypted to the phone) |
| Desktop notifications | The desktop app, for every machine's chats |
| Claude's usage limits | Shared (same account): shown once |
| A cloud machine's record, its provider token, the Tailscale key until used | The machine that made it (`cloud.json`, `secrets/cloud.env`) |

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

**Both milestones reached on 2026-11-22**: the desktop app runs on Julian's
Omarchy (`ja`, an M5 Pro MacBook Pro, aarch64), paired with the server, and his
first chat on `ja` started from his phone and answered. Wave 1's tracks are
done; what's left of them is fixes from his desktop (a hung window that won't
reopen, Super+Shift+A as the key, Where cloning a project first).

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
and the phone apps (G) last. Started 2026-11-22: D in the `amarchy-machines`
chat, E in `amarchy-move-chat`, H in `amarchy-desktop-app` once its fixes are
in. E and H shipped on 2026-11-22. Overnight (Julian's go: "everything shipped"):
F in `amarchy-cloud-machines`, G in `amarchy-phone-apps`, I prepared in
`amarchy-omarchy-home`. What needs his accounts or money (a provider token, the
AUR and omarchy-pkgs, signing and the stores, the relay's host) is prepared to
the last step and left for him.

**D. Your stuff on every machine** (after A): board order, look, missions,
streaks, goal, project order, new-chat defaults kept on every machine and
synced, last change wins per item; works with any machine off.

**E. Move a chat** (after A): "Move to <machine>" in a chat's menu. Commit
(work in progress) and push the branch, make the worktree there from it, copy
Claude's conversation file (same `$HOME` and `~/Work` layout), resume; its card
keeps its place. Only after Claude's current step ends. **Shipped 2026-11-22**
(`amarchy move`, the contract's "Moving a chat"; `test/move.py`,
`test/move-view.js`), and moved for real between `amarchy` and `ja` both ways,
its Claude remembering each time. `ja`'s home is `/home/julian`, not
`/home/ja`: each machine puts the worktree and the conversation under its own
home, so the layout only has to match from `~` down.

**F. A cloud machine in one click** (after A; Julian's OK to spend): Settings →
Machines → "Add a cloud machine": provider (Hetzner, DigitalOcean, Hostinger),
size; the provider's token through `amarchy secret ask`; the machine made in
the user's account, amarchy installed by cloud-init, joined to their tailnet,
then "Sign in to Claude" there.

**G. Phone apps and the push relay** (last; Julian has an Apple Developer
account; the iOS build needs a Mac with Xcode): thin iOS and Android shells
around `app/` in **Swift and Kotlin** (why not Tauri mobile: the contract's
"The phone apps and the push relay"), widgets, live status, share sheet,
notification buttons; the relay (open source, free, self-hostable) between
the machines and Apple's and Google's push. iOS builds and tests in GitHub
Actions (macOS runners); Android here and in CI. Signing, TestFlight, the
stores and the relay's deploy are prepared to the last step for Julian.
**Built 2026-11-23**: the relay (`relay/`), the server's and the page's side,
the Android app (`phone/android`) and the iPhone app (`phone/ios`), both with
amarchy's own Tailscale node (`tailnet/mobile`, track H's builds), CI green
for each; the whole chain tested from the server through the real relay to a
phone decrypting (`test/push-phone.py`). What needs Julian's accounts is
`phone/RELEASE.md`. Not yet: a demo machine App Review can reach (before a
public App Store release), and a run on real phones.

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
