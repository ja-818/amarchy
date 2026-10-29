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
//   missions against your goal, a ring); a tap opens the rest.
// - uiProgress: progress to something (a rank's to the next).
// - uiStepper: a number to pick, with − and + (your daily goal).
// - uiBadges: badges, earned and to earn.
// - uiTiles: a few big numbers, each with its word under it.
// - uiChart: a few days' counts, as bars, the last one lit.
// - uiChatHead: over an open chat, as its card's head: Back, its project
//   and name (a tap: rename), its pill; its menu, Complete.
// - uiAction: a bar's one thing to do (New chat, Complete), outlined.
// - uiBrand: the Ⓐ that opens the Amarchy menu, as Omarchy's own mark does.
// - uiMenu: a menu of things to do: a keyboard's card on a computer (type to
//   find, ↑ ↓ ↵), a sheet on the phone; the same items.
//
// The two bars (the board's, an open chat's) are one bar (.ui-bar), as
// Omarchy's: where you are on the left (the Ⓐ and Chats | Tasks; Back),
// what you look at in the middle (the search; the chat's name), and on the
// right icons in slots of one size, no box, and one outlined action.
//
// Their look is app/ui.css, styled only through its tokens (--card-*,
// --pill-*, --button-*, --tab-*...), which a theme can set: borders, corners
// and colors change everywhere at once. docs/components.md has the list.

"use strict";

const uiState = {
  open: new Map(),      // a section you opened or closed: its key -> open (kept across redraws)
  down: 0,              // when a finger (or the mouse button) went down on the page, while it's down
  up: 0,                // when it lifted (or the page last scrolled)
  later: new Map(),     // what waits for it to lift: key -> fn
};

// ---- drawn again only when it changed, and never under your finger
//
// The list comes every second or so while chats work. Drawn again each
// time, what you're about to tap is a new button, or moved: the tap lands
// on the one next to it, or under it. So a box's children are replaced
// only when they'd look different (uiSwap), and what the list's news
// redraws waits while a finger is down and the moment its tap takes, and
// while you write in a card's box (uiWhenStill). What you do yourself is
// drawn at once.

const UI_TAP = 450;     // a finger lifted: its click (and a double tap's second) still to come
const UI_HOLD = 5000;   // a finger down longer (or a lift the page never heard of): drawn anyway

addEventListener("pointerdown", () => { uiState.down = Date.now(); }, true);
// Safari lights :active (a card, a button, pressed) only on a page that
// listens for touches: lit the moment the finger lands.
addEventListener("touchstart", () => {}, { passive: true });
for (const type of ["pointerup", "pointercancel"]) {
  addEventListener(type, () => { uiState.down = 0; uiState.up = Date.now(); uiStillSoon(); }, true);
}
// A list still gliding after the finger's gone counts too: drawn again, it
// would stop under you.
addEventListener("scroll", () => { uiState.up = Date.now(); uiStillSoon(); }, { capture: true, passive: true });
// Out of a box you were writing in: what waited for it, drawn now (once the
// keys have landed where they go).
addEventListener("focusout", () => setTimeout(uiStillSoon), true);

// Writing in a box on a card (a task's Ask Jaken…) counts too: drawn again,
// it would be a new box, the cursor at its end, the phone's keyboard closed.
function uiTyping() {
  const a = document.activeElement;
  // (A box left with the keys in it, nothing typed a while: not typing.)
  return !!a && a.matches("textarea, input") && !!a.closest(".today") && Date.now() - uiState.typed < 30000;
}
addEventListener("input", () => { uiState.typed = Date.now(); }, true);
addEventListener("focusin", () => { uiState.typed = Date.now(); }, true);

function uiTouching() {
  const now = Date.now();
  return (uiState.down && now - uiState.down < UI_HOLD) || now - uiState.up < UI_TAP || uiTyping();
}

// fn now, or once the finger's gone (the last one under key, if more come).
function uiWhenStill(key, fn) {
  if (!uiTouching()) { uiState.later.delete(key); fn(); return; }
  uiState.later.set(key, fn);
  uiStillSoon();
}

let uiStillTimer = 0;
function uiStillSoon() {
  if (!uiState.later.size || uiTyping()) return;      // (out of the box: focusout)
  const now = Date.now();
  const at = Math.max(uiState.up + UI_TAP, uiState.down ? uiState.down + UI_HOLD : 0, now) + 10;
  clearTimeout(uiStillTimer);
  uiStillTimer = setTimeout(uiStill, at - now);
}

function uiStill() {
  if (uiTouching()) return uiStillSoon();
  const fns = [...uiState.later.values()];
  uiState.later.clear();
  for (const fn of fns) fn();
}

// box's children made nodes, unless they'd look the same (then it keeps its
// own, under your finger and in focus). True when it changed.
function uiSwap(box, nodes) {
  const next = document.createElement("div");
  next.append(...nodes.filter((n) => n !== null && n !== undefined && n !== false));
  if (next.innerHTML === box.innerHTML) return false;
  const fill = () => box.replaceChildren(...next.childNodes);
  if (typeof keepFocus === "function") keepFocus(box, fill); else fill();
  return true;
}

// box's children made nodes, changing the page no more than it must: a part
// that's the same but for which is on (its classes, aria-pressed) changed
// in place, its buttons kept, so a tap already on one isn't lost to a
// redraw; a part that's different, that part again. (uiSwap: the whole box,
// when anything differs.)
function uiPatch(box, nodes) {
  nodes = nodes.filter((n) => n !== null && n !== undefined && n !== false).map((n) => (n instanceof Node ? n : document.createTextNode(String(n))));
  const was = [...box.childNodes];
  if (was.length !== nodes.length || was.some((n, i) => n.nodeName !== nodes[i].nodeName)) {
    const fill = () => box.replaceChildren(...nodes);
    if (typeof keepFocus === "function") keepFocus(box, fill); else fill();
    return;
  }
  was.forEach((old, i) => uiPatchPart(old, nodes[i]));
}

function uiShape(n) {
  return n.nodeType === 1 ? n.outerHTML.replace(/ (class|aria-pressed)="[^"]*"/g, "") : n.textContent;
}

function uiPatchPart(old, next) {
  if (uiShape(old) === uiShape(next)) {
    if (old.nodeType !== 1) return;
    const olds = [old, ...old.querySelectorAll("*")], nexts = [next, ...next.querySelectorAll("*")];
    olds.forEach((el, i) => {
      const to = nexts[i];
      if (el.className !== to.className && typeof el.className === "string") el.className = to.className;
      const p = to.getAttribute("aria-pressed");
      if (p !== el.getAttribute("aria-pressed")) { if (p === null) el.removeAttribute("aria-pressed"); else el.setAttribute("aria-pressed", p); }
    });
    return;
  }
  const had = old.nodeType === 1 && old.contains(document.activeElement) ? document.activeElement : null;
  old.replaceWith(next);
  if (!had || next.nodeType !== 1) return;
  const name = (x) => x.getAttribute("aria-label") || x.textContent;
  const to = [...next.querySelectorAll("button, input, [tabindex]")].find((x) => name(x) === name(had));
  if (to) to.focus({ preventScroll: true });
}

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
  const wheel = tone === "working" || tone === "running" ? h("span", { class: "spinner spin" }, SPINNER[spin.frame]) : null;
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
  uiSwap(box, kids);
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

// Your score: the streak (its flame lit; dim and pulsing while today has
// none yet and it's at risk; cooled while chats are stalled), and today's
// missions (a ring filling to your goal, if you have one). flash: a moment's
// pill by it (a fast reply). act: what a tap opens.
function uiScore({ streak = 0, today = 0, goal = 0, risk = false, cool = false, flash = "", title = "", act }) {
  const ring = goal ? h("span", { class: `ui-ring${today >= goal ? " full" : ""}` }) : null;
  if (ring) {
    const f = Math.min(1, today / goal), c = 2 * Math.PI * 6;
    ring.innerHTML = `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><circle class="on" cx="8" cy="8" r="6" stroke-dasharray="${(f * c).toFixed(2)} ${c.toFixed(2)}"/></svg>`;
  }
  return h("span", { class: "ui-score-box" },
    flash ? h("span", { class: "ui-score-flash" }, glyph("bolt"), flash) : null,
    h("button", { class: `ui-score${risk ? " risk" : ""}${cool ? " cool" : ""}${streak ? "" : " cold"}`, type: "button", title, "aria-label": title, onclick: act },
      h("span", { class: "ui-score-streak" }, glyph("flame"), String(streak)),
      h("span", { class: "ui-score-today" }, ring, h("span", {}, h("b", {}, String(today)), goal ? `/${goal}` : " today"))));
}

// Progress to something: its name, a bar, a note ("12 to Lieutenant").
function uiProgress({ label, value, max, note = "" }) {
  const f = max > 0 ? Math.max(0, Math.min(1, value / max)) : 1;
  return h("div", { class: "ui-progress" },
    h("div", { class: "ui-progress-head" }, h("b", {}, label), note ? h("span", {}, note) : null),
    h("div", { class: "ui-progress-track" }, h("span", { class: "ui-progress-fill", style: `width:${Math.round(f * 100)}%` })));
}

// A number to pick, with − and +: its label, what it shows (show(n)), set(n).
function uiStepper({ label, value, min = 0, max = 99, show = String, set }) {
  return h("div", { class: "ui-stepper" }, h("span", { class: "ui-stepper-label" }, label),
    h("button", { class: "tbtn", type: "button", "aria-label": `Less: ${label}`, disabled: value <= min || null, onclick: () => set(value - 1) }, "−"),
    h("b", { class: "ui-stepper-value" }, show(value)),
    h("button", { class: "tbtn", type: "button", "aria-label": `More: ${label}`, disabled: value >= max || null, onclick: () => set(value + 1) }, "+"));
}

// Badges: [{name, about, on, when}], the earned lit, the rest to earn, dim.
function uiBadges(items) {
  return h("div", { class: "ui-badges" }, ...items.map((b) =>
    h("div", { class: `ui-badge${b.on ? " on" : ""}`, title: b.about },
      glyph("medal"), h("b", {}, b.name), h("span", {}, b.on ? b.when || b.about : b.about))));
}

// Big numbers: [{n, label, on}], each its word under it (on: lit, a record), in one row.
function uiTiles(items) {
  return h("div", { class: "ui-tiles", style: `--tiles:${items.length}` }, ...items.map((t) =>
    h("div", { class: `ui-tile${t.on ? " on" : ""}` }, h("b", {}, String(t.n)), h("span", {}, t.label))));
}

// Bars: [{n, label}], scaled to the biggest; the last is lit (today).
function uiChart(items) {
  const top = Math.max(1, ...items.map((b) => b.n));
  return h("div", { class: "ui-chart", role: "img", "aria-label": items.map((b) => `${b.label} ${b.n}`).join(", ") },
    ...items.map((b, i) => h("div", { class: `ui-chart-bar${i === items.length - 1 ? " on" : ""}` },
      h("span", { class: "ui-chart-n" }, b.n ? String(b.n) : ""),
      h("span", { class: "ui-chart-fill", style: `height:${Math.round((b.n / top) * 100)}%` }),
      h("span", { class: "ui-chart-label" }, b.label))));
}

// Over an open chat, on the phone as on a computer: one row of boxes of
// one height, neutral: Back (‹); its project (or your assistant's
// picture) and its name (a tap: rename); where it stands (its tone a dot);
// ⋯ (its menu: the Terminal, Changes and Details, its name, its
// priority…); Complete, last. Returns the
// children, for the head to hold.
function uiChatHead(s, { back, rename, complete, more, backTitle = "Back" } = {}) {
  const main = s.assistant === "main";
  return [
    h("button", { class: "control ui-action board-back", type: "button", title: backTitle, "aria-label": "Back", onclick: back }, glyph("back")),
    h("button", { class: "head-title", type: "button", title: `${where(s)} · rename`, onclick: rename },
      main ? avatar(s, "small") : h("span", { class: `tcard-chip ph-${todayHue(s.repo)}` }, todayChip(s)),
      taskText(main ? s.assistant_name || "Assistant" : s.task || "New chat", s.task || main ? "" : "untitled")),
    h("div", { class: "head-btns" },
      // Where it stands: a box as the buttons are, its tone a dot in it.
      h("span", { class: "head-state", role: "status" }, todayStatePill(s), sleepMark(s)),
      h("button", { class: "control ui-action more", type: "button", title: "This chat: its terminal, changes, details… (Ctrl+Alt+M)", "aria-label": "This chat",
                    "aria-haspopup": "menu", onclick: more }, glyph("more")),
      main || !complete ? null : h("button", { class: "control ui-action complete", type: "button", title: "Complete mission: it reached its goal, close it (Ctrl+Alt+X)",
                                               "aria-label": "Complete mission", onclick: complete }, glyph("check"), h("span", { class: "label" }, "Complete"))),
  ];
}

// A bar's one thing to do, outlined (not filled): an icon, its words (an
// icon alone on a phone), the key that does it on a computer.
function uiAction(icon, label, act, { title = "", key = "", cls = "" } = {}) {
  return h("button", { class: `control ui-action${cls ? ` ${cls}` : ""}`, type: "button", title: title || label, "aria-label": label, onclick: act },
    glyph(icon), h("span", { class: "label" }, label), key ? h("kbd", { class: "ui-key" }, key) : null);
}

// The Ⓐ: the Amarchy menu (everything you can do, each with its key), as
// Omarchy's mark opens its own. Its dot: an automation that failed.
function uiBrand(act, title = "Amarchy menu (m, Ctrl+Alt+M)") {
  return h("button", { class: "control ui-action ui-brand auto-btn", type: "button", title, "aria-label": "Amarchy menu", "aria-haspopup": "menu",
                       onclick: act, oncontextmenu: (e) => { e.preventDefault(); act(); } },
    glyph("brand", "ui-brand-mark"), h("span", { class: "auto-dot", "aria-hidden": "true" }));
}

// A menu: items [{label, detail, icon, key, act, group: () => ({title,
// items}), desk: only on a computer}]. On a computer the keyboard's card
// (desk.js picker); on the phone a sheet, a group opening one of its own.
function uiMenu(title, items) {
  items = items.filter((it) => it && (app.desk || !it.desk));
  if (app.desk && typeof picker === "function") return picker({ title, items });
  const row = (it) => h("button", { class: `menu-item${it.danger ? " danger" : ""}`, type: "button", onclick: async () => {
    if (it.group) { const g = await it.group(); return uiMenu(g.title, g.items); }
    closeSheets();
    if (it.act) it.act("");
  } }, h("span", { class: "label" }, it.icon ? glyph(it.icon, "icon") : null,
         h("span", { class: "ui-menu-text" }, it.label, it.detail ? h("small", {}, it.detail) : null)),
    it.group ? h("span", { class: "val" }, "›") : null);
  return sheet(sheetHead(title), h("div", { class: "menu ui-menu" }, ...items.map(row)));
}
