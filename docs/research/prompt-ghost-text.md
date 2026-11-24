# Tab-to-accept suggestions in the composer

Research and a prototype for Julian, 2026-11-23: gray text after the cursor
in a chat's box, what you'd likely write next, Tab to take it, as Cursor's Tab
does for code. Built behind Settings → Suggestions (off unless turned on, each
device its own), in `app/ui.js` (`uiGhost`), `app/chat.js`, and the server's
`suggest` (bin/amarchy, "suggestions as you type"). Tested by
`test/suggest-view.js` (phone and wide).

Julian's call (2026-11-23): no Anthropic API key; his Claude subscription or
something free and local. So Haiku runs through `claude -p` on his login, and
local models were measured too.

> **Summary**
> 1. **Feel comes from speed and restraint.** Every tool that feels good answers within a pause: Smart Compose under 60 ms p90, Zed 136 ms p50, Cursor 260 ms p50, Supermaven 250 ms. Cursor's RL work cut suggestions 21% and raised acceptance 28%: it shows one only when it's at least ~25% likely to be taken. Long, wrong or flickering suggestions are what people hate.
> 2. **Haiku on the subscription: ~0.7 s most of the time.** A `claude -p` takes ~0.65 s to start, so one is kept started and waiting. Then 7 in 10 suggestions come in 0.6–0.8 s; the rest 1.4–2.7 s, when Haiku stops to think (Claude Code can't turn its thinking off; a line in the prompt cuts how often). Over 48 replayed messages: 0.95 s typical, 2.7 s slow. Prefetching the next one makes Tab, Tab, Tab instant after the first.
> 3. **Local models lose here.** On this server's CPU (no GPU), Qwen3.5 0.8B writes nonsense, 2B is mediocre at ~1.3 s, 4B is decent at 3–6 s, and each pause would take 8 cores from the other chats. Not worth it.
> 4. **Prompts are harder to predict than code.** Replaying your own messages (48 cuts from 4 chats): the word you're typing, right 7 times in 10; the next 2+ words exactly as you wrote them, 10–20%. Copilot's acceptance is ~27%. The win is narrower than code: finishing words and names, answering the agent's yes/no questions, common follow-ups ("then ship it").
> 5. **Cost:** nothing more than your plan. Each suggestion is ~2,000 Haiku tokens against its usage; the waiting `claude -p` holds ~200 MB, and goes after 5 minutes unused.
> 6. **Recommendation:** ship it behind the switch, turn it on, and look at `amarchy suggest` after a week. Keep it only if the take rate holds above ~20%.

---

## Prior art

| Tool | Latency | Accept | What it teaches |
| --- | --- | --- | --- |
| Gmail Smart Compose | p90 < 60 ms ([paper](https://arxiv.org/abs/1906.00080)) | Tab | Asks on almost every keystroke, finishes the word first, stops at a sentence end, thresholds on confidence; a per-user model added +6% click-through |
| GitHub Copilot | debounce ~75 ms (unofficial) | Tab, Ctrl+→ a word, Esc dismisses ([docs](https://code.visualstudio.com/docs/copilot/ai-powered-suggestions)) | ~27–30% acceptance; long multi-line suggestions distract most; a filter hiding 25% of shown ones lost almost nothing ([study](https://arxiv.org/html/2306.04930v3)); off by default for markdown and plain text |
| Cursor Tab | p50 260 ms ([blog](https://cursor.com/en/blog/tab-update)) | Tab | RL to show only when ≥25% likely taken: 21% fewer, 28% more accepted ([blog](https://cursor.com/en/blog/tab-rl)) |
| Supermaven | 250 ms ([blog](https://supermaven.com/blog/introducing-supermaven)) | Tab | Speed is the product |
| Zed (Zeta) | p50 136 ms, p90 350 ms ([blog](https://zed.dev/blog/zeta2-1)) | Tab | A "subtle" mode shows them only while Alt is held |
| Claude Code prompt suggestions | (background, cached) | Tab or → into the box, Enter sends ([docs](https://code.claude.com/docs/en/interactive-mode#prompt-suggestions)) | A whole next prompt into an empty box, not completion while typing; shows fewer after 20 ignored in a row |
| Cotypist (macOS) | local model | Tab: next word; a second key: all ([site](https://cotypist.app/)) | Word-at-a-time acceptance for prose |
| Apple inline predictions | on-device | Space | Short: the word or phrase |

## How the prototype works

- **Gray text** is a copy of the box's words laid exactly over the textarea, invisible but for the suggestion (and a `Tab` keycap on a computer, `⇥` on a phone). It grows the box a line when it wraps, and gives it back.
- **Keys:** `Tab` takes all; `→` at the end (or Ctrl/Option+→) a word with its punctuation; a tap on the gray text takes all (the phone's way). Typing what it says eats it without asking again; anything else, moving the cursor, leaving the box drops it. **Esc is never used** (amarchy's rule: Esc only stops Claude; Claude Code's own suggestions don't need it either). Enter sends only what you wrote.
- **When:** 250 ms after you pause, only with the cursor at the end, never on a `/` command, while dictating or with an IME composing (fcitx5's Tab during composition is left alone). With an empty box, once Claude's reply is in and not one you already answered: what you'd answer.
- **Tab, Tab, Tab:** while one shows, the next one (after it) is fetched; Tab shows it at once. A slow answer you typed past as it said still shows what's left of it.
- **Haiku kept ready** (`SuggestPool`): a `claude -p` (stream-json, no tools, no settings, no MCP, Haiku, effort low) started and waiting; each answers one suggestion and ends, so its conversation never grows, and the next is started meanwhile. The box's focus starts one. A suggestion of a chat you've written on otherwise is ended. The waiting one goes after 5 minutes unused.
- **Context (all on your server and your Claude account):** your last ~30 messages across chats (how you write; read every 10 minutes; forwarded mails and timers' messages left out), this chat's last 5 messages of yours and Claude's last reply (3,500 characters), the project and title, and the draft.
- **Joining words reliably:** the word you're typing is taken off the draft and given apart (`<typing>co</typing>`); the reply must start with that word, else it's dropped. Haiku asked to continue from inside a word loses its letters ("co" → "lombia"); this way it can't misjoin.
- **Output contract:** `<continuation>…</continuation>`; anything outside the tags (a note about the task) is dropped, and an empty one means "not sure": nothing shows.
- **Logged** in `~/.local/state/amarchy/suggest.jsonl`: how long, whether Haiku thought, and what became of each (taken with Tab, a word at a time, typed as it said, gone). `amarchy suggest` sums it up; `amarchy suggest try "<text>" --id <chat>` asks for one from the CLI.

## Measurements

Model: `claude-haiku-5-5` (Claude Code's `haiku`). Context ~2,000 tokens.

| Path | Typical | Slow | Notes |
| --- | --- | --- | --- |
| `claude -p` started per suggestion | 1.3–1.6 s | 4.3 s | ~0.65 s of it is start-up |
| `claude -p` kept ready (built) | 0.95 s | 2.7 s | 0.6–0.8 s when Haiku doesn't think (7 in 10); 1.4–2.7 s when it does |
| Qwen3.5 0.8B, local, 8 threads | 0.7–1.5 s | | nonsense ("is the first letter of the next word") |
| Qwen3.5 2B, local | 1.3 s | 2.8 s | mediocre |
| Qwen3.5 4B, local | 3.0–3.5 s | 6.4 s | decent; ~500 tokens re-read each time (its hybrid layers defeat llama.cpp's prompt cache) |
| Anthropic API, thinking off | (not built) | | declined: no key |

Claude Code ignores `MAX_THINKING_TOKENS=0`, `CLAUDE_CODE_DISABLE_THINKING` and `alwaysThinkingEnabled: false` for Haiku 5.5's adaptive thinking; "Answer at once: this is a split-second guess" in the prompt cut it from ~1 in 2 to ~1 in 4 while typing (empty-box suggestions, a whole message, still think most of the time).

Replay of your real messages (48 cuts, 4 chats, the chat as it was then, kept-ready path):

| Cut | Shown | First word right | 2+ words exactly right | Typical |
| --- | --- | --- | --- | --- |
| Mid-word | 10 of 12 | 7 | 1 | 1.7 s |
| A third in | 10 of 12 | 3 | 2 | 0.94 s |
| Two thirds in | 11 of 12 | 2 | 1 | 0.79 s |
| Empty box | 5 of 12 | 2 | 0 | 1.7 s |

Exact match understates it: "colombianos al día" for your "colombianos por día" is a suggestion you'd likely take.

## Cost

- Nothing more than your plan: each suggestion is ~2,000 Haiku tokens (Claude Code caches its system prompt, not the rest) against your usage; a heavy day (1,500 suggestions, prefetch included) is ~3M Haiku tokens.
- On the server: ~200 MB for the waiting `claude -p` while you use suggestions, and ~0.5 s of a CPU core to start each one.

## Open questions

- **Speed:** Haiku's thinking is the slow 3 in 10. If the Mac (M5 Pro) gets a working GPU on Omarchy, a local model there could be fast; on this server's CPU, no.
- **Restraint:** no confidence score comes back. Shorter suggestions and showing fewer after 20 ignored in a row (as Claude Code does) are the levers.
- **Phone:** a tap on gray text works, but the phone's own keyboard suggests words too; it may be noise there.
- **Chats on another machine:** asked through the pass-through to that machine (its own `claude -p`); not tested yet.
