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
| `uiPill(text, tone, {long, title})` | Where something stands: `ask`, `late`, `done`, `working`, `running` (these two spin), `warn`, `quiet`. `long` cuts its words short with … where they don't fit. | every card's state |
| `uiButton(label, act, primary, cls)` | An action on a card or a section (`quiet`: words only; `complete`: Complete mission). | cards, sections |
| `uiSection(kind, title, {count, fold, extra}, ...cards)` | A small head with a count and an action at its end, its cards; folded (kept as you left it) or not. Nothing in it: nothing drawn. | Today's parts, the board's groups, search |
| `uiTabs(items, on, pick, el)` | One of a few, each with its count (what's your move there). | the board's Chats \| Tasks |
| `uiSearch({placeholder, label, key, cls, input})` | The search box, the key that gets to it on a computer. | the board's search |
| `uiTool(icon, label, act, {title, cls, extra})` | A tool's icon in a bar. | the board's Automations, Settings, Keys |

## Theming

Components style themselves only through the tokens at the top of
`app/ui.css`, made from the base tokens ([design-tokens.md](design-tokens.md)).
A theme can set any of them in its `vars`, and every screen changes at once:

| Token | What |
| --- | --- |
| `--card-bg`, `--card-border`, `--card-border-width`, `--card-radius` | A card's surface, its rule, its corners |
| `--card-hover-bg`, `--card-hover-border`, `--card-focus-bg`, `--card-focus-border` | A card under the pointer, under the keys |
| `--card-pad-x`, `--card-gap` | Inside a card, between cards |
| `--pill-radius`, `--pill-border-width`, `--pill-border-mix` | A pill's corners and rule (how much of its tone the rule has) |
| `--button-bg`, `--button-border`, `--button-hover-bg`, `--button-radius`, `--button-primary-bg`, `--button-primary-text` | A button at rest, hovered, the primary one |
| `--section-head`, `--section-head-yours` | A section's head, and Needs you's |
| `--tab-bg`, `--tab-border`, `--tab-on-bg`, `--tab-count-bg` | Tabs, the one that's on, a count |
| `--search-bg`, `--search-border` | The search box |

## Keeping the phone and the computer together

`test/today-view.js` runs the board in both layouts and compares them: the
bar's parts, the tabs and their counts, and on each tab every section, card,
pill and button must be the same. Run it before every ship, and look at its
phone and wide screenshots side by side.
