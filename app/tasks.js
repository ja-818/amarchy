// ---- the board: a computer's whole window, your chats and tasks as cards
//
// Today's queue (today.js), every chat a card: its project, its state, its
// goal and what it last said, with what it asks you as buttons. Opened (a
// click, Enter), the chat takes the window (desk.js show): answer, approve,
// write, its Terminal, Changes and Details beside it. Back (the button, Esc)
// is the board again, where you were; and so is sending it something: it
// works on that, and the next that's your move is lit, Enter to open it.
//
// The bar: the Ⓐ (the Amarchy menu: Automations, the look,
// Settings, Keys), Chats | Tasks (what's your move on each), the search,
// New chat.
//
// Everything has its key (? shows them): j / k (or the arrows) from card
// to card, l / h into a card along its buttons and back out, Enter opens
// (or presses), 1-4 picks an answer, x completes its mission (with Undo), r
// opens what a done chat made, s marks one seen, Tab Chats or Tasks, / searches, n starts a new chat, m the menu, p pins a chat, f puts it for later, o shows only what needs you.

const BOARD_TABS = ["chats", "tasks"];
const board = {
  el: null, box: null, head: null, slot: null, scroll: null,
  composing: false,  // the new chat's box at the top
  waitFor: null,     // a chat its address asks for that the list hasn't yet: opened once it has
  tab: "chats",      // Chats (your chats) or Tasks (your loops): the one you were on (boardBuild)
  query: "",         // what the search box has: the board shows what it finds instead of Today
  found: null,       // the server's answer for it: {q, results}
  from: null,        // where the board was scrolled when a chat opened
  sel: {},           // the card the keys are on, each tab its own (chats, tasks, search): {key, at}
};

// In sight: not in a folded part (a closed <details> keeps its boxes, hidden).
function shown(el) { return el.checkVisibility ? el.checkVisibility() : !el.closest("details:not([open]) > :not(summary)"); }

function boardBuild() {
  if (board.el) return board.el;
  for (const k of ["tavern-seats", "office-seats"]) store.set(k, "");      // (where the Tavern, gone, kept its pirates)
  const tab = store.get("board-tab");
  board.tab = BOARD_TABS.includes(tab) ? tab : "chats";      // (the Tavern's, gone: Chats)
  board.switchEl = h("div", { class: "seg ui-tabs board-switch", role: "tablist", "aria-label": "Chats or tasks" });
  // The bar (ui.css .ui-bar), as an open chat's: where you are (the Ⓐ, its
  // menu: Automations, the look, Settings, Keys…; Chats |
  // Tasks), what you look for (the search), and the one thing to start.
  board.head = h("header", { class: "board-head" },
    h("div", { class: "board-head-in ui-bar" },
      uiBrand(() => deskMenu()),
      board.switchEl,
      boardSearchBox(),
      uiAction("plus", "New chat", () => boardNew(), { title: "New chat (Ctrl+Alt+↵)", cls: "board-new-btn" })));
  board.slot = h("div", { class: "board-new", hidden: true });
  board.box = h("div", { class: "today board-today" });
  board.startingEl = h("div", { class: "board-starting", hidden: true });
  board.scroll = h("div", { class: "board-scroll", tabindex: "-1" }, board.slot, board.startingEl, board.box);
  board.el = h("div", { class: "tasks-board" }, board.head, board.scroll);
  // Wherever the keys go on the board (j / k, a click, Tab), that card is
  // the one lit, and kept: back from a chat, a sheet, a redraw, there again.
  board.box.addEventListener("focusin", (e) => {
    const t = e.target.closest(".tcard, details.tsec > summary");
    const stop = t && (t.matches("summary") ? t : t.querySelector(":scope > .today-go"));
    if (stop) boardSelect(stop);
    uiInner(board.box, t && t.matches(".tcard") && cardInside(t).includes(e.target) ? e.target : null);
  });
  // A click puts the keys where it was, as on any browser: Safari leaves
  // them where they were (a button clicked isn't focused), even in a box
  // that's gone, and j / k stopped working until the app was opened again.
  board.box.addEventListener("click", (e) => {
    if (document.querySelector(".sheet-back, .picker-back, .ui-dropdown")) return;      // what it opened has the keys now (a sheet, the tour)
    const b = e.target.closest("button, a[href], summary");
    const go = b && board.box.contains(b) ? b : (e.target.closest(".tcard") || {}).querySelector?.(":scope > .today-go");
    if (go && document.activeElement !== go && go.isConnected && shown(go)) go.focus({ preventScroll: true });
  });
  // Its keys wherever the keyboard is (nothing focused, too), while it's up
  // (not under a chat open over it: the chat's are its own).
  window.addEventListener("keydown", (e) => { if (!openId()) boardKeys(e); });
  // Back in the window (a screenshot, another app): the keys where they were.
  window.addEventListener("focus", () => {
    const a = document.activeElement;
    if (!desk.current && (!a || a === document.body || !a.isConnected || !shown(a))) boardRefocus();
  });
  // The search it had, over an update (app.js keepForReload).
  if (typeof kept !== "undefined" && kept && kept.search) { board.search.value = kept.search; boardSearch(kept.search); }
  return board.el;
}

// ---- the card the keys are on
//
// Always one, lit (.ui-sel), whatever the browser does with its focus: a
// click on nothing, a button Safari doesn't focus, a box that closed, the
// window left and back, a card gone. It's the board's, not the browser's:
// j / k go on from the one lit, Enter opens it, x completes it. Each tab
// has its own (Chats, Tasks, a search), kept by its chat's id (a task, a
// group's head: by its place, its group), the one in its place once it's
// gone, the first to begin with.

// Where the keys are: Chats, Tasks, or what a search found.
function selSlot() { return board.query ? "search" : board.tab; }

// A stop, as the keys find it again: a card by its chat's id, else its
// place among the cards; a group's head by its group. among: where to count.
function stopKey(stop, among) {
  if (stop.matches("summary")) return `@${[...stop.parentElement.classList].find((c) => c.startsWith("today-")) || ""}`;
  const card = stop.closest(".tcard");
  return card.dataset.id || `#${among.indexOf(card)}`;
}

// The stop a key is, in roots (the board, or what it's about to show).
function stopIn(key, roots) {
  const all = (sel) => roots.flatMap((r) => (r.nodeType === 1 ? [...(r.matches(sel) ? [r] : []), ...r.querySelectorAll(sel)] : []));
  if (key[0] === "@") return all("details.tsec > summary").find((x) => x.parentElement.classList.contains(key.slice(1))) || null;
  const card = key[0] === "#" ? all(".tcard")[Number(key.slice(1))] : all(`.tcard[data-id="${CSS.escape(key)}"]`)[0];
  return (card && card.querySelector(":scope > .today-go")) || null;
}

// The keys on this stop now (a card's head, a group's head).
function boardSelect(stop) {
  const stops = boardStops();
  if (!stops.includes(stop)) return;
  board.sel[selSlot()] = { key: stopKey(stop, [...board.box.querySelectorAll(".tcard")]), at: stops.indexOf(stop) };
  boardMark();
}

// The keys on a chat's card, as it's opened or left (the board drawn again then).
function boardSelectId(id) {
  board.sel[selSlot()] = { key: id, at: (board.sel[selSlot()] || {}).at || 0 };
}

// The stop the keys are on: kept; in a folded group, its head; gone, the one
// in its place; at first, the first card. Null while the board isn't in sight.
function boardSel() {
  if (!board.box || !board.box.isConnected || desk.current) return null;
  const stops = boardStops();
  if (!stops.length) return null;
  const s = board.sel[selSlot()];
  if (!s) return stops.find((x) => x.matches(".today-go")) || stops[0];
  if (stops[s.at] && stopKey(stops[s.at], [...board.box.querySelectorAll(".tcard")]) === s.key) return stops[s.at];
  const el = stopIn(s.key, [board.box]);
  if (el && shown(el)) return el;
  // In a folded group: that group's head (the outermost folded).
  let fold = el ? el.closest("details:not([open])") : null;
  while (fold && fold.parentElement && fold.parentElement.closest("details:not([open])")) fold = fold.parentElement.closest("details:not([open])");
  const head = fold && fold.querySelector(":scope > summary");
  if (head && shown(head)) return head;
  return stops[Math.min(s.at, stops.length - 1)];
}

// The one the keys are on, lit (and kept as it is now: one in its place
// is the one then). Its stop.
function boardMark() {
  const stop = boardSel();
  if (!stop) return null;
  const lit = stop.matches("summary") ? stop : stop.closest(".tcard");
  for (const x of board.box.querySelectorAll(".ui-sel")) if (x !== lit) x.classList.remove("ui-sel");
  lit.classList.add("ui-sel");
  board.sel[selSlot()] = { key: stopKey(stop, [...board.box.querySelectorAll(".tcard")]), at: boardStops().indexOf(stop) };
  return stop;
}

// What the board is about to show, lit as it will be: a card drawn again
// the same is the same (todayPatch keeps it, not swapped for its light).
function boardMarkIn(nodes) {
  const s = board.sel[selSlot()];
  for (const n of nodes) if (n.nodeType === 1) for (const x of [...(n.matches(".ui-sel") ? [n] : []), ...n.querySelectorAll(".ui-sel")]) x.classList.remove("ui-sel");
  const stop = s && stopIn(s.key, nodes);
  if (stop) (stop.matches("summary") ? stop : stop.closest(".tcard")).classList.add("ui-sel");
}

// What j / k go through: each card in sight (its head), and the head of a
// group that folds (Enter unfolds it).
function boardStops() {
  return [...board.box.querySelectorAll(".tcard > .today-go, details.tsec > summary")].filter(shown);
}

// The keys to a card (its head), in sight.
function boardFocus(el, smooth) {
  if (!el) return;
  boardSelect(el);
  el.focus({ preventScroll: true });
  uiReveal(el, { scroller: board.scroll, smooth });
}

// Back on the board (from a chat, a sheet, another window): the keys on
// the card lit (boardSel).
function boardRefocus() {
  if (desk.current || !board.box) return;
  const a = document.activeElement;
  // On something of the board's already (the search, a tab, a card): there.
  if (a && board.el.contains(a) && a !== board.scroll && shown(a)) return boardMark();
  const go = boardMark();
  if (go) boardFocus(go);
  else board.scroll.focus({ preventScroll: true });
}

// A card's own buttons and links, in order (not its head: that's the card).
function cardInside(card) {
  return card ? [...card.querySelectorAll("button, a[href], input, textarea")].filter((b) => !b.matches(".today-go") && !b.disabled && shown(b)) : [];
}

// The board's keys (none while you type, or a sheet is up): they only move,
// as everywhere. What does something is Ctrl+Alt + a key (desk.js), from
// anywhere; Esc stops a chat, and on the board there's none to stop.
function boardKeys(e) {
  if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
  if (document.querySelector(".sheet-back, .picker-back, .ui-dropdown, .mission")) return;
  // A box you type in, if it's still there to type in: Safari keeps the
  // keys in the chat's box after it closed (sent, back on the board).
  const typing = e.target.closest("textarea, input, select, [contenteditable]");
  if (typing && typing.isConnected && shown(typing)) return;
  if (typing) typing.blur();
  const stops = boardStops();
  let at = stops.findIndex((b) => b === document.activeElement || (b.matches(".today-go") && b.parentElement.contains(document.activeElement)));
  // The browser's focus elsewhere (a click on nothing, a tab, a box gone,
  // the window left and back): the keys go on from the card lit.
  const focused = at >= 0;
  if (!focused) at = stops.indexOf(boardSel());
  const card = at >= 0 && stops[at].matches(".today-go") ? stops[at].closest(".tcard") : null;
  const to = (i) => { e.preventDefault(); boardFocus(stops[Math.max(0, Math.min(stops.length - 1, i))]); };
  const k = e.key;
  // A card is a row: l (→) goes into it, along its buttons; h (←) back,
  // out of it from its first. Enter presses the one you're on.
  const inside = cardInside(card);
  // On a button in it, or the focus off it: the one lit in it (uiInner).
  let on = inside.indexOf(document.activeElement);
  if (on < 0 && !focused) on = inside.indexOf(uiInnerOf(card, inside));
  const into = (b) => { e.preventDefault(); b.focus({ preventScroll: true }); uiInner(board.box, inside.includes(b) ? b : null); uiReveal(b, { scroller: board.scroll }); };
  // Enter, the focus off the card: the button lit in it pressed, else the card opens
  // (on a button, a tab, the browser presses that).
  if (k === "Enter" && !focused && at >= 0 && !document.activeElement.closest("button, a[href], summary, input, textarea, select")) {
    e.preventDefault();
    const b = on >= 0 ? inside[on] : stops[at];
    if (on >= 0) b.focus({ preventScroll: true }); else boardFocus(b);
    return b.click();
  }
  if (k === "l" || k === "ArrowRight") return inside.length ? into(inside[Math.min(on + 1, inside.length - 1)]) : e.preventDefault();
  if (k === "h" || k === "ArrowLeft") return on >= 0 ? into(on === 0 ? stops[at] : inside[on - 1]) : e.preventDefault();
  // Tab: Chats | Tasks, the other one (Shift+Tab too).
  if (k === "Tab") { e.preventDefault(); return boardTab(BOARD_TABS[(BOARD_TABS.indexOf(board.tab) + (e.shiftKey ? BOARD_TABS.length - 1 : 1)) % BOARD_TABS.length]); }
  if (k === "j" || k === "ArrowDown") to(at < 0 ? 0 : at + 1);
  else if (k === "k" || k === "ArrowUp") to(at < 0 ? 0 : at - 1);
  else if (k === "g" || k === "Home") to(0);
  else if (k === "G" || k === "End") to(stops.length - 1);
  else if (k === "/") { e.preventDefault(); board.search.focus(); board.search.select(); }
  else if (!card) return;
  // An answer's number picks it on its card, as on Claude's own menu.
  else if (/^[1-9]$/.test(k)) {
    const o = card.querySelectorAll(".today-opt")[Number(k) - 1];
    if (o) { e.preventDefault(); o.click(); }
  }
}

// The board's tabs, Chats and Tasks, each with what's your move.
function modeButtons() {
  if (!app.view || !board.switchEl) return;
  uiTabs([{ key: "chats", label: "Chats", count: todayCount(app.view, "chats"), title: "Chats (Tab)" },
          { key: "tasks", label: "Tasks", count: todayCount(app.view, "tasks"), title: "Tasks (Tab)" }], board.tab, boardTab, board.switchEl);
}

// Chats or Tasks on the board, kept for the next time.
function boardTab(tab) {
  // Tasks again, a board open there: back to Tasks' list.
  if (tab === "tasks" && board.tab === "tasks" && typeof boardsUI !== "undefined" && boardsUI.open) return boardsClose();
  board.tab = BOARD_TABS.includes(tab) ? tab : "chats";
  store.set("board-tab", board.tab);
  if (desk.current) boardBack(true);
  board.scroll.scrollTop = 0;
  // The keys off the card they were on: the other tab's cards aren't the
  // same (keepFocus would put them on whatever is in its place), boardRefocus
  // puts them on the one lit there (where you left that tab, else its first).
  if (board.box.contains(document.activeElement)) board.scroll.focus({ preventScroll: true });
  if (board.query) boardSearchDraw(); else boardFill();      // (the tab is in its key: drawn, or as it was)
  modeButtons();
  boardRefocus();
  const go = boardMark();
  if (go) uiReveal(go, { scroller: board.scroll });
}

// #/tasks (a task's notification, tapped): the board on Tasks, its address
// the board's again (so the next one is a change of address too).
function boardTasks() {
  if (boardsUI.open) boardsClose();
  boardTab("tasks");
  if (standalone) routed.hash = "#/today";
  else history.replaceState(null, "", `${location.pathname}${location.search}#/today`);
}

// An empty amarchy: no project and no chat yet (the board is the welcome).
function boardEmpty(v = app.view) {
  return !!v && !v.sessions.length && !(v.projects || []).length;
}

// The board drawn: Today's queue, or with no project yet the welcome. top:
// where it's to be scrolled (else where it is).
function boardFill(force, top = null) {
  const v = app.view;
  if (boardEmpty(v)) {
    if (board.box.dataset.key !== "welcome") board.box.replaceChildren(welcome((p) => newChatIn(p)));
    board.box.dataset.key = "welcome";
    tourAuto();      // the first time on this device: the tour, over it (tour.js)
    return;
  }
  todayFill(board.box, force, top);
}

// The view changed (app.js refresh).
function boardRefresh(force) {
  if (!board.box) return;
  if (board.waitFor && row(board.waitFor)) {
    const id = board.waitFor;
    board.waitFor = null;
    boardOpen(id);
  }
  // Projects and no chat yet: the new chat's box, the way to start one.
  const v = app.view;
  if (v && !v.sessions.length && (v.projects || []).length && !board.composing && !desk.current) { board.composing = true; boardComposeShow(); }
  else if (board.composing && desk.newChat) desk.newChat.update();      // its projects, its model, as the list has them now
  if (board.query) boardSearchDraw();
  else boardFill(force);
  if (board.starting && board.starting.length) boardStarting();      // a chat you started, up: its own card now
  // The first time it's drawn, the keys on its first card: they work at
  // once. With keys (a computer): on a phone, a ring on a card nobody's
  // keys are on.
  if (!board.keyed && v && !desk.current && !board.composing && boardStops().length) {
    board.keyed = true;
    const keys = app.desk || matchMedia("(pointer: fine)").matches;
    if (keys && (!document.activeElement || document.activeElement === document.body || document.activeElement === board.scroll)) boardRefocus();
  }
  modeButtons();
}

// A ticket: Today's card, as it is.
function boardTicket(s, node) {
  return h("div", { class: "ticket", "data-id": s.id }, node);
}

// A chat over the board, the whole window (desk.js show), its address the
// chat's (the browser's Back is the board's). On the phone, its own screen
// (app.js SessionView); back, the board where it was.
function boardOpen(id) {
  if (!row(id)) return;
  if (!app.desk) {
    board.from = board.scroll.scrollTop;
    boardSelectId(id);
    app.fromToday = id;
    return go(`#/s/${encodeURIComponent(id)}`);
  }
  show(id);
  if (here() !== `#/s/${encodeURIComponent(id)}`) go2(id);
}

// The board again (desk.js show(null), the phone back from a chat): drawn,
// where it was scrolled.
function boardShown() {
  const from = typeof board.from === "number" ? board.from : null;
  board.from = null;
  // As it was, unless something changed meanwhile; drawn where it was (not
  // laid out first to ask where it is, as it was before it showed).
  if (board.query) boardSearchDraw(); else boardFill(false, from);
  modeButtons();
  if (from !== null) board.scroll.scrollTop = from;
  boardMark();
}

// Back to the board, where you were, on the card you opened.
function boardBack(quiet) {
  if (!desk.current) return;
  const id = desk.current;
  show(null);
  if (/^#\/s\//.test(here())) go("#/today");
  boardSelectId(id);
  boardMark();
  if (!quiet) boardRefocus();
}

// You sent it something (a message, an answer, an approval): it works on
// it, you're back on the board, and the next that's your move is lit, the
// keys on it (Enter opens it).
function boardSent(id) {
  todayAnswered(id);
  boardBack(true);
  const next = [...board.box.querySelectorAll(".today-yours .ticket")].find((t) => t.dataset.id !== id);
  boardSentToast(id);
  if (!next) return boardRefocus();
  next.classList.add("next");
  setTimeout(() => next.classList.remove("next"), 2400);
  uiReveal(next, { scroller: board.scroll, block: "center", smooth: true });
  const btn = next.querySelector(".today-go");
  if (btn) btn.focus({ preventScroll: true });
}

// Sent: how much more waits on you.
function boardSentToast(id) {
  const left = [...board.box.querySelectorAll(".today-yours .ticket")].filter((t) => t.dataset.id !== id).length;
  toast(left ? `Sent. ${left} more for you` : "Sent. Nothing else waits on you");
}

// New chat: first where it works. Your projects, in your order, the last
// one you used lit: Enter (or a tap) and you're in the box, in that one,
// to say what to do. Type to narrow them; a new project from here too.
// One project (or none yet): straight to the box.
function boardNew() {
  const ps = whereProjects();         // every machine's (machines.js)
  if (ps.length < 2) return boardCompose();
  const last = (desk.newChat && desk.newChat.repo()) || store.get("last-project");
  const lit = ps.some((p) => p.name === last) ? last : ps[0].name;
  uiMenu("New chat: which project?", [
    ...ps.map((p) => ({ label: projectName(p.name), icon: "project", on: p.name === lit,
                        detail: p.sessions ? `${p.sessions} chat${p.sessions === 1 ? "" : "s"}` : "",
                        act: () => newChatIn(p.name) })),
    { label: "New project…", icon: "plus", always: true,
      act: () => (app.desk ? newProject() : newProjectSheet((p) => newChatIn(p))) }],
  { search: "Project" });
}

// The new chat's box at the top of the board (what you were writing stays).
function boardCompose() {
  if (!app.desk && app.session) go("#/");
  if (desk.current) boardBack(true);
  board.composing = true;
  boardComposeShow();
  board.scroll.scrollTop = 0;
  if (desk.newChat) desk.newChat.focus();
}

function boardComposeShow() {
  if (!board.slot) return;
  // Started: the box goes, the board stays (the chat is at work on it).
  if (board.composing && !desk.newChat) desk.newChat = newChat({ wide: !!app.desk, starting: boardStarting, started: () => {
    board.composing = false;
    boardComposeShow();
    boardRefocus();
  }, failed: () => boardCompose() });
  board.slot.hidden = !board.composing;
  if (board.composing) {
    if (!board.slot.contains(desk.newChat.el)) board.slot.replaceChildren(desk.newChat.el, h("button", { class: "text-btn board-new-close", type: "button",
      title: "Esc", onclick: () => leaveNewChat() }, "Not now"));
    desk.newChat.update();
  } else if (desk.newChat && board.slot.contains(desk.newChat.el)) board.slot.replaceChildren();
}

// A chat you started, while the server sets it up: its card at the top of
// the board, "Starting…", until the chat's own is there (its row in the
// list, set up: Today leaves out one still being set up), in the same
// redraw. With no job: the list changed (boardRefresh), the ones up go.
function boardStarting(job, on) {
  const was = board.starting || [];
  board.starting = was.filter((j) => j !== job);
  if (job && on) board.starting.unshift(job);
  board.starting = board.starting.filter((j) => { const s = j.id && row(j.id); return !s || s.setup; });
  if (!board.startingEl || (board.starting.length === was.length && board.starting.every((j, i) => j === was[i]))) return;
  board.startingEl.replaceChildren(...board.starting.map((j) => uiCard({ kind: "fresh", hue: todayHue(j.repo), chip: projectName(j.repo),
    title: cut(j.text.trim().split("\n")[0], 90), pill: uiPill("Starting…", "working"),
    open: () => toast("Starting: its worktree is being made, a moment") })));
  board.startingEl.hidden = !board.starting.length;
}

// ---- search: a chat by its name, or by anything said in it
//
// The box in the middle of the bar (/ to get there). As you type, the board
// shows the chats that have every word: in their name at once, and in what
// was said in them from the host (/api/search, bin/amarchy search_chats),
// with the lines that have them. Enter opens the first; Esc empties it.

function boardSearchBox() {
  const box = uiSearch({ cls: "board-search", label: "Search chats, what was said in them, your tasks", input: {
    oninput: () => boardSearch(board.search.value),
    onkeydown: (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); board.search.value = ""; boardSearch(""); board.scroll.focus(); }
      else if (e.key === "Enter") { e.preventDefault(); const first = board.box.querySelector(".today-go"); if (first) first.click(); else board.search.blur(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); const first = board.box.querySelector(".today-go"); if (first) first.focus(); }
    } } });
  board.search = box.field;
  return box;
}

// What it found stays drawn while you type on, "Searching…" over it until
// the host answers for what you typed (the one asked before let go).
let searchTimer = null, searchAsk = null;
function boardSearch(q) {
  if (q.trim() !== board.query) board.sel.search = null;      // what it finds now: from its first
  board.query = q.trim();
  clearTimeout(searchTimer);
  if (searchAsk) searchAsk.abort();
  searchAsk = null;
  board.el.classList.toggle("searching", !!board.query);
  if (!board.query) { board.found = null; boardFill(true); return; }
  boardSearchDraw();
  searchTimer = setTimeout(async () => {
    const ask = searchAsk = new AbortController(), asked = board.query;
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(asked)}`, { headers: { Accept: "application/json" }, signal: ask.signal });
      const d = await r.json();
      if (ask.signal.aborted || asked !== board.query) return;      // you typed on
      // Each chat found by its key (another machine's: <machine>:<id>).
      const results = (d.results || []).map((x) => ({ ...x, id: chatKeyOf(x.machine, x.id) }));
      board.found = r.ok ? { q: asked, results } : { q: asked, results: [], error: d.error || "Amarchy didn't answer" };
    } catch (e) {
      if (ask.signal.aborted) return;
      board.found = { q: asked, results: [], error: "Can't reach Amarchy" };
    }
    if (searchAsk === ask) searchAsk = null;
    boardSearchDraw();
  }, 60);
}

// A text with the words lit.
function lit(text, words) {
  const t = String(text || ""), low = t.toLowerCase();
  const on = new Array(t.length).fill(false);
  for (const w of words) for (let i = low.indexOf(w); w && i >= 0; i = low.indexOf(w, i + w.length)) on.fill(true, i, i + w.length);
  let html = "", open = false;
  for (let i = 0; i < t.length; i++) {
    if (on[i] !== open) { html += on[i] ? "<mark>" : "</mark>"; open = on[i]; }
    html += esc(t[i]);
  }
  return open ? `${html}</mark>` : html;
}

function boardSearchDraw() {
  const v = app.view;
  if (!v || !board.query) return;
  const words = board.query.toLowerCase().split(/\s+/).filter(Boolean);
  const named = (s) => { const n = [s.task, s.claude_title, s.repo, s.name, s.assistant_name].join(" ").toLowerCase(); return words.every((w) => n.includes(w)); };
  // The host's answer for what you typed, else the one before (still in
  // sight, not a page gone blank at each key) until it comes.
  const answered = !!board.found && board.found.q === board.query;
  const found = board.found ? board.found.results : null;
  // Its name has them now; what was said, once the host answers.
  const byId = new Map((found || []).map((r) => [r.id, r]));
  const rows = [...(found || []).map((r) => r.id), ...v.sessions.filter((s) => named(s) && !byId.has(s.id)).map((s) => s.id)]
    .map((id) => row(id)).filter(Boolean);
  // Your tasks that have them too (who and what; an agent's: it, what, its note), first on the Tasks tab.
  const loops = ((v.today && v.today.loops) || []).filter((l) => { const t = `${l.who} ${l.what}`.toLowerCase(); return words.every((w) => t.includes(w)); });
  const theirs = boardsFound(v, words);
  // Drawn again only when what it shows changed: the list comes every
  // second while chats work, and the same cards stay as they are.
  const key = `search|${JSON.stringify([board.tab, board.query, answered, board.found, todayUI.version, rows.map((s) => [todayRowKey(s), todayTimes(s)]), loops, theirs.map(({ b, c }) => [b.key, c, boardsKey()]),
    ((v.today || {}).assistant || {}).name, (v.today || {}).sent, (found || []).map((r) => (r.at ? autoPast(r.at) : ""))])}`;
  if (board.box.dataset.key === key) return;
  const cards = rows.map((s) => {
    const r = byId.get(s.id);
    const lines = (r && r.lines) || [];
    const name = isAgent(s) ? teamName(s) : s.task || "New chat";
    return boardTicket(s, uiCard({ kind: "search", hue: todayHue(s.repo), chip: todayChip(s), id: s.id,
      title: h("span", { class: "task", html: lit(name, words) }), lead: isAgent(s) ? avatar(s, "small") : null,
      pill: todayStatePill(s), open: () => boardOpen(s.id),
      body: [r && r.hits ? h("p", { class: "tcard-text muted" }, `${r.hits} message${r.hits === 1 ? "" : "s"}${r.at ? ` · last ${autoPast(r.at)}` : ""}`) : null,
             ...lines.map((l) => h("p", { class: "tcard-text found" }, h("span", { class: `found-who ${l.who}` }, l.who === "you" ? "You" : "Claude"),
               h("span", { html: lit(l.text, words) })))] }));
  });
  const taskCards = [...theirs.map(({ b, c }) => boardsCard(b, c, { list: true })), ...loops.map((l) => todayLoop(l, v))];
  const chatsSec = cards.length ? uiSection("found-chats", "Chats", { count: cards.length }, cards) : null;
  const tasksSec = taskCards.length ? uiSection("found-tasks", "Tasks", { count: taskCards.length }, taskCards) : null;
  const n = rows.length + taskCards.length;
  // A count once it's the host's for what you typed: before, it isn't one yet.
  const head = h("div", { class: "today-summary" }, !answered ? `Searching “${board.query}”…`
    : board.found.error || `${n || "Nothing"} with “${board.query}”`);
  keepFocus(board.box, () => board.box.replaceChildren(head, ...(board.tab === "tasks" ? [tasksSec, chatsSec] : [chatsSec, tasksSec]).filter(Boolean),
    ...(!n && answered && !board.found.error ? [h("p", { class: "today-clear" }, "Nothing has that, in a name, in what was said or in your tasks. Fewer words find more.")] : [])));
  board.box.dataset.key = key;
  boardMark();      // (not Today's: Today draws itself again when the search is emptied)
}
