# Components

amarchy is one app on the phone and on a computer: the same home (the board's
**Chats | Tasks**), the same cards, words and actions; only the layout adapts
to the width. Everything is drawn from the components in `app/ui.js`, styled
by `app/ui.css`. A screen never writes its own markup or CSS for something a
component draws: it uses the component, or extends it so every screen gets
the change.

| Component | What it draws | Used by |
| --- | --- | --- |
| `uiCard({kind, hue, lead, chip, title, pill, body, actions, open, id})` | One card for everything: a chat, a task, what a search found. Its head (project or who, name, pill), its body, its actions. The whole card opens it; a chat's card held down (a right click, the menu key) opens its menu. | today.js (every card), tasks.js (search results) |
| `uiPirate({id, hue, look, pose, mark, say, title, pill, lead, actions, open, barkeep, cheer})` | A chat as a pirate at their crew's table, in pixels (`uiPirateSprite`): the pose says where it stands (`work`, `run`, `ask`, `blocked`, `fresh`, `done`, `idle`, `sleep`, `stale`, `arrive`, `empty`), a mark over their head, what it asks in a bubble, its name and pill under it. `look` (`uiLook(id)`): the same pirate every time; their stripes, their crew's color. A card underneath (`.tcard`, the chat's id, a `.today-go` head): the board's keys work on it. | tavern.js (the Tavern) |
| `uiFlag(name, hue, {count})` | A crew's flag: the Jolly Roger in its project's color, its name on it, waving. | tavern.js |
| `uiPill(text, tone, {long, title})` | Where something stands: `ask`, `late`, `done`, `working`, `running` (these two spin), `accent`, `warn`, `quiet`. `long` cuts its words short with … where they don't fit. | every card's state |
| `uiButton(label, act, primary, cls)` | An action on a card or a section (`quiet`: words only; `complete`: Complete mission, its ✓, outlined like the rest). | cards, sections |
| `uiSection(kind, title, {count, fold, extra}, ...cards)` | A small head with a count and an action at its end, its cards; folded (kept as you left it) or not. Nothing in it: nothing drawn. | Today's parts, the board's groups, search |
| `uiTabs(items, on, pick, el)` | One of a few, each with its count (what's your move there). | the board's Chats \| Tasks \| Tavern |
| `uiSearch({placeholder, label, key, cls, input})` | The search box, the key that gets to it on a computer. | the board's search |
| `uiTool(icon, label, act, {title, cls, extra})` | A tool's icon in a bar's slot: no box until you point at it. | an open chat's Terminal, Changes, Details |
| `uiAction(icon, label, act, {title, key, cls})` | A bar's one thing to do, outlined (its key beside its words; an icon alone on a phone). | New chat, Complete |
| `uiBrand(act)` | The Ⓐ: the Amarchy menu, as Omarchy's mark opens its own; its dot, an automation that failed. | the board's bar |
| `uiMenu(title, items)` | A menu: a keyboard's card on a computer (type to find, ↑ ↓ ↵), a sheet on the phone; items `{label, detail, icon, key, act, group, desk}`. | the Amarchy menu |
| `.ui-bar` | One bar, as Omarchy's: where you are on the left, what you look at in the middle, icons in slots of one size and one outlined action on the right. | the board's bar, an open chat's (both layouts) |
| `uiScore({streak, today, goal, risk, cool, flash, title, act})` | Your score in a button (square, as every control): the streak's flame (dim and pulsing while it's at risk, cooled while chats are stalled), today's missions with a ring to your goal; `flash`, a moment's pill by it (a fast reply). A tap opens the rest. | the board's summary line |
| `uiProgress({label, value, max, note})` | Progress to something: its name, a bar, a note. | Your missions' rank |
| `uiStepper({label, value, min, max, show, set})` | A number to pick with − and +. | Your missions' daily goal |
| `uiBadges([{name, about, on, when}])` | Badges: the earned lit, the rest dim with how to earn them. | Your missions |
| `uiTiles([{n, label, on}])` | A few big numbers in one row, each its word under it (`on`: lit, a record). | Your missions |
| `uiChart([{n, label}])` | A few days' counts as bars, the last (today) lit. | Your missions |
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
| `--pill-radius`, `--pill-border-width`, `--pill-border-mix` | A pill's corners and rule (square as the buttons: `--button-radius`) (how much of its tone the rule has) |
| `--button-bg`, `--button-border`, `--button-hover-bg`, `--button-press-bg`, `--button-radius`, `--button-primary-bg`, `--button-primary-text` | A button at rest, hovered, pressed, the primary one |
| `--section-head`, `--section-head-yours` | A section's head, and Needs you's |
| `--tab-bg`, `--tab-border`, `--tab-on-bg`, `--tab-count-bg` | Tabs, the one that's on, a count |
| `--search-bg`, `--search-border` | The search box |
| `--score-flame`, `--score-cool`, `--score-ring`, `--score-flash`, `--score-bg`, `--score-border`, `--score-radius` | Your score's flame (and cooled), its goal ring, a fast reply's flash, its button |
| `--badge-on` | An earned badge, and a badge's moment |
| `--tile-bg`, `--tile-border`, `--tile-on`, `--chart-bg`, `--chart-on` | Big numbers and bars, and the lit one |
| `--control-h`, `--control-h-small` | One height for every control: a card's buttons, tabs, the search, tools, New chat, the buttons over a chat and in its side panel, the composer's menus (44px on a touch screen); words-only links in a section's head |
| `--tavern-skin-*`, `--tavern-hair-*`, `--tavern-ink`, `--tavern-bone`, `--tavern-gold` | The Tavern's pirates (the same in every theme), a patch and a hat, the Jolly Roger's skull, gold |
| `--tavern-wood`, `--tavern-wood-dark`, `--tavern-plank`, `--tavern-light`, `--tavern-sea`, `--tavern-radius`, `--tavern-seat-w`, `--tavern-scene-h` | Its tables, walls and floor, lantern and candle light, the sea in a porthole, a pirate's room at the table and how tall they're drawn |
| `--page-width`, `--page-pad` | One column for every page: the board's bar and cards, an open chat's head, what was said and the box you type in, centered and lined up (`--chat-column` follows it) |

## Keeping the phone and the computer together

`test/today-view.js` runs the board in both layouts and compares them: the
bar's parts, the tabs and their counts, and on each tab every section, card,
pill and button must be the same. Run it before every ship, and look at its
phone and wide screenshots side by side.
