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
// - uiFolds, uiFold: what's long, folded under heads that each say their
//   point (a reply's sections): a tap opens one, the rest stay heads.
// - uiBrief: what something comes to, and a few rows label by label (a
//   reply's briefing). uiActions: what's yours to do, a line each.
// - uiTabs: one of a few (Chats | Tasks), each with what's your move.
// - uiFilter: shows only some of what's there, on or off, with how many.
// - uiSearch: the search box.
// - uiTool: a tool's icon button in a bar.
// - uiScore: your score in a word or two (the streak's flame, today's
//   missions against your goal, a ring); a tap opens the rest.
// - spinner (app.js, drawn in ui.css): something at work.
// - uiProgress: progress to something (a rank's to the next).
// - uiStepper: a number to pick, with − and + (your daily goal).
// - uiBadges: badges, earned and to earn.
// - uiTiles: a few big numbers, each with its word under it.
// - uiChart: a few days' counts, as bars, the last one lit.
// - uiChatHead: over an open chat, as its card's head: Back, its project
//   and name (a tap: rename), its pill; its menu, Complete.
// - uiPreview: a chat's live preview, a tap away, on its head and its card;
//   uiPreviewSheet, all of it (start, stop, its log); uiPreviewLeft, what
//   Complete found still running.
// - uiAction: a bar's one thing to do (New chat, Complete), outlined.
// - uiBrand: the Ⓐ that opens the Amarchy menu, as Omarchy's own mark does.
// - uiMenu: a menu of things to do: a keyboard's card on a computer (type to
//   find, ↑ ↓ ↵), a sheet on the phone; the same items.
// - uiShot: a picture's thumbnail (in a message, in the box), its label on
//   it (Image 1, as its [Image #1] in the words); a tap: uiPhoto.
// - uiPhoto: pictures full screen, one at a time, ✕ at the top right.
// - uiSlides: slides one at a time over everything (the tour), a bar of
//   where you are on top, Back and Next under it.
// - uiPixels, uiPixmap: pixel art in the theme's own colors.
// - uiBurst: confetti in the theme's hues (a mission complete, the tour's end).
// - uiScrollRow: a row that scrolls sideways, square ‹ › beside it, the wheel too.
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

// A box you write in (a textarea) as tall as its words, up to max px (plus
// extra). Measured with no height of its own for an instant (auto) while
// what holds it keeps the height it has, so nothing around it moves: let go,
// the conversation over the box grew by the box's height for that instant,
// and Safari (no scroll anchoring to put it back) pulled what you read at
// its end up by that much, on every key of a long message. Its words'
// height, measured.
function uiFitField(field, { max = Infinity, extra = 0 } = {}) {
  const around = field.parentElement, held = around ? around.style.minHeight : "";
  if (around) around.style.minHeight = `${around.offsetHeight}px`;
  field.style.height = "auto";
  const tall = field.scrollHeight;
  field.style.height = `${Math.min(tall + extra, max)}px`;
  if (around) around.style.minHeight = held;
  return tall;
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
// data-id for the keys); unseen: a chat that answered and you haven't opened
// it since (lit, so it catches the eye), whatever it asks: by default its
// chat's own (today.js todayUnseen).
function uiCard({ kind, hue, lead = null, chip = "", title, pill = null, body = [], actions = [], open, id, label, unseen = null }) {
  // A chat's priority, when it isn't normal: its mark by its project (Ctrl+Alt+↑ / ↓, p or f sets it).
  const s = id && typeof rowOf === "function" ? rowOf(id) : null;
  if (unseen === null) unseen = !!s && typeof todayUnseen === "function" && todayUnseen(s);
  const prio = s && s.priority && s.priority !== "normal" ? glyph(s.priority, `prio ${s.priority}`) : null;
  if (prio) prio.title = `${PRIORITY[s.priority]} priority`;
  const head = h("button", { class: "tcard-head today-go", type: "button", onclick: open, "aria-label": label || null },
    lead, prio, chip ? h("span", { class: "tcard-chip" }, chip) : null,
    h("span", { class: "tcard-title" }, typeof title === "string" ? taskText(title) : title), pill);
  // The whole card opens it (its buttons, links and boxes do their own thing).
  const card = h("article", { class: `tcard k-${kind} ph-${hue}${unseen ? " unseen" : ""}`, "data-id": id || null,
                              onclick: (e) => { if (!e.target.closest("button, a, input, textarea, select, summary")) open(e); } }, head,
    ...body.filter(Boolean), actions.filter(Boolean).length ? h("div", { class: "tcard-actions" }, ...actions.filter(Boolean)) : null);
  // A chat's: held down on a phone, a right click on a computer (the menu key
  // with the keys): its menu, priority, name, commands, Complete (app.js rowMenu).
  if (s && typeof holdable === "function") holdable(head, () => rowMenu(s));
  return card;
}

// A pill: its words in its tone's color (ask, late, done, working, running,
// accent, warn, quiet; new: filled, a dot beating in it). working and running spin. long: words that may not fit, cut
// short with "…" (all of them on hover).
function uiPill(text, tone, { long = false, title = null } = {}) {
  const wheel = tone === "working" || tone === "running" ? spinner() : tone === "new" ? h("span", { class: "tpill-beat", "aria-hidden": "true" }) : null;
  return h("span", { class: `tpill t-${tone}${long ? " long" : ""}`, title: title || (long ? text : null) },
    wheel, long ? h("span", { class: "tpill-text" }, text) : text);
}

// A chat's work merged (its row's merged: {at, n, via, url, pr, since}), in
// words: "Merged ✓ 3:42 PM", "Merged ✓ yesterday 9:10 AM", "Merged ✓ ×3 · Fri 6:05 PM".
function uiMergedWords(m) {
  if (!m || !m.at) return "";
  const d = new Date(m.at * 1000), now = new Date();
  const clock = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
  const when = days <= 0 ? clock : days === 1 ? `yesterday ${clock}`
    : days < 7 ? `${d.toLocaleDateString([], { weekday: "short" })} ${clock}` : d.toLocaleDateString([], { day: "numeric", month: "short" });
  return `Merged ✓ ${m.n > 1 ? `×${m.n} · ` : ""}${when}`;
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

// Folds, one under the other in one box (uiFold each).
function uiFolds(...folds) {
  return h("div", { class: "ufolds" }, ...folds.flat().filter(Boolean));
}

// A fold: a head that says the point, what's under it open or folded. title:
// words or a node; toggle(open): told when you open or fold it. set(open)
// on it opens or folds it without telling.
function uiFold(title, { open = false, toggle = null } = {}, ...kids) {
  const body = h("div", { class: "ufold-body" }, ...kids.flat().filter(Boolean));
  const head = h("button", { class: "ufold-head", type: "button" }, h("span", { class: "ufold-title" }, title));
  const el = h("section", { class: "ufold" }, head, body);
  el.set = (on) => {
    el.classList.toggle("open", on);
    head.setAttribute("aria-expanded", String(on));
    body.hidden = !on;
  };
  el.set(open);
  head.onclick = () => {
    el.set(!el.classList.contains("open"));
    if (toggle) toggle(el.classList.contains("open"));
  };
  return el;
}

// A briefing: what it comes to (lead: words or a node), then a few rows,
// label by label. rows: [{label, value (words or a node), tone}]; tone
// "you": your move, lit; "none": nothing to do, quiet.
function uiBrief(rows, { lead = null } = {}) {
  return h("div", { class: "brief" }, lead ? h("div", { class: "brief-lead" }, lead) : null,
    rows.length ? h("dl", { class: "brief-rows" }, ...rows.flatMap((r) => [
      h("dt", { class: r.tone || null }, r.label), h("dd", { class: r.tone || null }, r.value)])) : null);
}

// What's yours to do, a line each. items: [{text (words or a node), due, done}].
function uiActions(items) {
  return h("ul", { class: "acts" }, ...items.map((x) => h("li", { class: x.done ? "done" : null },
    h("span", { class: "act-text" }, x.text), x.due ? h("span", { class: "act-due" }, x.due) : null)));
}

// Tabs: one of a few. items: [{key, label, count, title}]; on: the key
// that's on; pick(key). Each says its count (what's your move there) in a
// badge. Into el if given (drawn again, the keys kept), else a new one.
// scroll: one of many (a new chat's projects), in one row that scrolls
// sideways, the one that's on brought into view when it changes.
function uiTabs(items, on, pick, el = null, label = "", { scroll = false } = {}) {
  const box = el || h("div", { class: `seg ui-tabs${scroll ? " scroll" : ""}`, role: "tablist", "aria-label": label || null });
  const kids = items.map((t) => h("button", { class: `control${t.key === on ? " on" : ""}`, type: "button", role: "tab", "data-tab": t.key,
                                              title: t.title || null, "aria-selected": String(t.key === on), onclick: () => pick(t.key) },
    t.label, t.count ? h("span", { class: "tab-count" }, String(t.count)) : ""));
  uiSwap(box, kids);
  if (box.classList.contains("scroll") && box.dataset.shown !== String(on) && box.clientWidth) {
    const at = box.querySelector(".control.on");
    if (at) {
      const r = at.getBoundingClientRect(), v = box.getBoundingClientRect();
      if (r.left < v.left) box.scrollLeft += r.left - v.left - 8;
      else if (r.right > v.right) box.scrollLeft += r.right - v.right + 8;
      box.dataset.shown = String(on);
    }
  }
  return box;
}

// A filter: on, only what it names shows; its count in a badge. With nothing
// to show it can't be turned on.
function uiFilter({ label, count = 0, on = false, title = null, act }) {
  return h("button", { class: `head-btn ui-filter${on ? " on" : ""}`, type: "button", title, "aria-pressed": String(on), disabled: !count && !on ? true : null, onclick: act },
    label, count ? h("span", { class: "tab-count" }, String(count)) : "");
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
      uiPreview(s, { head: true }),
      main || !complete ? null : h("button", { class: "control ui-action complete", type: "button", title: "Complete mission: it reached its goal, close it (Ctrl+Alt+X)",
                                               "aria-label": "Complete mission", onclick: complete }, glyph("check"), h("span", { class: "label" }, "Complete"))),
  ];
}

// A chat's live preview (amarchy preview): the same on its head and its card,
// there as soon as its Claude registers it. Answering, a tap opens it. Not
// running, a tap starts it where you are (the server runs its command, no
// message to Claude, nothing opens): the button turns and says Starting…
// until it answers, then a toast says it's ready (a tap on it opens it) and
// the button is Preview. Starting, a tap opens its sheet (what it writes).
// Failed, a tap opens its sheet (what it wrote, Try again, Ask Claude to fix
// it). One registered as an address only (from before), nothing answering: a
// tap asks its Claude to start it, and to register it, as a message (once a
// minute at most).
const uiPreviewAsked = new Map();     // chat -> when: asked, for the moment it takes
const uiPreviewStarted = new Set();   // chats: started from here, until it answers or stops

const UI_PREVIEW_WORDS = { up: "Preview", starting: "Starting…", stopped: "Start preview", failed: "Preview failed", down: "Restart preview" };

function uiPreviewOf(s) {
  return s.preview_state || (s.preview_up ? "up" : s.preview && s.preview.run ? "stopped" : "down");
}

// Start it, in the background: its button says so at once (ahead of the
// server's list, app.js aheadOf), and nothing opens.
function uiPreviewStart(s) {
  const id = s.id;
  if (uiPreviewStarted.has(id)) return;
  uiPreviewStarted.add(id);
  const done = api(`/api/session/${encodeURIComponent(id)}/preview`, { action: "start" });
  done.catch(() => uiPreviewStarted.delete(id));      // it didn't start: aheadOf says why
  aheadOf(id, { preview_state: "starting", preview_up: false }, (r) => r.preview_state !== "stopped", done).catch(() => {});
}

// With each list (app.js refresh): one started from here answers, or stopped.
function uiPreviewSettle() {
  for (const id of [...uiPreviewStarted]) {
    const s = rowOf(id);
    const state = s && s.preview ? uiPreviewOf(s) : "";
    if (state === "starting") continue;
    uiPreviewStarted.delete(id);
    if (!state) continue;
    const name = s.task ? `${s.task}'s preview` : "The preview";
    if (state === "up") toast(`${name} is ready`, { label: "Open", act: () => openLink(s.preview.url) });
    else toast(state === "failed" ? `${name} didn't start` : `${name} stopped on its own`, { label: "See why", act: () => uiPreviewSheet(s) });
  }
}

function uiPreviewGo(s) {
  if (!s || !s.preview) return toast("No preview in this chat yet");
  const state = uiPreviewOf(s);
  if (state === "up") return openLink(s.preview.url);
  if (state === "failed" || state === "starting") return uiPreviewSheet(s);
  if (state === "stopped") return uiPreviewStart(s);
  const at = uiPreviewAsked.get(s.id);
  if (at && Date.now() - at < 60000) return;
  uiPreviewAsked.set(s.id, Date.now());
  sendTo(s.id, { text: `The preview at ${s.preview.url} isn't answering: start it again, and register it (amarchy preview --run '<command>' ${s.preview.url}) so its Preview button starts it from now on.` })
    .then(() => toast("Asked it to start the preview again"))
    .catch((e) => { uiPreviewAsked.delete(s.id); toast(e.message); });
}

function uiPreview(s, { head = false } = {}) {
  if (!s.preview) return null;
  const state = uiPreviewOf(s);
  if (state !== "down") uiPreviewAsked.delete(s.id);
  const asked = state === "down" && Date.now() - (uiPreviewAsked.get(s.id) || 0) < 60000;
  const words = asked ? "Restarting…" : UI_PREVIEW_WORDS[state];
  const title = { up: `Open ${s.preview.url}`, starting: `${s.preview.url} is starting: see what it writes`,
                  stopped: `Start ${s.preview.url}`, failed: `${s.preview.url} stopped with an error: see why`,
                  down: `${s.preview.url} isn't answering: ask its Claude to start it again` }[state];
  const go = (e) => {
    e.stopPropagation();
    e.preventDefault();
    uiPreviewGo(s);
    if (state === "down") {
      const b = e.currentTarget;
      b.disabled = true;
      (b.querySelector(".label") || b).textContent = "Restarting…";
    }
  };
  const busy = state === "starting";
  const cls = `ui-preview${state === "failed" ? " bad" : ""}${busy ? " busy" : ""}`;
  if (head) return h("button", { class: `control ui-action ${cls}`, type: "button", title, "aria-label": words, "aria-busy": busy ? "true" : null,
                                 disabled: asked || null, onclick: go }, busy ? spinner() : glyph("preview"), h("span", { class: "label" }, words));
  if (state === "up") return h("a", { class: `tbtn ${cls}`, href: s.preview.url, target: "_blank", rel: "noopener", title, onclick: go }, glyph("preview"), words);
  return h("button", { class: `tbtn ${cls}`, type: "button", title, "aria-busy": busy ? "true" : null, disabled: asked || null, onclick: go }, busy ? spinner() : null, words);
}

// Its size, as said: 412 MB, 1.4 GB.
function uiBytes(n) {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`;
}

// Where a chat's preview stands, in words (its sheet, Details, Automations).
function uiPreviewStatus(p) {
  const since = (t) => (t ? new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
  const why = { idle: `unused for ${Math.round((p.idle || 10800) / 3600 * 10) / 10} h`, closed: "the chat was completed", changed: "its command changed", cleared: "taken off" };
  const mem = p.memory ? ` · ${uiBytes(p.memory)} of ${p.memory_max}` : "";
  switch (p.state) {
    case "up": return p.run ? `Running${mem}${p.since ? ` · since ${since(p.since)}` : ""}` : "Answering";
    case "starting": return `Starting${mem}`;
    case "failed": return "Stopped with an error";
    case "stopped": return p.why && why[p.why] ? `Stopped: ${why[p.why]}` : "Not running";
    default: return "Not answering";
  }
}

// A chat's preview, whole: where it stands, what runs it, what it wrote,
// and Open, Start, Restart, Stop (Ask Claude to fix it, when it failed):
// started here, it says so as it comes up, and Open it once it answers. Its
// sheet, on the phone and the computer; the chat's menu opens it.
async function uiPreviewSheet(s) {
  const id = s.id;
  const body = h("div", { class: "preview-one" }, h("p", { class: "hint" }, "…"));
  const back = sheet({ key: "preview" }, sheetHead("Preview", s.task || ""), body);
  let p = null, busy = "";
  const act = async (action) => {
    busy = action;
    draw();
    try {
      const d = await api(`/api/session/${encodeURIComponent(id)}/preview`, { action });
      p = d.preview || p;
    } catch (e) {
      toast(e.message);
      if (e.data && e.data.preview) p = e.data.preview;
    }
    busy = "";
    draw();
  };
  const fix = () => {
    const log = (p.log || "").split("\n").slice(-15).join("\n");
    sendTo(id, { text: `The preview (${p.run}) stopped with an error. Its log ends:\n\n${log}\n\nFix it and start it again (amarchy preview restart).` })
      .then(() => { toast("Asked Claude to fix it"); closeSheet(); }, (e) => toast(e.message));
  };
  const item = (label, value) => (value ? h("div", { class: "kv" }, h("span", { class: "k" }, label), h("span", { class: "v" }, value)) : null);
  const draw = () => {
    if (!p) return;
    const running = p.state === "up" || p.state === "starting";
    const button = (label, action, primary) => h("button", { class: `control wide${primary ? " primary" : ""}`, type: "button", disabled: !!busy || null,
                                                       onclick: () => act(action) }, busy === action ? `${label}…` : label);
    const kids = [
      h("p", { class: `preview-state ${p.state}` }, uiPreviewStatus(p)),
      h("div", { class: "details" },
        item("Address", h("code", {}, p.url)),
        item("Command", p.run ? h("code", {}, p.run) : "None: an address only"),
        item("Stops with", p.stop ? h("code", {}, p.stop) : null),
        item("Ports", (p.ports || []).length ? p.ports.join(", ") : null),
        item("Limits", p.run ? `${p.memory_max} of memory · stops after ${Math.round(p.idle / 360) / 10} h unused` : null)),
      p.state === "up" ? h("button", { class: "control wide primary", type: "button", onclick: () => openLink(p.url) }, "Open it") : null,
      p.run && !running ? button(p.state === "failed" ? "Try again" : "Start it", "start", p.state !== "up") : null,
      p.run && running ? button("Restart", "restart") : null,
      p.run && running ? button("Stop", "stop") : null,
      p.state === "failed" ? h("button", { class: "control wide", type: "button", onclick: fix }, "Ask Claude to fix it") : null,
      p.log ? h("div", { class: "section" }, "What it wrote") : null,
      p.log ? h("pre", { class: "auto-log preview-log", role: "log" }, p.log) : null,
    ];
    keepFocus(body.parentNode || body, () => body.replaceChildren(...kids.filter(Boolean)));
  };
  const load = async () => {
    try {
      const r = await fetch(`/api/session/${encodeURIComponent(id)}/preview`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't read it");
      p = d;
      draw();
    } catch (e) {
      if (!p) body.replaceChildren(h("p", {}, e instanceof TypeError ? "Can't reach Amarchy" : e.message));
    }
  };
  back.redraw = load;
  await load();
  const tick = setInterval(() => {
    if (!back.isConnected) return clearInterval(tick);
    if (!back.hidden && document.visibilityState === "visible" && !busy) load();
  }, 2000);
}

// Complete stopped its preview, and something of it is still there (a
// process on its port, what its stop command didn't stop): the chat stays
// until it's gone. Its Claude is asked to stop it; you complete it after.
function uiPreviewLeft(s, left) {
  const ask = () => sendTo(s.id, {
    text: `I want to complete this chat, but its preview is still running after amarchy stopped it:\n${left.map((x) => `- ${x}`).join("\n")}\n\nStop it (and whatever started it), check its ports are free, then tell me it's done so I can complete the chat. If it isn't this chat's, run amarchy preview --clear.` })
    .then(() => { toast("Asked Claude to stop it"); closeSheets(); }, (e) => toast(e.message));
  sheet({ key: "preview-left" }, sheetHead("Its preview is still running", "Complete it once that's stopped"),
    h("ul", { class: "close-stops" }, ...left.map((x) => h("li", {}, x))),
    h("button", { class: "control wide primary", type: "button", onclick: ask }, "Ask Claude to stop it"),
    h("button", { class: "control wide", type: "button", onclick: closeSheet }, "Cancel"));
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
// items}), desk: only on a computer, on: the one lit (the keys start on
// it), always: shown whatever you look for}]. On a computer the keyboard's
// card (desk.js picker); on the phone a sheet, a group opening one of its
// own. search: a box over it that narrows it (its placeholder), on both.
function uiMenu(title, items, { search = "" } = {}) {
  items = items.filter((it) => it && (app.desk || !it.desk));
  if (app.desk && typeof picker === "function") return picker({ title, items, placeholder: search || undefined });
  const row = (it) => h("button", { class: `menu-item${it.danger ? " danger" : ""}${it.on ? " on" : ""}`, type: "button", onclick: async () => {
    if (it.group) { const g = await it.group(); return uiMenu(g.title, g.items); }
    closeSheets();
    if (it.act) it.act("");
  } }, h("span", { class: "label" }, it.icon ? glyph(it.icon, "icon") : null,
         h("span", { class: "ui-menu-text" }, it.label, it.detail ? h("small", {}, it.detail) : null)),
    it.group ? h("span", { class: "val" }, "›") : null);
  const rows = items.map((it) => Object.assign(row(it), { item: it }));
  const menu = h("div", { class: "menu ui-menu" }, ...rows);
  if (!search) return sheet(sheetHead(title), menu);
  // What you type narrows it; Enter picks the first one left.
  const box = uiSearch({ placeholder: search, label: search, key: "", cls: "ui-menu-search", input: { enterkeyhint: "go" } });
  const shown = () => rows.filter((r) => !r.hidden);
  box.field.addEventListener("input", () => {
    const q = box.field.value.trim().toLowerCase();
    for (const r of rows) r.hidden = !!q && !r.item.always && !`${r.item.label} ${r.item.detail || ""}`.toLowerCase().includes(q);
  });
  box.field.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    const first = shown()[0];
    if (first) first.click();
  });
  const back = sheet(sheetHead(title), box, menu);
  const on = rows.find((r) => r.item.on);
  if (on) requestAnimationFrame(() => uiReveal(on, { scroller: back.querySelector(".sheet"), block: "center" }));
  return back;
}

// ---- pictures: a thumbnail (uiShot) and full screen (uiPhoto)
//
// A thumbnail of a picture, its label on it ("Image 1": what the words call
// it, [Image #1]), and a tap opens it full screen with the others of its
// group (shots(): [{src, label}], as they are then, and which one this is).
function uiShot({ src, label = "", alt = "", cls = "", shots = null, lazy = false }) {
  const b = h("button", { class: `ui-shot${cls ? ` ${cls}` : ""}`, type: "button", "data-src": src, onclick: (e) => {
    e.stopPropagation();
    const all = shots ? shots() : [{ src, label: b.dataset.label }];
    uiPhoto(all, Math.max(0, all.findIndex((x) => x.src === src)));
  } }, h("img", { src, alt: alt || label || "A picture", ...(lazy ? { loading: "lazy" } : {}), draggable: "false" }));
  uiShotLabel(b, label);
  return b;
}

// A thumbnail's label, now (Image 2, once the words say so).
function uiShotLabel(b, label) {
  b.dataset.label = label || "";
  b.title = label ? `${label}: show it` : "Show the picture";
  b.setAttribute("aria-label", label ? `Show ${label}` : "Show the picture");
  let tag = b.querySelector(".ui-shot-label");
  if (!label) { if (tag) tag.remove(); return; }
  if (!tag) b.append(tag = h("span", { class: "ui-shot-label", "aria-hidden": "true" }));
  tag.textContent = label;
}

// Pictures full screen ([{src, label}], from the one at at): fit to the
// screen on black, its label at the top, the ✕ at the top right. It goes as
// a sheet does (✕, Esc, a tap around the picture, a swipe down on the
// phone); several: ‹ ›, the arrow keys, or a swipe sideways between them.
function uiPhoto(shots, at = 0) {
  shots = (shots || []).filter((x) => x && x.src);
  if (!shots.length) return null;
  let i = Math.min(Math.max(0, at), shots.length - 1);
  const img = h("img", { class: "ui-photo-img", alt: "", draggable: "false" });
  const label = h("div", { class: "ui-photo-label" });
  const many = shots.length > 1;
  const show = (to) => {
    i = (to + shots.length) % shots.length;
    img.src = shots[i].src;
    img.alt = shots[i].label || "A picture";
    label.textContent = [shots[i].label, many ? `${i + 1} of ${shots.length}` : ""].filter(Boolean).join(" · ");
    label.hidden = !label.textContent;
  };
  const step = (by) => (e) => { if (e) e.stopPropagation(); show(i + by); };
  const prev = many ? h("button", { class: "ui-photo-go prev", type: "button", "aria-label": "The picture before", title: "Before (←)", onclick: step(-1) }, "‹") : null;
  const next = many ? h("button", { class: "ui-photo-go next", type: "button", "aria-label": "The next picture", title: "Next (→)", onclick: step(1) }, "›") : null;
  const stage = h("div", { class: "ui-photo-stage" }, img);
  const back = sheet({ key: "photo", cls: "photo" }, h("div", { class: "head" }, label), stage, prev, next);
  const card = back.querySelector(".sheet");
  card.setAttribute("aria-label", "Picture");
  // Around the picture is the shade: a tap there closes it (the picture
  // fills the screen as it fits: beside it is still around it).
  const onPicture = (e) => {
    const r = img.getBoundingClientRect();
    const k = Math.min(r.width / (img.naturalWidth || r.width), r.height / (img.naturalHeight || r.height));
    const w = (img.naturalWidth || r.width) * k, ht = (img.naturalHeight || r.height) * k;
    const x = e.clientX - r.left - (r.width - w) / 2, y = e.clientY - r.top - (r.height - ht) / 2;
    return x >= 0 && y >= 0 && x <= w && y <= ht;
  };
  card.addEventListener("click", (e) => {
    if (e.target === card || e.target === stage || (e.target === img && !onPicture(e))) closeSheet();
  });
  // ← →: the one before, the next (before the sheet's keys move between its buttons).
  back.addEventListener("keydown", (e) => {
    if (!many || e.altKey || e.ctrlKey || e.metaKey || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    show(i + (e.key === "ArrowRight" ? 1 : -1));
  }, true);
  // A swipe sideways: the next or the one before (down closes it: the sheet's).
  let from = null;
  stage.addEventListener("touchstart", (e) => { from = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    if (!from || !many) return;
    const t = e.changedTouches[0], dx = t.clientX - from.x, dy = t.clientY - from.y;
    from = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(i + (dx < 0 ? 1 : -1));
  }, { passive: true });
  show(i);
  return back;
}

// ---- a row that scrolls sideways (uiScrollRow)
//
// A row wider than its room (a slide's themes), with ‹ › beside it (square,
// outside the row): each a page of it along, shown only while there's more
// that way. A mouse's
// wheel scrolls it sideways too (a trackpad's sideways swipe already does;
// at its end, the wheel scrolls the page again), and the keys move along it
// as in any row of buttons. row: the row itself (it scrolls); its box, with
// the arrows either side, is what's returned (box.update(): the arrows
// again, after its contents changed by other means than a redraw).
function uiScrollRow(row, { label = "" } = {}) {
  row.classList.add("ui-scroll-row");
  const page = (dir) => () => {
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollBy({ left: dir * Math.max(120, row.clientWidth * 0.8), behavior: calm ? "auto" : "smooth" });
  };
  const arrow = (dir) => h("button", { class: `ui-scroll-go ${dir < 0 ? "prev" : "next"}`, type: "button", tabindex: "-1",
                                      "aria-label": `${dir < 0 ? "Back" : "More"}${label ? `: ${label}` : ""}`, title: dir < 0 ? "Back" : "More",
                                      onclick: page(dir) }, glyph(dir < 0 ? "back" : "next"));
  const prev = arrow(-1), next = arrow(1);
  const box = h("div", { class: "ui-scroll" }, prev, row, next);
  const update = () => {
    const max = row.scrollWidth - row.clientWidth;
    // (A few pixels from an end is at it: a card snapped to the row's padding.)
    // Gone, its place kept: the row never moves.
    for (const [b, off] of [[prev, row.scrollLeft <= 4], [next, row.scrollLeft >= max - 4]]) {
      b.classList.toggle("off", off);
      b.setAttribute("aria-hidden", String(off));
    }
  };
  row.addEventListener("scroll", update, { passive: true });
  row.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;      // sideways already: the row's own
    const max = row.scrollWidth - row.clientWidth;
    const by = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? row.clientWidth : 1);
    const to = Math.max(0, Math.min(max, row.scrollLeft + by));
    if (max <= 0 || Math.abs(to - row.scrollLeft) < 1) return;      // nothing that way: the page scrolls
    e.preventDefault();
    row.scrollLeft = to;
  }, { passive: false });
  new ResizeObserver(update).observe(row);
  new MutationObserver(() => requestAnimationFrame(update)).observe(row, { childList: true });
  box.update = update;
  requestAnimationFrame(update);
  return box;
}

// ---- pixel art (uiPixels), confetti (uiBurst) and slides (uiSlides)
//
// Pixel art in the theme's own colors: a picture is rows of letters, one a
// pixel ("." none; a accent, t text, m muted, k the sunken surface, s the
// raised one, x a rule, r o y g c b p the theme's hues). A capital letter
// is the same color, blinking (each letter at its own beat). Drawn as an
// SVG of crisp squares, so a theme changes every picture with the rest.
// rows: [strings], or a picture made with uiPixmap. scale: a pixel's size
// in CSS pixels. cls: its own classes (bob: it bobs; d1-d3: a beat later).
const UI_PX = "atmksxroygcbp";
function uiPixels(rows, { scale = 6, cls = "", label = "" } = {}) {
  if (rows && rows.rows) rows = rows.rows();
  const w = Math.max(...rows.map((r) => r.length)), ht = rows.length;
  let rects = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const c = row[x];
      let run = 1;
      while (row[x + run] === c) run++;
      if (UI_PX.includes(c.toLowerCase())) rects += `<rect x="${x}" y="${y}" width="${run}" height="1" class="px-${c.toLowerCase()}${c === c.toUpperCase() ? ` px-blink px-${c}` : ""}"/>`;
      x += run;
    }
  });
  const el = h("span", { class: `ui-px${cls ? ` ${cls}` : ""}`, ...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" }) });
  el.innerHTML = `<svg viewBox="0 0 ${w} ${ht}" width="${w * scale}" height="${ht * scale}" shape-rendering="crispEdges">${rects}</svg>`;
  return el;
}

// A picture drawn with lines and boxes rather than typed (uiPixels takes
// it): set(x, y, c), line(x0, y0, x1, y1, c) (straight or at 45°),
// box(x, y, w, h, c), frame(x, y, w, h, c), put(x, y, rows) (a small
// picture over it, its dots see-through), rows().
function uiPixmap(w, ht) {
  const grid = Array.from({ length: ht }, () => Array(w).fill("."));
  const m = {
    set(x, y, c) { if (x >= 0 && y >= 0 && x < w && y < ht) grid[y][x] = c; return m; },
    line(x0, y0, x1, y1, c) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 0; i <= n; i++) m.set(x0 + Math.sign(x1 - x0) * i, y0 + Math.sign(y1 - y0) * i, c);
      return m;
    },
    box(x, y, bw, bh, c) { for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) m.set(x + i, y + j, c); return m; },
    frame(x, y, bw, bh, c) { m.line(x, y, x + bw - 1, y, c).line(x, y + bh - 1, x + bw - 1, y + bh - 1, c); return m.line(x, y, x, y + bh - 1, c).line(x + bw - 1, y, x + bw - 1, y + bh - 1, c); },
    put(x, y, rows) { rows.forEach((row, j) => [...row].forEach((c, i) => { if (c !== ".") m.set(x + i, y + j, c); })); return m; },
    rows: () => grid.map((r) => r.join("")),
  };
  return m;
}

// Confetti in the theme's own hues, flying out from the middle of what it's
// put in (it fills it, and lets every click through). bits: how many; far:
// how far they fly (in the screen's widths, %). None when the system asks
// for less motion.
const UI_HUES = ["--red", "--yellow", "--green", "--blue", "--magenta", "--cyan", "--orange", "--accent"];
function uiBurst({ bits = 90, far = 42 } = {}) {
  const burst = h("div", { class: "ui-burst", "aria-hidden": "true" });
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return burst;
  for (let i = 0; i < bits; i++) {
    const bit = h("i");
    const angle = Math.random() * Math.PI * 2, d = 18 + Math.random() * far;
    bit.style.setProperty("--dx", `${Math.cos(angle) * d}vw`);
    bit.style.setProperty("--dy", `${Math.sin(angle) * d * 0.8 + 12 + Math.random() * 20}vh`);
    bit.style.setProperty("--rot", `${Math.round(Math.random() * 1080 - 540)}deg`);
    bit.style.setProperty("--d", `${1.1 + Math.random() * (far > 42 ? 1.4 : 0.9)}s`);
    bit.style.setProperty("--c", `var(${UI_HUES[i % UI_HUES.length]})`);
    if (i % 3 === 0) bit.classList.add("round");
    burst.append(bit);
  }
  return burst;
}

// Slides, one at a time, over everything (a tour). slides: [{kicker, title,
// art, body: [lines: words, or nodes], extra, actions, burst}], each drawn
// when it comes (art, body, extra and actions may be functions that make
// them then). A line's words take **bold** and `code`.
// At the top, a bar of segments: where you are (a tap goes to that one) and
// the ✕; at the bottom Back, n of all, and Next (the last one's: done, which
// closes it). → / ← (Space, Shift+Space; PageDown, PageUp), a swipe
// sideways, or the buttons go along (not in a row that scrolls sideways:
// uiScrollRow, or a part marked .ui-slides-own-keys; those take their own);
// Esc, the ✕, the shade or a swipe down close it, as any sheet. burst: confetti as that one comes.
// opts: key (the sheet's), label, start (the first one shown), done (the
// last one's button), shown(i) (told as each comes), closed(i, finished).
function uiSlides(slides, { key = "slides", label = "Slides", start = 0, done = "Done", shown = null, closed = null } = {}) {
  let at = -1, finished = false;
  const made = (x) => (typeof x === "function" ? x() : x);
  const words = (text) => {
    const out = h("span", {});
    for (const part of String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
      if (!part) continue;
      if (part.startsWith("**")) out.append(h("b", {}, part.slice(2, -2)));
      else if (part.startsWith("`")) out.append(h("code", {}, part.slice(1, -1)));
      else out.append(part);
    }
    return out;
  };
  const segs = slides.map((s, n) => h("button", { class: "ui-slides-seg", type: "button", "aria-label": `${n + 1} of ${slides.length}: ${s.kicker || s.title}`,
                                                  onclick: () => go(n) }, h("i")));
  const bar = h("div", { class: "ui-slides-bar" }, ...segs);
  const stage = h("div", { class: "ui-slides-stage", "aria-live": "polite" });
  const count = h("span", { class: "ui-slides-count" });
  const back = uiButton("Back", () => go(at - 1), false, "quiet ui-slides-back");
  const next = uiButton("Next", () => (at < slides.length - 1 ? go(at + 1) : finish()), true, "ui-slides-next");
  const foot = h("div", { class: "ui-slides-foot" }, back, count, next);
  const el = sheet({ key, cls: "slides" }, h("div", { class: "head" }, h("h2", { class: "ui-slides-label" }, label), bar), stage, foot);
  const card = el.querySelector(".sheet");
  const finish = () => { finished = true; closeSheet(); };
  const go = (n) => {
    n = Math.max(0, Math.min(slides.length - 1, n));
    if (n === at) return;
    const forward = n > at;
    at = n;
    const s = slides[n];
    const body = (made(s.body) || []).filter(Boolean).map((line) => (line instanceof Node ? line : h("p", { class: "ui-slide-line" }, words(line))));
    const slide = h("article", { class: `ui-slide${s.cls ? ` ${s.cls}` : ""} ${forward ? "fwd" : "bwd"}` },
      s.art ? h("div", { class: "ui-slide-art" }, made(s.art)) : null,
      s.kicker ? h("div", { class: "ui-slide-kicker" }, s.kicker) : null,
      h("h3", { class: "ui-slide-title" }, s.title),
      ...body,
      made(s.extra) || null,
      s.actions ? h("div", { class: "ui-slide-actions" }, ...(made(s.actions) || []).filter(Boolean)) : null);
    stage.replaceChildren(slide);
    if (s.burst) stage.append(uiBurst({ bits: 120, far: 50 }));
    stage.scrollTop = 0;
    segs.forEach((b, i) => {
      b.classList.toggle("on", i === n);
      b.classList.toggle("past", i < n);
      if (i === n) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
    });
    count.textContent = `${n + 1} / ${slides.length}`;
    back.disabled = n === 0;
    next.textContent = n === slides.length - 1 ? done : "Next";
    next.classList.toggle("primary", !(n === slides.length - 1 && s.actions));      // the last one's own action is the one thing to do
    if (shown) shown(n);
  };
  // The keys: along the slides (not in a box you type in, nor a row that
  // takes its own arrows: a slide's themes). Wherever the keys are while
  // it's the one on top (the page under it, after a click that left them
  // there): Esc closes it there too, as its own keys would.
  const keys = (e) => {
    if (!el.isConnected) return window.removeEventListener("keydown", keys, true);
    if (el.hidden || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.target.matches("input, textarea")) return;
    const inside = el.contains(e.target);
    if (!inside && [...document.querySelectorAll(".sheet-back:not([hidden]), .picker-back")].pop() !== el) return;      // another over it has them
    if (!inside && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return closeSheet(); }
    const by = { ArrowRight: 1, ArrowLeft: -1, PageDown: 1, PageUp: -1 }[e.key]
      ?? (e.key === " " && !e.target.matches("button") ? (e.shiftKey ? -1 : 1) : 0);
    if (!by || (e.key.startsWith("Arrow") && e.target.closest(".ui-slides-own-keys, .ui-scroll"))) return;
    e.preventDefault();
    e.stopPropagation();
    if (by > 0 && at === slides.length - 1) return finish();
    go(at + by);
  };
  window.addEventListener("keydown", keys, true);
  // A swipe sideways: the next one, or the one before (down: the sheet's, it closes).
  let from = null;
  stage.addEventListener("touchstart", (e) => {
    from = e.touches.length === 1 && !e.target.closest(".ui-slides-own-keys, .ui-scroll") ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    if (!from) return;
    const t = e.changedTouches[0], dx = t.clientX - from.x, dy = t.clientY - from.y;
    from = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(at + (dx < 0 ? 1 : -1));
  }, { passive: true });
  // Gone (however it went): said, with where it was and whether it got to its end.
  new MutationObserver((_, obs) => {
    if (el.isConnected) return;
    obs.disconnect();
    if (closed) closed(at, finished);
  }).observe(document.body, { childList: true });
  go(start);
  if (app.desk || lastInput.keys) next.focus({ preventScroll: true });
  card.setAttribute("aria-label", label);
  el.go = go;
  el.at = () => at;
  return el;
}
