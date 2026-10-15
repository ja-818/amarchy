---
name: amarchy
description: >
  You are running inside amarchy when AMARCHY=1 / AMARCHY_SESSION is set or your
  session started with "This Claude Code session runs inside amarchy". Use this
  skill before running any `amarchy` command, and whenever the work involves this
  session's worktree or branch, other sessions, the dev terminal beside you
  (running, restarting or saving the project's commands), naming the session, or
  merging the work back into main ("ship it").
---

# amarchy

amarchy runs the user's Claude Code sessions in parallel on their Omarchy
desktop. Each **session** is:

- a **git worktree** on its own **branch**, made from the latest main
  (`$AMARCHY_PATH`, branch `$AMARCHY_BRANCH`), under
  `~/Work/.worktrees/<project>/<name>` by default;
- **you**, Claude Code, in a centered column on the session's own Hyprland
  workspace;
- the session's **terminal** on your right, opened in the same worktree. The
  project runs there (`bin/dev`, `npm run dev`...);
- one row in the **session list** on your left (and under the Ⓐ in the bar):
  status glyph, what the session is about, `project · branch`.

The other sessions are other Claude Code instances, each in a worktree of its
own. The project's **main checkout** is `$AMARCHY_ROOT` (`~/Work/<project>`).

## Your environment

Set in your shell and in the terminal beside you:

| Variable | |
| --- | --- |
| `AMARCHY` | `1`: you're inside amarchy. |
| `AMARCHY_SESSION` | This session's id (`<project>-<name>`). `amarchy` commands that act on "the current session" use it, whatever is on screen. |
| `AMARCHY_PATH` | This worktree. |
| `AMARCHY_NAME` | The session's name, e.g. `wobbly-bakunin`. |
| `AMARCHY_BRANCH` | Its branch (usually the same as the name). |
| `AMARCHY_REPO` | The project, i.e. the repo's folder name in `~/Work`. |
| `AMARCHY_ROOT` | The project's main checkout. |

## The CLI

Every command prints its result to stdout and exits non-zero on failure.
`amarchy --help` lists all of them.

### Use freely

- `amarchy list --compact`: all sessions as JSON, in list order: `id`, `repo`,
  `name`, `branch`, `path`, `status` (`waiting` = needs the user, `working`,
  `idle`, `asleep` = window closed), `priority` (`high`, `normal`, `low`),
  `task` (what it's about), `current` (on screen).
- `amarchy projects --json`: the user's projects and how many sessions each has.
- `amarchy run --show` / `amarchy run --list`: the project's run command / all
  its saved commands (`name<TAB>command`).
- `amarchy run`: (re)start the project's run command in the terminal beside
  you. Use it after a change the running dev server won't pick up by itself
  (new dependency, config, migrations, server code without reload), or when the
  user asks. If this session is on screen, the terminal shows (this leaves zen
  mode). If not, it restarts quietly in place.
- `amarchy run <name>`: run another saved command the same way.

You **can't read that terminal's output**: it's the user's. To check that
something works, run it yourself in your own shell (tests, a build, `curl` the
dev server). Restart the terminal so the user sees the result too.

### Only when the user asks

- `amarchy priority high|normal|low|up|down [--id <id>]`: how much a session
  matters to the user. The list puts higher priority first. Without a level it
  prints it (that you can do freely); only set it when asked.
- `amarchy rename "<what it's about>"`: name the session in the list and the
  strip above you. Claude Code's own title is shown until then, so don't rename
  unprompted. Never overwrite a name the user gave (`title` in `amarchy list`).
  `amarchy rename --reset` goes back to Claude's title.
- `amarchy run --set '<command>'` / `amarchy run --save <name> '<command>'` /
  `amarchy run --forget <name>`: change the project's saved commands (shared by
  all its sessions). Commands start in the worktree and can use the variables
  above. Single-quote them so they expand per session, e.g.
  `amarchy run --set '$AMARCHY_PATH/install.sh && omarchy-restart-shell'`.
- `amarchy new <project> [name]`: start another session. **It takes the user's
  screen to it.**
- `amarchy add <owner/repo|url>` / `amarchy add --new <name> [--github]`: add a
  project.
- `amarchy close <id>`: close **another** session. It removes that worktree and
  refuses if it has uncommitted changes. Never add `--force` without explicit
  approval: it discards them.

### Never on your own

- `amarchy close` with no id closes **this** session: your own window and your
  worktree. Don't.
- `jump`, `next`, `prev`, `open`, `show`, `search`, `pick`, `menu`, `zen`,
  `terminal`, `theme`, `group`, `layout`: these move or repaint what the user is
  looking at. Run them only when asked, as the action itself.
- `hook`, `ui`, `watch` are amarchy's own plumbing. Don't edit
  `~/.local/state/amarchy/` either.

## Git in a session

- Work and commit on this session's branch, in `$AMARCHY_PATH`. Don't switch
  this worktree to another branch, and don't touch other sessions' worktrees.
- To catch up with main: `git fetch origin && git rebase origin/main`, or
  merge.
- The git stash is shared by every worktree of the repo, so other sessions see
  it. Prefer a WIP commit. If you must stash, use a uniquely tagged entry and
  apply it by SHA; never a bare `git stash pop`.
- **Shipping** (only when asked, and the project's own instructions come
  first):
  1. Commit on this branch.
  2. In `$AMARCHY_ROOT`, which normally stays on main: `git pull`, then
     `git merge $AMARCHY_BRANCH`, then `git push`.
  3. Say what landed.

  The session stays open after a merge. Only the user closes it.

## Notifications

amarchy already notifies the user (with a chime) when you stop or need their
input, and their list shows your status live. Don't add notifications of your
own for that.
