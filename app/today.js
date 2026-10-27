// ---- Today: what to do now, without reading a chat
//
// The app's home (the phone's first tab, the middle of a computer's when no
// chat is open). Every open thing is in one of three states, and Today reads
// them in that order:
//
// - Your move: what a chat asks you (its question with its buttons, a
//   permission, a secret), a chat that's blocked, and your commitments due
//   by tomorrow. The badge counts the chats' (bin/amarchy needs_you).
// - Finish: a chat that reached its goal (Close), one left idle for days
//   (Close or Nudge). A chat exists to reach its goal and be closed.
// - Their move: the people you wait on (Chase once it's time), the chats at
//   work, and the rest of your week.
//
// A chat says where it stands in the goal block each reply ends with (its
// today: goal, state, asks; bin/amarchy chat_reply). Your commitments are
// your loops file's (amarchy today --loops), which Today only reads: Done
// and Chase go to your assistant, which keeps it (loop_tell).

const TODAY_STALE = 2 * 86400;      // s idle before a chat is offered Close or Nudge (bin/amarchy STALE_DAYS)
const TODAY_NUDGE = "Where does this stand? Finish what's left for this chat's goal, or tell me what you need from me to close it.";
const todayUI = {
  open: new Map(),      // a fold you opened or closed: its key -> open
  answers: new Map(),   // a chat's questions answered here: id -> {key, picks, sent}
  told: new Map(),      // a loop or chat acted on here, until the view says so too: key -> what
  version: 0,           // bumped by what's tapped here: drawn again (todayFill)
};

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

// Where a chat stands, in one word: from its goal block, else its state now.
function todayState(s) {
  const t = s.today || {};
  if (s.status === "waiting" || (s.secret_asks || []).length) return "waiting";
  if (s.status === "working") return "working";
  if ((t.asks || []).length) return "waiting";
  return t.state || "idle";
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
  return h("span", { class: `pchip ph-${todayHue(s.repo)}`, title: `In ${projectName(s.repo)}` }, name);
}

// In order: higher priority first, then your projects' order, then the newest.
function todaySort(v, ss) {
  const rank = new Map(((v.projects || []).map((p) => p.name)).map((name, i) => [name, i]));
  const prio = { high: 0, normal: 1, low: 2 };
  return ss.slice().sort((a, b) => (prio[a.priority] ?? 1) - (prio[b.priority] ?? 1)
    || (a.assistant ? -1 : 0) - (b.assistant ? -1 : 0)
    || (rank.get(a.repo) ?? 99) - (rank.get(b.repo) ?? 99)
    || ((b.today || {}).at || 0) - ((a.today || {}).at || 0));
}

// The chats and loops, sorted into Today's parts.
function todayParts(v) {
  const ss = todaySort(v, (v.sessions || []).filter((s) => !s.setup));
  const loops = (v.today && v.today.loops) || [];
  const isMain = (s) => s.assistant === "main";
  const now = Date.now() / 1000;
  const asks = ss.filter((s) => s.status === "waiting" || (s.secret_asks || []).length
    || (s.status !== "working" && ((s.today || {}).asks || []).length));
  const blocked = ss.filter((s) => !asks.includes(s) && s.status !== "working" && (s.today || {}).state === "blocked");
  const due = loops.filter((l) => l.kind === "due" && l.due).sort((a, b) => a.due.localeCompare(b.due));
  const dueNow = due.filter((l) => todayDay(l.due) <= 1);
  const week = due.filter((l) => todayDay(l.due) > 1 && todayDay(l.due) <= 7);
  const later = due.filter((l) => todayDay(l.due) > 7);
  const waiting = loops.filter((l) => l.kind === "waiting")
    .sort((a, b) => (a.chase || "9").localeCompare(b.chase || "9"));
  const chaseNow = waiting.filter((l) => l.chase && todayDay(l.chase) <= 0);
  const rest = ss.filter((s) => !asks.includes(s) && !blocked.includes(s) && !isMain(s));
  const done = rest.filter((s) => s.status !== "working" && (s.today || {}).state === "done");
  const stale = rest.filter((s) => !done.includes(s) && s.status !== "working" && (s.today || {}).at && now - s.today.at > TODAY_STALE);
  const working = rest.filter((s) => s.status === "working");
  const idle = rest.filter((s) => !done.includes(s) && !stale.includes(s) && !working.includes(s));
  const someday = loops.filter((l) => l.kind === "someday" || l.kind === "other");
  return { asks, blocked, dueNow, week, later, waiting, chaseNow, done, stale, working, idle, someday };
}

// ---- drawing

function todayFold(key, title, count, kids, open = false) {
  if (!kids.length) return null;
  const isOpen = todayUI.open.has(key) ? todayUI.open.get(key) : open;
  const d = h("details", { class: "today-fold", ...(isOpen ? { open: true } : {}) },
    h("summary", {}, h("span", { class: "today-fold-title" }, title), count !== null ? h("span", { class: "today-count" }, String(count)) : null),
    h("div", { class: "today-rows" }, ...kids));
  d.addEventListener("toggle", () => todayUI.open.set(key, d.open));
  return d;
}

function todaySection(kind, title, sub, ...kids) {
  kids = kids.flat().filter(Boolean);
  if (!kids.length) return null;
  return h("section", { class: `today-part today-${kind}` },
    h("h2", { class: "today-head" }, title, sub ? h("span", { class: "today-sub" }, sub) : null), ...kids);
}

function todayOpen(s) {
  if (app.desk && typeof go2 === "function") go2(s.id);
  else go(`#/s/${encodeURIComponent(s.id)}`);
}

// A chat's name as the list has it, a tap opening it.
function todayChatName(s) {
  return h("button", { class: "today-chat", type: "button", onclick: () => todayOpen(s) },
    s.assistant === "main" ? avatar(s, "small") : stateIcon(s),
    h("span", { class: "today-chat-text" }, s.assistant === "main" ? null : projectChip(s),
      taskText(s.assistant === "main" ? s.assistant_name || "Assistant" : s.task || "New chat")),
    glyph("next", "go"));
}

// What a chat asks you, answered here: its last reply's questions with their
// buttons (as the chat's Needs you form: all of them picked, they go as one
// message), else a permission or a secret, which open the chat at its card.
function todayAsk(s) {
  const t = s.today || {};
  const qs = s.status !== "waiting" ? (t.asks || []).filter((q) => (q.options || []).length).slice(0, 3) : [];
  const card = h("article", { class: "today-card ask" }, todayChatName(s));
  if (!qs.length) {
    const what = (s.secret_asks || []).length ? "Asks you for a secret" : s.asks || "Needs your answer";
    card.append(h("p", { class: "today-q" }, what),
      h("div", { class: "today-btns" }, h("button", { class: "control accent", type: "button", onclick: () => todayOpen(s) }, "Answer")));
    return card;
  }
  const key = JSON.stringify(qs);
  let st = todayUI.answers.get(s.id);
  if (!st || st.key !== key) todayUI.answers.set(s.id, st = { key, picks: {}, sent: false });
  const send = async () => {
    const text = qs.map((q, i) => (st.picks[i] === undefined ? null : q.options[st.picks[i]]))
      .filter(Boolean).map((o) => String(o.send || o.label)).join("\n\n");
    if (!text.trim() || st.sent) return;
    st.sent = true;
    todayRedraw();
    try {
      await api(`/api/session/${encodeURIComponent(s.id)}/send`, { text });
      toast(`Sent to ${s.task || "the chat"}`);
    } catch (e) {
      st.sent = false;
      todayRedraw();
      toast(e.message);
    }
  };
  qs.forEach((q, i) => {
    card.append(h("p", { class: "today-q", html: inline(q.question || "What should it do?") }),
      h("div", { class: "today-btns" }, ...q.options.map((o, k) => h("button", {
        class: `control${st.picks[i] === k ? " chosen" : ""}${k === 0 ? " accent" : ""}`, type: "button",
        disabled: st.sent && st.picks[i] !== k,
        onclick: () => {
          // One you finish in your own words: in the chat, where you write them.
          if (o.draft || /[:…]\s*$/.test(o.send || "")) return todayOpen(s);
          if (st.sent) return;
          st.picks[i] = k;
          if (qs.every((_, j) => st.picks[j] !== undefined)) send();
          else todayRedraw();
        } }, o.label)), h("button", { class: "control", type: "button", onclick: () => todayOpen(s) }, "Other…")));
  });
  if (st.sent) card.append(h("p", { class: "today-note" }, "Sent"));
  return card;
}

function todayBlocked(s) {
  return h("article", { class: "today-card blocked" }, todayChatName(s),
    h("p", { class: "today-q" }, h("b", {}, "Blocked"), (s.today || {}).goal ? ` · ${s.today.goal}` : ""),
    h("div", { class: "today-btns" }, h("button", { class: "control accent", type: "button", onclick: () => todayOpen(s) }, "See why")));
}

// One of your loops: what, when, and Done (or Chase) for your assistant.
function todayLoop(l, v) {
  const sent = (v.today.sent || {})[l.key] || (todayUI.told.has(l.key) ? { action: todayUI.told.get(l.key) } : null);
  const late = l.kind === "due" ? todayDay(l.due) < 0 : l.chase && todayDay(l.chase) <= 0;
  const name = (v.today.assistant || {}).name || "your assistant";
  const meta = l.kind === "waiting"
    ? [l.since ? `asked ${todayAgo(l.since)}` : "", l.chase ? `chase ${todayWhen(l.chase).replace(/^since /, "")}` : ""].filter(Boolean).join(" · ")
    : todayWhen(l.due);
  const act = async (action, btn) => {
    btn.disabled = true;
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
      l.kind === "waiting" && can ? h("button", { class: `control${late ? " accent" : ""}`, type: "button", onclick: (e) => act("chase", e.currentTarget) }, "Chase") : null,
      can ? h("button", { class: "control", type: "button", title: `Tell ${name} it's done`, onclick: (e) => act("done", e.currentTarget) }, glyph("check"), "Done") : null);
  return h("div", { class: `today-loop${late ? " late" : ""}${sent ? " sent" : ""}` },
    h("div", { class: "today-loop-text" },
      l.who ? h("b", {}, `${l.who} · `) : null, h("span", { class: "what" }, l.what),
      meta ? h("small", { class: late ? "late" : "" }, meta) : null),
    btns);
}

// A chat in a line: its name, its goal, how long since anything happened,
// and for one that's done or idle for days, Close (and Nudge).
function todayChat(s, kind) {
  const t = s.today || {};
  const since = t.at ? autoPast(t.at) : "";
  const told = todayUI.told.get(s.id);
  const nudge = async (btn) => {
    btn.disabled = true;
    todayUI.told.set(s.id, "nudge");
    try {
      await api(`/api/session/${encodeURIComponent(s.id)}/send`, { text: TODAY_NUDGE });
      toast(`Nudged ${s.task || "the chat"}`);
    } catch (e) {
      todayUI.told.delete(s.id);
      toast(e.message);
    }
    todayRedraw();
  };
  const btns = kind === "done" || kind === "stale"
    ? h("span", { class: "today-btns inline" },
      kind === "stale" ? (told === "nudge" ? h("span", { class: "today-sent" }, "Nudged")
        : h("button", { class: "control", type: "button", onclick: (e) => nudge(e.currentTarget) }, "Nudge")) : null,
      h("button", { class: `control${kind === "done" ? " accent" : ""}`, type: "button", onclick: () => confirmClose(s) }, "Close"))
    : null;
  const quiet = t.at ? Math.floor((Date.now() / 1000 - t.at) / 86400) : 0;
  const word = kind === "done" ? "Done" : kind === "stale" ? `Quiet ${quiet} days` : kind === "working" ? statusWords(s) : since;
  return h("div", { class: `today-line ${kind}` },
    h("button", { class: "today-line-main", type: "button", onclick: () => todayOpen(s) },
      stateIcon(s),
      h("span", { class: "text" }, h("span", { class: "today-line-top" }, projectChip(s), taskText(s.task || "New chat")),
        h("small", {}, [word, t.goal].filter(Boolean).join(" · ")))),
    btns);
}

// Today, as nodes, for whoever shows it (the phone's list, desk.js's middle).
function todayNodes() {
  const v = app.view;
  if (!v) return [h("div", { class: "empty" }, app.failed || "Connecting…")];
  const p = todayParts(v);
  const hasLoops = !!(v.today && v.today.source);
  const name = (v.today && v.today.assistant || {}).name || "your assistant";
  const yours = p.asks.length + p.blocked.length + p.dueNow.length;
  const date = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  const nodes = [h("div", { class: "today-top" }, h("div", { class: "today-date" }, date),
    h("div", { class: "today-summary" }, yours ? `${yours} for you to do` : "Nothing waits on you",
      p.done.length ? ` · ${p.done.length} to close` : ""))];
  nodes.push(todaySection("yours", "Your move", null,
    p.asks.map(todayAsk), p.blocked.map(todayBlocked),
    p.dueNow.length ? h("div", { class: "today-card loops" }, h("div", { class: "today-k" }, "Due"), ...p.dueNow.map((l) => todayLoop(l, v))) : null));
  if (!yours) nodes.push(h("p", { class: "today-clear" }, glyph("check"), " Nothing waits on you right now."));
  nodes.push(todaySection("finish", "Finish", "a chat exists to reach its goal and be closed",
    p.done.map((s) => todayChat(s, "done")),
    todayFold("stale", "Quiet for days", p.stale.length, p.stale.map((s) => todayChat(s, "stale")), p.stale.length <= 3)));
  nodes.push(todaySection("theirs", "Their move", null,
    todayFold("chase", "Waiting on others", p.waiting.length, p.waiting.map((l) => todayLoop(l, v)), p.chaseNow.length > 0),
    todayFold("working", "At work", p.working.length, p.working.map((s) => todayChat(s, "working")), true),
    todayFold("week", "Later this week", p.week.length, p.week.map((l) => todayLoop(l, v))),
    todayFold("later", "Further out", p.later.length, p.later.map((l) => todayLoop(l, v))),
    todayFold("idle", "Other chats", p.idle.length, p.idle.map((s) => todayChat(s, "idle")))));
  if (v.today && v.today.error) nodes.push(h("p", { class: "today-note bad" }, v.today.error));
  if (!hasLoops) nodes.push(h("p", { class: "today-note" }, "Your commitments can show here too: set your loops file in ",
    h("button", { class: "text-btn", type: "button", onclick: () => openSettings() }, "Settings → Today"), "."));
  else if (!v.today.assistant) nodes.push(h("p", { class: "today-note" }, "Make one of your chats your assistant to mark loops done from here."));
  else nodes.push(h("p", { class: "today-note" }, `Done and Chase go to ${name}, who keeps your loops.`));
  return nodes.filter(Boolean);
}

// How many things are your move: the badge's number for the Today tab (the
// chats') plus what's due by tomorrow.
function todayCount(v) {
  if (!v) return 0;
  const p = todayParts(v);
  return p.asks.length + p.blocked.length + p.dueNow.length;
}

// What Today shows of the view: drawn again only when it changes (each
// second the list may change for something Today doesn't show, and a page
// drawn again under your finger stops its scroll), or every minute (its
// times: "since yesterday", "Quiet 3 days").
function todayKey(v) {
  if (!v) return `off|${app.failed}`;
  return JSON.stringify([todayUI.version, Math.floor(Date.now() / 60000), v.today, v.needs,
    (v.sessions || []).map((s) => [s.id, s.task, s.status, s.setup, s.sleeping, s.waking, s.unseen, s.asks, s.today,
                                   (s.secret_asks || []).length, s.assistant, s.assistant_name, s.picture, s.priority])]);
}

// Today into its box, if what it shows changed, keeping where it's scrolled to.
function todayFill(box, force) {
  const key = todayKey(app.view);
  if (!force && box.dataset.key === key) return;
  box.dataset.key = key;
  const scroller = box.closest(".scroll, .today-scroll");
  const top = scroller ? scroller.scrollTop : 0;
  keepFocus(box, () => box.replaceChildren(...todayNodes()));
  if (scroller) scroller.scrollTop = top;
}

// Drawn again where it shows: something was tapped here.
function todayRedraw() {
  todayUI.version++;
  for (const box of document.querySelectorAll(".today")) todayFill(box);
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
    h("p", {}, "Your home page: what needs you, what's due, who you're waiting on, and the chats to finish. Your commitments come from a loops file, one per line (- [ ] 2026-10-30 · what, - [ ] waiting · who · what · chase 10-30). Today only reads it: Done and Chase go to your assistant."),
    h("div", { class: "today-setting" }, field, save)];
}
