# amarchy

Parallel Claude Code agents, one Hyper key away. For [Omarchy](https://omarchy.org).

Every session is its own git worktree and branch off the latest `main`, with
Claude Code alone in a centered zen column on its own Hyprland workspace. One
key slides the session's terminal in underneath, like the panel in an editor.

Your sessions live under the **Ⓐ in the bar**, drawn by the Omarchy shell (a
shell plugin) with the same type, rows and selection as the Omarchy menu, and
grouped by what they need from you. The Ⓐ lights up when one needs you, and
the list drops for a moment when you move between sessions:

```
                                              Ⓐ
              ┌─────────────────────┐   ┌──────────────────────────────┐
              │                     │   │ NEEDS YOU                    │
              │       claude        │   │ 󰂞  Fix the login redirect 4m │
              │  (zen column, 900)  │   │    my-app · wobbly-bakunin   │
              │                     │   │ WORKING                      │
              ├─────────────────────┤   │ ⠋  Billing export        12m │
              │ $ npm run dev       │   │    my-app · smug-goldman     │
              └─────────────────────┘   └──────────────────────────────┘
```

## Keys

| Key | |
| --- | --- |
| `Super+Alt+A` | Open amarchy: back to your last session. Starts a new one if there are none. |
| `Super+Alt+L` | Drop the session list from the Ⓐ, from anywhere: see what every agent is up to at a glance, `j`/`k` and `↵` to jump to one, `Esc` to dismiss. |
| `Super+Alt+N` | New session: pick a project, that's it. Creates a worktree on a fresh branch named after a famous anarchist with a silly adjective (`wobbly-bakunin`, `caffeinated-goldman`), Claude and a terminal. |
| `Ctrl+Alt+J` / `K` | Inside amarchy: the session below / above in the list, wrapping around. The list drops from the Ⓐ for a moment so you see where you landed. |
| `Ctrl+Alt+Return` | Toggle the session's terminal under Claude (it opens in the worktree). On puts the keyboard in it, off gives it back to Claude. |
| `Ctrl+Alt+R` | Run the project in that terminal (`bin/dev`, `npm run dev`, `cargo run`... guessed from the repo; it asks when it can't tell). Again restarts it. Change it with `amarchy run --set`. |
| `Ctrl+Alt+C` | The project's other saved commands: pick one to run in that terminal, or save a new one. |
| `Ctrl+Alt+N` / `A` | New session / add project. |
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
finishes its turn (via Claude Code hooks, nothing to configure).

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
amarchy = { mod = "SUPER + ALT", open_key = "A", new_key = "N", list_key = "L",
            nav_mod = "CTRL + ALT", next_key = "J", prev_key = "K", terminal_key = "RETURN", run_key = "R", commands_key = "C",
            nav_new_key = "N", add_key = "A", close_key = "X" }
```

Everything else is environment variables (set them in `~/.config/uwsm/env`):

| Variable | Default | |
| --- | --- | --- |
| `AMARCHY_WORK` | `~/Work` | Every git repo directly inside is offered. |
| `AMARCHY_WORKTREES` | `$AMARCHY_WORK/.worktrees` | Worktrees go to `<this>/<repo>/<name>`. |
| `AMARCHY_TERMINAL` | first installed | `foot`, `kitty`, `alacritty` or `ghostty`. |
| `AMARCHY_ZEN_WIDTH` | `900` | Claude column width in logical pixels. Run `amarchy layout` after changing it. |
| `AMARCHY_CLAUDE_ARGS` | `--permission-mode auto` | Extra arguments for `claude`. |

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
amarchy terminal [on|off]             toggle the session's terminal under Claude
amarchy run                           run the project in the session's terminal (again: restart it)
amarchy run --show | --set [command]  the project's run command (guessed from the repo until you set one)
amarchy run <name>                    run another saved command of the project, the same way
amarchy run --save <name> [command]   save one; --forget <name> drops it
amarchy run --list                    the project's saved commands
amarchy run --pick                    choose one in the Omarchy menu, or save a new one there
amarchy show                          open the session list under the Ⓐ in the bar
amarchy pick [close]                  choose a session in the Omarchy menu, jump to it (or close it)
amarchy layout                        resize the zen column for the current monitor
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
