// ---- Tasks: your boards
//
// Tasks is boards (bin/amarchy "Tasks: boards"): one for each project or
// agent, its columns the agent's, its cards what depends on you. Tasks
// shows each board with what waits on you there (the first cards in a
// column of yours), a box to write a task for one of your agents (it helps
// you get it done), and your commitments (your loops file, kept by your
// assistant) as a board of their own. A board opens in Tasks' place
// (#/b/<board>): its columns side by side where there's room, one at a time
// on a phone (their tabs, a swipe), every card in them.
//
// A card: its title, its block (an xpost as X shows it; any block a reply
// draws: chat.js blockParts), its note, its links, its thread (what you
// said, what the agent answered, what was done), then its buttons (its
// column's and its own: a message to its agent, a column to move it to,
// words asked of you first), Comment, Edit (its text in place, X's count
// live for a post: past 280 a warning, Premium takes it) and its menu (Move
// to, Take down). What you do goes after a few seconds of Undo (todayUndo),
// as a task's always has; what you write never waits.

"use strict";

const boardsUI = {
  open: null,           // the board open in Tasks: its key ("<machine>:<id>" for another machine's), else Tasks' list
  focus: null,          // a card to bring into sight once its board is open
  got: new Map(),       // key -> {rev, board}: a board whole, as its server last said (/api/boards/<id>)
  loading: new Map(),   // key -> its fetch under way
  failed: new Map(),    // key -> {why, rev, at}: it couldn't be read (asked again when it changes, or in a while)
  col: new Map(),       // key -> the column a narrow screen shows
  edit: null,           // {key, card, title, body}: the card you edit, as you've written it so far
  talk: new Map(),      // card id -> what you're writing in its comment box (open while it's here)
  ask: null,            // {card, n}: a button that asks you first, its box open
  threads: new Set(),   // cards whose whole thread you opened
  pending: new Map(),   // card id -> {from, at}: pressed or moved out of its column, or taken down, until its board says so
  said: new Map(),      // card id -> [{text, at}]: comments on their way
  boxes: new Map(),     // card id (or "write") -> a box you write in, kept as it is across redraws (its words, its mic)
  target: null,         // the board a task you write goes to (its key); else your assistant's
  route: "",            // the address last gone to (boardsRouted: back from a board, or from a chat opened on it)
  pushed: false,        // the board's address is one this page put in the browser's history (its Back goes back)
  version: 0,
};

// ---- the boards, as the view has them

// A board's key: its id here, <machine>:<id> on another machine.
function boardsKeyOf(b) { return chatKeyOf(b.machine || "", b.id); }

// Every board in sight (this machine's and the others'), as Tasks lists them.
function boardsList(v = app.view) {
  return ((v && v.today && v.today.boards) || []).map((b) => ({ ...b, key: boardsKeyOf(b) }));
}

// A board by its key: as the view has it, or (open) whole as its server said.
function boardsFind(key, v = app.view) {
  if (key === "commitments") return boardsLoops(v);
  return boardsList(v).find((b) => b.key === key) || null;
}

function boardsWhole(b) {
  const got = boardsUI.got.get(b.key);
  return got ? { ...b, ...got.board, key: b.key, machine: b.machine } : null;
}

// What's yours on a board now: its count, less what you just did there.
function boardsYours(b) {
  const cards = (boardsWhole(b) || b).cards || [];
  const gone = cards.filter((c) => !boardsShown(c) && b.columns.some((x) => x.yours && x.name === c.column)).length;
  return Math.max(0, (b.yours || 0) - gone);
}

// Tasks' count: every board's cards of yours.
function boardsCount(v = app.view) {
  return boardsList(v).reduce((n, b) => n + boardsYours(b), 0);
}

// Whether a card says how long it has left (Tasks draws itself again each minute then).
function boardsTimed(v = app.view) {
  return boardsList(v).some((b) => ((boardsWhole(b) || b).cards || []).some((c) => c.until));
}

// What Tasks draws depends on, besides the view (todayKey).
function boardsKey() {
  const open = boardsUI.open ? boardsUI.got.get(boardsUI.open) : null;
  return JSON.stringify([boardsUI.version, boardsUI.open, open ? open.rev : null, (boardsUI.failed.get(boardsUI.open) || {}).why || "",
    boardsUI.col.get(boardsUI.open) || "", [...boardsUI.pending.keys()], [...boardsUI.said.entries()].map(([k, v]) => [k, v.length])]);
}

// The board open, whole, read again whenever the view says it changed.
function boardsFetch(b) {
  if (!b || b.key === "commitments" || b.legacy) return null;
  const had = boardsUI.got.get(b.key);
  if (had && had.rev === b.rev) return had.board;
  if (boardsUI.loading.has(b.key)) return null;
  // It couldn't be read: not again at once (each redraw would), only once it changed or in a while.
  const failed = boardsUI.failed.get(b.key);
  if (failed && failed.rev === b.rev && Date.now() - failed.at < 15000) return had ? had.board : null;
  const at = machinePath(b.key, `/api/boards/${encodeURIComponent(b.id)}`);
  boardsUI.loading.set(b.key, fetch(at, { headers: { Accept: "application/json" } })
    .then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Can't read that board");
      boardsUI.got.set(b.key, { rev: d.rev, board: d });
      boardsUI.failed.delete(b.key);
      // What you just did there, done: its cards where the board says.
      for (const [id, p] of boardsUI.pending) {
        const c = (d.cards || []).find((x) => x.id === id);
        if (!c || c.column !== p.from || Date.now() - p.at > 20000) boardsUI.pending.delete(id);
      }
    })
    .catch((e) => boardsUI.failed.set(b.key, { why: e.message || "Can't read that board", rev: b.rev, at: Date.now() }))
    .finally(() => { boardsUI.loading.delete(b.key); todayRedraw(); }));
  return had ? had.board : null;
}

// What you just did is drawn (and the board read again, as it is now).
function boardsRedraw() {
  boardsUI.version++;
  todayRedraw();
}

// A card in sight: not one you just acted on, not past its time.
function boardsShown(c) {
  const p = boardsUI.pending.get(c.id);
  if (p && Date.now() - p.at > 20000) boardsUI.pending.delete(c.id);     // (done by now: the board says where it is)
  return !boardsUI.pending.has(c.id) && (!c.until || c.until > Date.now() / 1000);
}

// Your comments on a card still on their way: not yet on its thread as the
// board has it (a while at most).
function boardsSaying(c) {
  const mine = (c.thread || []).filter((x) => x.who === "you" && x.kind === "comment").map((x) => x.text);
  const left = (boardsUI.said.get(c.id) || []).filter((x) => !mine.includes(x.text) && Date.now() - x.at < 30000);
  if (left.length) boardsUI.said.set(c.id, left); else boardsUI.said.delete(c.id);
  return left;
}

// A card's agent: its chat's row (its picture and name), wherever it is.
function boardsAgent(b, c) {
  const key = chatKeyOf(b.machine || "", c.agent || b.lead);
  return rowOf(key) || { id: key, repo: "", assistant: "agent", assistant_name: c.agent_name || b.lead_name };
}

function boardsLeadRow(b) {
  const key = chatKeyOf(b.machine || "", b.lead);
  return rowOf(key) || { id: key, repo: "", assistant: "agent", assistant_name: b.lead_name };
}

// ---- your commitments, as a board: your loops file, kept by your assistant

function boardsLoops(v = app.view) {
  if (!v || !v.today || !v.today.source) return null;
  const p = todayParts(v);
  const name = (v.today.assistant || {}).name || "your assistant";
  const cols = [["Now", [...p.chaseNow, ...p.dueNow], true], ["Waiting on others", p.waiting], ["This week", p.week],
                ["Further out", p.later], ["Someday", p.someday]];
  return { key: "commitments", id: "commitments", loops: true, title: "Commitments", lead_name: name,
           lead: (v.today.assistant || {}).id || "", yours: p.chaseNow.length + p.dueNow.length,
           columns: cols.map(([n, ls, yours]) => ({ name: n, yours: !!yours, count: ls.length, loops: ls })) };
}

// ---- Tasks: the boards, and what waits on you on each

// Tasks' cards: the box to write a task, then each board with what's yours
// there (the ones with something first), your commitments among them.
function boardsNodes(v) {
  if (boardsUI.open) return boardsOpenNodes(v, boardsUI.open);
  const boards = boardsList(v);
  const loops = boardsLoops(v);
  const all = [...(loops ? [loops] : []), ...boards];
  const order = (b) => (boardsYours(b) || (b.loops ? b.yours : 0) ? 0 : 1);
  const nodes = [boardsWriteBox(v)];
  for (const b of [...all].sort((a, c) => order(a) - order(c))) nodes.push(b.loops ? boardsLoopsSection(v, b) : boardsSection(b));
  if (!all.length) nodes.push(h("p", { class: "today-note" }, "Your agents' boards show here: what they need of you, and what you ask them. "
    + "Make one of your chats your assistant, or start an agent, and write it a task above."));
  if (v.today && v.today.error) nodes.push(h("p", { class: "today-note bad" }, v.today.error));
  return nodes;
}

// A board in Tasks: its name and its lead's picture, how many cards wait
// on you, the first of them; Open (all of it).
function boardsSection(b) {
  const lead = boardsLeadRow(b);
  const cards = (b.cards || []).filter(boardsShown);
  const yours = boardsYours(b);
  const name = h("span", { class: "bsec-name" }, avatar(lead, "tiny"), h("span", {}, b.title));
  const kids = cards.map((c) => boardsCard(b, c, { list: true }));
  if (yours > cards.length) {
    kids.push(h("button", { class: "tbtn quiet bsec-more", type: "button", onclick: () => boardsOpen(b.key) },
      `${yours - cards.length} more for you on ${b.title}`));
  }
  if (!kids.length) {
    const counts = (b.columns || []).filter((c) => c.count).map((c) => `${c.count} ${c.name.toLowerCase()}`).join(" · ");
    kids.push(h("button", { class: "bsec-none", type: "button", onclick: () => boardsOpen(b.key) },
      h("span", {}, "Nothing waits on you"), counts ? h("span", { class: "bsec-counts" }, counts) : null));
  }
  const node = uiSection(`board-${b.key}`, name, { count: yours || null,
    extra: b.legacy ? null : uiButton("Open", () => boardsOpen(b.key), false, "quiet bsec-open") }, kids);
  node.dataset.board = b.key;
  if (cards.length) node.classList.add("today-yours");      // (your move there: its head lit)
  return node;
}

// Your commitments in Tasks: what's due and whom to chase now (your loops).
function boardsLoopsSection(v, b) {
  const loop = (l) => { const n = todayLoop(l, v); n.todayData = JSON.stringify([l, (v.today.sent || {})[l.key] || null, (v.today.assistant || {}).name]); return n; };
  const now = b.columns[0].loops;
  const rest = b.columns.slice(1).reduce((n, c) => n + c.count, 0);
  const kids = now.map(loop);
  if (!kids.length) kids.push(h("button", { class: "bsec-none", type: "button", onclick: () => boardsOpen("commitments") },
    h("span", {}, "Nothing due now"), rest ? h("span", { class: "bsec-counts" }, `${rest} waiting or later`) : null));
  const main = (v.sessions || []).find((s) => s.assistant === "main");
  const name = h("span", { class: "bsec-name" }, main ? avatar(main, "tiny") : null, h("span", {}, "Commitments"));
  const node = uiSection("board-commitments", name, { count: now.length || null, extra: uiButton("Open", () => boardsOpen("commitments"), false, "quiet bsec-open") }, kids);
  node.dataset.board = "commitments";
  if (now.length) node.classList.add("today-yours");
  return node;
}

// ---- a board, open: its columns and every card

function boardsOpen(key, card = null) {
  boardsUI.open = key;
  boardsUI.focus = card;
  boardsUI.edit = null;
  boardsUI.ask = null;
  const hash = `#/b/${encodeURIComponent(key)}`;
  if (board.tab !== "tasks") boardTab("tasks");
  if (here() !== hash) {
    if (standalone) routed.hash = hash;
    else { history.pushState(null, "", `${location.pathname}${location.search}${hash}`); boardsUI.pushed = true; }
  }
  boardsUI.route = hash;
  board.scroll.scrollTop = 0;
  boardsRedraw();
  boardRefocus();
}

// Back to Tasks' list, where it was. Its address one this page put in the
// browser's history: the browser goes back (boardsRouted closes it then).
function boardsClose() {
  if (!boardsUI.open) return;
  if (!standalone && boardsUI.pushed && /^#\/b\//.test(location.hash)) {
    boardsUI.pushed = false;
    history.back();
    return;
  }
  boardsUI.pushed = false;
  const was = boardsUI.open;
  boardsUI.open = null;
  boardsUI.edit = null;
  boardsUI.ask = null;
  if (/^#\/b\//.test(here())) {
    if (standalone) routed.hash = "#/today";
    else history.replaceState(null, "", `${location.pathname}${location.search}#/today`);
  }
  boardsUI.route = here();
  boardsRedraw();
  const sec = board.box.querySelector(`.tsec[data-board="${CSS.escape(was)}"]`);
  if (sec) uiReveal(sec, { scroller: board.scroll, block: "start" });
  boardRefocus();
}

// Gone somewhere (app.js routeNow, desk.js deskRoute): a board's address
// opens it; back from a board (the browser's Back) is Tasks' list again;
// back from a chat opened on it, the board as it was.
function boardsRouted(hash) {
  const was = boardsUI.route;
  boardsUI.route = hash;
  if (boardsRoute(hash) || !boardsUI.open || hash === "#/tasks" || hash === "#/new") return;
  if (/^#\/b\//.test(was || "")) { boardsUI.pushed = false; boardsClose(); }
}

// #/b/<key> (a card's notification, a link): that board, open in Tasks.
function boardsRoute(hash) {
  const m = String(hash || "").match(/^#\/b\/(.+)$/);
  if (!m) return false;
  const key = normKey(decodeURIComponent(m[1]));
  if (boardsUI.open !== key) {
    boardsUI.open = key;
    boardsUI.edit = null;
    boardsUI.ask = null;
  }
  if (board.tab !== "tasks") boardTab("tasks");
  else boardsRedraw();
  return true;
}

// The open board's cards: its head (Back, its lead, its name), then its
// columns (uiKanban), each card where it is.
function boardsOpenNodes(v, key) {
  const b = boardsFind(key, v);
  const back = () => boardsClose();
  if (!b) {
    return [uiPageHead({ back, backLabel: "Tasks", title: "That board is gone" }),
            h("p", { class: "today-note" }, v ? "Its agent took it down, or it isn't one of your agents' any more." : "Connecting…")];
  }
  const lead = b.loops ? (v.sessions || []).find((s) => s.assistant === "main") : boardsLeadRow(b);
  const yours = b.loops ? b.yours : boardsYours(b);
  const sub = [b.loops ? `Kept by ${b.lead_name}` : `${b.lead_name}'s`, yours ? `${yours} for you` : "nothing waits on you"].join(" · ");
  const head = uiPageHead({ back, backLabel: "Tasks", lead: lead ? avatar(lead, "small") : null, title: b.title, sub });
  if (b.loops) {
    const loop = (l) => { const n = todayLoop(l, v); n.todayData = JSON.stringify([l, (v.today.sent || {})[l.key] || null]); return n; };
    const on = boardsColumn(b);
    return [head, uiKanban(b.columns.map((c) => ({ key: c.name, label: c.name, count: c.count, yours: c.yours,
      kids: c.loops.length ? c.loops.map(loop) : [h("p", { class: "ui-kanban-empty" }, "Nothing here")] })), on, (k) => boardsPickColumn(b, k), { id: key })];
  }
  boardsFetch(b);       // (read again when the view says it changed)
  const whole = boardsWhole(b);
  if (!whole) {
    const why = (boardsUI.failed.get(b.key) || {}).why;
    return [head, h("p", { class: why ? "today-note bad" : "today-note" }, why || "Opening the board…")];
  }
  const on = boardsColumn(whole);
  const cards = (whole.cards || []).filter(boardsShown);
  const cols = whole.columns.map((col) => {
    const mine = cards.filter((c) => c.column === col.name);
    const kids = mine.map((c) => boardsCard(whole, c));
    if (!mine.length) kids.push(h("p", { class: "ui-kanban-empty" }, col.yours ? "Nothing waits on you here" : "Nothing here"));
    if (!col.approval && !col.done && (col.yours || col === whole.columns[0])) kids.push(boardsAddBox(whole, col));
    return { key: col.name, label: col.name, count: mine.length, yours: col.yours, kids };
  });
  const node = uiKanban(cols, on, (k) => boardsPickColumn(whole, k), { id: key });
  // A card asked for (its notification, Tasks' card): in sight, once.
  if (boardsUI.focus) {
    const id = boardsUI.focus;
    const c = cards.find((x) => x.id === id);
    if (c && c.column !== on) { boardsUI.col.set(key, c.column); boardsUI.focus = id; setTimeout(boardsRedraw); }
    else {
      boardsUI.focus = null;
      setTimeout(() => {
        const el = board.box.querySelector(`.tcard[data-card="${CSS.escape(id)}"]`);
        if (el) { uiReveal(el, { scroller: board.scroll, block: "center" }); el.classList.add("next"); setTimeout(() => el.classList.remove("next"), 2400); }
      });
    }
  }
  return [head, node];
}

// The column a narrow screen shows: the one you picked, else the first of
// yours with something in it, else the first.
function boardsColumn(b) {
  const picked = boardsUI.col.get(b.key);
  if (picked && b.columns.some((c) => c.name === picked)) return picked;
  const count = (c) => (b.cards ? b.cards.filter((x) => x.column === c.name).length : c.count || 0);
  return (b.columns.find((c) => c.yours && count(c)) || b.columns.find((c) => count(c)) || b.columns[0] || {}).name;
}

function boardsPickColumn(b, name) {
  boardsUI.col.set(b.key, name);
  boardsRedraw();
}

// ---- a card

// A card, wherever it is (Tasks' list: list): its block, note, thread and
// what you can do with it. Its head opens it: on its board, in sight (from
// Tasks); there, its whole thread.
function boardsCard(b, c, { list = false } = {}) {
  const who = boardsAgent(b, c);
  const name = c.agent_name || who.assistant_name || "your agent";
  const editing = boardsUI.edit && boardsUI.edit.card === c.id && boardsUI.edit.key === b.key;
  const links = (c.links || []).map((l, i) => h("a", { class: `tbtn task-link${i === 0 ? " primary" : ""}`, href: l.url, target: "_blank", rel: "noopener",
    title: l.url, onclick: (e) => { e.stopPropagation(); if (typeof openLink === "function") { e.preventDefault(); openLink(l.url); } } }, glyph("preview"), l.label));
  const buttons = (c.buttons || []).map((x, i) => {
    const btn = uiButton(x.label, () => boardsPress(b, c, i), i === 0 && !links.length, "today-opt bcard-btn");
    btn.title = [x.send ? `Sends ${name}: ${x.send}` : "", x.to && x.to !== c.column ? `Moves it to ${x.to}` : "", x.asks ? `Asks you first: ${x.asks}` : ""]
      .filter(Boolean).join(" · ") || x.label;
    return btn;
  });
  const legacy = !!b.legacy;
  const canEdit = !legacy && boardsEditable(c);
  const more = legacy ? null : uiTool("more", "More", (e) => boardsMenu(b, c, e.currentTarget), { cls: "bcard-tool bcard-more", extra: { "aria-haspopup": "menu" } });
  // Its tools, icons after its buttons, together (on their row, else the next).
  const tools = legacy ? [] : [
    uiTool("comment", `Comment for ${name}`, () => boardsTalkOpen(b, c), { cls: `bcard-tool bcard-comment${boardsUI.talk.has(c.id) ? " on" : ""}`, title: `Comment: tell ${name} (c)` }),
    canEdit ? uiTool("edit", "Edit", () => boardsEditOpen(b, c), { cls: "bcard-tool bcard-edit-btn", title: "Edit it (e)" }) : null, more].filter(Boolean);
  const actions = editing ? [] : [...links, ...buttons, tools.length ? h("span", { class: "bcard-tools" }, ...tools) : null];
  const body = editing ? [boardsEditor(b, c)] : [
    c.block ? boardsBlock(b, c) : null,
    c.note ? h("div", { class: `tcard-text bcard-note${c.block ? " muted" : ""}`, html: c.block ? inline(c.note) : md(c.note) }) : null,
    boardsThread(b, c, list),
    boardsAskBox(b, c),
    boardsTalkBox(b, c)];
  const multi = list && (b.columns || []).filter((x) => x.yours).length > 1;
  const card = uiCard({ kind: "bcard", hue: todayHue(who.repo || ""), chip: multi ? c.column : "", title: c.title || "A card",
    label: `${b.title}: ${c.title}`, pill: boardsPill(b, c), id: null, unseen: !!c.answered,
    open: () => (list ? boardsOpen(b.key, c.id) : boardsThreadToggle(c)), body, actions });
  card.dataset.card = c.id;
  card.dataset.board = b.key;
  if (c.block) card.classList.add(`bcard-${c.block.kind}`);
  card.todayData = JSON.stringify([b.key, c, list, multi, editing, boardsUI.threads.has(c.id), boardsUI.talk.has(c.id),
    boardsUI.ask && boardsUI.ask.card === c.id ? boardsUI.ask.n : null, boardsSaying(c).length,
    boardsPillWords(b, c), who.picture, who.repo]);
  return card;
}

// Where a card stands, in its pill: the agent answered you, how long it has
// left, approved by you.
function boardsPillWords(b, c) {
  if (c.answered) return { text: ((c.thread || []).slice(-1)[0] || {}).kind === "revise" ? "Revised" : "Answered", tone: "new" };
  if (c.until || c.task) return todayTaskWhen(c);       // (a task with no time: how old it is)
  if (c.approved) return { text: "Approved ✓", tone: "done" };
  return null;
}

function boardsPill(b, c) {
  const w = boardsPillWords(b, c);
  return w ? uiPill(w.text, w.tone) : null;
}

// Whether you can edit a card's text in place: its block's (one of words:
// a post, a message, a note), else its note.
function boardsEditable(c) {
  if (!c.block) return true;
  const shape = ((BLOCKS.get(c.block.kind) || {}).body || {}).shape || "text";
  return shape === "text" || shape === "code" || shape === "todos" || shape === "fields";
}

// A card's block, open, drawn as a reply draws it (chat.js blockParts): a
// post as X shows it, with Copy text and Copy image under it.
function boardsBlock(b, c) {
  const blk = c.block || {};
  const shape = ((BLOCKS.get(blk.kind) || {}).body || {}).shape || "text";
  const a = { kind: blk.kind, attrs: blk.attrs || {}, body: blk.body || "", ...blockBody(shape, blk.body || "") };
  const chat = chatKeyOf(b.machine || "", c.agent || b.lead);
  const v = blockParts(a, { chat, mediaUrl: (src) => chatPath(chat, `/media?src=${encodeURIComponent(src)}`) });
  const head = a.kind === "xpost" ? null : h("div", { class: "art-head" },
    h("div", { class: "art-toggle static" }, h("span", { class: "art-ic" }, icon(v.icon)),
      h("span", { class: "art-text" }, h("span", { class: "art-title" }, v.title), v.sub ? h("span", { class: "art-sub" }, v.sub) : null)),
    ...[v.quick].flat().filter(Boolean));
  const acts = v.actions.filter(Boolean);
  return h("ul", { class: "artifacts block bcard-block" }, h("li", { class: `art art-${v.look || a.kind} open` }, head,
    h("div", { class: "art-body" }, ...v.body.filter(Boolean), acts.length ? h("div", { class: "art-actions" }, ...acts) : null)));
}

// ---- its thread: what was said and done on it

function boardsThread(b, c, list) {
  const saying = boardsSaying(c);
  const items = [...(c.thread || []).filter((x) => x.kind !== "approve"),
                 ...saying.map((x) => ({ who: "you", name: "You", kind: "comment", text: x.text, at: x.at / 1000, sending: true }))];
  if (!items.length) return null;
  const all = !list && boardsUI.threads.has(c.id);
  const show = all ? items : items.slice(-(list ? 2 : 3));
  const hidden = (c.count || items.length) - show.length + saying.length;
  const earlier = hidden > 0 ? h("button", { class: "text-btn ui-thread-more", type: "button",
    onclick: (e) => { e.stopPropagation(); if (list) boardsOpen(b.key, c.id); else boardsThreadToggle(c, true); } },
    `${hidden} earlier`) : null;
  return uiThread(show.map((x) => boardsThreadItem(b, c, x)), { earlier });
}

// One thing on a card's thread, in words.
function boardsThreadItem(b, c, x) {
  const name = x.who === "you" ? "You" : x.name || "Your agent";
  const before = (x.before || x.before === "") && x.kind !== "press" ? h("details", { class: "ui-thread-before" },
    h("summary", {}, "What it was"), h("div", { class: "ui-thread-text pre" }, String(x.before || "(empty)"))) : null;
  switch (x.kind) {
    case "comment":
      return { who: x.who, name, at: x.sending ? 0 : x.at, text: x.text, event: x.sending ? "Sending…" : null };
    case "press":
      return { who: x.who, name, at: x.at, event: `${x.label}${x.column ? ` → ${x.column}` : ""}${x.approved ? " ✓" : ""}`, text: x.text || null };
    case "edit":
      return { who: x.who, name, at: x.at, event: x.what === "title" ? `Renamed it “${x.after}”` : "Edited its text", more: x.what === "title" ? null : before };
    case "revise":
      return { who: x.who, name, at: x.at, event: "Revised it", more: before };
    case "move":
      return { who: x.who, name, at: x.at, event: `${x.text ? `${x.text} · ` : ""}Moved to ${x.column}${x.approved ? " ✓" : ""}` };
    default:
      return { who: x.who, name, at: x.at, event: x.kind };
  }
}

function boardsThreadToggle(c, on = null) {
  if (on === null) on = !boardsUI.threads.has(c.id);
  if (on) boardsUI.threads.add(c.id); else boardsUI.threads.delete(c.id);
  boardsRedraw();
}

// ---- writing: a comment, a button's words, a task

// A box you write in, as the chat's (uiComposer), with the mic: kept as
// it is across redraws (what you've written, what you're saying).
function boardsBox(id, { placeholder, label, value = "", send, cancel = null, sendLabel = "Send", cls = "" }) {
  const had = boardsUI.boxes.get(id);
  if (had) {
    had.sendIt = send;
    had.cancelIt = cancel;
    return had;
  }
  const field = h("textarea", { class: "bbox-field", rows: 1, placeholder, "aria-label": label, enterkeyhint: "send" });
  field.value = value;
  const grow = () => uiFitField(field, { max: Math.round(window.innerHeight * 0.4), extra: 2 });
  const micBtn = uiComposerButton("mic", "Dictate (hold, or tap and tap again)", glyph("mic"), null, { hidden: true });
  const sendBtn = uiComposerButton("send", sendLabel, glyph("send"), () => box.sendIt(field.value));
  const box = uiComposer({ field, after: [micBtn, sendBtn], cls: `bbox${cls ? ` ${cls}` : ""}` });
  box.field = field;
  box.sendIt = send;
  box.cancelIt = cancel;
  box.changed = null;
  field.addEventListener("input", () => { grow(); if (box.changed) box.changed(field.value); });
  field.addEventListener("keydown", (e) => {
    if (box.talk && box.talk.keyStops(e)) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === "Escape" && box.cancelIt) { e.preventDefault(); e.stopPropagation(); box.cancelIt(); }
    // On a computer Enter sends, Shift+Enter is a new line; a phone's return is a new line.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(hover: hover) and (pointer: fine)").matches) {
      e.preventDefault();
      box.sendIt(field.value);
    }
    e.stopPropagation();      // (the board's keys are for the cards, not what you type)
  });
  if (typeof Dictate === "function") box.talk = new Dictate({ field, button: micBtn, changed: () => { grow(); if (box.changed) box.changed(field.value); } });
  boardsUI.boxes.set(id, box);
  requestAnimationFrame(grow);
  return box;
}

function boardsBoxGone(id) {
  const box = boardsUI.boxes.get(id);
  if (box && box.talk && box.talk.run) return;      // still saying it: kept
  boardsUI.boxes.delete(id);
}

function boardsFocusBox(id) {
  requestAnimationFrame(() => {
    const box = boardsUI.boxes.get(id);
    if (box && box.isConnected) { box.field.focus({ preventScroll: true }); uiReveal(box, { scroller: board.scroll }); }
  });
}

// Comment: a box under the card; what you send goes to its agent as your
// own message, and on its thread.
function boardsTalkOpen(b, c) {
  if (boardsUI.talk.has(c.id) && !boardsUI.talk.get(c.id)) {
    boardsUI.talk.delete(c.id);
    boardsBoxGone(`talk:${c.id}`);
  } else if (!boardsUI.talk.has(c.id)) boardsUI.talk.set(c.id, "");
  boardsRedraw();
  if (boardsUI.talk.has(c.id)) boardsFocusBox(`talk:${c.id}`);
}

function boardsTalkBox(b, c) {
  if (!boardsUI.talk.has(c.id) || b.legacy) return null;
  const name = c.agent_name || "your agent";
  const id = `talk:${c.id}`;
  const box = boardsBox(id, { placeholder: `Tell ${name} about this…`, label: `Comment for ${name}`, value: boardsUI.talk.get(c.id),
    send: (text) => boardsComment(b, c, text), cancel: () => { boardsUI.talk.delete(c.id); boardsBoxGone(id); boardsRedraw(); } });
  box.changed = (text) => boardsUI.talk.set(c.id, text);
  return box;
}

async function boardsComment(b, c, text) {
  text = String(text || "").trim();
  if (!text) return;
  const id = `talk:${c.id}`;
  const box = boardsUI.boxes.get(id);
  boardsUI.said.set(c.id, [...(boardsUI.said.get(c.id) || []), { text, at: Date.now() }]);
  boardsUI.talk.delete(c.id);
  if (box) box.field.value = "";
  boardsBoxGone(id);
  boardsRedraw();
  try {
    await api(machinePath(b.key, "/api/boards/comment"), { board: b.id, card: c.id, text });
    toast(`Sent to ${c.agent_name || "your agent"}`);
  } catch (e) {
    boardsUI.said.set(c.id, (boardsUI.said.get(c.id) || []).filter((x) => x.text !== text));
    boardsUI.talk.set(c.id, text);
    boardsRedraw();
    toast(e.message);
  }
}

// A button that asks you first (a reason): its box, its label on the send.
function boardsAskBox(b, c) {
  const a = boardsUI.ask;
  if (!a || a.card !== c.id || a.key !== b.key) return null;
  const x = (c.buttons || [])[a.n];
  if (!x) return null;
  const id = `ask:${c.id}:${a.n}`;
  const box = boardsBox(id, { placeholder: x.asks, label: `${x.label}: ${x.asks}`, sendLabel: x.label, cls: "ask",
    send: (words) => { if (String(words).trim()) boardsPress(b, c, a.n, String(words).trim()); },
    cancel: () => { boardsUI.ask = null; boardsBoxGone(id); boardsRedraw(); } });
  return h("div", { class: "bbox-ask" }, h("span", { class: "bbox-ask-q" }, `${x.label}: ${x.asks}`), box);
}

// Write a task (Tasks' top): a card of yours on a board (your assistant's,
// or the one you pick), its agent told to help you get it done.
function boardsTargets(v = app.view) {
  const boards = boardsList(v).filter((b) => !b.legacy);
  const out = boards.map((b) => ({ key: b.key, id: b.id, machine: b.machine || "", title: b.task ? b.lead_name : b.title, lead: b.lead_name, row: boardsLeadRow(b) }));
  // Your assistant and every agent, a board of its own or not yet (made with its first task).
  for (const s of (v && v.sessions) || []) {
    if (!isAgent(s) || out.some((t) => t.key === s.id)) continue;
    out.push({ key: s.id, id: s.sid || s.id, machine: s.machine || "", title: s.assistant_name || s.task, lead: s.assistant_name || s.task, row: s });
  }
  const main = ((v && v.sessions) || []).find((s) => s.assistant === "main");
  out.sort((a, b) => (b.key === (main && main.id)) - (a.key === (main && main.id)));
  return out;
}

function boardsTarget(v = app.view) {
  const all = boardsTargets(v);
  const want = boardsUI.target || store.get("board-target");
  return all.find((t) => t.key === want) || all[0] || null;
}

function boardsWriteBox(v) {
  const t = boardsTarget(v);
  if (!t) return null;
  const pick = h("button", { class: "tbtn quiet bwrite-for", type: "button", "aria-haspopup": "menu", "data-dropdown": "board-target",
    title: "Which board it goes on",
    onclick: (e) => {
      e.stopPropagation();
      uiDropdown(e.currentTarget, boardsTargets().map((x) => ({ label: x.title, detail: x.title === x.lead ? "" : `${x.lead}'s board`,
        lead: avatar(x.row, "tiny"), act: () => { boardsUI.target = x.key; store.set("board-target", x.key); boardsRedraw(); boardsFocusBox("write"); } })),
      { label: "Which board", key: "board-target" });
    } }, avatar(t.row, "tiny"), h("span", {}, `For ${t.title}`), glyph("down"));
  const box = boardsBox("write", { placeholder: `Write a task for ${t.lead}…`, label: `A task for ${t.lead}`, value: store.get("draft:task") || "",
    send: (text) => boardsAddTask(boardsTarget(), text), cls: "bwrite" });
  box.field.placeholder = `Write a task for ${t.lead}…`;
  box.changed = (text) => store.set("draft:task", text);
  const node = h("div", { class: "bwrite-wrap" }, box, h("div", { class: "bwrite-under" }, pick));
  node.todayData = JSON.stringify(["write", t.key, t.title, t.lead]);
  return node;
}

async function boardsAddTask(t, text, column = null) {
  text = String(text || "").trim();
  if (!t || !text) return;
  const id = column ? `add:${t.key}:${column}` : "write";
  const box = boardsUI.boxes.get(id);
  if (box) { box.field.value = ""; box.field.dispatchEvent(new Event("input")); }
  if (!column) store.set("draft:task", "");
  try {
    await api(machinePath(t.key, "/api/boards/add"), { board: t.id, text, ...(column ? { column } : {}) });
    toast(t.title === t.lead ? `Sent: ${t.lead} is on it` : `On ${t.title}: ${t.lead} is on it`);
  } catch (e) {
    if (box) { box.field.value = text; box.field.dispatchEvent(new Event("input")); }
    if (!column) store.set("draft:task", text);
    toast(e.message);
  }
}

// A card of yours in a column there (the first, or one of yours), on the board.
function boardsAddBox(b, col) {
  const t = { key: b.key, id: b.id, title: b.title, lead: b.lead_name };
  const box = boardsBox(`add:${b.key}:${col.name}`, { placeholder: `Add a card for ${b.lead_name}…`, label: `A card in ${col.name}`,
    send: (text) => boardsAddTask(t, text, col.name), cls: "badd" });
  return box;
}

// ---- doing: a button, a move, an edit, taking it down

// A card's button: what it asks of you first (its box), then the card says
// so a moment and goes where it goes, with Undo; after that its message goes
// to the agent (waking it). Refused: back where it was, and why.
async function boardsPress(b, c, i, words = "") {
  const x = (c.buttons || [])[i];
  if (!x || boardsUI.pending.has(c.id)) return;
  if (x.asks && !words) {
    boardsUI.ask = { key: b.key, card: c.id, n: i };
    boardsRedraw();
    boardsFocusBox(`ask:${c.id}:${i}`);
    return;
  }
  const askId = boardsUI.ask && boardsUI.ask.card === c.id ? `ask:${c.id}:${boardsUI.ask.n}` : null;
  boardsUI.ask = null;
  const done = b.columns.find((col) => col.done);
  const to = x.to || (x.own && done ? done.name : "");
  const leaves = !!to && to !== c.column;
  const name = c.agent_name || "your agent";
  const card = [...document.querySelectorAll(`.tcard[data-card="${CSS.escape(c.id)}"]`)].find((el) => el.offsetParent);
  if (leaves) {
    boardsUI.pending.set(c.id, { from: c.column, at: Date.now() });
    if (card) {
      card.classList.add("completing");
      card.append(h("div", { class: "tcard-complete", "aria-hidden": "true" }, h("span", { class: "tick" }, glyph("check")), h("b", {}, x.label)));
      await new Promise((r) => setTimeout(r, matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 450));
    }
  }
  const keyed = !!card && card.contains(document.activeElement);
  if (keyed) document.activeElement.blur();
  if (askId) boardsBoxGone(askId);
  boardsRedraw();
  if (keyed && boardOn()) { const go = boardMark(); if (go) boardFocus(go); }
  const back = () => { boardsUI.pending.delete(c.id); boardsRedraw(); };
  const said = [x.label, words].filter(Boolean).join(": ");
  todayUndo(`${said}${x.send ? `: sent to ${name}` : leaves ? ` → ${to}` : ""}`, () => {
    const own = (c.buttons || []).slice(0, i + 1).filter((x) => x.own).length - 1;
    (b.legacy ? api(machinePath(b.key, "/api/tasks/press"), { id: c.id, button: own }, { keepalive: true })
      : api(machinePath(b.key, "/api/boards/press"), { board: b.id, card: c.id, button: i, words }, { keepalive: true }))
      .catch((e) => { back(); toast(e.message); });
  }, back, TODAY_UNDO, { hide: true });
}

// Its menu: Move to (each other column), Take down.
function boardsMenu(b, c, anchor) {
  const items = b.columns.filter((col) => col.name !== c.column).map((col) => ({
    label: `Move to ${col.name}`, detail: col.approval ? "You approve it, as it is now" : col.done ? "Done" : "", icon: col.done ? "check" : "next",
    act: () => boardsMove(b, c, col.name) }));
  items.push({ label: "Take it down", detail: "Off the board (its agent isn't told)", icon: "close", tone: "late", act: () => boardsRemove(b, c) });
  uiDropdown(anchor, items, { label: "Card", key: `card:${c.id}` });
}

function boardsMove(b, c, column) {
  const col = b.columns.find((x) => x.name === column);
  boardsUI.pending.set(c.id, { from: c.column, at: Date.now() });
  boardsRedraw();
  const back = () => { boardsUI.pending.delete(c.id); boardsRedraw(); };
  todayUndo(`${col && col.approval ? "Approved" : "Moved"}: ${c.title} → ${column}`, () => {
    api(machinePath(b.key, "/api/boards/move"), { board: b.id, card: c.id, column }, { keepalive: true })
      .catch((e) => { back(); toast(e.message); });
  }, back, TODAY_UNDO, { hide: true });
}

function boardsRemove(b, c) {
  boardsUI.pending.set(c.id, { from: c.column, at: Date.now() });
  boardsRedraw();
  const back = () => { boardsUI.pending.delete(c.id); boardsRedraw(); };
  todayUndo(`Taken down: ${c.title}`, () => {
    api(machinePath(b.key, "/api/boards/remove"), { board: b.id, card: c.id }, { keepalive: true })
      .catch((e) => { back(); toast(e.message); });
  }, back, TODAY_UNDO_CLOSE, { hide: true });
}

// Edit: its title and its text, in place; for a post, X's count as you
// type (past 280, a warning: Premium takes it). Saved, its approval goes
// (the board's check may refuse it, in its words).
function boardsEditOpen(b, c) {
  boardsUI.edit = { key: b.key, card: c.id, title: c.title, body: c.block ? c.block.body || "" : c.note || "", base: c.sha256 };
  boardsRedraw();
  requestAnimationFrame(() => {
    const f = board.box.querySelector(`.tcard[data-card="${CSS.escape(c.id)}"] .bedit-text`);
    if (f) { f.focus({ preventScroll: true }); uiFitField(f, { max: Math.round(window.innerHeight * 0.6), extra: 2 }); uiReveal(f, { scroller: board.scroll }); }
  });
}

function boardsEditor(b, c) {
  const e = boardsUI.edit;
  const post = c.block && c.block.kind === "xpost";
  const title = h("input", { class: "bedit-title", type: "text", value: e.title, maxlength: "200", "aria-label": "Its title",
    oninput: () => { e.title = title.value; } });
  const text = h("textarea", { class: "bedit-text", "aria-label": post ? "The post" : "Its text", rows: 4 });
  text.value = e.body;
  const count = post ? h("span", { class: "bedit-count", role: "status" }) : null;
  const paint = () => {
    if (!count) return;
    const n = xpostCount(text.value);
    count.textContent = n > XPOST_LIMIT ? `${n}/${XPOST_LIMIT} · over: X Premium takes it` : `${n}/${XPOST_LIMIT}`;
    count.classList.toggle("over", n > XPOST_LIMIT);
  };
  text.addEventListener("input", () => { e.body = text.value; paint(); uiFitField(text, { max: Math.round(window.innerHeight * 0.6), extra: 2 }); });
  const cancel = () => { boardsUI.edit = null; boardsRedraw(); };
  const save = uiButton("Save", () => boardsEditSave(b, c), true, "bedit-save");
  const keys = (ev) => {
    ev.stopPropagation();
    if (ev.key === "Escape") { ev.preventDefault(); cancel(); }
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); boardsEditSave(b, c); }
  };
  title.addEventListener("keydown", keys);
  text.addEventListener("keydown", keys);
  paint();
  return h("div", { class: "bedit" }, title, text,
    h("div", { class: "bedit-foot" }, count, h("span", { class: "bedit-gap" }),
      c.approved ? h("span", { class: "bedit-note" }, "Saving it takes your approval back") : null,
      uiButton("Cancel", cancel, false, "quiet"), save));
}

async function boardsEditSave(b, c) {
  const e = boardsUI.edit;
  if (!e || e.saving) return;
  const body = { board: b.id, card: c.id, base: e.base };
  if (e.title.trim() && e.title.trim() !== c.title) body.title = e.title.trim();
  const was = c.block ? c.block.body || "" : c.note || "";
  if (e.body !== was) body.body = e.body;
  if (!("title" in body) && !("body" in body)) { boardsUI.edit = null; return boardsRedraw(); }
  e.saving = true;
  try {
    await api(machinePath(b.key, "/api/boards/edit"), body);
    boardsUI.edit = null;
    toast(c.approved && "body" in body ? "Saved: not approved any more" : "Saved");
  } catch (err) {
    toast(err.message);
  } finally {
    e.saving = false;
    boardsRedraw();
  }
}

// What a search finds on your boards: the cards that have all its words
// (their title, text, note, agent), of the boards Tasks lists and the ones
// you opened.
function boardsFound(v, words) {
  const out = [];
  for (const b of boardsList(v)) {
    const whole = boardsWhole(b);
    for (const c of (whole || b).cards || []) {
      if (!boardsShown(c)) continue;
      const x = [b.title, c.agent_name, c.title, c.note, c.block ? c.block.body : ""].join(" ").toLowerCase();
      if (words.every((w) => x.includes(w))) out.push({ b: whole ? { ...b, ...whole } : b, c });
    }
  }
  return out;
}

// The boards a chat leads (your assistant's, an agent's): its chat's menu
// opens them (boardsGo: from wherever, the chat left for Tasks).
function boardsLedBy(s) {
  return boardsList().filter((b) => !b.legacy && chatKeyOf(b.machine || "", b.lead) === s.id && (!b.task || b.cards.length || b.yours));
}

function boardsGo(key) {
  closeSheets();
  go(`#/b/${encodeURIComponent(key)}`);
}
