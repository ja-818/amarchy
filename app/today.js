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
  asking: new Set(),    // tasks whose Ask Jaken box is open
  askText: new Map(),   // what you wrote in it, kept across redraws
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
  const someday = loops.filter((l) => l.kind === "someday" || l.kind === "other");
  return { asks, blocked, dueNow, week, later, waiting, chaseNow, main, done, stale, working, idle, someday };
}

// What's your move: the count on Today's tab, the switch, the page's top.
function todayCount(v, only = null) {
  if (!v) return 0;
  const p = todayParts(v);
  const chats = p.asks.length + p.blocked.length, tasks = p.dueNow.length + p.chaseNow.length;
  return only === "chats" ? chats : only === "tasks" ? tasks : chats + tasks;
}

// The one count line: what's your move, what's to close.
function todaySummary(v, only = null) {
  const p = todayParts(v);
  const yours = todayCount(v, only);
  if (only === "tasks") return yours ? `${yours} task${yours === 1 ? "" : "s"} for now` : "No task is due now";
  return [yours ? `${yours} for you to do` : "Nothing waits on you", only !== "tasks" && p.done.length ? `${p.done.length} to close` : ""].filter(Boolean).join(" · ");
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

// ---- drawing: one card for everything
//
// Every item on Today is the same card: a stripe in its color on the left
// (the project's, or the person's for a loop), a head (its project or who,
// its name, and a pill that says where it stands), a body (the question, the
// goal, what it last said), and its actions. Sections are the same too: a
// small head with a count, folded or not.

const TODAY_PILLS = { ask: "Asks you", permission: "Permission", secret: "A secret", blocked: "Blocked", done: "Done",
                      working: "Working" };

function todayPill(text, tone) {
  return h("span", { class: `tpill t-${tone}` }, tone === "working" ? h("span", { class: "spinner" }, SPINNER[spin.frame]) : null, text);
}

// Where a chat stands, as its card's badge says it (the open chat's bar too).
function todayStatePill(s) {
  const t = s.today || {};
  if (s.status === "waiting" || (s.secret_asks || []).length || (s.status !== "working" && (t.asks || []).length && !todayIsAnswered(s)))
    return todayPill(s.permission ? "Permission" : "Asks you", "ask");
  if (s.status === "working") return todayPill("Working", "working");
  if (t.state === "blocked") return todayPill("Blocked", "late");
  if (t.state === "done") return todayPill("Done", "done");
  return todayPill(sleepOf(s) ? statusWords(s) : t.at ? autoPast(t.at) : statusWords(s), "quiet");
}

// A card. head: what opens it (a chat) or opens its text (a loop).
function todayCard({ kind, hue, lead = null, chip = "", title, pill = null, body = [], actions = [], open, id, label }) {
  const head = h("button", { class: "tcard-head today-go", type: "button", onclick: open, "aria-label": label || null },
    lead, chip ? h("span", { class: "tcard-chip" }, chip) : null,
    h("span", { class: "tcard-title" }, typeof title === "string" ? taskText(title) : title), pill);
  return h("article", { class: `tcard k-${kind} ph-${hue}`, "data-id": id || null }, head,
    ...body.filter(Boolean), actions.filter(Boolean).length ? h("div", { class: "tcard-actions" }, ...actions.filter(Boolean)) : null);
}

function todayBtn(label, act, primary = false, cls = "") {
  return h("button", { class: `tbtn${primary ? " primary" : ""}${cls ? ` ${cls}` : ""}`, type: "button", onclick: act }, label);
}

function todayChip(s) { return s.assistant ? s.assistant_name || projectName(s.repo) : projectName(s.repo); }

// A section: its head (a count, folded or not, and an action), its cards.
function todaySection(kind, title, { count = null, fold = null, extra = null } = {}, ...kids) {
  kids = kids.flat().filter(Boolean);
  if (!kids.length) return null;
  const head = h("h2", { class: "tsec-head" }, h("span", { class: "tsec-title" }, title),
    count !== null ? h("span", { class: "tsec-count" }, String(count)) : null, h("span", { class: "tsec-gap" }), extra);
  if (fold === null) return h("section", { class: `tsec today-${kind}` }, head, h("div", { class: "tsec-cards" }, ...kids));
  const isOpen = todayUI.open.has(kind) ? todayUI.open.get(kind) : fold;
  const d = h("details", { class: `tsec today-${kind}`, ...(isOpen ? { open: true } : {}) },
    h("summary", { "aria-label": `${title}, ${count}` }, head), h("div", { class: "tsec-cards" }, ...kids));
  d.addEventListener("toggle", () => todayUI.open.set(kind, d.open));
  return d;
}

// The first few, then "+N more" for the rest.
function todayFirst(key, kids, n = TODAY_SHOW) {
  if (kids.length <= n || todayUI.more.has(key)) return kids;
  return [...kids.slice(0, n), h("button", { class: "tbtn today-more", type: "button",
    onclick: () => { todayUI.more.add(key); todayRedraw(); } }, `${kids.length - n} more`)];
}

// What a chat asks you, answered on its card: its last reply's questions
// with their answers (all picked, they go as one message, after Undo's
// moment), a permission's Allow and Deny, else Answer (a secret, a plan,
// Claude's own question: in the chat, at its card).
function todayAsk(s) {
  const t = s.today || {};
  const qs = s.status !== "waiting" ? (t.asks || []).filter((q) => (q.options || []).length).slice(0, 3) : [];
  const base = { kind: "ask", hue: todayHue(s.repo), chip: todayChip(s), title: s.task || "New chat", open: () => todayOpen(s), id: s.id,
                 lead: s.assistant === "main" ? avatar(s, "small") : null };
  if (!qs.length) {
    const secret = (s.secret_asks || []).length;
    const tone = secret ? "secret" : s.permission ? "permission" : "ask";
    return todayCard({ ...base, pill: todayPill(TODAY_PILLS[tone], "ask"),
      body: [h("p", { class: "tcard-text" }, secret ? "Asks you for a secret" : s.asks || "Needs your answer")],
      actions: s.permission ? [todayBtn("Allow", () => todayPermit(s, "allow"), false, "today-opt"), todayBtn("Deny", () => todayPermit(s, "deny"), false, "today-opt"), todayBtn("Open", () => todayOpen(s))]
                            : [todayBtn("Answer", () => todayOpen(s), true)] });
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
  const body = qs.map((q, i) => h("div", { class: "tcard-q" }, h("p", { class: "tcard-text", html: inline(q.question || "What should it do?") }),
    h("div", { class: "tcard-opts" }, ...q.options.map((o, k) => h("button", {
      class: `tbtn today-opt${st.picks[i] === k ? " chosen" : ""}`, type: "button",
      onclick: () => {
        // One you finish in your own words: in the chat, where you write them.
        if (o.draft || /[:…]\s*$/.test(o.send || "")) return todayOpen(s);
        st.picks[i] = k;
        if (qs.every((_, j) => st.picks[j] !== undefined)) send();
        else todayRedraw();
      } }, o.label)), i === qs.length - 1 ? todayBtn("Other…", () => todayOpen(s), false, "quiet") : null)));
  return todayCard({ ...base, pill: todayPill(TODAY_PILLS.ask, "ask"), body });
}

function todayBlocked(s) {
  return todayCard({ kind: "blocked", hue: todayHue(s.repo), chip: todayChip(s), title: s.task || "New chat", id: s.id,
    open: () => todayOpen(s), pill: todayPill("Blocked", "late"),
    body: [(s.today || {}).goal ? h("p", { class: "tcard-text muted" }, s.today.goal) : null],
    actions: [todayBtn("See why", () => todayOpen(s), true)] });
}

// One of your loops: who (or Due), what (a tap shows all of it), when, and
// Done or Chase for your assistant.
function todayLoop(l, v) {
  const sent = (v.today.sent || {})[l.key] || (todayUI.told.has(l.key) ? { action: todayUI.told.get(l.key) } : null);
  const late = l.kind === "due" ? todayDay(l.due) < 0 : l.chase && todayDay(l.chase) <= 0;
  const name = (v.today.assistant || {}).name || "your assistant";
  const when = l.kind === "waiting" ? (l.chase ? `follow up ${todayWhen(l.chase).replace(/^since /, "")}` : l.since ? `since ${todayAgo(l.since)}` : "")
    : l.kind === "due" ? todayWhen(l.due) : "someday";
  const act = async (action, text) => {
    todayUI.told.set(l.key, action);
    todayUI.asking.delete(l.key);
    todayRedraw();
    try {
      await api("/api/today/loop", { key: l.key, action, text });
      todayUI.askText.delete(l.key);
      toast(action === "done" ? `Told ${name}: done` : action === "chase" ? `${name} drafts the follow-up for you` : `Sent to ${name}`);
    } catch (e) {
      todayUI.told.delete(l.key);
      todayRedraw();
      toast(e.message);
    }
  };
  const can = !!v.today.assistant;
  const open = todayUI.expand.has(l.key);
  const chase = l.kind === "waiting";
  const asking = todayUI.asking.has(l.key);
  const said = { done: `Sent to ${name}: done`, chase: `${name} drafts the follow-up`, ask: `Sent to ${name}` };
  // Its head: who, what (a tap shows all of it). Under it, one line: when (and
  // since), and its buttons: Follow up (your assistant drafts the message to
  // whoever you wait on), Ask (tell your assistant what to do about it), Done.
  const meta = sent ? h("span", { class: "tcard-meta done" }, said[sent.action] || `Sent to ${name}`)
    : h("span", { class: `tcard-meta${late ? " late" : ""}` }, [when, chase && l.since && l.chase ? `asked ${todayAgo(l.since)}` : ""].filter(Boolean).join(" · "));
  const box = asking ? (() => {
    const field = h("textarea", { class: "tcard-ask", rows: 2, placeholder: `What should ${name} do about it?`,
                                  oninput: () => todayUI.askText.set(l.key, field.value),
                                  onkeydown: (e) => {
                                    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (field.value.trim()) act("ask", field.value.trim()); }
                                    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); todayUI.asking.delete(l.key); todayRedraw(); }
                                  } });
    field.value = todayUI.askText.get(l.key) || "";
    requestAnimationFrame(() => { if (field.isConnected && document.activeElement !== field) field.focus({ preventScroll: true }); });
    return h("div", { class: "tcard-askbox" }, field, h("div", { class: "tcard-actions" },
      todayBtn("Cancel", () => { todayUI.asking.delete(l.key); todayRedraw(); }, false, "quiet"),
      todayBtn(`Send to ${name}`, () => { if (field.value.trim()) act("ask", field.value.trim()); }, true)));
  })() : null;
  return todayCard({ kind: chase ? "chase" : l.kind === "due" ? "due" : "someday", hue: chase ? todayHue(l.who) : "due", chip: chase ? l.who : "", id: null,
    title: h("span", { class: `tcard-what${open ? " open" : ""}` }, l.what), label: l.what,
    open: () => { if (open) todayUI.expand.delete(l.key); else todayUI.expand.add(l.key); todayRedraw(); },
    body: [box],
    actions: asking ? [] : [meta, ...(sent || !can ? [] : [
      chase ? h("button", { class: `tbtn${late ? " primary" : ""}`, type: "button", title: `${name} drafts a message to ${l.who || "them"} for you to send`,
                            onclick: () => act("chase") }, "Follow up") : null,
      h("button", { class: "tbtn", type: "button", title: `Tell ${name} what to do about it`, onclick: () => { todayUI.asking.add(l.key); todayRedraw(); } }, `Ask ${name}…`),
      todayBtn("Done", () => act("done"), !chase && late)])] });
}

// A chat: its project, its name, where it stands; its goal (and in Tasks
// what it last said); for one that's done or stalled, Close (and Ask status).
function todayChat(s, kind) {
  const t = s.today || {};
  const main = s.assistant === "main";
  const quiet = t.at ? Math.floor((Date.now() / 1000 - t.at) / 86400) : 0;
  const told = todayUI.told.get(s.id);
  const pill = kind === "done" ? todayPill("Done", "done") : kind === "stale" ? todayPill(`Stalled ${quiet}d`, "warn")
    : kind === "working" || s.status === "working" ? todayPill("Working", "working")
    : main ? todayPill(statusWords(s), "quiet") : t.at ? todayPill(autoPast(t.at), "quiet") : null;
  const said = boardOn() && !main && s.said && kind !== "done" ? s.said : "";
  return todayCard({ kind, hue: todayHue(s.repo), chip: main ? "" : todayChip(s), title: main ? s.assistant_name || s.task : s.task || "New chat",
    lead: main ? avatar(s, "small") : null, id: s.id, open: () => todayOpen(s), pill,
    body: [!main && t.goal ? h("p", { class: "tcard-text" }, t.goal) : null, said ? h("p", { class: "tcard-text muted said" }, said) : null],
    actions: kind === "done" ? [todayBtn("Close", () => todayClose(s), true)]
      : kind === "stale" ? [told ? h("span", { class: "tcard-note" }, told === "nudging" ? "Asking…" : "Asked") : todayBtn("Ask status", () => todayNudge(s)),
                            todayBtn("Close", () => todayClose(s))] : [] });
}

// Today, as nodes. top: with its count line (Tasks, a computer's middle; the
// phone has it in its header). board: each chat a ticket (tasks.js).
// only: "chats" (the chats alone), "tasks" (your loops alone), else both
// (the phone's Today, a computer's middle).
function todayNodes({ board = false, top = true, only = null } = {}) {
  const v = app.view;
  if (!v) return [h("div", { class: "empty" }, app.failed || "Connecting…")];
  const p = todayParts(v);
  const tk = (draw, ...more) => (s) => (board ? boardTicket(s, draw(s, ...more)) : draw(s, ...more));
  const loop = (l) => todayLoop(l, v);
  const hasLoops = !!(v.today && v.today.source);
  const chats = only !== "tasks", tasks = only !== "chats";
  const close = p.done.length;
  const yours = (chats ? p.asks.length + p.blocked.length : 0) + (tasks ? p.dueNow.length + p.chaseNow.length : 0);
  const nodes = [];
  if (top) nodes.push(h("div", { class: "today-summary" }, todaySummary(v, only)));
  if (chats && p.main) nodes.push(tk(todayChat, "assistant")(p.main));      // your assistant, on top
  nodes.push(todaySection("yours", only === "tasks" ? "Now" : "Your move", { count: yours },
    chats ? [p.asks.map(tk(todayAsk)), p.blocked.map(tk(todayBlocked))] : [],
    tasks ? [p.chaseNow.map(loop), p.dueNow.map(loop)] : []));
  if (!yours) nodes.push(h("p", { class: "today-clear" }, glyph("check"),
    chats && close ? ` Nothing waits on you. ${close} to close, below.` : chats && p.stale.length ? ` Nothing waits on you. ${p.stale.length} stalled, below.` : " Nothing waits on you."));
  if (chats) {
    const all = close >= 2 ? h("button", { class: "tbtn quiet today-all", type: "button", onclick: () => todayCloseDone(p.done) }, `Close all ${close} done`) : null;
    nodes.push(todaySection("finish", "Finish", { count: close + p.stale.length, extra: all },
      todayFirst("finish", [...p.done.map(tk(todayChat, "done")), ...p.stale.map(tk(todayChat, "stale"))])));
    nodes.push(todaySection("working", "At work", { count: p.working.length, fold: true }, p.working.map(tk(todayChat, "working"))));
  }
  if (tasks) {
    nodes.push(todaySection("chase", "Waiting on others", { count: p.waiting.length, fold: only === "tasks" }, p.waiting.map(loop)));
    nodes.push(todaySection("week", "Later this week", { count: p.week.length, fold: only === "tasks" }, p.week.map(loop)));
    nodes.push(todaySection("later", "Further out", { count: p.later.length, fold: false }, p.later.map(loop)));
    if (only === "tasks") nodes.push(todaySection("someday", "Someday", { count: p.someday.length, fold: false }, p.someday.map(loop)));
  }
  if (chats) nodes.push(todaySection("idle", "Other chats", { count: p.idle.length, fold: false }, p.idle.map(tk(todayChat, "idle"))));
  if (tasks) {
    if (v.today && v.today.error) nodes.push(h("p", { class: "today-note bad" }, v.today.error));
    if (!hasLoops) nodes.push(h("p", { class: "today-note" }, "Your tasks show here from your loops file: set it in ",
      h("button", { class: "text-btn", type: "button", onclick: () => openSettings() }, "Settings → Today"), "."));
    else if (!v.today.assistant) nodes.push(h("p", { class: "today-note" }, "Make one of your chats your assistant to mark tasks done from here."));
  }
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

function boardTabNow() { return typeof board !== "undefined" && board.tab === "tasks" ? "tasks" : "chats"; }

function boardOn() { return !!app.desk && typeof desk !== "undefined" && desk.mode === "tasks"; }

// Today into its box, if what it shows changed, keeping where it's scrolled to.
function todayFill(box, force) {
  const key = todayKey(app.view);
  if (!force && box.dataset.key === key) return;
  box.dataset.key = key;
  const board = box.classList.contains("board-today");
  const scroller = box.closest(".scroll, .today-scroll, .board-scroll");
  const top = scroller ? scroller.scrollTop : 0;
  keepFocus(box, () => box.replaceChildren(...todayNodes({ board, top: !box.classList.contains("phone-today"), only: board ? boardTabNow() : null })));
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
