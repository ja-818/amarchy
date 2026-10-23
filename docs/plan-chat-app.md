# Plan: amarchy as a chat app

Status: **finished**. Phases A1 to D1 shipped (D1 shipped in the final-pass session).
Approved by Julian on 2026-10-22, with the decisions in [Decisions](#decisions)
(app themes postponed).

Goal: the amarchy web app looks and works like a polished everyday app, on the
phone and in Safari on a Mac, for someone who has never used a terminal. You
talk to Claude in a chat; questions, permissions and plans are buttons; tool
calls are short friendly lines you can open; the look comes from real app
themes (light and dark, normal fonts) as well as today's terminal palettes.
The terminal stays, one tap away, for the people and the moments that need it.

The plan has five parts: how Claude runs (the engine), the chat UI, themes,
where the terminal goes (plus a safe way to give a secret), and the phases.

---

## 1. How Claude runs: the engine

### Today

Each session's tmux window runs the interactive `claude` TUI
(`claude_argv`/`cmd_claude`). The app gets its data three ways:

- **The transcript** (`~/.claude/projects/<cwd>/<id>.jsonl`), read by
  `AppConversation` and turned into items by `app_items`. Good data, but only
  once a message is complete, and nothing about what's pending.
- **Screen scraping** of the tmux pane: `claude_dialog` finds permission
  prompts, AskUserQuestion and menus by regex on the drawn screen and answers
  them by sending keystrokes (`app_keys`); `claude_prompt` reads what's typed
  in the prompt box; `app_type` pastes messages in. This is fragile (a
  redesign of Claude Code's dialogs breaks it) and lossy (no option
  descriptions in full, no previews, no multi-select, no plan text).
- **Hooks** from `hook_settings`: SessionStart, UserPromptSubmit, PreToolUse,
  Notification, Stop, which only set the state (working / waiting / idle).

### The three options

**A. Claude Agent SDK** (TypeScript or Python package driving Claude Code).
**B. `claude -p --input-format stream-json --output-format stream-json`** as a
long-lived process per session, answered over the same control protocol the
SDKs use (`--permission-prompt-tool stdio`). The SDKs are a wrapper around
exactly this process and protocol.
**C. Keep the TUI**, and read hooks + transcript instead of the screen.

I tested B live against the installed Claude Code 2.1.309 on this machine
(small haiku runs). What I verified myself is marked ✅; what comes from
the docs only is marked 📄; what's still unknown is marked ❓.

| Need | A. Agent SDK | B. stream-json (own broker) | C. TUI + hooks |
| --- | --- | --- | --- |
| Messages, tool calls, results as JSON | ✅ same stream as B | ✅ `assistant`, `user`/`tool_result` (with `tool_use_result`: structured output, patches), `result` with cost and usage | transcript only, after the fact |
| Live text as it's written | 📄 `includePartialMessages` | ✅ `--include-partial-messages`: `stream_event` deltas that add up exactly to the final text (A1) | no |
| Permission requests | 📄 `canUseTool` | ✅ `control_request` `can_use_tool` with tool, input, a human `description`, and `permission_suggestions` ("always allow `touch made.txt`", "accept edits for the session") | scrape, or a `PermissionRequest` hook that blocks the turn until the app answers (600 s cap) |
| AskUserQuestion | 📄 via `canUseTool` | ✅ arrives as `can_use_tool` for `AskUserQuestion` with all questions, options, descriptions, `multiSelect` (previews 📄); answered with `updatedInput.answers` | scrape only (a hook sees the questions but can't answer) |
| Plan approval | same as B | ✅ `ExitPlanMode` arrives as `can_use_tool` with the plan's full markdown and its file; allow = approved | scrape |
| Interrupt (Stop) | 📄 `interrupt()` | ✅ `control_request` `interrupt` stops a turn at once while it writes, while a tool runs, and while a permission waits (that request is withdrawn with `control_cancel_request`); `cancel_queued` also drops what's queued (A1) | Esc key |
| Switch model / permission mode / effort | 📄 `setModel`, `setPermissionMode`, `applyFlagSettings` | ✅ `set_model` (and `/model`); ✅ `set_permission_mode` applies to the next tool call, no restart (A1) | `/model`, Shift+Tab keystrokes |
| Slash commands | 📄 skills and most commands | ✅ `/context`, `/compact` (emits `compact_boundary`), `/clear` (new session id) all work sent as a message; `initialize` returns every command with its description, every model, and the account | all, including terminal-only ones |
| Terminal-only commands (`/login`, `/config` menu, `/resume` picker, `/voice`, `/bg`, `/rewind` menu) | no | no | yes |
| Resume a TUI conversation | 📄 yes | ✅ a conversation made in the TUI resumed in stream-json and remembered its context | native |
| …and back (TUI resumes a stream-json one) | 📄 `--resume <id>` yes (`--continue` skips them) | ✅ TUI → `-p` → TUI on one conversation id and file, context kept both ways (A1) | native |
| Background tasks | 📄 | ✅ `background_tasks_changed`, `task_started`, `task_notification`; the process stays up while they run, and Claude takes a turn of its own when one ends | pane only |
| Subagents | 📄 `parent_tool_use_id` | ✅ the Agent tool's messages carry `parent_tool_use_id` (A1); `--forward-subagent-text` for their text 📄 | transcript sidechains |
| SendMessage / ListAgents between sessions | 📄 | ✅ listed by `ListAgents`, messages arrive as `<cross-session-message>` (echoed with `--replay-user-messages`) and an idle `-p` Claude takes a turn on them; replies work. But by default a message from a session in another permission class (bypass ↔ prompting) is **held**, and a `-p` host can't approve it, so it's dropped (`peer_message_hold`). The broker sets `crossSessionInbound: accept`; TUI sessions need it too for a broker's replies to reach them (A2) | works today |
| amarchy's hooks (`--settings`) | 📄 | ✅ SessionStart, PreToolUse, Stop fire; `--include-hook-events` mirrors them into the stream. Notification doesn't fire for permissions: not needed, the request itself arrives | works today |
| Images in a message | 📄 base64 image blocks | ✅ a base64 `image` block beside the text; Claude sees it, the transcript keeps it (A1) | clipboard shim (`amarchy-paste`) |
| Usage limits | same | ✅ `rate_limit_event`: five-hour and weekly utilization, reset times | statusline only |
| Login / cost | subscription login 📄 *works*, but see below | ✅ used Julian's **Claude Max** login (`apiKeySource: none`, account in `initialize`), no API key; with `ANTHROPIC_API_KEY` set, `-p` uses the key instead (A1), so the broker strips it | the subscription, as today |
| New dependency | yes: a package (and the TS one bundles its own CLI copy) | none: amarchy is stdlib-only Python, this is JSON lines on a pipe | none |
| Protocol stability | documented API | the SDK's wire protocol, not documented on its own; the open-source SDKs are the reference | Claude's screen layout: least stable |

**Login and terms.** `claude -p` with no `ANTHROPIC_API_KEY` uses the logged-in
subscription (verified). If `ANTHROPIC_API_KEY` is in the environment, `-p`
uses it instead and bills the API, so the broker must strip it from Claude's
environment (and the secrets flow below must never put it there). The Agent
SDK docs say third-party developers may not *offer* claude.ai login in their
products without approval. amarchy runs the official `claude` binary with
each user's own login on their own machine, which is ordinary Claude Code
use, as today with the TUI; option B keeps it that way better than A (no
SDK, no bundled CLI). If amarchy is ever offered to other people as a
product, revisit this with Anthropic. Usage limits for `-p` and the TUI are
the same plan limits (no documented difference).

### Decided: B, through a small broker per session

Going with **B** (Julian decided, 2026-10-22). It gives everything the UI needs as clean data (the questions,
permissions and plans as real requests, not pictures of them), keeps amarchy
dependency-free, and uses Julian's subscription. A would add a package and a
second copy of Claude Code for the same protocol; C can't answer questions
or interrupt without keystrokes, so the scraping would stay.

How it fits together:

```
tmux window "claude" of a session
  └─ amarchy agent <sid>          (the broker: new, stdlib Python, in bin/amarchy)
       ├─ claude -p --input-format stream-json --output-format stream-json --verbose
       │         --include-partial-messages --include-hook-events
       │         --permission-prompt-tool stdio --resume <conversation> --settings <hooks>
       ├─ live.jsonl  : the pending requests, partial text, state (small, rewritten)
       ├─ a unix socket: the app server sends messages, answers, interrupts
       └─ draws a readable log of the conversation in the pane (so the tmux pane
          still shows something sensible, for `amarchy attach` and the terminal view)
```

- **The broker lives in the session's tmux window**, like Claude does today,
  so `systemctl --user restart amarchy-app` never kills a Claude, and every
  existing piece (sleep, reap, close, `amarchy attach`) still finds it there.
- **History stays the transcript.** Claude writes the same JSONL either way,
  so `app_items` keeps working for old and new sessions alike, and for
  sessions still on the TUI. The broker adds only what the transcript can't
  have: what's pending (a question, a permission, a plan), partial text,
  the current activity, background tasks, usage, model and mode.
- **Messages queue in the broker.** `amarchy send` and the app's composer
  hand the broker a message; it goes in when Claude is free (today's rule),
  or right away if you choose "send now" (stream-json queues it into the
  turn). No more pasting and pressing Enter.
- **Sleep becomes simple.** Asleep = the broker stops Claude (the
  conversation is on disk); waking = `--resume`. No prompt hand-over through
  the editor shim, no frozen screen; the draft lives in the app.
- **One driver per conversation.** A lock file per session so a TUI and a
  broker never run the same conversation at once.

### The engine switch, and the fallback

Each session gets an `engine`: `chat` (the broker) or `terminal` (today's
TUI). Both write the same conversation, and both can resume each other, so
switching is: stop one at an idle moment, start the other with `--resume`.

- **"Open Claude's classic terminal"** in a session's menu switches it to the
  TUI for whatever the chat can't do (`/login`, `/config` menus, `/rewind`,
  an MCP login, a dialog we don't know). "Back to chat" switches back.
- The scraping code (`claude_dialog`, `claude_prompt`) stays only for sessions
  on the terminal engine, so they keep working as today.

### Migrating existing sessions

1. New engine behind a per-session opt-in ("Try the new chat").
2. Once it has every feature below (dictation and images especially), new
   sessions start on `chat`.
3. Existing sessions switch the next time they're idle or wake from sleep;
   a turn under way is never cut. Their conversation carries over (verified).
4. A setting keeps the old default for anyone who wants the TUI.

### What the TUI gave that the chat engine must replace

| TUI feature | Replacement |
| --- | --- |
| Voice mode (`/voice`, used for hold-to-talk dictation) | see "Dictation" below: must land before the default flips |
| Ctrl+V image paste through `amarchy-paste` | images sent as image blocks in the message |
| Shift+Tab mode cycling | a mode picker (`set_permission_mode`) |
| Esc to stop | Stop button (`interrupt`) |
| Prefilled draft, Ctrl+G editor | the composer keeps drafts (already does) |
| `! command` | the session's terminal, or "Run a command" |
| `/bg` background sessions | background tasks in the chat engine; `/bg` stays on the terminal engine |
| Claude's TUI theme (`look_claude`) | the app's themes; the TUI keeps getting it for the fallback |

---

## 2. The chat UI

One chat component (`app/chat.js`, `app/chat.css`) used by **both** layouts,
so the phone and the Mac show the same conversation, cards and composer.
Today the phone has its own chat in `app.js` and the wide layout shows only
terminals; after this, the wide layout is chat-first too.

### Layouts

- **Phone**: the session list → a session's chat, full screen. Its header:
  back, the session's name and status, and a **Chat | Terminal** switch.
- **Mac (desk.js)**: a sidebar with the sessions on the left, the chat in the
  middle (a readable column, about 760 px), and a **side panel** on the right
  that opens when you want it: *Terminal*, *Changes* (the files this session
  changed), *Details* (model, mode, context and plan usage, background
  tasks). Zen mode hides the sidebar, as today. Keyboard shortcuts stay.

### The brief: the default view

The chat's main view is the **brief view**; the plain conversation is the
other, one tap away: on a computer the **Brief | Chat** switch over the chat;
on the phone, Settings → *Replies* or a chat's menu (⋯) → *Show replies as*.
The choice is kept on the device and every chat open takes it. (The phone's
terminals open from the chat's menu; its back arrow returns to the chat.)

Each turn is your message and **Claude's reply as one card**, read in layers:

- **Glance**: the card's title, the turn's outcome; its coloured edge says
  where it stands (done, working, blocked, waiting on you). The newest reply
  is open; the ones before are their title, opened with a tap. A folded reply
  that needs you says so.
- **Read**: right under the title, always there and without a label, the
  turn's summary (what Claude found, decided, did, concluded, as complete
  short points, *Details* on one with a tap); then *Needs you* (questions as
  buttons), after the context that explains them. The chat's *goal* (from
  its newest reply that says one) isn't on the cards: it's under the chat's
  name in the header, on the phone and on a computer.
- **Look into it**: the rest is what happened, under one *More* row that says
  what's there ("1 test failing · Plan · Changes · Checks · Activity · Notes
  · Original message"), each its own folding section: *Plan* (done / doing /
  next), *Changes* (files with +/− and a bar, commits, merges, pushes; git
  now on the newest), *Checks* (tests and their results, ways to try it;
  open when one fails), *Activity*, *Notes*, *Original message*.
- **Activity** is a timeline, folded the way the conversation folds Claude's
  steps: each run of steps between two things it said is one row in the
  chat's words ("Read 2 files, edited search.js, ran 2 commands and searched
  once"), with its +/−, what didn't work and how long; a tap lists its steps
  (their kind, the command in a pill, an edit's +/−, the first line of an
  error). What Claude said sits between as quiet quotes, background events
  where they happened. *Original message* is the turn as the conversation
  shows it.
- Every part but the title is optional, so a simple answer is a title and a
  point or two.

**Who writes what.** What needs judgment Claude writes itself, in the same
conversation: when a turn ends, amarchy's Stop hook asks it for this turn's
reply (`BRIEF_ASK`, with git's facts: `brief_facts`), and it calls
`update_brief` (a tool amarchy serves, `amarchy brief-mcp`, in both
engines' arguments, allowed without asking) with the title, status, kind,
the chat's goal, the answer (complete: the app folds it, so nothing important
is left out), the plan, the questions, tests, ways to check it and notes.
What Claude *did* comes from the record, never from the model: the activity,
the files changed and their +/−, commits and pushes, test runs (`changesOf`,
`testsOf`, `activityOf` in app/chat.js, from the turn's items). The session
stays *working* until the reply is written, so you're told it's done once it
is. The hook asks once a stop, only when Claude did something since its last
reply (`brief_needed`), and never a Claude started before the tool
(`claude_has_brief`). What Claude says after the call is left out (`aside`).

While Claude works, the turn's card is live: *Working…* and what it's doing
in its title, its activity shown (not under More) and filling in, ending with a live line: the
step under way ("Running the tests…", "Thinking…") or the line Claude is
writing as it writes it. A turn from before the brief gets the
same card, its title and answer from Claude's words. A brief in the older
shape (headline, changed, next) is read as a reply.

### The conversation

- **You**: right-aligned bubbles, with images as thumbnails.
- **Claude**: plain text on the page (no bubble), real markdown: headings,
  lists, tables, code blocks with a copy button, links.
- **Streaming**: Claude's words appear as they're written, with a soft
  "Working…" line under them naming what it's doing ("Reading app.js",
  "Running the tests"), taken from the tool call under way.
- **Tool calls, collapsed and in words**: consecutive steps fold into one line,
  "Worked for 2 min · read 5 files, edited 2, ran 3 commands ▸". Opened,
  each step is one friendly line:

  | Tool | Shown as |
  | --- | --- |
  | Read | Read `app.js` |
  | Edit / Write | Edited `app.js` · +12 −3 (opens a diff) / Created `notes.md` |
  | Bash | the `description` Claude gives ("Create empty file made.txt"), the command under Details |
  | Grep / Glob | Searched the code for "claude_dialog" |
  | WebSearch / WebFetch | Searched the web for "…" / Read a page on docs.python.org |
  | Agent (Task) | Asked a helper: "…" (its own steps nested inside) |
  | TodoWrite | a checklist card that updates in place (✓ done, ◌ next) |
  | Skill | Used the amarchy skill |
  | SendMessage | Messaged session *fancy-durruti* |
  | ToolSearch, bookkeeping | hidden |

  Errors show in red words ("The command failed"), with the output under
  Details.
- **Diffs**: Edit's input and its structured patch render as a small
  side-by-side (Mac) or stacked (phone) diff, red and green, syntax-coloured
  where cheap. The *Changes* panel shows the whole session's `git diff`
  against its base, file by file.
- **Notes**: "Conversation compacted", "Interrupted", "/model → Sonnet" as
  quiet centred lines.

### Questions, permissions, plans: cards with buttons

They sit above the composer, the newest one in focus, and stay in the
conversation once answered (showing the answer).

- **AskUserQuestion**: the question in large type, each option a button with
  its description, multi-select as checkboxes with a Done button, previews
  shown under the option, and "Something else…" opening a text field.
  Several questions step through one by one ("1 of 3").
- **Permission**: "Claude wants to run a command: *Install the packages*",
  the exact command under Details, and three buttons: **Allow**, **Always
  allow** (the suggestion Claude offers, in words: "Always allow `npm
  install` in this project"), **Don't allow** (with an optional "tell
  Claude why" field). File edits show the diff right in the card.
- **Plan approval**: the plan as a document card (markdown, scrollable),
  with **Approve and start**, **Approve, and accept edits without asking**,
  and **Keep planning** (with a field for what to change).
- In terminal-engine sessions the same cards are drawn from today's scraped
  dialogs, with the keystrokes behind them, so nothing regresses.

### The composer

- A rounded box with the text, **+** (photo, take a picture, file), the
  microphone, and Send, which turns into **Stop** while Claude works.
- While Claude is working, what you send waits in a chip ("Will send when
  Claude finishes · Send now · Edit"), today's rule made visible.
- **Images**: paste, drag-and-drop (Mac), the photo picker or camera (phone);
  sent as image blocks. Other files are uploaded into the worktree
  (`.amarchy/uploads/`, git-ignored) and named in the message.
- **/** opens a menu of commands and skills with their descriptions (from
  `initialize`), friendliest first: *Compact the conversation*, *Start
  fresh*, *Change model*, the project's own skills.
- A small pill row above the box: **model** (Opus · Sonnet · Haiku, in
  plain names) and **mode** ("Ask before changes", "Accept edits", "Plan
  first", "Auto"), each a menu.

### Dictation

Hold-to-talk today feeds the phone's microphone into Claude Code's own
voice mode, which the chat engine doesn't have. Options, in order:

1. **The keyboard's dictation** (iPhone and Mac) works in the composer with
   no work at all: say so in the empty composer's hint.
2. **Web Speech** (`SpeechRecognition`, on-device on Apple) for hold-to-talk,
   if it works in the home-screen app on Julian's iPhone (❓ test first).
3. **Speech-to-text on the server** (whisper.cpp, small model) behind the
   same mic button, reusing today's audio pipeline from the phone.

Keep Claude's voice mode for terminal-engine sessions. This must be in place
before new sessions default to the chat engine.

### The session list

- Each row: the session's name (its task title), project as a small label,
  a status in words with a colour ("Needs your answer", "Working · running
  the tests", "Done 5 min ago", "Asleep"), and the last line Claude said.
  Needing you sorts to the top.
- **New chat**: one big "What do you want to do?" box with the project
  picker under it (today's new-session bar, restyled), dictation included.
- An empty list explains the app in one sentence and offers "Add a project".

### Status and notifications

- The chat header shows the state; Details shows model, mode, context used
  (from `/context` data or usage), the plan's five-hour and weekly use
  (`rate_limit_event`), background tasks with a stop button each.
- Notifications (the Web Push the app already sends) say what's wanted:
  "*app-plan* asks: Which theme should be the default?", "*app-plan* wants
  to run `npm install`", "*app-plan* is done: Wrote the plan". Tapping opens
  that session at that card.

### What a non-technical person sees, and what's behind Details

| Always shown | Behind "Details" (or a setting "Show technical details") |
| --- | --- |
| the conversation, in plain text | raw tool input and output |
| steps as one folded line in words | each command, path, search pattern |
| cards with buttons | the keystrokes / exact permission rule |
| "Edited 2 files" with the diffs one tap away | the full `git diff`, the terminal |
| status in words | model ids, token counts, session ids, branch names |

Branch and worktree words disappear from the main UI: a session is "a
chat in a project"; "branch" appears only in Details and in Ship.

---

## 3. Themes

### Tokens

Today `app.css` uses palette tokens taken straight from Omarchy themes
(`--bg`, `--fg`, `--accent`, the ANSI colours), a monospace `--font` and
`--radius: 0`. Add a **semantic layer** both kinds of theme fill:

- surfaces: `--surface`, `--surface-raised`, `--surface-sunken`, `--scrim`
- text: `--text`, `--text-muted`, `--text-on-accent`
- `--accent`, `--accent-soft`, `--border`, `--focus`
- states: `--success`, `--warning`, `--danger`, `--info` (separate from the accent)
- chat: `--bubble-you`, `--bubble-you-text`, `--code-bg`, `--diff-add`, `--diff-del`
- shape and type: `--radius-s/m/l`, `--shadow-1/2`, `--font-ui`,
  `--font-mono`, `--font-reading`, a type scale, `--density`

Components use only these. `app_look_vars` maps a terminal palette onto them
(as it maps onto today's tokens), and app themes set them directly.

### App themes (postponed)

**Decided: postponed.** Julian will design the app themes with us later.
Until then **Hackerman** stays his look and the default for new installs,
and B1 builds only the token layer, so app themes can be added later without
touching components.

What they're meant to become, as input for that design session: clean,
regular-app looks (the system font, rounded corners, soft shadows, mono only
for code), each a light and dark pair following the device, each also
defining the 16 terminal colours so the terminal panel and Claude's TUI
match. They'd live in `themes/` like the others, with `kind = "app"` and a
`light` and `dark` block in `colors.toml`.

### Terminal themes (kept)

The 25 Omarchy palettes stay as they are, under their own heading, with
their monospace fonts and wallpapers. A terminal theme keeps today's look
(square, mono) unless you turn on "rounded".

### The picker

For now the picker stays as it is (the terminal themes, fonts, wallpaper).
When app themes arrive it gains: **Light · Dark · Match device** at the top,
an **App themes** section above the terminal ones, and cards that show a
tiny chat (a bubble, a reply, a button) in each theme instead of swatches.
The choice stays per server, as today (`amarchy theme`).

---

## 4. The terminal, as a secondary view

Two different terminals exist per session, and both stay:

- **The project terminal** (the session's own `term` window): running the
  project, a command, typing a password. Phone: the **Terminal** tab in the
  session header. Mac: the side panel's **Terminal** tab (it's beside Claude
  today; it moves into the panel, open by default for Julian, closed for a
  new user). Run / saved commands sit on its toolbar.
- **Claude's classic terminal** (the TUI): the fallback. "Open Claude's
  classic terminal" switches the session's engine (section 1) and shows it
  in the same Terminal tab; a banner offers "Back to chat".

A setting **Show terminals** (on for Julian, off by default for new users)
decides whether these are visible at all; off, the session menu still has
"Open terminal" under Advanced.

### Giving a secret without a terminal

Never through the chat (the transcript keeps everything, and Claude reads it).

- **Claude asks**: a new `amarchy secret ask NAME --why "..."` that Claude
  runs (the amarchy skill says when). The app shows a card: "Claude needs
  your **OpenAI API key** to run the tests. It's stored on your server and
  never shown in the chat." A password field and **Save**.
- **You add one**: Settings → Secrets, or the session menu → *Add a secret*:
  a name (with suggestions: `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`…), the
  value, and the scope (this project, or all projects).
- **Stored** in `~/.config/amarchy/secrets/projects/<project>.env` (and
  `all.env` for every project), mode 0600 in a 0700 folder, outside every
  repo. Never written into the worktree, so it can't be committed.
- **Delivered** to the project terminal (`amarchy shell` starts its shell
  with them, and bash takes them again at each prompt when they change),
  its run commands, and Claude's commands without a restart, through Claude
  Code's `CLAUDE_ENV_FILE`: ✅ (C3, 2.1.309, TUI and `-p`) the SessionStart
  hook's file is sourced before every Bash command, so the line amarchy's
  hook writes there (it sources the secret files, never a value) gives a
  secret saved or forgotten mid-session from the next command on. Claude is
  told the *name* is available as `$NAME`, never the value; its Read/Edit
  of the folder are denied, and a Bash command reading it is refused (the
  PreToolUse hook).
- **Never** `ANTHROPIC_API_KEY` or other Claude credentials: refused with an
  explanation, since it would switch Claude from the subscription to API
  billing.
- The app masks a known secret value wherever it would appear in the chat
  (tool output), as a backstop.
- `amarchy secret ask | list | set | forget` for the CLI and for scripts
  (done in C3: see docs/guide.md, "Secrets").

---

## 5. Phases

Each phase is one session's work and ships something you can see or use.
Three lanes can run in parallel; arrows are hard dependencies.

**Lane B: look (works on today's data, ships first)**

- **B1. The token layer only** (reduced: app themes postponed). The semantic
  tokens in `app.css`/`desk.css`, every component moved onto them, and
  `app_look_vars` mapping the terminal palettes onto them; the look stays
  exactly as it is (Hackerman by default). *Ships: no visible change, and
  every later phase styles through tokens, so app themes can come later.*
- **B2. The chat component on the phone.** `chat.js`/`chat.css` built from
  the phone's chat in `app.js`: bubbles, markdown, folded steps with
  friendly labels, diffs from Edit inputs, the TodoWrite checklist, the
  new composer look, today's scraped dialogs as the new cards. *Ships: the
  phone's chat looks finished, still on the TUI.*  (after B1's tokens)
- **B3. The Mac becomes chat-first.** desk.js uses `chat.js` in the middle,
  the side panel (Terminal, Changes, Details), the restyled sidebar list.
  *Ships: Safari on a Mac is a chat app with the terminal one click away.*
  (after B2)

**Lane A: engine**

- **A1. Broker spike and protocol test.** `amarchy agent <sid>`: spawns
  `claude -p` stream-json, live state file, socket, pane log. A conformance
  script (`bin/amarchy-protocol-test`, cheap haiku runs) covering everything
  in section 1, including what's still ❓: interrupt, images, SendMessage
  replies, partial messages, set_permission_mode. Behind a flag, for test
  sessions only. *Ships: proof, plus `docs/agent-protocol.md`.*
- **A2. Structured API and per-session opt-in.** Server routes: the live
  stream merged with transcript items, answer a request (permission,
  question, plan), interrupt, model, mode, send with images; the engine
  switch both ways with the lock; sleep, wake, send, close, reap and hooks
  working for chat-engine sessions. *Ships: "Try the new chat" on any
  session.* (after A1)

**Lane C: features on the structured data** (after A2 and B2)

- **C1. Real cards.** Questions (multi-select, previews, several at once),
  permissions with "always allow", plan approval, all from the structured
  requests; partial-text streaming; the "Working…" activity line.
- **C2. Composer.** Native image blocks (paste, picker, camera, drop), file
  upload, the `/` menu, model and mode pills, Stop, the queued-message chip.
- **C3. Terminal tab and secrets.** The Chat | Terminal switch on the phone
  (the project terminal on the phone for the first time), "Open Claude's
  classic terminal", Show terminals setting, `amarchy secret` and its cards.
  (C3's terminal part needs only B2/B3, so it can start earlier.)
- **C4. Dictation for the chat engine.** Test Web Speech in the home-screen
  app; else server speech-to-text. (Can start any time; must finish before A3.)
- **C5. List, new chat, notifications.** Restyled list rows with status in
  words and last line, the "What do you want to do?" new chat, notifications
  that say what's wanted and open the card.

**Then**

- **A3. Chat engine by default.** New sessions on `chat`; existing ones
  switch when idle or on waking; the setting to keep the TUI. (after A2, C1,
  C2, C4)
- **D1. Clean-up and docs.** *Done (shipped in the final-pass session).* Scraping kept only for the terminal engine,
  dead paths removed, `docs/guide.md` and `docs/parity.md` updated, an
  onboarding screen for a first-time user, accessibility pass (VoiceOver
  labels, focus, contrast in every theme).

**Running in parallel**

| Wave | Sessions at once |
| --- | --- |
| 1 | B1 (tokens), A1 (agent-spike), C4 (dictation): running |
| 2 | B2, A2 |
| 3 | B3, C1, C3 |
| 4 | C2, C5 |
| 5 | A3, then D1 |

Files to watch for collisions: `app/app.js` (B2 moves the chat out first,
so later phases touch `chat.js` instead), `app/app.css` (B1 owns the
tokens), and `app_handler` in `bin/amarchy` (A2 adds routes in one block;
C-phases add theirs after it).

## Risks

- **The control protocol isn't documented on its own.** The conformance
  script runs on `amarchy update` and when Claude Code's version changes; a
  failure keeps new sessions on the terminal engine and says why.
- **Two drivers on one conversation** would corrupt it: the per-session lock,
  checked by both engines.
- **Dictation** is the one feature without a ready replacement: C4 first.
- **Terms**: fine for amarchy as each user's own Claude Code (section 1);
  revisit if it's ever offered as a product.

## Decisions

Julian's answers, 2026-10-22:

1. **Engine: our own broker on `claude -p` stream-json** (option B), not
   the Agent SDK.
2. **App themes: postponed.** Julian designs them with us later. Hackerman
   stays his look and the default for now; B1 is the token layer only (no
   Paper/Graphite yet).
3. **Terminals: hidden behind "Show terminals" for new users** (on for
   Julian); off, the session menu keeps "Open terminal" under Advanced.
4. **Dictation: Web Speech first, server speech-to-text as the fallback**
   (C4); the keyboard's dictation works regardless.
