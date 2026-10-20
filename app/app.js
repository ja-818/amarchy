// amarchy on your phone: the sessions of the host it's served from (`amarchy
// app`), each one's conversation, what you send it, and its questions as
// buttons. No libraries, no build: the server sends these files as they are.
"use strict";

const root = document.getElementById("root");
const app = { view: null, key: "", user: "", online: true, list: null, session: null, failed: "" };
const STATUS = { waiting: "Needs you", working: "Working", idle: "Idle", asleep: "Idle" };
const PRIORITY = { high: "High", normal: "Normal", low: "Low" };
const ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
};

// ---- small helpers

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;      // not an attribute: the page's CSP allows no inline styles
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false)
    el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function api(path, body) {
  let res;
  try {
    res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" },
                              body: JSON.stringify(body || {}) });
  } catch (e) {
    throw new Error("Can't reach amarchy");
  }
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error(data.error || `It didn't work (${res.status})`);
  return data;
}

let toastTimer = null;
function toast(text) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = h("div", { class: "toast", role: "status" }, text);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { /* private mode */ } },
};

function where(s) { return `${s.repo} · ${s.branch || s.name}`; }
function title(s) { return s.task || s.name; }
function statusOf(s) { return s.status === "asleep" ? "idle" : (s.status || "idle"); }

// The visible part of the screen: above the keyboard while it's up.
function fitViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  root.style.setProperty("--vvh", `${vv.height}px`);
  root.style.transform = `translateY(${vv.offsetTop}px)`;
  document.body.classList.toggle("keyboard-up", vv.height < window.innerHeight - 120);
}
if (window.visualViewport) {
  visualViewport.addEventListener("resize", fitViewport);
  visualViewport.addEventListener("scroll", fitViewport);
}

// ---- markdown, for what Claude says (escaped first: nothing in it becomes HTML of its own)

function inline(raw) {
  const held = [];
  const hold = (html) => { held.push(html); return `\u0000${held.length - 1}\u0000`; };
  let s = raw.replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
                (_, t, u) => hold(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`));
  s = s.replace(/https?:\/\/[^\s<>()\u0000]+[^\s<>().,;:!?'"\u0000]/g,
                (u) => hold(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`));
  s = esc(s);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?![\w*])/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w])_([^_\s][^_\n]*?)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => held[+i]);
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function md(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  let out = "", i = 0;
  const starts = (l) => /^\s*```/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l) || LIST_ITEM.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^\s*```\s*([\w+-]*)/))) {
      const code = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      out += `<pre><code>${esc(code.join("\n"))}</code></pre>`;
    } else if ((m = l.match(/^(#{1,6})\s+(.*)$/))) {
      const n = Math.min(m[1].length + 1, 4);
      out += `<h${n}>${inline(m[2])}</h${n}>`;
      i++;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) {
      out += "<hr>";
      i++;
    } else if (/^\s*>/.test(l)) {
      const q = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) q.push(lines[i].replace(/^\s*>\s?/, ""));
      out += `<blockquote>${md(q.join("\n"))}</blockquote>`;
    } else if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => inline(c.trim()));
      const head = cells(l);
      i += 2;
      let body = "";
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++)
        body += `<tr>${cells(lines[i]).map((c) => `<td>${c}</td>`).join("")}</tr>`;
      out += `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead>` +
             `<tbody>${body}</tbody></table></div>`;
    } else if ((m = l.match(LIST_ITEM))) {
      const indent = m[1].length, ordered = /\d/.test(m[2]);
      const items = [];
      while (i < lines.length) {
        const li = lines[i].match(LIST_ITEM);
        if (li && li[1].length <= indent) {
          if (/\d/.test(li[2]) !== ordered) break;
          items.push([li[3]]);
          i++;
        } else if (lines[i].trim() && (/^\s/.test(lines[i]) || (li && li[1].length > indent))) {
          items[items.length - 1].push(lines[i].replace(new RegExp(`^\\s{0,${indent + 4}}`), ""));
          i++;
        } else if (!lines[i].trim() && i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
          items[items.length - 1].push("");
          i++;
        } else break;
      }
      const tag = ordered ? "ol" : "ul";
      const first = ordered ? parseInt(m[2], 10) : 1;
      out += `<${tag}${ordered && first !== 1 ? ` start="${first}"` : ""}>` + items.map((it) => {
        const body = md(it.join("\n"));
        return `<li>${body.replace(/^<p>([\s\S]*?)<\/p>/, "$1")}</li>`;
      }).join("") + `</${tag}>`;
    } else {
      const p = [];
      for (; i < lines.length && lines[i].trim() && !(p.length && starts(lines[i])); i++) p.push(lines[i].trim());
      out += `<p>${p.map(inline).join("<br>")}</p>`;
    }
  }
  return out;
}

// ---- the list

function openList() {
  if (app.list) return;
  const es = new EventSource("/api/events");
  app.list = es;
  es.addEventListener("list", (e) => {
    app.view = JSON.parse(e.data);
    app.online = true;
    app.failed = "";
    badge();
    if (!app.session) renderList();
  });
  es.addEventListener("open", () => { if (!app.online) { app.online = true; if (!app.session) renderList(); } });
  es.addEventListener("error", () => {
    app.online = false;
    if (!app.session) renderList();
  });
}

function closeList() {
  if (app.list) app.list.close();
  app.list = null;
}

function badge() {
  if (!app.view || !navigator.setAppBadge) return;
  const n = app.view.sessions.filter((s) => s.status === "waiting").length;
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

function groupLabel(s, g) {
  if (g === "project") return s.repo;
  if (g === "priority") return PRIORITY[s.priority] || "Normal";
  return STATUS[statusOf(s)];
}

function renderList() {
  const scroll = root.querySelector(".scroll");
  const keep = scroll && root.querySelector(".view.list-view") ? scroll.scrollTop : 0;
  const v = app.view;
  const head = h("div", { class: "big-title" },
    h("h1", {}, "Sessions"),
    h("button", { class: "icon-btn", "aria-label": "Settings", html: ICONS.gear, onclick: openSettings }),
    h("button", { class: "icon-btn", "aria-label": "New session", html: ICONS.plus, onclick: () => openNew() }));
  const sub = h("div", { class: "sub" }, v ? `${v.hostname} · ${v.sessions.length} session${v.sessions.length === 1 ? "" : "s"}` : "");
  const list = h("div", { class: "list" });
  if (!v) {
    list.append(h("div", { class: "empty" }, app.failed || "Connecting…"));
  } else if (!v.sessions.length) {
    list.append(h("div", { class: "empty" }, "No sessions yet.", h("br"), h("br"),
      h("button", { class: "chip accent", onclick: () => openNew() }, "Start one")));
  } else {
    const groups = v.group || [];
    let prev = [], card = null;
    for (const s of v.sessions) {
      const labels = groups.map((g) => groupLabel(s, g));
      const at = labels.findIndex((l, i) => l !== prev[i]);
      if (at >= 0 || !card) {
        for (let i = Math.max(at, 0); i < labels.length; i++)
          list.append(h("div", { class: `group-head${i ? " inner" : ""}` }, labels[i]));
        card = h("div", { class: "card", style: groups.length ? null : "margin-top: 8px" });
        list.append(card);
      }
      prev = labels;
      card.append(sessionRow(s));
    }
  }
  const offline = !app.online && v ? h("div", { class: "offline" }, "Reconnecting to amarchy…") : null;
  const view = h("div", { class: "view list-view" }, head, sub, offline, h("div", { class: "scroll" }, list));
  root.replaceChildren(view);
  root.querySelector(".scroll").scrollTop = keep;
}

function sessionRow(s) {
  const prio = s.priority && s.priority !== "normal"
    ? h("span", { class: `prio ${s.priority}` }, s.priority === "high" ? "▲ HIGH" : "▼ LOW") : null;
  return h("button", { class: "row", onclick: () => { location.hash = `#/s/${encodeURIComponent(s.id)}`; } },
    h("span", { class: `status ${statusOf(s)}`, title: STATUS[statusOf(s)] }),
    h("span", { class: "main" },
      h("div", { class: "name" }, s.setup ? `${title(s)} (setting up…)` : title(s)),
      h("div", { class: "where" }, where(s))),
    h("span", { class: "side" }, s.age ? h("span", {}, s.age) : null, prio));
}

// ---- a session

class SessionView {
  constructor(id) {
    this.id = id;
    this.row = app.view && app.view.sessions.find((s) => s.id === id) || null;
    this.screen = null;
    this.mode = "chat";
    this.tools = new Map();
    this.keys = new Set();
    this.start = 0;
    this.dialogId = null;
    this.build();
    this.open();
    this.seen = setInterval(() => this.markSeen(), 10000);
    this.markSeen();
  }

  build() {
    this.titleEl = h("b", {}, this.row ? title(this.row) : "…");
    this.subEl = h("small", {}, this.row ? where(this.row) : "");
    const bar = h("div", { class: "bar" },
      h("button", { class: "icon-btn", "aria-label": "Sessions", html: ICONS.back, onclick: () => { location.hash = "#/"; } }),
      h("div", { class: "title" }, this.titleEl, this.subEl),
      h("button", { class: "icon-btn", "aria-label": "More", html: ICONS.more, onclick: () => this.menu() }));
    this.conv = h("div", { class: "conv" });
    this.screenEl = h("pre", { class: "screen" });
    this.scroller = h("div", { class: "scroll" }, this.conv);
    this.dock = h("div", { class: "dock" });
    this.input = h("textarea", { rows: 1, placeholder: "Message Claude", enterkeyhint: "enter",
                                 oninput: () => { this.grow(); store.set(`draft:${this.id}`, this.input.value); this.sendButtons(); } });
    this.input.value = store.get(`draft:${this.id}`) || "";
    this.sendBtn = h("button", { class: "send", "aria-label": "Send", html: ICONS.send, onclick: () => this.send() });
    this.stopBtn = h("button", { class: "stop", "aria-label": "Stop Claude", html: ICONS.stop,
                                 onclick: () => this.press(["Escape"]) });
    this.composer = h("div", { class: "composer" }, this.input, this.stopBtn, this.sendBtn);
    this.keysRow = h("div", { class: "keys" },
      ...[["↑", "Up"], ["↓", "Down"], ["⏎", "Enter"], ["Esc", "Escape"], ["Tab", "Tab"], ["⇧Tab", "BTab"],
          ["1", "1"], ["2", "2"], ["3", "3"]].map(([label, key]) =>
        h("button", { class: "chip", onclick: () => this.press([key]) }, label)));
    this.el = h("div", { class: "view" }, bar, this.scroller, this.dock);
    root.replaceChildren(this.el);
    this.renderHeader();
    this.renderDock();
    this.grow();
  }

  open() {
    const es = new EventSource(`/api/session/${encodeURIComponent(this.id)}/stream`);
    this.es = es;
    es.addEventListener("session", (e) => { this.row = JSON.parse(e.data); this.renderHeader(); this.renderDock(); });
    es.addEventListener("conversation", (e) => this.conversation(JSON.parse(e.data)));
    es.addEventListener("screen", (e) => {
      this.screen = JSON.parse(e.data);
      if (this.mode === "screen") this.renderScreen();
      this.renderDock();
    });
    es.addEventListener("gone", () => {
      toast("That session was closed.");
      location.hash = "#/";
    });
    es.addEventListener("error", () => {
      if (es.readyState === EventSource.CLOSED) {
        toast("Can't open that session.");
        location.hash = "#/";
      }
    });
  }

  close() {
    if (this.es) this.es.close();
    this.es = null;
    clearInterval(this.seen);
  }

  // Back from the background: everything from scratch.
  reopen() {
    this.close();
    this.open();
    this.seen = setInterval(() => this.markSeen(), 10000);
    this.markSeen();
  }

  markSeen() {
    if (document.visibilityState === "visible")
      api(`/api/session/${encodeURIComponent(this.id)}/seen`).catch(() => {});
  }

  renderHeader() {
    if (!this.row) return;
    this.titleEl.textContent = title(this.row);
    const st = statusOf(this.row);
    this.subEl.replaceChildren(h("span", { class: "pill" }, h("span", { class: `status ${st}` }), STATUS[st]),
                               " ", where(this.row));
  }

  atBottom() {
    const s = this.scroller;
    return s.scrollTop + s.clientHeight >= s.scrollHeight - 120;
  }

  toBottom() { this.scroller.scrollTop = this.scroller.scrollHeight; }

  conversation(d) {
    if (this.mode !== "chat") {
      (this.pending = this.pending || []).push(d);
      return;
    }
    const stick = d.reset || this.atBottom();
    if (d.reset) {
      this.conv.replaceChildren();
      this.tools.clear();
      this.keys.clear();
      this.start = d.start;
      this.earlierBtn = h("button", { class: "earlier", onclick: () => this.earlier() }, "Earlier");
      if (this.start > 0) this.conv.append(this.earlierBtn);
      if (!d.items.length) this.conv.append(h("div", { class: "msg note" }, "Nothing here yet."));
    }
    for (const item of d.items) {
      const el = this.item(item);
      if (el) this.conv.append(el);
    }
    if (stick) requestAnimationFrame(() => this.toBottom());
  }

  async earlier() {
    this.earlierBtn.disabled = true;
    try {
      const res = await fetch(`/api/session/${encodeURIComponent(this.id)}/earlier?before=${this.start}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "couldn't load it");
      const frag = document.createDocumentFragment();
      for (const item of d.items) {
        const el = this.item(item);
        if (el) frag.append(el);
      }
      const before = this.scroller.scrollHeight;
      this.earlierBtn.after(frag);
      this.scroller.scrollTop += this.scroller.scrollHeight - before;
      this.start = d.start;
      if (this.start <= 0) this.earlierBtn.remove();
    } catch (e) {
      toast(e.message);
    }
    this.earlierBtn.disabled = false;
  }

  item(it) {
    if (it.key && this.keys.has(it.key)) return null;
    if (it.key) this.keys.add(it.key);
    if (it.kind === "user") return h("div", { class: "msg user" }, it.text);
    if (it.kind === "command") return h("div", { class: "msg command" }, it.text);
    if (it.kind === "note") return h("div", { class: "msg note" }, it.text);
    if (it.kind === "claude") return h("div", { class: "msg claude", html: md(it.text) });
    if (it.kind === "tool") {
      const result = h("pre", {}, "…");
      const el = h("div", { class: "tool" },
        h("button", { onclick: () => el.classList.toggle("open") },
          h("span", { class: "tdot" }), h("span", { class: "tname" }, it.name), h("span", { class: "tsum" }, it.summary)),
        h("div", { class: "tbody" }, h("div", { class: "full" }, it.summary), result));
      el.result = result;
      this.tools.set(it.id, el);
      return el;
    }
    if (it.kind === "result") {
      const el = this.tools.get(it.tool);
      if (el) {
        el.classList.add(it.error ? "failed" : "done");
        el.result.textContent = it.text || "(no output)";
      }
      return null;
    }
    return null;
  }

  renderScreen() {
    const stick = this.atBottom();
    this.screenEl.textContent = this.screen ? this.screen.text : "";
    if (stick) this.toBottom();
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === "screen") {
      this.scroller.replaceChildren(this.screenEl);
      this.renderScreen();
      this.toBottom();
    } else {
      this.scroller.replaceChildren(this.conv);
      for (const d of this.pending || []) this.conversation(d);
      this.pending = [];
      this.toBottom();
    }
    this.dialogId = null;
    this.renderDock();
  }

  grow() {
    this.input.style.height = "auto";
    this.input.style.height = `${Math.min(this.input.scrollHeight + 2, window.innerHeight * 0.4)}px`;
  }

  sendButtons() {
    const working = this.row && this.row.status === "working";
    const empty = !this.input.value.trim();
    this.stopBtn.style.display = working && empty ? "" : "none";
    this.sendBtn.style.display = working && empty ? "none" : "";
    this.sendBtn.disabled = empty;
  }

  // What's at the bottom: the question Claude asks, Claude having exited,
  // or where you type.
  renderDock() {
    const sc = this.screen;
    const dialog = sc && sc.dialog;
    let key = "composer";
    if (sc && sc.exited) key = "exited";
    else if (this.row && this.row.setup) key = "setup";
    else if (dialog) key = `dialog:${dialog.id}`;
    key += `:${this.mode}`;
    if (key === this.dialogId) { this.sendButtons(); return; }
    this.dialogId = key;
    const kids = [];
    if (this.mode === "screen") kids.push(this.keysRow);
    if (sc && sc.exited) {
      kids.push(h("div", { class: "ask" },
        h("div", { class: "q" }, h("div", { class: "head" }, "Claude Code exited"), "Start it again to go on with this session."),
        h("button", { class: "opt first", onclick: () => this.press(["Enter"]) }, h("b", {}, "Start Claude again"))));
    } else if (this.row && this.row.setup) {
      kids.push(h("div", { class: "hint", style: "text-align:center;padding:8px" }, "Setting up the worktree…"));
    } else if (dialog && this.mode === "chat") {
      kids.push(this.ask(dialog));
    } else {
      kids.push(this.composer);
    }
    this.dock.replaceChildren(...kids);
    this.sendButtons();
    this.grow();
    if (this.mode === "chat" && this.atBottom()) requestAnimationFrame(() => this.toBottom());
  }

  ask(d) {
    const box = h("div", { class: "ask" });
    const q = d.question.split("\n");
    box.append(h("div", { class: "q" },
      h("div", { class: "head" }, h("span", { class: "status waiting" }), q[0] || "Claude asks"),
      q.slice(1).join("\n")));
    d.options.forEach((o, i) => {
      if (/^Type something/i.test(o.label)) {
        const field = h("textarea", { class: "field", style: "min-height:80px", placeholder: "Your answer" });
        const write = h("div", { class: "ask", style: "display:none" }, field,
          h("button", { class: "opt first", onclick: () => this.answer(d, o, field.value) }, h("b", {}, "Send answer")));
        box.append(h("button", { class: "opt", onclick: () => { write.style.display = ""; field.focus(); } },
          h("b", {}, "Answer in your own words…")), write);
        return;
      }
      box.append(h("button", { class: `opt${i === 0 ? " first" : ""}${o.selected && i ? " selected" : ""}`,
                               onclick: (e) => this.pick(d, o, e.currentTarget) },
        h("b", {}, o.label), o.detail ? h("small", {}, o.detail) : null));
    });
    box.append(h("div", { class: "row-btns" },
      h("button", { class: "chip", onclick: () => this.press(["Escape"]) }, "Esc"),
      h("button", { class: "chip", onclick: () => this.setMode("screen") }, "Screen"),
      h("span", { class: "hint", style: "align-self:center" }, d.hint)));
    return box;
  }

  async pick(d, o, btn) {
    this.dock.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    btn.classList.add("selected");
    try {
      await api(`/api/session/${encodeURIComponent(this.id)}/keys`, { keys: o.keys, dialog: d.id });
    } catch (e) {
      toast(e.message);
      this.dialogId = null;
      this.renderDock();
    }
  }

  async answer(d, o, text) {
    if (!text.trim()) return;
    this.dock.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    try {
      await api(`/api/session/${encodeURIComponent(this.id)}/send`, { text, answer: { dialog: d.id, keys: o.keys } });
    } catch (e) {
      toast(e.message);
      this.dialogId = null;
      this.renderDock();
    }
  }

  async press(keys) {
    try {
      await api(`/api/session/${encodeURIComponent(this.id)}/keys`, { keys });
    } catch (e) {
      toast(e.message);
    }
  }

  async send() {
    const text = this.input.value;
    if (!text.trim()) return;
    this.sendBtn.disabled = true;
    try {
      await api(`/api/session/${encodeURIComponent(this.id)}/send`, { text });
      this.input.value = "";
      store.set(`draft:${this.id}`, "");
      this.grow();
      requestAnimationFrame(() => this.toBottom());
    } catch (e) {
      toast(e.message);
    }
    this.sendButtons();
  }

  menu() {
    const row = this.row || {};
    const seg = h("div", { class: "seg" }, ...["high", "normal", "low"].map((p) =>
      h("button", { class: (row.priority || "normal") === p ? "on" : "",
                    onclick: async () => {
                      try {
                        await api(`/api/session/${encodeURIComponent(this.id)}/priority`, { level: p });
                        closeSheet();
                      } catch (e) { toast(e.message); }
                    } }, PRIORITY[p])));
    sheet(h("h2", {}, title(row)),
      h("p", {}, where(row)),
      h("h3", {}, "Priority"), seg,
      h("h3", {}, "Show"),
      h("div", { class: "card" },
        h("button", { class: "menu-item", onclick: () => { closeSheet(); this.setMode("chat"); } },
          "Conversation", h("span", { class: "val" }, this.mode === "chat" ? "✓" : "")),
        h("button", { class: "menu-item", onclick: () => { closeSheet(); this.setMode("screen"); } },
          "Claude's screen, with keys", h("span", { class: "val" }, this.mode === "screen" ? "✓" : ""))));
  }
}

// ---- sheets

function sheet(...kids) {
  closeSheet();
  const back = h("div", { class: "sheet-back", onclick: (e) => { if (e.target === back) closeSheet(); } },
    h("div", { class: "sheet", role: "dialog" }, h("div", { class: "grab" }), ...kids));
  document.body.append(back);
  return back;
}

function closeSheet() {
  document.querySelectorAll(".sheet-back").forEach((s) => s.remove());
}

function openNew() {
  const projects = (app.view && app.view.projects) || [];
  if (!projects.length) {
    toast("No projects on the host yet.");
    return;
  }
  let repo = store.get("last-project");
  if (!projects.some((p) => p.name === repo)) repo = projects[0].name;
  const chips = h("div", { class: "projects" });
  const draw = () => chips.replaceChildren(...projects.map((p) =>
    h("button", { class: `chip${p.name === repo ? " on" : ""}`, onclick: () => { repo = p.name; draw(); } }, p.name)));
  draw();
  const field = h("textarea", { class: "field", placeholder: "What should Claude do?" });
  field.value = store.get("draft:new") || "";
  field.addEventListener("input", () => store.set("draft:new", field.value));
  const err = h("div", { class: "error" });
  const go = h("button", { class: "wide-btn", onclick: async () => {
    if (!field.value.trim()) { err.textContent = "Say what it's for."; return; }
    go.disabled = true;
    go.textContent = "Starting…";
    try {
      const { id } = await api("/api/new", { repo, prompt: field.value });
      store.set("draft:new", "");
      store.set("last-project", repo);
      closeSheet();
      location.hash = `#/s/${encodeURIComponent(id)}`;
    } catch (e) {
      err.textContent = e.message;
      go.disabled = false;
      go.textContent = "Start session";
    }
  } }, "Start session");
  sheet(h("h2", {}, "New session"), h("h3", {}, "Project"), chips, h("h3", {}, "Task"), field, err, go);
  setTimeout(() => field.focus(), 250);
}

// ---- notifications

const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function keyBytes(b64) {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - b64.length % 4) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function sameKey(a, b) {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

async function pushState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) return "on";
  return Notification.permission === "denied" ? "denied" : "off";
}

async function pushOn() {
  const asked = Notification.requestPermission();      // first, while it's still your tap
  if ((await asked) !== "granted") throw new Error("Notifications weren't allowed (Settings → Notifications → amarchy).");
  const reg = await navigator.serviceWorker.ready;
  const key = keyBytes(app.key);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api("/api/push", sub.toJSON());
}

async function pushOff() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api("/api/push/remove", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
}

// The server forgets nothing on its own, but tell it again in case (a new key, a reinstall).
async function pushRefresh() {
  try {
    if ((await pushState()) !== "on") return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sameKey(sub.options.applicationServerKey, keyBytes(app.key))) await pushOn();
    else await api("/api/push", sub.toJSON());
  } catch (e) { /* next time */ }
}

async function openSettings() {
  const body = h("div", {});
  const draw = async () => {
    const state = await pushState().catch(() => "unsupported");
    const kids = [h("h3", {}, "Notifications")];
    if (!standalone) {
      kids.push(h("p", {}, "To get notifications, add amarchy to your Home Screen: tap Share, then “Add to Home Screen”, and open it from there."));
    } else if (state === "unsupported") {
      kids.push(h("p", {}, "This browser can't get notifications (on iPhone they need iOS 16.4 or newer)."));
    } else if (state === "denied") {
      kids.push(h("p", {}, "Notifications are turned off for amarchy in the phone's Settings → Notifications."));
    } else if (state === "off") {
      kids.push(h("p", {}, "Get a notification when a session needs you or is done."),
        h("button", { class: "wide-btn", onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { await pushOn(); toast("Notifications on."); } catch (err) { toast(err.message); }
          draw();
        } }, "Turn on notifications"));
    } else {
      kids.push(h("p", {}, "On: you're told when a session needs you or is done, unless you're looking at it."),
        h("button", { class: "wide-btn plain", onclick: async () => {
          try { const r = await api("/api/push/test"); toast(r.sent ? "Sent. It should arrive in a moment." : "It couldn't be sent."); }
          catch (err) { toast(err.message); }
        } }, "Send a test"),
        h("button", { class: "wide-btn plain", onclick: async () => { await pushOff(); draw(); } }, "Turn off"));
    }
    kids.push(h("h3", {}, "Host"),
      h("p", {}, `${(app.view && app.view.hostname) || location.hostname}, as ${app.user || "you"}. ` +
                 "Reachable only on your tailnet."));
    body.replaceChildren(...kids);
  };
  sheet(h("h2", {}, "Settings"), body);
  draw();
}

// ---- going between views

function route() {
  closeSheet();
  const m = location.hash.match(/^#\/s\/(.+)$/);
  const id = m ? decodeURIComponent(m[1]) : null;
  if (app.session && app.session.id !== id) {
    app.session.close();
    app.session = null;
  }
  if (id) {
    if (!app.session) app.session = new SessionView(id);
  } else {
    renderList();
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    closeList();
    if (app.session) app.session.close();
  } else {
    openList();
    if (app.session) app.session.reopen();
  }
});

async function start() {
  fitViewport();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.go) location.hash = new URL(e.data.go, location.href).hash || "#/";
    });
  }
  try {
    const res = await fetch("/api/state");
    const d = await res.json();
    if (!res.ok) throw new Error(d.error === "not yours"
      ? "This amarchy belongs to someone else on the tailnet."
      : d.error || "amarchy didn't answer.");
    app.key = d.key;
    app.user = d.user;
    if (d.sessions) app.view = d;
  } catch (e) {
    app.failed = e.message.includes("amarchy") ? e.message
      : "Can't reach amarchy. Is Tailscale on, on this phone?";
  }
  window.addEventListener("hashchange", route);
  route();
  openList();
  if (app.key) pushRefresh();
}

start();
