# Tab-to-accept suggestions in the composer

Research and a prototype for Julian, 2026-11-23: gray text after the cursor
in a chat's box, what you'd likely write next, Tab to take it, as Cursor's Tab
does for code. Built behind Settings → Suggestions (off unless turned on, each
device its own), in `app/ui.js` (`uiGhost`), `app/chat.js`, and the server's
`suggest` (bin/amarchy, "suggestions as you type"). Tested by
`test/suggest-view.js` (phone and wide).

> **Summary**
> 1. **Feel comes from speed and restraint.** Every tool that feels good answers within a pause: Smart Compose under 60 ms p90, Zed 136 ms p50, Cursor 260 ms p50, Supermaven 250 ms. Cursor's RL work cut suggestions 21% and raised acceptance 28%: it shows one only when it's at least ~25% likely to be taken. Long, wrong or flickering suggestions are what people hate.
> 2. **Haiku 5.5 is fast enough to be useful, not Cursor-fast.** Model time is 0.6–0.75 s for a suggestion when it doesn't think. Through your Claude login (`claude -p`) add ~0.65 s of start-up and Haiku sometimes thinks anyway: 1.3–1.6 s typical, 2–4 s at worst. Through the API with thinking off, about 0.6–0.8 s (to be measured once a key is saved). Prefetching the next suggestion makes Tab, Tab, Tab instant after the first.
> 3. **Prompts are harder to predict than code.** Replaying your own messages (48 cuts from 4 chats): finishing the word you're typing, right 9 times in 12; the next 2+ words exactly as you wrote them, 10–30%. Copilot's acceptance is ~27%, so this is in range, but the win is narrower than code: finishing words and names, answering the agent's yes/no questions, and common follow-ups ("then ship it").
> 4. **Cost is noise.** About 2,000 tokens in and 20 out per suggestion, mostly cache reads: ~$0.09 on a heavy day (1,500 suggestions), ~$3 a month. Uncached, worst case ~$10 a month.
> 5. **Recommendation:** ship it behind the switch, on your key, and look at `amarchy suggest` after a week. Keep it only if the take rate holds above ~20%.

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
- **When:** 150 ms after you pause (400 ms on the login path), only with the cursor at the end, never on a `/` command, while dictating or with an IME composing (fcitx5's Tab during composition is left alone). With an empty box, once Claude's reply is in and not one you already answered: what you'd answer.
- **Tab, Tab, Tab:** while one shows, the next one (after it) is fetched; Tab shows it at once. A slow answer you typed past as it said still shows what's left of it.
- **Context (all on your server and your Anthropic account):** your last ~30 messages across chats (how you write; read every 10 minutes; forwarded mails and timers' messages left out), this chat's last 5 messages of yours and Claude's last reply (3,500 characters), the project and title, and the draft. Two cache breakpoints (style, chat) keep everything but the draft cached while you type.
- **Joining words reliably:** the word you're typing is taken off the draft and named ("the next word starts with `co`"); the reply must start with that word, else it's dropped. Haiku asked to continue from inside a word loses its letters ("co" → "lombia"); this way it can't misjoin.
- **Output contract:** `<continuation>…</continuation>`, stopped at `</continuation>` or a newline; anything outside the tags (a note about the task) is dropped, and an empty one means "not sure": nothing shows.
- **Logged** in `~/.local/state/amarchy/suggest.jsonl`: how long, tokens, and what became of each (taken with Tab, a word at a time, typed as it said, gone). `amarchy suggest` sums it up; `amarchy suggest try "<text>" --id <chat>` asks for one from the CLI.

## Measurements

Model: `claude-haiku-5-5`. Context ~2,000 tokens (577 of system prompt).

| Path | Typical | Worst seen | Notes |
| --- | --- | --- | --- |
| `claude -p`, your login | 1.3–1.6 s | 4.3 s | ~0.65 s of CLI start-up; `MAX_THINKING_TOKENS=0` doesn't stop Haiku 5.5 thinking (150–200 tokens) on some |
| Model time inside it (`duration_api_ms`) | 0.61–0.74 s | 3.5 s (thinking) | the floor for the API path, thinking off |
| API, your key, thinking off | not yet measured | | needs `SUGGEST_ANTHROPIC_KEY` |

Replay of your real messages (48 cuts, 4 chats, the chat as it was then):

| Cut | Shown | First word right | 2+ words exactly right |
| --- | --- | --- | --- |
| Mid-word | 12 of 12 | 9 | 2 |
| A third in | 10 of 12 | 3 | 3 |
| Two thirds in | 8 of 12 | 3 | 1 |
| Empty box | 5 of 12 | 2 | 1 |

Exact match understates it: "colombianos al día" for your "colombianos por día" is a suggestion you'd likely take.

## Cost (Haiku 5.5: $0.10 / $0.50 per million in / out, cache reads $0.01)

- Per suggestion, cached: ~1,950 cache-read + ~50 new + ~20 out ≈ $0.000035. A cache write when the chat changes (a new reply): ~$0.0002.
- Heavy day: 1,500 suggestions (prefetch included) and 200 cache writes ≈ **$0.09**; ~$3 a month. Nothing cached: ~$0.32 a day.
- On your login: no money, but it counts against your plan's usage.

## Open questions

- **Speed:** a local model on the server (this Xeon has AMX; llama.cpp with a 1–2B model and prefix caching) could answer in 100–300 ms, at lower quality. Worth a test if Haiku's ~0.7 s feels slow.
- **Restraint:** no confidence score comes back from the API. Shorter suggestions (fewer words) and dropping ones after 20 ignored in a row (as Claude Code does) are the levers.
- **Phone:** a tap on gray text works, but the phone's own keyboard suggests words too; it may be noise there.
