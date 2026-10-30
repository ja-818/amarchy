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
// - uiPirate: a chat as a pirate at their crew's table, in pixels, posed
//   as it stands (the Tavern).
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
// A chat as a pirate in the tavern, sat at their crew's long table, drawn
// in pixels (an SVG, shape-rendering crispEdges) from the theme's colors
// (ui.css --tavern-*). What it does is how they sit: pose is
// work (plotting on a map, quill going), run (a swig while the hourglass
// runs), ask (up, a hand raised, ?), blocked (up, hands on their head, !),
// fresh (holding up a map: look), done (up with the grog, a chest of gold,
// ✓), idle (a tankard and a candle), sleep (head on the table, candle out,
// z z), stale (gone quiet, the grog dry), arrive (walking in with a sea bag), empty (a free
// stool: + recruits a new one).
// look: who they are, the same every time (uiLook(id)): skin, hair, hat,
// an eyepatch, a beard, a parrot. Their shirt is their crew's color (hue).
// barkeep: your assistant, behind the bar with an apron.
// Like a card (uiCard) it's an article.tcard with the chat's id and a head
// (.today-go) that opens it: the board's keys, its lit one, x and s, work on
// a pirate as on a card.

// Who a chat is, from its id: the same pirate on every screen.
function uiLook(id) {
  let n = 2166136261;
  for (const c of String(id || "")) n = Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0;
  const pick = (k) => { const v = n % k; n = Math.floor(n / k) ^ (n >>> 7); return v; };
  return { skin: pick(5), hair: pick(5), hat: pick(5), patch: pick(4) === 0, beard: pick(3) === 0, parrot: pick(6) === 0 };
}

// The drawing: 48 × 40 pixels, the table's top at 27 (38 × 37 of it the
// pirate's, shown at one height; the table runs on past its edges, under
// the next pirate's, however wide their stool is).
function uiPirateSprite(look, pose, { barkeep = false } = {}) {
  const r = (x, y, w, hh, c) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" class="${c}"/>`;
  const out = [];
  const up = pose === "ask" || pose === "blocked" || pose === "done";
  // The stool, its top behind the table.
  out.push(r(17, 24, 14, 3, "ostool") + r(17, 24, 14, 1, "ostool2"));
  if (pose !== "empty") {
    const asleep = pose === "sleep";
    const hx = asleep ? 21 : 20, hy = asleep ? 16 : 8;      // the head: on the table, asleep
    const at = (x, y, w, hh, c) => r(hx + x, hy + y, w, hh, c);
    const shut = asleep || pose === "done" || pose === "stale";
    const eyeX = pose === "work" ? 1 : 0;      // eyes on the map
    const eyes = shut ? at(1 + eyeX, 4, 2, 1, "oe") + at(5, 4, 2, 1, "oe")
                      : `<g class="o-eyes">${at(2 + eyeX, 3, 1, 2, "oe")}${look.patch ? "" : at(5 + eyeX, 3, 1, 2, "oe")}</g>`;
    const patch = look.patch ? at(-1, 1, 10, 1, "oink") + at(4, 2, 3, 3, "oink") : "";
    const mouth = pose === "ask" || pose === "blocked" ? at(3, 7, 2, 1, "om") : pose === "done" ? at(2, 6, 4, 2, "om") : at(3, 7, 2, 1, "om2");
    const beard = look.beard ? at(0, 5, 1, 4, "oh") + at(7, 5, 1, 4, "oh") + at(1, 7, 2, 2, "oh") + at(5, 7, 2, 2, "oh") + at(2, 9, 4, 1, "oh") : "";
    // Hats: a tricorn, a bandana (their crew's), bald with an earring, a headscarf with long hair, a captain's hat.
    const hat = [];
    const hatOf = barkeep ? 1 : look.hat;
    if (hatOf === 0) hat.push(at(-3, -1, 14, 2, "ohat"), at(-1, -4, 10, 3, "ohat"), at(-3, -2, 1, 1, "ohat"), at(10, -2, 1, 1, "ohat"), at(-3, 0, 14, 1, "ogold"), at(3, -3, 2, 2, "obone"));
    else if (hatOf === 1) hat.push(at(-1, -2, 10, 4, "oband"), at(-1, -2, 10, 1, "oband2"), at(9, 0, 3, 2, "oband"), at(10, 2, 2, 3, "oband"), at(1, 0, 1, 1, "oband2"), at(5, -1, 1, 1, "oband2"));
    else if (hatOf === 2) hat.push(at(-1, 0, 1, 4, "oh"), at(8, 0, 1, 4, "oh"), at(-1, 5, 1, 1, "ogold"), at(0, -1, 8, 1, "oshine"));
    else if (hatOf === 3) hat.push(at(-1, -2, 10, 3, "oband"), at(-2, 1, 2, 9, "oh"), at(8, 1, 2, 9, "oh"), at(2, -1, 1, 1, "oband2"), at(6, -1, 1, 1, "oband2"));
    else hat.push(at(-2, -1, 12, 2, "ohat"), at(0, -5, 8, 4, "ohat"), at(-2, 0, 12, 1, "ogold"), at(2, -4, 4, 2, "obone"), at(3, -3, 2, 1, "ohat"));
    const top = hatOf === 2 ? "" : at(0, -1, 8, 1, "oh");
    const head = `<g class="o-head">${at(0, 0, 8, 9, "ok")}${top}${eyes}${patch}${mouth}${beard}${hat.join("")}</g>`;
    // The shirt: striped, their crew's color; an apron behind the bar.
    const stripes = [19, 21, 23, 25].map((y) => r(18, y, 12, 1, "os2")).join("");
    const torso = r(22, 16, 4, 2, "ok") + r(18, 18, 12, 9, "os") + stripes + r(22, 18, 4, 2, "ok") + (barkeep ? r(20, 20, 8, 7, "oapron") + r(21, 20, 1, 1, "oapron2") + r(26, 20, 1, 1, "oapron2") : "");
    const parrot = look.parrot && !asleep ? `<g class="o-parrot">${r(30, 11, 4, 6, "opar")}${r(30, 9, 4, 3, "opar2")}${r(34, 10, 1, 2, "obeak")}${r(32, 10, 1, 1, "oe")}${r(30, 17, 2, 3, "opar")}</g>` : "";
    const tank = (x, y) => r(x, y, 5, 6, "omug") + r(x, y, 5, 2, "ofoam") + r(x + 5, y + 2, 1, 3, "omug") + r(x + 1, y + 3, 1, 2, "omug2");
    let arms;
    if (pose === "done") arms = `<g class="o-arms">${r(15, 8, 3, 11, "os")}${r(30, 8, 3, 11, "os")}${r(15, 6, 3, 2, "ok")}${r(30, 6, 3, 2, "ok")}${tank(30, 1)}</g>`;
    else if (pose === "ask") arms = `${r(15, 19, 3, 7, "os")}${r(15, 25, 4, 2, "ok")}<g class="o-wave">${r(30, 7, 3, 12, "os")}${r(30, 4, 4, 3, "ok")}</g>`;
    else if (pose === "blocked") arms = `${r(15, 10, 3, 9, "os")}${r(30, 10, 3, 9, "os")}${r(16, 7, 4, 3, "ok")}${r(28, 7, 4, 3, "ok")}`;
    else if (pose === "fresh") arms = `${r(15, 19, 3, 7, "os")}${r(15, 25, 4, 2, "ok")}${r(30, 12, 3, 8, "os")}<g class="o-paper">${r(29, 1, 11, 11, "omap")}${r(29, 1, 11, 1, "omap2")}${r(29, 11, 11, 1, "omap2")}${r(31, 4, 1, 1, "opath")}${r(33, 5, 1, 1, "opath")}${r(35, 6, 1, 1, "opath")}${r(36, 7, 2, 1, "ox")}${r(36, 8, 2, 1, "ox")}</g>${r(30, 10, 3, 2, "ok")}`;
    else if (pose === "run") arms = `${r(30, 19, 3, 7, "os")}${r(29, 25, 4, 2, "ok")}<g class="o-sip">${r(15, 17, 3, 6, "os")}${r(16, 14, 3, 3, "ok")}${tank(13, 9)}</g>`;
    else if (pose === "work") arms = `${r(15, 19, 3, 7, "os")}${r(16, 25, 4, 2, "ok")}${r(30, 19, 3, 6, "os")}<g class="o-quill">${r(28, 23, 3, 2, "ok")}${r(29, 17, 1, 6, "ofeather")}${r(30, 16, 1, 5, "ofeather")}${r(28, 22, 1, 2, "oink")}</g>`;
    else if (asleep) arms = `${r(14, 24, 20, 3, "os")}${r(14, 24, 3, 3, "ok")}${r(31, 24, 3, 3, "ok")}`;
    else arms = `${r(15, 19, 3, 7, "os")}${r(30, 19, 3, 7, "os")}${r(16, 25, 4, 2, "ok")}${r(28, 25, 4, 2, "ok")}`;
    const bag = pose === "arrive" ? `<g class="o-box">${r(14, 15, 10, 13, "obag")}${r(15, 13, 8, 3, "obag2")}${r(18, 12, 2, 2, "obag2")}${r(16, 19, 6, 1, "obag2")}</g>` : "";
    out.push(`<g class="o-body${up ? " up" : ""}">${torso}${asleep ? "" : head}${parrot}${arms}${asleep ? head : ""}${bag}</g>`);
  }
  // The table: its top, its planks, a nail or two.
  out.push(`<g class="o-desk">${r(-200, 27, 448, 2, "odt")}${r(-200, 27, 448, 1, "odh")}${r(-200, 29, 448, 11, "odf")}${r(-200, 33, 448, 1, "odl")}${r(-200, 37, 448, 1, "odl")}${r(11, 30, 1, 1, "onail")}${r(36, 34, 1, 1, "onail")}</g>`);
  // What's on it.
  const things = [];
  const candle = (lit) => r(39, 21, 3, 6, "owax") + r(38, 26, 5, 1, "omug2") + (lit ? `<g class="o-flame">${r(40, 18, 1, 3, "oflame")}${r(39, 19, 3, 1, "oflame2")}</g>` : `<g class="o-steam">${r(40, 18, 1, 2, "ost")}${r(41, 16, 1, 2, "ost")}</g>`);
  const mug = r(6, 21, 5, 6, "omug") + r(6, 21, 5, 2, "ofoam") + r(11, 23, 1, 3, "omug") + r(7, 24, 1, 2, "omug2");
  if (pose === "work") things.push(r(17, 24, 13, 4, "omap"), r(17, 24, 13, 1, "omap2"), r(19, 26, 1, 1, "opath"), r(21, 25, 1, 1, "opath"), r(23, 26, 1, 1, "opath"), r(25, 25, 2, 1, "ox"), candle(true), mug);
  else if (pose === "run") things.push(`<g class="o-glass">${r(37, 17, 7, 1, "owood")}${r(37, 26, 7, 1, "owood")}${r(38, 18, 5, 3, "oglass")}${r(39, 21, 3, 1, "oglass")}${r(38, 22, 5, 4, "oglass")}<g class="o-sand-top">${r(38, 19, 5, 2, "osand")}</g>${r(40, 21, 1, 2, "osand")}<g class="o-sand">${r(38, 24, 5, 2, "osand")}</g></g>`);
  else if (pose === "done") things.push(r(35, 21, 11, 6, "ochest"), r(35, 19, 11, 2, "ochest2"), r(36, 19, 9, 1, "ogold"), r(37, 18, 2, 1, "ogold"), r(41, 18, 2, 1, "ogold"), r(40, 23, 1, 2, "ogold"), r(35, 21, 11, 1, "ochest2"), r(6, 25, 2, 2, "ogold"), r(9, 26, 2, 1, "ogold"));
  else if (pose === "ask" || pose === "blocked" || pose === "fresh") things.push(mug, candle(true));
  else if (pose === "sleep") things.push(mug, candle(false));
  else if (pose === "idle" || pose === "arrive") things.push(mug, candle(true));
  else if (pose === "stale") things.push(r(6, 24, 5, 3, "omug2"), candle(false));
  out.push(things.join(""));
  return `<svg class="ui-sprite p-${pose} sk-${look.skin} hr-${look.hair}${barkeep ? " barkeep" : ""}" viewBox="5 1 38 37" preserveAspectRatio="xMidYMax meet" shape-rendering="crispEdges" aria-hidden="true">${out.join("")}</svg>`;
}

// What floats over their head: a mark (? ! ✓ z…), and what they say, in a
// bubble (always for what asks you; for the rest under the pointer or the
// keys). cheer: they just got done, gold and confetti.
function uiPirate({ id = null, hue = 0, look, pose = "idle", mark = "", tone = "", say = "", title, pill = null, lead = null,
                    actions = [], open, label = "", barkeep = false, cheer = false, vacant = false }) {
  const art = h("span", { class: "ui-pirate-art", html: uiPirateSprite(look, pose, { barkeep }) });
  if (vacant) return h("div", { class: `ui-pirate vacant ph-${hue}`, "aria-hidden": "true" }, h("span", { class: "ui-pirate-go" }, h("span", { class: "ui-pirate-scene" }, art)));
  const bubble = mark ? h("span", { class: `ui-pirate-mark t-${tone || pose}`, "aria-hidden": "true" }, mark) : null;
  const pinned = !!say && (pose === "ask" || pose === "blocked");
  const talk = say ? h("span", { class: `ui-pirate-say${pinned ? " pinned" : ""}` }, say) : null;
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
