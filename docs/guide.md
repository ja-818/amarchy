# The amarchy guide

Everything amarchy does, in detail. New here? The [README](../README.md) is the
two-minute version.

amarchy runs Claude Code on a machine that stays on, and you talk to it in a
**chat**: from your phone (an app on the home screen) or from a computer's
browser. Each chat is a conversation with Claude about one project. The words
**branch** and **worktree** appear in the app only in a chat's Details and when
you ship its work; everything else is in plain words. (The command line calls a
chat a **session**, and its commands and ids say so.)

## Quick start

You need:

- **A Linux machine that stays on**: a server, or a PC at home. It needs
  `python3`, `git`, `tmux` 3.5 or newer, and systemd (for the timers).
- **[Claude Code](https://docs.claude.com/en/docs/claude-code)**, installed and
  logged in (`claude` on its `PATH`).
- **[Tailscale](https://tailscale.com)** on that machine and on the devices you
  use, with HTTPS certificates turned on for your tailnet (in the Tailscale admin
  console: DNS → HTTPS Certificates). It's how your phone and browser reach the
  app, privately.
- Optional: [`gh`](https://cli.github.com), logged in, to pick your GitHub repos
  when you add a project.

```sh
git clone https://github.com/ja-818/amarchy ~/.local/share/amarchy && ~/.local/share/amarchy/install.sh
amarchy app on
```

`amarchy app on` prints the app's address (`https://<machine>.<tailnet>.ts.net`).
Open it on your phone in Safari, tap **Share → Add to Home Screen**, and open
amarchy from there; or open it in a computer's browser. Then add a project:
amarchy offers every git repo in `~/Work` (set `AMARCHY_WORK` to use another
folder, see [Configure](#configure)), and **New project** clones one of your
GitHub repos, any git URL, or starts an empty one.

Update with `amarchy update` (it also does it by itself every few minutes). To
remove amarchy, run `install.sh --uninstall`; your projects and chats are left alone.

## How it works

Every chat is its own git worktree and branch, made from the latest `main` of
its project, so each one changes its own copy of the code. Claude works in that
copy, and the project's terminal (the one you run it in) opens in the same copy.
The project's main checkout is not changed by a chat until its work is shipped
(merged into main).

The list shows your chats. Each row says what the chat is about in a few words,
keyword first, so you find the one you want by the word in bold: Claude Code's
title for the conversation ("Fix login redirect loop after OAuth callback") cut
down by Haiku to **Login:** redirect loop. It happens once per title, in the
background, through your own `claude` login; until it's done, and with
`AMARCHY_SHORT_NAMES=off`, Claude's title shows as it is. A name you give the
chat yourself (**Rename**) always wins, and the search still finds a chat by any
word of Claude's whole title.

Each row also shows its state in words, its project and branch, its age and its
priority:

- **Needs your answer**: Claude is asking you something, or waiting for a
  permission or a plan to approve.
- **Working**: Claude is at it (the row says what, when it can: "Running the tests").
- **Done**: it finished and you haven't opened it yet.
- **Ready**: it's idle; nothing is waiting for you.
- **Asleep**: its Claude isn't running, to free its memory (see [Sleep](#sleep)).

Start everything at once, then say what matters: every chat has a **priority**,
High, Normal (what a new one gets) or Low. The list puts higher priority first,
unless you sort it by date. Every chat still notifies you, whatever its priority.

**Group & sort** (the button by the search) puts chats in sections: **by project**,
**by priority** (High, Normal, Low) and **by status** (Needs you, Working, Done,
Idle), or not grouped. Use any of them; together they nest in the order you turn
them on, each one inside the ones already on. Turn on priority and then project
for High, Normal and Low with each one's projects inside; project and then
priority for the priorities inside each project. **Sort by** orders the chats
inside each section: by **priority** (the default), **newest first** or **oldest
first**. The choices stick.

Your projects come in the order you choose, not alphabetically: in the list
grouped by project, and in the picker of a new chat. **Order projects…** (in
Settings, or the menu) puts them in order one at a time: up, down, to the top or
bottom, or right before another one. A project you haven't placed comes after the
ones you have, by name.

**New chat**: pick a project, say what you want, and send. The chat starts in the
project shown under the box ("in amarchy ▾"): the one you tap to pick, else one
that what you wrote names ("fix the login page in jaken" starts in jaken, and says
so), else the last one you used. The chat shows up at once in the list, with a
spinning row while it sets up: it fetches the latest of the base branch, makes the
worktree, and starts Claude. If that fails (say, a bad base branch), it says why
and the chat goes away; without a network it starts from what was fetched last.

**Close** a chat when you're done with it. Closing asks first if it has uncommitted
changes, and says what would be lost. Its Claude exits as if you had quit it, any
process still running from its worktree is stopped (a dev server Claude started in
the background, say), the worktree is removed, and the branch is deleted if it was
merged. Close is the only thing that ends a chat for good.

## The chat

A chat is a conversation, and it works the same on the phone and in a browser.

- **The conversation**: what you said is in bubbles. What Claude says is formatted
  text (code blocks have a **Copy** button). Its steps are folded into one line in
  words ("Read app.js, edited 2 files and ran 3 commands"): tap it to see each step,
  and a step's own detail (the command and its output, an edit's changes in red and
  green). Claude's checklist shows as one, ticked off as it goes. While Claude
  works, its words come in as it writes them, and a line under the conversation
  says what it's doing and how long it's been at it.
- **Cards**: Claude's questions, permissions and plans come up as cards with
  buttons, and stay in the conversation once answered. A permission ("Claude wants
  to run a command") has **Allow**, a way to **always allow** it in words (e.g.
  "Always allow commands starting with “npm test” in this project"), and **Don't
  allow…**, where you can say why. Several questions go one by one, with a tab for
  each and **Back**, then your answers to look over and send together; an option
  with a preview (a mockup, some code) shows it, and you can add a note to your
  choice. A plan reads as a document, with **Approve and start** (in the mode Claude
  planned from, named), **Approve another way** (accept edits without asking, ask
  before each change, Auto) and **Keep planning…** with what to change. Anything
  else Claude asks shows with its choices as they are.
- **The box you type in** takes more than words:
  - **+** adds **Photos** (or **A picture** on a computer), **Take a photo** (on a
    phone) or **A file**. Pasting a picture into the box, or dropping pictures and
    files on the chat (on a computer), does the same, and so does **Add a picture
    or a file…** in a chat's menu. They wait over the box (each with its ✕) and go
    with what you send. A picture goes to Claude as a picture (a big photo is made
    smaller first); it shows in your bubble, and tapping it shows it whole. Any
    other file is saved in the project, in `.amarchy/uploads/` (which git ignores,
    so it's never committed), the box says where, and your message names it for
    Claude to read; taking it off before sending deletes it again.
  - **/** at the start of the box opens Claude Code's commands that work in a chat,
    in words: **Compact the conversation** (`/compact`), **Start fresh** (`/clear`),
    **How full is the conversation?** (`/context`), **Change the model**, **Change how
    Claude asks**, **How hard Claude thinks** (`/effort`), **How much of your plan is
    used** (`/usage`), **Write notes about this project** (`/init`); then the
    project's own commands and skills, then every other skill. Type to narrow it
    down; the arrows and Enter (or a tap) pick one. One that needs no more runs at
    once; the others go into the box, with what they take shown under it. Commands
    that need Claude's own terminal (`/config`, `/mcp`, `/resume`, logins…) aren't
    listed; for those see [Chat and terminal](#chat-and-terminal).
  - **The model** (Opus, Sonnet, Haiku… in words) and **how Claude asks** ("Ask
    before changes", "Accept edits", "Plan first", "Auto", each explained) are two
    menus over the box, for this chat only (asleep, it wakes in them). The wide
    layout's Details has them too (**Change**).
  - **The mic** writes what you say into the box: see [Dictation](#dictation).
  - **Send** turns into **Stop** while Claude works. What you send while it works
    waits over the box, "Will send when Claude finishes", with **Send now**, **Edit**
    (back into the box, its pictures too) and ✕ (not sent). **Stop** brings what
    was waiting back into the box, as Esc does in Claude Code.
- **On a computer, Enter sends and Shift+Enter is a new line**; on a phone, the
  Send button sends. In the browser, `Esc` in the empty box stops Claude while it
  works, and typing anywhere else on the page goes into the box.

Claude runs as a chat: Claude Code runs as `claude -p` behind a small broker, so
what it asks (a permission, its questions, a plan to approve) reaches the app as
data, answers go straight to it, Stop stops it, pictures go with your message as
pictures, the model and the mode change from the box, and messages queue until
Claude is free. Every chat runs on it: new ones from the start, and an older one
moves over when it's idle with nothing waiting (or asleep); its conversation carries
on. Details in [the chat engine's protocol](agent-protocol.md).

## Chat and terminal

With **Show terminals** on (Settings → Terminals; the host's, for every phone and
browser: off for a new install, on for one from before), a chat has **Chat |
Terminal** above it. **Terminal** is the chat's own terminal, where its project
runs, on the phone too:

- **Run** starts the project's run command (`bin/dev`, `npm run dev`, `cargo run`...,
  guessed from the repo until you set one; it asks when it can't tell). Again
  restarts it. **Commands…** runs one of the project's other saved commands, or
  saves a new one.
- Under it, on a phone, the keys a phone's keyboard hasn't: Esc, Tab, **Ctrl** (it
  waits for the next key), the arrows, ^C, ^D, `|` `~` `/` `-`, and **A−**/**A+** for
  the text size.

**Claude's classic terminal** is Claude Code's own interactive app, on the same
conversation. It is for what the chat can't do yet: `/login`, `/config`, `/rewind`,
and logging in to an MCP server. It's under **Advanced** in a chat's menu and shows
only while Show terminals is on. Opening it holds the chat there while you have it
open; the chat goes back when you leave it, or on your next message. Over it, the
keys for Claude's menus (⇧Tab, ⏎, 1 2 3) are on the phone. 
With Show terminals off, a chat's menu still opens its project terminal, under
**Advanced**, and Claude's classic terminal is not offered.

## Your phone

The app is a web app you add to the home screen, made for an iPhone (any phone
with a current browser works). It opens on [Today](#today): what to do now. Its
**Chats** tab shows your chats as a list, with the same
groups and sort as a computer: each one's name, its state in words and its
project, then what it asks you ("Asks: Which theme should be the default?") or the
last thing its Claude wrote; its time, a dot while you haven't read what it
finished, and its priority on the right. Your assistant's card stays on top (see
[Your assistant](#your-assistant)). The search reads names, projects and branches.

- **Hold a chat** (or its ••• menu) to set its priority, rename it, run its project
  or a saved command, add a picture or a secret, make it your assistant, or close
  it. Closing asks first, as on a computer, and says if uncommitted work would go
  with it.
- **Settings** (the gear) picks the chimes, your assistant, your projects, the
  look, the sleep time, what tells you, dictation, secrets, the terminals and the
  links. **New project…** is there too, and the project picker under the list.
- **The box under the list**, **What do you want to do?**, starts a new chat: say
  it, typed or dictated with its mic, and send. Under it, the project it starts in
  (**in amarchy ▾**) and the model (**on Opus 5.5 ▾**): the model you pick there
  stays the one every new chat starts on, on every phone and browser of yours,
  until you pick another (Opus until you do; a chat's own model is still its
  composer's to change). With no project yet, the app opens on a welcome: what it
  does in a sentence, and **Add a project from GitHub** or **Start an empty
  project**.
- **Opening the app is for something new**: back after 10 minutes or more away,
  it's on Today, not the chat you left (the **+** at the top brings up **What do
  you want to do?** in one tap)
  (back sooner, the same chat; a notification you tap still opens its chat, and a
  chat with an answer half given stays).
- **Share to Amarchy**: a screenshot or photo, from the phone's share sheet to a
  chat. Open Amarchy and **Send it to a chat** is waiting, on every screen of
  yours: **Send** by a chat sends it as it is; a chat tapped opens with it in the
  box, to say more first; closed, it's let go. On an iPhone it goes through a
  Shortcut (a web app can't be in Apple's share sheet itself): **Settings → Share
  to Amarchy** has its address (with your share key in it) and the steps (a
  Shortcut with one action, Get Contents of URL, shown in the share sheet). On
  Android, the installed app is in the share sheet itself.
- **Notifications** (in Settings, iOS 16.4 or newer; iPhones only notify home screen
  apps) say when a chat needs you or is done, at the same moments as a computer's
  chime: "Asks: …", "Wants to run a command: Install the packages", "Needs your
  OpenAI API key: to run the tests", "Has a plan for you to approve", or "Done:" and
  the start of its answer, then its project. Tapped, it opens that chat, on the card
  when it asks something, whether the app was open or not. Your assistant's always
  reach you (see [Your assistant](#your-assistant)); **Settings → Tell me** says
  which of the others do.

The phone asks whether amarchy may use the microphone the first time you dictate
after opening the app. After a dictation it keeps the microphone, turned off, for
30 seconds, so the next dictation starts at once without asking. Then, or as soon
as you leave the app, it lets the microphone go entirely, so the microphone
indicator goes away and music playing alongside isn't turned down. The phone may
ask again after that.

It needs [Tailscale](https://tailscale.com) on the host and on the phone (see
[Quick start](#quick-start)). Only your own Tailscale login reaches it (see
[Configure](#configure) for `APP_USERS=`).

## In a browser on your computer

The same app on a computer's wide screen is a chat app with three parts: your
chats on the left, the chat in the middle, and beside it the **side panel**. Each
is a see-through pane over your wallpaper, in your theme and font. A Mac, or any
computer with Tailscale and a browser, can use the host's chats without anything
else installed.

- **Tasks or Chats**: two ways to work, switched with **Tasks | Chats** (or
  `Ctrl+Alt+H`); the app opens on the one you used last, Tasks at first. **Tasks**
  is the whole window with no list: [Today](#today) with every chat a ticket (its
  project, its state, its goal and what it last said, its question's buttons).
  Click one and it opens in place, the chat itself live in it: answer, approve,
  write, **Close chat**, **Open in Chats**, and **Fold** (or `Esc`, or click it
  again) to put it away. One is open at a time, and the page holds still while it
  is. **New chat** (`Ctrl+Alt+N`) puts its box at the top, and the chat it starts
  opens as a ticket. **Chats** is the rest of this section.
- **The list** shows each chat as the phone does. Over it, **New chat**, **Tasks**
  (with how many things are your move) and the cog, Settings (a right click on it,
  or `Ctrl+Alt+M`, opens the Amarchy menu). **New chat** is **What do you want to do?** in the middle, a big box with the
  project and the model under it (the model stays the default of every new chat,
  as on the phone) and the mic. **Today** puts [Today](#today) in the middle, with
  **What do you want to do?** under it: it's what the app opens on
  (a reload stays on its chat, a link to a chat opens that chat); `Esc` in its empty
  box goes back to the chat you were in. A right click on a chat opens its menu.
- **Over the chat**: the chat's name (click: rename) and state, and, while the side
  panel is closed, its tabs as buttons; `⋯` is the chat's menu.
- **The side panel** has three tabs, a click (or a key) away, as wide as you drag
  its left edge (double-click: back to its width), or the whole window (`⤢`,
  `Ctrl+Alt+F`); `✕` closes it. Short of room, the list goes first (zen mode), then
  the panel lies over the chat.
  - **Terminal**: the chat's own terminal (Run and the saved commands over it), or
    **Claude's classic terminal** (see [Chat and terminal](#chat-and-terminal)).
    Both are the real thing: terminals (xterm.js) attached to the chat's tmux on the
    host, so the phone and every browser show the same chat at once. Typing, the
    mouse wheel (tmux's scrollback), selecting (it copies to your clipboard),
    resizing and the Nerd Font icons work as in a terminal of its own; links open in
    a new tab.
  - **Changes**: everything the chat changed, committed or not, new files too,
    against where its branch left its base: a list of the files (New, Edited,
    Deleted, Moved, with their `+`/`−`), then each file's lines, side by side where
    the panel is wide enough (Auto), or as you pick (Side by side, Stacked); the
    branch's own commits above. It reads them again every few seconds while Claude
    works.
  - **Details**: the project, the branch and worktree, the base (commits ahead and
    behind), what's not committed, the last commit; how Claude runs (the chat, or
    Claude's classic terminal, with the switch), its model and mode, the plan's use,
    background sessions and tasks, and the ids. This is where the branch and the
    worktree belong.
- **Show terminals** (Settings → Terminals) decides whether the Terminal tab shows
  at all. Off, it's still in the chat's menu under **Advanced**.

It picks the layout by the window: a wide one with a mouse gets this, a phone the
list and the chat. Settings can fix it to either (**Layout**), change the
terminals' font size, turn on WebGL drawing (faster; the DOM is the default), and
choose whether Option is Alt in the terminals or types characters (for accented
letters).

**Notifications**: Settings turns them on, as on the phone (in Safari, add the app
to the Dock first: File → Add to Dock; Chrome: Install). While the page is open it
also plays the chime (the one picked in [Sound](#sound)) when a chat needs you or is
done, unless it's the one you're looking at. The tab says how many need you, `(2)
Amarchy` (`•` when only finished ones you haven't opened wait), and its icon gets a
dot, red for one that needs you; installed (Add to Dock, Install), the app's icon
carries the count, as the home screen app's does on the phone.

**Links** (in what Claude says, and in the terminals: click one) open in the
default browser, where the device lets a web page get there. On an iPhone or
iPad, the Home Screen app opens them in a Safari sheet whatever the default is,
and Settings → "Open links in" picks a browser for that device (Safari, Chrome,
Firefox, Edge or Brave, through the browser's own address, so it has to be
installed); "As iOS does" is the sheet.

**Pasting an image**: `⌘V` in the chat's box (`Ctrl+V` on other computers), or
dropping it (or any file) on the chat, and it goes with your message (see "The box
you type in" above). In Claude's classic terminal, `⌘V` or `Ctrl+V` pastes it into
Claude's own prompt, and Claude's `Ctrl+V` gets it from amarchy's `wl-paste`. The
host keeps what you last pasted, from any browser or phone, as its clipboard (the
**web clipboard**, `~/.local/state/amarchy/clipboard/web.clip`, yours only), text you
paste or copy in its terminals too, so `wl-paste` in any chat (Claude's own, or
yours in the terminal) prints it.

### Keys

Amarchy's keys are `Ctrl+Alt+…`, which a browser lets a page have. On a Mac,
Control+Option. `Ctrl+Alt+M` opens the amarchy menu, which lists them too.

| Key | |
| --- | --- |
| `Ctrl+Alt+J` / `K` | The chat below / above in the list. |
| `Ctrl+Alt+S` | Search the chats (in zen mode, from the Ⓐ). |
| `Ctrl+Alt+A` | Open the chats list (the Ⓐ button, which is the way to your chats in zen mode). |
| `Ctrl+Alt+Z` | Zen mode: the list hidden (this browser's own). |
| `Ctrl+Alt+←` / `→` | The chat / the terminal. |
| `Ctrl+Alt+L` | Claude's classic terminal in the side panel; again, back to the chat's terminal. |
| `Ctrl+Alt+G` / `I` | Changes / Details in the side panel (again: closed). |
| `Ctrl+Alt+B` / `F` | Open or close the side panel / make it the window's whole width. |
| `Ctrl+Alt+R` / `C` | Run the project / another saved command in the terminal. |
| `Ctrl+Alt+N` / `P` | New chat ("What do you want to do?") / new project. |
| `Ctrl+Alt+H` | Tasks / Chats. |
| `Ctrl+Alt+Up` / `Down` | Raise / lower the chat's priority. |
| `Ctrl+Alt+E` / `M` / `X` | Rename / the amarchy menu / close the chat. |
| `Ctrl+Alt+T` | The look: theme, font and wallpaper (see [Theme](#theme)). |
| `Ctrl+Alt+Space` / `Ctrl+Alt+Enter` | Dictate into the chat's box (or the new chat's): hold it while you speak, or tap it, and tap again when you're done. |

Every menu takes the keys: a chat's menu (its ••• or a right click on it), closing
one, settings, the group & sort menu, the order of your projects, the project for a
new chat, Claude's questions, and the phone's list itself. `↑`/`↓` go from line to
line (buttons side by side, as High · Normal · Low, are one line: `←`/`→` go along
it), `Home`/`End` to the ends, `↵` or `Space` picks, `Tab` stays inside, `Esc`
closes and gives the keys back where they were. In Claude's question a choice's
number picks it and `Esc` says no, as in Claude's own. On a chat in the list, the
menu key (or `Shift+F10`) opens its menu, and `↓` from the search goes into the list.

## Sleep

Every Claude Code holds a few hundred MB of memory, also while it waits for you. So
a chat you're not using **sleeps**: once it has been idle and open nowhere (no
phone and no browser showing it) for the time set in **Settings → Sleep** (1
minute by default; 1, 5, 15 minutes or an hour, or Never), its Claude exits and
lets go of all of it. The conversation stays, and so does the chat's place in the
list.

Go to a sleeping chat and send something: amarchy starts Claude again on the same
conversation (`claude --resume`), with your message as its next one. Typing in the
chat's terminal in a browser wakes it too. Moving through your chats doesn't wake
them; only sending (or typing in the terminal) does.

A chat never sleeps while something would be lost with its Claude:

- it's working, or it's asking you something (a permission, a question);
- a command Claude started is still running in the background (a dev server, a
  build);
- background agents are still at it (its conversation is still moving, or Claude is
  busy);
- a `/loop` or a scheduled task is due to wake it;
- Remote Control is on;
- you're looking at it.

Claude Code **background sessions** (`/bg`) started from a chat are listed in its
Details. When the chat sleeps, those with nothing left to do are stopped as well
(Claude Code keeps their conversations: `claude attach <id>` brings one back).
Running ones are left alone, and so is anything else running from a sleeping
chat's worktree (a dev server you may still want): only closing stops it.

```sh
amarchy sleep              # this chat, now (it says why not, if something would be lost)
amarchy sleep --all        # every chat that can, except those open on a phone or in a browser
amarchy sleep --after 5    # minutes before an idle chat sleeps on its own (default 1, or off)
amarchy wake [id]          # without typing in it
```

`amarchy list` says which ones sleep (`sleeping`). The timer is a systemd user
timer that `install.sh` adds (`amarchy-sleep.timer`): it checks every 30 seconds and
runs nothing in between. After a reboot a chat comes back asleep: opening it doesn't
start its Claude, sending it something does. **Settings → Sleep** has the minutes,
**Never**, and **Put idle chats to sleep now**; a chat's menu has **Wake** and **Put
to sleep**.

## Claude knows it's in amarchy

Each chat's Claude starts knowing where it is: which chat, worktree and branch it's
on, where the project's main checkout is, and that the terminal runs the project.
amarchy's `SessionStart` hook tells it, and does so again after a `/clear` or a
compaction. The **amarchy skill** (`skill/SKILL.md`, which `install.sh` links into
`~/.claude/skills`) has the rest, loaded only when the work calls for it:

- what it can do with the CLI: restart the dev server with `amarchy run`, see the
  other chats, ask you for a secret;
- what it leaves to you: anything that changes what you see, and closing its own
  chat;
- how to merge back into main (**ship**);
- how to talk to the other chats: they are Claude Code instances too, so Claude can
  message them with Claude Code's `ListAgents` and `SendMessage` (`amarchy list`
  gives each one's `agent` name for that), and start a new chat with a task of its
  own (`amarchy new <project> [name] --prompt "..."`).

Claude and the terminal also carry the chat's id in their environment: `AMARCHY=1`,
`AMARCHY_SESSION` (its id) and the variables run commands get (below). So scripts
can tell too, and from there `amarchy run`, `rename` and `close` act on that chat.

## Theme

The look is the app's, on every phone and browser of yours, and it's picked in the
app: **Settings → Look → Theme, font, wallpaper…**, or `Ctrl+Alt+T` in a computer's
browser. Every phone and browser wears it at once.

- **Theme**: Omarchy's 23 themes (Tokyo Night, Catppuccin, Gruvbox, Nord, Rosé
  Pine, Hackerman...), each a card in its own colors with its wallpaper. A theme
  colors the app, the terminals (the chat's and Claude's) with its 16 terminal
  colors, and Claude Code itself in the chats started after it (its own theme,
  `custom:amarchy`).
- **Font**: JetBrains Mono (Omarchy's), Caskaydia Mono or Fira Code, the Nerd Font
  builds with the icons the list uses, or System (the device's own monospace, SF
  Mono on Apple's).
- **Wallpaper**: one of Omarchy's own for the theme, every one Omarchy ships with it
  (a little picture of each to pick from; a theme remembers which), your own
  (choose a picture: it's cut to a phone's screen and a computer's, in the browser),
  or none. The app is a window over it with the gaps around it and a see-through
  background.

  Omarchy's wallpapers aren't amarchy's to hand out, so the host fetches them from
  Omarchy's own repository on GitHub (`basecamp/omarchy`, at the commit
  `themes/backgrounds.json` names, each checked against its hash) and keeps them in
  `~/.local/state/amarchy/wallpapers`, with a phone's cut and a thumbnail of each.
  `install.sh` starts that in the background (about 60 MB) and the app does when one
  is missing; the picker shows how far it is, and what couldn't be fetched, with a
  button to try again (`amarchy theme --refresh-wallpapers` on the host). Once they're
  there it needs no internet. Until one is, its theme wears a wallpaper drawn for it.

On the host, `amarchy theme` does the same:

```sh
amarchy theme --list                          # the themes, fonts and wallpapers, and what's worn
amarchy theme nord --font "fira code" --wallpaper ~/beach.jpg
amarchy theme retro-82 --wallpaper "zen boat"
amarchy theme --show                          # what's picked now
```

The host keeps what's picked in `~/.local/state/amarchy/app/theme`; the themes and
fonts are amarchy's (`themes/`, `fonts/`, with their credits). A look an Omarchy
desktop sent the app from before stays in the list as a theme of its own, marked
"yours", with its colors and its wallpaper, and `amarchy migrate` keeps it. With
nothing ever picked, the app wears Tokyo Night.

How it stays yours: the app listens on the host's localhost only, and `tailscale
serve` puts it on your tailnet over HTTPS, never on the internet (it's not Funnel).
Tailscale tells it who each request comes from, and it answers only the Tailscale
account that owns the host (to let in others, list their logins as `APP_USERS=` in
`~/.config/amarchy/host`). It only takes changes from its own pages, so a website
open on your phone can't drive your chats. A process on the host itself could talk
to it as you, but anything running as you there can drive the chats anyway.

## Sound

The chime plays in a computer's browser, while the app is open, when a chat needs
you or is done. A phone's notifications ring with the phone's own sound. Pick the
chime in the app: **Settings → Sound**, which plays each sound as you tap it, or as
the keys land on it. The host keeps the pick, for the chats or your assistant, and
**Add your own…** there uploads a file from the phone or the computer into
`~/.config/amarchy/sounds/`.

```sh
amarchy sound              # what it is now
amarchy sound tine         # set one: kalimba (the default), vibraphone, tine, fairy, ocean, elementary, herald
amarchy sound --list       # every sound: amarchy's, then yours
amarchy sound off
```

Any sound of your own works: put a `.wav`, `.ogg`, `.oga`, `.opus`, `.flac` or `.mp3`
in `~/.config/amarchy/sounds/` and it shows up in the list under its file name. One
named like one of amarchy's replaces it. Keep it short: it plays in full with every
notification. A browser plays the chime while the app is open; the Ogg ones are made
WAV for it once (Safari plays no Ogg).

`alerts` decides what the other chats tell you about:

```sh
amarchy alerts needs-you   # the default: a chat tells you only when it asks you something
amarchy alerts all         # when one needs you and when one is done
amarchy alerts assistant   # nothing but your assistant
```

With `needs-you`, a chat that asks a question or a permission notifies you; one
that's done doesn't, and is marked done in the list (the filled check) until you
open it. **Settings → Tell me** in the app is the same setting.

`sounds/CREDITS` says where amarchy's come from; `sounds/make.py` makes its own
ones again.

## Dictation

The mic button by a box in the app (a chat's, the new-chat box) writes what you say
into that box: hold it while you speak, or tap it and tap again when you're done. The
words come up as you talk, and the box is yours to edit and send. Two things can
write them down; the app takes the first one there is, and **Settings → Dictation**
on each phone or browser picks another:

- **On the host** (`amarchy dictation setup`, or **Set up dictation on the host** in
  Settings). A speech-to-text model on the host, NVIDIA's
  [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) through
  whisper.cpp's `libparakeet`, writes it down. It knows 25 European languages, Spanish
  and English among them, and tells them apart by itself: dictate in either, or start
  in one and go on in the other after a pause. It costs nothing, and the audio never
  leaves the host. It needs whisper.cpp 1.9 or newer installed there (Arch:
  `sudo pacman -S whisper-cpp`) and the model (670 MB, fetched into
  `~/.local/state/amarchy/dictation`). The model is loaded (about 1 GB of memory) when
  a dictation starts, while you speak, and let go of ten minutes after the last one.
  While you talk, each piece between your pauses is written down for you to see; what's
  kept is written again from longer stretches with their context, and once you let go
  the text is there in about half a second.
- **This browser's**: the browser's own speech recognition (Web Speech: Apple's in
  Safari, Google's in Chrome), in one language you pick in Settings, and sending what
  you say to Apple or Google. It's the fallback where there's no model on the host.
  Not in the home-screen app on an iPhone, where WebKit's often hears nothing.

The keyboard's own dictation (its mic key) works in every box too. On a computer,
`Ctrl+Alt+Space` (or `Ctrl+Alt+Enter`) dictates into the chat's box: hold it, or tap it
and tap again. The phone asks for the microphone the first time you dictate, in that
very tap (an iPhone starts the audio only once your finger lifts, so the microphone is
asked for first, and the audio started on the lift), and a microphone that gives only
silence once held is opened afresh on the spot. `amarchy dictation log` lists each
dictation, and each one whose microphone didn't start, with why.

How the host did on recordings with known text, on this project's 16-vCPU server
(October 2026): 2.5% of the words wrong in Latin American Spanish (Google's FLEURS, 15
clips), 8.5% in English read by native Spanish speakers (the Speech Accent Archive, 13
speakers), writing about 10 seconds of speech per second. Whisper small did 3.4% and
9.3%, three times slower; Whisper large-v3-turbo 1.7% and 6.9%, but slower than real
time on that CPU (a 10-second dictation would take 15 to write down).

```sh
amarchy dictation [--status]          # whether it's set up, and how to set it up if not
amarchy dictation setup               # fetch the model (670 MB)
amarchy dictation log [--json]        # the last dictations, from any phone or browser: which way, how long, what came of it
amarchy dictation transcribe <file>   # write down a recording, as a dictation would be
amarchy dictation remove              # delete the model
```

## Secrets

A key or password a project needs (an OpenAI key for its tests, a Stripe secret) is
given in the app, never in the chat: the transcript keeps everything said there, and
Claude reads it all.

- **Claude asks**: when it needs one, a chat's Claude runs `amarchy secret ask
  OPENAI_API_KEY --why "..."` (the amarchy skill tells it to, instead of asking in the
  chat). The chat needs you, as for a question (a notification says what for), and
  shows a card: *Claude needs your OpenAI API key*, why, a password field (**Show** to
  check it), for this project only or **All projects**, and **Save** (or **Don't give
  it…**, with why if you like). Claude hears only that it's saved, or what you said.
- **You add one**: **Settings → Secrets…** lists them by name (never a value), each
  with **Forget**, and **Add a secret…** (a name, with the usual ones to tap, its
  value, for which project). A chat's menu has **Add a secret…** too. Or on the host:
  `echo "$value" | amarchy secret set NAME --project <name>` (or `--all`; in a
  terminal it asks for the value).
- **Kept** in `~/.config/amarchy/secrets/` (a 0700 folder, 0600 files), outside every
  repo, so nothing commits them: `projects/<project>.env` for one project, `all.env`
  for every one (a project's own wins).
- **Delivered** by name, as environment variables (`$OPENAI_API_KEY`): to Claude's
  commands from the next one, no restart (Claude Code sources them before each Bash
  command); to the chat's terminal from its next prompt (bash: other shells when the
  terminal starts); to its run commands (`amarchy run`). A program already running (a
  dev server) gets one when it starts again (**Run**). Forgotten, it's gone from each
  the same way.
- **Never shown**: Claude can't read the folder (its Read and Edit of it are denied, a
  command reading it is refused), the app masks a secret's value wherever it would
  show (the chat, notifications, the chat engine's log), and `amarchy secret list`
  prints names only.
- **`ANTHROPIC_API_KEY` is refused** (and Claude's other credentials): with one in its
  environment Claude Code bills that API account instead of your subscription. A
  project that calls Anthropic's API keeps its key under a name of its own.

```sh
amarchy secret ask NAME [--why "..."] [--all] [--again]   # from a chat's Claude: the card, and wait
amarchy secret list [--json]                              # names, and for which project
amarchy secret set NAME [--project <name>|--all]          # its value from stdin
amarchy secret forget NAME [--project <name>|--all]       # also: secret rm
```

## Today

**Today** is the app's home (the phone's first tab, with **Chats** beside it; on a
computer its button over your chats, and the middle when no chat is open). It says
what to do now without reading any chat, each chat with its project as a colored
label (higher priority first, then your projects' order), in three parts:

- **Your move**: what a chat asks you, with its buttons (tap one and the answer goes
  to the chat; **Other…** opens it to say more), a permission or a secret to give
  (**Answer** opens the chat at its card), a chat that's blocked, and your
  commitments due by tomorrow, late ones in red. The red number on the tab, the
  app's icon and the browser tab counts what waits on you.
- **Finish**: a chat exists to reach its goal and be closed. A chat whose goal is
  reached says **Done** with **Close** (asked first; it refuses work not shipped, as
  any close); one quiet for two days or more offers **Nudge** (it asks the chat
  where it stands, and to finish or say what it needs) and **Close**.
- **Their move**: the people you wait on (**Chase** once their chase date comes:
  your assistant drafts the message), the chats at work, the rest of your week,
  further out, and the other chats.

Each chat knows its goal and where it stands because every reply ends with a goal
block (amarchy's reply format asks for it): the goal in a sentence, and working,
waiting, blocked or done. It isn't shown in the reply: the goal is under the chat's
name, and a done chat shows **Done · Close chat** over the box you type in.

Your commitments come from a **loops file** of yours (a Markdown file your assistant
keeps), one loop a line:

```text
- [ ] 2026-10-30 · Demo to Felipe · nudge 10-29 · → log/2026-10-27.md
- [ ] waiting · Felipe · the valuation doc · since 10-23 · chase 10-27
- [ ] someday · Pick a gym
- [x] 2026-10-20 · a loop that's done
```

```sh
amarchy today --loops ~/notes/loops.md   # Today reads your loops from there (Settings → Today too)
amarchy today --loops off                # no loops file: Today shows your chats only
amarchy today [--json]                   # Today in a terminal
```

Today only reads that file. **Done** on a loop, and **Chase**, go to [your
assistant](#your-assistant) as a message (`Loop done: …`, `Chase Felipe on: …`),
and it ticks the line and keeps the file; the loop shows **Sent** until it does.
Today adds no notifications of its own.

## Automations

**Automations** (the clock beside the gear in the phone's list; on a computer the
clock in the list's bar, or **Automations** in the Amarchy menu; and Settings) lists
what runs for you by itself on the host: every systemd user timer, your projects'
scheduled jobs and amarchy's own (**Sleep**, **Updates**). Grouped by whose it is (the
project its unit file or its program is in, amarchy's own last), each one says what it
does, when it runs ("Every 15 minutes, 7:00–21:45", "Weekdays at 18:00"), when it runs
next and how the last run went. The clock wears a red dot while one's last run failed.
Tap one for:

- what it does, when, next, its last run (when, ok or why it failed, how long it took)
  and its last ten runs as marks;
- **Run now**: its job, at once, whatever its schedule;
- **Pause…** (it asks first) and **Resume**. Paused, it doesn't run, not even after a
  restart, until you resume it. Nothing is changed or removed: the timer is stopped,
  and a drop-in of amarchy's own (`~/.config/systemd/user/<timer>.d/zz-amarchy-paused.conf`)
  keeps it from starting again, even when a project's install enables it. Uninstalling
  amarchy leaves what you paused paused, and says how to resume each one;
- the timers it armed for itself, under it (a meeting's push and ring under the job
  that reads the calendar), rather than in the list;
- its recent log (the journal's lines for it, systemd's own in grey, errors in red).

It's generic: amarchy knows nothing of a project's jobs. A unit explains itself with
lines systemd ignores (any `X-` key), in its timer or its service:

```ini
[Unit]
Description=Jaken: heartbeat every 15 minutes, 07:00-21:45
X-Amarchy-Name=Heartbeat
X-Amarchy-About=Quick checks every 15 minutes during the day, silent unless something's up.
# Also, if you like:
# X-Amarchy-When=Every 15 minutes, in the day     (else said from OnCalendar=)
# X-Amarchy-Owner=Jaken                           (else the project the unit is in)
# X-Amarchy-Children=meet-*.timer                 (the timers it makes, with systemd-run: shown under it)
```

Without them, `Description=` is its name (less the project's "Jaken: " before it). A
timer made with `systemd-run` shows its `--description`. The system's own timers
(`/usr/lib/systemd/user`, as systemd-tmpfiles-clean) aren't listed unless they have
such lines.

```sh
amarchy automations [--json]          # each one, as the app lists them
amarchy automations log <timer>       # its last lines in the journal
amarchy automations run <timer>       # run its job now
amarchy automations pause <timer>     # until it's resumed, even across restarts
amarchy automations resume <timer>    # back on its schedule
```

## Your assistant

One chat can be your **assistant**: a Claude that keeps your day rather than writing
code (it briefs you in the morning, reminds you of meetings, answers on your phone).
With thirty coding chats in the list it would get lost among them, and so would what
it tells you. So it has a place of its own:

```sh
amarchy assistant <id> [--name <name>]   # this chat is your assistant (named after its project unless you name it)
amarchy assistant                        # which one it is: id, then name
amarchy assistant off                    # a chat like the others again
```

- **In every list** it comes first, above the groups: bigger, with its picture (an
  imp of a retainer with his staff of two heads, `app/assistant.svg`, or yours), its
  name, and its state on a badge at the corner of the picture. The other chats of its
  project (more chats for small personal things) sit under it there, at their usual
  size, and a rule sets them apart from the rest. When it has written something you
  haven't read, its card says **New** by its name and shows the start of what it
  wrote. Opening it anywhere (the phone, the browser) clears it everywhere. Every
  other chat that finished a turn you haven't opened gets the same mark, smaller: a
  dot by its time. In the chat itself, the phone calls it by its name, and the box
  says "Message Jaken".
- **It always tells you** when it needs you or is done, whatever `amarchy alerts`
  lets through of the others: under its name and picture (in a computer's browser it
  stays until you dismiss it), with what it said as the body (a brief's first words),
  and with a chime of its own, `herald` (a knock of the staff and two horn notes;
  `amarchy sound --assistant <name|off>` picks another). What it sends with `amarchy
  notify` goes under its name too, and a tap opens it. On an iPhone a notification
  always wears the app's icon, so there its name is what sets it apart.

Its picture can be yours rather than amarchy's imp:

```sh
amarchy assistant --picture ~/Pictures/jaken.png                    # the middle of it, as big as it goes
amarchy assistant --picture ~/Pictures/jaken.png --crop 400,0,990   # the square at x 400, y 0, 990 pixels across
amarchy assistant --picture off                                     # amarchy's own again
```

It's cut round and square (with ffmpeg, else ImageMagick) and kept in
`~/.config/amarchy` (`assistant.png`, and `assistant-192.png` for the phones'
notifications), not in amarchy. Every list shows it, and the notifications. It goes by
a hash of itself, so a new one shows at once everywhere, the phone's saved copy of the
app included.

In the app all of it is a chat's menu away (its ••• on the phone, a hold on it in the
list, or the menu in a browser): **Make it my assistant…** with its name, and on your
assistant **name, picture, chime…**: rename it, pick its chime, go back to amarchy's
imp, or **Not my assistant any more**. **Choose…** a picture from the phone's photos or
the computer, drag it into the circle and zoom (the slider, the wheel, two fingers, or
the arrows and `+`/`-`), and the page cuts it there and sends the host what's in the
circle. **Settings** has your assistant too.

## From scripts and agents

Two commands do what you'd do from the phone, for a script, a timer or another
chat's Claude (an assistant that keeps your day, say):

```sh
amarchy send <id> "<text>"                                     # to a chat's Claude, as if typed and sent
amarchy notify "<title>" "<body>" [--session <id>] [--urgent]  # to your phones
```

**`amarchy send`** types the text into the chat's Claude the way the phone does
(pasted, then Enter), `-` reading it from stdin. It waits until Claude is free: not in
the middle of a turn, not asking you something (the text would answer it), and nobody
typing in its prompt. A chat whose Claude isn't running (asleep, exited, or after a
reboot) starts again with the message as its first one. Messages for one chat wait
their turn, so they arrive one at a time, in the order sent. It prints `sent to <id>`
once Claude has started on it, and fails (exit 1, saying why) if Claude wasn't free
within an hour (`--timeout <minutes>`) or the chat was closed. `--no-wait` returns at
once, leaving a process of its own to deliver it (a transient systemd unit, so it
outlives whatever called it); from the chat's own Claude it never waits, since the
turn it would wait for is its own. It needs no terminal, so a systemd user timer can
run it, e.g. a morning check-in:

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

**`amarchy notify`** sends a notification of your own to every phone (and browser)
the app notifies, through the same Web Push as the app's own ones (`amarchy app
--test`). Each one stays: it doesn't replace the one before it. Tapping it opens the
chat it was sent from (a chat's Claude sending it), or `--session <id>`'s; from
elsewhere, the app's list. It fails when no phone has turned notifications on.
`--urgent` asks for all a web app may: a push sent at the highest urgency, and on a
computer's browser a notification that stays on screen until you dismiss it. iOS
gives a home screen app nothing more: an urgent one looks and sounds like any other,
stays silent in silent mode, and waits out a Focus that holds back the app's
notifications.

## Install

See [Quick start](#quick-start) for what it needs. `install.sh` is safe to run
again, and keeps a backup of every file of yours it changes (`<file>.amarchy-bak.<time>`,
the last three). It:

- links `bin/amarchy` into `~/.local/bin`, and a `wl-paste` that reads what you paste
  in the app, for the chats' Claude (unless the machine has one of its own);
- installs the amarchy skill for Claude Code (`~/.claude/skills/amarchy`), which
  `skill/` links, so it follows the checkout;
- adds two systemd user timers: `amarchy-sleep.timer`, which puts idle chats to sleep,
  and `amarchy-update.timer`, which keeps amarchy up to date;
- restarts the app if it's on, fetches Omarchy's wallpapers in the background, and
  says whether dictation is set up;
- takes away what an amarchy from before left on an Omarchy desktop (its keys, shell
  plugin, menu entries and theme hook), and brings its state up to date
  (`amarchy migrate`).

`install.sh --host` does the same (it's from when there were desktops too), and
`amarchy app on` starts the app's service (see [Quick start](#quick-start)).

**Updates**: a timer runs `amarchy update` every 5 minutes, which pulls what was
shipped to GitHub into the checkout it runs from (only when it's on main, with nothing
uncommitted) and installs it. Open app pages offer to load the new one. `AUTO_UPDATE=off`
in `~/.config/amarchy/host` stops it; `amarchy update` does it now. `amarchy protocol-check`
runs the chat engine's test against the Claude Code installed, about three minutes and a
few cheap turns on your login, and records the result; a failure shows in Settings. The
update starts it when Claude Code has changed.

`install.sh --uninstall` takes all of that out again; your worktrees, your chats,
`~/.local/state/amarchy` and the secrets you gave in the app are left alone (the
installer tells you where the secrets are, so you can delete them).

Every install points all of it at the checkout it runs from. While it points at another
chat's worktree (that chat is trying its changes on the machine), `install.sh` says
whose it is and asks before replacing it; with no terminal to ask in (Claude running it,
a script) it changes nothing. `--force` goes on without asking. Closing a chat whose
worktree amarchy runs from puts amarchy back on the project's main checkout first, so
nothing is left pointing at a removed worktree.

## Configure

Everything you pick in the app is kept on the host (**Settings**): the sleep time, the
chimes, what tells you, your assistant, the look, the dictation way, the links, Show
terminals, and the projects' order. From the command line, the same settings are the
commands above.

The host's own settings are in `~/.config/amarchy/host`, one `KEY=value` line each:

| Setting | Default | |
| --- | --- | --- |
| `NAME=` | this machine's Tailscale name | How your devices reach what a chat serves. |
| `BIND=` | this machine's Tailscale address | The same. Without Tailscale, a chat serves on localhost only, and you forward the port (`ssh -L 3000:localhost:3000 <host>`). |
| `APP_USERS=` | this machine's owner | The Tailscale logins the app lets in. |
| `APP_PORT=` | `7397` | The app's port, on localhost. |
| `APP_HTTPS=` | `443` | The port on your tailnet (443, 8443 or 10000). |
| `AUTO_UPDATE=off` | on | Stops the timer that keeps amarchy up to date. |

Environment variables (set them where your login environment reads them, so that
the app's service and the chats inherit them):

| Variable | Default | |
| --- | --- | --- |
| `AMARCHY_WORK` | `~/Work` | Every git repo directly inside is offered. |
| `AMARCHY_WORKTREES` | `$AMARCHY_WORK/.worktrees` | Worktrees go to `<this>/<repo>/<name>`. |
| `AMARCHY_CLAUDE_ARGS` | `--permission-mode auto` | Extra arguments for `claude`. Unset, they come from `~/.config/amarchy/claude-args` when it exists (one line, e.g. `--dangerously-skip-permissions`), so every way a chat starts gets them. |
| `AMARCHY_SHORT_NAMES` | `on` | `off` to list chats by Claude Code's titles as they are, not cut down to "Keyword: a few words". |

Projects you add are the git repos in `AMARCHY_WORK`. A project's run command and
its saved commands are kept per project (`amarchy run --set` and `--save`), so every
chat of the project shares them.

## CLI

Every action in the app is a command, in the Omarchy spirit: anything you can do
with a tap or a key, a script or an AI agent can do too. Commands print results to
stdout (JSON with `--json`) and exit non-zero on failure. `amarchy help` lists them
all, and `amarchy <command> --help` (or `amarchy help <command>`) prints one
command's usage without running it; an option a command doesn't know is an error, so
a typo never acts on a chat. The CLI says **session** for a chat.

```
amarchy help [command]                the commands, or the usage of one

Projects (git repos directly inside AMARCHY_WORK):
amarchy projects [--json]             your projects and their session counts
amarchy projects --github [--json]    your GitHub repos (✓ = already added)
amarchy projects order [project...]   the order your projects come in: prints it, or puts these first
amarchy projects move <project> up|down|top|bottom
amarchy projects move <project> before|after <other>
amarchy add <owner/repo|git url>      clone a project (prints its path)
amarchy add --new <name> [--github]   start an empty project (and a private GitHub repo)

Sessions (chats):
amarchy new <project> [name]          create a session (a name like wobbly-bakunin if omitted); prints its id
amarchy new <project> [name] --prompt <text|->   the same, with the first thing its Claude is asked (- reads stdin)
amarchy new <project> [name] --model <model>     on that model (opus, sonnet, haiku, a model id) instead of the
                                      new chat's default (the app's new chat picks it; Opus until you do)
amarchy send <id> <text|-> [--no-wait] [--timeout <minutes>]   a message for its Claude, once Claude is free
amarchy list [--compact]              sessions as JSON, in list order (task, age, agent, engine...)
amarchy close [id] [--force]          close a session (the current one if no id); --force discards uncommitted changes
amarchy rename <title>                name the current session
amarchy rename --id <id> <title>      the same for another; --reset goes back to the name from Claude's title
amarchy run                           run the project in the session's terminal (again: restart it)
amarchy run --show | --set <command>  the project's run command (guessed from the repo until you set one)
amarchy run <name>                    run another saved command of the project, the same way
amarchy run --save <name> <command>   save one; --forget <name> drops it
amarchy run --list                    the project's saved commands, name and command
amarchy priority [high|normal|low|up|down] [--id <id>]   how much it matters (prints it without a level)
amarchy group [project|priority|status] [on|off]         group the list (switches without on|off)
amarchy group <grouping> <grouping>...                   group by these, nested in this order
amarchy sort [priority|newest|oldest]                    sort the list inside its groups
amarchy sleep [id] [--force]          put a session to sleep (says why not when something would be lost)
amarchy sleep --all [--force]         every session that can sleep, except those open on a phone or in a browser
amarchy sleep --after [minutes|off]   how long an idle session waits before it sleeps on its own (default 1)
amarchy wake [id]                     wake a session without typing in it

The app:
amarchy app on | off                  serve the app on your tailnet (https://<this machine>.<tailnet>.ts.net), now and after every reboot
amarchy app [--status]                whether it's on, where, and how many phones and browsers it notifies
amarchy app --test                    send each phone a test notification
amarchy notify <title> [body] [--session <id>] [--urgent]   a notification of your own on each phone (and browser)

Look and sound:
amarchy theme [--show]                print the theme, the font and the wallpaper
amarchy theme <name>                  wear one of amarchy's themes
amarchy theme --font <name>           the font
amarchy theme --wallpaper theme|<one of the theme's>|own|none|<picture>
amarchy theme --list [--json]         the themes, fonts and wallpapers, and what's worn
amarchy theme --refresh-wallpapers [--in-background]   fetch Omarchy's wallpapers that aren't here yet
amarchy sound [--show]                print the chime
amarchy sound <name> | off            set it (one of --list, or off)
amarchy sound --list [--json]         every sound: amarchy's, then yours

Your assistant and alerts:
amarchy assistant                     which session it is, or none
amarchy assistant <id> [--name <name>]   make a session your assistant
amarchy assistant off                 no assistant: a session like the others again
amarchy assistant --picture <file>|off [--crop x,y,size]   its picture
amarchy sound --assistant [name|off]  its chime
amarchy alerts [all|needs-you|assistant]   what the other sessions tell you about (prints it without one)

Dictation:
amarchy dictation [--status]          whether it's set up, and how to set it up if not
amarchy dictation setup               fetch the speech model (Parakeet TDT 0.6B v3, 670 MB)
amarchy dictation remove              delete the model again
amarchy dictation log [--json]        the last dictations and how each went
amarchy dictation transcribe <file>   write down a recording, as a dictation would be

Today:
amarchy today [--json]                what needs you, what's due, who you wait on, each chat's goal and state
amarchy today --loops [<file>|off]    your loops file, or none (prints it without one)

Automations:
amarchy automations [--json]          what runs by itself (systemd user timers): what, when, next, last
amarchy automations log <timer>       its last lines in the journal
amarchy automations run|pause|resume <timer>   run it now; stop it until resumed; back on its schedule

Secrets:
amarchy secret ask <NAME> [--why <text>] [--all] [--again] [--timeout <seconds>]
amarchy secret list [--json]          the secrets' names and for which project (never a value)
amarchy secret set <NAME> [--project <name>|--all]
amarchy secret forget <NAME> [--project <name>|--all]   (also: secret rm)

Terminals and updating:
amarchy terminals [on|off]            Show terminals: whether the app shows the chats' terminals
amarchy protocol-check [--broker]     run the chat engine's protocol test for the Claude Code installed, and record it
amarchy update                        to the latest amarchy on GitHub (origin's main), and install it
amarchy migrate                       bring the state from before (a desktop's) up to date, once

Engine (for the chat engine's own use and for debugging):
amarchy agent engine <id> [chat|terminal] [--force]   which engine a session's Claude runs on
amarchy agent state|watch <id>        its live state (JSON) / everything Claude says, as it comes
amarchy agent send <id> <text|-> [--next|--now|--later]
amarchy agent answer <id> <request> allow|always|deny [why]
amarchy agent interrupt <id> [--all]  Stop (--all: and drop what's queued)
amarchy agent mode|model <id> <value> switch the permission mode or the model
```

The app, the timers and Claude's hooks use the rest of the commands (`attach`,
`shell`, `hook`, `seen`, `paste`, `reap`, `held`, `shorten`, the `claude`, `asleep`
and `woke` steps of a chat's Claude pane). `amarchy help` lists them with what they do.

Run commands can use `$AMARCHY_PATH` (the worktree), `$AMARCHY_NAME`,
`$AMARCHY_BRANCH`, `$AMARCHY_REPO` and `$AMARCHY_ROOT` (the project's main checkout),
so one command fits every chat of the project. amarchy's own, to try a worktree as the
installed copy:

```
amarchy run --set '$AMARCHY_PATH/install.sh && systemctl --user restart amarchy-app'
```

A project can have more saved commands next to its run command, each with a name:
`amarchy run <name>` runs one, and the terminal's **Commands…** lists them. amarchy's
own, to put the installed copy back on the main checkout once a change is done:

```
amarchy run --save main '$AMARCHY_ROOT/install.sh && systemctl --user restart amarchy-app'
```

Trying a worktree while another chat's is the installed copy asks first (see
[Install](#install)), so one chat doesn't silently take over another's live build.

Each new worktree is pre-trusted in `~/.claude.json` so Claude starts without the
folder trust prompt, and the entry is removed again on close.

## License

[MIT](../LICENSE). The notification sounds in `sounds/` keep their own licenses,
listed in [`sounds/CREDITS`](../sounds/CREDITS).
