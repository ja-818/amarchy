# Plan: amarchy on the Omarchy desktop, and chats on two machines

Status: **draft**, waiting on Julian's decisions (see [Decisions](#decisions)).
Written 2026-11-22.

Goal: amarchy is both the web app (the phone, any browser) and an Omarchy app
on Julian's desktop. First, the desktop app shows the server's chats, as the
web app does today. Then chats can run on either machine, the server or the
desktop, and every chat from both shows on the same board, on the phone and on
the desktop.

The rule from CLAUDE.md still holds: **the phone and the computer are one
app**. So the desktop app is the same app (`app/`), not a second UI.

---

## 1. Where we are today

What the code does now, which the plan builds on:

- **One machine.** `bin/amarchy` (Python, stdlib only) runs everything on the
  server: chats as tmux sessions on the chat engine (`claude -p` stream-json
  broker), worktrees in `~/Work/.worktrees`, previews as systemd units, state in
  `~/.local/state/amarchy`.
- **The app server** (`amarchy-app.service`, `app_serve`) listens on
  127.0.0.1:7397; `tailscale serve` puts it on `https://<machine>.<tailnet>.ts.net`.
  Who's asking comes from Tailscale (`Tailscale-User-Login`), writes only from
  the app's own pages (Origin, `Sec-Fetch-Site`), see `Handler.allowed`.
- **The API is clean to proxy.** REST (`/api/state`, `/api/session/<id>/...`),
  two SSE streams (`/api/events`, `/api/session/<id>/stream`) and WebSockets
  (the terminals, `tty/claude|term`, and dictation). The app reaches it through
  three helpers (`api()` and `streamURL()` in `app/app.js`, `wsURL()` in
  `app/desk.js`); about 40 places build a chat's `/api/session/<id>` path.
- **A chat's id** is `<repo>-<name>` (`jaken-jaken`), unique on one machine only.
- **Web Push** comes from the server's VAPID key to the phones that subscribed
  on its origin (`STATE/app/push.json`).
- **The old desktop** (deleted 2026-10-22 in `46b6389`) had an Omarchy bar
  widget (`omarchy/plugin/*.qml`, ~1,400 lines), Hyprland keys
  (`hypr/amarchy.lua`) and `amarchy remote`, which already mixed the desktop's
  own sessions with a host's over ssh. It's all in git history to reuse.
- **Omarchy 4** builds its own apps in C++/Qt (`omarchy-make-app`), its bar
  from Quickshell QML plugins (`~/.config/omarchy/plugins/<id>`), and opens web
  apps in their own window with `omarchy-launch-or-focus-webapp`. Its theme is
  `~/.local/state/omarchy/current/theme/colors.toml`.
- **Tailscale** sees no Omarchy desktop online now: the `omarchy` node was last
  seen 30 days ago, `remote-omarchy` 33.

## 2. The shape

```
 phone ──https──▶ server (main machine)  ◀──peer──▶  desktop (Omarchy)
                  its chats, the board,               its chats, its terminals,
                  agents, push to the phone           previews; the Omarchy app
                                                      window, bar widget, keys
```

- **Every machine runs the same amarchy.** The desktop gets the normal install.
- **Each machine's app server shows every machine's chats.** It serves its
  own and passes the others' through to their machine (server to server, over
  the tailnet). The browser only ever talks to the machine it loaded from, so
  the app keeps its single origin: no CORS, no new sign-in, push unchanged.
- **One main machine owns what's yours, not a chat's**: the board's order,
  the look, missions and streaks, agents, new-chat defaults. The server is
  main because it never sleeps. The desktop reads and writes those through it,
  and keeps a copy for when it can't reach it.

## 3. Phase 0: the desktop joins (Julian, about 10 minutes)

1. Tailscale on the Omarchy desktop, signed in to the same tailnet.
2. Claude Code installed and logged in there (needed from phase 2).

## 4. Phase 1: amarchy as an Omarchy app, on the server's chats

The same app in its own window, plus what makes it feel native. Nothing runs
chats on the desktop yet.

- **A launcher entry.** `amarchy desktop on [server]` (also from `install.sh`
  when Omarchy is there) writes `amarchy.desktop` and its icon, opening the
  server's address with `omarchy-launch-or-focus-webapp`: one window, focused
  if it's open. `amarchy desktop off` and `install.sh --uninstall` take it away.
- **A key.** Open or focus amarchy from anywhere (Hyprland binding through
  Omarchy's `bindings.lua`; Super+A is Omarchy's own, so another one). The
  app's own keys (`Ctrl+Alt+N`, `J`/`K`...) work as in a browser.
- **A bar widget.** The old Ⓐ plugin, cut down and brought up to Omarchy 4:
  it lights up when a chat needs you, says how many, and opens the app (on that
  chat) when clicked. Its data comes from a small watcher on the desktop
  (`amarchy desktop watch`, a user service) that follows the server's
  `/api/events` and writes a state file the widget watches: events, no polling.
- **Notifications from the desktop itself.** The watcher sends them through
  Omarchy's notifications (`omarchy-notification-send`), with the chat's
  chime; clicking one opens the window on that chat. The window's own browser
  notifications stay off, so nothing comes twice.
- **The look follows Omarchy.** A theme "Omarchy (live)": the watcher sends
  the desktop's current theme (colors, wallpaper, rounding, font) to the
  server, which serves it as a theme of your own; pick it and the app, on the
  phone too, changes when the desktop does.
- **Tests:** the view tests unchanged (same app); a test for the launcher and
  watcher install and uninstall; the widget checked with
  `omarchy agent look plugin`.

This phase is small and ships on its own, before any of phase 2.

## 5. Phase 2: chats on both machines, one board

### 5.1 The desktop runs amarchy too

The normal `install.sh` on the desktop: its own chats, tmux, chat engine,
app server and `tailscale serve`. On its own it's already a complete amarchy.
Check what's different on a desktop: suspend (a sleeping machine), battery,
Omarchy's own tmux config, ports already taken.

### 5.2 Machines find each other

- `amarchy machines` lists them; `amarchy machines add <tailnet name>` pairs
  one, `remove` unpairs. Pairing checks the other side runs amarchy (a
  `/api/peer/hello` with its name and protocol version) and that it's yours.
- The app offers it too: a machine of yours on the tailnet that runs amarchy
  shows up in Settings → Machines with an "Add" button.
- Each machine has a name to show (its Tailscale name, which you can change).

### 5.3 The peer API and the pass-through

- **Peer routes** on every app server: `/api/peer/state` (its own chats only,
  never ones it passes through, so two machines don't echo each other) and
  `/api/peer/events` (the same as `/api/events`, its own).
- **The pass-through.** `/api/m/<machine>/session/<id>/...` on any app server
  goes to that machine: REST, SSE (streamed as it comes) and WebSockets (the
  terminals: a tunnel, both ways). Uploads and images too.
- **Who may call.** Server to server goes through the other machine's
  `tailscale serve`, so it carries your Tailscale login like the browser does.
  Writes from a peer carry an `X-Amarchy-Peer` header and the pairing's key,
  instead of the browser's Origin: a web page can't send that header without
  the server's say-so.

### 5.4 One board

- Each chat in the app carries `machine`. The app builds a chat's paths with
  one helper instead of `/api/session/${id}` everywhere.
- A card shows its machine as a small pill, only when you have more than one.
  Same pill on the phone and the desktop (`app/ui.js`).
- Filters keep working across machines (Needs you, At work, Now, For later).
- Search, Tasks, previews and the chat's terminal work the same for a chat on
  either machine.

### 5.5 What lives where

| What | Where it lives |
| --- | --- |
| A chat: its worktree, Claude, terminal, previews, secrets it asked for | The machine it runs on |
| Projects (the git checkouts) | Each machine its own; listed together, by GitHub address |
| Board order, look, missions, streaks, daily goal, new-chat defaults, project order | The main machine; the desktop keeps a copy |
| Agents (Jaken...) and their tasks | The main machine (always on) |
| Automations (timers) | The machine they run on; listed together |
| Push to the phone | The main machine, for chats on every machine |
| Desktop notifications | The desktop's watcher, for chats on every machine |
| Dictation | The machine the app loaded from, or the main one when that one isn't set up |
| Claude's usage limits | Shared (same account): shown once |

### 5.6 New chat: where it runs

- The new chat box gets a "Where" choice: the server or the desktop, the last
  one you used for that project first.
- A project that isn't on that machine yet is cloned there first (`amarchy add`
  over there), with a line saying so.
- `amarchy new <project> --on <machine>`; `amarchy list --all`;
  `amarchy send <machine>:<id>`.
- Shipping is per machine: it merges into that machine's checkout and pushes.
  New chats start from `origin/main`, so the other machine's checkout being
  behind doesn't matter.

### 5.7 When a machine is off

The desktop sleeps; the server doesn't. A machine that doesn't answer shows its
chats as they were last seen, dimmed, with "omarchy is off": you can read them,
not send. When it's back they update by themselves. Nothing waits on a machine
that's off: the board loads from what answered.

### 5.8 Versions

Both machines update themselves every five minutes (`amarchy-update.timer`),
so they can be a few minutes apart. The peer API has a version number; a
machine on another one says "update amarchy on omarchy" instead of breaking.

### 5.9 Tests

- Two amarchy app servers on one box (their own state, ports and names) for
  the peer API, pass-through (REST, SSE, WebSocket), a machine going away
  mid-stream and coming back, and pairing.
- View tests with chats from two machines, one of them off, in both layouts.
- Then on the real thing: the phone and the desktop window, a chat on each.

## 6. Phase 3: move a chat between machines

"Take this chat to the server" before shutting the laptop, and back. The
branch is committed (as a work-in-progress commit) and pushed, the other
machine makes the worktree from it, Claude's conversation file is copied over
(same `$HOME` and `~/Work` layout, so the same path), and the chat resumes
there. Its card stays where it was on the board.

## 7. Phase 4: polish

- A desktop chat's terminal in a real terminal window (Ghostty) with one key,
  `tmux attach` underneath.
- Previews of desktop chats from the phone (the desktop's own `tailscale serve`).
- Claude on the server reading the desktop's clipboard (the old `amarchy-paste`).
- Secrets kept on one machine offered to the other.

## Decisions

1. **What "native" means.** Recommended: the same app in its own window, with
   the bar widget, the key, notifications and the live Omarchy look. The other
   way, a Qt app like Omarchy's own, means a second UI to keep in step with
   the phone forever.
2. **Where the desktop window loads from in phase 2.** Recommended: the
   desktop's own amarchy, which passes the server's chats through. Its own
   chats stay fast and work with no internet. The other way, always from the
   server, is less work, but a desktop chat's terminal goes desktop → server →
   desktop, and nothing works when the server is out of reach.

## Risks

- **A sleeping desktop.** Chats there stop while it sleeps. Phase 3 is the
  answer, not keeping the desktop awake.
- **Passing streams through Python's stdlib server** (SSE and WebSockets, both
  ways) needs care with threads and with connections that hang; it gets its own
  tests first.
- **Two copies of the board's state** (main and the desktop's copy): the main
  machine always wins, and the desktop writes through to it.
