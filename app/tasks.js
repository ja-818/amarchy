// ---- Tasks: your chats as tickets, the whole window (a computer's)
//
// The other way to work on a computer, beside Chats (the list on the left,
// one chat in the middle): no list, only Today's page (today.js) with every
// chat a ticket. A ticket says its project, its state, its goal and what it
// last said, with what it asks you as buttons; clicked, it opens in place,
// the chat itself live in it (chat.js): answer it, approve, write, close it,
// and fold it again. One is open at a time; while it is, the page holds
// still. A new chat starts at the top, and opens as a ticket.
//
// The switch: Tasks | Chats over the board, Tasks over the list in Chats,
// Ctrl+Alt+H. The app opens on the one you used last (Tasks at first).

const board = {
  el: null, box: null, head: null, slot: null,
  open: null,        // the session whose ticket is open
  chat: null,        // its Chat
  body: null,        // its ticket's inside: the bar and the chat
  composing: false,  // the new chat's box at the top
  waitFor: null,     // a chat just started: opened once the list has it
};

function boardOn() { return !!app.desk && typeof desk !== "undefined" && desk.mode === "tasks"; }
function boardHolds() { return !!board.open; }

// The chat the keys go to: the open ticket's in Tasks, the middle's in Chats.
function chatNow() { return boardOn() ? board.chat : desk.chat; }

function boardBuild() {
  if (board.el) return board.el;
  board.switchEl = h("div", { class: "seg board-switch", role: "tablist" });
  board.head = h("header", { class: "board-head" },
    h("div", { class: "board-head-in" },
      board.switchEl,
      h("span", { class: "board-gap" }),
      h("button", { class: "control", type: "button", title: "New chat (Ctrl+Alt+N)", onclick: () => boardCompose() }, glyph("plus"), "New chat"),
      automationsButton("control organize"),
      h("button", { class: "control organize", type: "button", title: "Settings (right click or Ctrl+Alt+M: the Amarchy menu)", "aria-label": "Settings",
                    onclick: () => openSettings(), oncontextmenu: (e) => { e.preventDefault(); deskMenu(); } }, glyph("gear"))));
  board.slot = h("div", { class: "board-new", hidden: true });
  board.box = h("div", { class: "today board-today" });
  board.el = h("div", { class: "tasks-board" }, board.head, h("div", { class: "board-scroll" }, board.slot, board.box));
  board.el.addEventListener("keydown", (e) => {
    // Esc outside a box you type in: the open ticket folds.
    if (e.key !== "Escape" || !board.open || e.defaultPrevented) return;
    if (e.target.closest("textarea, input, .card, .sheet-back, .picker-back")) return;
    e.preventDefault();
    boardCollapse();
  });
  return board.el;
}

// The switch's two sides, wherever they are, with what's your move.
function modeButtons() {
  const n = todayCount(app.view);
  const count = () => (n ? h("span", { class: "tab-count" }, String(n)) : "");     // one each: an element is in one place
  if (board.switchEl) {
    const side = (mode, ...label) => h("button", { class: `control${desk.mode === mode ? " on" : ""}`, type: "button", role: "tab",
                                                   "aria-selected": String(desk.mode === mode), onclick: () => deskMode(mode) }, ...label);
    board.switchEl.replaceChildren(side("tasks", "Tasks", count()), side("chats", "Chats"));
  }
  if (desk.todayBtn) desk.todayBtn.replaceChildren("Tasks", count());
}

// Tasks or Chats, kept for the next time the app opens.
function deskMode(mode) {
  if (mode !== "tasks" && mode !== "chats") return;
  desk.mode = mode;
  store.set("desk-mode", mode);
  desk.el.classList.toggle("tasks-mode", mode === "tasks");
  if (mode === "tasks") {
    boardRefresh(true);
    requestAnimationFrame(() => { if (!board.open) board.el.querySelector(".board-scroll").focus({ preventScroll: true }); });
  } else {
    boardCollapse();
    board.composing = false;
    deskLayout();
    deskList();
    deskRefocus();
  }
  modeButtons();
}

// The view changed (app.js refresh): the board, unless a ticket holds it.
function boardRefresh(force) {
  if (!board.box) return;
  if (board.open && app.view && !row(board.open)) boardCollapse();     // closed
  if (board.waitFor && row(board.waitFor)) {
    const id = board.waitFor;
    board.waitFor = null;
    boardOpen(id);
    return;
  }
  todayFill(board.box, force);
  modeButtons();
}

// A route in Tasks (desk.js deskRoute): a chat's opens its ticket, a new
// chat's the box at the top. true when it took it.
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
  return true;
}

// The ticket in place: an element around Today's row or card, and inside
// it, when it's the open one, the chat.
function boardTicket(s, node) {
  const open = board.open === s.id;
  const el = h("div", { class: `ticket${open ? " open" : ""}`, "data-id": s.id }, node);
  if (open && board.body) el.append(board.body);
  return el;
}

function boardToggle(id) {
  if (board.open === id) boardCollapse();
  else boardOpen(id);
}

function boardOpen(id) {
  const s = row(id);
  if (!s) return;
  if (board.chat) board.chat.close();
  const chat = new Chat({ id, row: s, noSwitch: true, onGone: (why) => { if (!why && board.chat === chat) boardCollapse(); } });
  board.open = id;
  board.chat = chat;
  const btn = (label, act, cls = "") => h("button", { class: `text-btn ${cls}`, type: "button", onclick: act }, label);
  board.body = h("div", { class: "ticket-body" },
    h("div", { class: "ticket-bar" },
      btn("Fold", () => boardCollapse()),
      h("span", { class: "board-gap" }),
      btn("Open in Chats", () => { deskMode("chats"); go2(id); }),
      s.assistant === "main" ? null : btn("Close chat", () => confirmClose(row(id) || s), "danger")),
    chat.el);
  todayFill(board.box, true);
  chat.open();
  api(`/api/session/${encodeURIComponent(id)}/seen`).catch(() => {});
  requestAnimationFrame(() => {
    const t = board.box.querySelector(`.ticket[data-id="${CSS.escape(id)}"]`);
    if (t) t.scrollIntoView({ block: "start", behavior: "smooth" });
    chat.grow();
  });
}

function boardCollapse() {
  if (!board.open) return;
  if (board.chat) board.chat.close();
  board.chat = board.body = board.open = null;
  if (boardOn()) {
    if (/^#\/s\//.test(here())) go("#/today");
    todayFill(board.box, true);
  }
}

// The new chat's box at the top of the board (the same one as Chats' middle:
// what you were writing stays).
function boardCompose() {
  board.composing = true;
  boardComposeShow();
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

// While a ticket is open and in sight, its chat is seen.
setInterval(() => {
  if (boardOn() && board.open && document.visibilityState === "visible" && document.hasFocus())
    api(`/api/session/${encodeURIComponent(board.open)}/seen`).catch(() => {});
}, 10000);
