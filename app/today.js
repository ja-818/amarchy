// ---- Today: what to do now, without reading a chat
//
// The app's home (the phone's first tab; on a computer, the board: tasks.js).
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
// At work: a chat working, or one whose turn ended while something it
// started still runs ("Running · the e2e tests": a test run, a helper; its
// Claude goes on when that ends). Neither is done, new or stalled, and
// neither offers Complete mission: closing it would stop the run halfway.
//
// What you do here goes with an Undo a few seconds long (todayUndo), so a
// thumb's slip costs nothing. A chat says where it stands in the goal block
// each reply ends with (its today: goal, state, asks; bin/amarchy
// chat_reply). Your commitments are your loops file's (amarchy today
// --loops), which Today only reads: Done, Chase, Ask and New chat go to your
// assistant, which keeps it (loop_tell).

const TODAY_STALE = 2 * 86400;      // s idle before a chat is stalled: Close or Ask status (bin/amarchy STALE_DAYS)
const TODAY_NUDGE = "Where does this stand? Finish what's left for this chat's goal, or tell me what you need from me to close it.";
const TODAY_UNDO = 3500;            // ms an answer waits for Undo before it goes
const TODAY_UNDO_CLOSE = 5000;      // ms a close waits for Undo
const TODAY_SHOW = 5;               // Finish's rows before "+N more"
const todayUI = {
  asking: new Map(),    // tasks whose box is open: key -> "ask" (Ask Jaken) or "session" (New chat)
  askText: new Map(),   // what you wrote in it, kept across redraws
  answers: new Map(),   // a chat's questions being answered here: id -> {key, picks}
  told: new Map(),      // a loop or chat acted on here, until the view says so too: key -> what
  sent: new Map(),      // a chat you answered: id -> {key: what it asked then, at}
  closing: new Set(),   // chats closing (their Undo still up): off the page
  more: new Set(),      // lists with "+N more" opened
  seen: new Set(),      // chats you marked seen here (until the view says so)
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

// It didn't go after all (the server refused it): its card asks again.
function todayUnsent(id) {
  if (!todayUI.sent.delete(id)) return;
  todayRedraw();
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

// In order: higher priority first, then your projects' order, then the
// newest reply (not the last thing done: a chat at work does something every
// second, and the cards would trade places under your finger).
function todaySort(v, ss) {
  const rank = new Map(((v.projects || []).map((p) => p.name)).map((name, i) => [name, i]));
  const prio = { high: 0, normal: 1, low: 2 };
  const when = (s) => (s.today || {}).goal_at || (s.today || {}).at || 0;
  return ss.slice().sort((a, b) => (prio[a.priority] ?? 1) - (prio[b.priority] ?? 1)
    || (rank.get(a.repo) ?? 99) - (rank.get(b.repo) ?? 99)
    || when(b) - when(a) || (a.id < b.id ? -1 : 1));
}

// At work: Claude working, or what it started running (status "running":
// bin/amarchy session_view). A dev server it left serving doesn't count.
function todayBusy(s) { return s.status === "working" || s.status === "running"; }

// The chats and loops, sorted into Today's parts.
function todayParts(v) {
  const ss = todaySort(v, (v.sessions || []).filter((s) => !s.setup && !todayUI.closing.has(s.id)));
  const loops = (v.today && v.today.loops) || [];
  const isMain = (s) => s.assistant === "main";
  const now = Date.now() / 1000;
  const asks = ss.filter((s) => !todayIsAnswered(s) && (s.status === "waiting" || (s.secret_asks || []).length
    || (s.status !== "working" && ((s.today || {}).asks || []).length)));
  const blocked = ss.filter((s) => !asks.includes(s) && !todayBusy(s) && (s.today || {}).state === "blocked");
  const due = loops.filter((l) => l.kind === "due" && l.due).sort((a, b) => a.due.localeCompare(b.due));
  const dueNow = due.filter((l) => todayDay(l.due) <= 1);
  const week = due.filter((l) => todayDay(l.due) > 1 && todayDay(l.due) <= 7);
  const later = due.filter((l) => todayDay(l.due) > 7);
  const waitingAll = loops.filter((l) => l.kind === "waiting").sort((a, b) => (a.chase || "9").localeCompare(b.chase || "9"));
  const chaseNow = waitingAll.filter((l) => l.chase && todayDay(l.chase) <= 0);
  const waiting = waitingAll.filter((l) => !chaseNow.includes(l));
  const main = ss.find((s) => isMain(s) && !asks.includes(s)) || null;
  // Finished a turn you haven't opened: it needs you too (to see what it did).
  const fresh = ss.filter((s) => !asks.includes(s) && !blocked.includes(s) && !isMain(s) && !todayBusy(s) && s.unseen && !todayUI.seen.has(s.id));
  const rest = ss.filter((s) => !asks.includes(s) && !blocked.includes(s) && !fresh.includes(s) && !isMain(s));
  const done = rest.filter((s) => !todayBusy(s) && (s.today || {}).state === "done");
  const quietFor = (s) => now - ((s.today || {}).at || 0);
  const stale = rest.filter((s) => !done.includes(s) && !todayBusy(s) && (s.today || {}).at && quietFor(s) > TODAY_STALE)
    .sort((a, b) => quietFor(b) - quietFor(a));
  const working = rest.filter(todayBusy);
  const idle = rest.filter((s) => !done.includes(s) && !stale.includes(s) && !working.includes(s));
  const someday = loops.filter((l) => l.kind === "someday" || l.kind === "other");
  // Ready: every other chat, stalled ones among them (as the list orders them).
  const ready = rest.filter((s) => !done.includes(s) && !working.includes(s));
  return { asks, blocked, fresh, dueNow, week, later, waiting, chaseNow, main, done, stale, working, idle, ready, someday };
}

// What's your move: the count on Today's tab, the switch, the page's top.
function todayCount(v, only = null) {
  if (!v) return 0;
  const p = todayParts(v);
  const chats = p.asks.length + p.blocked.length + p.fresh.length, tasks = p.dueNow.length + p.chaseNow.length;
  return only === "chats" ? chats : only === "tasks" ? tasks : chats + tasks;
}

// The one count line: what's your move, what's to close.
function todaySummary(v, only = null) {
  const p = todayParts(v);
  const yours = todayCount(v, only);
  if (only === "tasks") return yours ? `${yours} task${yours === 1 ? "" : "s"} for now` : "No task is due now";
  return [yours ? `${yours} need${yours === 1 ? "s" : ""} you` : "Nothing needs you", only !== "tasks" && p.done.length ? `${p.done.length} done` : ""].filter(Boolean).join(" · ");
}

// ---- doing

function todayOpen(s) {
  boardOpen(s.id);      // over the board: a computer's whole window, the phone's screen (tasks.js)
}

// Close it: at once, with Undo, when nothing would be lost; else asked, as
// any close is (app.js confirmClose says what would go).
async function todayClose(s, said = "", asked = null) {
  let c;
  try {
    c = await (asked || todayClosing(s));
  } catch (e) {
    return toast(e instanceof TypeError ? "Can't reach Amarchy" : e.message);
  }
  // Uncommitted work, amarchy running from it, or a run that hasn't ended (it would stop halfway): asked first.
  if (c.changes || c.amarchy || (c.running || []).length) { todayRedraw(); return confirmClose(s, c); }
  todayCloseNow([s], said);
}

// What closing it would lose (uncommitted work, a run that hasn't ended), from the server.
async function todayClosing(s) {
  const res = await fetch(`/api/session/${encodeURIComponent(s.id)}/closing`);
  const c = await res.json();
  if (!res.ok) throw new Error(c.error || "Amarchy didn't answer");
  return c;
}

// These close, after their Undo (off the page meanwhile).
function todayCloseNow(ss, said = "") {
  ss.forEach((s) => todayUI.closing.add(s.id));
  ss.forEach((s) => todayLeave(s.id));
  todayRedraw();
  missionComplete(ss, ss.length === 1 ? ss[0].task || "Your chat" : `${ss.length} chats`);
  const back = () => { ss.forEach((s) => todayUI.closing.delete(s.id)); missionUndo(ss); };
  const what = said || (ss.length === 1 ? `Mission complete: ${ss[0].task || "the chat"}` : `Mission complete: ${ss.length} chats`);
  todayUndo(what, async () => {
    const failed = [];
    for (const s of ss) {
      try {
        await api(`/api/session/${encodeURIComponent(s.id)}/close`, { discard: false });
      } catch (e) {
        failed.push(`${s.task || s.name}: ${e.message}`);
        todayUI.closing.delete(s.id);
        missionUndo([s]);
      }
    }
    if (failed.length) { toast(`Didn't close ${failed.join("; ")}`); todayRedraw(); }
    // Gone from the list by then: forgotten here too.
    setTimeout(() => ss.forEach((s) => { if (!rowOf(s.id)) todayUI.closing.delete(s.id); }), 8000);
  }, back, TODAY_UNDO_CLOSE);
}

// A chat completed while it's open: back home, with every chat, at once
// (not when its close reaches the server): on a computer the board, on the
// phone its home.
function todayLeave(id) {
  if (app.desk) { if (typeof desk !== "undefined" && desk.current === id) boardBack(true); }
  else if (app.session && app.session.id === id) go("#/");
}

// Close every done chat: the ones with nothing to lose at once (one Undo),
// the first of the rest asked.
async function todayCloseDone(ss) {
  const quick = [], ask = [];
  let all;
  try {
    all = await Promise.all(ss.map((s) => todayClosing(s)));      // all asked at once
  } catch (e) {
    return toast(e instanceof TypeError ? "Can't reach Amarchy" : e.message);
  }
  ss.forEach((s, i) => { const c = all[i]; (c.changes || c.amarchy || (c.running || []).length ? ask : quick).push([s, c]); });
  if (quick.length) todayCloseNow(quick.map(([s]) => s), quick.length === 1 ? `Mission complete: ${quick[0][0].task || "the chat"}` : `Mission complete: ${quick.length} chats`);
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
// Every item on Today is the same card, one surface: a head (its project or
// who in its color, its name, and a pill that says where it stands), a body
// (the question, the goal, what it last said), and its actions. The whole of
// it lights under the pointer and under the keys, as one. Sections are the
// same too: a small head with a count, folded or not.

const TODAY_PILLS = { ask: "Asks you", permission: "Permission", secret: "A secret", blocked: "Blocked", done: "Done",
                      working: "Working" };

// What it runs while its turn is over: "Running · Run the e2e tests", cut
// short with "…" where the card is narrow (all of it on hover).
function todayRunningPill(s) {
  const what = s.running || "";
  return uiPill(what ? `Running · ${what}` : "Running", "running", { long: true, title: `${what || "Something it started"} still runs: it goes on when that ends` });
}

// Where a chat stands, as its card's badge says it (the open chat's bar too).
function todayStatePill(s) {
  const t = s.today || {};
  if (s.status === "waiting" || (s.secret_asks || []).length || (s.status !== "working" && (t.asks || []).length && !todayIsAnswered(s)))
    return uiPill(s.permission ? "Permission" : "Asks you", "ask");
  if (s.status === "working") return uiPill("Working", "working");
  if (s.status === "running") return todayRunningPill(s);
  if (t.state === "blocked") return uiPill("Blocked", "late");
  if (t.state === "done") return uiPill("Done", "done");
  return uiPill(sleepOf(s) ? statusWords(s) : t.at ? autoPast(t.at) : statusWords(s), "quiet");
}

function todayChip(s) { return s.assistant ? s.assistant_name || projectName(s.repo) : projectName(s.repo); }

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
    return uiCard({ ...base, pill: uiPill(TODAY_PILLS[tone], "ask"),
      body: [h("p", { class: "tcard-text" }, secret ? "Asks you for a secret" : s.asks || "Needs your answer")],
      actions: s.permission ? [uiButton("Allow", () => todayPermit(s, "allow"), false, "today-opt"), uiButton("Deny", () => todayPermit(s, "deny"), false, "today-opt"), uiButton("Open", () => todayOpen(s))]
                            : [uiButton("Answer", () => todayOpen(s), true)] });
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
      } }, o.label)), i === qs.length - 1 ? uiButton("Other…", () => todayOpen(s), false, "quiet") : null)));
  return uiCard({ ...base, pill: uiPill(TODAY_PILLS.ask, "ask"), body });
}

function todayBlocked(s) {
  return uiCard({ kind: "blocked", hue: todayHue(s.repo), chip: todayChip(s), title: s.task || "New chat", id: s.id,
    open: () => todayOpen(s), pill: uiPill("Blocked", "late"),
    body: [(s.today || {}).goal ? h("p", { class: "tcard-text muted" }, s.today.goal) : null],
    actions: [uiButton("See why", () => todayOpen(s), true)] });
}

// One of your loops: who (or Due), what (a tap shows all of it), when, and
// Done, Chase, Ask or New chat for your assistant. A loop whose line names
// its chat (`(chat <id>)`, written there by your assistant once it started
// one) has Open chat instead of New chat.
function todayLoop(l, v) {
  const sent = (v.today.sent || {})[l.key] || (todayUI.told.has(l.key) ? { action: todayUI.told.get(l.key) } : null);
  const late = l.kind === "due" ? todayDay(l.due) < 0 : l.chase && todayDay(l.chase) <= 0;
  const name = (v.today.assistant || {}).name || "your assistant";
  const when = l.kind === "waiting" ? (l.chase ? `follow up ${todayWhen(l.chase).replace(/^since /, "")}` : l.since ? `since ${todayAgo(l.since)}` : "")
    : l.kind === "due" ? todayWhen(l.due) : "someday";
  const act = async (action, text) => {
    todayUI.told.set(l.key, action);
    todayUI.asking.delete(l.key);
    // A task done is a mission too: celebrated, and on your score.
    const done = action === "done" ? [{ id: `task:${l.key}`, task: l.what }] : null;
    if (done) missionComplete(done, l.what, { task: true });
    todayRedraw();
    try {
      await api("/api/today/loop", { key: l.key, action, text });
      todayUI.askText.delete(l.key);
      toast(action === "done" ? `Told ${name}: done` : action === "chase" ? `${name} drafts the follow-up for you`
          : action === "session" ? `${name} starts a chat for it` : `Sent to ${name}`);
    } catch (e) {
      todayUI.told.delete(l.key);
      if (done) { missionUndo(done); document.querySelectorAll(".mission").forEach((x) => x.remove()); }
      todayRedraw();
      toast(e.message);
    }
  };
  const can = !!v.today.assistant;
  const open = todayUI.expand.has(l.key);
  const chase = l.kind === "waiting";
  const asking = todayUI.asking.get(l.key);
  const session = asking === "session";
  const chat = l.chat && rowOf(l.chat);
  const said = { done: `Sent to ${name}: done`, chase: `${name} drafts the follow-up`, ask: `Sent to ${name}`, session: `${name} starts a chat for it` };
  const ask = (mode) => { todayUI.asking.set(l.key, mode); todayRedraw(); };
  // Ask needs words; a new chat's note is optional (your assistant writes its brief from the loop).
  const go = (value) => { if (session || value) act(asking, value); };
  // Its head: who, what (a tap shows all of it). Under it, one line: when (and
  // since), and its buttons: Follow up (your assistant drafts the message to
  // whoever you wait on), Ask (tell your assistant what to do about it), New
  // chat (your assistant starts one just for it) or Open chat, Done.
  const meta = sent ? h("span", { class: "tcard-meta done" }, said[sent.action] || `Sent to ${name}`)
    : h("span", { class: `tcard-meta${late ? " late" : ""}` }, [when, chase && l.since && l.chase ? `asked ${todayAgo(l.since)}` : ""].filter(Boolean).join(" · "));
  const openChat = chat ? h("button", { class: "tbtn loop-chat", type: "button", title: `Open ${chat.task || chat.id}, the chat for it`, onclick: () => todayOpen(chat) }, "Open chat") : null;
  const box = asking ? (() => {
    const field = h("textarea", { class: "tcard-ask", rows: 2,
                                  placeholder: session ? `Anything for the new chat? (optional: ${name} writes its brief)` : `What should ${name} do about it?`,
                                  oninput: () => todayUI.askText.set(l.key, field.value),
                                  onkeydown: (e) => {
                                    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(field.value.trim()); }
                                    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); todayUI.asking.delete(l.key); todayRedraw(); }
                                  } });
    field.value = todayUI.askText.get(l.key) || "";
    requestAnimationFrame(() => { if (field.isConnected && document.activeElement !== field) field.focus({ preventScroll: true }); });
    return h("div", { class: "tcard-askbox" }, field, h("div", { class: "tcard-actions" },
      uiButton("Cancel", () => { todayUI.asking.delete(l.key); todayRedraw(); }, false, "quiet"),
      uiButton(session ? "Start a chat for this" : `Send to ${name}`, () => go(field.value.trim()), true)));
  })() : null;
  return uiCard({ kind: chase ? "chase" : l.kind === "due" ? "due" : "someday", hue: chase ? todayHue(l.who) : "due", chip: chase ? l.who : "", id: null,
    title: h("span", { class: `tcard-what${open ? " open" : ""}` }, l.what), label: l.what,
    open: () => { if (open) todayUI.expand.delete(l.key); else todayUI.expand.add(l.key); todayRedraw(); },
    body: [box],
    actions: asking ? [] : sent || !can ? [meta, chat ? openChat : null] : [meta,
      chase ? h("button", { class: `tbtn${late ? " primary" : ""}`, type: "button", title: `${name} drafts a message to ${l.who || "them"} for you to send`,
                            onclick: () => act("chase") }, "Follow up") : null,
      h("button", { class: "tbtn", type: "button", title: `Tell ${name} what to do about it`, onclick: () => ask("ask") }, `Ask ${name}…`),
      chat ? openChat : h("button", { class: "tbtn loop-chat", type: "button", title: `${name} starts a chat just for this, with its brief`, onclick: () => ask("session") }, "New chat…"),
      uiButton("Done", () => act("done"), !chase && late, "loop-done")] });
}

// A chat: its project, its name, where it stands; its goal (and in Tasks
// what it last said); for one that's done or stalled, Close (and Ask status).
function todayChat(s, kind) {
  const t = s.today || {};
  const main = s.assistant === "main";
  const quiet = t.at ? Math.floor((Date.now() / 1000 - t.at) / 86400) : 0;
  const told = todayUI.told.get(s.id);
  // Running (its turn over, what it started still at it): not finished yet, whatever its goal block says.
  const running = s.status === "running";
  const finished = t.state === "done" && !running;
  const stalled = kind === "ready" && !todayBusy(s) && t.at && Date.now() / 1000 - t.at > TODAY_STALE;
  const pill = running ? todayRunningPill(s)
    : kind === "fresh" ? uiPill(finished ? "Done · new" : "New", finished ? "done" : "ask")
    : kind === "done" ? uiPill("Done", "done") : kind === "stale" || stalled ? uiPill(`Stalled ${quiet}d`, "warn")
    : kind === "working" || s.status === "working" ? uiPill("Working", "working")
    : main ? uiPill(statusWords(s), "quiet") : t.at ? uiPill(autoPast(t.at), "quiet") : null;
  const said = (boardOn() || kind === "fresh") && !main && s.said ? s.said : "";
  // Done: Review (where to see what it made, from its reply) and Complete.
  const link = (t.links || [])[0];
  const review = finished && link ? h("a", { class: "tbtn", href: link.url, target: "_blank", rel: "noopener",
    title: link.label || link.url, onclick: (e) => { e.stopPropagation(); if (typeof openLink === "function") { e.preventDefault(); openLink(link.url); } } },
    glyph("next"), link.label && link.label.length <= 24 ? link.label : "Review") : null;
  const complete = finished && !main ? uiButton("Complete mission", () => todayComplete(s), false, "complete") : null;
  const seenBtn = kind === "fresh" && !finished ? uiButton("Seen", () => todaySeen(s), false, "quiet seen") : null;
  return uiCard({ kind: kind === "fresh" ? (finished ? "done" : "fresh") : stalled ? "stale" : kind, hue: todayHue(s.repo), chip: main ? "" : todayChip(s),
    title: main ? s.assistant_name || s.task : s.task || "New chat",
    lead: main ? avatar(s, "small") : null, id: s.id, open: () => todayOpen(s), pill,
    body: [!main && t.goal ? h("p", { class: "tcard-text" }, t.goal) : null, said && kind !== "done" ? h("p", { class: "tcard-text muted said" }, said) : null],
    actions: finished ? [review, complete]
      : kind === "fresh" ? [seenBtn]
      : kind === "stale" || stalled ? [told ? h("span", { class: "tcard-note" }, told === "nudging" ? "Asking…" : "Asked") : uiButton("Ask status", () => todayNudge(s)),
                                       uiButton("Complete mission", () => todayComplete(s), false, "complete")] : [] });
}

// Seen without opening it: off Needs you.
function todaySeen(s) {
  todayUI.seen.add(s.id);
  todayRedraw();
  seenNow(s.id);
  setTimeout(() => { todayUI.seen.delete(s.id); }, 30000);
}

// Mission complete: the chat reached its goal. Its card says so, a moment,
// then it closes (as Close does: at once with Undo when nothing would be
// lost, else asked).
async function todayComplete(s) {
  // Still running something: asked first (todayClose), not celebrated yet.
  if ((rowOf(s.id) || s).status === "running") return todayClose(s, `Mission complete: ${s.task || "the chat"}`);
  // What closing it would lose, asked now: the server answers while its card celebrates.
  const asked = todayClosing(s);
  asked.catch(() => {});
  // Its card says so a moment, when it's in sight (not from the open chat).
  const card = [...document.querySelectorAll(`.tcard[data-id="${CSS.escape(s.id)}"]`)].find((c) => c.offsetParent);
  if (card) {
    card.classList.add("completing");
    card.append(h("div", { class: "tcard-complete", "aria-hidden": "true" }, h("span", { class: "tick" }, glyph("check")), h("b", {}, "Mission complete")));
    await new Promise((r) => setTimeout(r, matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 650));
  }
  todayClose(s, `Mission complete: ${s.task || "the chat"}`, asked);
}

// ---- mission complete: what closing a chat feels like
//
// The chat reached its goal, and you closed it (or a task's Done): your
// theme's colors burst over your wallpaper, a tick lands, MISSION COMPLETE in
// big letters (DAILY GOAL when it gets you there, ALL CLEAR when nothing else
// needs you or waits to be completed), what it earned (a combo, a record, a
// day more of your streak, a rank, a rescue), how many you've completed today
// against what's still waiting (a bar of blocks), its sound (a step higher for
// each in a combo, unless your chimes are off), and Next mission. A click,
// Esc, or three seconds, and it's gone; Undo is under it the while.
//
// What you've done is the server's (missions_view): the same on the phone and
// the computer. One completed here counts at once (pending), before its Undo
// is over and its close reaches the server. A badge the server says you
// earned has a moment of its own (missionBadge); a fast reply, a flash by the
// score (missionsWatch).

const MISSION_HUES = ["--red", "--yellow", "--green", "--blue", "--magenta", "--cyan", "--orange", "--accent"];
const MISSION_RANKS = [[0, "Cadet"], [10, "Ensign"], [25, "Pilot"], [50, "Lieutenant"], [100, "Commander"],
                       [250, "Captain"], [500, "Admiral"], [1000, "Legend"]];
const missionPending = new Map();     // completed here, not in the server's list yet: id -> {id, at, task, repo, took, kind}
const missionUI = { flash: null, replies: null, queue: [] };

// Your missions now: the server's, and the ones completed here it doesn't have yet.
function missionsNow() {
  const m = (app.view && app.view.missions) || {};
  const mine = m.today || [];
  const known = new Set(mine.map((x) => x.id));
  // In the server's list by now, or never to be (its close went another way): forgotten here.
  const late = Date.now() / 1000 - TODAY_UNDO_CLOSE / 1000 - 60;
  for (const [id, x] of [...missionPending]) if (known.has(id) || x.at < late) missionPending.delete(id);
  const extra = [...missionPending.values()];
  const today = [...mine, ...extra].sort((a, b) => a.at - b.at);
  // A combo: how many in a row, each within its minutes of the one before, up to the last.
  let combo = today.length ? 1 : 0;
  for (let i = today.length - 1; i > 0 && today[i].at - today[i - 1].at <= (m.combo || 900); i--) combo++;
  const week = (m.week || [0, 0, 0, 0, 0, 0, 0]).slice();
  week[week.length - 1] += extra.length;
  return { today, n: today.length, streak: (m.streak || 0) + (extra.length && !mine.length ? 1 : 0),
           best: m.best || 0, week, total: (m.total || 0) + extra.length, combo, goal: m.goal || 0,
           replies: m.replies || { n: 0, fast: 0, streak: 0, best: 0 }, badges: m.badges || [], fast: m.fast || 120 };
}

// Your rank, by all you've completed: {name, at, next: [at, name] or null}.
function missionRank(total) {
  let i = 0;
  while (i + 1 < MISSION_RANKS.length && total >= MISSION_RANKS[i + 1][0]) i++;
  return { name: MISSION_RANKS[i][1], at: MISSION_RANKS[i][0], next: MISSION_RANKS[i + 1] || null };
}

// Chats stalled (quiet for days, not done): they cool your flame; completing one is a rescue.
function missionIsStalled(s) {
  const t = s.today || {};
  return s.assistant !== "main" && !s.setup && t.state !== "done" && !todayBusy(s) && !!t.at && Date.now() / 1000 - t.at > TODAY_STALE;
}
function missionStalled(v) {
  return v ? (v.sessions || []).filter((s) => !todayUI.closing.has(s.id) && missionIsStalled(s)) : [];
}

// "42 min", "2 h 5 min", "3 days": how long a chat took, from its start.
function missionTook(sec) {
  if (!sec || sec < 60) return sec ? "under a minute" : "";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
  return `${Math.round(min / 1440)} days`;
}

const missionOrdinal = (k) => `${k}${k % 100 >= 11 && k % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][k % 10] || "th"}`;

// Undone (its Undo, or its close failed): not completed after all.
function missionUndo(ss) {
  ss.forEach((s) => missionPending.delete(s.id));
  todayRedraw();
}

// Its sound: rate, higher for a combo (a whole tone a step, up to an octave).
function missionSound(rate = 1) {
  if ((app.view || {}).sound === "off") return;
  playSound("/sound/mission", { rate, volume: 0.8 });
}

// The moment itself, over everything: confetti (bits of it, flying far),
// a mark, the kicker in big letters, a title, pills, a line under them, a
// button. Gone on a click, Esc, or after stay ms.
function missionMoment({ cls = "", mark = "check", kicker, title, earned = [], extra = null, stats = "", next = "Keep going →", go = null, bits = 90, far = 42, stay = 3400 }) {
  document.querySelectorAll(".mission").forEach((x) => x.remove());
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const burst = h("div", { class: "mission-burst", "aria-hidden": "true" });
  if (!calm) for (let i = 0; i < bits; i++) {
    const bit = h("i");
    const angle = Math.random() * Math.PI * 2, d = 18 + Math.random() * far;
    bit.style.setProperty("--dx", `${Math.cos(angle) * d}vw`);
    bit.style.setProperty("--dy", `${Math.sin(angle) * d * 0.8 + 12 + Math.random() * 20}vh`);
    bit.style.setProperty("--rot", `${Math.round(Math.random() * 1080 - 540)}deg`);
    bit.style.setProperty("--d", `${1.1 + Math.random() * (far > 42 ? 1.4 : 0.9)}s`);
    bit.style.setProperty("--c", `var(${MISSION_HUES[i % MISSION_HUES.length]})`);
    if (i % 3 === 0) bit.classList.add("round");
    burst.append(bit);
  }
  const done = () => { el.remove(); if (go) go(calm); missionNextBadge(); };
  const nextBtn = h("button", { class: "tbtn primary mission-next", type: "button", onclick: (e) => { e.stopPropagation(); done(); } }, next);
  const el = h("div", { class: `mission${cls ? ` ${cls}` : ""}`, role: "status", "aria-live": "polite", onclick: () => { el.remove(); missionNextBadge(); } }, burst,
    h("div", { class: "mission-card" },
      h("div", { class: "mission-tick" }, glyph(mark)),
      h("div", { class: "mission-kicker" }, kicker),
      h("div", { class: "mission-title" }, title),
      earned.length ? h("div", { class: "mission-earned" }, ...earned) : null,
      extra,
      stats ? h("div", { class: "mission-stats" }, stats) : null,
      nextBtn));
  const esc = (e) => { if (e.key === "Escape" && el.isConnected) { e.preventDefault(); e.stopPropagation(); el.remove(); missionNextBadge(); } };
  window.addEventListener("keydown", esc, true);
  document.body.append(el);
  if (app.desk) nextBtn.focus({ preventScroll: true });
  stay = (calm ? stay - 1000 : stay) + earned.length * 400;
  setTimeout(() => { if (!el.isConnected) return; el.classList.add("leaving"); setTimeout(() => { if (el.isConnected) { el.remove(); missionNextBadge(); } }, 400); }, stay);
  setTimeout(() => window.removeEventListener("keydown", esc, true), stay + 600);
  return el;
}

// ss: what was completed (chats' rows, or a task as {id: "task:<key>", task}); title: what to call them.
function missionComplete(ss, title, { task = false } = {}) {
  const before = missionsNow();
  const now = Date.now() / 1000;
  const rescued = task ? 0 : ss.filter((s) => missionIsStalled(rowOf(s.id) || s)).length;
  for (const s of ss) {
    missionPending.set(s.id, { id: s.id, at: now, task: s.task || "", repo: s.repo || "", kind: task ? "task" : "chat",
                               took: !task && s.created ? Math.max(0, Math.round(now - s.created)) : null });
  }
  const m = missionsNow();
  const left = app.view ? Math.max(0, todayCount(app.view, typeof board !== "undefined" && boardOn() ? "chats" : null)) : 0;
  // Done ones still to complete count too: all clear is nothing needs you and nothing's left to complete.
  const gone = new Set(ss.map((s) => s.id));
  const more = app.view ? todayParts(app.view).done.filter((s) => !gone.has(s.id) && s.assistant !== "main").length : 0;
  const clear = !task && left === 0 && more === 0;
  if (clear) api("/api/missions/clear").catch(() => {});
  const goal = m.goal && before.n < m.goal && m.n >= m.goal;
  missionSound(2 ** (Math.min(m.combo - 1, 6) * 2 / 12));
  if (navigator.vibrate) try { navigator.vibrate(m.combo > 1 || clear || goal ? [30, 40, 30] : 30); } catch (e) { /* not here */ }
  // What it earned, each a pill: a combo, a record, the goal, the streak's day, a rank, a rescue.
  const earned = [];
  if (m.combo > 1) earned.push(uiPill(`Combo ×${m.combo}`, "ask"));
  if (m.best && m.n > m.best) earned.push(uiPill(before.n <= m.best ? "New record" : `Record · ${m.n}`, "done"));
  if (goal) earned.push(uiPill(`Goal ${m.n}/${m.goal}`, "done"));
  if (!before.n && m.streak > 1) earned.push(uiPill(`Day ${m.streak} streak`, "warn"));
  const was = missionRank(before.total), is = missionRank(m.total);
  if (is.name !== was.name) earned.push(uiPill(`Promoted · ${is.name}`, "accent"));
  else if (Math.floor(m.total / 1000) > Math.floor(before.total / 1000)) earned.push(uiPill(`${missionOrdinal(Math.floor(m.total / 1000) * 1000)} mission`, "accent"));
  if (rescued) earned.push(uiPill(rescued > 1 ? `${rescued} rescues` : "Rescue", "late"));
  const blocks = Math.min(14, Math.max(m.n + left, m.goal || 0));
  const bar = h("div", { class: "mission-bar", "aria-hidden": "true" },
    ...Array.from({ length: blocks }, (_, i) => h("span", { class: `${i < Math.min(m.n, blocks) ? "on" : ""}${m.goal && i === m.goal - 1 ? " goal" : ""}` })));
  const took = ss.length === 1 && missionPending.get(ss[0].id) ? missionTook(missionPending.get(ss[0].id).took) : "";
  missionMoment({
    cls: [clear ? "clear" : "", m.combo > 1 ? "combo" : "", goal ? "goal" : ""].filter(Boolean).join(" "),
    kicker: clear ? "All clear" : goal ? "Daily goal" : task ? "Task done" : "Mission complete", title, earned, extra: bar,
    stats: [`${missionOrdinal(m.n)} today`, took ? `done in ${took}` : "",
            left ? `${left} still need${left === 1 ? "s" : ""} you` : more ? `${more} more to complete` : "nothing else needs you"].filter(Boolean).join(" · "),
    next: left || more ? "Next mission →" : "Keep going →",
    go: (calm) => {
      const next = document.querySelector(".today:not([hidden]) .today-yours .today-go")
        || document.querySelector(".today:not([hidden]) .tcard.k-done .tbtn.complete");
      if (next) { next.focus({ preventScroll: true }); next.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" }); }
    },
    bits: clear || goal ? 160 : Math.min(150, 90 + (m.combo - 1) * 15), far: clear || goal ? 60 : 42,
  });
  todayRedraw();
}

// A badge earned: its own moment, once (on each device that's open then; a
// mission's moment first, if one is up).
function missionBadge(b) {
  missionSound(1.5);
  missionMoment({ cls: "badge", mark: "medal", kicker: "Badge unlocked", title: b.name, stats: b.about, bits: 120, far: 50 });
}

function missionNextBadge() {
  if (document.querySelector(".mission")) return;
  const b = missionUI.queue.shift();
  if (b) setTimeout(() => (document.querySelector(".mission") ? missionUI.queue.unshift(b) : missionBadge(b)), 300);
}

// The list changed (app.js): a badge just earned has its moment; a fast
// reply (your replies' fast count up), a flash by the score.
function missionsWatch() {
  const m = app.view && app.view.missions;
  if (!m) return;
  const now = Date.now() / 1000;
  let shown;
  try { shown = new Set(JSON.parse(store.get("badges-shown") || "[]")); } catch (e) { shown = new Set(); }
  const fresh = (m.badges || []).filter((b) => b.at && now - b.at < 300 && !shown.has(b.key));
  if (fresh.length) {
    fresh.forEach((b) => { shown.add(b.key); missionUI.queue.push(b); });
    store.set("badges-shown", JSON.stringify([...shown]));
    missionNextBadge();
  }
  const r = m.replies || {};
  if (missionUI.replies && r.fast > missionUI.replies.fast) {
    missionUI.flash = { text: r.streak > 1 ? `Fast reply ×${r.streak}` : "Fast reply", until: Date.now() + 2600 };
    todayRedraw();
    setTimeout(() => { if (missionUI.flash && missionUI.flash.until <= Date.now()) { missionUI.flash = null; todayRedraw(); } }, 2700);
  }
  missionUI.replies = r;
}

// Your score, by the summary: the streak's flame, today's missions (to your
// goal); a tap opens Your missions.
function missionScore() {
  const m = missionsNow();
  const risk = m.streak > 0 && !m.n;
  const cool = missionStalled(app.view).length;
  const title = [risk ? `Complete one today to keep your ${m.streak}-day streak` : m.streak ? `${m.streak}-day streak` : "",
                 m.goal ? `${m.n} of ${m.goal} today` : `${m.n} completed today`,
                 cool ? `${cool} stalled chat${cool === 1 ? "" : "s"} cool${cool === 1 ? "s" : ""} your flame` : ""].filter(Boolean).join(" · ");
  const flash = missionUI.flash && missionUI.flash.until > Date.now() ? missionUI.flash.text : "";
  return uiScore({ streak: m.streak, today: m.n, goal: m.goal, risk, cool: !!cool, flash, title,
                   act: (e) => { e.stopPropagation(); missionsSheet(); } });
}

// Your missions: your rank and how far to the next; today (to your goal),
// the streak, the best day, all of them; the week in bars; your goal; your
// replies; your badges; what you completed today, and how long each took.
function missionsSheet() {
  const m = missionsNow();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { n: m.week[i] || 0, label: i === 6 ? "Today" : d.toLocaleDateString([], { weekday: "short" }) };
  });
  const record = m.best && m.n > m.best;
  const meta = m.streak && !m.n ? `Complete one today to keep your ${m.streak}-day streak`
    : record ? "Your best day yet" : m.goal && m.n >= m.goal ? "Daily goal reached" : m.n ? `${m.n} completed today` : "Complete a chat to start your streak";
  const rank = missionRank(m.total);
  const r = m.replies;
  const earned = m.badges.filter((b) => b.at).length;
  const list = m.today.slice().reverse().map((x) => h("li", { class: "missions-row" },
    h("span", { class: `tcard-chip ph-${x.kind === "task" ? "due" : todayHue(x.repo)}` }, x.kind === "task" ? "Task" : projectName(x.repo || "")),
    h("span", { class: "missions-task" }, x.task || "A chat"),
    h("span", { class: "missions-when" }, [missionTook(x.took), new Date(x.at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })].filter(Boolean).join(" · "))));
  const setGoal = async (g) => {
    try { await api("/api/missions/goal", { goal: g }); } catch (e) { return toast(e.message); }
    if (app.view && app.view.missions) app.view.missions = { ...app.view.missions, goal: g };
    todayRedraw();
    missionsSheet();
  };
  sheet({ key: "missions" }, sheetHead("Your missions", meta), h("div", { class: "missions-body" },
    uiProgress({ label: rank.name, value: m.total - rank.at, max: rank.next ? rank.next[0] - rank.at : 1,
                 note: rank.next ? `${rank.next[0] - m.total} to ${rank.next[1]}` : "the top rank" }),
    uiTiles([{ n: m.goal ? `${m.n}/${m.goal}` : m.n, label: "today", on: record || (m.goal && m.n >= m.goal) },
             { n: m.streak, label: m.streak === 1 ? "day streak" : "days streak" },
             { n: m.best, label: "best day" }, { n: m.total, label: "all time" }]),
    uiChart(days),
    uiStepper({ label: "Daily goal", value: m.goal, min: 0, max: 50, show: (g) => (g ? String(g) : "None"), set: setGoal }),
    uiSection("missions-replies", "Replies today", { count: r.n },
      uiTiles([{ n: r.fast, label: `fast (within ${Math.round(m.fast / 60)} min)` }, { n: r.streak, label: "fast in a row" }, { n: r.best, label: "best run" }])),
    uiSection("missions-badges", "Badges", { count: `${earned}/${m.badges.length}` },
      uiBadges(m.badges.map((b) => ({ name: b.name, about: b.about, on: !!b.at,
                                      when: b.at ? `Earned ${new Date(b.at * 1000).toLocaleDateString([], { day: "numeric", month: "short" })}` : "" })))),
    list.length ? uiSection("missions-done", "Completed today", { count: list.length }, h("ol", { class: "missions-list" }, ...list)) : null));
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
  if (top) nodes.push(h("div", { class: "today-summary" }, h("span", { class: "today-summary-text" }, todaySummary(v, only)), missionScore()));
  if (chats && p.main) nodes.push(tk(todayChat, "assistant")(p.main));      // your assistant, on top
  // The board's Chats, grouped as you group the list (by priority, by
  // project): its groups, what asks you first in each (todayGrouped).
  const groups = (app.organize || v).group || [];
  if (board && only === "chats" && groups.length && groups[0] !== "status") {
    // Grouped too, what needs you (an answer, a look at what it did) comes
    // first, then what's done (Review, Complete), then your groups for the rest.
    const needs = [...p.asks, ...p.blocked, ...p.fresh];
    const order = new Map((v.sessions || []).map((x, i) => [x.id, i]));
    needs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const cardOf = (x) => p.asks.includes(x) ? tk(todayAsk)(x) : p.blocked.includes(x) ? tk(todayBlocked)(x) : tk(todayChat, "fresh")(x);
    nodes.push(uiSection("yours", "Needs you", { count: needs.length }, needs.map(cardOf)));
    if (!needs.length) nodes.push(h("p", { class: "today-clear" }, glyph("check"), " Nothing needs you."));
    const all = p.done.length >= 2 ? h("button", { class: "tbtn quiet today-all", type: "button", onclick: () => todayCloseDone(p.done) }, `Complete all ${p.done.length}`) : null;
    nodes.push(uiSection("finish", "Done", { count: p.done.length, extra: all }, p.done.map(tk(todayChat, "done"))));
    return [...nodes, ...todayGrouped(v, p, groups, tk, new Set([...needs, ...p.done].map((x) => x.id)))];
  }
  // At work on top, folded, its count in sight; then what needs you (asks,
  // blocked, finished and not seen yet, your tasks due); then what's done
  // (Review, Complete); then every other chat, open: none is out of sight.
  const runs = p.working.filter((s) => s.status === "running").length, works = p.working.length - runs;
  if (chats) nodes.push(uiSection("working", "At work", { count: p.working.length, fold: false,
    extra: p.working.length ? uiPill([works ? `${works} working` : "", runs ? `${runs} running` : ""].filter(Boolean).join(" · "), works ? "working" : "running") : null },
    p.working.map(tk(todayChat, "working"))));
  const needs = yours + (chats ? p.fresh.length : 0);
  nodes.push(uiSection("yours", only === "tasks" ? "Now" : "Needs you", { count: needs },
    chats ? [p.asks.map(tk(todayAsk)), p.blocked.map(tk(todayBlocked)), p.fresh.map(tk(todayChat, "fresh"))] : [],
    tasks ? [p.chaseNow.map(loop), p.dueNow.map(loop)] : []));
  if (!needs) nodes.push(h("p", { class: "today-clear" }, glyph("check"), chats && close ? ` Nothing needs you. ${close} done, below.` : " Nothing needs you."));
  if (chats) {
    const all = close >= 2 ? h("button", { class: "tbtn quiet today-all", type: "button", onclick: () => todayCloseDone(p.done) }, `Complete all ${close}`) : null;
    nodes.push(uiSection("finish", "Done", { count: close, extra: all }, p.done.map(tk(todayChat, "done"))));
    nodes.push(uiSection("idle", "Ready", { count: p.ready.length }, p.ready.map(tk(todayChat, "ready"))));
  }
  if (tasks) {
    nodes.push(uiSection("chase", "Waiting on others", { count: p.waiting.length, fold: only === "tasks" }, p.waiting.map(loop)));
    nodes.push(uiSection("week", "Later this week", { count: p.week.length, fold: only === "tasks" }, p.week.map(loop)));
    nodes.push(uiSection("later", "Further out", { count: p.later.length, fold: false }, p.later.map(loop)));
    if (only === "tasks") nodes.push(uiSection("someday", "Someday", { count: p.someday.length, fold: false }, p.someday.map(loop)));
  }
  if (tasks) {
    if (v.today && v.today.error) nodes.push(h("p", { class: "today-note bad" }, v.today.error));
    if (!hasLoops) nodes.push(h("p", { class: "today-note" }, "Your tasks show here from your loops file: set it in ",
      h("button", { class: "text-btn", type: "button", onclick: () => openSettings() }, "Settings → Today"), "."));
    else if (!v.today.assistant) nodes.push(h("p", { class: "today-note" }, "Make one of your chats your assistant to mark tasks done from here."));
  }
  return nodes.filter(Boolean);
}

// The board's chats in the list's groups and order (app.js groupLabel):
// a section for each of the first grouping (High priority, Normal...; or
// each project, in your order), the next grouping's names over its cards
// inside, and in each, what asks you first, then the rest as the list has
// them. Each card says where it stands, so nothing that's done waits unseen.
function todayGrouped(v, p, groups, tk, shown = new Set()) {
  const card = (s) => p.asks.includes(s) ? tk(todayAsk)(s) : p.blocked.includes(s) ? tk(todayBlocked)(s)
    : tk(todayChat, p.fresh.includes(s) ? "fresh" : p.done.includes(s) ? "done" : p.working.includes(s) ? "working" : "ready")(s);
  const label = (s, g) => (g === "project" ? projectName(s.repo) : groupLabel(s, g));
  const first = (v.sessions || []).filter((s) => !s.setup && s.assistant !== "main" && !todayUI.closing.has(s.id) && !shown.has(s.id));
  const sections = new Map();
  for (const s of first) {
    const k = label(s, groups[0]);
    if (!sections.has(k)) sections.set(k, []);
    sections.get(k).push(s);
  }
  // The groups in order whatever order the chats came in: High, Normal, Low; your projects' order.
  const prioRank = { "High priority": 0, "Normal priority": 1, "Low priority": 2 };
  const projRank = new Map((v.projects || []).map((pr, i) => [projectName(pr.name), i]));
  const rank = (name) => (groups[0] === "priority" ? prioRank[name] ?? 1 : projRank.get(name) ?? 99);
  const out = [];
  for (const [name, ss] of [...sections].sort((a, b) => rank(a[0]) - rank(b[0]))) {
    // By the next grouping (a project under High priority) if there's one, in
    // its order; in each, what asks you first.
    const subOf = (s) => (groups[1] && groups[1] !== "status" ? label(s, groups[1]) : "");
    const subs = new Map();
    for (const s of ss) { const k = subOf(s); if (!subs.has(k)) subs.set(k, []); subs.get(k).push(s); }
    const subRank = (k) => (groups[1] === "priority" ? prioRank[k] ?? 1 : groups[1] === "project" ? projRank.get(k) ?? 99 : 0);
    const kids = [];
    for (const [k, list] of [...subs].sort((a, b) => subRank(a[0]) - subRank(b[0]))) {
      if (k) kids.push(h("div", { class: "tsec-sub" }, k));
      const asking = (s) => p.asks.includes(s) || p.blocked.includes(s) || p.fresh.includes(s);
      kids.push(...[...list.filter(asking), ...list.filter((s) => !asking(s))].map(card));
    }
    const asking = ss.filter((s) => p.asks.includes(s) || p.blocked.includes(s) || p.fresh.includes(s)).length;
    const key = `g-${groups[0]}-${name}`.toLowerCase().replace(/[^\w-]+/g, "-");
    out.push(uiSection(key, name, { count: ss.length, extra: asking ? uiPill(`${asking} need${asking === 1 ? "s" : ""} you`, "ask") : null,
                                       fold: /^low/i.test(name) ? false : null }, kids));
  }
  return out;
}

// What Today shows of the view: drawn again only when it changes (each
// second the list may change for something Today doesn't show, and a page
// drawn again under your finger stops its scroll), or every minute (its
// times: "since yesterday", "Stalled 3 days").
function todayKey(v) {
  if (!v) return `off|${app.failed}`;
  const said = boardOn();
  return JSON.stringify([todayUI.version, Math.floor(Date.now() / 60000), v.today, v.needs, (app.organize || v).group, v.sort,
    (v.sessions || []).map((s) => s.id).join(),
    (v.sessions || []).map((s) => [s.id, s.task, s.status, s.running, s.setup, s.sleeping, s.waking, s.unseen, s.asks,
                                   { ...s.today, at: Math.floor(((s.today || {}).at || 0) / 60) }, s.permission,
                                   (s.secret_asks || []).length, s.assistant, s.assistant_name, s.picture, s.priority, said ? s.said : ""])]);
}

function boardTabNow() { return typeof board !== "undefined" && board.tab === "tasks" ? "tasks" : "chats"; }

// A computer's: the board (tasks.js) is the home, each chat a card.
// The board (tasks.js) is the home, on the phone as on a computer.
function boardOn() { return typeof board !== "undefined" && !!board.el; }

// Today into its box, if what it shows changed, keeping where it's scrolled to.
function todayFill(box, force) {
  const board = box.classList.contains("board-today");
  // Under a computer's open chat the board isn't in sight: drawn once it's
  // back (boardShown), its order the one you left (Ctrl+Alt+J / K go by it).
  if (board && !force && typeof desk !== "undefined" && desk.current) return;
  const only = board ? boardTabNow() : null;
  const key = `${only}|${todayKey(app.view)}`;
  if (!force && box.dataset.key === key) return;
  box.dataset.key = key;
  const scroller = box.closest(".scroll, .board-scroll");
  const top = scroller ? scroller.scrollTop : 0;
  // A tab as it was last drawn, when nothing changed since (Chats, Tasks,
  // Chats again): its cards as they were, not drawn again.
  box.drawn = box.drawn || new Map();
  const was = box.drawn.get(only);
  const nodes = !force && was && was.key === key ? was.nodes : todayNodes({ board, only });
  box.drawn.set(only, { key, nodes });
  keepFocus(box, () => box.replaceChildren(...nodes));
  if (scroller) scroller.scrollTop = top;
}

// Drawn again where it shows: something was done here.
function todayRedraw() {
  todayUI.version++;
  for (const box of document.querySelectorAll(".today")) todayFill(box);
  if (typeof modeButtons === "function") modeButtons();      // the tabs' counts
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
    h("p", {}, "Your home page: what needs you, what's due, who to chase, and the chats to finish. Your commitments come from a loops file, one per line (- [ ] 2026-10-30 · what, - [ ] waiting · who · what · chase 10-30). Today only reads it: Done, Follow up, Ask and New chat go to your assistant, which keeps it."),
    h("div", { class: "today-setting" }, field, save)];
}
