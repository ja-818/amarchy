# Desktop vs web app: parity

amarchy began on an Omarchy (Hyprland) desktop: the `amarchy` CLI, the shell
plugin (`omarchy/plugin/*.qml`: the Ⓐ in the bar, the session list beside
Claude, the strip above it, the amarchy menu, the sound picker) and the keys
in `hypr/amarchy.lua`. It is now a web app: the host (tmux sessions, `amarchy
app serve`) reached from the phone's home-screen app (`app/app.js`, the
phone layout) and from a computer's browser (`app/desk.js`, the wide
layout), both served by the host's `/api` routes (`app_handler` in
`bin/amarchy`). This is what the desktop could do, and where each piece is
in the web app.

**Status**: **done** (both layouts have it), **done (wide)** / **done
(phone)** where only one layout makes sense, **owned** (another session
is building it), **not needed** (it only made sense on a Hyprland desktop,
or the host does it by itself), **CLI** (on the host, from a session's
terminal or Claude; no screen needed).

## Sessions

| Feature | Desktop | Phone | Wide browser | Status |
| --- | --- | --- | --- | --- |
| The list: state, task, project · branch, age, priority, unread dot | SessionList / bar popup | list view | list beside Claude | done |
| Group (project, priority, status, nested) and sort | group & sort menu, `amarchy group`/`sort` | organize menu | organize menu, `g p f s o` under the Ⓐ | done |
| Order of projects | `amarchy projects move` | Order projects… (list menu, project header, Settings) | the same | done |
| Search | `amarchy search`, `Super+…+S` | search box | `Ctrl+Alt+S` | done |
| Next / previous session | `amarchy next`/`prev`, `J`/`K` | the list (no keys needed) | `Ctrl+Alt+J`/`K` | done |
| Open a session | `amarchy jump`, a click | tap | click, `↵` | done |
| Go back to the last session | `amarchy open`, `Super+Alt+A` | the app opens on the list; the browser's back | the page remembers the session it shows | done |
| New session (pick a project, a prompt) | `amarchy new`, `Super+Alt+N` | the bar under the list, typed or dictated | `Ctrl+Alt+N` | done |
| Rename | `amarchy rename`, `E` | ••• → Rename… | `Ctrl+Alt+E`; This session → Rename | done |
| Priority up / down / set | `amarchy priority`, `↑`/`↓` | ••• or hold → High · Normal · Low | `Ctrl+Alt+Up`/`Down`, menu, `+`/`-` under the Ⓐ | done |
| Close, asking first, saying what's lost | `amarchy close --confirm`, `X` | ••• or hold → Close session | `Ctrl+Alt+X`, menu, Close one… | done |
| Close one from a picker | `amarchy pick close` | hold any row → Close | Sessions → Close one… | done |
| Sleep / wake a session, sleep the idle ones, `sleep --after` | `amarchy sleep`/`wake` | — | — | owned (session host-sleep) |
| Zen mode | `amarchy zen`, `Z` | (the phone is always one column) | `Ctrl+Alt+Z` | done (wide) |
| Claude ↔ terminal | `amarchy terminal`, `Return`, `Super+arrows` | ••• → Claude's terminal | `Ctrl+Alt+Return`, `Ctrl+Alt+←`/`→` | done |
| The session's name strip above Claude | SessionHeader | the bar of the session view | the strip in zen mode | done |
| Status glyph lit when one needs you (the Ⓐ) | BarWidget | "N need you" in the list's head; app icon badge | the Ⓐ lit; tab title `(N) Amarchy`, `•` for unread finished ones; a dot on the tab's icon; Dock/installed app badge | done |

## Run

| Feature | Desktop | Phone | Wide browser | Status |
| --- | --- | --- | --- | --- |
| Run the project in its terminal | `amarchy run`, `R` | ••• → Run… → Run the project | `Ctrl+Alt+R` | done |
| Run another saved command | `amarchy run <name>`, `run --pick`, `C` | ••• → Run… | `Ctrl+Alt+C` | done |
| Set the run command | `amarchy run --set` | Run… → Set the run command… / Edit | asked when there's none; Saved commands… | done |
| Save a command | `amarchy run --save` | Run… → Save a new command… | `Ctrl+Alt+C` → Save a new command…; Saved commands… | done |
| Change / forget a command | `amarchy run --save` again / `--forget` | Run… → Edit / Forget | Run → Saved commands… | done |
| List them | `amarchy run --list` | Run… | Saved commands… | done |
| See the terminal's output | the terminal window | ••• → Claude's terminal (Claude's only) | the terminal beside Claude | done (wide); the phone shows Claude's terminal only |

## Projects

| Feature | Desktop | Phone | Wide browser | Status |
| --- | --- | --- | --- | --- |
| Clone one of your GitHub repos | `amarchy add`, `P` | Settings → New project…, project picker → New project…, empty list → Add a project… | `Ctrl+Alt+P` | done |
| Clone any git URL / owner/repo | `amarchy add <url>` | the same sheet, typed | `Ctrl+Alt+P`, typed | done |
| New empty project (with a private GitHub repo) | `amarchy add --new <name> [--github]` | the same sheet | `Ctrl+Alt+P` → Empty project… | done |

## The amarchy menu

| Feature | Desktop | Phone | Wide browser | Status |
| --- | --- | --- | --- | --- |
| The menu (New session, New project, Run, This session, Sessions, Settings) | AmarchyMenu, `M`, Super+Space → Amarchy | the session's ••• menu and Settings hold the same things | `Ctrl+Alt+M`, Ⓐ Amarchy Menu button | done |
| Every menu takes the keys | Quickshell | ↑/↓, ↵, Esc, Tab with a keyboard | the same | done |

## Your assistant

| Feature | Desktop | Phone | Wide browser | Status |
| --- | --- | --- | --- | --- |
| Its card above the groups, picture, name, unread | SessionList | list | list | done |
| Make a session your assistant (with a name) | `amarchy assistant <id> --name` | ••• → Make it my assistant… | This session → Make it your assistant… | done |
| Rename it | `amarchy assistant --name` | its ••• → name, picture, chime…; Settings → Assistant | the same | done |
| Its picture, cropped | `amarchy assistant --picture <file> --crop x,y,size` | Choose… → drag, pinch, slider | Choose… → drag, wheel, slider, arrows, `+`/`-` | done (the page cuts it, the host makes it round) |
| amarchy's picture again | `--picture off` | Amarchy's own | the same | done |
| No assistant | `amarchy assistant off` | Not my assistant any more | the same | done |
| Its chime | `amarchy sound --assistant` | Sound → its tab | the same | done |

## Sound and notifications

| Feature | Desktop | Phone | Wide browser | Status |
| --- | --- | --- | --- | --- |
| Pick the chime, each playing as you go | SoundPicker, `amarchy sound` | Settings → Sound (plays on tap) | Settings → Sound…, menu → Settings → Sound… (plays on tap and as the keys land on it) | done |
| Hear one | `amarchy sound --play` | tap | tap, arrows | done |
| Off | `amarchy sound off` | Off | Off | done |
| Your own sounds | a file in `~/.config/amarchy/sounds` (`--add` opens it) | Add your own… uploads one | the same | done |
| The chime when one needs you / is done | the desktop plays it | the phone's notification sound (iOS picks it) | the page plays the host's pick (Ogg made WAV for Safari) | done |
| What tells you (`all`, `needs-you`, `assistant`) | `amarchy alerts` | Settings → Tell me | the same | done |
| Notifications | mako | Web Push | Web Push (Add to Dock / Install) | done |
| A notification of your own | `amarchy notify` | Web Push | Web Push | CLI |

## Clipboard and voice

| Feature | Desktop | Phone | Wide browser | Status |
| --- | --- | --- | --- | --- |
| Ctrl+V of an image into Claude | the host's `wl-paste` asked the desktop's clipboard over ssh | picture button by the box, ••• → Paste an image into Claude…, or an image pasted into the box | `⌘V`/`Ctrl+V` or a drop on Claude | done: the host keeps it as the web clipboard, no desktop needed |
| `wl-paste` in a session reads the clipboard | the desktop's, while connected | what you last pasted | what you last pasted (images and text) or copied in a terminal | done |
| Dictation (Claude's `/voice`) | the desktop's microphone over PulseAudio | hold the mic | hold Space | done |

## Look and the desktop itself

| Feature | Desktop | Phone | Wide browser | Status |
| --- | --- | --- | --- | --- |
| amarchy's theme, font, wallpaper | `amarchy theme`, `T` | the look a desktop sent | the same | owned (session theme-web) |
| Opening links | the desktop's browser | — | a new tab | owned (session open-links) |
| Host sleep | — | — | — | owned (session host-sleep) |
| The keys' modifiers | `amarchy keys` | — | fixed at `Ctrl+Alt` (the browser lets a page have them) | not needed |
| Windows, workspaces, the zen column's width | `amarchy layout`, Hyprland window rules | — | the page lays itself out | not needed |
| Repaint as you enter/leave | `amarchy watch` | — | — | not needed |
| A desktop showing the host's sessions | `amarchy remote`, `remote --sync` | — | — | not needed (the app is the way in) |
| Updating | `amarchy update`; a desktop followed its host | the host updates itself every 5 minutes; open pages offer to reload | the same | done |

## Keys a browser can't take

Hyprland's `Super` keys never reach a page (the Mac and the browser keep
them), so the wide layout puts everything on `Ctrl+Alt` (Control+Option on a
Mac), which a page gets:

| Desktop | In the browser |
| --- | --- |
| `Super+Alt+A` (open amarchy / your sessions under the Ⓐ) | `Ctrl+Alt+A` |
| `Super+Alt+N` (new session from anywhere) | `Ctrl+Alt+N` |
| `Super+←`/`→` (Claude / the terminal) | `Ctrl+Alt+←`/`→` |
| `Super+Space` → Amarchy (the menu) | `Ctrl+Alt+M` |
| `Super+Alt+…` keys moved by `amarchy keys` | not configurable: always `Ctrl+Alt` |

The rest (`Ctrl+Alt+J/K/S/Z/Return/R/C/N/P/E/M/X/Up/Down`) are the
desktop's own keys, unchanged. `Ctrl+Alt+T` (theme) is theme-web's.

## Still depends on a desktop

Nothing in the web app needs a desktop any more. What reads a desktop's data
only when one is connected, and falls back on its own otherwise: the look
(theme, font, wallpaper: theme-web is replacing it) and the chimes (the
host's own `amarchy sound` setting wins once it's set, from the app or the
CLI; until then the one a desktop sent).
