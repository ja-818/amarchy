// ---- Today: what to do now, without reading a chat
//
// The app's home (the phone's first tab; on a computer, Tasks: tasks.js).
// One queue, in the order things cost you:
//
// - Your move: what a chat asks you (its question's buttons, a permission's
//   Allow and Deny, a secret), a chat that's blocked, the people to chase
//   today, and your commitments due by tomorrow.
// - Finish: a chat that reached its goal (Close), one stalled for days (Ask
//   status, Close). A chat exists to reach its goal and be closed: closing
//   one with nothing to lose is a tap, with Undo.
// - Waiting: the people you wait on, the chats at work, the rest of your
//   week, the other chats. Folded, but for what's at work.
//
// What you do here goes with an Undo a few seconds long (todayUndo), so a
// thumb's slip costs nothing. A chat says where it stands in the goal block
// each reply ends with (its today: goal, state, asks; bin/amarchy
// chat_reply). Your commitments are your loops file's (amarchy today
// --loops), which Today only reads: Done and Chase go to your assistant,
// which keeps it (loop_tell).

const TODAY_STALE = 2 * 86400;      // s idle before a chat is stalled: Close or Ask status (bin/amarchy STALE_DAYS)
const TODAY_NUDGE = "Where does this stand? Finish what's left for this chat's goal, or tell me what you need from me to close it.";
const TODAY_UNDO = 3500;            // ms an answer waits for Undo before it goes
const TODAY_UNDO_CLOSE = 5000;      // ms a close waits for Undo
const TODAY_SHOW = 5;               // Finish's rows before "+N more"
const todayUI = {
  open: new Map(),      // a fold you opened or closed: its key -> open
  answers: new Map(),   // a chat's questions being answered here: id -> {key, picks}
  told: new Map(),      // a loop or chat acted on here, until the view says so too: key -> what
  sent: new Map(),      // a chat you answered: id -> {key: what it asked then, at}
  closing: new Set(),   // chats closing (their Undo still up): off the page
  more: new Set(),      // lists with "+N more" opened
  expand: new Set(),    // loops whose whole text you opened
  version: 0,           // bumped by what's done here: drawn again (todayFill)
};

// What a chat asks you now, as a key: it changes when it asks something new.
function todayAskKey(s) {
  return JSON.stringify([s.status, s.permission && s.permission.request_id, (s.today || {}).asks || [], (s.secret_asks || []).length]);
}

// You answered it (here, or in its chat): off your move until it asks
// something else (its conversation says so in a second or two; a sleeping
// one takes longer to wake), or two minutes went by.
function todayAnswered(id) {
  const s = rowOf(id);
  todayUI.sent.set(id, { key: s ? todayAskKey(s) : "", at: Date.now() });
  todayUI.version++;
}

function todayIsAnswered(s) {
  const t = todayUI.sent.get(s.id);
  if (!t) return false;
  if (Date.now() - t.at > 120000 || todayAskKey(s) !== t.key) { todayUI.sent.delete(s.id); return false; }
  return true;
}

function rowOf(id) { return app.view && app.view.sessions.find((s) => s.id === id) || null; }

// A toast with Undo: act() runs when it's gone, unless Undo was pressed
// (undone() then). At the bottom on the phone, out of the thumb's way.
function todayUndo(text, act, undone, ms = TODAY_UNDO) {
  document.querySelectorAll(".toast:not(.stay), .undo-toast").forEach((t) => { if (t.flush) t.flush(); else t.remove(); });
  let timer = null;
  const el = h("div", { class: "toast stay undo-toast", role: "status" }, h("span", {}, text),
    h("button", { class: "text-btn", type: "button", onclick: () => { clearTimeout(timer); el.remove(); if (undone) undone(); } }, "Undo"));
  // Another one now: this one goes at once, not lost.
  el.flush = () => { clearTimeout(timer); el.remove(); act(); };
  document.body.append(el);
  timer = setTimeout(() => { el.remove(); act(); }, ms);
}

// ---- the facts

function todayDay(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y) return null;
  const day = new Date(y, m - 1, d), now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((day - now) / 86400000);
}

// A loop's date as said: "2 days late", "today", "tomorrow", "Thu 29 Oct".
function todayWhen(iso) {
  const n = todayDay(iso);
  if (n === null) return "";
  if (n < -1) return `${-n} days late`;
  if (n === -1) return "since yesterday";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], n < 7 ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" });
}

// A day gone by, as said: "today", "yesterday", "4 days ago".
function todayAgo(iso) {
  const n = todayDay(iso);
  if (n === null) return "";
  return n >= 0 ? "today" : n === -1 ? "yesterday" : `${-n} days ago`;
}

// Each project its own color, the same everywhere (one of the theme's hues,
// by its name), so you tell them apart at a glance.
const TODAY_HUES = 7;
function todayHue(repo) {
  let n = 0;
  for (const c of String(repo || "")) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return n % TODAY_HUES;
}

function projectChip(s) {
  const name = s.assistant ? s.assistant_name || projectName(s.repo) : projectName(s.repo);
  return h("span", { class: `pchip ph-${todayHue(s.repo)}`, title: `In ${projectName(s.repo)}`, "aria-label": `Project: ${name}` }, name);
}

// In order: higher priority first, then your projects' order, then the newest.
function todaySort(v, ss) {
  const rank = new Map(((v.projects || []).map((p) => p.name)).map((name, i) => [name, i]));
  const prio = { high: 0, normal: 1, low: 2 };
  return ss.slice().sort((a, b) => (prio[a.priority] ?? 1) - (prio[b.priority] ?? 1)
    || (rank.get(a.repo) ?? 99) - (rank.get(b.repo) ?? 99)
    || ((b.today || {}).at || 0) - ((a.today || {}).at || 0));
}

// The chats and loops, sorted into Today's parts.
function todayParts(v) {
  const ss = todaySort(v, (v.sessions || []).filter((s) => !s.setup && !todayUI.closing.has(s.id)));
  const loops = (v.today && v.today.loops) || [];
  const isMain = (s) => s.assistant === "main";
  const now = Date.now() / 1000;
  const asks = ss.filter((s) => !todayIsAnswered(s) && (s.status === "waiting" || (s.secret_asks || []).length
    || (s.status !== "working" && ((s.today || {}).asks || []).length)));
  const blocked = ss.filter((s) => !asks.includes(s) && s.status !== "working" && (s.today || {}).state === "blocked");
  const due = loops.filter((l) => l.kind === "due" && l.due).sort((a, b) => a.due.localeCompare(b.due));
  const dueNow = due.filter((l) => todayDay(l.due) <= 1);
  const week = due.filter((l) => todayDay(l.due) > 1 && todayDay(l.due) <= 7);
  const later = due.filter((l) => todayDay(l.due) > 7);
  const waitingAll = loops.filter((l) => l.kind === "waiting").sort((a, b) => (a.chase || "9").localeCompare(b.chase || "9"));
  const chaseNow = waitingAll.filter((l) => l.chase && todayDay(l.chase) <= 0);
  const waiting = waitingAll.filter((l) => !chaseNow.includes(l));
  const main = ss.find((s) => isMain(s) && !asks.includes(s)) || null;
  const rest = ss.filter((s) => !asks.includes(s) && !blocked.includes(s) && !isMain(s));
  const done = rest.filter((s) => s.status !== "working" && (s.today || {}).state === "done");
  const quietFor = (s) => now - ((s.today || {}).at || 0);
  const stale = rest.filter((s) => !done.includes(s) && s.status !== "working" && (s.today || {}).at && quietFor(s) > TODAY_STALE)
    .sort((a, b) => quietFor(b) - quietFor(a));
  const working = rest.filter((s) => s.status === "working");
  const idle = rest.filter((s) => !done.includes(s) && !stale.includes(s) && !working.includes(s));
  return { asks, blocked, dueNow, week, later, waiting, chaseNow, main, done, stale, working, idle };
}

// What's your move: the count on Today's tab, the switch, the page's top.
function todayCount(v) {
  if (!v) return 0;
  const p = todayParts(v);
  return p.asks.length + p.blocked.length + p.dueNow.length + p.chaseNow.length;
}

// The one count line: what's your move, what's to close.
function todaySummary(v) {
  const p = todayParts(v);
  const yours = p.asks.length + p.blocked.length + p.dueNow.length + p.chaseNow.length;
  return [yours ? `${yours} for you to do` : "Nothing waits on you", p.done.length ? `${p.done.length} to close` : ""].filter(Boolean).join(" · ");
}

// ---- doing

function todayOpen(s) {
  if (boardOn()) return boardOpen(s.id);      // Tasks: the whole window (tasks.js)
  if (app.desk && typeof go2 === "function") return go2(s.id);
  app.fromToday = s.id;      // sent there, the phone comes back here (app.js SessionView)
  go(`#/s/${encodeURIComponent(s.id)}`);
}

// Close it: at once, with Undo, when nothing would be lost; else asked, as
// any close is (app.js confirmClose says what would go).
async function todayClose(s) {
  let c;
  try {
    const res = await fetch(`/api/session/${encodeURIComponent(s.id)}/closing`);
    c = await res.json();
    if (!res.ok) throw new Error(c.error || "Amarchy didn't answer");
  } catch (e) {
    return toast(e instanceof TypeError ? "Can't reach Amarchy" : e.message);
  }
  if (c.changes || c.amarchy) return confirmClose(s, c);
  todayCloseNow([s]);
}

// These close, after their Undo (off the page meanwhile).
function todayCloseNow(ss) {
  ss.forEach((s) => todayUI.closing.add(s.id));
  todayRedraw();
  const back = () => { ss.forEach((s) => todayUI.closing.delete(s.id)); todayRedraw(); };
  const what = ss.length === 1 ? `Closed ${ss[0].task || "the chat"}` : `Closed ${ss.length} chats`;
  todayUndo(what, async () => {
    const failed = [];
    for (const s of ss) {
      try {
        await api(`/api/session/${encodeURIComponent(s.id)}/close`, { discard: false });
      } catch (e) {
        failed.push(`${s.task || s.name}: ${e.message}`);
        todayUI.closing.delete(s.id);
      }
    }
    if (failed.length) { toast(`Didn't close ${failed.join("; ")}`); todayRedraw(); }
    // Gone from the list by then: forgotten here too.
    setTimeout(() => ss.forEach((s) => { if (!rowOf(s.id)) todayUI.closing.delete(s.id); }), 8000);
  }, back, TODAY_UNDO_CLOSE);
}

// Close every done chat: the ones with nothing to lose at once (one Undo),
// the first of the rest asked.
async function todayCloseDone(ss) {
  const quick = [], ask = [];
  for (const s of ss) {
    try {
      const c = await (await fetch(`/api/session/${encodeURIComponent(s.id)}/closing`)).json();
      (c.changes || c.amarchy ? ask : quick).push([s, c]);
    } catch (e) {
      return toast("Can't reach Amarchy");
    }
  }
  if (quick.length) todayCloseNow(quick.map(([s]) => s));
  if (ask.length) confirmClose(ask[0][0], ask[0][1]);
}

// Ask a stalled chat where it stands.
async function todayNudge(s) {
  todayUI.told.set(s.id, "nudging");
  todayRedraw();
  try {
    await api(`/api/session/${encodeURIComponent(s.id)}/send`, { text: TODAY_NUDGE });
    todayUI.told.set(s.id, "nudge");
  } catch (e) {
    todayUI.told.delete(s.id);
    toast(e.message);
  }
  todayRedraw();
}

// A permission answered from here: Allow or Deny, with Undo.
function todayPermit(s, choice) {
  const p = s.permission;
  if (!p) return todayOpen(s);
  todayAnswered(s.id);
  todayRedraw();
  todayUndo(`${choice === "allow" ? "Allowed" : "Denied"}: ${s.task || "the chat"}`, () => {
    api(`/api/session/${encodeURIComponent(s.id)}/answer`, { request_id: p.request_id, choice })
      .catch((e) => { todayUI.sent.delete(s.id); todayRedraw(); toast(e.message); });
  }, () => { todayUI.sent.delete(s.id); todayRedraw(); });
}

// ---- drawing

function todayFold(key, title, count, kids, open = false) {
  if (!kids.length) return null;
  const isOpen = todayUI.open.has(key) ? todayUI.open.get(key) : open;
  const d = h("details", { class: "today-fold", ...(isOpen ? { open: true } : {}) },
    h("summary", { "aria-label": `${title}, ${count}` }, h("span", { class: "today-fold-title" }, title),
      count !== null ? h("span", { class: "today-count" }, String(count)) : null),
    h("div", { class: "today-rows" }, ...kids));
  d.addEventListener("toggle", () => todayUI.open.set(key, d.open));
  return d;
}

// The first few, then "+N more" for the rest.
function todayFirst(key, kids, n = TODAY_SHOW) {
  if (kids.length <= n || todayUI.more.has(key)) return kids;
  return [...kids.slice(0, n), h("button", { class: "text-btn today-more", type: "button",
    onclick: () => { todayUI.more.add(key); todayRedraw(); } }, `+${kids.length - n} more`)];
}

function todaySection(kind, title, extra, ...kids) {
  kids = kids.flat().filter(Boolean);
  if (!kids.length) return null;
  return h("section", { class: `today-part today-${kind}` }, h("h2", { class: "today-head" }, h("span", {}, title), extra || null), ...kids);
}

// A chat's head: its mark (? when it asks you, the bell for a permission,
// else its state), its project and its name on one line, a tap opening it.
function todayChatName(s, asking) {
  const main = s.assistant === "main";
  const mark = main ? avatar(s, "small")
    : asking ? h("span", { class: `today-mark${s.status === "waiting" ? " bell" : ""}`, "aria-label": "Asks you" }, s.status === "waiting" ? glyph("waiting") : "?")
    : stateIcon(s);
  return h("button", { class: "today-chat today-go", type: "button", onclick: () => todayOpen(s) },
    mark, main ? null : projectChip(s), taskText(main ? s.assistant_name || "Assistant" : s.task || "New chat"), glyph("next", "go"));
}

// What a chat asks you, answered here: its last reply's questions with their
// buttons (all of them picked, they go as one message, after Undo's
// moment), a permission's Allow and Deny, else Answer (a secret, a plan,
// Claude's own question: in the chat, at its card).
function todayAsk(s) {
  const t = s.today || {};
  const qs = s.status !== "waiting" ? (t.asks || []).filter((q) => (q.options || []).length).slice(0, 3) : [];
  const card = h("article", { class: "today-card ask" }, todayChatName(s, true));
  if (!qs.length) {
    const what = (s.secret_asks || []).length ? "Asks you for a secret" : s.asks || "Needs your answer";
    card.append(h("p", { class: "today-q" }, what), h("div", { class: "today-btns" },
      s.permission ? h("button", { class: "control today-opt", type: "button", onclick: () => todayPermit(s, "allow") }, "Allow") : null,
      s.permission ? h("button", { class: "control today-opt", type: "button", onclick: () => todayPermit(s, "deny") }, "Deny") : null,
      h("button", { class: "control", type: "button", onclick: () => todayOpen(s) }, s.permission ? "Open" : "Answer")));
    return card;
  }
  const key = JSON.stringify(qs);
  let st = todayUI.answers.get(s.id);
  if (!st || st.key !== key) todayUI.answers.set(s.id, st = { key, picks: {} });
  const send = () => {
    const text = qs.map((q, i) => (st.picks[i] === undefined ? null : q.options[st.picks[i]]))
      .filter(Boolean).map((o) => String(o.send || o.label)).join("\n\n");
    if (!text.trim()) return;
    todayAnswered(s.id);
    todayRedraw();
    todayUndo(`Sent to ${s.task || "the chat"}`, () => {
      todayUI.answers.delete(s.id);
      api(`/api/session/${encodeURIComponent(s.id)}/send`, { text })
        .catch((e) => { todayUI.sent.delete(s.id); todayRedraw(); toast(e.message); });
    }, () => { todayUI.sent.delete(s.id); st.picks = {}; todayRedraw(); });
  };
  qs.forEach((q, i) => {
    card.append(h("p", { class: "today-q", html: inline(q.question || "What should it do?") }),
      h("div", { class: "today-btns" }, ...q.options.map((o, k) => h("button", {
        class: `control today-opt${st.picks[i] === k ? " chosen" : ""}`, type: "button",
        onclick: () => {
          // One you finish in your own words: in the chat, where you write them.
          if (o.draft || /[:…]\s*$/.test(o.send || "")) return todayOpen(s);
          st.picks[i] = k;
          if (qs.every((_, j) => st.picks[j] !== undefined)) send();
          else todayRedraw();
        } }, o.label)), h("button", { class: "control", type: "button", onclick: () => todayOpen(s) }, "Other…")));
  });
  return card;
}

function todayBlocked(s) {
  return h("article", { class: "today-card blocked" }, todayChatName(s),
    h("p", { class: "today-q" }, h("b", {}, "Blocked"), (s.today || {}).goal ? ` · ${s.today.goal}` : ""),
    h("div", { class: "today-btns" }, h("button", { class: "control", type: "button", onclick: () => todayOpen(s) }, "See why")));
}

// One of your loops: who (a label), what (a tap shows all of it), when, and
// Done or Chase for your assistant.
function todayLoop(l, v) {
  const sent = (v.today.sent || {})[l.key] || (todayUI.told.has(l.key) ? { action: todayUI.told.get(l.key) } : null);
  const late = l.kind === "due" ? todayDay(l.due) < 0 : l.chase && todayDay(l.chase) <= 0;
  const name = (v.today.assistant || {}).name || "your assistant";
  const meta = l.kind === "waiting"
    ? [l.since ? `asked ${todayAgo(l.since)}` : "", l.chase ? `chase ${todayWhen(l.chase).replace(/^since /, "")}` : ""].filter(Boolean).join(" · ")
    : todayWhen(l.due);
  const act = async (action) => {
    todayUI.told.set(l.key, action);
    todayRedraw();
    try {
      await api("/api/today/loop", { key: l.key, action });
      toast(action === "done" ? `Told ${name}: done` : `${name} drafts the chase`);
    } catch (e) {
      todayUI.told.delete(l.key);
      todayRedraw();
      toast(e.message);
    }
  };
  const can = !!v.today.assistant;
  const btns = sent
    ? h("span", { class: "today-sent" }, sent.action === "chase" ? `${name} drafts it` : `Sent to ${name}`)
    : h("span", { class: "today-btns inline" },
      l.kind === "waiting" && can ? h("button", { class: "control", type: "button", onclick: () => act("chase") }, "Chase") : null,
      can ? h("button", { class: "control", type: "button", title: `Tell ${name} it's done`, onclick: () => act("done") }, glyph("check"), "Done") : null);
  const open = todayUI.expand.has(l.key);
  return h("div", { class: `today-loop${late ? " late" : ""}${sent ? " sent" : ""}` },
    h("button", { class: `today-loop-text${open ? " open" : ""}`, type: "button", "aria-expanded": String(open),
                  onclick: () => { if (open) todayUI.expand.delete(l.key); else todayUI.expand.add(l.key); todayRedraw(); } },
      h("span", { class: "what" }, l.who ? h("span", { class: "who" }, l.who) : null, l.what),
      meta ? h("small", { class: late ? "late" : "" }, meta) : null),
    btns);
}

// A chat in a line: its project and name, its state and goal (and in Tasks
// what it last said), and for one that's done or stalled, Close (and Ask
// status).
function todayChat(s, kind) {
  const t = s.today || {};
  const since = t.at ? autoPast(t.at) : "";
  const told = todayUI.told.get(s.id);
  const btns = kind === "done" || kind === "stale"
    ? h("span", { class: "today-btns inline" },
      kind === "stale" ? (told ? h("span", { class: "today-sent" }, told === "nudging" ? "Asking…" : "Asked")
        : h("button", { class: "control", type: "button", onclick: () => todayNudge(s) }, "Ask status")) : null,
      h("button", { class: "control", type: "button", onclick: () => todayClose(s) }, "Close"))
    : null;
  const quiet = t.at ? Math.floor((Date.now() / 1000 - t.at) / 86400) : 0;
  const word = kind === "done" ? "Done" : kind === "stale" ? `Stalled ${quiet} days` : kind === "working" || kind === "assistant" ? statusWords(s) : since;
  const main = s.assistant === "main";
  return h("div", { class: `today-line ${kind}` },
    h("button", { class: "today-line-main today-go", type: "button", onclick: () => todayOpen(s) },
      main ? avatar(s, "small") : stateIcon(s),
      h("span", { class: "text" }, h("span", { class: "today-line-top" }, main ? null : projectChip(s), taskText(main ? s.assistant_name || s.task : s.task || "New chat")),
        h("small", {}, [word, main ? "" : t.goal].filter(Boolean).join(" · ")),
        // Tasks: what it last said, so a ticket says where it is before you open it.
        boardOn() && !main && s.said && kind !== "done" ? h("span", { class: "today-said" }, s.said) : null)),
    btns);
}

// Today, as nodes. top: with its count line (Tasks, a computer's middle; the
// phone has it in its header). board: each chat a ticket (tasks.js).
function todayNodes({ board = false, top = true } = {}) {
  const v = app.view;
  if (!v) return [h("div", { class: "empty" }, app.failed || "Connecting…")];
  const p = todayParts(v);
  const tk = (draw, ...more) => (s) => (board ? boardTicket(s, draw(s, ...more)) : draw(s, ...more));
  const hasLoops = !!(v.today && v.today.source);
  const yours = p.asks.length + p.blocked.length + p.dueNow.length + p.chaseNow.length;
  const close = p.done.length;
  const nodes = [];
  if (top) nodes.push(h("div", { class: "today-summary" }, todaySummary(v)));
  if (p.main) nodes.push(tk(todayChat, "assistant")(p.main));      // your assistant, a line on top
  nodes.push(todaySection("yours", "Your move", null,
    p.asks.map(tk(todayAsk)), p.blocked.map(tk(todayBlocked)),
    p.chaseNow.length ? h("div", { class: "today-card loops" }, h("div", { class: "today-k" }, `Chase today · ${p.chaseNow.length}`), ...p.chaseNow.map((l) => todayLoop(l, v))) : null,
    p.dueNow.length ? h("div", { class: "today-card loops" }, h("div", { class: "today-k" }, `Due · ${p.dueNow.length}`), ...p.dueNow.map((l) => todayLoop(l, v))) : null));
  if (!yours) nodes.push(h("p", { class: "today-clear" }, glyph("check"),
    close ? ` Nothing waits on you. ${close} to close, below.` : p.stale.length ? ` Nothing waits on you. ${p.stale.length} stalled, below.` : " Nothing waits on you."));
  const all = close >= 2 ? h("button", { class: "text-btn today-all", type: "button", onclick: () => todayCloseDone(p.done) }, `Close all ${close} done`) : null;
  nodes.push(todaySection("finish", "Finish", all,
    todayFirst("finish", [...p.done.map(tk(todayChat, "done")), ...p.stale.map(tk(todayChat, "stale"))])));
  nodes.push(todaySection("theirs", "Waiting", null,
    todayFold("working", "At work", p.working.length, p.working.map(tk(todayChat, "working")), true),
    todayFold("chase", "On others", p.waiting.length, p.waiting.map((l) => todayLoop(l, v))),
    todayFold("week", "Later this week", p.week.length, p.week.map((l) => todayLoop(l, v))),
    todayFold("later", "Further out", p.later.length, p.later.map((l) => todayLoop(l, v))),
    todayFold("idle", "Other chats", p.idle.length, p.idle.map(tk(todayChat, "idle")))));
  if (v.today && v.today.error) nodes.push(h("p", { class: "today-note bad" }, v.today.error));
  if (!hasLoops) nodes.push(h("p", { class: "today-note" }, "Your commitments can show here too: set your loops file in ",
    h("button", { class: "text-btn", type: "button", onclick: () => openSettings() }, "Settings → Today"), "."));
  else if (!v.today.assistant) nodes.push(h("p", { class: "today-note" }, "Make one of your chats your assistant to mark loops done from here."));
  return nodes.filter(Boolean);
}

// What Today shows of the view: drawn again only when it changes (each
// second the list may change for something Today doesn't show, and a page
// drawn again under your finger stops its scroll), or every minute (its
// times: "since yesterday", "Stalled 3 days").
function todayKey(v) {
  if (!v) return `off|${app.failed}`;
  const said = boardOn();
  return JSON.stringify([todayUI.version, Math.floor(Date.now() / 60000), v.today, v.needs,
    (v.sessions || []).map((s) => [s.id, s.task, s.status, s.setup, s.sleeping, s.waking, s.unseen, s.asks, s.today, s.permission,
                                   (s.secret_asks || []).length, s.assistant, s.assistant_name, s.picture, s.priority, said ? s.said : ""])]);
}

function boardOn() { return !!app.desk && typeof desk !== "undefined" && desk.mode === "tasks"; }

// Today into its box, if what it shows changed, keeping where it's scrolled to.
function todayFill(box, force) {
  const key = todayKey(app.view);
  if (!force && box.dataset.key === key) return;
  box.dataset.key = key;
  const board = box.classList.contains("board-today");
  const scroller = box.closest(".scroll, .today-scroll, .board-scroll");
  const top = scroller ? scroller.scrollTop : 0;
  keepFocus(box, () => box.replaceChildren(...todayNodes({ board, top: !box.classList.contains("phone-today") })));
  if (scroller) scroller.scrollTop = top;
}

// Drawn again where it shows: something was done here.
function todayRedraw() {
  todayUI.version++;
  for (const box of document.querySelectorAll(".today")) todayFill(box);
  if (!app.desk && !app.session && app.listEl) renderList();      // the header's count
  if (app.desk && typeof modeButtons === "function") modeButtons();
}

// A box Today fills, kept drawn by the list's changes (app.js refresh).
function todayBox() {
  const box = h("div", { class: "today" });
  todayFill(box);
  return box;
}

// Settings → Today: the loops file.
function todaySettings() {
  const v = app.view || {};
  const field = h("input", { type: "text", placeholder: "~/notes/loops.md", value: (v.today && v.today.source) || "",
                             autocomplete: "off", autocorrect: "off", autocapitalize: "off", spellcheck: "false" });
  const save = h("button", { class: "control", type: "button", onclick: async () => {
    save.disabled = true;
    try {
      const d = await api("/api/today/loops", { path: field.value });
      toast(d.source ? "Today reads your loops from there" : "No loops file: Today shows your chats");
    } catch (e) {
      toast(e.message);
    }
    save.disabled = false;
  } }, "Save");
  return [h("div", { class: "section" }, "Today"),
    h("p", {}, "Your home page: what needs you, what's due, who to chase, and the chats to finish. Your commitments come from a loops file, one per line (- [ ] 2026-10-30 · what, - [ ] waiting · who · what · chase 10-30). Today only reads it: Done and Chase go to your assistant, which keeps it."),
    h("div", { class: "today-setting" }, field, save)];
}
