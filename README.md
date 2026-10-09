# amarchy

Parallel Claude Code agents, one Hyper key away. For [Omarchy](https://omarchy.org).

Every session is its own git worktree and branch off the latest `main`, with a
Claude Code window and a dev terminal on its own Hyprland workspace. Claude sits
alone in a centered zen column. One key toggles the cockpit: **Mission Control**
in the left gap, the session's terminal in the right one.

Mission Control is drawn by the Omarchy shell itself (a shell plugin), so it
looks like the Omarchy menu: same type, same rows, same selection. Sessions
are grouped by what they need from you, and the one on screen wears
Hyprland's focus border:

```
 Amarchy…                    │                     │
                             │                     │
 NEEDS YOU                   │                     │ $ npm test
 󰂞  Fix the login redirect 4m│       claude        │
    my-app · wobbly-bakunin  │  (zen column, 900)  │
 WORKING                     │                     │
 ⠋  Billing export       12m │                     │
    my-app · smug-goldman    │                     │
 IDLE                        │                     │
 󰄬  Docs pass             1h │                     │
    docs · feral-kropotkin   │                     │
```

## Keys

| Key | |
| --- | --- |
| `Super+Alt+A` | Open amarchy: back to your last session, or cycle to the next one if you're already in a session. Starts a new one if there are none. |
| `Super+Alt+N` | New session: pick a project, that's it. Creates a worktree on a fresh branch named after a famous anarchist with a silly adjective (`wobbly-bakunin`, `caffeinated-goldman`), Claude and a terminal. |
| `Super+Alt+Z` | Toggle the cockpit on a session workspace. |
| `Super+Alt+M` | Give Mission Control the keyboard: `j`/`k` move, `↵` jump, `n` new, `a` add project, `x` close, `Esc` back. |
| `Super+Space` | **Amarchy** is in the Omarchy menu: sessions, new session, add project, close. |

The **Ⓐ in the bar** lights up when a session needs you; click it for your
sessions, right click for a new one.

New session opens the Omarchy menu. The project list ends with **Add
project**: pick one of your GitHub repos (searchable, most recently pushed
first), paste a git URL, or start an empty project (optionally with a private
GitHub repo), and the session starts right on it.

Closing a session (`x`) removes its worktree, asks first if it has
uncommitted changes, and deletes the branch if it was merged.

Windows are disposable, like everywhere else in Omarchy. Close Claude or the
terminal with `Super+W` (or let Claude exit) and the session just goes to sleep:
Mission Control shows it as asleep, and jumping to it reopens what's missing,
with Claude picking its last conversation back up (`claude --continue`). A
session only really ends with `x` in Mission Control or `amarchy close`, which
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
amarchy = { mod = "SUPER + ALT", open_key = "A", new_key = "N", cockpit_key = "Z", focus_key = "M" }
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
amarchy open                          go to the last session, or the next one if in one
amarchy jump <id>                     go to a session
amarchy close [id] [--force]          close a session (current one if no id)
amarchy cockpit                       toggle Mission Control + terminal
amarchy focus                         give Mission Control the keyboard
amarchy pick [close]                  choose a session in the Omarchy menu, jump to it (or close it)
amarchy layout                        resize the zen column for the current monitor
```

Each new worktree is pre-trusted in `~/.claude.json` so Claude starts without
the folder trust prompt, and the entry is removed again on close.
