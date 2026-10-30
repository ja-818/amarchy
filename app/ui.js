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
// A chat as a pirate in the tavern, sat at their crew's long table, drawn
// as a noir comic (ink shadows, a candle's warm light; ui.css --tavern-*). What it does is how they sit: pose is
// work (plotting on a map, quill going), run (a swig while the hourglass
// runs), ask (up, a hand raised, ?), blocked (up, hands on their head, !),
// fresh (holding up a map: look), done (up with the grog, a chest of gold,
// ✓), idle (a tankard and a candle), sleep (head on the table, candle out,
// z z), stale (gone quiet, the grog dry), arrive (walking in with a sea bag), empty (a free
// stool: + recruits a new one).
// look: who they are, the same every time (uiLook(id)): skin, hair, hat,
// an eyepatch, a beard or a mustache, a scar, an earring. Their coat's
// lapels are their crew's color (hue).
// barkeep: your assistant, behind the bar with an apron.
// Like a card (uiCard) it's an article.tcard with the chat's id and a head
// (.today-go) that opens it: the board's keys, its lit one, x and s, work on
// a pirate as on a card.

// Who a chat is, from its id: the same pirate on every screen.
function uiLook(id) {
  let n = 2166136261;
  for (const c of String(id || "")) n = Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0;
  const pick = (k) => { const v = n % k; n = Math.floor(n / k) ^ (n >>> 7); return v; };
  return { skin: pick(5), hair: pick(5), hat: pick(4), patch: pick(3) === 0, beard: pick(2) === 0, stache: pick(2) === 0, scar: pick(3) === 0, earring: pick(3) === 0 };
}

// ---- the drawing: noir, as a comic's ink (heavy black shadows, a few
// warm colors, hard angles), lit by the candle on their right. 200 × 190,
// the table's top at 160; it runs on past the edges, under the next pirate.
// Each part a path; its color a class (ui.css .n-*): ink, skin (its shadow,
// lit, its light), bone, the crew's color on the coat's lapels, gold...

// The head, around its middle (0, 0): its face lit on one side, its look
// (eyes, mouth) as it stands, then beard, patch, hat.
function uiNoirHead(look, pose, barkeep) {
  const P = (d, c) => `<path d="${d}" class="n-${c}"/>`;
  const out = [];
  const hat = barkeep ? -1 : look.hat;      // 0 tricorn, 1 bandana, 2 long hair, 3 bald
  if (hat === 2 || hat === 0) out.push(P("M-27 -20 L-35 22 L-40 62 L-25 58 L-21 12 Z M27 -20 L35 22 L40 62 L25 58 L21 12 Z", "hair"));
  out.push(P("M-12 28 L-12 50 L12 50 L12 28 Z", "skin-dark"), P("M4 30 L12 30 L12 50 L6 46 Z", "skin"));
  out.push(P("M-26 -24 L-28 6 L-20 26 L0 38 L20 26 L28 6 L26 -24 Z", "skin-dark"));
  out.push(P("M4 -24 L26 -24 L28 6 L20 26 L8 34 L12 12 L6 -4 L10 -14 Z", "skin"), P("M16 -22 L26 -22 L27 0 L21 -10 Z", "skin-hi"));
  // Eyes and brows.
  const shut = pose === "sleep" || pose === "stale" || pose === "done";
  const wide = pose === "ask" || pose === "blocked";
  out.push(P(wide ? "M-22 -16 L-4 -20 L-5 -14 L-21 -11 Z M4 -20 L22 -17 L21 -11 L5 -14 Z" : pose === "work" ? "M-22 -10 L-4 -12 L-5 -6 L-21 -5 Z M4 -12 L22 -10 L21 -4 L5 -6 Z"
                                                 : "M-22 -12 L-4 -15 L-5 -9 L-21 -6 Z M4 -15 L22 -13 L21 -7 L5 -9 Z", "ink"));
  if (shut) out.push(P(pose === "done" ? "M-20 -2 L-14 -6 L-8 -2 L-9 0 L-14 -3 L-19 0 Z M8 -2 L14 -6 L20 -2 L19 0 L14 -3 L9 0 Z" : "M-20 -2 L-8 -3 L-8 -1 L-20 0 Z M8 -3 L20 -2 L20 0 L8 -1 Z", "ink"));
  else {
    const dy = pose === "work" ? 3 : 0, h = wide ? 7 : 4;
    out.push(P(`M-20 ${-5 + dy} L-8 ${-5 + dy} L-9 ${-5 + dy + h} L-19 ${-5 + dy + h} Z M8 ${-5 + dy} L20 ${-5 + dy} L18 ${-5 + dy + h} L10 ${-5 + dy + h} Z`, "ink"));
    out.push(`<g class="n-eyes"><rect x="13" y="${-4 + dy}" width="2.5" height="2.5" class="n-bone"/></g>`);
  }
  // Nose, a scar, the mouth.
  out.push(P("M0 -8 L-6 14 L2 17 L8 14 Z", "ink"), P("M2 -8 L8 14 L4 16 L4 -2 Z", "skin-hi"));
  if (look.scar) out.push(P("M12 4 L22 22 L20 23 L10 5 Z", "scar"));
  const open = pose === "ask" || pose === "done" || pose === "fresh";
  const beard = !barkeep && look.beard;
  if (beard) out.push(P("M-26 2 L-22 24 L-14 44 L-6 38 L0 54 L6 38 L14 44 L22 24 L26 2 L18 16 L8 17 L0 20 L-8 17 L-18 16 Z", "hair"));
  out.push(open ? P("M-8 20 L8 20 L5 29 L-5 29 Z", "mouth") + P("M-6 20 L6 20 L5 22.5 L-5 22.5 Z", "bone")
                : pose === "blocked" ? P("M-6 24 L6 22 L6 24 L-6 26 Z", "mouth") : P("M-6 22 L6 22 L4 25 L-4 25 Z", "mouth"));
  if (beard || barkeep || look.stache) out.push(P("M-15 16 L0 10 L15 16 L9 19 L0 15 L-9 19 Z", "hair"));
  if (!beard && look.stache) out.push(P("M-5 30 L0 42 L5 30 Z", "hair"));
  if (look.patch && !barkeep) out.push(P("M-24 -5 L-6 -6 L-7 8 L-15 11 L-23 7 Z", "ink"), P("M-27 -14 L27 -27 L28 -23 L-26 -9 Z", "ink"));
  if (look.earring || hat === 3) out.push(`<circle cx="29" cy="12" r="3.4" class="n-ring"/>`);
  // What's on top.
  if (hat === 0) out.push(P("M-58 -24 Q-34 -38 -26 -32 Q-18 -64 0 -66 Q18 -64 26 -32 Q34 -38 58 -24 Q44 -14 26 -20 L-26 -20 Q-44 -14 -58 -24 Z", "hat"),
                          P("M14 -60 Q26 -46 27 -31 L23 -31 Q21 -46 10 -58 Z", "hat-lit"),
                          `<path d="M-55 -24 Q-34 -35 -26 -30 L26 -30 Q34 -35 55 -24" class="n-trim"/>`,
                          P("M-6 -54 Q0 -60 6 -54 L6 -48 L3 -46 L-3 -46 L-6 -48 Z", "bone"), P("M-4 -52 L-1 -52 L-1 -50 L-4 -50 Z M1 -52 L4 -52 L4 -50 L1 -50 Z", "ink"),
                          P("M-9 -44 L9 -40 L9 -38 L-9 -42 Z M9 -44 L-9 -40 L-9 -38 L9 -42 Z", "bone"));
  else if (hat === 1) out.push(P("M-29 -16 Q-27 -44 0 -46 Q27 -44 29 -16 L22 -14 Q0 -26 -22 -14 Z", "crew"),
                               P("M-29 -16 Q-27 -44 0 -46 L-3 -25 Q-14 -22 -22 -14 Z", "crew-dark"),
                               P("M26 -26 L44 -16 L37 -8 L42 4 L28 -8 Z", "crew"), P("M-29 -16 L29 -16 L22 -14 L-22 -14 Z", "ink"));
  else if (hat === 2 || barkeep) out.push(P("M-28 -18 Q-26 -46 0 -46 Q26 -46 28 -18 L24 -12 Q14 -30 -2 -28 Q-18 -26 -26 -10 Z", "hair"), P("M6 -44 Q22 -38 26 -20 L22 -18 Q18 -32 4 -40 Z", "hair-lit"));
  else out.push(P("M10 -26 Q20 -26 24 -18 L20 -17 Q16 -23 9 -23 Z", "skin-hi"));
  return out.join("");
}

// A tankard at (x, y), its foam; raised, it's drawn where the hand is.
function uiNoirMug(x, y) {
  return `<g transform="translate(${x} ${y})"><path d="M0 4 L28 4 L30 40 L-2 40 Z" class="n-metal"/><path d="M20 4 L28 4 L30 40 L22 40 Z" class="n-metal-lit"/>`
    + `<path d="M-2 0 Q14 -8 30 0 L29 7 L-1 7 Z" class="n-bone"/><path d="M29 12 Q42 14 41 24 Q40 34 29 34" class="n-handle"/></g>`;
}

// The candle on their right, its flame (its light: the scene's, ui.css).
function uiNoirCandle(lit) {
  return `<path d="M164 118 L180 118 L180 160 L164 160 Z" class="n-wax"/><path d="M173 118 L180 118 L180 160 L173 160 Z" class="n-wax-lit"/>`
    + `<path d="M158 160 L186 160 L183 154 L161 154 Z" class="n-gold-dark"/>`
    + (lit ? `<g class="n-flame"><path d="M172 92 Q181 106 172 118 Q163 106 172 92 Z" class="n-flame-out"/><path d="M172 101 Q176 109 172 116 Q168 109 172 101 Z" class="n-flame-in"/></g>`
           : `<g class="n-smoke"><path d="M172 116 Q166 106 173 98 Q179 90 172 80" class="n-wisp"/></g>`);
}

function uiPirateSprite(look, pose, { barkeep = false } = {}) {
  const P = (d, c) => `<path d="${d}" class="n-${c}"/>`;
  const out = [];
  const sleeve = (d, lit) => P(d, "coat") + (lit ? P(lit, "coat-lit") : "");
  if (pose === "empty") {
    out.push(P("M66 92 Q100 80 134 92 L138 160 L62 160 Z", "chair"), P("M118 90 Q130 92 134 92 L138 160 L126 160 Z", "chair-lit"), uiNoirMug(24, 120));
  } else {
    const asleep = pose === "sleep";
    const up = pose === "ask" || pose === "blocked" || pose === "done";
    const body = [];
    // The coat, its lit edge, the crew's lapels, the shirt.
    body.push(P("M26 190 L36 150 Q44 126 82 118 L118 118 Q156 126 164 150 L174 190 Z", "coat"),
              P("M118 118 Q156 126 164 150 L174 190 L162 190 L152 156 Q146 136 116 126 Z", "coat-lit"),
              P("M82 118 L100 160 L90 190 L64 190 L71 134 Z", "crew-dark"), P("M118 118 L100 160 L110 190 L136 190 L129 134 Z", "crew"),
              barkeep ? P("M84 118 L116 118 L118 190 L82 190 Z", "bone") + P("M84 118 L98 118 L96 190 L82 190 Z", "bone-dark")
                      : P("M88 118 L100 156 L112 118 Z", "bone") + P("M88 118 L100 156 L96 118 Z", "bone-dark"));
    // The head, where the pose puts it.
    const tilt = pose === "work" ? "translate(100 90) rotate(6)" : asleep ? "translate(96 136) rotate(-78)" : pose === "stale" ? "translate(98 86) rotate(-7)" : "translate(100 80)";
    const head = `<g transform="${tilt}"><g class="n-head">${uiNoirHead(look, pose, barkeep)}</g></g>`;
    // Arms, hands, what they hold.
    const handR = (x, y) => P(`M${x} ${y} L${x + 18} ${y - 2} L${x + 20} ${y + 12} L${x - 2} ${y + 13} Z`, "skin") + P(`M${x + 10} ${y - 1} L${x + 18} ${y - 2} L${x + 20} ${y + 12} L${x + 12} ${y + 12} Z`, "skin-hi");
    const handL = (x, y) => P(`M${x} ${y} L${x + 18} ${y - 2} L${x + 20} ${y + 12} L${x - 2} ${y + 13} Z`, "skin-dark");
    let arms = "", before = "", held = "";
    const restL = sleeve("M40 132 L72 150 L66 162 L30 156 Z") + handL(28, 142);
    const restR = sleeve("M160 132 L130 150 L134 162 L170 156 Z", "M160 132 L166 140 L170 156 L162 152 Z") + handR(126, 148);
    if (pose === "ask") { arms = restL; before = `<g class="n-wave">${sleeve("M146 132 L170 128 L170 46 L152 46 Z", "M164 46 L170 46 L170 128 L164 128 Z")}${P("M150 30 L172 28 L174 48 L152 50 Z M150 12 L155 11 L156 31 L151 31 Z M156.5 8 L161.5 7.5 L162 30 L157 30.5 Z M163 9 L168 9 L168.5 29.5 L163.5 30 Z M169 14 L173 14 L173.5 29 L169.5 29.5 Z M150 38 L142 30 L139 33 L148 46 Z", "skin")}${P("M163 9 L168 9 L168.5 29.5 L163.5 30 Z M169 14 L173 14 L173.5 29 L169.5 29.5 Z M168 29 L172 28 L174 48 L166 49 Z", "skin-hi")}</g>`; }
    else if (pose === "blocked") before = sleeve("M44 136 L62 132 L72 72 L56 70 Z") + handL(58, 56) + sleeve("M156 136 L138 132 L128 72 L144 70 Z", "M144 70 L156 136 L150 136 L139 72 Z") + handR(124, 56);
    else if (pose === "done") { before = sleeve("M40 134 L58 130 L52 40 L36 42 Z") + handL(32, 26) + sleeve("M160 134 L142 130 L148 40 L164 42 Z", "M158 42 L164 42 L160 134 L154 132 Z") + handR(144, 26); held = uiNoirMug(142, 10) + uiNoirMug(26, 10); }
    else if (pose === "fresh") { arms = restL; before = sleeve("M146 132 L168 128 L166 66 L150 66 Z", "M160 66 L166 66 L168 128 L162 128 Z") + handR(148, 52);
      held = `<g class="n-paper">${P("M122 8 L192 16 L188 70 L118 62 Z", "parch")}${P("M122 8 L192 16 L191 22 L121 14 Z", "parch-dark")}${P("M132 30 L136 31 M142 36 L146 38 M152 42 L156 45", "path")}${P("M164 44 L174 54 M174 44 L164 54", "x")}</g>`; }
    else if (pose === "run") { arms = restR; held = `<g class="n-sip">${sleeve("M40 134 L58 128 L72 104 L56 98 Z")}${handL(58, 92)}${uiNoirMug(60, 70)}</g>`; }
    else if (pose === "work") { arms = sleeve("M40 132 L76 150 L70 162 L30 156 Z") + handL(70, 146) + restR;
      held = P("M54 150 L146 150 L152 162 L48 162 Z", "parch") + P("M54 150 L146 150 L147 153 L53 153 Z", "parch-dark") + P("M70 156 L76 156 M84 157 L90 157 M98 156 L104 156", "path") + P("M118 154 L126 160 M126 154 L118 160", "x")
        + `<g class="n-quill">${P("M136 148 L150 104 L156 108 L140 150 Z", "bone")}${P("M150 104 L156 108 L146 132 Z", "bone-dark")}</g>`; }
    else if (asleep) arms = sleeve("M44 140 L156 140 L162 162 L38 162 Z", "M130 140 L156 140 L162 162 L140 162 Z");
    else if (pose === "arrive") { arms = restR; before = P("M30 66 Q16 112 46 144 L84 128 Q76 90 54 60 Z", "canvas") + P("M54 60 Q76 90 84 128 L74 132 Q66 96 46 66 Z", "canvas-dark") + P("M38 92 L72 84 L74 90 L40 98 Z", "ink"); }
    else arms = restL + restR;
    body.unshift(before);
    if (asleep) out.push(`<g class="n-body">${body.join("")}${arms}${head}</g>`);
    else out.push(`<g class="n-body${up ? " up" : ""}">${body.join("")}${head}${arms}${held}</g>`);
  }
  // The table: its lit edge, the dark wood under it.
  out.push(`<path d="M-400 160 L600 160 L600 164 L-400 164 Z" class="n-wood-lit"/><path d="M-400 164 L600 164 L600 200 L-400 200 Z" class="n-wood"/>`
    + `<path d="M-400 176 L600 176 M-400 188 L600 188" class="n-grain"/>`);
  // What's on it.
  const lit = !(pose === "sleep" || pose === "stale" || pose === "empty");
  if (pose === "run") out.push(`<g class="n-glass">${P("M160 112 L186 112 L186 116 L160 116 Z M160 156 L186 156 L186 160 L160 160 Z", "gold-dark")}${P("M164 116 L182 116 L174 136 L182 156 L164 156 L172 136 Z", "glass")}${P("M166 118 L180 118 L173 134 Z", "sand")}${P("M172 138 L174 138 L180 154 L166 154 Z", "sand")}</g>`);
  else if (pose === "done") out.push(P("M150 128 L194 128 L194 160 L150 160 Z", "chest"), P("M150 118 Q172 108 194 118 L194 128 L150 128 Z", "chest-dark"), P("M152 122 Q172 112 192 122 L192 128 L152 128 Z", "gold"),
                                     P("M150 136 L194 136 L194 139 L150 139 Z M168 128 L176 128 L176 160 L168 160 Z", "gold-dark"), P("M30 156 L40 156 L40 160 L30 160 Z M44 157 L52 157 L52 160 L44 160 Z", "gold"));
  else if (pose !== "empty") out.push(uiNoirCandle(lit));
  if (["idle", "ask", "blocked", "stale", "arrive", "fresh"].includes(pose)) out.push(uiNoirMug(20, 120));
  return `<svg class="ui-sprite noir p-${pose} sk-${look.skin} hr-${look.hair}${barkeep ? " barkeep" : ""}" viewBox="10 4 180 172" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${out.join("")}</svg>`;
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
