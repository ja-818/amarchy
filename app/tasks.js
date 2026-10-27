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
};

// The chat the keys go to: the open one in Tasks, the middle's in Chats.
function chatNow() { return boardOn() ? board.chat : desk.chat; }

function boardBuild() {
  if (board.el) return board.el;
  board.switchEl = h("div", { class: "seg board-switch", role: "tablist" });
  board.head = h("header", { class: "board-head" },
    h("div", { class: "board-head-in" },
      board.switchEl,
      h("span", { class: "board-gap" }),
      h("button", { class: "control", type: "button", title: "New chat (n, Ctrl+Alt+N)", onclick: () => boardCompose() }, glyph("plus"), "New chat"),
      automationsButton("control organize"),
      h("button", { class: "control organize", type: "button", title: "Settings (right click or Ctrl+Alt+M: the Amarchy menu)", "aria-label": "Settings",
                    onclick: () => openSettings(), oncontextmenu: (e) => { e.preventDefault(); deskMenu(); } }, glyph("gear"))));
  board.slot = h("div", { class: "board-new", hidden: true });
  board.box = h("div", { class: "today board-today" });
  board.scroll = h("div", { class: "board-scroll", tabindex: "-1" }, board.slot, board.box);
  board.focusEl = h("div", { class: "board-focus", hidden: true });
  board.el = h("div", { class: "tasks-board" }, board.head, board.scroll, board.focusEl);
  // Its keys wherever the keyboard is (nothing focused, too), while it's up.
  window.addEventListener("keydown", (e) => { if (boardOn()) boardKeys(e); });
  return board.el;
}

// The board's keys (none while you type, or a sheet is up).
function boardKeys(e) {
  if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
  if (document.querySelector(".sheet-back, .picker-back")) return;
  const typing = e.target.closest("textarea, input, [contenteditable]");
  if (board.open) {
    // Esc: back to the board. In the box you type in only when it's empty
    // and Claude isn't at work (there Esc stops Claude, as in any chat).
    if (e.key !== "Escape") return;
    const working = board.chat && board.chat.row && board.chat.row.status === "working";
    if (typing && (e.target.value || working)) return;
    if (e.target.closest(".card")) return;
    e.preventDefault();
    e.stopPropagation();
    boardBack();
    return;
  }
  if (typing) return;
  const goes = [...board.box.querySelectorAll(".ticket > * > .today-go")];
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

// The switch's two sides, wherever they are, with what's your move.
function modeButtons() {
  if (!app.view) return;
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
  todayFill(board.box, force);
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
    stateIcon(s), s.assistant === "main" ? null : projectChip(s),
    taskText(s.assistant === "main" ? s.assistant_name || "Assistant" : s.task || "New chat"),
    h("span", { class: `head-state is-${statusTone(s)}` }, statusWords(s)),
    h("span", { class: "board-gap" }),
    btn("Open in Chats", () => { const id = s.id; deskMode("chats"); go2(id); }),
    s.assistant === "main" ? null : btn("Close chat", () => { boardBack(true); todayClose(s); }, "danger")].filter(Boolean)));
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
  todayFill(board.box, true);
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
