// ---- amarchy's components: what every screen is built from
//
// The phone and the computer are one app: the same home (Chats | Tasks),
// the same cards, the same words and actions, only the layout adapting to
// the width. So whatever draws something here draws it with these, never
// markup or styles of its own for the same thing; a component that doesn't
// fit is extended here, and every screen gets the change.
//
// - uiCard: one card for everything (a chat, a task, what a search found):
//   a head (who or what project, its name, a pill), a body, its actions.
//   The whole card opens it.
// - uiPill: where something stands ("Done", "Asks you", "Running · …").
// - uiButton: an action on a card or a section.
// - uiSection: a small head with a count (an action at its end), its cards;
//   folded or not.
// - uiTabs: one of a few (Chats | Tasks), each with what's your move.
// - uiSearch: the search box.
// - uiTool: a tool's icon button in a bar.
// - uiScore: your score in a word or two (the streak's flame, today's
//   missions); a tap opens the rest.
// - uiTiles: a few big numbers, each with its word under it.
// - uiBars: a few days' counts, as bars, the last one lit.
// - uiChatHead: over an open chat: Back, its project and name (a tap:
//   rename), its pill, what it's for; its tools, Complete, its menu.
//
// Their look is app/ui.css, styled only through its tokens (--card-*,
// --pill-*, --button-*, --tab-*...), which a theme can set: borders, corners
// and colors change everywhere at once. docs/components.md has the list.

"use strict";

const uiState = {
  open: new Map(),      // a section you opened or closed: its key -> open (kept across redraws)
};

// A card. head: what opens it (a chat) or opens its text (a task). kind: what
// it is (k-<kind>, for its look); hue: its project's color (ph-<hue>); lead:
// before the chip (an avatar); id: the chat it is, if one (its priority mark,
// data-id for the keys).
function uiCard({ kind, hue, lead = null, chip = "", title, pill = null, body = [], actions = [], open, id, label }) {
  // A chat's priority, when it isn't normal: its mark by its project (Ctrl+Alt+↑ / ↓ sets it).
  const s = id && typeof rowOf === "function" ? rowOf(id) : null;
  const prio = s && s.priority && s.priority !== "normal" ? glyph(s.priority, `prio ${s.priority}`) : null;
  if (prio) prio.title = `${PRIORITY[s.priority]} priority`;
  const head = h("button", { class: "tcard-head today-go", type: "button", onclick: open, "aria-label": label || null },
    lead, prio, chip ? h("span", { class: "tcard-chip" }, chip) : null,
    h("span", { class: "tcard-title" }, typeof title === "string" ? taskText(title) : title), pill);
  // The whole card opens it (its buttons, links and boxes do their own thing).
  const card = h("article", { class: `tcard k-${kind} ph-${hue}`, "data-id": id || null,
                              onclick: (e) => { if (!e.target.closest("button, a, input, textarea, select, summary")) open(e); } }, head,
    ...body.filter(Boolean), actions.filter(Boolean).length ? h("div", { class: "tcard-actions" }, ...actions.filter(Boolean)) : null);
  // A chat's: held down on a phone, a right click on a computer (the menu key
  // with the keys): its menu, priority, name, commands, Complete (app.js rowMenu).
  if (s && typeof holdable === "function") holdable(head, () => rowMenu(s));
  return card;
}

// A pill: its words in its tone's color (ask, late, done, working, running,
// accent, warn, quiet). working and running spin. long: words that may not fit, cut
// short with "…" (all of them on hover).
function uiPill(text, tone, { long = false, title = null } = {}) {
  const wheel = tone === "working" || tone === "running" ? h("span", { class: "spinner" }, SPINNER[spin.frame]) : null;
  return h("span", { class: `tpill t-${tone}${long ? " long" : ""}`, title: title || (long ? text : null) },
    wheel, long ? h("span", { class: "tpill-text" }, text) : text);
}

// A button: primary (filled, the one thing to do), or a class of its own
// (quiet: words only; complete: Complete mission's).
function uiButton(label, act, primary = false, cls = "") {
  return h("button", { class: `tbtn${primary ? " primary" : ""}${cls ? ` ${cls}` : ""}`, type: "button", onclick: act }, label);
}

// A section: its head (a count, folded or not, and an action), its cards.
// fold: null never folds; true / false folds, open / closed at first (then
// as you left it). Nothing in it: nothing drawn.
function uiSection(kind, title, { count = null, fold = null, extra = null } = {}, ...kids) {
  kids = kids.flat().filter(Boolean);
  if (!kids.length) return null;
  const head = h("h2", { class: "tsec-head" }, h("span", { class: "tsec-title" }, title),
    count !== null ? h("span", { class: "tsec-count" }, String(count)) : null, h("span", { class: "tsec-gap" }), extra);
  if (fold === null) return h("section", { class: `tsec today-${kind}` }, head, h("div", { class: "tsec-cards" }, ...kids));
  const isOpen = uiState.open.has(kind) ? uiState.open.get(kind) : fold;
  const d = h("details", { class: `tsec today-${kind}`, ...(isOpen ? { open: true } : {}) },
    h("summary", { "aria-label": `${title}, ${count}` }, head), h("div", { class: "tsec-cards" }, ...kids));
  d.addEventListener("toggle", () => uiState.open.set(kind, d.open));
  return d;
}

// Tabs: one of a few. items: [{key, label, count, title}]; on: the key
// that's on; pick(key). Each says its count (what's your move there) in a
// badge. Into el if given (drawn again, the keys kept), else a new one.
function uiTabs(items, on, pick, el = null, label = "") {
  const box = el || h("div", { class: "seg ui-tabs", role: "tablist", "aria-label": label || null });
  const kids = items.map((t) => h("button", { class: `control${t.key === on ? " on" : ""}`, type: "button", role: "tab", "data-tab": t.key,
                                              title: t.title || null, "aria-selected": String(t.key === on), onclick: () => pick(t.key) },
    t.label, t.count ? h("span", { class: "tab-count" }, String(t.count)) : ""));
  if (typeof keepFocus === "function") keepFocus(box, () => box.replaceChildren(...kids));
  else box.replaceChildren(...kids);
  return box;
}

// The search box: its icon, the field, and the key that gets there (a
// computer's; not drawn on the phone). The field's own attributes in input.
function uiSearch({ placeholder = "Search", label = "Search", key = "/", cls = "", input = {} } = {}) {
  const field = h("input", { type: "search", placeholder, "aria-label": label, autocomplete: "off", autocorrect: "off",
                             autocapitalize: "off", spellcheck: "false", enterkeyhint: "search", ...input });
  const box = h("label", { class: `searchbox ui-search${cls ? ` ${cls}` : ""}` }, glyph("search"), field,
    key ? h("kbd", { class: "ui-search-key" }, key) : null);
  box.field = field;
  return box;
}

// A tool in a bar: its icon, its name for a screen reader and on hover.
function uiTool(icon, label, act, { title = "", cls = "", extra = {} } = {}) {
  return h("button", { class: `control ui-tool${cls ? ` ${cls}` : ""}`, type: "button", title: title || label, "aria-label": label,
                       onclick: act, ...extra }, glyph(icon));
}

// Your score: the streak (its flame lit, or dim while today has none yet and
// it's at risk), and today's missions. act: what a tap opens.
function uiScore({ streak = 0, today = 0, risk = false, title = "", act }) {
  return h("button", { class: `ui-score${risk ? " risk" : ""}${streak ? "" : " cold"}`, type: "button", title, "aria-label": title, onclick: act },
    h("span", { class: "ui-score-streak" }, glyph("flame"), String(streak)),
    h("span", { class: "ui-score-today" }, h("b", {}, String(today)), " today"));
}

// Big numbers: [{n, label, on}], each its word under it (on: lit, a record).
function uiTiles(items) {
  return h("div", { class: "ui-tiles" }, ...items.map((t) =>
    h("div", { class: `ui-tile${t.on ? " on" : ""}` }, h("b", {}, String(t.n)), h("span", {}, t.label))));
}

// Bars: [{n, label}], scaled to the biggest; the last is lit (today).
function uiBars(items) {
  const top = Math.max(1, ...items.map((b) => b.n));
  return h("div", { class: "ui-bars", role: "img", "aria-label": items.map((b) => `${b.label} ${b.n}`).join(", ") },
    ...items.map((b, i) => h("div", { class: `ui-bar${i === items.length - 1 ? " on" : ""}` },
      h("span", { class: "ui-bar-n" }, b.n ? String(b.n) : ""),
      h("span", { class: "ui-bar-fill", style: `height:${Math.round((b.n / top) * 100)}%` }),
      h("span", { class: "ui-bar-label" }, b.label))));
}

// Over an open chat, on the phone as on a computer: Back; its project (or
// your assistant's picture), its name and where it stands, what it's for
// under them (a tap: rename); then tools (a computer's side panel tabs),
// Complete (not your assistant's), and ⋯ its menu. Returns the children,
// for the head to hold.
function uiChatHead(s, { goal = "", back, rename, tools = [], complete, more, backTitle = "Back" } = {}) {
  const main = s.assistant === "main";
  return [
    h("button", { class: "head-btn board-back", type: "button", title: backTitle, "aria-label": "Back", onclick: back },
      glyph("back"), h("span", { class: "label" }, "Back")),
    h("button", { class: `head-title${goal ? " has-goal" : ""}`, type: "button", title: `${where(s)} · rename`, onclick: rename },
      h("span", { class: "head-col" },
        h("span", { class: "head-row" },
          main ? avatar(s, "small") : h("span", { class: `tcard-chip ph-${todayHue(s.repo)}` }, todayChip(s)),
          taskText(main ? s.assistant_name || "Assistant" : s.task || "New chat", s.task || main ? "" : "untitled"),
          todayStatePill(s), sleepMark(s)),
        goal ? h("span", { class: "head-goal", title: goal }, goal) : null)),
    h("div", { class: "head-btns" }, ...tools,
      main || !complete ? null : h("button", { class: "head-btn complete", type: "button", title: "Complete mission: it reached its goal, close it (Ctrl+Alt+X)",
                                               "aria-label": "Complete mission", onclick: complete }, glyph("check"), h("span", { class: "label" }, "Complete")),
      h("button", { class: "head-btn more", type: "button", title: "This chat (Ctrl+Alt+M)", "aria-label": "This chat", onclick: more }, glyph("more"))),
  ];
}
