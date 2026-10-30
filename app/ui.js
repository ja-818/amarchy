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
// - uiPirate: a chat as a pirate at their crew's table, drawn in noir ink,
//   posed as it stands (the Tavern).
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

// el into sight in its own list (scroller, else the nearest one it's in),
// that list only: the browser's scrollIntoView scrolls every box around it
// too, and Safari the whole page (the chat's box and its last messages went
// off the bottom). block: nearest (moved only as much as it takes), start,
// end, center.
// The button the keys are on inside a card or a message (l / h), lit
// (.ui-in, with keys at hand) whatever the browser makes of its focus:
// Safari doesn't ring one focused by the keys. el null: none, in box.
function uiInner(box, el) {
  for (const x of box.querySelectorAll(".ui-in")) if (x !== el) x.classList.remove("ui-in");
  if (el) el.classList.add("ui-in");
}

// The one lit inside box (.ui-in), if it's still there to go to.
function uiInnerOf(box, among) {
  const el = box && box.querySelector(".ui-in");
  return el && among.includes(el) ? el : null;
}

function uiReveal(el, { scroller = null, block = "nearest", smooth = false, pad = 8 } = {}) {
  let box = scroller || el.parentElement;
  while (!scroller && box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  if (!box) return;
  const r = el.getBoundingClientRect(), v = box.getBoundingClientRect();
  const top = r.top - v.top - pad, bottom = r.bottom - v.bottom + pad;
  let by = 0;
  if (block === "start") by = top;
  else if (block === "end") by = bottom;
  else if (block === "center") by = (r.top + r.bottom) / 2 - (v.top + v.bottom) / 2;
  else if (top < 0) by = top;
  else if (bottom > 0) by = Math.min(bottom, top);      // taller than the list: its top
  if (Math.abs(by) >= 1) box.scrollBy({ top: by, behavior: smooth ? "smooth" : "auto" });
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

// ---- a pirate at their crew's table (the board's Tavern, tavern.js)
//
// A chat as a pirate in the tavern, sat at their crew's long table: one of
// the crew (uiCrewArt, below), in their crew's color (hue), posed as it
// stands (pose: see the crew), a mark over their head, what they say.
// Like a card (uiCard) it's an article.tcard with the chat's id and a head
// (.today-go) that opens it: the board's keys, its lit one, x and s, work on
// a pirate as on a card.

// Who a chat is, from its id: the same pirate on every screen (one of UI_CREW).
function uiLook(id) {
  let n = 2166136261;
  for (const c of String(id || "")) n = Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0;
  return { kind: n % UI_CREW.length };
}

// ---- the crew: ten pirates, drawn as a noir comic (black shadows, faces lit
// by the candle on the table, a few warm colors). Each chat is one of them,
// always the same one (uiLook), in their crew's color (their vest and
// lapels: .pa-crew in ui.css), posed as it stands: idle (a full beer), work
// (drinking: the arm bends at the elbow, the glass to the mouth), ask (the
// empty glass raised: another round!), run (watching the hourglass), fresh
// (holding up the map), done (a full glass raised over a chest of gold),
// blocked (chin on a fist, the glass knocked over), sleep (head down on the
// arms, the candle out), stale (cobwebs, the candle burned down), arrive
// (walking in with a sea bag), empty (a free chair). 400 × 480, shown at
// --tavern-seat-w; the art's own colors, as a picture's.

function uiCrewArt(o, state = "idle") {
  const skin = { light: ["#3c2219", "#c98656", "#e6a874"], tan: ["#33190f", "#b06e3e", "#d89260"], dark: ["#1c0e09", "#7a4a2a", "#a06a40"], pale: ["#3a2a26", "#d8a682", "#f0c8a0"], ghost: ["#2a2a28", "#c8c2ae", "#ece6d2"] }[o.skin || "light"];
  const [sd, sl, sh] = skin;
  const hair = o.hair || "#0c0807", hairLit = o.hairLit || "#3a2418";
  const lapel = [".pa-crew-dark", ".pa-crew"];      // their crew's color (ui.css)
  const p = [], hb = [], hd = [];      // the scene; the hair behind them, their head: moved as one when they slump
  let L = p;
  const P = (d, f, extra = "") => L.push(f[0] === "." ? `<path d="${d}" class="${f.slice(1)}" ${extra}/>` : `<path d="${d}" fill="${f}" ${extra}/>`);
  L.push(`<defs><radialGradient id="pag${o.id}" cx="0.84" cy="0.74" r="0.75"><stop offset="0" stop-color="#f2a14a" stop-opacity=".9"/><stop offset=".25" stop-color="#8a3f1c" stop-opacity=".7"/><stop offset=".7" stop-color="#1c0f0b"/><stop offset="1" stop-color="#0b0706"/></radialGradient>
    <radialGradient id="paf${o.id}" cx=".5" cy=".6" r=".5"><stop offset="0" stop-color="#fff4c4"/><stop offset=".5" stop-color="#ffb347"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></radialGradient></defs>`);
  L.push(`<rect width="400" height="480" fill="url(#pag${o.id})"/>`);
  if (state === "empty") {
    P("M142 252 Q200 232 258 252 L264 430 L136 430 Z", "#1a100c"); P("M236 246 Q252 248 258 252 L264 430 L248 430 Z", "#4a2a16");
    L.push(`<circle cx="142" cy="250" r="7" fill="#1a100c"/><circle cx="258" cy="250" r="7" fill="#6a3a1c"/>`);
    P("M0 428 L400 428 L400 480 L0 480 Z", "#24140d"); P("M0 428 L400 428 L400 436 L0 436 Z", "#8a4a24"); P("M220 428 L400 428 L400 436 L220 436 Z", "#d68a48");
    L.push(`<path d="M60 344 L108 344 L112 430 L56 430 Z" fill="#f4e4b8" opacity=".14"/><path d="M60 344 L108 344 L112 430 L56 430 Z" fill="none" stroke="#f8e8c0" stroke-width="2.5" opacity=".6"/><path d="M110 360 Q136 364 134 390 Q132 410 110 412" fill="none" stroke="#f8e8c0" stroke-width="6" opacity=".35"/>`);
    L.push(`<rect x="318" y="372" width="22" height="58" fill="#e8d6a8"/><rect x="330" y="372" width="10" height="58" fill="#fff0c8"/><path d="M312 428 L346 428 L344 420 L314 420 Z" fill="#6a4a20"/><ellipse cx="329" cy="352" rx="18" ry="30" fill="url(#paf${o.id})" class="pa-glow"/><g class="pa-flame"><path d="M329 336 Q338 352 329 366 Q320 352 329 336 Z" fill="#fff4c4"/></g>`);
    return `<svg viewBox="0 0 400 480" xmlns="http://www.w3.org/2000/svg" class="ui-crew-art pa-st-empty">${p.join("")}</svg>`;
  }
  // Hair behind.
  L.push("%%HB%%"); L = hb;
  if (o.long) { P("M140 166 L260 166 L270 200 L288 252 L300 334 L262 326 L254 314 L146 314 L138 326 L100 334 L112 252 L130 200 Z", hair);
    P("M248 170 L262 168 L272 202 L290 256 L298 330 L284 328 L276 262 L262 214 Z", hairLit); }
  if (o.wig) { for (const [x, y] of [[124, 200], [120, 236], [118, 272], [276, 200], [280, 236], [282, 272]]) { L.push(`<ellipse cx="${x}" cy="${y}" rx="18" ry="16" fill="#d8d0c0"/><ellipse cx="${x + 5}" cy="${y - 3}" rx="10" ry="8" fill="#f2ece0"/>`); } P("M150 300 L130 340 Q170 340 180 310 Z", "#1c1410"); }
  L = p;
  // Coat, its lit edge, the lapels, the shirt.
  const wide = o.brute ? 20 : 0;
  P(`M${40 - wide} 480 L${58 - wide} 360 Q70 318 150 300 L250 300 Q330 318 ${342 + wide} 360 L${360 + wide} 480 Z`, o.coat || "#120d0c");
  P(`M250 300 Q330 318 ${342 + wide} 360 L${360 + wide} 480 L${338 + wide} 480 L${322 + wide} 372 Q312 334 246 314 Z`, o.coatLit || "#5a2a16");
  if (o.epaulettes) { P("M60 340 Q80 312 126 306 L132 326 Q90 330 70 352 Z", "#c99a3a"); P("M340 340 Q320 312 274 306 L268 326 Q310 330 330 352 Z", "#e6b84a"); }
  P("M150 300 L196 400 L168 480 L120 480 L132 340 Z", lapel[0]);
  P("M250 300 L204 400 L232 480 L280 480 L268 340 Z", lapel[1]);
  if (o.buttons) for (const y of [350, 390, 430]) L.push(`<circle cx="${266 + (y - 340) / 8}" cy="${y}" r="4" fill="#e0b048"/>`);
  if (o.jabot) { P("M182 298 L218 298 L228 330 Q214 334 222 348 Q206 350 214 364 Q200 376 186 364 Q194 350 178 348 Q186 334 172 330 Z", "#efe6d2");
    P("M182 298 L200 298 L200 372 Q192 370 186 364 Q194 350 178 348 Q186 334 172 330 Z", "#a89a80");
    P("M188 318 Q200 324 212 318 M184 340 Q200 346 216 340 M190 358 Q200 362 210 358", "none", 'stroke="#7a6e5a" stroke-width="2"'); }
  else if (o.cravat) { P("M170 300 L200 330 L230 300 L226 316 L214 330 L222 368 L200 356 L178 368 L186 330 L174 316 Z", "#efe6d2"); P("M170 300 L200 330 L186 330 L174 316 Z M178 368 L200 356 L196 340 Z", "#a89a80"); }
  else { P("M168 300 L200 392 L232 300 Z", o.shirt || "#d8c39a"); P("M168 300 L200 392 L192 300 Z", o.shirtDark || "#8a7550"); }
  if (o.chain) L.push(`<path d="M176 316 Q200 352 224 316" fill="none" stroke="#e0b048" stroke-width="3"/><circle cx="200" cy="346" r="6" fill="#e0b048"/>`);
  L.push("%%HD%%"); L = hd;
  // Long hair falls in front of the shoulders, from the temples.
  if (o.long) { P("M150 174 L140 230 L132 300 L126 362 L146 370 L154 306 L158 232 Z", hair); P("M250 174 L260 230 L268 300 L274 362 L254 370 L246 306 L242 232 Z", hair);
    P("M252 190 L262 240 L270 304 L272 352 L262 356 L258 304 L250 244 Z", hairLit); }
  // Neck, face.
  const jaw = o.brute ? "M140 162 L136 232 L156 286 L200 306 L244 286 L264 232 L260 162 Z" : o.thin ? "M156 165 L152 228 L168 276 L200 300 L232 276 L248 228 L244 165 Z" : "M150 165 L146 228 L160 272 L200 298 L240 272 L254 228 L250 165 Z";
  const jawLit = o.brute ? "M206 162 L260 162 L264 232 L244 286 L214 298 L224 252 L212 212 L220 188 Z" : o.thin ? "M206 165 L244 165 L248 228 L232 276 L212 292 L220 250 L210 212 L218 190 Z" : "M206 165 L250 165 L254 228 L240 272 L214 290 L222 250 L212 212 L220 190 Z";
  p.splice(p.indexOf("%%HD%%"), 0, `<path d="M176 270 L174 306 L200 330 L226 306 L224 270 Z" fill="${sd}"/><path d="M206 276 L226 306 L214 318 Z" fill="${sl}"/>`);
  P(jaw, sd); P(jawLit, sl); P("M232 168 L250 168 L253 220 L242 200 Z", sh);
  if (o.ghost) { // a skull's face
    P("M158 196 Q176 186 194 198 L190 226 Q174 232 162 224 Z", "#0b0706"); P("M208 198 Q226 186 244 196 L240 224 Q228 232 212 226 Z", "#0b0706");
    if (state !== "sleep") { const r = state === "ask" || state === "blocked" ? 5 : 3; L.push(`<circle cx="226" cy="210" r="${r}" fill="#7ff0c8"/><circle cx="176" cy="210" r="${r * .8}" fill="#5ac8a0"/>`); }
    P("M194 232 L206 232 L204 250 L196 250 Z", "#0b0706");
    P("M172 264 L228 264 L224 286 L176 286 Z", "#0b0706");
    for (let x = 178; x < 224; x += 8) P(`M${x} 266 L${x + 6} 266 L${x + 6} 276 L${x} 276 Z`, "#e8e0c8");
    P("M154 240 L168 262 M246 240 L232 262", "none", 'stroke="#6a665a" stroke-width="2"');
  } else {
    P("M200 200 L188 246 L204 252 L214 246 Z", "#1c0f0b"); P("M204 200 L214 246 L206 250 L206 214 Z", sh);
    if (o.wrinkles) { P("M224 230 L246 226 M226 238 L244 236 M168 184 L196 182 M206 182 L236 184", "none", 'stroke="#2a160f" stroke-width="2"'); }
    // Brows: up when they ask or show, drawn together when blocked.
    const brows = state === "blocked" ? "M156 198 L196 182 L194 194 L158 208 Z M206 182 L246 198 L244 208 L208 194 Z"
      : o.brows === "thick" ? "M152 186 L196 180 L194 198 L156 204 Z M206 180 L250 186 L248 200 L208 198 Z" : "M156 192 L196 186 L192 198 L158 202 Z M208 186 L246 190 L244 200 L210 198 Z";
    P(brows, o.browColor || "#0c0807", ["ask", "fresh", "done"].includes(state) ? 'transform="translate(0 -7)"' : "");
    // Eyes: the lit one, the one in shadow, or a patch.
    // Eyes, as they stand: shut asleep, half shut gone quiet, wide when asking or blocked, happy when done, on the hourglass while it runs.
    const eye = (x) => ({
      sleep: `<path d="M${x} 211 L${x + 24} 210 L${x + 24} 213 L${x} 214 Z" fill="#0c0807"/>`,
      stale: `<path d="M${x} 209 L${x + 24} 209 L${x + 21} 214 L${x + 3} 214 Z" fill="#0c0807"/><rect x="${x + 12}" y="210" width="3" height="2" fill="#c8b890"/>`,
      ask: `<path d="M${x} 202 L${x + 24} 202 L${x + 22} 216 L${x + 2} 216 Z" fill="#0c0807"/><rect x="${x + 12}" y="204" width="5" height="5" fill="#f4dfb0"/>`,
      blocked: `<path d="M${x} 207 L${x + 24} 206 L${x + 21} 214 L${x + 3} 214 Z" fill="#0c0807"/><rect x="${x + 3}" y="208" width="4" height="4" fill="#f4dfb0"/>`,
      done: `<path d="M${x} 212 Q${x + 12} 200 ${x + 24} 212 L${x + 22} 215 Q${x + 12} 205 ${x + 2} 215 Z" fill="#0c0807"/>`,
      run: `<path d="M${x} 206 L${x + 24} 206 L${x + 20} 214 L${x + 4} 214 Z" fill="#0c0807"/><rect x="${x + 17}" y="209" width="4" height="4" fill="#f4dfb0"/>`,
    }[state] || `<path d="M${x} 206 L${x + 24} 206 L${x + 20} 214 L${x + 4} 214 Z" fill="#0c0807"/><rect x="${x + 12}" y="207" width="4" height="4" fill="#f4dfb0"/>`);
    L.push(eye(216));
    if (o.patch) { P("M150 178 L246 150 L248 158 L152 188 Z", "#0c0807"); P("M160 202 L194 200 L192 222 L176 228 L162 220 Z", "#050404"); }
    else L.push(`<g opacity=".7">${eye(164)}</g>`);
    if (o.specs) L.push(`<circle cx="228" cy="210" r="15" fill="none" stroke="#e0b048" stroke-width="3"/><circle cx="176" cy="210" r="15" fill="none" stroke="#8a6a28" stroke-width="3"/><path d="M191 208 L213 208" stroke="#e0b048" stroke-width="3"/><path d="M220 202 L232 214" stroke="#fff6d8" stroke-width="2" opacity=".6"/>`);
    if (o.scar) P("M232 222 L246 252 L243 254 L229 224 Z", "#7a3a24");
    if (o.scar2) P("M170 176 L186 236 L182 238 L166 178 Z", "#5a2a1a");
    if (o.freckles) for (const [x, y] of [[222, 230], [230, 236], [240, 228], [234, 244]]) L.push(`<rect x="${x}" y="${y}" width="3" height="3" fill="#7a3a24"/>`);
    if (o.soot) { P("M150 230 L196 236 L200 262 L160 270 Z", "#1a120e", 'opacity=".55"'); P("M226 238 L252 232 L246 262 L230 258 Z", "#2a1a12", 'opacity=".45"'); }
    // Beard and mouth.
    if (o.beard === "full") P("M152 236 L160 290 L176 330 L188 316 L200 346 L212 316 L226 330 L240 290 L248 236 L234 262 L216 262 L200 268 L184 262 L166 262 Z", hair);
    if (o.beard === "long") { P("M150 232 L156 300 L172 360 L186 340 L200 392 L214 340 L228 360 L244 300 L250 232 L234 262 L216 262 L200 268 L184 262 L166 262 Z", hair); P("M226 270 L244 300 L228 356 L220 330 Z", hairLit); }
    if (o.beard === "short") { // close-cut along the jaw (a brute's broader one): dark in the shadow, its own color where the candle catches it
      if (o.brute) { P("M137 226 L140 256 L156 290 L200 314 L244 290 L260 256 L263 226 L248 252 L228 262 L214 264 L200 268 L186 264 L172 262 L152 252 Z", hair);
        P("M214 266 L228 262 L248 252 L263 226 L260 256 L244 290 L216 306 Z", hairLit); }
      else { P("M148 232 L152 254 L164 276 L200 300 L236 276 L248 254 L252 232 L240 256 L222 264 L200 270 L178 264 L160 256 Z", hair);
        P("M210 268 L222 264 L240 256 L252 232 L248 254 L236 276 L214 292 Z", hairLit); } }
    if (o.beard === "strap") { // a young one's: a thin line along the jaw
      P("M150 236 L156 258 L170 280 L200 298 L230 280 L244 258 L250 236 L246 256 L232 274 L200 290 L168 274 L154 256 Z", hair);
      P("M214 288 L232 274 L246 256 L250 236 L244 258 L230 280 Z", hairLit); }
    if (o.beard === "goatee") P("M186 276 L200 318 L214 276 L206 282 L194 282 Z", hair);
    if (o.beard === "vandyke") { P("M190 280 L200 324 L210 280 L204 286 L196 286 Z", hair); }
    // The mouth; with a pipe, the one opening between mustache and beard, the pipe in it.
    if (o.pipe) P("M178 265 L200 259 L222 265 L200 271 Z", "#3a120e");
    else if (state === "ask") { P("M186 266 L214 266 L210 286 L190 286 Z", "#3a0e0a"); P("M188 266 L212 266 L211 270 L189 270 Z", "#e8dcc0"); }
    else if (state === "blocked") P("M184 274 L192 268 L200 274 L208 268 L216 274 L214 278 L208 273 L200 279 L192 273 L186 278 Z", "#5a1a14");
    else if (state === "sleep") P("M194 271 L206 271 L204 275 L196 275 Z", "#5a1a14");
    else P(o.smile || state === "done" || state === "fresh" ? "M182 268 Q200 284 218 268 L214 276 Q200 290 186 276 Z" : "M188 270 L212 270 L208 276 L192 276 Z", "#5a1a14");
    if (o.goldTooth) L.push(`<rect x="204" y="270" width="5" height="5" fill="#e0b048"/>`);
    if (o.pipe) { L.push(`<path d="M203 266 L238 290" stroke="#2a160c" stroke-width="6" stroke-linecap="round"/><path d="M214 274 L238 289" stroke="#6a4a2a" stroke-width="2"/>`);
      L.push(`<path d="M232 280 L254 280 L256 306 Q244 312 234 306 Z" fill="#2a160c"/><path d="M246 280 L254 280 L256 306 L248 308 Z" fill="#7a4a2a"/><path d="M232 280 L254 280 L253 284 L233 284 Z" fill="#c4502a"/>`);
      L.push(`<path d="M244 276 Q234 256 246 240 Q258 224 246 204" fill="none" stroke="#c8b8a0" stroke-width="3" opacity=".5"/>`); }
    if (o.mustache === "thin") P("M170 256 Q186 254 200 250 Q214 254 230 256 Q240 254 246 244 Q244 262 228 262 L200 258 L172 262 Q156 262 154 244 Q160 254 170 256 Z", hair);
    else if (o.mustache === "handlebar") P("M160 252 Q170 262 182 256 L200 248 L218 256 Q230 262 240 252 Q244 266 226 268 L200 260 L174 268 Q156 266 160 252 Z", hair);
    else if (o.mustache || o.beard === "full" || o.beard === "long") P("M168 258 L200 248 L232 258 L222 266 L200 260 L178 266 Z", hair);

  }
  // On the ears: a narrow face's are closer in.
  if (o.earring) L.push(`<circle cx="${o.thin ? 250 : o.brute ? 266 : 258}" cy="${o.thin ? 240 : 246}" r="5" fill="none" stroke="#e0b048" stroke-width="3"/>`);
  if (o.earring2) L.push(`<circle cx="${o.thin ? 150 : 142}" cy="${o.thin ? 240 : 246}" r="5" fill="none" stroke="#8a6a28" stroke-width="3"/>`);
  // What's on their head.
  const h = o.hat;
  if (h === "tricorn" || h === "tricorn-feather") {
    if (h === "tricorn-feather") P("M236 128 Q300 76 352 70 Q318 116 248 150 Z", o.feather || "#9a2a1e");
    P("M80 172 Q120 150 150 158 Q170 92 200 88 Q230 92 250 158 Q280 150 320 172 Q300 190 252 180 L148 180 Q100 190 80 172 Z", "#0c0807");
    L.push(`<path d="M86 172 Q120 156 150 162 L250 162 Q280 156 314 172" fill="none" stroke="#b88a38" stroke-width="3"/>`);
    P("M232 100 Q250 130 252 160 L246 160 Q240 128 226 104 Z", "#4a2a1a");
    if (o.skullHat !== false) { P("M190 118 Q200 108 210 118 L210 128 L205 132 L195 132 L190 128 Z", "#e6d8b8"); L.push(`<rect x="193" y="120" width="5" height="4" fill="#0c0807"/><rect x="202" y="120" width="5" height="4" fill="#0c0807"/><path d="M182 138 L218 146 M218 138 L182 146" stroke="#e6d8b8" stroke-width="3"/>`); }
  } else if (h === "bicorne") {
    P("M70 176 Q110 90 200 84 Q290 90 330 176 Q300 160 200 158 Q100 160 70 176 Z", "#0e1018");
    L.push(`<path d="M76 172 Q110 96 200 90 Q290 96 324 172" fill="none" stroke="#c99a3a" stroke-width="4"/>`);
    P("M240 100 Q300 120 326 170 L316 170 Q292 128 236 108 Z", "#2a2c3a");
    L.push(`<circle cx="200" cy="124" r="12" fill="#9a2a1e"/><circle cx="200" cy="124" r="6" fill="#e0b048"/>`);
    P("M150 160 L250 160 L252 176 L148 176 Z", hair);
  } else if (h === "bandana") {
    const [c1, c2] = o.cloth || ["#7a1a16", "#b0322a"];
    P("M146 182 Q148 128 200 124 Q252 128 254 182 L240 172 Q200 156 160 172 Z", c1);
    P("M200 124 Q252 128 254 182 L240 172 Q222 160 202 160 Z", c2);
    P("M250 156 L290 170 L276 186 L292 210 L262 186 Z", c2);
    for (const [x, y] of [[170, 148], [196, 140], [222, 146], [240, 162], [182, 162]]) L.push(`<circle cx="${x}" cy="${y}" r="3.5" fill="#e6d8b8" opacity=".85"/>`);
    if (o.long) {} else P("M150 182 L146 210 L156 206 L158 184 Z M250 182 L254 210 L244 206 L242 184 Z", hair);
  } else if (h === "scarf") {
    const [c1, c2] = o.cloth || ["#2a3a2a", "#4a6a40"];
    P("M142 196 Q140 120 200 116 Q260 120 258 196 L246 180 Q200 150 154 180 Z", c1); P("M200 116 Q260 120 258 196 L246 180 Q226 160 204 156 Z", c2);
    P("M150 190 L136 250 L156 246 L160 196 Z", c1);
  } else if (h === "bald") {
    const w = o.brute ? 12 : 0;      // a brute's skull is as broad as his jaw
    P(`M${150 - w} 170 Q${152 - w} ${124 - w / 2} 200 ${120 - w / 2} Q${248 + w} ${124 - w / 2} ${250 + w} 170 Z`, sd);
    P(`M206 ${122 - w / 2} Q${246 + w} ${126 - w / 2} ${250 + w} 170 L218 170 Q220 140 206 ${122 - w / 2} Z`, sl);
    P(`M222 130 Q${240 + w} 138 ${244 + w} 158 L${236 + w} 158 Q232 142 220 134 Z`, sh);
    if (o.tattoo) L.push(`<path d="M164 140 Q176 128 188 140 Q176 152 164 140 Z M172 156 L180 164" fill="none" stroke="#1a3a4a" stroke-width="3"/>`);
  } else if (h === "goggles") {
    P("M146 176 Q146 122 200 118 Q254 122 254 176 Z", hair); P("M206 120 Q250 126 254 176 L238 176 Q236 140 206 120 Z", hairLit);
    P("M146 168 L254 160 L254 172 L146 180 Z", "#3a2a1a");
    L.push(`<circle cx="180" cy="168" r="17" fill="#2a1a12" stroke="#8a6a28" stroke-width="4"/><circle cx="224" cy="164" r="17" fill="#3a4a40" stroke="#e0b048" stroke-width="4"/><path d="M216 156 L230 170" stroke="#d8f0e0" stroke-width="3" opacity=".7"/>`);
  } else if (h === "cavalier") {
    P("M228 120 Q290 70 356 96 Q318 104 300 132 Q272 120 244 142 Z", "#e8e0d0"); P("M240 130 Q300 92 352 100 Q320 118 296 140 Z", "#b8ac98");
    P("M60 178 Q100 150 150 152 Q160 96 200 92 Q240 96 250 152 Q300 150 340 178 Q320 194 200 186 Q80 194 60 178 Z", "#160c10");
    P("M232 98 Q252 124 252 156 L244 156 Q240 126 224 102 Z", "#4a1a2a");
    L.push(`<path d="M150 154 L250 154" stroke="#c99a3a" stroke-width="5"/><circle cx="246" cy="152" r="6" fill="#e0b048"/>`);
  } else if (h === "wig") {
    P("M144 190 Q140 118 200 112 Q260 118 256 190 L246 170 Q200 146 154 170 Z", "#d8d0c0"); P("M200 112 Q260 118 256 190 L246 170 Q228 150 204 146 Z", "#f2ece0");
    P("M156 128 Q200 108 244 128", "none", 'stroke="#a89a80" stroke-width="3"');
  } else if (h === "hood") {
    P("M120 300 Q100 180 200 110 Q300 180 280 300 L250 300 Q262 196 200 150 Q138 196 150 300 Z", "#1a1612"); P("M200 110 Q300 180 280 300 L262 300 Q270 196 206 140 Z", "#3a2a1e");
  }
  L = p;
  // The table.
  P("M0 428 L400 428 L400 480 L0 480 Z", "#24140d"); P("M0 428 L400 428 L400 436 L0 436 Z", "#8a4a24"); P("M220 428 L400 428 L400 436 L220 436 Z", "#d68a48");
  // A glass tankard of golden beer (full, or drunk empty), its handle on the right; the hand that holds it (or the hook).
  const tank = (kind) => {
    const full = kind === "full";
    const body = full ? `<path d="M2 8 L50 8 L54 94 L-2 94 Z" fill="#c8801e"/><path d="M34 8 L50 8 L54 94 L40 94 Z" fill="#f0b444"/><path d="M2 8 L14 8 L12 94 L-2 94 Z" fill="#8a4e10"/>`
        + `<circle cx="22" cy="40" r="2" fill="#ffe08a" opacity=".8"/><circle cx="30" cy="62" r="1.6" fill="#ffe08a" opacity=".7"/><circle cx="18" cy="74" r="1.4" fill="#ffe08a" opacity=".6"/>`
        + `<path d="M-3 8 Q10 -8 26 0 Q42 -8 55 8 L53 16 Q26 10 -1 16 Z" fill="#f4ead0"/><path d="M-3 8 Q10 -8 22 -2 L20 12 Q8 12 -1 16 Z" fill="#c8b890"/>`
      : `<path d="M2 8 L50 8 L54 94 L-2 94 Z" fill="#f4e4b8" opacity=".22"/><path d="M34 8 L50 8 L54 94 L40 94 Z" fill="#ffe8b0" opacity=".25"/><path d="M0 80 L52 80 L53 92 L-1 92 Z" fill="#e0962a" opacity=".9"/>`
        + `<path d="M4 22 Q16 34 8 52 Q14 62 6 70 M46 18 Q36 36 46 52" stroke="#f4ead0" stroke-width="2.5" fill="none" opacity=".75"/><path d="M-3 8 L55 8" stroke="#f4ead0" stroke-width="3" opacity=".8"/>`;
    return body + `<path d="M2 8 L50 8 L54 94 L-2 94 Z" fill="none" stroke="#f8e8c0" stroke-width="2.5" opacity="${full ? .45 : .8}"/><path d="M44 18 L47 84" stroke="#fff6dc" stroke-width="3" opacity=".55"/>`
      + `<path d="M-4 90 L56 90 L56 97 L-4 97 Z" fill="#f8e8c0" opacity=".35"/><path d="M54 24 Q82 28 80 54 Q78 76 52 78" fill="none" stroke="#f8e8c0" stroke-width="7" opacity=".4"/>`;
  };
  const hand = () => o.hook
    ? `<path d="M62 68 L76 68 L76 48 Q94 48 94 30 Q94 14 80 12" fill="none" stroke="#c8c4bc" stroke-width="6"/><path d="M54 66 L86 66 L86 84 L54 84 Z" fill="#2a1a12"/>`
    : `<path d="M28 24 L72 16 L78 48 L36 60 Z" fill="${sd}"/><path d="M54 20 L72 16 L78 48 L62 52 Z" fill="${sl}"/>` + (o.rings ? `<rect x="56" y="32" width="14" height="4" fill="#e0b048"/>` : "");
  // An arm, from the hand back to the shoulder (sx, sy in the hand's own coordinates): a coat's sleeve, its lit edge, the shirt's cuff.
  const arm = (sx = 0, sy = 220) => `<path d="M24 60 L66 54 L${sx + 34} ${sy} L${sx - 30} ${sy + 6} Z" fill="${o.coat || "#120d0c"}"/>`
    + `<path d="M56 56 L66 54 L${sx + 34} ${sy} L${sx + 20} ${sy + 2} Z" fill="${o.coatLit || "#5a2a16"}"/><path d="M24 58 L66 52 L66 66 L26 72 Z" fill="${o.shirt || "#d8c39a"}"/><path d="M48 55 L66 52 L66 66 L50 69 Z" fill="#f0e2bc"/>`;
  const at = (x, y, r, cls, inner) => `<g transform="translate(${x} ${y}) rotate(${r})"><g class="${cls}">${inner}</g></g>`;
  // The candle: lit, out (smoking), burned down to a stub.
  const candle = (how) => {
    const top = how === "stub" ? 404 : 372;
    let c = `<rect x="318" y="${top}" width="22" height="${428 - top}" fill="#e8d6a8"/><rect x="330" y="${top}" width="10" height="${428 - top}" fill="#fff0c8"/><path d="M312 428 L346 428 L344 420 L314 420 Z" fill="#6a4a20"/><rect x="328" y="${top - 6}" width="2" height="6" fill="#1c0f0b"/>`;
    if (how === "stub") c += `<path d="M320 ${top} L318 ${top + 14} L322 ${top + 14} Z M336 ${top} L338 ${top + 10} L334 ${top + 10} Z" fill="#e8d6a8"/>`;
    if (how === "lit") c += `<ellipse cx="329" cy="352" rx="18" ry="30" fill="url(#paf${o.id})" class="pa-glow"/><g class="pa-flame"><path d="M329 336 Q338 352 329 366 Q320 352 329 336 Z" fill="#fff4c4"/></g>`;
    else c += `<g class="pa-smoke"><path d="M329 ${top - 8} Q320 ${top - 30} 332 ${top - 50} Q342 ${top - 70} 330 ${top - 92}" fill="none" stroke="#c8b8a0" stroke-width="3" opacity=".45"/></g>`;
    return c;
  };
  const after = [];      // drawn last: over the head (arms folded under it, a bag on the shoulder)
  if (state === "work") {
    // Drinking: the arm stays on its shoulder and bends at the elbow; its wrist follows the glass (each moment's shape below,
    // the glass's place and tilt at the same moments), up to the mouth, a sip, and down.
    const T = "0;0.4;0.5;0.6;0.85;0.925;1", dur = "4s";
    const poses = { rest: [56, 336, 0, [46, 430], [88, 412]], mid: [102, 287, 17, [47, 398], [89, 398]], up: [148, 238, 34, [48, 366], [90, 384]] };
    const wrist = ([x, y, r], lx, ly) => { const c = Math.cos(r * Math.PI / 180), sn = Math.sin(r * Math.PI / 180); return [x + lx * c - ly * sn, y + lx * sn + ly * c].map((v) => v.toFixed(1)); };
    const shape = (k) => { const q = poses[k], a = wrist(q, 24, 60), b = wrist(q, 66, 54);
      return `M98 326 L${q[3][0]} ${q[3][1]} L${a[0]} ${a[1]} L${b[0]} ${b[1]} L${q[4][0]} ${q[4][1]} L142 334 Z`; };
    const seq = ["rest", "rest", "mid", "up", "up", "mid", "rest"];
    L.push(`<path d="${shape("rest")}" fill="${o.coat || "#120d0c"}"><animate attributeName="d" values="${seq.map(shape).join(";")}" keyTimes="${T}" dur="${dur}" repeatCount="indefinite"/></path>`);
    L.push(`<g><animateTransform attributeName="transform" type="translate" values="${seq.map((k) => poses[k].slice(0, 2).join(" ")).join(";")}" keyTimes="${T}" dur="${dur}" repeatCount="indefinite"/>`
      + `<g><animateTransform attributeName="transform" type="rotate" values="${seq.map((k) => poses[k][2]).join(";")}" keyTimes="${T}" dur="${dur}" repeatCount="indefinite"/>`
      + `${tank("full")}<path d="M24 58 L66 52 L66 66 L26 72 Z" fill="${o.shirt || "#d8c39a"}"/>${hand()}</g></g>`);
  }
  else if (state === "ask") L.push(at(64, 150, -10, "pa-wave", arm(-2, 193) + tank("empty") + hand()));
  else if (state === "done") L.push(at(60, 110, -10, "pa-cheer", arm(-5, 233) + tank("full") + hand() + `<g class="pa-splash"><circle cx="8" cy="-14" r="4" fill="#f4ead0"/><circle cx="26" cy="-24" r="5" fill="#f4ead0"/><circle cx="44" cy="-12" r="3.5" fill="#f0b444"/></g>`));
  else if (state === "blocked") {
    L.push(`<ellipse cx="44" cy="430" rx="44" ry="5" fill="#c8801e" opacity=".85"/><path d="M20 428 L22 446 L26 428 Z M60 428 L61 440 L64 428 Z" fill="#c8801e"/>`);
    L.push(at(16, 428, -90, "", tank("empty")));
    // Stuck: an elbow on the table, the chin on a fist, a long look away.
    const coat = o.coat || "#120d0c", lit = o.coatLit || "#5a2a16", cuff = o.shirt || "#d8c39a";
    const chin = o.brute ? 312 : o.thin ? 302 : 300;
    after.push(`<path d="M96 432 L150 432 L206 ${chin + 22} L170 ${chin + 34} Z" fill="${coat}"/><path d="M134 432 L150 432 L206 ${chin + 22} L196 ${chin + 26} Z" fill="${lit}"/>`
      + `<path d="M166 ${chin + 30} L204 ${chin + 18} L208 ${chin + 30} L170 ${chin + 42} Z" fill="${cuff}"/>`
      + `<path d="M162 ${chin + 4} Q164 ${chin - 10} 180 ${chin - 12} L206 ${chin - 14} Q216 ${chin - 10} 214 ${chin + 4} L210 ${chin + 22} L170 ${chin + 32} Q160 ${chin + 22} 162 ${chin + 4} Z" fill="${sd}"/>`
      + `<path d="M196 ${chin - 13} L206 ${chin - 14} Q216 ${chin - 10} 214 ${chin + 4} L210 ${chin + 22} L198 ${chin + 25} Z" fill="${sl}"/>`
      + `<path d="M170 ${chin - 4} L194 ${chin - 7} M168 ${chin + 6} L196 ${chin + 2} M170 ${chin + 16} L198 ${chin + 12}" stroke="#1c0f0b" stroke-width="2" fill="none" opacity=".7"/>`);
  } else if (state === "sleep") {
    after.push(`<path d="M52 432 Q60 384 120 374 L280 374 Q340 384 348 432 Z" fill="${o.coat || "#120d0c"}"/><path d="M280 374 Q340 384 348 432 L330 432 Q324 396 276 388 Z" fill="${o.coatLit || "#5a2a16"}"/>`
      + `<path d="M120 374 Q200 362 280 374 L276 382 Q200 372 124 382 Z" fill="${o.shirt || "#d8c39a"}" opacity=".85"/><path d="M196 380 Q206 400 200 428" stroke="#2a1a14" stroke-width="3" fill="none"/>`
      + `<g class="pa-zz" font-family="Georgia, serif" font-style="italic" fill="#e8dcc0"><text x="262" y="316" font-size="22">z</text><text x="282" y="288" font-size="28">z</text><text x="306" y="256" font-size="36">Z</text></g>`);
  } else if (state === "arrive") {
    after.push(`<path d="M74 250 Q34 330 62 424 L160 412 Q170 330 124 254 Q100 238 74 250 Z" fill="#cdb48a"/><path d="M124 254 Q170 330 160 412 L140 414 Q148 332 110 260 Z" fill="#a08660"/>`
      + `<path d="M70 320 Q110 312 150 322" stroke="#7a6040" stroke-width="3" fill="none"/><path d="M96 246 L104 226" stroke="#5a4028" stroke-width="5"/><path d="M84 222 L118 218 L122 246 L90 250 Z" fill="${sd}"/>`);
  } else L.push(at(56, 336, 0, "", tank(state === "stale" ? "empty" : "full") + hand()));
  // What else is on the table, and the candle.
  if (state === "run") L.push(`<g transform="translate(236 352)"><g class="pa-hourglass"><rect x="0" y="0" width="46" height="7" fill="#6a4a20"/><rect x="0" y="69" width="46" height="7" fill="#6a4a20"/>`
    + `<path d="M6 7 L40 7 L23 38 Z M6 69 L40 69 L23 38 Z" fill="#f4e4b8" opacity=".18"/><path d="M6 7 L40 7 L23 38 L6 7 M6 69 L40 69 L23 38 Z" fill="none" stroke="#f8e8c0" stroke-width="2" opacity=".5"/>`
    + `<g class="pa-sand-top"><path d="M10 10 L36 10 L23 34 Z" fill="#e8b048"/></g><rect class="pa-stream" x="22" y="36" width="2" height="30" fill="#e8b048"/><g class="pa-sand-bot"><path d="M8 68 L38 68 L23 52 Z" fill="#e8b048"/></g></g></g>`);
  if (state === "fresh") L.push(`<g class="pa-map"><path d="M244 234 L338 220 L348 306 L254 320 Z" fill="#e8d4a0"/><path d="M244 234 L338 220 L339 230 L245 244 Z" fill="#c8ae78"/>`
    + `<path d="M262 280 L272 274 M282 270 L292 266 M300 262 L310 258" stroke="#6b4a2a" stroke-width="3"/><path d="M316 248 L332 262 M332 248 L316 262" stroke="#c4342a" stroke-width="4"/>`
    + `<path d="M246 304 L272 300 L276 330 L248 334 Z" fill="${sl}"/><path d="M248 334 L276 330 L300 480 L262 480 Z" fill="${o.coat || "#120d0c"}"/></g>`);
  if (state === "done") L.push(`<path d="M232 390 L306 390 L306 428 L232 428 Z" fill="#6a3a1c"/><path d="M232 390 L306 390 L298 364 L240 364 Z" fill="#3a1e0e"/><path d="M234 392 Q269 362 304 392 Z" fill="#e0b048"/>`
    + `<path d="M232 402 L306 402 L306 406 L232 406 Z M264 390 L274 390 L274 428 L264 428 Z" fill="#a87a2a"/><g class="pa-coins"><circle cx="252" cy="372" r="5" fill="#f2c14e"/><circle cx="280" cy="366" r="4" fill="#f2c14e"/><circle cx="296" cy="378" r="4.5" fill="#ffe08a"/></g>`);
  L.push(candle(state === "sleep" ? "out" : state === "stale" ? "stub" : "lit"));
  if (state === "stale") L.push(`<g stroke="#b8b0a0" stroke-width="1.4" fill="none" opacity=".55"><path d="M0 0 L120 96 M0 0 L80 140 M0 0 L150 40 M0 0 L30 150"/><path d="M40 32 Q30 48 26 70 M80 64 Q60 88 52 112 M24 18 Q50 22 70 10 M60 50 Q96 48 120 30 M96 78 Q110 64 136 52"/></g>`
    + `<g stroke="#b8b0a0" stroke-width="1.2" fill="none" opacity=".5"><path d="M400 120 L330 172 M400 120 L360 200 M400 120 L320 150 M372 140 Q356 160 352 182 M386 132 Q364 140 340 160"/></g>`);
  if (o.parrot) { P("M262 300 Q252 266 270 250 Q290 244 296 262 L292 300 Z", "#2a8a3a"); P("M282 252 Q296 248 300 262 L292 270 Z", "#c4342a"); P("M296 258 L306 264 L296 268 Z", "#e0b048"); L.push(`<circle cx="286" cy="258" r="2.6" fill="#0c0807"/>`); P("M270 296 L262 330 L276 330 L284 298 Z", "#c4342a"); P("M284 270 Q298 284 292 300 L284 300 Z", "#5ac04a"); }
  if (typeof after !== "undefined") p.push(...after);
  const move = state === "sleep" ? ' transform="translate(0 96)"' : state === "stale" ? ' transform="translate(0 8) rotate(-4 200 260)"' : "";
  const live = ["idle", "run", "fresh", "stale", "arrive", "blocked"].includes(state) ? "pa-breathe" : "";
  const out = p.join("").replace("%%HB%%", `<g${move}><g class="${live}">${hb.join("")}</g></g>`).replace("%%HD%%", `<g${move}><g class="${live}">${hd.join("")}</g></g>`);
  return `<svg viewBox="0 0 400 480" xmlns="http://www.w3.org/2000/svg" class="ui-crew-art pa-st-${state}">${out}</svg>`;
}

const UI_CREW = [
  { id: 1, name: "The Captain", what: "Tricorn with the skull, eyepatch, scar, black beard", hat: "tricorn", long: true, patch: true, scar: true, beard: "full", earring: true },
  { id: 2, name: "The Old Salt", what: "Bald, a white beard to the chest, a pipe, wrinkles", hat: "bald", skin: "tan", hair: "#d8d4cc", hairLit: "#f0ece4", beard: "long", wrinkles: true, pipe: true, brows: "thick", browColor: "#bdb6aa" },
  { id: 3, name: "The Deckhand", what: "Young, red bandana, freckles, two earrings, a grin", hat: "bandana", skin: "pale", hair: "#5a2a14", thin: true, freckles: true, earring: true, earring2: true, smile: true, hairLit: "#a85a2a" },
  { id: 4, name: "The Quartermistress", what: "Long red hair, a plumed tricorn, a scar, a gold chain", hat: "tricorn-feather", feather: "#d8d0c0", skullHat: false, long: true, hair: "#7a2a14", hairLit: "#b04a20", thin: true, scar2: true, chain: true, smile: true, earring: true },
  { id: 5, name: "The Navigator", what: "Bicorne and gold, spectacles, a handlebar mustache", hat: "bicorne", specs: true, mustache: "handlebar", epaulettes: true, buttons: true, coat: "#0e1018", coatLit: "#2a3050", skin: "light" },
  { id: 6, name: "The Bosun", what: "A brute: bald and tattooed, a broad jaw, a gold tooth", hat: "bald", brute: true, tattoo: true, skin: "dark", beard: "short", mustache: true, hairLit: "#4a3020", goldTooth: true, smile: true, brows: "thick", earring: true },
  { id: 7, name: "The Cook", what: "A headscarf, a goatee, a hook for a hand", hat: "scarf", cloth: ["#5a1a12", "#8a2a1a"], skin: "tan", beard: "goatee", mustache: true, hook: true, shirt: "#e8dcc6" },
  { id: 8, name: "The Gunner", what: "Goggles up, soot on the face, a short beard", hat: "goggles", hair: "#2a1a10", hairLit: "#5a3a20", soot: true, beard: "full", scar: true },
  { id: 9, name: "The Gentleman", what: "A cavalier's plumed hat, long dark hair, a pointed beard, lace at the throat, rings", hat: "cavalier", long: true, hair: "#1a0e0c", hairLit: "#4a2a1e", jabot: true, beard: "vandyke", mustache: "thin", rings: true, buttons: true, earring: true, coat: "#160c10", coatLit: "#4a1a2a", thin: true, skin: "light" },
  { id: 10, name: "The Ghost", what: "A skull under the hood, a green glint in its eyes, a parrot", hat: "hood", ghost: true, skin: "ghost", parrot: true },
];

// What floats over their head: a mark (? ! ✓ z…), and what they say, in a
// bubble (always for what asks you; for the rest under the pointer or the
// keys). cheer: they just got done, gold and confetti.
function uiPirate({ id = null, hue = 0, look, pose = "idle", mark = "", tone = "", say = "", title, pill = null, lead = null,
                    actions = [], open, label = "", cheer = false, vacant = false }) {
  const art = h("span", { class: "ui-pirate-art", html: uiCrewArt(UI_CREW[look.kind], pose) });
  if (vacant) return h("div", { class: `ui-pirate vacant ph-${hue}`, "aria-hidden": "true" }, h("span", { class: "ui-pirate-go" }, h("span", { class: "ui-pirate-scene" }, art)));
  const bubble = mark ? h("span", { class: `ui-pirate-mark t-${tone || pose}`, "aria-hidden": "true" }, mark) : null;
  const pinned = !!say && (pose === "ask" || pose === "blocked");
  const talk = say ? h("span", { class: `ui-pirate-say${pinned ? " pinned" : ""}` }, pinned ? h("span", { class: "ui-pirate-say-text" }, say) : say) : null;
  const confetti = cheer ? h("span", { class: "ui-confetti", "aria-hidden": "true" }, ...Array.from({ length: 16 }, () => h("i", {}))) : null;
  const s = id && typeof rowOf === "function" ? rowOf(id) : null;
  const prio = s && s.priority && s.priority !== "normal" ? glyph(s.priority, `prio ${s.priority}`) : null;
  // What asks you is under them, over the name, always; the rest over the head, a moment.
  const head = h("button", { class: "ui-pirate-go today-go", type: "button", onclick: open, "aria-label": label || null },
    h("span", { class: "ui-pirate-scene" }, art, bubble, pinned ? null : talk, confetti), pinned ? talk : null,
    h("span", { class: "ui-pirate-plate" }, lead, prio, h("span", { class: "ui-pirate-name" }, typeof title === "string" ? taskText(title) : title), pill));
  const el = h("article", { class: `tcard ui-pirate p-${pose} ph-${hue}${cheer ? " cheer" : ""}`, "data-id": id || null,
                            onclick: (e) => { if (!e.target.closest("button, a, input, textarea, select, summary")) open(e); } },
    head, actions.filter(Boolean).length ? h("div", { class: "ui-pirate-actions" }, ...actions.filter(Boolean)) : null);
  if (s && typeof holdable === "function") holdable(head, () => rowMenu(s));
  return el;
}

// A crew's flag: the Jolly Roger in their color, their name on it, waving.
function uiFlag(name, hue, { count = null } = {}) {
  const r = (x, y, w, hh, c) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" class="${c}"/>`;
  const skull = r(4, 2, 6, 5, "obone") + r(5, 7, 4, 2, "obone") + r(5, 4, 1, 2, "oflag") + r(8, 4, 1, 2, "oflag") + r(7, 6, 1, 1, "oflag")
    + r(1, 9, 2, 1, "obone") + r(3, 10, 2, 1, "obone") + r(9, 10, 2, 1, "obone") + r(11, 9, 2, 1, "obone") + r(5, 11, 4, 1, "obone")
    + r(1, 12, 2, 1, "obone") + r(3, 11, 2, 1, "obone") + r(9, 11, 2, 1, "obone") + r(11, 12, 2, 1, "obone");
  return h("span", { class: `ui-flag ph-${hue}` },
    h("span", { class: "ui-flag-pole", "aria-hidden": "true" }),
    h("span", { class: "ui-flag-cloth" },
      h("span", { class: "ui-flag-skull", "aria-hidden": "true", html: `<svg viewBox="0 0 14 14" shape-rendering="crispEdges">${skull}</svg>` }),
      h("span", { class: "ui-flag-name" }, name),
      count !== null ? h("span", { class: "ui-flag-count" }, String(count)) : null));
}
