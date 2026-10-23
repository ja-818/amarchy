---
name: amarchy
description: >
  You are running inside amarchy when AMARCHY=1 / AMARCHY_SESSION is set or your
  session started with "This Claude Code session runs inside amarchy". Use this
  skill before running any `amarchy` command, and whenever the work involves this
  session's worktree or branch, other sessions (starting one with a task,
  messaging another session's Claude), the session's terminal
  (running, restarting or saving the project's commands), naming the session,
  merging the work back into main ("ship it"), or when you need an API key,
  password or token from the user (`amarchy secret ask`, never the chat).
---

# amarchy

amarchy runs the user's Claude Code sessions in parallel on their Omarchy
desktop. Each **session** is:

- a **git worktree** on its own **branch**, made from the latest main
  (`$AMARCHY_PATH`, branch `$AMARCHY_BRANCH`), under
  `$AMARCHY_WORK/.worktrees/<project>/<name>` by default (`AMARCHY_WORK` is
  `~/Work` unless the user set it);
- **you**, Claude Code, in this session's chat in the amarchy app: the user's
  messages, your answers, and their questions to you as buttons (on the classic
  terminal engine, your own Claude pane, which the user can see as a terminal);
- the session's **terminal**, opened in the same worktree. The project runs
  there (`bin/dev`, `npm run dev`...). The app shows it when the user has
  terminals on;
- a row in the **session list** the user sees: status, what the session is
  about, `project · branch`.

The other sessions are other Claude Code instances, each in a worktree of its
own. The project's **main checkout** is `$AMARCHY_ROOT` (`$AMARCHY_WORK/<project>`).

### On a server (remote sessions)

Your session may run on a **host**: a machine without a desktop that keeps
sessions for the user's desktops (`amarchy remote` there). Your SessionStart
context says so. You and the terminal run in tmux on the host, and the user sees
both through amarchy on their own machine. Then:

- The user's browser isn't on your machine. Your SessionStart context says
  which address to listen on (the host's private network address, never
  `0.0.0.0` on your own initiative) and what URL to give them. Other sessions
  share the machine, so check the port is free.
- `amarchy run`, `list`, `new`, `rename`, `close` and messaging other sessions
  work as below; the other sessions you see are the host's. Commands that move
  the user's screen do nothing here.
- Nothing opens on their screen from here (a browser, a GUI app): tell them
  what to open instead.
- `wl-paste` reads what they last pasted (an image, or text) or copied in the
  app, from their phone or browser (or what's copied on a desktop still
  connected), the way an image the user pastes in the app reaches you. Use it when they ask you to look
  at what they copied: `wl-paste --list-types`, then
  `wl-paste --type image/png > /tmp/copied.png` and read that file.
- They may be reading you on their phone (`amarchy app`): your messages show
  as a chat, and your questions (AskUserQuestion, permission prompts) as
  buttons. Short option labels read best there.

## Your environment

If `amarchy list` shows this session's `engine` as `chat`, your conversation is
in the app's chat: there's no prompt box or keyboard on the user's side (they
type in the app's composer, and what they send while you work waits for your
turn unless they send it now), and your questions and permissions reach them
as buttons. Everything below holds for both engines.

Set in your shell and in the session's terminal:

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
`amarchy --help` lists all of them; `amarchy <command> --help` prints one
command's usage without running it (an option it doesn't know fails instead).

### Use freely

- `amarchy list --compact`: all sessions as JSON, in list order: `id`, `repo`,
  `name`, `branch`, `path`, `status` (`waiting` = needs the user, `working`,
  `idle`), `sleeping` (its Claude Code isn't running until the user types
  in it; it still shows as idle), `unseen` (idle, and finished a turn the
  user hasn't opened yet), `priority` (`high`,
  `normal`, `low`), `task` (what it's about: the user's name for it, else Claude Code's title cut down to "Keyword: a few words"), `claude_title` (Claude Code's whole title), `current` (on screen), `agent`
  (the name its Claude goes by in `ListAgents` / `SendMessage`, empty until its
  Claude runs), `engine` (`terminal`: Claude Code's own terminal app, or
  `chat`: the app's chat engine, the same Claude on `claude -p`), `background`
  (Claude Code background sessions running in its worktree).
- `amarchy projects --json`: the user's projects and how many sessions each
  has, in the user's order (`amarchy projects order` prints just the names).
- `amarchy run --show` / `amarchy run --list`: the project's run command / all
  its saved commands (`name<TAB>command`).
- `amarchy run`: (re)start the project's run command in the session's
  terminal. Use it after a change the running dev server won't pick up by itself
  (new dependency, config, migrations, server code without reload), or when the
  user asks. The user sees it in the app when terminals are on.
- `amarchy run <name>`: run another saved command the same way.
- `amarchy secret ask <NAME> --why "..."` / `amarchy secret list`: get a key
  or password from the user without it going through the chat (see
  "Secrets" below).

You **can't read that terminal's output**: it's the user's. To check that
something works, run it yourself in your own shell (tests, a build, `curl` the
dev server). Restart the terminal so the user sees the result too.

### Only when the user asks

- `amarchy sleep [id]` / `amarchy sleep --all` / `amarchy wake [id]`: a
  sleeping session's Claude Code isn't running (it holds no memory); its
  conversation is kept (`claude --resume`), and a message sent to it wakes it. A sleeping session's Claude
  can't be messaged with SendMessage (its `agent` is empty), but `amarchy
  send` wakes it with the message (see "Talking to other sessions"). Idle sessions off screen (on a
  host: open on no phone or browser) sleep on their own after
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
- `amarchy projects move <project> up|down|top|bottom|before <other>|after <other>`
  / `amarchy projects order <project>...`: the order the user's projects come in
  (the list's project groups, the new-session picker). Only when asked.
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
- `amarchy new <project> [name] --no-jump [--prompt "<brief>"]`: start another
  session and print its id. With `--prompt` (or `--prompt -` to read it from
  stdin), its Claude starts with that as its first message: the way to hand a
  new session a task. `--no-jump` starts it out of sight: it shows up in the
  user's list and their screen stays where it is. **Always pass `--no-jump`**
  when you start a session; without it the screen goes to the new session,
  which only makes sense when the user asked to be taken there. See "Talking
  to other sessions".
- `amarchy add <owner/repo|url>` / `amarchy add --new <name> [--github]`: add a
  project.
- `amarchy close <id>`: close **another** session. It stops every process still
  running from that worktree (dev servers started in the background too),
  removes the worktree, and refuses if it has uncommitted changes. Never add
  `--force` without explicit approval: it discards them.

### Never on your own

- `amarchy close` with no id closes **this** session: your own window and your
  worktree. Don't.
- `jump`, `next`, `prev`, `open`, `show`, `search`, `pick`, `menu`, `zen`,
  `terminal`, `theme`, `sound`, `group`, `sort`, `layout`: these move or
  repaint what the user is looking at (or change what they hear). Run them
  only when asked, as the action itself.
- `hook`, `ui`, `watch` are amarchy's own plumbing. Don't edit
  `~/.local/state/amarchy/` either.
- Typing into a session (`tmux send-keys`, a browser test on the app, `amarchy
  send`) when it isn't yours to drive. Every session shows up in the user's
  list, test sessions too, and they may be looking at it or typing in it: what you
  send mixes with theirs, and their unsent text is theirs.
  To test against a live session, start one of your own for it with a name
  that says so (`amarchy new <project> test-<what> --no-jump`), tell the user
  it's a test session they shouldn't use, and close it as soon as you're done.

## Secrets: API keys, passwords, tokens

**Never ask the user to paste a key, password or token into the chat**, and
never write one into a file in the repo. The transcript keeps everything said
in the chat, and you'd read it back. Ask for it with:

```
amarchy secret ask OPENAI_API_KEY --why "to run the integration tests against OpenAI"
```

Run it with the Bash tool's longest timeout (600000 ms): it waits until the
user answers. The app shows them a card with a password field and your
`--why` (one plain sentence a non-technical person understands: what it's
for). It prints only whether it was saved, never the value. Then:

- Your Bash commands have it as an environment variable, `$OPENAI_API_KEY`,
  from the next command on, with no restart; so do the session's terminal
  (from its next prompt) and its run commands (`amarchy run`). A dev server
  already running needs `amarchy run` again to get it.
- **Use it by name only.** Never `echo`, `cat`, `printenv`, log or print its
  value, and don't copy it into a file (`.env`) in the repo. If a tool needs
  it in a file, point the tool at the variable instead (most read the
  environment), or write the file outside the repo with `umask 077` and say
  where.
- Exit 0: saved (or set already: it says so, and isn't asked again; add
  `--again` only if the user says the one kept is wrong). Exit 1: the user
  declined (it prints what they said). Exit 2: no answer yet; tell them you
  need it and ask again later. The card stays up, and if they save it after
  you stopped waiting, you get a message saying so.
- It's kept for this project's sessions; `--all` suggests every project's
  (the user picks on the card).
- **`ANTHROPIC_API_KEY` (and Claude's other credentials) is refused**: in
  your environment it would switch Claude Code from the user's subscription
  to API billing. If the project itself calls Anthropic's API, ask for a key
  under a name of the project's own (`MYAPP_ANTHROPIC_KEY`) and have the
  project read that.
- `amarchy secret list` names the secrets this project's commands have
  (names only). Reading the secrets' folder is refused: use the variables.
- The user can also add one themselves: Settings → Secrets in the app, or a
  session's menu → Add a secret.

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

- **`amarchy send <id> "<text>"`** delivers a message as if the user typed it
  (no `<cross-session-message>` around it), once that Claude is free (after its turn, not over a question it's asking), waking
  it first if it's asleep or exited. It waits until Claude has it (`--no-wait`
  returns at once; from your own session it never waits). Prefer SendMessage
  to talk to a session; use `amarchy send` when it's asleep, when it should
  read as the user's own prompt, or from a script or timer.

To give a **new** session a task (only when the user asks for a session):

1. `amarchy new <project> [name] --no-jump --prompt "<the whole brief>"`, one
   call per session when there are several. `--no-jump` keeps the user's
   screen where it is; the new sessions just show up in their list. The brief
   is all it gets, so make it self-contained: what to do, why, where things
   are, and to report back to you by name (yours is in `ListAgents`' first
   line).
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
own for that. `amarchy notify "<title>" "<body>" [--session <id>] [--urgent]`
pushes a notification of your own to the user's phones (on a host with the
phone app on); only send one when the user asked for it (a reminder, a brief).
The user's assistant session (`amarchy assistant` names it; `assistant:
"main"` in `amarchy list`) is the exception: its notifications always reach
them, under its name. `amarchy alerts` decides what the other sessions'
do; only change it, or the assistant, when the user asks.
