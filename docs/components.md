# Components

amarchy is one app on the phone and on a computer: the same home (the board's
**Chats | Tasks**), the same cards, words and actions; only the layout adapts
to the width. Everything is drawn from the components in `app/ui.js`, styled
by `app/ui.css`. A screen never writes its own markup or CSS for something a
component draws: it uses the component, or extends it so every screen gets
the change.

| Component | What it draws | Used by |
| --- | --- | --- |
| `uiCard({kind, hue, lead, chip, title, sub, pill, count, body, actions, open, id, unseen})` | One card for everything: a chat, a task, what a search found. Its head (project or who, name, pill), its body, its actions. The whole card opens it; a chat's card held down (a right click, the menu key) opens its menu. `unseen`: a chat that answered and you haven't opened since (by default its chat's own, whether it asks you something or not), lit (its ground washed in `--unseen`, a bar down its edge, a glow that breathes, its name bold). `sub` and `count`: a conversation's row, as a messaging app lists it (a line under its name, its pill over a `uiUnread` count at its end). | today.js (every card; `todayAgent`, your assistant's and your agents' rows), tasks.js (search results) |
| `uiUnread(n)` | How many messages you haven't read: a round count, filled (`--unread-*`), 99+ past 99; nothing for none. | a conversation's row |
| `uiChatTime(sec)` | When a message came, as a messaging app's list says it: its time today, Yesterday, its weekday this week, else its date. | a conversation's row |
| `uiPresence(s)` | What your assistant or an agent is up to, as you'd say it of someone: typing…, asks you something; else nothing (`{text, tone}`). | its row, its chat's bar |
| `avatar(s, cls)`, `isAgent(s)` | Your assistant's or an agent's picture, round: yours by its hash (`/picture/<hash>-192.png`, the 512 one for `big`), else amarchy's own for your assistant and an agent's initial on its project's color (`--ph`); `cls` `small`, `head` (an open chat's bar), `row` (a conversation's row), `big`. `isAgent(s)`: your assistant or an agent, a chat that lives on (no Complete, no Stalled, no priority: on top). | cards' `lead`, an open chat's bar, the agent sheet, Settings → Agents |
| `uiPill(text, tone, {long, title})` | Where something stands: `ask`, `late`, `done`, `working`, `running` (these two spin), `accent`, `warn`, `quiet`, `new` (filled in `--unseen`, a dot beating in it: what you haven't seen). `long` cuts its words short with … where they don't fit. | every card's state |
| `uiMergedWords(merged)` | A chat's merge in words: "Merged ✓ 3:42 PM", "Merged ✓ ×3 · Fri 6:05 PM". | a merged chat's pill, its chat's strip |
| `uiButton(label, act, primary, cls)` | An action on a card or a section (`quiet`: words only; `complete`: Complete mission, its ✓, outlined like the rest). | cards, sections |
| `uiSection(kind, title, {count, fold, extra}, ...cards)` | A small head with a count and an action at its end, its cards; folded (kept as you left it) or not. Nothing in it: nothing drawn. | Today's parts, the board's groups, search |
| `uiFolds(...folds)`, `uiFold(title, {open, toggle}, ...kids)` | What's long, folded under heads that each say their point, one box: a tap opens one (`toggle(open)` told; `fold.set(open)` opens or folds it). | A reply's sections |
| `uiBrief(rows, {lead})` | What something comes to (`lead`), then a few rows, label by label (`{label, value, tone}`): tone `you` lit, `none` quiet. | A reply's Briefing |
| `uiActions(items)` | What's yours to do, a line each (`{text, due, done}`), marked in the accent. | In a Briefing, an older reply's list of things to do |
| `uiTabs(items, on, pick, el, label, {scroll})` | One of a few, each with its count (what's your move there). `scroll`: one of many, in a row that scrolls sideways, the one that's on kept in view. | the board's Chats \| Tasks, a new chat's projects |
| `uiSearch({placeholder, label, key, cls, input})` | The search box, the key that gets to it on a computer. | the board's search |
| `uiComposer({field, before, after, top, cls})`, `uiComposerButton(kind, label, content, act, extra)` | The box you write in and send from, as a messaging app's: the field (a textarea with its own keys) between the buttons before it (+) and after it (the mic, Send), and over them what goes with it (`top`: the pictures and files). Its buttons are round, a finger's size (`kind`: `attach`, `mic`, `send`, `stop`). | a chat's box (chat.js), a terminal's message line (terminal.js) |
| `uiTool(icon, label, act, {title, cls, extra})` | A tool's icon in a bar's slot: no box until you point at it. | an open chat's Terminal, Changes, Details |
| `uiPreview(s, {head})` | A chat's live preview (`amarchy preview`): opens it, starts it, or asks its Claude to start it again when nothing answers. With several: **Previews ▾**, a `uiDropdown` of them by name, each doing what its own button would. | Over a chat, on its card |
| `uiAction(icon, label, act, {title, key, cls})` | A bar's one thing to do, outlined (its key beside its words; an icon alone on a phone). | New chat, Complete |
| `uiBrand(act)` | The Ⓐ: the Amarchy menu, as Omarchy's mark opens its own; its dot, an automation that failed. | the board's bar |
| `uiMenu(title, items)` | A menu: a keyboard's card on a computer (type to find, ↑ ↓ ↵), a sheet on the phone; items `{label, detail, icon, key, act, group, desk}`. | the Amarchy menu |
| `uiDropdown(anchor, items, {label, key})` | A few things to pick, under the button that opened it (over it with no room under), the same on the phone and the computer; items (or a function, drawn again by `uiDropdownRedraw()`) `{label, detail, icon, lead, bad, disabled, act}`. A tap outside or Esc closes it and presses nothing else; ↑ ↓ ↵ from the keys. Its look: the `--dropdown-*` tokens. | Previews ▾ |
| `uiShot({src, label, alt, cls, shots, lazy})` | A picture's thumbnail, its label on it ("Image 1", as the words name it: `[Image #1]`); a tap opens it full screen with the others of its group (`shots()`). `uiShotLabel(b, label)` labels it again. | a message's pictures, the box's tray, a new chat's |
| `uiPhoto(shots, at)` | Pictures full screen on black (`[{src, label}]`): its label at the top, ✕ at the top right; ‹ ›, ← → or a swipe between several; ✕, Esc, a tap beside it or a swipe down closes it. | a tap on any thumbnail |
| `.ui-bar` | One bar, as Omarchy's: where you are on the left, what you look at in the middle, icons in slots of one size and one outlined action on the right. | the board's bar, an open chat's (both layouts) |
| `uiChatHead(s, {back, rename, complete, more})` | Over an open chat: Back, its project and name (a tap renames it), where it stands, its menu, its preview, Complete. Your assistant's or an agent's: its picture and name with `uiPresence` under it (typing…), as a messaging app's head; no state box, no Complete. | an open chat (both layouts) |
| `uiScore({streak, today, goal, risk, cool, flash, title, act})` | Your score in a button (square, as every control): the streak's flame (dim and pulsing while it's at risk, cooled while chats are stalled), today's merges with a ring to your goal; `flash`, a moment's pill by it (a fast reply, a merge). A tap opens the rest. | the board's summary line |
| `uiProgress({label, value, max, note})` | Progress to something: its name, a bar, a note. | Your missions' rank |
| `uiStepper({label, value, min, max, show, set})` | A number to pick with − and +. | Your missions' daily goal |
| `uiBadges([{name, about, on, when}])` | Badges: the earned lit, the rest dim with how to earn them. | Your missions |
| `uiTiles([{n, label, on}])` | A few big numbers in one row, each its word under it (`on`: lit, a record). | Your missions |
| `uiChart([{n, label}])` | A few days' counts as bars, the last (today) lit. | Your missions |
| `uiSlides(slides, {key, label, start, done, shown, closed})` | Slides one at a time over everything (`[{kicker, title, art, body, features, extra, actions, burst}]`, each drawn as it comes; `features`: `[{art, title, text}]`, a few to a slide, a row each: its small picture, what it is in a line, what it does under it): a bar of segments on top (where you are; a tap goes there) and the ✕, Back · n of all · Next at the bottom (the last one's says `done`). → ← (Space, PageUp/Down), a swipe sideways or the buttons go along; Esc, ✕, the shade or a swipe down close it. A line's words take `**bold**` and `` `code` ``; `burst`: confetti as it comes; a uiScrollRow, or `.ui-slides-own-keys` on a part, takes its own arrows and swipes. | the tour (tour.js) |
| `uiPixels(rows, {scale, cls, label})`, `uiPixmap(w, h)` | Pixel art in the theme's own colors: rows of letters, one a pixel (`a` accent, `t` text, `m` muted, `k`/`s` the sunken and raised surfaces, `x` a rule, `r o y g c b p` the hues; a capital blinks), as crisp SVG squares; `cls` `bob` (`d1`–`d3` later), `flicker`. `uiPixmap` draws one with `line`, `box`, `frame`, `put`. | the tour's pictures |
| `uiScrollRow(row, {label})` | A row wider than its room, in a box with ‹ › beside it, outside the row and square as every control (each a page along, there only while there's more that way, its place kept so the row never moves; in a slide on a computer they sit in its margins); a mouse's wheel scrolls it sideways too, and the keys go along it as in any row of buttons. | the tour's themes |
| `uiBurst({bits, far})` | Confetti in the theme's hues, from the middle of its box (none with less motion asked for). | Mission complete, the tour's last slide |
| `uiFitField(field, {max, extra})` | A box you write in (a textarea) as tall as its words, up to `max` px: measured with what holds it kept at its height, so nothing around it moves meanwhile (else the conversation over a chat's box jumped up on each key of a long message in Safari). | a chat's box, a new chat's box |
| `uiSwap(box, nodes)`, `uiPatch(box, nodes)` | Drawing a box again without disturbing what's under a finger: `uiSwap` keeps all of it when nothing would change; `uiPatch` changes only the parts that differ, a part that differs only in which is on (its classes, `aria-pressed`) in place, so a tap already on it isn't lost to a redraw. | the queue over a chat's box, the Look sheet |

## Snappy

What you do is on screen the moment you do it, never after the server
answers: a message sent is in the conversation (or the queue) at once, a
card answered leaves the dock, a priority or a name is on its card
(`aheadOf` in app.js keeps it there over lists that don't say it yet), a new
chat's card says Starting…; refused, it goes back as it was and says why.
A card or button is lit the moment it's pressed (`--card-press-bg`,
`--button-press-bg`). A chat's stream is asked for as the finger lands on
its card, and a chat opened before is drawn from what was kept. The server
reads the list at once after anything a page does. `test/snappy.js` checks
all of it, in both layouts.

## Theming

Components style themselves only through the tokens at the top of
`app/ui.css`, made from the base tokens ([design-tokens.md](design-tokens.md)).
A theme can set any of them in its `vars`, and every screen changes at once:

| Token | What |
| --- | --- |
| `--card-bg`, `--card-border`, `--card-border-width`, `--card-radius` | A card's surface, its rule, its corners |
| `--card-hover-bg`, `--card-hover-border`, `--card-focus-bg`, `--card-focus-border`, `--card-press-bg` | A card under the pointer, under the keys, pressed |
| `--card-pad-x`, `--card-gap` | Inside a card, between cards |
| `--unseen`, `--unseen-wash` | A chat that answered and you haven't opened (an unseen card, the New pill): its color (the accent) and how much of it the card's ground has |
| `--pill-radius`, `--pill-border-width`, `--pill-border-mix` | A pill's corners and rule (square as the buttons: `--button-radius`) (how much of its tone the rule has) |
| `--button-bg`, `--button-border`, `--button-hover-bg`, `--button-press-bg`, `--button-radius`, `--button-primary-bg`, `--button-primary-text` | A button at rest, hovered, pressed, the primary one |
| `--section-head`, `--section-head-yours` | A section's head, and Needs you's |
| `--fold-border`, `--fold-rule`, `--fold-radius`, `--fold-head`, `--fold-mark`, `--fold-hover-bg`, `--fold-press-bg` | Folds: the box, the line between two, a head, its mark, under the pointer or a finger |
| `--brief-bg`, `--brief-border`, `--brief-radius`, `--brief-head`, `--brief-label`, `--brief-you` | A briefing: its card, its head, a row's label, your move's |
| `--act-mark` | What's yours to do: a line's mark |
| `--tab-bg`, `--tab-border`, `--tab-on-bg`, `--tab-count-bg` | Tabs, the one that's on, a count |
| `--search-bg`, `--search-border` | The search box |
| `--composer-bg`, `--composer-border`, `--composer-border-width`, `--composer-radius`, `--composer-shadow`, `--composer-focus`, `--composer-send-bg`, `--composer-send-text` | The box you write in (a chat's, a terminal's message line): its ground, rule, corners, shadow, its rule while you write in it, and Send |
| `--score-flame`, `--score-cool`, `--score-ring`, `--score-flash`, `--score-bg`, `--score-border`, `--score-radius` | Your score's flame (and cooled), its goal ring, a fast reply's flash, its button |
| `--badge-on` | An earned badge, and a badge's moment |
| `--tile-bg`, `--tile-border`, `--tile-on`, `--chart-bg`, `--chart-on` | Big numbers and bars, and the lit one |
| `--chart-1` … `--chart-8`, `--chart-single`, `--chart-grid`, `--chart-axis` | A chart block's series, in that order (validated together for color-blind readers; a light theme gets their light steps), one series' color, its gridlines and its zero line |
| `--dropdown-bg`, `--dropdown-border`, `--dropdown-border-width`, `--dropdown-radius`, `--dropdown-shadow`, `--dropdown-row-hover`, `--dropdown-row-on` | A dropdown (uiDropdown): its ground, its rule (a popup's, as the menu card's), its corners, its shadow, a row under the pointer and one the keys are on |
| `--chat-them-bg`, `--chat-them-text`, `--chat-them-border`, `--chat-you-bg`, `--chat-you-text`, `--chat-you-border`, `--chat-bubble-radius`, `--chat-stamp`, `--chat-read`, `--chat-day-bg` | Your assistant's and your agents' chats, a messaging app's (chat.css `.chat.bubbles`): its bubbles and yours, their corners (square as the app's: `--radius-bubble`), a message's time, your ticks once it has it, the day between them (and the quiet lines in the middle) |
| `--unread-bg`, `--unread-text` | How many you haven't read (uiUnread), and a row's time while there are some |
| `--xpost-bg`, `--xpost-text`, `--xpost-muted`, `--xpost-border`, `--xpost-link`, `--xpost-fill`, `--xpost-over`, `--xpost-radius`, `--xpost-font` | A post for X (the xpost block): X's own look, not the theme's (its dark one; a light theme gets X's light one): its ground, text, grey, lines, blue, what's behind a picture while it comes, what goes past 280, its corners and its font |
| `--control-h`, `--control-h-small` | One height for every control: a card's buttons, tabs, the search, tools, New chat, the buttons over a chat and in its side panel, the composer's menus (44px on a touch screen); words-only links in a section's head |
| `--page-width`, `--page-pad` | One column for every page: the board's bar and cards, an open chat's head, what was said and the box you type in, centered and lined up (`--chat-column` follows it) |

## Keeping the phone and the computer together

`test/today-view.js` runs the board in both layouts and compares them: the
bar's parts, the tabs and their counts, and on each tab every section, card,
pill and button must be the same. Run it before every ship, and look at its
phone and wide screenshots side by side.
