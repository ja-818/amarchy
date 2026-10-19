---
name: amarchy
description: >
  You are running inside amarchy when AMARCHY=1 / AMARCHY_SESSION is set or your
  session started with "This Claude Code session runs inside amarchy". Use this
  skill before running any `amarchy` command, and whenever the work involves this
  session's worktree or branch, other sessions (starting one with a task,
  messaging another session's Claude), the dev terminal beside you
  (running, restarting or saving the project's commands), naming the session, or
  merging the work back into main ("ship it").
---

# amarchy

amarchy runs the user's Claude Code sessions in parallel on their Omarchy
desktop. Each **session** is:

- a **git worktree** on its own **branch**, made from the latest main
  (`$AMARCHY_PATH`, branch `$AMARCHY_BRANCH`), under
  `$AMARCHY_WORK/.worktrees/<project>/<name>` by default (`AMARCHY_WORK` is
  `~/Work` unless the user set it);
- **you**, Claude Code, in a centered column on the session's own Hyprland
  workspace;
- the session's **terminal** on your right, opened in the same worktree. The
  project runs there (`bin/dev`, `npm run dev`...);
- one row in the **session list** on your left (and under the Ⓐ in the bar):
  status glyph, what the session is about, `project · branch`.

The other sessions are other Claude Code instances, each in a worktree of its
own. The project's **main checkout** is `$AMARCHY_ROOT` (`$AMARCHY_WORK/<project>`).

## Your environment

Set in your shell and in the terminal beside you:

| Variable | |
| --- | --- |
| `AMARCHY` | `1`: you're inside amarchy. |
| `AMARCHY_SESSION` | This session's id (`<project>-<name>`). `amarchy` commands that act on "the current session" use it, whatever is on screen. |
| `AMARCHY_PATH` | This worktree. |
| `AMARCHY_NAME` | The session's name, e.g. `wobbly-bakunin`. |
| `AMARCHY_BRANCH` | Its branch (usually the same as the name). |
| `AMARCHY_REPO` | The project, i.e. the repo's folder name in `$AMARCHY_WORK` (`~/Work` by default). |
| `AMARCHY_ROOT` | The project's main checkout. |

## The CLI

Every command prints its result to stdout and exits non-zero on failure.
`amarchy --help` lists all of them.

### Use freely

- `amarchy list --compact`: all sessions as JSON, in list order: `id`, `repo`,
  `name`, `branch`, `path`, `status` (`waiting` = needs the user, `working`,
  `idle`), `sleeping` (its Claude Code isn't running until the user types
  in it; it still shows as idle), `priority` (`high`,
  `normal`, `low`), `task` (what it's about: the user's name for it, else Claude Code's title cut down to "Keyword: a few words"), `claude_title` (Claude Code's whole title), `current` (on screen), `agent`
  (the name its Claude goes by in `ListAgents` / `SendMessage`, empty until its
  Claude runs), `background` (Claude Code background sessions running in its
  worktree).
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

- `amarchy sleep [id]` / `amarchy sleep --all` / `amarchy wake [id]`: a
  sleeping session's Claude Code isn't running (it holds no memory); its
  window keeps Claude's last screen, and what the user types there goes to
  Claude when it comes back (`claude --resume`). A sleeping session's Claude
  can't be messaged (its `agent` is empty). Idle sessions off screen sleep on their own after
  `amarchy sleep --after` minutes (default 1), so you rarely need these. A
  session never sleeps while it's working, asking the user something, or
  running background commands or agents. Never add `--force` without
  explicit approval: it sleeps a session even when something is lost.
  You can be put to sleep too, between turns: nothing you'd need is lost,
  the conversation resumes as it was.

- `amarchy priority high|normal|low|up|down [--id <id>]`: how much a session
  matters to the user. The list puts higher priority first (unless the user
  sorts it by date, `amarchy sort`). Without a level it prints it (that you
  can do freely); only set it when asked.
- `amarchy rename "<what it's about>"`: name the session in the list and the
  strip above you. Claude Code's own title (cut down to "Keyword: a few words") is shown until then, so don't rename
  unprompted. Never overwrite a name the user gave (`title` in `amarchy list`).
  `amarchy rename --reset` goes back to Claude's title.
- `amarchy run --set '<command>'` / `amarchy run --save <name> '<command>'` /
  `amarchy run --forget <name>`: change the project's saved commands (shared by
  all its sessions). Commands start in the worktree and can use the variables
  above. Single-quote them so they expand per session, e.g.
  `amarchy run --set '$AMARCHY_PATH/install.sh && omarchy-restart-shell'`.
  amarchy's own `install.sh` (and `--uninstall`) won't take the installed
  amarchy off **another** session's worktree without asking: in a terminal it
  asks, and run by you (no terminal) it changes nothing and says whose build
  it is. Tell the user instead of adding `--force` on your own. Your own
  worktree's build is never asked about, so putting it back on main
  (`$AMARCHY_ROOT/install.sh`) just works. Closing a session whose worktree
  amarchy runs from puts it back on the main checkout first.
- `amarchy new <project> [name] [--prompt "<brief>"]`: start another session
  and print its id. With `--prompt` (or `--prompt -` to read it from stdin), its
  Claude starts with that as its first message: the way to hand a new session
  a task. **It takes the user's screen to it.** See "Talking to other
  sessions".
- `amarchy add <owner/repo|url>` / `amarchy add --new <name> [--github]`: add a
  project.
- `amarchy close <id>`: close **another** session. It removes that worktree and
  refuses if it has uncommitted changes. Never add `--force` without explicit
  approval: it discards them.

### Never on your own

- `amarchy close` with no id closes **this** session: your own window and your
  worktree. Don't.
- `jump`, `next`, `prev`, `open`, `show`, `search`, `pick`, `menu`, `zen`,
  `terminal`, `theme`, `sound`, `group`, `sort`, `layout`: these move or
  repaint what the user is looking at (or change what they hear). Run them
  only when asked, as the action itself.
- `hook`, `ui`, `watch` are amarchy's own plumbing. Don't edit
  `~/.local/state/amarchy/` either.

## Talking to other sessions

Every session is a Claude Code of its own, and you can message it. Never tell
the user to paste something into another session: send it yourself.

- **`ListAgents`** lists the Claude sessions running on this machine. An
  amarchy session shows under its own name plus a short suffix, e.g.
  `rebellious-parsons-34 [ab8910]` for session `amarchy-rebellious-parsons`.
  The `agent` field of `amarchy list --compact` gives that name for each
  session, so you can match ids to names without guessing.
- **`SendMessage`** (a deferred tool: load it first with ToolSearch
  `select:SendMessage`) delivers a message into that session's conversation:
  `{"to": "rebellious-parsons-34", "message": "..."}`. Make the first line a
  self-contained sentence (it's the preview). A reply comes back as a
  `<cross-session-message from="...">`; answer it with that `from` as `to`.
- **`notify_when_idle: true`** on a send (or a send with no message, just to
  subscribe) gets you one notice when that session finishes its turn. Use it to
  hear back instead of polling `ListAgents` or asking "are you done?".

To give a **new** session a task (only when the user asks for a session):

1. `amarchy new <project> [name] --prompt "<the whole brief>"`. The brief is
   all it gets, so make it self-contained: what to do, why, where things are,
   and to report back to you by name (yours is in `ListAgents`' first line).
2. Once its Claude is up (`agent` set in `amarchy list --compact`), subscribe
   with `SendMessage` + `notify_when_idle: true` if you want to know when it's
   done.

For a session that is already running, message it. Each session keeps its own
permissions: never ask another session to do something that was denied or
blocked here; take it back to the user instead.

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
