# The amarchy guide

Everything amarchy does, in detail. New here? The [README](../README.md) is the
two-minute version.

## Quick start

amarchy runs on a Linux machine that's always on (a server, a box at home),
the **host**, and you reach it from your phone and your computer's browser.
On the host you need:

- `python3`, `git` and **tmux 3.5** or newer, with a login shell that speaks
  sh (bash, zsh);
- **[Claude Code](https://docs.claude.com/en/docs/claude-code)**, installed
  and logged in (`claude` on your `PATH`);
- **[Tailscale](https://tailscale.com)**, with HTTPS certificates turned on for
  your tailnet (in the Tailscale admin console: DNS → HTTPS Certificates), and
  Tailscale on your phone and your computer too;
- `openssl` (it signs and encrypts the push notifications);
- optional: [`gh`](https://cli.github.com), logged in, to start sessions on
  your GitHub repos; `ffmpeg` or ImageMagick, for your assistant's picture
  and your own wallpaper; SoX, for Claude's `/voice` (its `rec`).

```sh
git clone https://github.com/ja-818/amarchy ~/.local/share/amarchy && ~/.local/share/amarchy/install.sh
amarchy app on        # prints its address, https://<host>.<tailnet>.ts.net
```

Then open that address:

- **On an iPhone**, in Safari, then Share → **Add to Home Screen**, and open
  amarchy from the home screen. Its settings (the gear) turn on notifications
  (iOS 16.4 or newer; iPhones only notify home-screen apps).
- **On a Mac**, in Safari, then File → **Add to Dock** (in Chrome: Install).
  Its Settings turn on notifications there too.

Start a session from the bar under the list (on a Mac, `Ctrl+Alt+N`).
amarchy offers every git repo in `~/Work` (set `AMARCHY_WORK` for another
folder, see [Configure](#configure)), and **New project…** clones one of
yours or starts an empty one. amarchy updates itself (see
[Install](#install)); `install.sh --uninstall` removes it.

## Why not herdr, or plain tmux?

I'm a big [herdr](https://herdr.dev) fan, and if you live in one terminal on
one machine it's the thing to use. amarchy started as the same idea inside an
Omarchy desktop, then moved to a server so the sessions keep going when the
laptop closes, and to the phone so you can answer them from anywhere. tmux
does the keeping; amarchy is everything around it: worktrees, the list that
knows who needs you, notifications, sleep, and an app that shows Claude as a
chat on a phone and as its real terminal on a computer.

## How it works

Every session is its own git worktree and branch off the latest `main`, with
two things running in tmux on the host (a tmux of amarchy's own, `tmux -L
amarchy`, out of sight: no status bar, no prefix key): Claude Code, and the
session's **terminal**, opened in the same worktree, where the project runs
(`bin/dev`, `npm run dev`...).

The app (`amarchy app`) is a web app the host serves to your tailnet. It
picks its layout by the window:

- **On a phone**: the list of sessions; open one for its conversation as a
  chat, a box to send it messages, and Claude's questions and permission
  prompts as buttons.
- **On a computer** (a wide window with a mouse): your sessions on the left,
  the session's Claude in a 900px column in the middle and its terminal on
  the right, each a see-through panel over your wallpaper. Claude and the
  terminal are the real thing: terminals (xterm.js) attached to the session's
  tmux on the host.

The phone and every browser show the same sessions at once, live: what you
do on one shows on the others. A session's window takes the size of
whichever device showed it or typed in it last. Close the app, the laptop,
the phone: the sessions go on working on the host.

## Sessions

### Starting one

The bar under the list starts a new session: say what its Claude should do
(that's its first message) and send it; tap the project on its left for
another of your projects. Hold its mic and say it instead: the session starts
while you speak, opens when you let go, and what you said goes to its
Claude's dictation once Claude is up. On a computer, `Ctrl+Alt+N` does the
same.

You get a worktree on a fresh branch named after a famous anarchist with a
silly adjective (`wobbly-bakunin`, `caffeinated-goldman`), made from the
latest of the base branch (only that one is fetched; without the network, the
last fetch). The session shows up at once: its row spins in the list while
the worktree is made, then Claude starts. If it can't (a bad base branch,
say), it says why and the session goes away. Each new worktree is
pre-trusted in `~/.claude.json`, so Claude starts without the folder trust
prompt, and the entry goes again on close.

**New project…** (in the project picker, in Settings, or `Ctrl+Alt+P`)
clones one of your GitHub repos (searchable, most recently pushed first),
any git URL or `owner/repo`, or starts an empty project, with a private
GitHub repo if you like. The session starts right on it.

### The list

```
 Ⓐ Amarchy Menu   󰐕 New…
 󰍉 Search sessions      󰒼

 󰂞  Login: redirect loop   4m
    my-app · wobbly-bakunin
 ⠋  Billing: CSV export  12m
    my-app · smug-goldman
 󰗠  README: tidy up       1h
    docs · sleepy-kropotkin
```

Each row says what the session is about in a few words, keyword first, so you
find the one you want by the word in bold: Claude Code's title for the
conversation ("Fix login redirect loop after OAuth callback") cut down by
Haiku to **Login:** redirect loop. It happens once per title, in the
background, through your own `claude` login; until it's done, and with
`AMARCHY_SHORT_NAMES=off`, Claude's title shows as it is. A name you give the
session yourself (**Rename…**, `Ctrl+Alt+E`) always wins, and the search
still finds a session by any word of Claude's whole title.

The glyph says what it's doing: a bell (󰂞) when it needs you (a permission,
a question), a spinner while it works, a check when it's idle. A session
that finished while you were somewhere else keeps saying so: its check is
filled and in the theme's accent (󰗠) until you open it, on any device, and
goes back to the plain, dimmed one (󰄬) after. So with many sessions done you
can tell the ones you haven't looked at yet from the ones you've read and are
leaving for later. `󰒲` marks one that's [asleep](#sleep), and `+1 BG` one
with Claude Code background sessions (`/bg`) running in its worktree.

The **search** finds a session by what it's about, its project or its branch:
the list narrows as you type. On a computer `Ctrl+Alt+S` goes there, `↓`
goes into the list, `↵` opens one and `Esc` brings the whole list back.

### Priority

Start everything at once, then say what matters: every session has a
**priority**, High, Normal (what a new one gets) or Low. Hold a session in
the list (or its •••) for High · Normal · Low; on a computer,
`Ctrl+Alt+Up` / `Down` raise and lower the one you're in. The list puts
higher priority first, unless you sort it by date. Under a session's time
sits its priority: a flag (󰈻) for high, an arrow down (󰁅) for low, which is
also dimmed. Every one of them still notifies you.

### Group and sort

Next to the search, 󰒼 opens how the list is grouped and sorted. **Group by**
puts sessions in sections: **by project** (one section per project, each row
showing just its branch), **by priority** (High, Normal, Low) and **by
status** (Needs you, Working, Done (finished, not opened yet), Idle), or
**Not grouped**. Use any of them; together they nest in the order you turn
them on, each one inside the ones already on, and the menu numbers them (1
outermost). Turn on priority and then project for High, Normal and Low with
each one's projects inside; project and then priority for the priorities
inside each project. To change the nesting, turn one off and on again: it
goes innermost. **Sort by** orders the sessions inside each section: by
**priority** (the default: higher first, then the order you opened them in),
**newest first** or **oldest first**. The choice is the host's, so every
phone and browser shows the list the same way.

Your projects come in the order you choose, not alphabetically: in the list
grouped by project, and in the picker of a new session. Tap a project's
header (or **Order projects…** in that menu, or in Settings) for all of
them, each with arrows; hold an arrow to send it to the top or bottom. A
project you haven't placed comes after the ones you have, by name, so one you
add shows up last until you move it.

### Closing one

**Close session** (a session's •••, a hold on it in the list, `Ctrl+Alt+X`)
asks first, and says so when uncommitted changes would be lost with it. Then
its row goes and the rest happens out of sight: its Claude Code exits as if
you'd quit it, its background sessions stop, anything still running from the
worktree is stopped (a dev server Claude started in the background, say), the
worktree is removed and the branch deleted if it was merged. If the worktree
changed meanwhile, it says why it couldn't and the session is back in the
list.

### A session's menu

Everything about one session is in its menu: ••• in the session on the
phone, a hold on it in the list, a right click on it in the browser's list,
or **This session** in the amarchy menu (`Ctrl+Alt+M`). It renames the
session, sets its priority, runs its project or a saved command
([Run](#run-commands)), pastes an image into Claude, shows **Claude's
terminal**, wakes it or puts it to sleep, makes it your
[assistant](#your-assistant), and closes it.

## On your iPhone

The list is the first thing the app shows, with "N need you" in its head and
the count on the app's icon. Open a session for its conversation: what you
and Claude said, as a chat, with a box to send it messages. What you send
goes to the session's Claude as if typed into it, and Claude's questions and
permission prompts come up as buttons (the answer is the key you'd press;
**Answer in your own words…** for the rest). Back is the list.

**Claude's terminal**, in the session's •••, is the real one, on the app's
glass like the conversation, with keys under it: **A−**/**A+** for the text
size, arrows, Enter and Esc for anything the buttons don't cover, and **Hold
to talk** ([Dictation](#dictation)).

**Settings** (the gear) has the notifications and what they tell you about,
the chimes, sleep, your assistant, your projects (new ones, their order), the
look, and where links open.

## In a browser on your computer

The same app, same address, on a wide window is amarchy laid out as a desk:
your sessions on the left, the session's Claude in the middle, its terminal
on the right, over your whole wallpaper in your theme and font. Typing, the
mouse wheel (tmux's scrollback), selecting (it copies to your clipboard),
resizing and the Nerd Font icons work as in any terminal. The keyboard
follows the pointer between Claude and the terminal.

**Zen mode** (`Ctrl+Alt+Z`) leaves Claude alone in the column, with a strip
above it saying which session this is (click it to rename the session) and an
Ⓐ in the corner for your sessions, lit when one needs you. The list drops
from it for a moment when you move between sessions, and `Ctrl+Alt+A` opens
it. Asking for the terminal brings the panels back.

The tab says how many sessions need you, `(2) Amarchy` (`•` when only
finished ones you haven't opened wait), and its icon gets a dot, red for one
that needs you. Installed (Add to Dock, Install), the app's icon carries the
count, as the home-screen app's does on the phone.

**Settings** (in the amarchy menu) has what the phone's has, and more:
**Layout** (**As the window fits**, the default, or always **Wide** or
**Phone**), the terminals' font size, WebGL drawing (faster; the DOM is the
default), and whether Option is Alt in the terminals on a Mac (on by default;
off for typing accented letters with it).

### Keys

amarchy's keys are `Ctrl+Alt+…` (Control+Option on a Mac), which a browser
lets a page have:

| Key | |
| --- | --- |
| `Ctrl+Alt+N` / `P` | New session / new project. |
| `Ctrl+Alt+J` / `K` | The session below / above in the list, wrapping around. |
| `Ctrl+Alt+S` | Search the list (in zen mode, under the Ⓐ). |
| `Ctrl+Alt+A` | Your sessions under the Ⓐ: `j`/`k` and `↵` to open one, `/` to search, `+`/`-` to raise / lower a session's priority, `g` for the group & sort menu, `p`/`f`/`s` to switch grouping by project / priority / status, `o` for the next sort, `Esc` to close. |
| `Ctrl+Alt+Z` | Zen mode: Claude alone. Again brings the panels back. |
| `Ctrl+Alt+←` / `→` | Claude / the terminal. |
| `Ctrl+Alt+Return` | Move the keyboard between Claude and the terminal (leaves zen mode). |
| `Ctrl+Alt+R` | Run the project in the terminal (again: restart it). |
| `Ctrl+Alt+C` | The project's other saved commands: run one, or save a new one. |
| `Ctrl+Alt+Up` / `Down` | Raise / lower this session's priority. |
| `Ctrl+Alt+E` | Rename this session. |
| `Ctrl+Alt+T` | The [theme](#theme), font and wallpaper. |
| `Ctrl+Alt+X` | Close this session (asks first). |
| `Ctrl+Alt+M` | **The amarchy menu**: New session and New project on top; the rest in **Run** (the project, a command, saved commands, the terminal), **This session** (rename, wake or sleep, your assistant, priority, close), **Sessions** (next, previous, search, zen mode, group & sort, close one) and **Settings** (notifications and layout, theme, sound, the keys). `→` or `↵` opens a group, `←` goes back; the selected row shows its key; typing searches all of it. The one to remember. |
| Hold `Space` | Dictate to Claude (`/voice`), see [Dictation](#dictation). |
| `Shift+Enter` | A new line in Claude's prompt. |

Every menu takes the keys, in the browser and on a phone or tablet with a
keyboard: a session's menu, closing one, settings, the group & sort menu, the
order of your projects, the project for a new session, Claude's questions,
and the phone's list itself. `↑`/`↓` go from line to line (buttons side by
side, as High · Normal · Low, are one line: `←`/`→` go along it),
`Home`/`End` to the ends, `↵` or `Space` picks, `Tab` stays inside, `Esc`
closes and gives the keys back where they were (to Claude or the terminal).
One you open with the keys has its cursor on its first line (or the one
that's on) at once; one you click, once you press an arrow. In Claude's
question a choice's number picks it and `Esc` says no, as in Claude's own; in
the order of your projects `Shift+↵` on an arrow sends the project to the top
or bottom; on a session in the list, the menu key (or `Shift+F10`) opens its
menu.

## Run commands

Each project has a **run command**, run in the session's terminal:
`Ctrl+Alt+R` on a computer, ••• → **Run…** → Run the project on the phone,
`amarchy run` from the session itself. Again restarts it. amarchy guesses it
from the repo (`bin/dev`, `npm run dev`, `cargo run`...) and asks when it
can't tell.

Next to it a project can have more **saved commands**, each with a name:
`Ctrl+Alt+C` (or **Run…** on the phone) lists them, runs one, and saves,
changes or forgets them; **Saved commands…** in the amarchy menu's Run has
them all. They're shared by all the project's sessions and start in the
session's worktree, with `$AMARCHY_PATH` (the worktree), `$AMARCHY_NAME`,
`$AMARCHY_BRANCH`, `$AMARCHY_REPO` and `$AMARCHY_ROOT` (the project's main
checkout), so one command fits every session. From the CLI, single-quoted so
they expand per session:

```sh
amarchy run --set 'bin/dev'                            # the run command
amarchy run --save test 'npm test'                     # another one, named
amarchy run test                                       # run it
amarchy run --list                                     # all of them, name<TAB>command
amarchy run --forget test
```

The phone only shows Claude's terminal; the session's terminal, with the
project's output, is the browser's right-hand panel.

## What a session serves

To see what a session serves (a dev server, a preview), each session's Claude
is told to listen on the host's Tailscale address and give you
`http://<host's tailscale name>:<port>`, so only your own devices reach it,
and to check the port is free, since other sessions share the machine.
Without Tailscale it serves on localhost only, and you forward the port
(`ssh -L 3000:localhost:3000 <host>`). `NAME=` and `BIND=` in
`~/.config/amarchy/host` change either.

## Links

Links (in what Claude says, and in the terminals: click one) open in your
default browser, where the device lets a web page get there. In Safari's
Dock app on a Mac they do: a link to another site leaves for the default
browser. On an iPhone or iPad, the home-screen app opens them in a Safari
sheet whatever the default is, and a page can't ask which browser that is, so
Settings → **Open links in** picks one for that device (Safari, Chrome,
Firefox, Edge or Brave, through the browser's own address, so it has to be
installed); "As iOS does" is the sheet.

## Paste

**Pasting an image into Claude** works as `Ctrl+V` would in a terminal of
your own: it shows in Claude's prompt as `[Image #1]`, for what you send
next.

- **In a browser**: `⌘V` (or `Ctrl+V`, once the browser lets the page read the
  clipboard), or drop an image on Claude.
- **On the phone**: the picture button by the box, ••• → **Paste an image into
  Claude…**, or an image pasted into the box, from the phone's photos or what
  it copied.

The page hands the image to the host, and Claude's `Ctrl+V` gets it from
amarchy's `wl-paste` there (`install.sh` links `bin/amarchy-paste` into
`~/.local/bin` as `wl-paste`, unless the host has a real one). The host keeps
what you last pasted, from any phone or browser, as its clipboard (the **web
clipboard**, `~/.local/state/amarchy/clipboard/web.clip`, yours only), and
text you paste or copy in its terminals too, so `wl-paste` in any session
(Claude's own, or yours in the terminal) prints it. That's how you show a
session's Claude a screenshot: paste it, then ask it to look at what you
copied.

## Dictation

Claude Code's own voice mode (`/voice`, which has to be on) works from the
phone and the browser: what your device's microphone hears goes to the
session's Claude, and Claude writes the words down. On the host Claude's
`rec` is amarchy's (`bin/amarchy-rec`, which `install.sh` links into
`~/.local/bin`): your device's microphone while you dictate, SoX's real `rec`
the rest of the time.

- **On the phone**, hold the mic button by the box. The box says
  "Listening…" once the microphone hears (it takes a moment to come on; what's
  said before is lost), and the words come up in the phone's box as Claude
  writes them down, to edit and send when you let go. The microphone stays on
  half a second after you let go, and Claude then hears silence until it stops
  recording, which it needs to keep the last word. In Claude's terminal,
  **Hold to talk** does it into Claude's own prompt. The phone asks whether
  Amarchy may use the microphone the first time you dictate after opening the
  app; after that the app keeps it, turned off between dictations. What iOS
  kills meanwhile (a call, Siri, the app in the background) is made anew when
  you next hold the mic.
- **In a browser**, hold Space in Claude, as you would in a terminal of your
  own. The page turns the microphone on as soon as Space goes down (a space
  only typed turns it off again), what's said before Claude listens waits on
  the host, and the words come up in Claude's prompt. The browser asks for
  the microphone the first time, and the page keeps it, off, for ten minutes
  after a dictation (or until you leave the tab), so the next one starts at
  once.

The host logs each dictation (`journalctl --user -u amarchy-app`).

## Sleep

Every Claude Code holds a few hundred MB of memory, also while it waits for
you. So a session you're not using **sleeps**: once it has been idle for a
minute, open on no phone or browser, its Claude exits and lets go of all of
it, and everything else stays as it was: its place in the list (idle, like
before), its terminal, and its tmux window, which keeps Claude's last screen
with a quiet badge saying it's asleep. The minute counts from when it was
last open somewhere; a session whose conversation is open on a phone or
whose terminal is open in a browser never sleeps.

Waking it is doing what you'd do anyway:

- **Send it something** from the phone: it's Claude's first message when it
  comes back (`claude --resume`, the same conversation), and what was typed
  in its prompt before it slept is put back after.
- **Type in Claude's terminal** in a browser. Press Enter and Claude comes
  back with your message already sent; anything else (arrows, Ctrl keys,
  Shift+Enter, the wheel) brings Claude back at once with what you typed in
  its prompt. A scroll wakes it without reaching Claude.
- **`amarchy send`** from a script or another session.

A half-written prompt survives: before Claude exits, amarchy asks it for its
prompt (Claude's Ctrl+G, "edit in your editor", answered by
`bin/amarchy-editor`), and it's back in the prompt when Claude is. Opening a
sleeping session doesn't wake it; the app marks it with `󰒲` in the list (it
pulses while it wakes) and says so above where you type. After a host
reboot every session comes back asleep, its conversation kept.

A session never sleeps while something would be lost with its Claude:

- it's working, or it's asking you something (a permission, a question);
- a command Claude started is still running in the background (a dev server,
  a build);
- background agents are still at it;
- a `/loop` or a scheduled task is due to wake it;
- Remote Control is on;
- it's open on a phone or in a browser.

Claude Code **background sessions** (`/bg`) started from a session show as
`+1 BG` in its row. When the session sleeps, those with nothing left to do are
stopped as well (Claude Code keeps their conversations: `claude attach <id>`
brings one back); close stops them all, since their worktree goes away.
Running ones are left alone, and so is anything else running from a sleeping
session's worktree: only close stops it.

The session's menu has **Wake** / **Put to sleep**; **Settings → Sleep** sets
the minutes (or Never) and puts the idle ones to sleep at once; **Sleep idle
sessions** is under Sessions in the amarchy menu. From the CLI:

```sh
amarchy sleep [id]         # this session (or that one), now; it says why not, if something would be lost
amarchy sleep --all        # every session that can, except those open somewhere
amarchy sleep --after 5    # minutes before an idle session sleeps on its own (default 1, or off)
amarchy wake [id]          # without sending it anything
```

`amarchy list` says which ones sleep (`sleeping`). The timer is a systemd
user timer that `install.sh` adds (`amarchy-sleep.timer`); it checks every 30
seconds and runs nothing in between.

## Theme

The app's look is picked in the app: Settings → **Theme, font, wallpaper…**,
or `Ctrl+Alt+T` in a browser. It's the host's, so every phone and browser of
yours wears it at once.

- **Theme**: Omarchy's themes (Tokyo Night, Catppuccin, Gruvbox, Nord, Rosé
  Pine, Hackerman...), each a card in its own colors with its wallpaper. A
  theme colors the app, the terminals (Claude's and the session's) with its 16
  terminal colors, and Claude Code itself in the sessions started after it
  (its own theme, `custom:amarchy`).
- **Font**: JetBrains Mono (the default), Caskaydia Mono or Fira Code, the Nerd
  Font builds with the icons the session list uses, or System (the device's
  own monospace, SF Mono on Apple's).
- **Wallpaper**: the theme's (drawn for it), your own (choose a picture: it's
  cut to a phone's screen and a computer's), or none. The app is a window over
  it with gaps around it and a see-through background.

On the host, `amarchy theme` does the same:

```sh
amarchy theme                                   # what's worn: theme, font, wallpaper
amarchy theme nord --font "fira code" --wallpaper ~/beach.jpg
amarchy theme --wallpaper theme|own|none
amarchy theme --list                            # the names, * on the ones worn
```

The host keeps what's picked in `~/.local/state/amarchy/app/theme`; the themes
and fonts are amarchy's (`themes/`, `fonts/`, with their credits). Until
something is picked, it's Tokyo Night.

## Notifications

When a session needs you (a permission, a question), your phones and
browsers get a notification: a bell, what the session is about, and
project · branch under it. Tap it to open that session. You don't get one for
the session you're looking at. The bell only rings when Claude is actually
blocked on you: the reminder Claude Code sends a minute after a turn you
haven't answered doesn't count.

Turn them on in each device's Settings → **Notifications** (on an iPhone,
from the home-screen app; on a Mac, from the Dock app or the installed one),
where **Send a test** checks they arrive. On the host:

```sh
amarchy app --status       # whether the app is on, where, and how many devices it notifies
amarchy app --test         # a test notification to each one
```

**What tells you** is Settings → **Tell me**, or `amarchy alerts`:

```sh
amarchy alerts needs-you   # the default: a session tells you only when it asks you something
amarchy alerts all         # when one needs you and when one is done
amarchy alerts assistant   # nothing but your assistant
```

With `needs-you`, a session that's done doesn't notify you, and is marked
done in the list (the filled check) until you open it.

**The chime**: a phone's notifications ring with the phone's own sound. A
browser with the app open plays amarchy's chime when a session needs you or
is done, unless it's the one you're looking at. Settings → **Sound** picks it,
each one playing as you tap it or as the keys land on it; **Off** for none;
**Add your own…** uploads a `.wav`, `.ogg`, `.oga`, `.opus`, `.flac` or
`.mp3` into `~/.config/amarchy/sounds/` (one named like one of amarchy's
replaces it). Keep it short: it plays in full. The Ogg ones are made WAV for
Safari once. On the host:

```sh
amarchy sound              # the one set now
amarchy sound tine         # set one: kalimba (the default), vibraphone, tine, fairy, ocean, elementary, herald
amarchy sound --list       # amarchy's, then yours
amarchy sound off
```

`sounds/CREDITS` says where amarchy's come from; `sounds/make.py` makes its
own ones again.

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

- **In every list** it comes first, above the groups: bigger, with its picture
  (an imp of a retainer with his staff of two heads, `app/assistant.svg`, or
  yours), its name, and what it's on, its state on a badge at the corner of
  the picture. The other sessions of its project (more sessions for small
  personal things) sit under it there, at their usual size with its picture
  small, and a rule sets them apart from the rest. When it has written
  something you haven't read, its card says **New** by its name and shows the
  start of what it wrote, and the sessions under it show theirs in place of
  project · branch. Opening it anywhere clears it everywhere. In the session
  itself, the phone and the strip above Claude call it by its name, and the
  phone's box says "Message Jaken".
- **It always tells you** when it needs you or is done, whatever `amarchy
  alerts` lets through of the others: under its name, with what it said as
  the body (a brief's first words), and with a chime of its own in the
  browser, `herald` (a knock of the staff and two horn notes; `amarchy sound
  --assistant <name|off>` picks another). What it sends with `amarchy notify`
  goes under its name too, and a tap opens it. On an iPhone a notification
  always wears the app's icon, so there its name is what sets it apart.

Its picture can be yours rather than amarchy's imp:

```sh
amarchy assistant --picture ~/Pictures/jaken.png                  # the middle of it, as big as it goes
amarchy assistant --picture ~/Pictures/jaken.png --crop 400,0,990  # the square at x 400, y 0, 990 pixels across
amarchy assistant --picture off                                   # amarchy's own again
```

It's cut round and square (with ffmpeg, else ImageMagick) and kept in
`~/.config/amarchy` (`assistant.png`, and `assistant-192.png` for the
notifications), not in amarchy. It goes by a hash of itself, so a new one
shows at once everywhere, the phone's saved copy of the app included.

In the app all of it is a session's menu away: **Make it my assistant…**
(on the phone; **Make it your assistant…** in the browser's This session)
with its name, and on your assistant **name, picture, chime…**: rename it,
pick its chime, go back to amarchy's imp, or **Not my assistant any more**.
**Choose…** a picture from the phone's photos or the computer, drag it into
the circle and zoom (the slider, the wheel, two fingers, or the arrows and
`+`/`-`), and the page cuts it there and sends the host what's in the circle.
Settings has your assistant too.

## Claude knows it's in amarchy

Each session's Claude starts knowing where it is: which session, worktree and
branch it's on, where the project's main checkout is, that you see it and its
terminal through the app on your own devices (so it gives you URLs on the
host's Tailscale address rather than opening a browser), and that it can
message the other sessions. amarchy's `SessionStart` hook tells it, and does
so again after a `/clear` or a compaction. The **amarchy skill**
(`skill/SKILL.md`, which `install.sh` links into `~/.claude/skills`) has the
rest, loaded only when the work calls for it:

- what it can do with the CLI: restart the dev server with `amarchy run`, see
  the other sessions, read what you pasted with `wl-paste`;
- what it leaves to you: priorities, sleep, the theme, and closing its own
  session;
- how to merge back into main;
- how to talk to the other sessions: they are Claude Code instances too, so
  Claude can message them with Claude Code's `ListAgents` and `SendMessage`
  (`amarchy list` gives each session's `agent` name for that), and start a new
  session with a task of its own (`amarchy new <project> --prompt "..."`).

Claude and the terminal also carry the session in their environment:
`AMARCHY=1`, `AMARCHY_SESSION` (its id) and the variables run commands get
([Run commands](#run-commands)). So scripts can tell too, and from there
`amarchy run`, `rename` and `close` act on that session.

## From scripts and agents

Two commands do what you'd do from the phone, for a script, a timer or
another session's Claude (an assistant that keeps your day, say):

```sh
amarchy send <id> "<text>"                       # to a session's Claude, as if typed and sent
amarchy notify "<title>" "<body>" [--session <id>] [--urgent]   # to your phones and browsers
```

**`amarchy send`** types the text into the session's Claude the way the phone
does (pasted, then Enter), `-` reading it from stdin. It waits until Claude is
free: not in the middle of a turn (Claude Code would hand a message typed then
to the turn under way, between two of its steps), not asking you something
(the text would answer it), and nobody typing in its prompt. What's typed there
and left alone for 15 seconds goes first: Claude hands it over (`Ctrl+G`, as
when a session falls asleep), the message is sent, and it's back in the prompt.
A session whose Claude isn't running (asleep, exited, or after a reboot) starts
again with the message as its first one. Messages for one session wait their
turn, so they arrive one at a time, in the order sent. It prints `sent to
<id>` once Claude has started on it, and fails (exit 1, saying why) if Claude
wasn't free within an hour (`--timeout <minutes>`) or the session was closed.
`--no-wait` returns at once, leaving a process of its own to deliver it (a
transient systemd unit, so it outlives whatever called it); from the
session's own Claude it never waits, since the turn it would wait for is its
own. A systemd user timer can run it, e.g. a morning check-in:

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

**`amarchy notify`** sends a notification of your own to every phone and
browser the app notifies, through the same Web Push as the app's own ones.
Each one stays: it doesn't replace the one before it. With `--session <id>`,
tapping it opens that session in the app. It fails when no device has turned
notifications on. `--urgent` asks for all a web app may: on a computer's
browser a notification that stays on screen until you dismiss it. iOS gives
a home-screen app nothing more: no Time Sensitive or critical alerts, so an
urgent one looks and sounds like any other, stays silent in silent mode, and
waits out a Focus that holds back the app's notifications.

Sessions starting sessions: a session's Claude can start others with
`amarchy new <project> --prompt "<brief>"` (one per GitHub issue,
say), each on its own branch, and they show up in your list. Every session's
Claude can message the others with `SendMessage` (`agent` in `amarchy list`
is the name each goes by).

## Install

See [Quick start](#quick-start) for what it needs. `install.sh` is safe to run
again. It:

- links `bin/amarchy` into `~/.local/bin`, with `wl-paste` ([Paste](#paste))
  and `rec` ([Dictation](#dictation)) next to it, never over real ones of
  your own;
- links the amarchy skill for Claude Code (`~/.claude/skills/amarchy`);
- adds the sleep timer (`amarchy-sleep.timer`) and the update timer
  (`amarchy-update.timer`).

`amarchy app on` adds the app's service (`amarchy-app.service`, a systemd user
service, so it's back after a reboot) and puts it on your tailnet with
`tailscale serve`; `amarchy app off` takes it off (the phones keep the app,
for when it's on again).

**Updating** is automatic: every 5 minutes the update timer runs `amarchy
update`, which pulls what was shipped to GitHub (`origin`'s main) into the
checkout amarchy runs from (only when it's on main with nothing uncommitted)
and installs it. The app restarts itself, and open app pages offer to load the
new one (one you're not looking at just does). `AUTO_UPDATE=off` in
`~/.config/amarchy/host` stops it; `amarchy update` does it now.

`install.sh --uninstall` takes all of that out again, and what an older
desktop install of amarchy left; your worktrees and `~/.local/state/amarchy`
are left alone.

Every install points all of it at the checkout it runs from. To try a change
in a session's worktree as the installed amarchy, run that worktree's
`install.sh` (a run command: `amarchy run --set '$AMARCHY_PATH/install.sh &&
systemctl --user restart amarchy-app'`), and `$AMARCHY_ROOT/install.sh` puts
it back on the main checkout. While amarchy runs from another session's
worktree, `install.sh` and `--uninstall` say whose it is and ask before
replacing it; with no terminal to ask in (Claude running it, a script) they
change nothing, and `--force` goes on without asking. Closing a session whose
worktree amarchy runs from puts amarchy back on the main checkout first.

### How it stays yours

The app listens on the host's localhost only, and `tailscale serve` puts it on
your tailnet over HTTPS, never on the internet (it's not Funnel). Tailscale
tells it who each request comes from, and it answers only the Tailscale
account that owns the host (to let in others, list their logins as
`APP_USERS=` in `~/.config/amarchy/host`). It only takes changes and
terminal connections from its own pages (their `Origin`), so a website open
on your phone can't drive your sessions, and it checks that a connection on
localhost comes from Tailscale (`tailscaled`) or from you, so another user on
the host can't pass for Tailscale. What a terminal in the browser gives is
Claude and a shell on the host, as you; anything running as you on the host
can drive the sessions anyway. Keep the host's ssh on a private network too.

The app is plain HTML and JavaScript (`app/`), served by amarchy itself:
nothing to build, and the notifications are signed and encrypted with
`openssl`. It doesn't matter which Anthropic account each session's Claude
Code uses.

## Configure

The host's settings are lines in `~/.config/amarchy/host`:

| Setting | Default | |
| --- | --- | --- |
| `NAME=` | its Tailscale name | The name in the URLs a session's Claude gives you. |
| `BIND=` | its Tailscale address | The address a session's dev server should listen on. |
| `APP_USERS=` | the host's owner | The Tailscale logins the app lets in. |
| `APP_PORT=` | `7397` | The app's port on localhost. |
| `APP_HTTPS=` | `443` | Its HTTPS port on your tailnet: 443, 8443 or 10000. |
| `AUTO_UPDATE=` | on | `off` to stop the update timer. |

And environment variables. Set them where both your shell and amarchy's
systemd services (the app, the timers) see them: in
`~/.config/environment.d/amarchy.conf` (`AMARCHY_WORK=$HOME/Code`, read when
you log in) and your shell profile.

| Variable | Default | |
| --- | --- | --- |
| `AMARCHY_WORK` | `~/Work` | Every git repo directly inside is offered. |
| `AMARCHY_WORKTREES` | `$AMARCHY_WORK/.worktrees` | Worktrees go to `<this>/<repo>/<name>`. |
| `AMARCHY_CLAUDE_ARGS` | `--permission-mode auto` | Extra arguments for `claude`. Unset, they come from `~/.config/amarchy/claude-args` when it exists (one line, e.g. `--dangerously-skip-permissions`), so every way a session starts gets them. |
| `AMARCHY_SHORT_NAMES` | `on` | `off` to list sessions by Claude Code's titles as they are, not cut down to "Keyword: a few words". |

How long an idle session waits before it sleeps isn't a variable: `amarchy
sleep --after <minutes>|off`, kept with amarchy's state
(`~/.local/state/amarchy/`).

## CLI

Everything the app does is a command on the host, so anything you can do from
the phone, a script or an AI agent can do too. Commands print results to
stdout and exit non-zero on failure. `amarchy help` lists them all, and
`amarchy <command> --help` (or `-h`, or `amarchy help <command>`) prints one
command's usage without running it; an option a command doesn't know is an
error, so a typo never acts on a session.

```
amarchy help [command]                all the commands, or the usage of one

amarchy projects [--json]             your projects and their session counts
amarchy projects --github [--json]    your GitHub repos (✓ = already added)
amarchy projects order [project...]   the order of your projects (prints it, or puts these first)
amarchy projects move <project> up|down|top|bottom | before|after <other>
                                      move one in it
amarchy add <owner/repo|git url>      clone a project (prints its path)
amarchy add --new <name> [--github]   start an empty project (and a private GitHub repo)

amarchy new <project> [name] [--prompt <text|->]
                                      create a session (name like wobbly-bakunin if omitted), with the first
                                      thing its Claude is asked (- reads stdin); prints its id
amarchy send <id> <text|-> [--no-wait] [--timeout <minutes>]
                                      a message to a session's Claude, once it's free
amarchy list [--compact]              sessions as JSON (agent: the name its Claude has for SendMessage)
amarchy close [id] [--force]          close a session (current one if no id); --force discards uncommitted changes
amarchy rename <title>                name the current session
amarchy rename --id <id> <title>|--reset
                                      the same for another session / back to the one made from Claude's title
amarchy run                           run the project in the session's terminal (again: restart it)
amarchy run --show | --set <command>  the project's run command (guessed from the repo until you set one)
amarchy run <name>                    run another saved command of the project, the same way
amarchy run --save <name> <command>   save one; --forget <name> drops it
amarchy run --list                    the project's saved commands
amarchy priority [high|normal|low|up|down] [--id <id>]
                                      how much a session matters; higher first in the list
amarchy group [project|priority|status] [on|off]
                                      group the list (switches without on|off); one turned on nests inside
                                      the ones already on
amarchy group <grouping> <grouping>...  group by these, nested in this order, e.g. `group priority project`
amarchy group none                    no grouping (the default)
amarchy sort [priority|newest|oldest] how the list is sorted inside its groups

amarchy sleep [id] [--force]          put a session to sleep (says why not when something would be lost)
amarchy sleep --all [--force]         every session that can, except those open on a phone or in a browser
amarchy sleep --after [minutes|off]   how long an idle session waits, open nowhere, before it sleeps (default 1)
amarchy wake [id]                     wake a session without sending it anything

amarchy app on | off                  serve the app on your tailnet, now and after every reboot / stop
amarchy app [--status] | --test       whether it's on, where, and how many devices it notifies / a test notification
amarchy notify <title> [body] [--session <id>] [--urgent]
                                      a notification of your own on each device the app notifies
amarchy alerts [all|needs-you|assistant]
                                      what the other sessions tell you about (default needs-you)
amarchy assistant [<id> [--name <name>] | off]
                                      your assistant: first in every list, always heard
amarchy assistant --picture <file>|off [--crop x,y,size]
                                      its picture
amarchy theme [--show] | <name>       the app's look: print it / wear a theme
amarchy theme --font <name> | --wallpaper theme|own|none|<picture> | --list [--json]
amarchy sound [--show] | <name> | off | --list [--json]
                                      the chime a browser plays; --assistant [name|off] for your assistant's

amarchy update                        to the latest amarchy on GitHub, now (it does it every 5 minutes)
amarchy attach <id> [claude|term]     a session's Claude or terminal (its tmux) in this terminal, over ssh
```

`amarchy help` also lists amarchy's own plumbing (what the hooks, the timers
and the app's server run: `hook`, `seen`, `reap`, `paste`, `rec`, `app serve`,
`migrate`...): nothing to run by hand.

## Coming from the desktop

amarchy began on an Omarchy (Hyprland) desktop: a shell plugin for the Ⓐ in
the bar and the list beside Claude, Hyprland workspaces and windows, and
`amarchy remote` for desktops showing a host's sessions. That's all gone (git
history keeps it); the app does everything it did. If you used it, what moved:

| On the desktop | Now |
| --- | --- |
| `Super+Alt+N` / `Super+Alt+A` | `Ctrl+Alt+N` / `Ctrl+Alt+A` in the browser |
| `Super+←`/`→` (Claude / the terminal) | `Ctrl+Alt+←`/`→` |
| `Super+Space` → Amarchy | `Ctrl+Alt+M` |
| `amarchy keys` | the keys are always `Ctrl+Alt` |
| `amarchy jump`, `next`, `prev`, `open`, `zen`, `terminal`, `search`, `pick`, `menu`, `show` | the app, and its keys |
| `amarchy theme` with Omarchy's switcher | the app's own theme, font and wallpaper |
| `amarchy sound` picker, `--play`, `--add` | Settings → Sound in the app |
| `amarchy remote <host>` | open the app |
| `wl-paste` reading the desktop's clipboard | the web clipboard: what you paste in the app |

`install.sh` (and `install.sh --uninstall`) takes an old desktop install's
pieces out (the Hyprland line, the shell plugin, the menu entry, the theme
hook), and `--host` is still accepted, doing nothing more. The first time the
new amarchy runs (`amarchy migrate`, from `install.sh` and the app's server)
it brings the state from before up to date: the look a desktop last sent the
app becomes what's picked in the app (its theme, its font, its wallpaper as
your own), and so do its chimes, unless you'd picked your own.

## License

[MIT](../LICENSE). The notification sounds in `sounds/` keep their own licenses,
listed in [`sounds/CREDITS`](../sounds/CREDITS). The themes and fonts in
`themes/` and `fonts/` list theirs there.
