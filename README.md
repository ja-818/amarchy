# amarchy

Parallel Claude Code agents, one Hyper key away. For [Omarchy](https://omarchy.org).

Every session is its own git worktree and branch off the latest `main`, on its
own Hyprland workspace: Claude Code in a centered column, your sessions in the
gap to its left and the session's terminal (it opens in the worktree) in the
gap to its right:

```
 [Ⓐ Amarchy] [󰐕 New session] │                     │
 [󰍉 Search sessions] [󰉋] [󰉹] │                     │ $ npm run dev
                             │                     │
 󰂞  Fix the login redirect 4m│       claude        │
    my-app · wobbly-bakunin  │    (column, 900)    │
 ⠋  Billing export       12m │                     │
    my-app · smug-goldman    │                     │
 󰄬  Tidy the README       1h │                     │
    docs · sleepy-kropotkin  │                     │
```

The list is drawn by the Omarchy shell (a shell plugin) with the same type,
rows and selection as the Omarchy menu, in the order you opened them, so a
session keeps its place. Click one to jump to it.

Above it there is only what you reach for: **Ⓐ Amarchy** (the menu: everything
else amarchy does, each with its key), **New session** and a **search**. Click it
and type a few letters of a session's name (what it's about, its project or its
branch): the list narrows as you type, `↑`/`↓` move, `↵` jumps there, `Esc`
brings the whole list back. `Ctrl+Alt+S` does the same without the mouse, in
the list under the Ⓐ.

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

Next to the search are two switches for grouping the list, lit while on:
**by project** (󰉋, one section per project, each row showing just its branch)
and **by status** (󰉹, by what they need from you: Needs you, Working, Idle,
Asleep). Use either one, or both for the status sections inside each project.
With neither, they're in the order you opened them. In the list under the Ⓐ,
`p` and `s` do the same; from a script, `amarchy group project` and `amarchy
group status`. The choice sticks.

## Keys

| Key | |
| --- | --- |
| `Super+Alt+A` | Open amarchy: back to your last session. Starts a new one if there are none. |
| `Super+Alt+N` | New session: pick a project, that's it. Creates a worktree on a fresh branch named after a famous anarchist with a silly adjective (`wobbly-bakunin`, `caffeinated-goldman`), Claude and a terminal. |
| `Ctrl+Alt+J` / `K` | Inside amarchy: the session below / above in the list, wrapping around. |
| `Ctrl+Alt+S` | Search: the list drops from the Ⓐ with the keyboard in its search. Type to find a session by name, `↵` jumps to it, `Esc` goes to the list itself: `j`/`k` and `↵` to jump, `/` to search again, `p` / `s` to switch grouping by project / by status, `Esc` to dismiss. |
| `Ctrl+Alt+Z` | Zen mode: Claude alone, without the sessions and the terminal beside it. Again brings them back. |
| `Ctrl+Alt+Return` | Move the keyboard between Claude and the terminal. In zen mode it leaves zen mode, since the terminal lives beside Claude. |
| `Ctrl+Alt+R` | Run the project in that terminal (`bin/dev`, `npm run dev`, `cargo run`... guessed from the repo; it asks when it can't tell). Again restarts it. Change it with `amarchy run --set`. |
| `Ctrl+Alt+C` | The project's other saved commands: pick one to run in that terminal, or save a new one. |
| `Ctrl+Alt+N` / `A` | New session / add project. |
| `Ctrl+Alt+T` | Pick the theme amarchy wears (see [Theme](#theme)). |
| `Ctrl+Alt+E` | Name this session yourself. The name sits in the list (and in zen mode in the strip above Claude), in place of the title Claude came up with. |
| `Ctrl+Alt+M` | The amarchy menu: everything here in one list, each with its key next to it. The one to remember. |
| `Ctrl+Alt+X` | Close this session. Asks first: it removes the worktree (and says so when uncommitted changes would be lost). |
| `Super+arrows` | Between Claude and the terminal, like any Omarchy windows. |
| `Super+Space` | **Amarchy** is in the Omarchy menu: sessions, new session, add project, close. |

The **Ⓐ in the bar** lights up when a session needs you; click it for your
sessions, right click for a new one.

New session opens the Omarchy menu. The project list ends with **Add
project**: pick one of your GitHub repos (searchable, most recently pushed
first), paste a git URL, or start an empty project (optionally with a private
GitHub repo), and the session starts right on it.

Closing a session (`Ctrl+Alt+X`) removes its worktree, asks first if it has
uncommitted changes, and deletes the branch if it was merged.

Windows are disposable, like everywhere else in Omarchy. Close Claude or the
terminal with `Super+W` (or let Claude exit) and the session just goes to sleep:
the list shows it as asleep, and jumping to it reopens what's missing,
with Claude picking its last conversation back up (`claude --continue`). A
session only really ends with `Ctrl+Alt+X` or `amarchy close`, which
also removes the worktree.

You get a notification when a session you're not looking at needs input or
finishes its turn (via Claude Code hooks, nothing to configure). It reads like
the session's row in the list: a bell or a check, what the session is about,
and project · branch under it. Click it to go to that session. It comes with a chime: two notes going up when
the session needs you, one settled note when it's done (`AMARCHY_SOUND=off` for
none; they are the two files in `sounds/`, replace them with your own).

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
- how to merge back into main.

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
amarchy theme              # pick one: Ctrl+Alt+T, Theme in the amarchy menu (Ctrl+Alt+M), or Super+Space → Amarchy → Theme
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

## Install

Needs Omarchy 4+ (Hyprland Lua config, the Omarchy shell and menu), [Claude Code](https://docs.claude.com/en/docs/claude-code),
and one of foot, kitty, alacritty or ghostty.

```sh
git clone https://github.com/ja-818/amarchy ~/.local/share/amarchy
~/.local/share/amarchy/install.sh
```

Put your repos in `~/Work` (or set `AMARCHY_WORK`). Update with `git pull`.
Remove with `install.sh --uninstall`.

## Configure

Keys: set a table before the `dofile(... amarchy.lua)` line in
`~/.config/hypr/hyprland.lua`:

```lua
amarchy = { mod = "SUPER + ALT", open_key = "A", new_key = "N",
            nav_mod = "CTRL + ALT", next_key = "J", prev_key = "K", search_key = "S", zen_key = "Z", terminal_key = "RETURN", run_key = "R", commands_key = "C",
            nav_new_key = "N", add_key = "A", theme_key = "T", rename_key = "E", close_key = "X", menu_key = "M" }
```

Everything else is environment variables (set them in `~/.config/uwsm/env`):

| Variable | Default | |
| --- | --- | --- |
| `AMARCHY_WORK` | `~/Work` | Every git repo directly inside is offered. |
| `AMARCHY_WORKTREES` | `$AMARCHY_WORK/.worktrees` | Worktrees go to `<this>/<repo>/<name>`. |
| `AMARCHY_TERMINAL` | first installed | `foot`, `kitty`, `alacritty` or `ghostty`. |
| `AMARCHY_ZEN_WIDTH` | `900` | Claude column width in logical pixels; the sessions and the terminal share what's left. Run `amarchy layout` after changing it. |
| `AMARCHY_HEADER_HEIGHT` | `30` | Height of the strip above Claude with the session's name in zen mode, `0` for none. Run `amarchy layout` after changing it. |
| `AMARCHY_CLAUDE_ARGS` | `--permission-mode auto` | Extra arguments for `claude`. |
| `AMARCHY_SOUND` | `on` | `off` for notifications without the chime. |

## CLI

Every action in the UI is a command, in the Omarchy spirit: anything you can
do with a key, a script or an AI agent can do too. Commands print results to
stdout (JSON with `--json`) and exit non-zero on failure.

```
amarchy projects [--json]             your projects and their session counts
amarchy projects --github [--json]    your GitHub repos (✓ = already added)
amarchy add <owner/repo|git url>      clone a project (prints its path)
amarchy add --new <name> [--github]   start an empty project (and a private GitHub repo)
amarchy add                           add a project interactively

amarchy new [project] [name]          create a session (menu without a project; name like wobbly-bakunin if omitted)
amarchy list                          sessions as JSON
amarchy open                          go to the last session you were in
amarchy next | prev                   go down | up one session in the list (wraps around)
amarchy jump <id>                     go to a session
amarchy close [id] [--force]          close a session (current one if no id)
amarchy close [id] --confirm          the same, asking first in the Omarchy menu
amarchy rename [title]                name the current session (asks in the Omarchy menu if omitted)
amarchy rename --id <id> [title]      the same for another session; --reset goes back to Claude's own title
amarchy zen [on|off]                  toggle zen mode: Claude alone, nothing beside it
amarchy terminal [on|off]             between Claude and the terminal (leaves zen mode)
amarchy run                           run the project in the session's terminal (again: restart it)
amarchy run --show | --set [command]  the project's run command (guessed from the repo until you set one)
amarchy run <name>                    run another saved command of the project, the same way
amarchy run --save <name> [command]   save one; --forget <name> drops it
amarchy run --list                    the project's saved commands
amarchy run --pick                    choose one in the Omarchy menu, or save a new one there
amarchy show                          open the session list under the Ⓐ in the bar
amarchy search                        type to find a session by name, in the list under the Ⓐ
amarchy pick [close]                  choose a session in the Omarchy menu, jump to it (or close it)
amarchy menu                          everything you can do from here, with its key, in the Omarchy menu
amarchy theme [name|system]              amarchy in its own Omarchy theme (Omarchy's theme switcher without a name; --show prints it)
amarchy group [project|status] [on|off]  group the list by project and/or status (switches without on|off)
amarchy group none                    no grouping: the order you opened them in (the default)
amarchy layout                        resize Claude's column for the current monitor
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

Each new worktree is pre-trusted in `~/.claude.json` so Claude starts without
the folder trust prompt, and the entry is removed again on close.
