# amarchy

Parallel Claude Code agents, one Hyper key away. For [Omarchy](https://omarchy.org).

Every session is its own git worktree and branch off the latest `main`, with a
Claude Code window and a dev terminal on its own Hyprland workspace. Claude sits
alone in a centered zen column. One key toggles the cockpit: **Mission Control**
slides into the left gap and the session's terminal into the right one.

```
┌──────────────┬───────────────────────────┬──────────────┐
│ MISSION      │                           │ $ npm test   │
│ CONTROL      │        claude             │              │
│              │                           │              │
│ MY-APP       │   (zen column, 900px)     │              │
│ ▸ ● login    │                           │              │
│   ◆ billing  │                           │              │
│   ○ docs     │                           │              │
└──────────────┴───────────────────────────┴──────────────┘
  ● working   ◆ needs you   ○ idle
```

## Keys

| Key | |
| --- | --- |
| `Super+Alt+A` | Open amarchy: back to your last session, or cycle to the next one if you're already in a session. Starts a new one if there are none. |
| `Super+Alt+N` | New session: pick a project, that's it. Creates a worktree on a fresh branch named after a famous anarchist with a silly adjective (`wobbly-bakunin`, `caffeinated-goldman`), Claude and a terminal. |
| `Super+Alt+M` | Toggle the cockpit on a session workspace. |

New session opens the Omarchy menu, so it looks and searches like Super+Space.
The project list ends with **Add project**: pick one of your
GitHub repos (searchable, most recently pushed first), paste a git URL, or start
an empty project (optionally with a private GitHub repo), and the session starts
right on it.

In Mission Control: `↵` jump to a session, `n` new, `a` add project, `x` close (removes the
worktree, asks first if it has uncommitted changes, deletes the branch if it
was merged), `j`/`k` move.

You get a notification when a session you're not looking at needs input or
finishes its turn (via Claude Code hooks, nothing to configure).

## Install

Needs Omarchy 4+ (Hyprland Lua config and the Omarchy menu), [Claude Code](https://docs.claude.com/en/docs/claude-code),
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
amarchy = { mod = "SUPER + ALT", open_key = "A", new_key = "N", cockpit_key = "M" }
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
amarchy layout                        resize the zen column for the current monitor
```

Each new worktree is pre-trusted in `~/.claude.json` so Claude starts without
the folder trust prompt, and the entry is removed again on close.
