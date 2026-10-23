# The amarchy guide

Everything amarchy does, in detail. New here? The [README](../README.md) is the
two-minute version.

## Quick start

You need:

- **Omarchy 4** (tested on 4.0.4 with Qt 6.12): amarchy uses its Lua Hyprland config, the
  Omarchy shell (for the bar and the session list) and the Omarchy menu.
- **[Claude Code](https://docs.claude.com/en/docs/claude-code)**, installed and
  logged in (`claude` on your `PATH`).
- One of foot, kitty, alacritty or ghostty (Omarchy ships one).
- Optional: [`gh`](https://cli.github.com), logged in, to start sessions on
  your GitHub repos from the menu.

```sh
git clone https://github.com/ja-818/amarchy ~/.local/share/amarchy && ~/.local/share/amarchy/install.sh
```

Then press `Super+Alt+N`. amarchy offers every git repo in `~/Work` (set
`AMARCHY_WORK` to use another folder, see [Configure](#configure)), and **New
project** clones one of yours or starts an empty one. Update with `git pull`
in that folder and `install.sh` again; remove with `install.sh --uninstall`.

## Why not herdr, or tmux?

I'm a big [herdr](https://herdr.dev) fan, and if you live in one terminal it's
the thing to use. But on Omarchy the window manager already is a multiplexer:
workspaces, tiling, `Super+arrows`, a bar, a menu, themes. Running a
multiplexer inside it felt like one too many. So amarchy puts the agent
manager in the desktop itself: each session is a Hyprland workspace with
normal windows, the bar tells you who needs you, and the keys, menu and look
are Omarchy's. Same idea, a different home for it.

## How it works

Every session is its own git worktree and branch off the latest `main`, on its
own Hyprland workspace: Claude Code in a centered column, your sessions in the
gap to its left and the session's terminal (it opens in the worktree) in the
gap to its right:

```
 [Ⓐ Amarchy Menu] [󰐕 New…]  │                     │
 [󰍉 Search sessions] [󰉋] [󰉹] │                     │ $ npm run dev
                             │                     │
 󰂞  Login: redirect loop   4m│       claude        │
    my-app · wobbly-bakunin  │    (column, 900)    │
 ⠋  Billing: CSV export  12m │                     │
    my-app · smug-goldman    │                     │
 󰄬  README: tidy up       1h │                     │
    docs · sleepy-kropotkin  │                     │
```

Each row says what the session is about in a few words, keyword first, so you
find the one you want by the word in bold: Claude Code's title for the
conversation ("Fix login redirect loop after OAuth callback") cut down by
Haiku to **Login:** redirect loop. It happens once per title, in the
background, through your own `claude` login; until it's done, and with
`AMARCHY_SHORT_NAMES=off`, Claude's title shows as it is. A name you give the
session yourself (`Ctrl+Alt+E`) always wins, and the search still finds a
session by any word of Claude's whole title.

The list is drawn by the Omarchy shell (a shell plugin) with the same type,
rows and selection as the Omarchy menu, in the order you opened them, so a
session keeps its place. Click one to jump to it. When there are more than fit,
the list scrolls under the buttons and search, which stay put, a few rows per
wheel notch, and it follows the cursor: moving to a session that's off screen
brings it into view.

Above it there is only what you reach for: **Ⓐ Amarchy Menu** (everything
amarchy does, each with its key), **New session** and a **search**, which
reads `Ctrl+Alt+S`: the key that does the same as clicking it. Type a few
letters of a session's name (what it's about, its project or its branch): the
list narrows as you type, `↑`/`↓` move, `↵` jumps there, `Esc` brings the whole
list back. On a session that's the list beside Claude (moving the pointer onto
Claude or the terminal hands them the keyboard back, as after a click); in zen
mode and outside amarchy, the list under the Ⓐ.

**Zen mode** (`Ctrl+Alt+Z`) leaves Claude alone in the column. Claude doesn't
move: the panels beside it just step away, for every session, until you press
it again or ask for the terminal (`Ctrl+Alt+Return`, or running something in
it). Your sessions are still under the **Ⓐ in the bar**, which lights up when
one needs you, and the list drops from it for a moment when you move between
sessions:

```
                                              Ⓐ
              ┌─────────────────────┐   ┌──────────────────────────────┐
              │                     │   │ 󰂞  Fix the login redirect 4m │
              │       claude        │   │    my-app · wobbly-bakunin   │
              │  (zen column, 900)  │   │ ⠋  Billing export        12m │
              │                     │   │    my-app · smug-goldman     │
              │                     │   │ 󰄬  Tidy the README        1h │
              │                     │   │    docs · sleepy-kropotkin   │
              └─────────────────────┘   └──────────────────────────────┘
```

On a monitor too narrow for anything beside the column, amarchy is always in
zen mode, without a terminal.

Start everything at once, then say what matters: every session has a
**priority**, High, Normal (what a new one gets) or Low. `Ctrl+Alt+Up` /
`Ctrl+Alt+Down` raise and lower the one you're in; in the list under the Ⓐ,
`+` / `-` do it to the one under the cursor. The list puts higher priority
first, unless you sort it by date (and `Ctrl+Alt+J/K` walk it in its order). Under a session's
time sits its priority: a flag (󰈻) for high, an arrow down (󰁅) for low, which
is also dimmed. Every one of them
still notifies you. From a script: `amarchy priority high|normal|low|up|down
[--id <id>]`.

Next to the search, the 󰒼 button opens how the list is grouped and sorted.
**Group by** puts sessions in sections: **by project** (󰉋, one section per
project, each row showing just its branch), **by priority** (󰈻, High, Normal,
Low) and **by status** (󰉹, by what they need from you: Needs you, Working,
Done (finished, not opened yet), Idle), or **Not grouped**. Use any of them; together they nest in the order
you turn them on, each one inside the ones already on, and the menu numbers
them (1 outermost) in place of the check. Turn on priority and then project
for High, Normal and Low with each one's projects inside; project and then
priority for the priorities inside each project. Nested, the outermost
sections are set apart by a rule across the list with their name in the
middle. To change the nesting, turn one off and on again: it goes innermost. **Sort by**
orders the sessions inside each section (or the whole list, ungrouped): by
**priority** (the default: higher first, then the order you opened them in),
**newest first** or **oldest first**. Grouped by project and sorted by
priority, each project's sessions show the ones that matter most on top. The
menu stays open to set several; a click off it closes it. In the list under
the Ⓐ, `g` opens it (`j`/`k`, `↵` to switch, `Esc` to close), `p`, `f` and
`s` switch a grouping directly and `o` goes to the next sort; from a script,
`amarchy group project|priority|status|none`, `amarchy group priority project`
(all of them at once, outermost first) and `amarchy sort
priority|newest|oldest`. The choices stick.

Your projects come in the order you choose, not alphabetically: in the list
grouped by project, and in the picker of a new session. Point at a project's
header and arrows show on its right, to move it up or down past the project
next to it; **Order projects…** at the bottom of the group & sort menu puts
them in order one at a time in the Omarchy menu (up, down, to the top or
bottom, or right before another one). A project you haven't placed comes
after the ones you have, by name, so one you add shows up last until you
move it. From a script, `amarchy projects order` prints the order and
`amarchy projects order amarchy jaken` puts these first; `amarchy projects
move <project> up|down|top|bottom` and `move <project> before|after <other>`
move one.

## Keys

| Key | |
| --- | --- |
| `Super+Alt+A` | Open amarchy: back to your last session. Starts a new one if there are none. |
| `Super+Alt+N` | New session: pick a project, that's it. Creates a worktree on a fresh branch named after a famous anarchist with a silly adjective (`wobbly-bakunin`, `caffeinated-goldman`), Claude and a terminal. |
| `Ctrl+Alt+J` / `K` | Inside amarchy: the session below / above in the list, wrapping around. |
| `Ctrl+Alt+S` | Search, the same as clicking the search: on a session, the list beside Claude; in zen mode, the list drops from the Ⓐ. Type to find a session by name, `↵` jumps to it, `Esc` leaves the search. Under the Ⓐ, `Esc` goes to the list itself: `j`/`k` and `↵` to jump, `/` to search again, `+` / `-` to raise / lower a session's priority, `g` for the group & sort menu, `p` / `f` / `s` to switch grouping by project / priority / status, `o` for the next sort (priority, newest, oldest), `Esc` to dismiss. |
| `Ctrl+Alt+Z` | Zen mode: Claude alone, without the sessions and the terminal beside it. Again brings them back. |
| `Ctrl+Alt+Return` | Move the keyboard between Claude and the terminal. In zen mode it leaves zen mode, since the terminal lives beside Claude. |
| `Ctrl+Alt+R` | Run the project in that terminal (`bin/dev`, `npm run dev`, `cargo run`... guessed from the repo; it asks when it can't tell). Again restarts it. Change it with `amarchy run --set`. |
| `Ctrl+Alt+C` | The project's other saved commands: pick one to run in that terminal, or save a new one. |
| `Ctrl+Alt+N` / `P` | New session / new project. |
| `Ctrl+Alt+T` | Pick the theme amarchy wears (see [Theme](#theme)). |
| `Ctrl+Alt+Up` / `Down` | Raise / lower this session's priority (High, Normal, Low): higher ones come first in the list. |
| `Ctrl+Alt+E` | Name this session yourself. The name sits in the list (and in zen mode in the strip above Claude), in place of the short one made from Claude's title. |
| `Ctrl+Alt+M` | The amarchy menu, in a card like the Omarchy menu's: New session and New project on top; the rest in **Run** (the project, a command, the terminal), **This session** (rename, priority, sleep, close), **Sessions** (next, previous, zen mode, sleep the idle ones, close one) and **Settings** (theme, sound, keys). A group has a chevron: `→` or `↵` opens it, `←` goes back (never out of amarchy). The selected row shows its key; typing searches all of it. What only makes sense on a session shows only there. The one to remember. |
| `Ctrl+Alt+X` | Close this session. Asks first: it removes the worktree (and says so when uncommitted changes would be lost). |
| `Super+arrows` | Between Claude and the terminal, like any Omarchy windows. |
| `Super+Space` | **Amarchy** is in the Omarchy menu too: the same rows as `Ctrl+Alt+M`. |

The **Ⓐ in the bar** lights up when a session needs you; click it for your
sessions, right click for a new one.

New session opens the Omarchy menu. The project list ends with **New
project** (also `Ctrl+Alt+P`): pick one of your GitHub repos (searchable, most recently pushed
first), paste a git URL, or start an empty project (optionally with a private
GitHub repo), and the session starts right on it.

A new session shows up at once: its row spins in the list, and you land on
its workspace with Claude's window already in the column. That window sets the
session up in front of you (fetching the latest of the base branch, only that
one, and making the worktree), then becomes Claude, and the terminal slides in
beside it. If it can't (say, a bad base branch), it says why there and the
session goes away; without the network it starts from what was fetched last.

Closing a session (`Ctrl+Alt+X`) asks first if it has uncommitted changes,
then takes you straight to the next session in the list, and its row goes.
The rest happens out of sight: its Claude Code exits as if you'd quit it, its
background sessions stop, its windows close, anything still running from the
worktree is stopped (a dev server Claude started in the background, say), the
worktree is removed and the branch deleted if it was merged. A notification
says when it's done (or, if the worktree changed meanwhile, why it couldn't,
and the session is back in the list).

Windows are disposable, like everywhere else in Omarchy. Close Claude or the
terminal with `Super+W` (or let Claude exit) and the session just goes to sleep
(below): jumping to it reopens what's missing. A session only really ends with
`Ctrl+Alt+X` or `amarchy close`, which also removes the worktree.

## Sleep

Every Claude Code holds a few hundred MB of memory, also while it waits for
you. So a session you're not using **sleeps**: once it has been idle and off
screen for a minute, its Claude exits and lets go of all of it, and everything
else stays exactly as it was. Its workspace, its place in the list (idle, like
before: the list's glyphs keep saying what the session is doing), and its
window: Claude's own last screen stays up, the conversation, the prompt and the
cursor in it. Only a quiet badge in the window's top right corner says it's
asleep, `󰒲 Asleep, its memory freed · type to wake`.

That's a desktop's own sessions. A host's (see [Remote sessions](#remote-sessions))
stay up: their Claude keeps running in tmux there, and only exits when you quit
it (or the host reboots), to start again when you or `amarchy send` come back.

Go there and type as you would: what you type shows in the prompt, where
Claude would show it. Press **Enter** and Claude comes back with your message
already sent (`claude --resume`, the same conversation); its screen takes over
from the old one in a single repaint, about a second later. Anything else
(arrows, Ctrl keys, Shift+Enter, the wheel, a line longer than the box)
brings Claude back at once, with what you typed already in its prompt. The
moment it starts waking, the badge turns to `󰒲 Waking Claude…` until Claude's
screen is back. A scroll wakes it without reaching Claude: the rest of the
scroll is dropped rather than landing in Claude's prompt (where the wheel would
page through your earlier prompts); scroll again once Claude is up. Moving
through your sessions doesn't wake them; only typing (or scrolling) does. A half-written
prompt survives too: before Claude exits, amarchy asks it for its prompt
(Claude's Ctrl+G, "edit in your editor", answered by `bin/amarchy-editor`), and
it's back in the prompt when Claude is.

A window you closed comes back asleep the same way, with the conversation and
a prompt amarchy draws like Claude's, since there's no screen of Claude's left
to keep.

A session never sleeps while something would be lost with its Claude:

- it's working, or it's asking you something (a permission, a question);
- a command Claude started is still running in the background (a dev server,
  a build);
- background agents are still at it (its conversation is still moving, or
  Claude is busy);
- a `/loop` or a scheduled task is due to wake it;
- Remote Control is on;
- you're looking at it.

Claude Code **background sessions** (`/bg`) started from a session show as
`+1 BG` in its row. When the session sleeps, those with nothing left to do are
stopped as well (Claude Code keeps their conversations: `claude attach <id>`
brings one back); close stops them all, since their worktree goes away. Running
ones are left alone. So is anything else running from a sleeping session's
worktree (a dev server you may still want): only close stops it.

```sh
amarchy sleep              # this session, now (it says why not, if something would be lost)
amarchy sleep --all        # every session that can, except the one on screen
amarchy sleep --after 5    # minutes before an idle session sleeps on its own (default 1, or off)
amarchy wake [id]          # without typing in it
```

`amarchy list` says which ones sleep (`sleeping`). **Sleep session** and
**Sleep idle sessions** is under Sessions in the amarchy menu (`Ctrl+Alt+M`). The timer is a
systemd user timer that `install.sh` adds (`amarchy-sleep.timer`); it checks
every 30 seconds and runs nothing in between. Windows from before amarchy
could do this can't hand their prompt over: `amarchy sleep --force` sleeps them
anyway (closing the window, which opens again asleep), so anything typed and
not sent there is lost.

### On a host

A host's sessions (in tmux, reached from [your phone](#your-phone) and [a
browser](#in-a-browser-on-your-computer)) sleep the same way, by the same rules.
Off screen there means open on no phone or browser: a session sleeps once it
has been idle for `amarchy sleep --after` minutes counted from when it was last
open on one, and never while its conversation is open on a phone or its
terminal in a browser. Its tmux keeps Claude's last screen, with the badge;
typing in its terminal in a browser wakes it as on a desktop, and so does
sending it something from the phone (it's Claude's first message when it comes
back, and what was typed in its prompt before it slept is put back after) or
`amarchy send`. The app marks a sleeping session with `󰒲` in the list (it
pulses while it wakes), says so above where you type, and has **Wake** / **Put
to sleep** in the session's menu; **Settings → Sleep** sets the minutes (or
Never) and puts the idle ones to sleep at once. After a reboot a session comes
back asleep: opening it doesn't start its Claude, sending it something does.
`./install.sh --host` adds the same timer.

You get a notification when a session you're not looking at needs input or
finishes its turn (via Claude Code hooks, nothing to configure). It reads like
the session's row in the list: a bell or a check, what the session is about,
and project · branch under it. Click it to go to that session. It comes with a
chime, the same one either way; pick it in [Sound](#sound). The bell only rings
when Claude is actually blocked on you (a permission, a question): the reminder
Claude Code sends a minute after a turn you haven't answered doesn't count, so
a finished session never chimes twice.

A session that finished while you were somewhere else keeps saying so: its
check is filled and in the theme's accent (󰗠) until you open it, on the
desktop or on your phone, and goes back to the plain, dimmed one (󰄬) after.
So with many sessions done you can tell the ones you haven't looked at yet
from the ones you've read and are leaving for later. One that finishes while
it's on your screen is never marked.

In zen mode, with the list out of the way, a bar as wide as Claude's
column, divided from it by a line, says which session this is: the status glyph (the
bell in the theme's accent) and what it's about. Hover it for project · branch,
click it to rename the session.

## Claude knows it's in amarchy

Each session's Claude starts knowing where it is: which session, worktree and
branch it's on, where the project's main checkout is, and that the terminal on
its right runs the project. amarchy's `SessionStart` hook tells it, and does
so again after a `/clear` or a compaction. The **amarchy skill**
(`skill/SKILL.md`, which `install.sh` links into `~/.claude/skills`) has the
rest, loaded only when the work calls for it:

- what it can do with the CLI: restart the dev server with `amarchy run`, see
  the other sessions;
- what it leaves to you: anything that moves your screen, and closing its own
  session;
- how to merge back into main;
- how to talk to the other sessions: they are Claude Code instances too, so
  Claude can message them with Claude Code's `ListAgents` and `SendMessage`
  (`amarchy list` gives each session's `agent` name for that), and start a new
  session with a task of its own (`amarchy new <project> --no-jump --prompt "..."`,
  which starts it out of sight, so your screen stays where it is).

Claude and the terminal also carry the session in their environment:
`AMARCHY=1`, `AMARCHY_SESSION` (its id) and the variables run commands get
(below). So scripts can tell too, and from there `amarchy run`, `rename` and
`close` act on that session, even when another one is on screen.

## Theme

amarchy can wear its own Omarchy theme. Step into a session and the bar,
menus, notifications, wallpaper and window borders change with it; step out and
your desktop is back, in the time it takes to switch workspace. Claude and the
session terminal stay in the amarchy theme.

```sh
amarchy theme              # pick one: Ctrl+Alt+T, Settings → Theme in the amarchy menu (Ctrl+Alt+M), or Super+Space → Amarchy → Theme
amarchy theme "Tokyo Night"
amarchy theme system       # back to looking like the rest of the desktop
```

The picker is Omarchy's own theme switcher, previews and all; it just sets
amarchy's theme instead of your desktop's. **System** comes first: no theme of
its own, amarchy follows your desktop.

Any theme from `omarchy theme list` works. Your Omarchy theme is never
switched: amarchy paints over it and paints it back, so nothing is rewritten or
reloaded. Switch your desktop's theme, restart the shell or reload Hyprland
while you're in a session and amarchy puts its own back on. Claude windows that
are already open take the new colors as they are.

If a piece of the desktop ever stays in the wrong theme, every repaint and how
each step of it went (shell, wallpaper, borders) is in
`~/.local/state/amarchy/theme.log`.

## Sound

Pick the chime by ear: **Settings → Sound** in the amarchy menu (`Ctrl+Alt+M`), or
Super+Space → Amarchy → Sound, opens the sounds in the middle of the screen,
like the Omarchy menu. Each
one plays as the cursor lands on it, with the arrows (or `j`/`k`, or the
pointer), cutting off the one before, so you hear them as you go down the
list. `Enter` or a click sets it, `Esc` leaves it as it was. **Off** for none.

```sh
amarchy sound              # the picker
amarchy sound tine         # set one: kalimba (the default), vibraphone, tine, fairy, ocean, elementary, herald
amarchy sound --play fairy # hear one
amarchy sound off
```

Any sound of your own works: put a `.wav`, `.ogg`, `.oga`, `.opus`, `.flac` or
`.mp3` in `~/.config/amarchy/sounds/` and it shows up in the menu under its file
name (**Add your own** at the bottom of the list, or `amarchy sound --add`, opens that folder). One named like one of
amarchy's replaces it. Keep it short: it plays in full with every notification.

In the app (the phone's or the browser's **Settings → Sound**, or **Settings
→ Sound…** in its amarchy menu) the same list plays each sound as you tap it,
or as the keys land on it, and sets it on the host, for the sessions or your
assistant; **Add your own…** there uploads a file from the phone or the
computer into `~/.config/amarchy/sounds/`. A browser plays the chime while
the app is open; the Ogg ones are made WAV for it once (Safari plays no Ogg).
A phone's notifications ring with the phone's own sound.

`sounds/CREDITS` says where amarchy's come from; `sounds/make.py` makes its own
ones again.

## Remote sessions

Your sessions can live on another machine: a server that's always on, a box at
home. Close your laptop and their Claude Code goes on working; open it, or
another desktop, and they're all there. Nothing else changes: the same list,
keys, notifications and windows. Claude and the terminal on the right are views
of the session on that machine, so its worktrees, builds and dev servers are
all there.

On the machine (Linux with `python3`, `git`, `tmux` and Claude Code, logged in):

```sh
git clone https://github.com/ja-818/amarchy ~/.local/share/amarchy && ~/.local/share/amarchy/install.sh --host
```

On your desktop, once `ssh <host>` gets in without a password:

```sh
amarchy remote <host>      # new sessions start there, e.g. amarchy remote homebox
amarchy remote --status    # whether it answers
amarchy remote off         # new sessions start here again; the host's leave the list, running there
```

From then on, `Super+Alt+N` starts the session on the host, from the host's
projects (**New project** clones there). Sessions already on your desktop keep
working as they did. On the host, each session's Claude and terminal run in
tmux (a tmux of amarchy's own, `tmux -L amarchy`, set up to stay out of sight:
no status bar, no prefix key, the mouse wheel scrolls back), and each window on
your desktop is a terminal attached to it over ssh. A dropped connection (a
laptop that slept, a host that rebooted) reconnects by itself; after a reboot
the session's Claude picks its conversation back up, asleep until you send it
something. Sessions on a host sleep too (see below).

To see what a session serves: on a host with [Tailscale](https://tailscale.com),
each session's Claude is told to listen on the host's Tailscale address and
give you `http://<its tailscale name>:<port>`, so only your own devices reach
it. Without Tailscale it serves on localhost only, and you forward the port
(`ssh -L 3000:localhost:3000 <host>`). Set `NAME=` and `BIND=` in
`~/.config/amarchy/host` on the host to change either.

The host keeps amarchy up to date by itself: every 5 minutes a timer
(`amarchy-update.timer`, from `install.sh --host`) runs `amarchy update`,
which pulls what was shipped to GitHub into the checkout it runs from (only
when it's on main with nothing uncommitted) and installs it, and your
desktops then update themselves to the host's version. Open app pages offer
to load the new one (one you're not looking at just does). `AUTO_UPDATE=off`
in `~/.config/amarchy/host` stops it; `amarchy update` does it now. amarchy opens no port
of its own and everything goes through ssh (the phone app, once you turn it on,
listens on localhost only, behind Tailscale): **keep the host's ssh on a private
network too**, not the internet. Your desktop keeps one ssh connection open to
it (`amarchy remote --sync`, started by the shell plugin) for the list and the
notifications, and sends the phone app your look over it.

**Pasting an image works as it does locally**: copy one on your desktop (a
screenshot, say) and press `Ctrl+V` in a remote session's Claude. Claude Code
reads a pasted image with `wl-paste` where it runs, and the host has no
clipboard, so there amarchy has a `wl-paste` of its own (`install.sh --host`
links it into `~/.local/bin`, unless the host has a real one): it asks your desktop's clipboard through a socket that `amarchy
remote --sync` forwards over its ssh connection, and your desktop answers with
your `wl-paste` (only listing and printing what's copied, nothing else). With
more than one desktop connected, the paste comes from the one you pressed it
on. While your desktop is connected, whatever runs on the host as you can read
your clipboard this way.

Your desktop keeps up with the host: when the host runs a newer amarchy (one
shipped to `origin`'s main), the desktop pulls its own checkout, runs its
`install.sh`, restarts the shell and tells you. It does that only when amarchy
runs from a checkout of `main` with nothing uncommitted, never over work in
progress or from a session's worktree.

The host needs tmux 3.5 or newer, and a login shell that speaks sh (bash,
zsh). `amarchy remote off` takes the host's sessions off your list (they keep
running there; `amarchy remote <host>` again brings them back).

## Your phone

A host can put its sessions on your phone too: `amarchy app` is a web app you
add to the home screen, made for an iPhone (any phone with a current browser
works). It shows the list as amarchy does beside Claude (what each session
is about, project · branch, needs you / working / idle, priority and groups),
with the same search, and the same group & sort menu: it's one setting with
your desktop's, so the phone's list is grouped and sorted as the desktop's,
and changing it on either changes both. The order of your projects too: tap
a project's header (or **Order projects…** in that menu) for all of them,
each with arrows; hold an arrow to send it to the top or bottom. Hold a session down to set its
priority or close it (from its ••• menu too): it asks first, as the
desktop does, and says if uncommitted work would go with it. The same menu
renames it, runs its project or one of its saved commands in its terminal
(**Run…**: run, change or forget each, save a new one, set the run command:
`amarchy run --set/--save/--forget`), and makes it your assistant. **Paste an
image into Claude…** there, the picture button by the box, or an image pasted
into the box sends one from the phone's photos to Claude's prompt, as
`Ctrl+V` would (it shows as `[Image #1]`, for what you send next).
**Settings** picks the chimes, sets up your assistant, adds a **new
project** (one of your GitHub repos, any git URL, or an empty one, with a
private GitHub repo if you like) and orders them; the project picker under
the list has **New project…** too. In a
session, its conversation, a box to send it messages, and Claude's questions
and permission prompts as buttons. The mic button by the box dictates
(see [Dictation](#dictation)): hold it while you speak, or tap it and tap
again when you're done, and the words come into the box as you talk, to edit
and send. The phone asks whether Amarchy may use the microphone the first
time you dictate after opening the app; after that the app keeps the
microphone, turned off between dictations, so it doesn't ask again while
it's open. What iOS kills meanwhile (a call, Siri, the app in the
background) is made anew when you next hold the mic, and a microphone that
gives only silence once held is opened afresh on the spot; the host logs
each dictation (`journalctl --user -u amarchy-app`). The bar under the list starts a new
session: say what its Claude should do (tap the project on its left for
another of the host's projects), typed or dictated with its mic. (Dictated
with Claude's voice mode, the session starts while you speak, opens when you
let go, and what you said goes to its Claude's dictation once Claude is up,
the words coming into its box to send.) When a session needs you (or is done, with `amarchy alerts
all`), the phone gets a notification, at the same moments as the desktop's
chime (not for the one you're looking at on the phone); your assistant's
always (see [Your assistant](#your-assistant)). Since it reads the sessions on the host, it
doesn't matter which Anthropic account each one's Claude Code uses.

It needs [Tailscale](https://tailscale.com) on the host and on the phone, with
HTTPS certificates turned on for your tailnet (in the Tailscale admin console:
DNS → HTTPS Certificates). On the host:

```sh
amarchy app on        # prints its address, https://<host>.<tailnet>.ts.net
amarchy app --status  # whether it's on, and how many phones it notifies
amarchy app --test    # a test notification to each phone
amarchy app off
```

On the phone, open that address in Safari, then Share → **Add to Home
Screen**, and open amarchy from the home screen: its settings (the gear) turn
on notifications (iOS 16.4 or newer; iPhones only notify home screen apps).

Its look is picked in the app itself (Settings → **Theme, font, wallpaper…**,
or `Ctrl+Alt+T` in a computer's browser), and every phone and browser of
yours wears it at once:

- **Theme**: Omarchy's 23 themes (Tokyo Night, Catppuccin, Gruvbox, Nord,
  Rosé Pine, Hackerman...), each a card in its own colors with its wallpaper.
  A theme colors the app as the Omarchy shell colors its menus, the terminals
  (Claude's and the session's) with its 16 terminal colors, and Claude Code
  itself in the sessions started after it (its own theme, `custom:amarchy`).
- **Font**: JetBrains Mono (Omarchy's), Caskaydia Mono or Fira Code, the Nerd
  Font builds with the icons the session list uses, or System (the device's
  own monospace, SF Mono on Apple's).
- **Wallpaper**: one of Omarchy's own for the theme, every one Omarchy ships
  with it (a little picture of each to pick from; a theme remembers which),
  your own (choose a picture: it's cut to a phone's screen and a computer's,
  in the browser), or none. The app is a window over it with the gaps around
  it and a see-through background.

  Omarchy's wallpapers aren't amarchy's to hand out, so the host fetches them
  from Omarchy's own repository on GitHub (`basecamp/omarchy`, at the commit
  `themes/backgrounds.json` names, each checked against its hash) and keeps
  them in `~/.local/state/amarchy/wallpapers`, with a phone's cut and a
  thumbnail of each; a computer's browser gets the original. `install.sh`
  starts that in the background (about 60 MB) and the app does when one is
  missing; the picker shows how far it is, and what couldn't be fetched with
  a button to try again (`amarchy theme --refresh-wallpapers` on the host).
  Once they're there it needs no internet. Until one is, its theme wears a
  wallpaper drawn for it.

On the host, `amarchy theme` does the same (`amarchy theme nord --font "fira
code" --wallpaper ~/beach.jpg`, `amarchy theme retro-82 --wallpaper "zen
boat"`, `--list` for the names and how far Omarchy's wallpapers are). The host keeps what's
picked in `~/.local/state/amarchy/app/theme`, the themes and fonts are
amarchy's (`themes/`, `fonts/`, with their credits). Until something is
picked, the app wears the look an Omarchy desktop last sent it (`amarchy
remote`), which stays in the list as a theme of its own, marked "your
desktop's"; with no desktop ever, Tokyo Night.

How it stays yours: the app listens on the host's localhost only, and
`tailscale serve` puts it on your tailnet over HTTPS, never on the internet
(it's not Funnel). Tailscale tells it who each request comes from, and it
answers only the Tailscale account that owns the host (to let in others, list
their logins as `APP_USERS=` in `~/.config/amarchy/host`). It only takes
changes from its own pages, so a website open on your phone can't drive your
sessions. A process on the host itself could talk to it as you, but anything
running as you there can drive the sessions anyway.

It runs as a systemd user service (`amarchy-app.service`), so it's back after
a reboot, and it restarts itself when amarchy is updated. What you send goes
to the session's Claude as if typed into it (pasted, then Enter), and the
answer to a question is the key you'd press. **Claude's screen** in a
session's menu shows its screen as text, with arrow, Enter and Esc keys, for
anything the buttons don't cover. The app is plain HTML and JavaScript
(`app/`), served by amarchy itself: nothing to build or install, and
notifications are signed and encrypted with `openssl`. `APP_PORT=` (on
localhost, default 7397) and `APP_HTTPS=` (443, 8443 or 10000) in
`~/.config/amarchy/host` change its ports.

## In a browser on your computer

The same app (`amarchy app`, same address) on a computer's wide screen is
amarchy as your desktop lays it out, so a Mac or any other computer with
Tailscale and a browser can use the host's sessions without Omarchy: your
sessions on the left, the session's Claude in the 900px column in the middle
and its terminal on the right, each a see-through panel from the top of the
window to the bottom with no bar and no borders, zen mode with the strip with
the session's name (and an Ⓐ in the corner for your sessions, lit when one
needs you), all over your whole wallpaper in your theme and font. Claude and the terminal are the real thing: terminals
(xterm.js) attached to the session's tmux on the host as your desktop's
windows are, so the desktop, the phone and the browser show the same session
at once (a session's window takes the size of whichever of them showed it or
typed in it last, as with two desktops). Typing, the mouse wheel (tmux's scrollback), selecting (it copies to
your clipboard, as tmux does there), resizing and the Nerd Font icons work as
in your desktop's terminal; links open in a new tab.

It picks the layout by the window: a wide one with a mouse gets this, a
phone the list and conversation. Settings (in the amarchy menu) can fix it to either, change the terminals' font size (they
start at your desktop terminal's), and turn on WebGL drawing (faster; the DOM
is the default, since a headless test drew WebGL's text too big at 2x). On
the phone, a session's ••• menu shows **Claude's terminal**, the real one, on
the app's glass like the conversation, with keys under it: **A−**/**A+** for
the text size (Claude's screen as text too), and **Hold to talk**, which holds
Claude's key for you while the phone's microphone is Claude's `rec`, so the
words come up in its prompt as on your desktop.

The keys are amarchy's, `Ctrl+Alt+…`, which a browser lets a page have:

| Key | |
| --- | --- |
| `Ctrl+Alt+J` / `K` | The session below / above in the list. |
| `Ctrl+Alt+S` | Search the list (in zen mode, under the Ⓐ). |
| `Ctrl+Alt+A` | Your sessions under the Ⓐ (`Super+Alt+A` on Omarchy): `j`/`k`, `↵`, `/`, `+`/`-`, `g`, `p`/`f`/`s`, `o`, `Esc`, as there. |
| `Ctrl+Alt+Z` | Zen mode (this browser's own). |
| `Ctrl+Alt+Return` | Move the keyboard between Claude and the terminal. |
| `Ctrl+Alt+←` / `→` | Claude / the terminal (`Super+arrows` on Omarchy, which the browser keeps). |
| `Ctrl+Alt+R` / `C` | Run the project / another saved command in the terminal. |
| `Ctrl+Alt+N` / `P` | New session (`Super+Alt+N` on Omarchy) / new project. |
| `Ctrl+Alt+Up` / `Down` | Raise / lower the session's priority. |
| `Ctrl+Alt+E` / `M` / `X` | Rename / the amarchy menu / close the session. |

Every menu takes the keys, in the browser on your computer and on a phone
or tablet with a keyboard: a session's menu (its ••• or a right click on it),
closing one, settings, the group & sort menu, the order of your projects,
the project for a new session, Claude's questions, and the phone's list
itself. `↑`/`↓` go from line to line (buttons side by side, as High · Normal ·
Low, are one line: `←`/`→` go along it), `Home`/`End` to the ends, `↵` or
`Space` picks, `Tab` stays inside, `Esc` closes and gives the keys back where
they were (on a computer, to Claude or the terminal). One you open with the
keys has its cursor, in the accent, on its first line (or the one that's on)
at once; one you click, once you press an arrow. In Claude's question a
choice's number picks it and `Esc` says no, as in Claude's own; in the order
of your projects `Shift+↵` on an arrow sends the project to the top or
bottom; on a session in the list, the menu key (or `Shift+F10`) opens its
menu, and `↓` from the search goes into the list.

The keyboard follows the pointer between Claude and the terminal, as on
Omarchy. On a Mac, Option is Alt in the terminals (Settings turns that off,
for typing accented letters with it), and `Shift+Enter` is a new line in
Claude's prompt. `Ctrl+Alt+T` picks the theme, the font and the wallpaper.

**Pasting an image** works as on your desktop: `⌘V` (or `Ctrl+V`, once the
browser lets the page read the clipboard) or dropping an image on Claude.
The page hands the image to the host, and Claude's `Ctrl+V` gets it from
amarchy's `wl-paste` there. No desktop is involved: the host keeps what you
last pasted, from any browser or phone, as its clipboard (the **web
clipboard**, `~/.local/state/amarchy/clipboard/web.clip`, yours only), text
you paste or copy in its terminals too, so `wl-paste` in any session (Claude's
own, or yours in the terminal) prints it. A desktop still connected with
`amarchy remote` answers first only for keys pressed on it.

**Dictating** (`/voice`): hold Space in Claude, as on your desktop. While the
page has the keyboard in a session's Claude, that session's `rec` on the host
is the browser's microphone: the page turns it on as soon as Space goes down
(not once the key repeats, half a second later; a space only typed turns it
off again), what's said before Claude listens waits on the host, the host
tells it when Claude starts and stops recording, and the words come up in
Claude's prompt. The browser asks for the microphone the first time, and the
page keeps it, off, for ten minutes after a dictation (or until you leave
the tab), so the next one starts at once. When the page loses the
keyboard (another window, the terminal), `rec` is the host's own again.

**Notifications**: Settings turns them on, as on the phone (in Safari, add the
app to the Dock first: File → Add to Dock; Chrome: Install). While the page is
open it also plays the chime (the one `amarchy sound` picked on the host,
**Settings → Sound** in the app) when a session needs you or is done, unless
it's the one you're looking at. The tab says how many need you, `(2)
Amarchy` (`•` when only finished ones you haven't opened wait), and its icon
gets a dot, red for one that needs you; installed (Add to Dock, Install), the
app's icon carries the count, as the home screen app's does on the phone.

**Links** (in what Claude says, and in the terminals: click one) open in the
default browser, where the device lets a web page get there. In Safari's Dock
app on a Mac they do: a link to another site leaves for the default browser.
On an iPhone or iPad, the Home Screen app opens them in a Safari sheet
whatever the default is, and a page can't ask which browser that is, so
Settings → "Open links in" picks one for that device (Safari, Chrome,
Firefox, Edge or Brave, through the browser's own address, so it has to be
installed); "As iOS does" is the sheet.

How it stays yours is the phone app's: each terminal is a WebSocket on the
app's own server, taken only from the Tailscale login that owns the host
(`APP_USERS=`), at its tailnet address, and only from the app's own pages
(their `Origin`), never through Funnel. The server also checks that a
connection to it on localhost comes from Tailscale (`tailscaled`) or from you,
so another user on the host can't pass for Tailscale. What a terminal gives is
what your desktop's windows give: Claude and a shell on the host, as you.

## Dictation

The mic button by a box in the app (a session's, the new-session bar's) writes
what you say into that box: hold it while you speak, or tap it and tap again
when you're done. The words come up as you talk, and the box is yours to edit
and send. Three things can write them down; the app takes the first one there
is, and **Settings → Dictation** on each phone or browser picks another:

- **On the host** (`amarchy dictation setup`, or **Set up dictation on the
  host** in Settings). A speech-to-text model on the host, NVIDIA's
  [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
  through whisper.cpp's `libparakeet`, writes it down. It knows 25 European
  languages, Spanish and English among them, and tells them apart by itself:
  dictate in either, or start in one and go on in the other after a pause.
  It costs nothing, and the audio never leaves the host. It needs whisper.cpp
  1.9 or newer installed there (Arch: `sudo pacman -S whisper-cpp`) and the
  model (670 MB, fetched into `~/.local/state/amarchy/dictation`). The model
  is loaded (about 1 GB of memory) when a dictation starts, while you speak,
  and let go of ten minutes after the last one. While you talk, each piece
  between your pauses is written down for you to see; what's kept is written
  again from longer stretches with their context, and once you let go the
  text is there in about half a second.
- **This browser's**: the browser's own speech recognition (Web Speech:
  Apple's in Safari, Google's in Chrome), in one language you pick in
  Settings, and sending what you say to Apple or Google. Not in the
  home-screen app on an iPhone, where WebKit's often hears nothing.
- **Claude's voice mode** (`/voice` on): what the phone hears goes to the
  session's Claude Code as if you held its key, and what Claude writes down
  comes into the box. Only for sessions whose Claude runs in its terminal.

Claude's terminal keeps its own dictation either way: **Hold to talk** over
it on the phone, Space held in it in a computer's browser. And the keyboard's
own dictation (its mic key) works in every box too.

How the host did on recordings with known text, on this project's 16-vCPU
server (October 2026): 2.5% of the words wrong in Latin American Spanish
(Google's FLEURS, 15 clips), 8.5% in English read by native Spanish speakers
(the Speech Accent Archive, 13 speakers), writing about 10 seconds of speech
per second. Whisper small did 3.4% and 9.3%, three times slower; Whisper
large-v3-turbo 1.7% and 6.9%, but slower than real time on that CPU (a
10-second dictation would take 15 to write down).

`amarchy dictation log` lists the last dictations from every phone and
browser (which way, the device, how long you spoke, how long it took after
you let go, and what came of it or why nothing did), to see how each way does
on your devices. `amarchy dictation transcribe <file>` writes down a
recording the same way; `amarchy dictation remove` deletes the model.

## Your assistant

One session can be your **assistant**: a Claude that keeps your day rather
than writing code (it briefs you in the morning, reminds you of meetings,
answers on your phone). With thirty coding sessions in the list it would get
lost among them, and so would what it tells you. So it has a place of its own:

```sh
amarchy assistant <id> [--name <name>]   # this session is your assistant (named after its project unless you name it)
amarchy assistant                        # which one it is: id, then name
amarchy assistant off                    # a session like the others again
```

- **In every list** (beside Claude, under the Ⓐ, on the phone, in the
  browser) it comes first, above the groups: bigger, with its picture (an imp
  of a retainer with his staff of two heads, `app/assistant.svg`, or yours), its name,
  and what it's on, its state on a badge at the corner of the picture. The
  other sessions of its project (more sessions for small personal things) sit
  under it there, at their usual size with its picture small, and a rule sets
  them apart from the rest. When it has written something you haven't read
  (a turn it finished since you last opened it, on any device), its card says
  **New** by its name and shows the start of what it wrote, and the sessions
  under it show theirs in place of project · branch. Opening it anywhere (the
  phone, the browser, or having it on screen on the desktop) clears it
  everywhere. Every other session that finished a turn you haven't opened gets
  the same mark, smaller: a dot by its time. In the session itself, the phone and the strip
  above Claude call it by its name, and the phone's box says "Message Jaken".
- **It always tells you** when it needs you or is done, whatever `amarchy
  alerts` lets through of the others: under its name and picture (on the
  desktop it stays until you dismiss it), with what it said as the body (a
  brief's first words), and with a chime of its own, `herald` (a knock of the
  staff and two horn notes; `amarchy sound --assistant <name|off>` picks
  another). What it sends with `amarchy notify` goes under its name too, and a
  tap opens it. On an iPhone a notification always wears the app's icon, so
  there its name is what sets it apart.

Its picture can be yours rather than amarchy's imp:

```sh
amarchy assistant --picture ~/Pictures/jaken.png                  # the middle of it, as big as it goes
amarchy assistant --picture ~/Pictures/jaken.png --crop 400,0,990  # the square at x 400, y 0, 990 pixels across
amarchy assistant --picture off                                   # amarchy's own again
```

It's cut round and square (with ffmpeg, else ImageMagick) and kept in
`~/.config/amarchy` (`assistant.png`, and `assistant-192.png` for the phones'
notifications), not in amarchy. Every list shows it, and the notifications
(the desktop's, and the phone's where it shows a picture, not an iPhone). It
goes by a hash of itself, so a new one shows at once everywhere, the phone's
saved copy of the app included. A desktop showing a host's sessions shows the
host's and keeps a copy; run there, the command sets the host's.

In the app all of it is a session's menu away (its ••• on the phone, a hold
on it in the list, or **This session** in the amarchy menu in the browser):
**Make it my assistant…** with its name, and on your assistant **name,
picture, chime…**: rename it, pick its chime, go back to amarchy's imp, or
**Not my assistant any more**. **Choose…** a picture from the phone's photos
or the computer, drag it into the circle and zoom (the slider, the wheel, two
fingers, or the arrows and `+`/`-`), and the page cuts it there and sends
the host what's in the circle. Settings has your assistant too.

`amarchy alerts` cuts the noise from the rest, on the desktop and the phone
alike (the phone's settings have it too, under "Tell me"):

```sh
amarchy alerts needs-you   # the default: a session tells you only when it asks you something
amarchy alerts all         # when one needs you and when one is done, as before
amarchy alerts assistant   # nothing but your assistant
```

With `needs-you`, a session that asks a question or a permission notifies
you; one that's done doesn't, and is marked done in the list (the filled
check) until you open it. A desktop showing a host's sessions goes by the
host's setting, so one `amarchy alerts` sets both.

## From scripts and agents

Two commands do what you'd do from the phone, for a script, a timer or
another session's Claude (an assistant that keeps your day, say):

```sh
amarchy send <id> "<text>"                       # to a session's Claude, as if typed and sent
amarchy notify "<title>" "<body>" [--session <id>] [--urgent]   # to your phones
```

**`amarchy send`** types the text into the session's Claude the way the phone
does (pasted, then Enter), `-` reading it from stdin. It waits until Claude is
free: not in the middle of a turn (Claude Code would hand a message typed then
to the turn under way, between two of its steps), not asking you something
(the text would answer it), and nobody typing in its prompt. What's typed there
and left alone for 15 seconds goes first: Claude hands it over (`Ctrl+G`, as
when a session falls asleep), the message is sent, and it's back in the prompt.
A session whose Claude isn't running (asleep, exited, or after a reboot) starts
again with the message as its first one, as Enter does in an asleep window.
Messages for one session wait their turn, so they arrive one at a time, in the
order sent. It prints `sent to <id>` once Claude has started on it, and fails
(exit 1, saying why) if Claude wasn't free within an hour (`--timeout
<minutes>`) or the session was closed. `--no-wait` returns at once, leaving a
process of its own to deliver it (a transient systemd unit, so it outlives
whatever called it); from the session's own Claude it never waits, since the
turn it would wait for is its own. It needs no desktop, terminal or tmux
client, so a systemd user timer can run it, e.g. a morning check-in:

```ini
# ~/.config/systemd/user/morning-brief.service
[Service]
Type=oneshot
ExecStart=%h/.local/bin/amarchy send jaken-jaken "Morning brief, please."

# ~/.config/systemd/user/morning-brief.timer
[Timer]
OnCalendar=Mon..Fri 07:30
Persistent=true
[Install]
WantedBy=timers.target
```

On a host, the session's Claude runs in tmux. A desktop's own sessions, whose
Claude runs in a window, can only take a message while asleep: amarchy can't
type into a window. For a session on your host, a desktop's `amarchy send`
sends it there.

**`amarchy notify`** sends a notification of your own to every phone (and
browser) the app notifies, through the same Web Push as the app's own ones
(`amarchy app --test`). Each one stays: it doesn't replace the one before it.
With `--session <id>`, tapping it opens that session in the app. It works from
anywhere on the host (a desktop's `amarchy notify` sends it there), and fails
when no phone has turned notifications on. `--urgent` asks for all a web app
may: a push sent at the highest urgency (all of amarchy's are), and on a
computer's browser a notification that stays on screen until you dismiss it.
iOS gives a home screen app nothing more: no Time Sensitive or critical
alerts, so an urgent one looks and sounds like any other, stays silent in
silent mode, and waits out a Focus that holds back the app's notifications.

## Install

See [Quick start](#quick-start) for what it needs. `install.sh` is safe to run
again, and keeps a backup of every file of yours it changes
(`<file>.amarchy-bak.<time>`, the last three). It:

- links `bin/amarchy` into `~/.local/bin`;
- adds one `dofile(...) -- amarchy` line to `~/.config/hypr/hyprland.lua` (the
  keys and Claude's column);
- installs the Omarchy shell plugin (the Ⓐ and the session list) and adds
  Amarchy to the Omarchy menu;
- adds an Omarchy theme hook, the amarchy skill for Claude Code
  (`~/.claude/skills/amarchy`) and the sleep timer (`amarchy-sleep.timer`).

On a machine that keeps sessions for your desktops, `install.sh --host` only
links the command and the skill and adds a timer that keeps it up to date
(see [Remote sessions](#remote-sessions)), and
`amarchy app on` adds the phone app's service (see [Your phone](#your-phone)).

Update with `amarchy update` (or `git pull` and `install.sh` again). `install.sh --uninstall` takes
all of that out again; your worktrees and `~/.local/state/amarchy` are left
alone.

Every install points all of it at the checkout it runs from. While it points
at another session's worktree (that session is trying its changes on your
desktop), `install.sh` and `install.sh --uninstall` say whose it is and ask
before replacing it; with no terminal to ask in (Claude running it, a script)
they change nothing. `--force` goes on without asking. The session's own
worktree, a main checkout and a checkout that's gone are never asked about.
Closing a session whose worktree amarchy runs from puts amarchy back on the
project's main checkout first, so nothing is left pointing at a removed
worktree.

## Configure

**Settings → Keys** in the amarchy menu (`Ctrl+Alt+M`, or `amarchy keys`) picks the two
modifiers: **Inside amarchy**, for every key that works in it (`Ctrl+Alt` by
default), and **From anywhere**, for Open and New session (`Super+Alt`); the
one bound now has a ✓. The keys move as soon as you pick: no restart, and
every hint (the search reads its key) follows. A notification says what the
new keys land on, if anything does (Omarchy's keys, yours, amarchy's other
modifier, or apps that use Ctrl+Shift themselves). From a script: `amarchy keys inside "CTRL + SHIFT"`, `amarchy keys
anywhere MOD3`, `amarchy keys --show`, `amarchy keys reset`.

For the keys themselves, set a table before the `dofile(... amarchy.lua)` line
in `~/.config/hypr/hyprland.lua` (a modifier picked in the menu wins over the
one there, until `amarchy keys reset`):

```lua
amarchy = { mod = "SUPER + ALT", open_key = "A", new_key = "N",
            nav_mod = "CTRL + ALT", next_key = "J", prev_key = "K", search_key = "S", zen_key = "Z", terminal_key = "RETURN", run_key = "R", commands_key = "C",
            nav_new_key = "N", project_key = "P", theme_key = "T", rename_key = "E", close_key = "X", menu_key = "M" }
```

Everything else is environment variables (set them in `~/.config/uwsm/env`):

| Variable | Default | |
| --- | --- | --- |
| `AMARCHY_WORK` | `~/Work` | Every git repo directly inside is offered. |
| `AMARCHY_WORKTREES` | `$AMARCHY_WORK/.worktrees` | Worktrees go to `<this>/<repo>/<name>`. |
| `AMARCHY_TERMINAL` | first installed | `foot`, `kitty`, `alacritty` or `ghostty`. |
| `AMARCHY_ZEN_WIDTH` | `900` | Claude column width in logical pixels; the sessions and the terminal share what's left. Run `amarchy layout` after changing it. |
| `AMARCHY_HEADER_HEIGHT` | `30` | Height of the strip above Claude with the session's name in zen mode, `0` for none. Run `amarchy layout` after changing it. |
| `AMARCHY_CLAUDE_ARGS` | `--permission-mode auto` | Extra arguments for `claude`. Unset, they come from `~/.config/amarchy/claude-args` when it exists (one line, e.g. `--dangerously-skip-permissions`), so every way a session starts gets them. |
| `AMARCHY_SOUND` | `on` | `off` for notifications without the chime, whatever [Sound](#sound) picked. |
| `AMARCHY_SHORT_NAMES` | `on` | `off` to list sessions by Claude Code's titles as they are, not cut down to "Keyword: a few words". |

How long an idle session waits before it sleeps isn't a variable: `amarchy
sleep --after <minutes>|off`, kept with amarchy's state.

## CLI

Every action in the UI is a command, in the Omarchy spirit: anything you can
do with a key, a script or an AI agent can do too. Commands print results to
stdout (JSON with `--json`) and exit non-zero on failure. `amarchy help` lists
them all, and `amarchy <command> --help` (or `-h`, or `amarchy help <command>`)
prints one command's usage without running it; an option a command doesn't
know is an error, so a typo never acts on a session.

```
amarchy help [command]                all the commands, or the usage of one
amarchy projects [--json]             your projects and their session counts
amarchy projects --github [--json]    your GitHub repos (✓ = already added)
amarchy add <owner/repo|git url>      clone a project (prints its path)
amarchy add --new <name> [--github]   start an empty project (and a private GitHub repo)
amarchy add                           start a new project interactively (New project in the menu)

amarchy new [project] [name]          create a session (menu without a project; name like wobbly-bakunin if omitted); prints its id
amarchy new <project> [name] --prompt <text|->  the same, with the first thing its Claude is asked (- reads stdin)
amarchy new <project> [name] --no-jump          the same, out of sight: it shows up in the list, the screen stays put
amarchy list                          sessions as JSON (agent: the name its Claude has for other sessions' SendMessage)
amarchy open                          go to the last session you were in
amarchy next | prev                   go down | up one session in the list (wraps around)
amarchy jump <id>                     go to a session
amarchy close [id] [--force]          close a session (current one if no id)
amarchy close [id] --confirm          the same, asking first in the Omarchy menu
amarchy rename [title]                name the current session (asks in the Omarchy menu if omitted)
amarchy rename --id <id> [title]      the same for another session; --reset goes back to the one made from Claude's title
amarchy zen [on|off]                  toggle zen mode: Claude alone, nothing beside it
amarchy terminal [on|off]             between Claude and the terminal (leaves zen mode)
amarchy run                           run the project in the session's terminal (again: restart it)
amarchy run --show | --set [command]  the project's run command (guessed from the repo until you set one)
amarchy run <name>                    run another saved command of the project, the same way
amarchy run --save <name> [command]   save one; --forget <name> drops it
amarchy run --list                    the project's saved commands
amarchy run --pick                    choose one in the Omarchy menu, or save a new one there
amarchy show                          open the session list under the Ⓐ in the bar
amarchy search                        type to find a session by name, the list beside Claude, or under the Ⓐ
amarchy pick [close]                  choose a session in the Omarchy menu, jump to it (or close it)
amarchy sleep [id] [--force]          put a session to sleep (says why not when something would be lost)
amarchy sleep --all [--force]         every session that can sleep, except the one on screen
amarchy sleep --after [minutes|off]   how long an idle session waits off screen before it sleeps (default 1)
amarchy wake [id]                     wake a session without typing in it
amarchy menu                          everything you can do from here, with its key, in the Omarchy menu
amarchy theme [name|system]           amarchy in its own Omarchy theme (Omarchy's theme switcher without a name; --show prints it)
                                      on a host, the app's look: a theme, --font <name>, --wallpaper theme|<one of Omarchy's>|own|none|<picture>,
                                      --list, --refresh-wallpapers (fetch Omarchy's wallpapers again)
amarchy sound [name|off]              the notification chime (the picker without a name; --show, --list, --play [name], --add;
                                      --assistant [name|off] for your assistant's)
amarchy keys [inside|anywhere <mod>]  the modifiers of amarchy's keys (the picker without one; --show, reset)
amarchy priority [high|normal|low|up|down] [--id <id>]  how much a session matters; higher first in the list
amarchy group [project|priority|status] [on|off]  group the list (switches without on|off); one turned on nests
                                      inside the ones already on
amarchy group <grouping> <grouping>...  group by these, nested in this order, e.g. `group priority project`
amarchy group none                    no grouping (the default)
amarchy sort [priority|newest|oldest] how the list is sorted inside its groups (priority, the default:
                                      higher first, then the order you opened them in)
amarchy projects order [project...]   the order of your projects (prints it, or puts these first)
amarchy projects move <project> up|down|top|bottom | before|after <other>
                                      move one in it (the Omarchy menu without a project)
amarchy layout                        resize Claude's column for the current monitor
amarchy remote <ssh host> | off       start new sessions on another machine (see Remote sessions) / here again
amarchy remote [--status]             where new sessions start / whether that host answers
amarchy app on | off                  on a host: your sessions on your phone and in a browser (see Your phone)
amarchy app [--status] | --test       whether it's on, and where / a test notification to each phone
amarchy notify <title> [body] [--session <id>] [--urgent]  a notification on your phones (see From scripts and agents)
amarchy assistant [<id> [--name <name>] | off]  your assistant: first in every list, always heard (see Your assistant)
amarchy alerts [all|needs-you|assistant]  what the other sessions tell you about (default needs-you)
amarchy send <id> <text|-> [--no-wait] [--timeout <minutes>]  a message to a session's Claude, once it's free
```

The run command is saved per project and starts in the session's worktree. It
can use `$AMARCHY_PATH` (the worktree), `$AMARCHY_NAME`, `$AMARCHY_BRANCH`,
`$AMARCHY_REPO` and `$AMARCHY_ROOT` (the project's main checkout), so one command
fits every session of the project. amarchy's own, to try a worktree as the
installed copy:

```
amarchy run --set '$AMARCHY_PATH/install.sh && omarchy-restart-shell'
```

A project can have more saved commands next to its run command, each with a
name: `Ctrl+Alt+C` lists them (and saves new ones), `amarchy run <name>` runs
one. amarchy's own, to put the installed copy back on the main checkout once a
change is done:

```
amarchy run --save main '$AMARCHY_ROOT/install.sh && omarchy-restart-shell'
```

Trying a worktree while another session's is the installed copy asks first
(see [Install](#install)), so one session doesn't silently take over
another's live build.

Each new worktree is pre-trusted in `~/.claude.json` so Claude starts without
the folder trust prompt, and the entry is removed again on close.

## License

[MIT](../LICENSE). The notification sounds in `sounds/` keep their own licenses,
listed in [`sounds/CREDITS`](../sounds/CREDITS).
