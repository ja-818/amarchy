# The chat engine's protocol: `claude -p` with stream-json

Phase A1 of [the chat-app plan](plan-chat-app.md). amarchy's chat engine runs
Claude Code as `claude -p` with JSON lines in and out, the control protocol the
Agent SDKs speak, instead of the interactive TUI. This page is what that
protocol does, as checked against the installed Claude Code (2.1.309 when
written), and how amarchy's broker (`amarchy agent`) uses it.

Everything here is checked by **`bin/amarchy-protocol-test`**: real, small
turns on haiku, in throwaway folders, on your Claude subscription login. Run it
after Claude Code updates; a failing check means this page (and the broker)
needs a look.

```
bin/amarchy-protocol-test            # every check, four at a time (about 3 minutes)
bin/amarchy-protocol-test interrupt images
bin/amarchy-protocol-test --list     # the checks
bin/amarchy-protocol-test --json     # a report for scripts
bin/amarchy-protocol-test -v         # every event as it arrives
bin/amarchy-protocol-test --broker   # also amarchy agent itself, on a test session it makes and closes
```

The protocol isn't documented on its own. The open-source SDKs are one
reference; the other is Claude Code itself: its binary carries the schema of
every message with descriptions (`strings` on it and look for
`subtype:A("interrupt")` and the like). That's where the parts below marked
*(schema)* come from; the rest was seen on the wire.

## Starting it

```
claude -p --input-format stream-json --output-format stream-json --verbose \
  --include-partial-messages --include-hook-events --replay-user-messages \
  --permission-prompt-tool stdio \
  [--resume <conversation id>] [--permission-mode <mode>] [--model <model>] \
  --settings '<json: hooks, crossSessionInbound>'
```

- `--verbose` is required with stream-json output.
- `--permission-prompt-tool stdio` sends permission requests to us as control
  requests (below). Without it, anything that would ask is denied.
- `--include-partial-messages`: live text (`stream_event`).
- `--include-hook-events`: hook runs mirrored as `system/hook_started` and
  `hook_response`.
- `--replay-user-messages`: every user message that goes in to Claude is echoed
  on stdout (`isReplay: true`), ours *and* those from other sessions. Without it
  a message from another session is invisible to the host.
- The process stays up between turns, until stdin closes and nothing (a
  background task) keeps it.

### Login: the subscription, never an API key

With no API credential in its environment, `-p` uses the claude.ai login:
`system/init` says `apiKeySource: "none"`, and `initialize` names the account
(`subscriptionType: "Claude Max"`). **With `ANTHROPIC_API_KEY` set, `-p` uses
the key instead** (`apiKeySource: "ANTHROPIC_API_KEY"`) and bills that API
account (checked with a bogus key: the turn fails on it). So the broker takes
`ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` out of Claude's environment,
and so does the test. It also drops the variables a running Claude Code sets
for its children (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`...).

## Messages in

A user message, one JSON line:

```json
{"type": "user", "message": {"role": "user", "content": "text, or content blocks"},
 "parent_tool_use_id": null, "session_id": "", "uuid": "<ours>", "priority": "later"}
```

- **`uuid`** is optional; given, it's the id the transcript keeps for that
  message and the id in `command_lifecycle` frames, so a host can follow its
  own message.
- **`priority`** *(schema)*: `now`, `next` or `later`. Sent while Claude works:
  `next` is taken into the turn under way at its next step (checked: one
  result for both); `later` waits and runs as a turn of its own right after
  (checked). `now` interrupts the turn for it *(schema)*. `command_lifecycle` frames say
  `queued`, `started`, `completed`.
- **Images**: an `image` block beside the text works:
  `{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "..."}}`.
  Claude sees it (checked with a red square), and the transcript keeps the block.
- **Slash commands** go as plain text: `/context`, `/compact` (emits
  `system/compact_boundary`, context kept), `/clear` (a new conversation id from
  then on), `/model haiku` (replayed as `<local-command-stdout>`).

## Messages out

| `type` / `subtype` | What it is |
| --- | --- |
| `control_response` | the answer to one of our control requests, by `request_id` |
| `system/init` | at the start of **each turn** (not on `initialize`): `session_id`, `model`, `permissionMode`, `tools`, `slash_commands`, `capabilities`, `apiKeySource`, `messaging_socket_path` |
| `system/status` | `status: "requesting"` as a model request starts; carries `permissionMode` after a change |
| `stream_event` | partial message events: `message_start`, `content_block_start/delta/stop`, `message_delta/stop`. `text_delta`s add up exactly to the final text (checked) |
| `assistant` | each complete content block (text, thinking, tool_use) as a message, after its deltas |
| `user` | tool results (`tool_result` blocks, plus a structured `tool_use_result`: Read's `{type, file}`, Edit's patch...), and replays of what went in |
| `result` | end of a turn: `subtype` (`success`, `error_during_execution` when interrupted), `is_error`, `total_cost_usd`, `usage`, `duration_ms`, `num_turns`, `session_id` |
| `rate_limit_event` | plan usage: `unifiedWindows.five_hour` / `seven_day` with utilization and `resetsAt` |
| `system/background_tasks_changed` | the list of background tasks running |
| `system/task_started`, `task_updated`, `task_notification` | a background task's life. When one ends, Claude takes a turn of its own on it, unasked |
| `system/thinking_tokens` | thinking progress |
| `system/hook_started`, `hook_response` | hook runs (with `--include-hook-events`) |
| `system/compact_boundary` | after `/compact` |
| `system/session_title_changed` | from `--name` or a rename |
| `system/peer_message_hold` | a message from another session held (below) |
| `system/informational` | notices, e.g. "Cross-session message held by the receiving session" |
| `command_lifecycle` | a queued message's `queued` / `started` / `completed` |
| `control_request` | Claude asks us something (below) |
| `control_cancel_request` | Claude withdraws a request (an interrupt during a permission question) |

Subagents (the Agent tool): their messages carry `parent_tool_use_id` (the
Agent call's id); their final report comes back as the Agent's `tool_result`.

## Control requests we send

`{"type": "control_request", "request_id": "<ours>", "request": {"subtype": ..., ...}}`,
answered by a `control_response` with the same `request_id`, `subtype`
`success` (with `response`) or `error` (with `error`).

| `subtype` | Checked | What it does |
| --- | --- | --- |
| `initialize` | ✓ | every command and skill with its description, every model (`value`, name, description), agents, output styles, the **account**, `current_permission_mode`, the CLI's pid and version. Send it first |
| `interrupt` | ✓ | Stop. Ends the turn at once while text streams, while a tool runs (its result: "The user doesn't want to proceed..."), and while a permission request waits (withdrawn by `control_cancel_request`). The turn's result is `error_during_execution`. Harmless while idle. Response `{"still_queued": [...]}`; with `cancel_queued: true` the queued messages are dropped too and listed under `cancelled` *(schema)* |
| `set_model` | ✓ | `{"model": "sonnet"}`: the next turn runs on it; response names the full id |
| `set_permission_mode` | ✓ | `{"mode": "default|acceptEdits|plan|auto|dontAsk|bypassPermissions"}`: applies to the next tool call, no restart |
| `get_context_usage` | ✓ | what `/context` shows, as data: categories, `maxTokens`, `autoCompactThreshold`... |
| `set_max_thinking_tokens`, `get_settings`, `apply_flag_settings`, `rename_session`, `stop_task`, `rewind_files`, `get_plan` | schema | there, not used yet |

## Control requests Claude sends us

`can_use_tool` is the only one that arrives unless `initialize` declares more
(hooks, SDK MCP servers, `supportedDialogKinds`). The broker answers anything
else with an error so nothing waits on it.

```json
{"type": "control_request", "request_id": "...", "request": {"subtype": "can_use_tool",
  "tool_name": "Bash", "input": {"command": "touch made.txt", "description": "Create empty file made.txt"},
  "description": "Create empty file made.txt", "display_name": "...", "tool_use_id": "...",
  "permission_suggestions": [{"type": "addRules", "rules": [{"toolName": "Bash", "ruleContent": "touch made.txt"}],
                              "behavior": "allow", "destination": "localSettings"},
                             {"type": "addDirectories", ...}, {"type": "setMode", ...}],
  "blocked_path": "...", "decision_reason": "..."}}
```

Answered with

```json
{"type": "control_response", "response": {"subtype": "success", "request_id": "...",
  "response": {"behavior": "allow", "updatedInput": {...the input...}, "updatedPermissions": [...]}}}
```

or `{"behavior": "deny", "message": "why"}` (optionally `"interrupt": true`).

- **Allow** must carry `updatedInput` (the input as it was, or changed).
- **Always allow**: allow with `updatedPermissions` set to the `addRules`
  suggestion. The same command doesn't ask again (checked). The other
  suggestions are broader (`addDirectories`, `setMode` for the session): don't
  pass them by accident.
- **Deny**: the `message` reaches Claude as the tool's error result (checked).
- **AskUserQuestion** comes as `can_use_tool` with `input.questions[]`
  (`question`, `header`, `multiSelect`, `options[]` with `label` and
  `description`). Answered by allow with
  `updatedInput: {...input, "answers": {"<question text>": "<label>"}}`; Claude
  gets the answer (checked).
- **ExitPlanMode** (plan approval) comes as `can_use_tool` with `input.plan`
  (the markdown) and `planFilePath`. Allow approves it: the mode leaves plan
  (a `system/status` says `default`) and Claude carries on, asking for its
  edits as usual.
- **Notification hooks don't fire for these** under `-p`: the request is the
  signal. The broker sets the session's status to waiting itself.

## Hooks

`--settings '{"hooks": ...}'` works as in the TUI: SessionStart,
UserPromptSubmit, PreToolUse, Stop, SessionEnd fire (checked), so amarchy's own
hooks keep the session list right. Notification doesn't fire for a permission
request.

## Conversations: the same transcript, both ways

`-p` writes the same `~/.claude/projects/<folder>/<id>.jsonl` the TUI does,
and the ids are interchangeable: a conversation made in the TUI, resumed with
`-p --resume <id>`, keeps its context and its id; the TUI's `--resume <id>`
then picks up what `-p` added (checked TUI → `-p` → TUI). So the app's chat,
built from the transcript, shows chat-engine sessions as it shows any other.
The message `uuid`s we send become the transcript's.

## Between sessions: SendMessage, ListAgents

A `-p` Claude is a session like the TUI's: `ListAgents` in another session
lists it (by its `--name`), and `SendMessage` to it works. It arrives as a user
message wrapped in `<cross-session-message from="uds:...">`, seen by the host
only with `--replay-user-messages`; an idle `-p` Claude takes a turn on it by
itself; its own SendMessage reply reaches the sender (checked, both ways).

**But the receiving session decides whether a message gets in**
(`crossSessionInbound`, *schema*):

- unset ("mode parity"): a message is delivered only when the sender's
  permission mode is in the same class as the receiver's (bypass ↔ bypass,
  prompting ↔ prompting). Otherwise it's **held for the user's approval**:
  `system/peer_message_hold` `state: "held"`, `cause: "mode-mismatch"`. A `-p`
  host has no way to approve it, so it never reaches the model, and it's
  discarded when the session ends (checked; the sender gets a notice that it
  was held). amarchy sessions run in different modes (`--permission-mode auto`
  by default, bypass for some), so this would bite.
- `"accept"`: delivered whatever the sender's mode (checked).
- `"hold"` / `"refuse"`: held always / turned away.

amarchy sets `crossSessionInbound: "accept"` for every session, the TUI's and
the broker's (since A2: "Between sessions, for every session" below). Before,
a TUI session didn't, so **a broker's reply to a TUI session in another
permission class was held there** (seen live in A1).

## The broker: `amarchy agent`

`bin/amarchy`, section "the chat engine". **Any session can opt in**: "Try the
new chat" in its menu (the phone's ⋯, the wide layout's `Ctrl+Alt+M` → This
session), or `amarchy agent engine <id> chat`; "Back to the classic terminal"
(or `... terminal`) goes back. Sessions start on the terminal engine.

```
amarchy agent engine amarchy-x chat         # its Claude starts again on the broker, same conversation
amarchy agent send amarchy-x "hello"
amarchy agent state amarchy-x               # the live state
amarchy agent watch amarchy-x               # every event as it comes
amarchy agent answer amarchy-x <request id> allow|always|deny [why]
amarchy agent interrupt amarchy-x [--all]
amarchy agent mode amarchy-x plan
amarchy agent model amarchy-x haiku
amarchy agent control amarchy-x '{"subtype": "get_context_usage"}'
amarchy agent engine amarchy-x terminal     # back to the TUI, same conversation
```

How it fits:

- **The session's Claude pane runs it.** The pane loop's `amarchy claude <id>`
  becomes the broker for a chat-engine session, so tmux keeps it (restarting
  the app's server never stops a Claude), and sleep, wake, `amarchy send`,
  close and reap find it where they always do.
- **One Claude per conversation.** Whatever runs a session's conversation (the
  TUI's Claude, or the broker and its `claude -p`) claims it first in
  `driver` beside its state (`claim_driver`: its pid, under a lock), and a
  second one waits up to 15 s for the first to let go, then refuses ("This
  conversation is open in another Claude already"). So the two engines never
  write one transcript at once.
- **The switch** (`switch_engine`) waits for an idle moment: refused while
  Claude works or asks something (`--force` cuts in). A running Claude stops
  as quitting it would, and the pane starts again on the other engine once
  the driver is free, with `--resume` on the same conversation; asleep, the
  session just wakes on the other one. Messages queued in the broker go to
  the TUI as its first prompt.
- **Its Claude**: `claude -p` as above, with the user's own claude arguments
  (`AMARCHY_CLAUDE_ARGS`), the conversation resumed as the TUI's would be,
  amarchy's hooks (`crossSessionInbound: accept` among them, as for every
  session: below), and no API credentials. In its own process group, so
  Ctrl+C in the pane is Stop, not the end of it.
- **`live.json`** (in `~/.local/state/amarchy/claude/<id>/`), rewritten as
  things change (at most every 0.15 s while text streams): `state`
  (`starting`, `idle`, `working`, `waiting`, `exited`), `pending` (the
  requests waiting: `request_id`, `tool`, `input`, `description`,
  `suggestions`, `reason`, `tool_use_id`, `answered`: AskUserQuestion's
  questions answered so far), `partial` (the text being written), `thinking`,
  `activity` (the tool under way), `tasks` (background), `queue` (our
  messages waiting for Claude to be free: `uuid`, `text`, `images` (how
  many), `at`), `attachments` (images waiting for the next message),
  `rate_limits`, `model`, `permission_mode`, `before_plan` (the mode plan mode
  came from: approving a plan goes back to it), `working_since` (when the turn
  under way started), `title`, `conversation`, `turns`,
  `cost_usd`, `last_result`, `account`, `version`, `pid`, `claude_pid`,
  `socket`. Beside it: `agent.json` (what `initialize` said: commands, models,
  agents, account), `stream.jsonl` (Claude's raw output and what we sent,
  capped at 20 MB), `chosen.json` (the mode and model to come back in),
  `attached.json` (images not sent yet), `title`.
- **The socket** (`agent.sock` beside it, or in `$XDG_RUNTIME_DIR` when that
  path is too long): one JSON line in, one out. `op`: `state`;
  `send` (`content`: text or blocks, `when`: `idle` (queued here until Claude
  is free, today's rule), `next`, `now`, `later` (straight to Claude with that
  priority), `uuid`); `unqueue` (`uuid`); `attach` (`images`: `[{type,
  data}]`, for the next message, whoever sends it); `answer` (`request_id`,
  then `choice`: `allow|always|deny` with `message`, `answers`,
  `annotations`, `mode`, `suggestions`, or
  `question` + `answer` for one of several questions, or `response`: the
  control response as is); `interrupt` (`everything`: drop the queue too);
  `control` (`request`: any control request); `stop`; `watch` (the live
  state, then every event as it comes, for as long as the connection stays
  open). An answer to a request that's gone says `"gone": true`.
- **Answers** (`agent_response`): `always` takes the suggestions named by
  their indexes in the request's (`suggestions: [0, 2]`), each a choice the
  app shows in words; without them, the `addRules` ones (the others reach
  further: a whole folder, a mode for the session), or for a request with
  none (an edit) its `setMode` for the session, as the TUI's second choice;
  `annotations` go with AskUserQuestion's answers (`{question: {preview,
  notes}}`: the preview of the option picked, checked against the options,
  and your note, which Claude gets with the answer, checked live); `mode` on a plan's approval is a `setMode` permission for the
  session (checked: Claude goes on in `acceptEdits`); `deny` with words sends
  them as "The user doesn't want to proceed with this tool use. The user
  said: ..." (bare, Claude took them for an error message). AskUserQuestion is
  answered one question at a time (the pane, today's card) or all at once.
- **The pane** shows the conversation so far as it starts (as the asleep
  pane draws it), then as it goes: your messages (`›`), Claude's text as it
  streams, one dim line per tool call, questions with their options, how each
  turn ended. What's typed there goes in as a message, or answers the
  question waiting (`y`, `a` for always (for a plan: and accept edits), `n
  why`, an option's number). Pastes come bracketed, so a paste arrives as one
  message.
- **Activity**: `activity` is the tool under way (`tool`, `input`, `id`,
  `since`); while it's a helper (Agent), `step` is the helper's own tool call
  under way.
- **Status**: the hooks set working and idle (and the done mark); the broker
  sets waiting while a request is pending (on each new one, and a working
  hook doesn't override it while one waits: several tool calls at once each
  run PreToolUse before asking) (no Notification hook fires under
  `-p`), working again once it's answered, and idle after a turn that ended
  with no Stop hook: one you stopped (no done mark then, as you were there) or
  one that failed, and when Claude exits.
- **Title**: under `-p` Claude Code doesn't title a conversation, and the
  list names a session after that title. The broker sets the pane's title to
  the conversation's title (what the TUI does), and a conversation without
  one gets one from its first message (Haiku, once), kept in `title` beside
  its state, not given to Claude: `rename_session` would rename the session
  in ListAgents too (seen live).
- **Sleep**: no prompt to hand over; a session doesn't sleep while a request,
  a background task or a queued message waits. Asleep, Claude is stopped;
  typing in its pane shows what you type, Enter wakes it with that (keys that
  aren't text do nothing); waking (or `amarchy send`) starts the broker again
  with `--resume`, in the mode and model you last chose (`chosen.json`: else
  a session that sleeps after a minute idle would lose them each time), and a
  message or images queued when Claude stopped go in first.
- **`amarchy send`** to a chat-engine session hands the message to the
  broker, which queues it until Claude is free.

## The app's API

The app's server (`app_handler`) reads `live.json` and talks to the socket.
The phone's chat today shows a chat-engine session as any other: its
messages from the transcript, and its questions as the same button cards,
built from `pending` instead of read off the screen. The new chat (`chat.js`,
phase B2) uses the live state directly.

| Route | What |
| --- | --- |
| `GET /api/session/<id>/stream` | as before (`session`, `conversation`, `screen`), plus `live`: the live state (without pids and the socket) on open and on every change, chat engine only (`null` once the session goes back to the terminal engine) |
| the `session` event, `/api/state` | each session has `engine`: `terminal` or `chat` |
| the `screen` event's `dialog` | for a chat session, built from `pending[0]` (`chat_dialog`) in the scraped dialog's shape (`id`, `question`, `options` with `label`, `detail`, `keys`), plus `request` and each option's `answer`. A multiple-choice question is answered an option at a time (each pick toggles it, then Done) |
| `POST .../answer` | `{request_id, choice: allow\|always\|deny, message?, answers?, annotations?, mode?, suggestions?}` or `{request_id, question, answer}`; `{ok}` or `{error}` (409 when the request is gone) |
| `POST .../interrupt` | Stop: `{everything?}` drops the queued messages too |
| `POST .../model`, `.../mode` | `{model}`, `{mode}` (`default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`); kept for the next wake |
| `POST .../unqueue` | `{uuid}`: a queued message taken back (its content in `response`) |
| `POST .../engine` | `{engine: chat\|terminal}`: the switch, any session; 409 while Claude works or asks |
| `POST .../send` | as before, and for a chat session `images: [{type, data}]` and `when: idle\|next\|now`; to the broker (no typing into a pane). Asleep, it wakes with it |
| `POST .../keys` | for a chat session: a card's option (`{keys, dialog}`) does what it says; `Escape` says no to what's asked and stops, or just stops; other keys go to the pane (Enter restarts a Claude that exited) |
| `POST /api/clip` with `paste` | for a chat session, the image is attached to the next message (what Ctrl+V does in the TUI) |
| `GET .../agent` | `agent.json` (commands, models, account) and the live state, for the `/` menu and the pickers |
| `GET .../voice` | 409 for a chat session: Claude's voice mode is the TUI's (the other dictations work) |

Notifications say what a chat session asks, from `pending` (`ask_words`):
"Asks: Which theme should be the default? (and 2 more questions)", "Wants to
run a command: Install the packages", "Has a plan for you to approve: …",
with "(and 1 more)" when several wait, and a new one when Claude asks
something new while it's still waiting (the next of two permissions). Tapped,
the app opens that session on its card: the payload's `ask` reaches the page
(sw.js → app.js) as the window event `amarchy-ask` (`detail.id`), and the
session's Chat goes back to the conversation and focuses the card (desk.js
goes to the session first). Opening a session closes its notifications.

## The cards (chat.js, phase C1)

From `live.pending` (the first; "1 of 2" when several wait):

- **Questions**: one at a time with a tab for each and Back, then your
  answers to look over and send together (`answers`, `annotations`). An
  option's preview shows for the option you're on (beside the options on a
  wide screen), with a note field; multiple choice as boxes; "Something
  else…" for your own words. What the pane answered already is filled in.
- **Permissions**: what Claude wants in words, the command or the diff, Allow,
  one button per way to always allow it from Claude's suggestions in words
  ("Always allow commands starting with “git log” in this project, and
  reading files in /usr/share for this chat", "Allow all edits for this
  chat"), and Don't allow with why.
- **Plans**: the plan as a document (it scrolls inside the card, "Read it
  bigger"), **Approve and start** naming the mode it goes back to, the other
  modes under "Approve another way", Keep planning with what to change.
- **Streaming**: Claude's words at an even pace with a caret, kept whole once
  written until the transcript has them (no gap, no double).
- **The activity line**: what it's doing in words ("Running the tests…", "A
  helper is on it: … · reading app.js…", "Thinking…", "Starting Claude…"),
  with how long the turn has taken after 10 s; none while a card asks or
  words come in.

## The composer (phase C2)

The box you type in (`chat.js`, the same on the phone and the wide layout),
on either engine:

| Route | What |
| --- | --- |
| `GET /api/session/<id>/composer` | `{engine, commands, models, model, mode, up}`: the `/` menu's commands and skills (`name`, `description`, `argumentHint`, `aliases`, `builtin`, `where: "project"` for the project's own), the models (`value`, `resolvedModel`, `displayName`, `description`), and the model and mode Claude is in. A chat-engine session's from its `agent.json` and live state (asleep: what it wakes in, `chosen.json`); a classic-terminal one's from the newest `agent.json` any session's Claude wrote (without other projects' own), its project's `.claude/commands` and `.claude/skills`, and its conversation (`transcript_settings`) |
| `POST /api/session/<id>/upload` | `{name, data (base64)}`: the file into the worktree's `.amarchy/uploads/` (with a `.amarchy/.gitignore` of `*`, so it's never committed; a name taken gets " (2)"), 50 MB at most: `{path, size}`. `{remove: path}` deletes one taken off before it was sent |
| `GET /api/session/<id>/image/<record>/<n>` | the n-th image of a message in the session's conversation (the record's `uuid`), for the bubble: `app_items` gives an image item `rec` and `image` (its index) |
| `POST .../unqueue` | now answers with the message taken back (`response.content`: its text and image blocks), so Send now and Edit keep its pictures |

- **Pictures** go as image blocks with the message (`/send` `images`), made
  at most 2000 px and 3.7 MB first (a phone's photo), PNG, JPEG, GIF or
  WebP; one the browser can't read (HEIC on a computer) is uploaded as a
  file instead. On the classic terminal each is pasted into Claude's prompt
  (`/api/clip` with `paste`, as Ctrl+V), the session woken first if it
  sleeps, then the words sent.
- **Files** are uploaded as they're added and named in the message as
  `[File: .amarchy/uploads/<name>]` (Claude reads them there; the bubble
  shows them as a chip).
- **The `/` menu**: Claude Code's commands that work under `-p` in words
  (`/compact`, `/clear`, `/context`, `/effort`, `/usage`, `/init` checked;
  `/model` and the mode open the pills' menus), then the project's, then the
  rest; the ones that need the terminal app (menus, logins) left out.
- **The model**: `set_model` (the `/model` route) and `/model <x>` sent to
  `-p` as a message are for the session only ("for this session only"), but
  the TUI's `/model` also saves it as the default model of **every new
  session** (`~/.claude/settings.json`; all checked). So the composer
  doesn't offer the model on the classic terminal, and turns a `/model x`
  written in the chat's box into the route (as a message, the live state's
  `model` wouldn't know of it).
- **Stop** takes the queued messages back into the box (as Esc does in
  Claude Code), then interrupts.

## Between sessions, for every session

`hook_settings` sets `crossSessionInbound: "accept"` for **every** session's
Claude, TUI or broker (it takes effect as each Claude starts again: a wake,
a switch, a restart). Before, a message from a session in the other
permission class (bypass vs. asking) was held for the user's approval in a
TUI session (a prompt in its terminal), and dropped unseen in a chat-engine
one. Now SendMessage between any two of the user's sessions is delivered
directly, both ways. Checked live: a chat-engine session in `default` mode
and a TUI session in bypass messaged each other and got the replies.

Checked live, in the app's own server and the phone's page (a headless
iPhone): the switch both ways (awake and asleep) with the conversation and
title kept, and a second Claude refused on it; a permission, a deny with
words, questions (several, one multiple-choice) and a plan approved with
accept edits, all from today's cards; always-allow through `/answer`; Esc
mid-turn (idle, no done mark); images sent and pasted; a queued message
taken back; sleep, typing in the asleep pane, `amarchy send` waking it in
the mode and model chosen before.

## Not yet (phase C and on)

- Drafts: the chat engine has no prompt box; a draft kept from a TUI
  session's sleep stays for the TUI, and the TUI's unsent prompt isn't
  carried over by a switch.
- Running `amarchy-protocol-test` on `amarchy update` and when Claude Code's
  version changes, keeping new sessions on the terminal engine when it fails.
