# T3 Code vs amarchy

Research for Julian, 2026-10-26. T3 Code (pingdotgg/t3code, MIT, HEAD `07123980`, v0.1.2) read
from source, plus a sandboxed trial on this server (its own `T3CODE_HOME` in `/tmp`, a throwaway
repo, one Haiku turn on your login). Nothing of amarchy was changed.

> **Summary**
> 1. **Same engine, so no.** T3 Code doesn't drive Claude better than amarchy. Both run `claude` in stream-json mode with `--permission-prompt-tool stdio`; T3 just reaches it through the Agent SDK. It could do most of what amarchy does, but not on your phone the way you use it: it sends no Web Push to a PWA, its phone push needs its hosted T3 Connect relay (Clerk + Cloudflare), its voice input is iOS-26-only on-device, and it has no assistant/brief/`amarchy send` model.
> 2. **Where it is ahead:** per-turn checkpoints with "edit from here / revert files", per-turn diffs with review comments sent back to the agent, a browser the agent drives while you watch, `delegate_task` that wakes the parent with the result, usage-limit auto-resume, one systemd scope per agent, port detection, full-text search, PR flow and watch.
> 3. **Where amarchy is ahead:** Web Push with no relay, Tailscale-identity auth with no pairing, host-side Parakeet dictation in the PWA, 1-minute sleep (T3 keeps an idle Claude for 30 minutes), real tmux terminals with Claude's classic TUI as a fallback, the brief view, the assistant, secrets as env vars, and generic systemd-timer Automations. All of this in about 25k lines (stdlib Python + vanilla JS) against T3's ~975k lines of TypeScript, and with no telemetry (T3's is on by default).
> 4. **Adopt, in order:** usage-limit auto-resume; per-chat systemd scopes; `--report-to` delegation; turn checkpoints and rewind; review comments from Changes; agent-driven browser checks with screenshots in the brief; port cards; message search. The full ranked list is [below](#3-what-amarchy-should-adopt-ranked).
> 5. **Reuse:** no code wholesale (Effect-TS monolith, different stack), but several mechanisms port as-is: the hidden-ref checkpoint recipe, the PR-watch wake rules, the restart-continuation guard, the systemd-scope/OOM wrapper, the system-prompt text for its orchestration tools. MIT only needs the notice kept if code is copied.

---

## 1. How T3 Code works

### Shape

- **One server per machine** (`t3 serve`, Node 26, Effect-TS v4), serving clients over WebSocket RPC (~230 methods, `effect/rpc`, JSON, permessage-deflate):
  - a web app (React; also hosted static at app.t3.codes);
  - Electron desktop (bundles the server);
  - native iOS/Android (Expo SDK 58, React Native 0.88).
- **State:** one SQLite file (`~/.t3/userdata/statev2.sqlite`, WAL), **event-sourced**. Commands go to a per-thread-locked `Orchestrator`. One transaction writes events, ~16 projection tables, a command receipt and an *outbox* of side effects. An `EffectWorker` performs those effects (start a provider turn, interrupt, capture a checkpoint, generate a title…). Provider output comes back as events.
- **Crash recovery:** on start, unfinished runs are ended with a note ("Cancelled because the server restarted…"). If the project allows it, `RestartContinuation` then sends "Continue where you left off." Limits: at most 3 in a chain within 5 minutes, and only on a strong native thread ref. Queued messages survive, held until you press Resume.
- **Sync:** every client subscribes to the same post-commit stream (snapshot at sequence N, then events > N). A resume replays at most 128 events / 1 MiB, else sends a fresh bounded snapshot (10 turns, 75 items, 1 MiB). Older history pages over HTTP.
  - Performance discipline is a core value. Command output is never in events (a separate throttled tail hub), text deltas are coalesced at 50 ms, there are per-subscriber budgets, and a `test:perf:v2-wire` suite guards it.
- **Size:** about 220k lines in the server, 277k in web, 139k in mobile, 41k in desktop and 280k in packages (non-test TypeScript), plus a similar volume of tests. Replay-backed integration tests run on ~146 recorded provider fixtures, with mocking of the orchestrator forbidden. It has 30k stars and PR numbers around #25,400, mostly written by agents. The 0.0.45 → 0.1.2 releases in October alone moved fast: "expect bugs" is fair.
- **Telemetry** is on by default. PostHog batches go via `ingest.t3.codes`: turn completed, provider/model/effort/mode, token totals, MCP tool names. The distinct id is a hash of your Claude userID. Opt out with `T3CODE_TELEMETRY_ENABLED=false`.

### How it drives the CLIs

| Provider | Transport |
| --- | --- |
| **Claude Code** | `@anthropic-ai/claude-agent-sdk` 0.3.276 `query()` with `pathToClaudeCodeExecutable` = your `claude`. The SDK spawns it as `claude --output-format stream-json --input-format stream-json --permission-prompt-tool stdio --include-partial-messages …` (seen in `ps` during the trial). This is **the same wire protocol amarchy's broker speaks** (`docs/agent-protocol.md`). |
| Codex | `codex app-server`, stdio JSON-RPC (schema-generated client) |
| Cursor | `@cursor/sdk` |
| OpenCode | `opencode serve` + SDK, SSE events |
| Grok, Antigravity, ACP-registry agents | ACP over stdio (`packages/provider-acp`) |
| Pi, Muse | their own RPC / SDK |

**Claude specifics** (all in `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`, about 11k lines):

- **Process:** one long-lived Claude process per thread, reused across turns. An idle one is released after 30 minutes (in the trial it held 309 MB after its turn). The prompt is an async queue of `SDKUserMessage`s.
- **Stop:** `interrupt()`, then close the process. The next turn resumes it.
- **Steering:** `priority: "now"`. Before steering, it calls `backgroundTasks()` so a running subagent isn't killed.
- **Changing model and options mid-thread:** `setModel` and `applyFlagSettings({effortLevel, fastMode})` on the live process. A thinking toggle restarts the process with `resume`.
- **Rollback:** `resumeSessionAt: <message uuid>`. **Fork:** the SDK's `forkSession(sessionId, {upToMessageId})`.
- **Spawning:** each agent runs under `systemd-run --user --scope --slice=app-t3code-agents-….slice --property=OOMPolicy=stop`, with `oom_score_adj=800`. A watcher kills the whole process group if the server dies.
- **Permission modes:**

  | T3 mode | Claude mode | Default? |
  | --- | --- | --- |
  | Supervised | `default` | |
  | Auto-accept edits | `acceptEdits` | |
  | Auto | `auto` | |
  | Full access | `bypassPermissions` | **yes** |

  Plus `plan`.
- **Approvals:** `canUseTool` parks a deferred and shows a card. *Always allow* = `addRules` with destination `session`. AskUserQuestion is answered with `updatedInput.answers`.
- **ExitPlanMode is denied:** "the client captured your proposed plan". The plan becomes a card with **Implement** / **Implement in a new thread**.
- **Pending approvals don't survive a restart** (`pendingRequestsSurviveRestart: false`).
- **Probes, usage and cost:**
  - Slash commands and the account come from a probe `query()` that never sends a prompt (`initializationResult()`).
  - Rate limits come from an experimental SDK usage call, plus `rate_limit_event`.
  - Cost is computed by scanning `~/.claude/projects` JSONL with LiteLLM prices. These are API-equivalent estimates, not billing.
- **Disk fallbacks:** background-command output is tailed from Claude's private `/tmp/claude-<uid>` task files, since the SDK holds it until the tool result. `/goal` state is parsed from transcript text. So even T3 falls back to disk where the protocol is silent, as amarchy does.

**Switching provider mid-thread** is not a replay. One app thread holds several native threads. Going back to a provider resumes its own thread plus a deterministic "delta handoff" text summary of what it missed (each item cut to 240 chars). Reviewers note context is lost.

### Its MCP server, injected into every agent

Every session gets an HTTP MCP server `t3-code` at `http://127.0.0.1:<port>/mcp` with a per-session bearer token (only its hash stored). Claude gets `--allowedTools mcp__t3-code__*`, and the system prompt is appended with rules on when to use each tool. The tools seen in the trial:

| Group | Tools | What they do |
| --- | --- | --- |
| Delegation | `delegate_task`, `task_status`, `task_cancel`, `create_threads`, `orchestrator_capabilities`, thread send/read/wait | A child thread of any provider/model, in the parent's checkout or a new worktree, never with broader permissions than the parent. **Async by default: the child's completion wakes the parent with its summary** ("end your turn, do not poll"). |
| Schedules | `schedule_task`, `list/update/delete_scheduled_task`, `run_scheduled_task_now` | Interval (≥60 s), time-of-day + weekdays, or webhook (HMAC; a public URL needs T3 Connect). Each fire queues a turn into the bound thread or launches a new one. Ids are deterministic, so retries are idempotent. |
| Browser | `preview_open/navigate/click/type/press/hover/drag/scroll/select/upload/snapshot/evaluate/dialog/wait_for/resize/set_appearance`, `preview_recording_start/stop` | Playwright driving a pinned chrome-headless-shell (~120 MB). **You watch live**: a CDP screencast in the Preview panel, picture-in-picture on the phone, with the agent's cursor shown and "take control". Recordings are saved as mp4/webm. |
| Visual replies | `html_preview` (PNG back to the agent), `html_render` (a sandboxed, theme-aware HTML page inline in the reply) | |
| Devices | `device_list/open/close/screenshot` | iOS Simulator / Android emulator, local, over SSH or EAS cloud, streamed to a Device panel. |
| Secrets | `request_secret` | A card in the timeline. The value is kept 0600 under `secrets/`. The agent gets a one-use `secret-ref:` usable only by T3's own tools, or a temp file. |
| PRs | `link/unlink_pull_request`, `list_thread_pull_requests`, `watch_pull_request`, PR guides | **Watch** polls every 2 min and wakes the thread when checks fail, required checks pass, someone else comments or reviews, a conflict appears, or there are still no checks after 15 min. It stops on merge, close or settle, after 10 comment-only wakes, or after 8 failed reads. |

Outside agents (e.g. Claude Code in a terminal) can reach the same MCP via OAuth (PKCE), read-only by default.

### Worktrees, checkpoints, diffs, PRs

- **Worktrees are optional per thread:** local checkout, new worktree, or an existing one.
  - Location: `~/.t3/worktrees/<repo>/<branch>`. The branch starts as `t3/<8 hex>` and an AI renames it after the first message.
  - The base is recorded in git config (`branch.<b>.t3-merge-base`).
  - `t3.json` scripts with `runOnWorktreeCreate` (async by default) do setup. There is no built-in `.env` copy.
  - Cleanup rules: after N idle days, on settle, on merge (squash-aware), or when there are no commits. Archive leaves the worktree; delete asks.
- **Checkpoints:** hidden commits under `refs/t3/orchestration-v2/checkpoints/<scope>/ordinal/<n>`.
  - Written through a temporary index (`GIT_INDEX_FILE` copy → `read-tree HEAD` → `add -A` → `write-tree` → `commit-tree -p HEAD` → `update-ref`), so your index and history are untouched.
  - One checkpoint before and one after each turn.
  - **Edit from here** offers *Revert and keep changes* (conversation only) or *Revert files too*. The latter runs `git restore --source <ckpt> --worktree --staged`, then `git clean -fd`, and rolls the provider back with `resumeSessionAt`.
  - File restore is refused when another thread shares the path.
- **Diffs** come in three scopes:
  - per turn (checkpoint N-1 → N, excluding files that a pull or merge brought in);
  - uncommitted;
  - vs the base's merge-base.

  They are rendered with `@pierre/diffs` in a web worker. **Selecting lines and commenting makes a chip in the composer**, which is sent to the agent with the file, range and excerpt.
- **PRs:**
  - The action is `commit | push | create_pr | commit_push_pr`.
  - AI writes the commit message and the PR title/body (with the thread transcript as reference). The default writer is a cheap Codex model.
  - GitHub is reached over REST/GraphQL, with the token from Settings, `GH_TOKEN` or `gh auth token`.
  - There is a PR list and review page, checks rollup, **merge and auto-merge from the UI**, "Resolve conflicts" handed to an agent, and AI "review guides" (a guided tour of a diff).

### Remote and mobile

- **Routes:** LAN, Tailscale, SSH or T3 Connect all reach the same server. A client keeps an ordered list of routes and learns the server's LAN/tailnet IPs, so it falls back to the closest one.
- **Auth is always pairing.**
  - A one-time token with a 5-minute lifetime, as a URL or QR code (`t3 pair`).
  - Then a 30-day session: cookie, bearer or DPoP-bound, with scoped RPC permissions.
  - Network position grants nothing, and **no Tailscale identity is used** (`tailscale serve` is only for HTTPS).
- **SSH mode:** the desktop app SSHes in, installs a pinned release, starts `t3 serve` on loopback and tunnels it (`ssh -N -L`).
- **T3 Connect:** Clerk login. A Cloudflare Tunnel runs per environment, and the relay (a Cloudflare Worker + Postgres) brokers bootstrap but not the traffic. Cloudflare still terminates TLS, so it is not end-to-end. It is also the only path for push, and the relay sees project and thread titles.
- **Headless:**
  - `t3 service install` writes a systemd user unit with linger.
  - `t3 update` stages the new version, snapshots the DB, runs a trial start and rolls back on failure.
  - Without `--host`, it binds all interfaces but drops non-private peers.
- **Mobile app:**
  - threads, composer and attachments; approvals and questions; diffs and review comments;
  - a native terminal (libghostty) over the RPC; browser and device streams;
  - an offline outbox; Live Activities and widgets;
  - voice: iOS 26+ on-device Apple transcription only.

  **Push = APNs/FCM through the relay, so T3 Connect is required. The web app has no service worker and no Web Push at all**: a PWA only alerts while it is open.

### UI highlights (web)

- **Sidebar:** Pinned / Active / Working / Snoozed / Settled sections. Auto-settle after 3 idle days or on PR merge, undo for 5 s, drag to pin or settle.
- **Composer:**
  - **Composing:** TipTap rich text. `@` mentions files or other threads, `/` lists commands, `$` lists skills, `#` lists PRs.
  - **Attaching:** paste ≥32 KiB becomes a file; terminal excerpts and diff comments become chips; "cite" a passage of a reply.
  - **Sending:** queue or steer (one modifier flips it), a reorderable server-side queue, prompt history on ↑, a prompt stash.
  - **Models:** shift-click several models to fan one prompt out to parallel worktrees.
- **Output:**
  - work-log groups ("Ran 2 commands and…"), thinking rows, a tasks badge ("3 of 5"), plan cards;
  - Mermaid and KaTeX, a context-window ring with compaction;
  - a usage page; FTS5 trigram full-text search over all messages;
  - a timeline minimap; fork from any reply.
- **Panels:** diff, files (browse and edit), terminal (node-pty, libghostty-vt render, several per thread), preview, device, PR.
- **Port scanner:** found dev servers show as "open preview" cards.
- **Controls:** `mod+K` palette with frecency, ~60 rebindable keys (VS Code-style `when`), a theme editor with VS Code theme import.

## 2. Side by side

| | T3 Code | amarchy |
| --- | --- | --- |
| Agents | Claude, Codex, Cursor, Grok, OpenCode, Antigravity, Pi, Muse | Claude Code only |
| Claude transport | Agent SDK `query()` → `claude` stream-json | Own broker → `claude -p` stream-json (same protocol), TUI fallback in tmux |
| Login | each CLI's own (your subscription) | `claude` login, `ANTHROPIC_API_KEY` stripped |
| Default permissions | **Full access (bypass)** | `--permission-mode auto` |
| State | event-sourced SQLite, outbox, projections | Claude's transcripts + small state files; tmux |
| Code size | ~975k lines TS (+ as much test) | ~12.4k Python (stdlib) + ~12k JS/CSS |
| Worktree per task | optional per thread, `~/.t3/worktrees` | always, `~/Work/.worktrees/<repo>/<name>` |
| Setup on new worktree | `t3.json` `runOnWorktreeCreate` | run command / saved commands, by hand |
| Turn checkpoints / rewind | ✓ hidden refs, revert files and/or conversation | ✗ (`/rewind` only in Claude's classic terminal) |
| Fork a thread | ✓ from any reply | ✗ |
| Diffs | per turn, uncommitted, vs base; comments → agent | Changes panel vs base (+ per-turn in the brief); no comments |
| Ship | commit/push/PR with AI text, merge from UI, PR watch | "ship it" = merge to main + install, done by Claude |
| Terminals | node-pty, several per thread | real tmux (shared live across phone and browser), Claude's TUI on the same conversation |
| Browser preview for agent + you | ✓ live screencast, agent drives it, recordings | ✗ |
| Port detection | ✓ preview cards | ✗ (Claude serves on the tailnet IP and says the URL) |
| Delegation | `delegate_task`, child wakes parent | `amarchy new --prompt` + SendMessage; no automatic report back |
| Scheduling | agent-made schedule/webhook tasks | systemd timers, all of them, in Automations (run now, pause, logs); agents write units |
| Usage-limit handling | auto-resume or snooze at reset | shows the plan's use in Details |
| After a restart | "Continue where you left off" (guarded) | chats come back asleep; sending wakes them |
| Idle memory | Claude kept 30 min (309 MB), server 445 MB | Claude exits after 1 min idle, open nowhere |
| Process isolation | systemd scope per agent, OOM policy | one scope for the whole tmux server |
| Search | FTS5 over every message | names, projects, branches, Claude's titles |
| Replies | markdown + work log, HTML renders | **brief view** (`update_brief`): outcome, points with whys, tables, artifacts with actions |
| Assistant / life manager | — | ✓ pinned assistant, own chime, `amarchy send` / `notify` |
| Remote auth | pairing tokens, sessions, DPoP, scopes | Tailscale identity (`APP_USERS`), no pairing |
| Phone push | native app via hosted relay only; **no Web Push** | Web Push to the home-screen app, from your server, no relay |
| Phone app | native iOS/Android, Live Activities, widgets | PWA; share sheet via a Shortcut |
| Dictation | iOS 26 on-device only | host Parakeet (Spanish + English), any browser or phone |
| Secrets | `request_secret` → one-use ref / temp file | `amarchy secret ask` → card → env vars in Claude's commands, terminal and run commands |
| Telemetry | on by default (PostHog via ingest.t3.codes) | none |
| Updates | `t3 update` with trial start and rollback | `amarchy update` timer from GitHub main + protocol-check |

## 3. What amarchy should adopt (ranked)

Ranked by value to Julian's actual use: many parallel chats on one always-on server, driven from the phone, with Jaken orchestrating. Effort: S = a day or less, M = a few days, L = a week or more.

| # | Adopt | User value | Effort | amarchy files |
| --- | --- | --- | --- | --- |
| 1 | **Usage-limit auto-resume.** When a turn ends on the plan's limit, show "Resumes at 14:05" on the card and send "Continue" at `resetsAt` (from `rate_limit_event`, already kept in `live["rate_limits"]`), with Cancel. A chain cap, like T3's. | A dozen chats on Max hit the 5-hour window together; today each one just stops until you notice. | S | `bin/amarchy` (`Agent.on_result`, `Agent` rate-limit handling, a transient timer like `amarchy send --no-wait`), `app/chat.js` (card line), `docs/guide.md` |
| 2 | **A systemd scope per chat** (`--slice=amarchy-chats.slice`, `OOMPolicy=stop`, raised `oom_score_adj` for Claude and its children). Memory per chat in Details and the list. | One runaway build or dev server can't take the box, the app or the other chats down; you see which chat eats memory. Sleep and close also get the chat's processes from the cgroup, not a `/proc` scan. | S–M | `bin/amarchy` (the `tmux` wrapper ~L4393, `claude_argv`, `agent_argv`, `sleep_blockers`, `cmd_reap`), `install.sh` (slice unit) |
| 3 | **Delegation that reports back:** `amarchy new <project> --prompt … --report-to <parent>`. When the child's turn ends, its brief (title + points) is `amarchy send`-ed to the parent, which wakes. The skill says "end your turn, don't poll". | Jaken and any chat can fan out work and get results without you relaying; this is T3's `delegate_task` without a new MCP server. | S | `bin/amarchy` (`cmd_new`, Stop hook / brief write path), `skill/SKILL.md`, `docs/guide.md` |
| 4 | **Turn checkpoints and "Undo this turn"**, using T3's hidden-ref recipe (temp index → `commit-tree` → `refs/amarchy/ckpt/<sid>/<n>`) before and after each turn. Two menu items on a reply: **Undo the conversation from here** (resume at that message uuid / `rewind_files` control request) and **…and its changes**. | Undo a bad turn from the phone, without the classic terminal's `/rewind`. Also gives exact per-turn diffs. | M | `bin/amarchy` (UserPromptSubmit / Stop hooks in `hook_settings`, `Agent` control requests, `app_changes`), `app/chat.js` (reply menu), `docs/agent-protocol.md` (verify `rewind_files` / `--resume-session-at` in `amarchy-protocol-test`) |
| 5 | **Review comments from Changes:** select lines in a file's diff, write a note, and it goes into the chat's box as a quoted chip (file, lines, excerpt); several make one message. On the phone, a long press on a line. | You review on the phone and tell Claude exactly what to fix, instead of describing where. | M | `app/desk.js` (Changes panel), `app/chat.js` (composer chips), `app/chat.css` |
| 6 | **Agent-driven browser checks with screenshots in the brief.** Give each chat a headless browser (Playwright MCP or a small `amarchy browser` wrapper), and let `update_brief` artifacts carry an image (`type: image`, a path). Later: a live view in the side panel. | CLAUDE.md already demands "verify in the real app, phone and browser". Today Claude can't see the app; this lets it check and show you the proof in the reply. | M (screenshots) / L (live view) | `bin/amarchy` (`claude_argv` MCP args, `brief_mcp` schema, `BRIEF_VERSION`), `app/chat.js` (image artifact), `skill/SKILL.md`, `install.sh` (browser fetch) |
| 7 | **Port cards:** find ports listened on by processes of the chat's worktree (amarchy already reads `/proc/net/tcp`) and show "Running: http://amarchy:5173 · Open" over the chat and in Details. | One tap to the dev server from the phone, without asking Claude for the URL. | S | `bin/amarchy` (session state for the app, next to `sleep_blockers`' process walk), `app/chat.js`, `app/desk.js` |
| 8 | **Search inside conversations:** an FTS5 index (Python's `sqlite3`) over user and assistant text of the transcripts, updated on Stop; results open the chat at the message. | "Which chat talked about the Stripe webhook?" across 30 chats and closed ones. | S–M | `bin/amarchy` (index + `amarchy search`), `app/app.js`, `app/desk.js` (search box) |
| 9 | **Continue after a restart, guarded:** a chat whose turn was cut by a reboot or a crash of its Claude gets one "Continue where you left off" (at most 3 in 5 minutes), only if it was mid-turn and nothing waits for you. | Work done overnight keeps going after a kernel update or OOM, rather than waiting for you to poke it. | S | `bin/amarchy` (`cmd_woke` / wake path, `Agent` result handling) |
| 10 | **Fork a chat from a reply:** a new chat (new worktree from this one's branch HEAD) whose Claude starts as `--resume <id> --fork-session` cut at that message. | Try a second approach without losing the first. | M | `bin/amarchy` (`cmd_new`, `make_worktree`, `claude_argv`), `app/chat.js` |
| 11 | **Worktree setup command:** a project's saved command marked "on new chat" (e.g. `npm ci`, copying `.env` from `$AMARCHY_ROOT`) runs in the chat's terminal as the worktree is made, and Claude starts at once. | New chats in Node/Python projects work on the first message, without "install the deps" each time. | S | `bin/amarchy` (`make_worktree`, `cmd_run --save`), `app/app.js` (Commands… toggle) |
| 12 | **Composer niceties:** ↑ in an empty box recalls your last messages; a "cite" on a selected passage of a reply; `@` for files of the worktree. | Small, daily-use speedups on the computer. | S each | `app/chat.js`, `app/desk.js`, `bin/amarchy` (file list for `@`) |
| 13 | **Agent-made schedules as a command:** `amarchy schedule <session> "<when>" "<text>"` makes a transient timer running `amarchy send`, with `X-Amarchy-*` lines, so it shows in Automations with Run now and Pause. | Jaken and chats can set reminders and follow-ups ("check the deploy at 9") without writing unit files. | S | `bin/amarchy` (`cmd_automations` neighbours, `systemd-run` like `amarchy send --no-wait`), `skill/SKILL.md` |
| 14 | **Watch after shipping:** for projects that deploy from main (GitHub Actions), poll the run after a ship and wake the chat when it fails. The rules are T3's: failure, conflict, or no checks after 15 minutes. | A ship that breaks CI comes back to the chat that made it. | M | `bin/amarchy` (ship path in `skill/SKILL.md`, a timer, `gh run list`) |
| 15 | **Context ring:** how full the conversation is (`get_context_usage`, already wired in the broker), with Compact. | Know when a long chat is about to auto-compact. | S | `app/chat.js`, `bin/amarchy` (`Agent` poll on result) |

Not ranked but noted:
- T3's *settle / snooze* lifecycle. amarchy's priority + Done + close covers it.
- Multi-model fan-out. Its value is low on one Claude plan.
- HTML renders in replies. The brief's tables and artifacts cover most of it, and an image artifact (#6) covers the rest.

## 4. What amarchy should NOT copy

- **Multi-provider support.** It is about a third of T3's complexity: a capability matrix, handoff summaries, provider-specific permission semantics, adapter churn on every CLI release (reviewers name this the hardest ongoing cost). And it buys nothing on a Claude Max plan. Revisit only if you start paying for Codex too.
- **Event-sourced orchestration with SQLite projections and an outbox.** It solves a multi-provider, multi-client, multi-environment product. amarchy's truth is Claude's own transcript and tmux, which survive amarchy restarts by themselves. Copying it would mean rewriting amarchy.
- **Pairing tokens / DPoP / scoped sessions.** Tailscale identity already authenticates every request with nothing to leak or expire. T3 needs pairing because it supports untrusted networks and a public hosted client.
- **A hosted relay for push (T3 Connect).** amarchy's Web Push goes from your server straight to Apple and Google, with no account and no third party seeing thread titles.
- **A native mobile app.** Store builds, Expo and two codebases. The PWA already does push, dictation, share and terminals. A Live Activity is the only thing out of reach, and not worth an app.
- **Full access as the default.** It is not a security boundary on a server holding your keys. Keep `auto`.
- **Keeping idle Claudes for 30 minutes.** amarchy's 1-minute sleep is what makes 30 chats fit in memory.
- **Telemetry.**
- **Owning PR creation and merge in the UI.** Your flow ships to main by Claude ("ship it"). A PR page is weight for a workflow you don't use. #14 takes the useful part, being told when CI breaks.
- **Its own terminal stack** (node-pty + libghostty). tmux is better here: one live terminal shared by phone and browser, surviving app restarts, with Claude's classic TUI on the same conversation.

## 5. Can T3 Code's code be reused?

MIT: anything copied keeps T3's copyright and licence notice (e.g. in a `NOTICE` file or the header of the file it lands in).

- **Not as a library.** The server is Effect-TS v4 (Context/Layer/Schema everywhere), Node 26, about a million lines. amarchy is stdlib Python plus vanilla JS. Pulling a T3 package in would drag Effect and its schemas along.
- **As recipes, yes.** These are short enough to re-implement from reading, which needs no notice:
  - **Checkpoints:** the temp-index → `commit-tree` → `update-ref` sequence and the restore/clean sequence (`apps/server/src/vcs/GitVcsDriver.ts` ~L819–1200, `CheckpointRestoreSafety.ts`).
  - **The systemd-scope wrapper** with the EOF watcher that kills the process group (`spawnClaudeProcessGroup`, `ClaudeAdapterV2.ts` ~L318).
  - **PR-watch wake rules and stop conditions** (`orchestration-v2/pullRequestWatch.ts`).
  - **Restart continuation guards** (`RestartContinuation.ts`: strong ref, chain of 3 in 5 minutes).
  - **The orchestration instructions** appended to the system prompt (`packages/provider-core/src/server/orchestrationInstructions.ts`). Good wording for "delegate, then end your turn; don't poll" and "ask for secrets with the tool, never in chat".
  - **Claude protocol details amarchy doesn't use yet:**
    - steering moves foreground subagents to the background first (`backgroundTasks()`);
    - `applyFlagSettings({effortLevel, fastMode})` changes these mid-session;
    - the init-only probe for commands and the account;
    - background-command output is tailed from `/tmp/claude-<uid>`.

    Each is worth a check in `bin/amarchy-protocol-test`.
- **Front-end pieces** (`@pierre/diffs` for diffs) are separate npm packages with their own licences. amarchy's no-build vanilla JS would need a bundled copy, which isn't worth it for the current Changes panel.

## Method

- Shallow clone at `07123980` in `/tmp/t3study`, read by subsystem: providers, orchestration and sync, git, remote and mobile, web UI, injected MCP and telemetry.
- Ran `t3 serve` 0.1.2 from the npm launcher (checksummed release) with `T3CODE_HOME` in `/tmp`, bound to the tailnet IP. Added a throwaway repo and ran `t3 thread start --worktree HEAD --wait` on Haiku. It completed in 7 s.
- Then inspected the spawned `claude` argv, the systemd scope, the MCP tool list, the state layout (299 MB home) and memory.
- Reviews read for outside views:
  - [Flavio Copes, 0.1.0](https://flaviocopes.com/t3-code/)
  - [Better Stack](https://betterstack.com/community/guides/ai/t3-code/)
  - [Nicolas de Ville, 0.0.45](https://notes.nicolasdeville.com/ai/t3-code/)
