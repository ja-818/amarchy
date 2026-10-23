# Design tokens

Everything the app draws (app/app.css, app/desk.css, and the colors the
scripts read) styles against these CSS custom properties, never a color,
corner or font of its own. A theme is a set of values for them: today every
theme is a terminal palette mapped onto them; an app theme (see
[plan-chat-app.md](plan-chat-app.md), section 3) will set them directly.

They come in two tiers, both on `:root`:

- **Base tokens**: what a theme gives. app.css holds Tokyo Night's as the
  default; `/theme.css` puts the worn theme's over them. For one of amarchy's
  themes (themes/, Omarchy's palettes) `app_look_vars` in bin/amarchy maps the
  palette onto them, with the Omarchy shell's choices for menus, popups and
  controls. A theme of your own (app/custom/&lt;key&gt;/theme.json, as `amarchy
  migrate` keeps a desktop's look) stores them as they are; one saved with the
  names from before these tokens is read through `look_tokens`.
- **Role tokens**: what one part of the app wears (a bubble, code, a popup's
  corners). app.css makes each from base tokens, so a palette needs only the
  base ones, and an app theme may set any role token too (theme.css comes
  after app.css, so its value wins).

Set tokens on `:root` only: a role token takes its base token's value there,
so overriding a base token on an inner element doesn't reach the roles made
from it.

## Base tokens

| Token | What it is | From a terminal palette |
| --- | --- | --- |
| `--surface` | The theme's background: under the wallpaper, menus, sheets, popups | `background` (the shell's `menu.background`) |
| `--surface-sunken` | A darker shade of it | `dark_background` |
| `--surface-raised` | A lighter shade of it | `lighter_background` |
| `--scrim` | The shade behind a sheet or menu card | `background` at 50% |
| `--text` | Text | `foreground` (`menu.text`) |
| `--text-muted` | Secondary text: meta lines, hints, placeholders | `foreground` dimmed as Qt's `darker(140)` |
| `--text-selection` | Behind text you select | `selection` |
| `--accent` | The theme's accent: titles, what's in use, focus | `accent` |
| `--border-faint` | Hairlines: under a bar, around code | `foreground` at 12% |
| `--border` | Rules: between groups, in tables | `foreground` at 20% |
| `--border-menu` | A menu's border | `menu.border` (the active border's foreground) |
| `--border-popup` | A popup's border: a color or a gradient | Hyprland's `active-border` |
| `--border-popup-solid` | The same as one color (where a gradient can't go) | its first color |
| `--selected-bg` / `--selected-text` / `--selected-border` | What's under the cursor: a row, a menu's item, a question's option | `menu.selected-*` (foreground at 8%, accent, foreground at 25%) |
| `--control-bg` / `--control-border` | A button or field at rest | `foreground` at 4% / 40% |
| `--control-hover` / `--control-selected` / `--control-pressed` | Hovered, on, pressed | `foreground` at 8% / 18% / 22% |
| `--radius` | Corners | the theme's `rounding` (0: square) |
| `--red` `--yellow` `--green` `--blue` `--magenta` `--cyan` `--orange` | The theme's hues, for what needs a color by name | the same names |
| `--font` | The font picked in the app | Settings, Look (not the theme) |

`color-scheme` (light or dark) comes with them, from the palette's `mode` or
its background's lightness.

## Role tokens

| Token | Made from | Used for |
| --- | --- | --- |
| `--surface-glass` | `--surface` at 88% | The app over your wallpaper, edge to edge |
| `--on-accent` | `--surface` | Text on an accent fill (the on segment, the mic while it listens, "New") |
| `--link` | `--accent` | Links, actions in words (`[ browse ]`) |
| `--focus-ring` | `--accent` | The keyboard's focus outline |
| `--danger` `--warning` `--success` `--info` | red, yellow, green, blue | Errors, closing, a tool that failed or worked |
| `--bubble-user-bg` / `--bubble-user-text` / `--bubble-user-edge` / `--bubble-user-mark` | `--selected-bg`, `--text`, `--accent`, `--text-muted` | What you said: its band, text, left edge and `>` |
| `--claude-mark` | `--text` | Claude's `●` |
| `--code-text` | `--accent` | `inline code` |
| `--code-bg` / `--code-border` | `--control-bg`, `--border-faint` | A code block |
| `--diff-add` / `--diff-del` | green, red | Added and removed lines (for B2) |
| `--diff-add-bg` / `--diff-del-bg` | green, red at 15% | Their background, as Claude Code's |
| `--radius-control` | `--radius` | Buttons, fields, the search |
| `--radius-card` | `--radius` | Popups (sheets, menus, toasts, the picker) and tiles (the bar you type in, Claude's question) |
| `--radius-item` | `--radius` | Rows, menu items, options, code blocks, theme cards |
| `--radius-bubble` | `--radius` | What you said |
| `--shadow-popup` / `--shadow-card` | `none` | A popup's shadow, a tile's |
| `--popup-border-width` | `2px` | A popup's border |
| `--tile-border` / `--tile-width` | `--control-border`, `2px` | A tile's border |
| `--font-ui` | `--font` | The app's text |
| `--font-code` | `--font` | Code and the terminals |

## Not colors: the type scale and layout

`--caption` `--body` `--title` `--display` `--icon-large` (font sizes; the
wide layout sets its own in `.desk-root`), `--gap`, and the safe areas `--top`
`--bottom`. The scripts set `--vvh`, `--vv-top`, `--screen-size`, `--column`,
`--header`, and the theme cards' `--card-bg` `--card-fg` `--dot` `--thumb`.

## The terminals

The real terminals (xterm.js, desk.js) wear their own group, from the
palette's terminal colors: `--term-foreground`, `--term-background`,
`--term-cursor`, `--term-selection-foreground`,
`--term-selection-background`, `--term-0` … `--term-15`, with `--term-alpha`
(their opacity over the wallpaper), `--term-size` and `--term-pad`. Without
them a terminal falls back on `--text`, `--surface` and `--text-selection`.

## Adding a token

1. Base or role? If a palette can't say it, it's a role made from base tokens.
2. Base: give app.css Tokyo Night's value and `app_look_vars` its mapping
   (every theme then has it), and add it here.
3. Role: define it in app.css's role block from base tokens, so it looks the
   same as before until a theme sets it, and add it here.
4. Use it in the component. A component never uses a hue or a base token
   for a role that has its own token (a link is `--link`, not `--accent`).

`app_look_vars` for every theme in themes/ gives exactly the base tokens in
app.css, and Tokyo Night's values are app.css's defaults: keep it so.
