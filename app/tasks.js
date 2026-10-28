// ---- Tasks: your chats as tickets, the whole window (a computer's)
//
// The other way to work on a computer, beside Chats (the list on the left,
// one chat in the middle): no list, only Today's queue (today.js) with every
// chat a ticket: its project, its state, its goal and what it last said,
// with what it asks you as buttons. Opened (a click, Enter), the chat takes
// the whole window, live (chat.js): answer, approve, write. Back (the
// button, Esc) is the board again, where you were; and so is sending it
// something: it works on that, and the next that's your move is lit, Enter
// to open it.
//
// Keys on the board: j / k (or the arrows) from ticket to ticket, Enter
// opens, 1-4 picks an answer, x closes (with Undo), n a new chat.
// The switch: Tasks | Chats over the board, Tasks over the list in Chats,
// Ctrl+Alt+H. The app opens on the one you used last (Tasks at first).

const board = {
  el: null, box: null, head: null, slot: null, focusEl: null,
  open: null,        // the chat open over the board
  chat: null,        // its Chat
  composing: false,  // the new chat's box at the top
  waitFor: null,     // a chat just started: opened once the list has it
  tab: "chats",      // Chats (your chats) or Tasks (your loops): the one you were on (boardBuild)
  query: "",         // what the search box has: the board shows what it finds instead of Today
  found: null,       // the server's answer for it: {q, results}
};

// In sight: not in a folded part (a closed <details> keeps its boxes, hidden).
function shown(el) { return el.checkVisibility ? el.checkVisibility() : !el.closest("details:not([open]) > :not(summary)"); }

// The chat the keys go to: the open one in Tasks, the middle's in Chats.
function chatNow() { return boardOn() ? board.chat : desk.chat; }

function boardBuild() {
  if (board.el) return board.el;
  board.tab = store.get("board-tab") === "tasks" ? "tasks" : "chats";
  board.switchEl = h("div", { class: "seg board-switch", role: "tablist" });
  board.head = h("header", { class: "board-head" },
    h("div", { class: "board-head-in" },
      board.switchEl,
      boardSearchBox(),
      boardOrganize(),
      h("button", { class: "control", type: "button", title: "New chat (n, Ctrl+Alt+N)", onclick: () => boardCompose() }, glyph("plus"), "New chat"),
      automationsButton("control organize"),
      // The standard layout: the list on the left, a chat beside it.
      h("button", { class: "control organize board-classic", type: "button", title: "The list and a chat beside it (Ctrl+Alt+H)",
                    "aria-label": "The list and a chat", onclick: () => deskMode("chats") }, glyph("project")),
      h("button", { class: "control organize", type: "button", title: "Settings (right click or Ctrl+Alt+M: the Amarchy menu)", "aria-label": "Settings",
                    onclick: () => openSettings(), oncontextmenu: (e) => { e.preventDefault(); deskMenu(); } }, glyph("gear"))));
  board.slot = h("div", { class: "board-new", hidden: true });
  board.box = h("div", { class: "today board-today" });
  board.scroll = h("div", { class: "board-scroll", tabindex: "-1" }, board.slot, board.box);
  board.focusEl = h("div", { class: "board-focus", hidden: true });
  board.el = h("div", { class: "tasks-board" }, board.head, board.scroll, board.focusEl);
  // Its keys wherever the keyboard is (nothing focused, too), while it's up;
  // Esc over an open chat before the chat has it (there it would stop Claude).
  window.addEventListener("keydown", (e) => { if (boardOn()) boardKeys(e); });
  window.addEventListener("keydown", (e) => { if (boardOn() && board.open) boardEsc(e); }, true);
  return board.el;
}

// The board's keys (none while you type, or a sheet is up).
function boardKeys(e) {
  if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
  if (document.querySelector(".sheet-back, .picker-back")) return;
  const typing = e.target.closest("textarea, input, [contenteditable]");
  if (board.open) return;      // (its Esc: boardEsc)
  if (typing) return;
  if (e.key === "/") { e.preventDefault(); board.search.focus(); board.search.select(); return; }
  const goes = [...board.box.querySelectorAll(".ticket > * > .today-go")].filter(shown);      // not in a folded part
  const at = goes.findIndex((b) => b === document.activeElement || b.parentElement.contains(document.activeElement));
  const ticket = at >= 0 ? goes[at].closest(".ticket") : null;
  const move = (d) => {
    const next = goes[Math.max(0, Math.min(goes.length - 1, at < 0 ? 0 : at + d))];
    if (next) { next.focus(); next.scrollIntoView({ block: "nearest" }); }
  };
  if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
  else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
  else if (e.key === "n") { e.preventDefault(); boardCompose(); }
  else if (/^[1-4]$/.test(e.key) && ticket) {
    const opts = ticket.querySelectorAll(".today-opt");
    const o = opts[Number(e.key) - 1];
    if (o) { e.preventDefault(); o.click(); }
  } else if (e.key === "x" && ticket) {
    const s = row(ticket.dataset.id);
    if (s && s.assistant !== "main") { e.preventDefault(); todayClose(s); }
  }
}

// Esc over an open chat: back to the board, always (what you were writing
// stays, as a chat's draft does). But for what Esc does first: stop a
// dictation, close a menu or a sheet.
function boardEsc(e) {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (document.querySelector(".sheet-back, .picker-back")) return;
  const c = board.chat;
  if (c && (c.talk.on() || c.menu)) return;
  e.preventDefault();
  e.stopPropagation();
  boardBack();
}

// The board's tabs, Chats and Tasks, each with what's your move; and over
// the list in the standard layout, the way back to the board.
function modeButtons() {
  if (!app.view) return;
  const count = (only) => { const n = todayCount(app.view, only); return n ? h("span", { class: "tab-count" }, String(n)) : ""; };
  if (board.switchEl) {
    const side = (tab, label) => h("button", { class: `control${board.tab === tab ? " on" : ""}`, type: "button", role: "tab",
                                               "aria-selected": String(board.tab === tab), onclick: () => boardTab(tab) }, label, count(tab));
    board.switchEl.replaceChildren(side("chats", "Chats"), side("tasks", "Tasks"));
  }
  if (desk.todayBtn) desk.todayBtn.replaceChildren("Board", count());
}

// Chats or Tasks on the board, kept for the next time.
function boardTab(tab) {
  board.tab = tab === "tasks" ? "tasks" : "chats";
  store.set("board-tab", board.tab);
  if (board.open) boardBack(true);
  board.scroll.scrollTop = 0;
  if (board.query) boardSearchDraw(); else todayFill(board.box, true);
  modeButtons();
}

// Tasks or Chats, kept for the next time the app opens.
function deskMode(mode) {
  if (mode !== "tasks" && mode !== "chats") return;
  desk.mode = mode;
  store.set("desk-mode", mode);
  desk.el.classList.toggle("tasks-mode", mode === "tasks");
  if (mode === "tasks") {
    boardRefresh(true);
    requestAnimationFrame(() => { if (!board.open) board.scroll.focus({ preventScroll: true }); });
  } else {
    boardBack(true);
    board.composing = false;
    deskLayout();
    deskList();
    deskRefocus();
  }
  modeButtons();
}

// The view changed (app.js refresh).
function boardRefresh(force) {
  if (!board.box) return;
  if (board.open && app.view && !row(board.open)) boardBack(true);     // closed
  if (board.waitFor && row(board.waitFor)) {
    const id = board.waitFor;
    board.waitFor = null;
    boardOpen(id);
  }
  if (board.query) boardSearchDraw();
  else todayFill(board.box, force);
  if (board.organize && !board.organize.hidden) keepFocus(board.organize, () => board.organize.replaceChildren(...organizeMenu()));
  if (board.open) boardFocusHead();
  modeButtons();
}

// A route in Tasks (desk.js deskRoute): a chat's opens it, a new chat's the
// box at the top. true when it took it.
function boardRoute() {
  if (!boardOn()) return false;
  const m = here().match(/^#\/s\/(.+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    board.composing = false;
    boardComposeShow();
    if (row(id)) { if (board.open !== id) boardOpen(id); }
    else board.waitFor = id;      // just started: once the list has it
    return true;
  }
  if (here() === "#/new") { boardCompose(); return true; }
  return true;      // (an open chat stays: Back, Esc or sending it something closes it)
}

// A ticket: Today's row or card, as it is.
function boardTicket(s, node) {
  return h("div", { class: "ticket", "data-id": s.id }, node);
}

// The chat over the board, the whole window: a bar (Back, its project and
// name, its state; Open in Chats, Close chat), and the chat, its box ready.
function boardOpen(id) {
  const s = row(id);
  if (!s) return;
  if (board.chat) board.chat.close();
  board.from = board.open ? board.from : board.scroll.scrollTop;
  const chat = new Chat({ id, row: s, noSwitch: true,
                          onGone: (why) => { if (!why && board.chat === chat) boardBack(true); },
                          onSession: () => { if (board.chat === chat) boardFocusHead(); },
                          onSent: () => { if (board.chat === chat) boardSent(id); } });
  board.open = id;
  board.chat = chat;
  board.focusHead = h("div", { class: "board-focus-head" });
  board.focusEl.replaceChildren(board.focusHead, h("div", { class: "board-focus-chat" }, chat.el));
  board.focusEl.hidden = false;
  board.el.classList.add("focused");
  boardFocusHead();
  chat.open();
  api(`/api/session/${encodeURIComponent(id)}/seen`).catch(() => {});
  requestAnimationFrame(() => {
    chat.grow();
    if (chat.dock.contains(chat.input)) chat.input.focus({ preventScroll: true });
  });
}

function boardFocusHead() {
  const s = board.open && row(board.open);
  if (!s || !board.focusHead) return;
  const btn = (label, act, cls = "") => h("button", { class: `text-btn ${cls}`, type: "button", onclick: act }, label);
  keepFocus(board.focusHead, () => board.focusHead.replaceChildren(...[      // (filtered: replaceChildren writes a null as "null")
    h("button", { class: "control board-back", type: "button", title: "Back to Tasks (Esc)", onclick: () => boardBack() }, glyph("back"), "Back"),
    // Its card's head, as on the board: its project in its color, its name, its badge.
    s.assistant === "main" ? avatar(s, "small") : h("span", { class: `tcard-chip ph-${todayHue(s.repo)}` }, todayChip(s)),
    h("span", { class: "tcard-title" }, taskText(s.assistant === "main" ? s.assistant_name || "Assistant" : s.task || "New chat")),
    todayStatePill(s),
    h("span", { class: "board-gap" }),
    btn("Open in Chats", () => { const id = s.id; deskMode("chats"); go2(id); }),
    s.assistant === "main" ? null : btn("Complete mission ✓", () => { boardBack(true); todayComplete(s); }, "complete")].filter(Boolean)));
}

// Back to the board, where you were, on the ticket you opened.
function boardBack(quiet) {
  if (!board.open) return;
  const id = board.open;
  if (board.chat) board.chat.close();
  board.chat = board.open = board.focusHead = null;
  board.focusEl.hidden = true;
  board.focusEl.replaceChildren();
  board.el.classList.remove("focused");
  if (/^#\/s\//.test(here())) go("#/today");
  if (board.query) boardSearchDraw(); else todayFill(board.box, true);
  if (typeof board.from === "number") board.scroll.scrollTop = board.from;
  if (!quiet) {
    const t = board.box.querySelector(`.ticket[data-id="${CSS.escape(id)}"] .today-go`);
    if (t) t.focus({ preventScroll: true });
  }
}

// You sent it something (a message, an answer, an approval): it works on
// it, you're back on the board, and the next that's your move is lit, the
// keys on it (Enter opens it).
function boardSent(id) {
  todayAnswered(id);
  boardBack(true);
  const next = [...board.box.querySelectorAll(".today-yours .ticket")].find((t) => t.dataset.id !== id);
  const left = board.box.querySelectorAll(".today-yours .ticket").length;
  toast(left ? `Sent. ${left} more for you` : "Sent. Nothing else waits on you");
  if (!next) return;
  next.classList.add("next");
  setTimeout(() => next.classList.remove("next"), 2400);
  next.scrollIntoView({ block: "center", behavior: "smooth" });
  const btn = next.querySelector(".today-go");
  if (btn) btn.focus({ preventScroll: true });
}

// The new chat's box at the top of the board (the same one as Chats' middle:
// what you were writing stays).
function boardCompose() {
  if (board.open) boardBack(true);
  board.composing = true;
  boardComposeShow();
  board.scroll.scrollTop = 0;
  if (desk.newChat) desk.newChat.focus();
}

function boardComposeShow() {
  if (!board.slot) return;
  if (board.composing && !desk.newChat) desk.newChat = newChat({ wide: true, started: (id) => {
    desk.pending = { id, until: Date.now() + 15000 };
    go2(id);
  } });
  board.slot.hidden = !board.composing;
  if (board.composing) {
    board.slot.replaceChildren(desk.newChat.el, h("button", { class: "text-btn board-new-close", type: "button",
      onclick: () => { board.composing = false; boardComposeShow(); } }, "Not now"));
    desk.newChat.update();
  } else if (desk.newChat && board.slot.contains(desk.newChat.el)) board.slot.replaceChildren();
}

// While a chat is open and in sight, it's seen.
setInterval(() => {
  if (boardOn() && board.open && document.visibilityState === "visible" && document.hasFocus())
    api(`/api/session/${encodeURIComponent(board.open)}/seen`).catch(() => {});
}, 10000);

// ---- search: a chat by its name, or by anything said in it
//
// The box in the middle of the bar (/ to get there). As you type, the board
// shows the chats that have every word: in their name at once, and in what
// was said in them from the host (/api/search, bin/amarchy search_chats),
// with the lines that have them. Enter opens the first; Esc empties it.

function boardSearchBox() {
  board.search = h("input", { type: "search", placeholder: "Search", "aria-label": "Search chats, what was said in them, your tasks",
                              autocomplete: "off", spellcheck: "false", enterkeyhint: "search",
                              oninput: () => boardSearch(board.search.value),
                              onkeydown: (e) => {
                                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); board.search.value = ""; boardSearch(""); board.scroll.focus(); }
                                else if (e.key === "Enter") { e.preventDefault(); const first = board.box.querySelector(".today-go"); if (first) first.click(); }
                                else if (e.key === "ArrowDown") { e.preventDefault(); const first = board.box.querySelector(".today-go"); if (first) first.focus(); }
                              } });
  return h("label", { class: "searchbox board-search" }, glyph("search"), board.search, h("kbd", { class: "board-search-key" }, "/"));
}

let searchTimer = null, searchSeq = 0;
function boardSearch(q) {
  board.query = q.trim();
  clearTimeout(searchTimer);
  board.el.classList.toggle("searching", !!board.query);
  if (!board.query) { board.found = null; todayFill(board.box, true); return; }
  boardSearchDraw();
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq, asked = board.query;
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(asked)}`, { headers: { Accept: "application/json" } });
      const d = await r.json();
      if (seq !== searchSeq || asked !== board.query) return;      // you typed on
      board.found = d;
    } catch (e) {
      board.found = { q: asked, results: [], error: "Can't reach Amarchy" };
    }
    boardSearchDraw();
  }, 160);
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
  const found = board.found && board.found.q === board.query ? board.found.results : null;
  // Its name has them now; what was said, once the host answers.
  const byId = new Map((found || []).map((r) => [r.id, r]));
  const rows = [...(found || []).map((r) => r.id), ...v.sessions.filter((s) => named(s) && !byId.has(s.id)).map((s) => s.id)]
    .map((id) => row(id)).filter(Boolean);
  const cards = rows.map((s) => {
    const r = byId.get(s.id);
    const lines = (r && r.lines) || [];
    const name = s.assistant === "main" ? s.assistant_name || "Assistant" : s.task || "New chat";
    return boardTicket(s, todayCard({ kind: "search", hue: todayHue(s.repo), chip: todayChip(s), id: s.id,
      title: h("span", { class: "task", html: lit(name, words) }), lead: s.assistant === "main" ? avatar(s, "small") : null,
      pill: todayStatePill(s), open: () => boardOpen(s.id),
      body: [r && r.hits ? h("p", { class: "tcard-text muted" }, `${r.hits} message${r.hits === 1 ? "" : "s"}${r.at ? ` · last ${autoPast(r.at)}` : ""}`) : null,
             ...lines.map((l) => h("p", { class: "tcard-text found" }, h("span", { class: `found-who ${l.who}` }, l.who === "you" ? "You" : "Claude"),
               h("span", { html: lit(l.text, words) })))] }));
  });
  // Your tasks that have them too (who and what), first on the Tasks tab.
  const loops = ((v.today && v.today.loops) || []).filter((l) => { const t = `${l.who} ${l.what}`.toLowerCase(); return words.every((w) => t.includes(w)); });
  const taskCards = loops.map((l) => todayLoop(l, v));
  const chatsSec = cards.length ? todaySection("found-chats", "Chats", { count: cards.length }, cards) : null;
  const tasksSec = taskCards.length ? todaySection("found-tasks", "Tasks", { count: taskCards.length }, taskCards) : null;
  const n = rows.length + loops.length;
  const head = h("div", { class: "today-summary" }, found || loops.length ? `${n || "Nothing"} with “${board.query}”` : `Searching “${board.query}”…`);
  keepFocus(board.box, () => board.box.replaceChildren(head, ...(board.tab === "tasks" ? [tasksSec, chatsSec] : [chatsSec, tasksSec]).filter(Boolean),
    ...(!n && found ? [h("p", { class: "today-clear" }, "Nothing has that, in a name, in what was said or in your tasks. Fewer words find more.")] : [])));
  board.box.dataset.key = "";      // Today draws itself again when the search is emptied
}

// Group & sort, as the list's (the same setting: app.js organizeMenu): the
// board's Chats by priority, by project, or by where they stand.
function boardOrganize() {
  const btn = h("button", { class: "control organize board-organize", type: "button", title: "Group and sort", "aria-haspopup": "menu",
                            onclick: () => toggleOrganize(board.organize, btn, boardOrganizeDraw) }, glyph("organize"));
  board.organize = organizeBox(() => btn, boardOrganizeDraw);
  return h("div", { class: "board-organize-wrap" }, btn, board.organize);
}

function boardOrganizeDraw() {
  if (!board.organize) return;
  if (!board.organize.hidden) keepFocus(board.organize, () => board.organize.replaceChildren(...organizeMenu()));
  board.box.dataset.key = "";
  if (board.tab === "chats" && !board.query) todayFill(board.box, true);
}

// Ctrl+Alt+J / K on the board: from chat to chat in its order, the open one
// opening the next, else the keys going to the next card.
function boardStep(n) {
  const ids = [...new Set([...board.box.querySelectorAll(".ticket[data-id]")].filter(shown).map((t) => t.dataset.id))];
  if (!ids.length) return;
  const at = ids.indexOf(keyedId());
  const id = ids[at < 0 ? (n > 0 ? 0 : ids.length - 1) : (at + n + ids.length) % ids.length];
  if (board.open) return boardOpen(id);
  const go = board.box.querySelector(`.ticket[data-id="${CSS.escape(id)}"] .today-go`);
  if (go) { go.focus(); go.scrollIntoView({ block: "nearest" }); }
}
