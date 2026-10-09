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
| `Super+Alt+N` | New session: pick a repo, name it. Creates the worktree, branch, Claude and terminal. |
| `Super+Alt+M` | Toggle the cockpit on a session workspace. |

In Mission Control: `↵` jump to a session, `n` new, `x` close (removes the
worktree, asks first if it has uncommitted changes, deletes the branch if it
was merged), `j`/`k` move.

You get a notification when a session you're not looking at needs input or
finishes its turn (via Claude Code hooks, nothing to configure).

## Install

Needs Omarchy (Hyprland Lua config), [Claude Code](https://docs.claude.com/en/docs/claude-code),
`gum`, and one of foot, kitty, alacritty or ghostty.

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
amarchy = { mod = "SUPER + ALT", new_key = "N", cockpit_key = "M" }
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

```
amarchy new [repo] [name]   create a session (prompts when args are missing)
amarchy close [id]          close a session (current one if no id)
amarchy jump <id>           go to a session
amarchy cockpit             toggle Mission Control + terminal
amarchy list                sessions as JSON
amarchy layout              resize the zen column for the current monitor
```

Each new worktree is pre-trusted in `~/.claude.json` so Claude starts without
the folder trust prompt, and the entry is removed again on close.
