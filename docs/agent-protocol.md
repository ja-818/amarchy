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

The broker sets `crossSessionInbound: "accept"` in its `--settings`. A TUI
session (the terminal engine) doesn't, so **a broker's reply to a TUI session
in another permission class is held there** (seen live: a test session's reply
to this bypass-mode TUI session was held). Phase A2 should add `accept` to
`hook_settings` for every session, which changes today's sessions, so it isn't
done here.

## The broker: `amarchy agent`

`bin/amarchy`, section "the chat engine". Experimental: **only sessions named
`test-...`** can be put on it, and nothing changes for any other session.

```
amarchy new amarchy test-chat --no-jump
amarchy agent engine amarchy-test-chat chat     # its Claude pane restarts on the broker, same conversation
amarchy agent send amarchy-test-chat "hello"
amarchy agent state amarchy-test-chat           # the live state
amarchy agent watch amarchy-test-chat           # every event as it comes
amarchy agent answer amarchy-test-chat <request id> allow|always|deny [why]
amarchy agent interrupt amarchy-test-chat [--all]
amarchy agent mode amarchy-test-chat plan
amarchy agent model amarchy-test-chat haiku
amarchy agent control amarchy-test-chat '{"subtype": "get_context_usage"}'
amarchy agent engine amarchy-test-chat terminal # back to the TUI, same conversation
```

How it fits:

- **The session's Claude pane runs it.** The pane loop's `amarchy claude <id>`
  becomes the broker for a chat-engine session, so tmux keeps it (restarting
  the app's server never stops a Claude), and sleep, wake, `amarchy send`,
  close and reap find it where they always do. One broker per session (a
  lock in its state folder).
- **Its Claude**: `claude -p` as above, with the user's own claude arguments
  (`AMARCHY_CLAUDE_ARGS`), the conversation resumed as the TUI's would be,
  amarchy's hooks, `crossSessionInbound: accept`, and no API credentials. In
  its own process group, so Ctrl+C in the pane is Stop, not the end of it.
- **`live.json`** (in `~/.local/state/amarchy/claude/<id>/`), rewritten as
  things change (at most every 0.15 s while text streams): `state`
  (`starting`, `idle`, `working`, `waiting`, `exited`), `pending` (the
  requests waiting: `request_id`, `tool`, `input`, `description`,
  `suggestions`, `reason`), `partial` (the text being written), `thinking`,
  `activity` (the tool under way), `tasks` (background), `queue` (our
  messages waiting for Claude to be free), `rate_limits`, `model`,
  `permission_mode`, `conversation`, `turns`, `cost_usd`, `last_result`,
  `account`, `version`, `pid`, `claude_pid`, `socket`. Beside it:
  `agent.json` (what `initialize` said: commands, models, agents, account),
  `stream.jsonl` (Claude's raw output and what we sent, capped at 20 MB).
- **The socket** (`agent.sock` beside it, or in `$XDG_RUNTIME_DIR` when that
  path is too long): one JSON line in, one out. `op`: `state`;
  `send` (`content`: text or blocks, `when`: `idle` (queued here until Claude
  is free, today's rule), `next`, `now`, `later` (straight to Claude with that
  priority), `uuid`); `unqueue` (`uuid`); `answer` (`request_id`, `response`:
  `{behavior, ...}`, `updatedInput` filled in when left out); `interrupt`
  (`everything`: drop the queue too); `control` (`request`: any control
  request); `stop`; `watch` (the live state, then every event as it comes,
  for as long as the connection stays open).
- **The pane** shows the conversation as it goes: your messages (`›`),
  Claude's text as it streams, one dim line per tool call, questions with
  their options, how each turn ended. What's typed there goes in as a
  message, or answers the question waiting (`y`, `a` for always, `n why`, an
  option's number). Pastes come bracketed, so the app's composer and
  `amarchy send` (which paste into the pane) arrive as one message each.
- **Status**: the hooks set working and idle; the broker sets waiting while a
  request is pending (no Notification hook fires under `-p`), and working
  again once it's answered.
- **Sleep**: no prompt to hand over; a session doesn't sleep while a request,
  a background task or a queued message waits. Asleep, Claude is stopped;
  waking (or `amarchy send`) starts the broker again with `--resume`, and a
  message queued when Claude stopped goes in first.
- **`amarchy send`** to a chat-engine session hands the message to the
  broker, which queues it until Claude is free.

Checked live on a test session: the broker started on the Max login and
resumed the conversation the TUI had begun; messages from the socket, typed
in the pane, pasted (two lines, one message) and from `amarchy send`; a
permission asked (status waiting) and answered from the pane; partial text in
`live.json`; interrupt, with the next queued message going in after it; sleep,
then `amarchy send` waking it with the conversation's context intact; a
SendMessage from a bypass-mode session delivered, and its reply sent; the app's
chat (from the transcript) showing all of it, model change and interruptions
included.

## Not yet (phase A2 and on)

- The app's server reading `live.json` / the socket: real cards for questions,
  permissions and plans, streaming text, Stop, the mode and model pickers,
  images from the composer. Today the app shows a chat-engine session from its
  transcript, and its composer reaches the broker through the pane.
- The switch for any session ("Try the new chat"), and the lock shared with
  the TUI so the two never run one conversation at once (today the engine
  switch stops one before starting the other).
- `crossSessionInbound: accept` for terminal-engine sessions too (above).
- The permission mode set with `mode` doesn't outlive the broker (as Shift+Tab
  doesn't outlive the TUI): a restart is back on the session's claude
  arguments.
- Drafts: the chat engine has no prompt box; a draft kept from a TUI session's
  sleep stays for the TUI.
- Running `amarchy-protocol-test` on `amarchy update` and when Claude Code's
  version changes, keeping new sessions on the terminal engine when it fails.
