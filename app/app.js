// amarchy on your phone: the sessions of the host it's served from (`amarchy
// app`), each one's conversation, what you send it, and its questions as
// buttons. No libraries, no build: the server sends these files as they are.
"use strict";

const root = document.getElementById("root");
const app = { view: null, key: "", user: "", online: true, list: null, session: null, failed: "", nerd: false,
              query: "", organize: null };
const STATUS = { waiting: "Needs you", working: "Working", done: "Done", idle: "Idle", asleep: "Asleep" };
const PRIORITY = { high: "High", normal: "Normal", low: "Low" };
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// The glyphs of amarchy's list (Nerd Font icons), when the
// look's font has them; else the drawings below and plain marks.
const NERD = {
  waiting: "\u{F009E}", idle: "\u{F012C}", done: "\u{F05E0}", asleep: "\u{F04B2}", high: "\u{F023B}", low: "\u{F0045}",
  back: "\u{F0141}", plus: "\u{F0415}", more: "\u{F01D8}", gear: "\u{F0493}", send: "\u{F005D}",
  stop: "\u{F04DB}", check: "\u{F012C}", down: "\u{F0140}", search: "\u{F0349}", close: "\u{F0156}",
  organize: "\u{F04BC}", mic: "\u{F036C}", project: "\u{F024B}", status: "\u{F0279}", newest: "\u{F1548}", oldest: "\u{F1547}",
  up: "\u{F005D}", under: "\u{F0045}", order: "\u{F04BA}", image: "\u{F02E9}",
};
const PLAIN = { waiting: "●", idle: "✓", done: "✔", asleep: "☾", high: "▲", low: "▼", check: "✓", close: "✕",
                project: "▤", status: "●", newest: "↓", oldest: "↑", up: "▲", under: "▼", order: "⇅" };
const ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>',
  organize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 6h16M4 12h10M4 18h6"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
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

// An icon: the Nerd Font glyph, or the drawing / plain mark without one.
function glyph(name, cls) {
  const el = h("span", { class: `glyph${cls ? ` ${cls}` : ""}`, "aria-hidden": "true" });
  if (app.nerd && NERD[name]) el.textContent = NERD[name];
  else if (ICONS[name]) el.innerHTML = ICONS[name];
  else el.textContent = PLAIN[name] || "";
  return el;
}

// A session's state, in its fixed slot: the spinner while it works, a filled
// check in the accent when it finished and you haven't opened it yet.
function stateIcon(s) {
  const st = doneOf(s);
  if (st === "working") return h("span", { class: "state working", title: STATUS.working }, SPINNER[spin.frame]);
  const el = glyph(st, `state ${st}`);
  el.title = STATUS[st];
  return el;
}

const spin = { frame: 0 };
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  spin.frame = (spin.frame + 1) % SPINNER.length;
  document.querySelectorAll(".state.working, .spinner").forEach((el) => { el.textContent = SPINNER[spin.frame]; });
}, 90);

// What a session is about, the keyword before ": " in bold.
function taskText(task, cls) {
  const el = h("div", { class: `task${cls ? ` ${cls}` : ""}` });
  const i = task.indexOf(": ");
  if (i > 0) el.append(h("b", {}, task.slice(0, i + 1)), " ", task.slice(i + 2));
  else el.append(h("b", {}, task));
  return el;
}

// The look picked (theme.css: the theme, its font, the wallpaper), again
// whenever it changes, on every device; the status bar in its background.
function wearLook(look) {
  const stamp = look ? `${look.look || ""}${look.font || ""}` : "";
  const link = document.getElementById("look");
  if (link && !link.dataset.stamp) link.dataset.stamp = stamp;     // the page came with this one
  else if (link && stamp && link.dataset.stamp !== stamp) {
    const v = `${(look.look || "").slice(0, 12)}${(look.font || "").slice(0, 12)}`;
    const next = h("link", { rel: "stylesheet", href: `theme.css?v=${v}`, id: "look" });
    next.dataset.stamp = stamp;
    next.addEventListener("load", async () => {
      link.remove();
      paintBars();
      // A new font: loaded before the terminals measure it again (or a moment's wait).
      const family = getComputedStyle(document.documentElement).getPropertyValue("--font").trim();
      if (family && document.fonts) await Promise.race([
        Promise.all([document.fonts.load(`16px ${family}`), document.fonts.load(`bold 16px ${family}`)]).catch(() => {}),
        new Promise((ok) => setTimeout(ok, 3000))]);
      restyleTerminals();
    });
    link.after(next);
  }
  paintBars();
}

// The real terminals wear it too (desk.js).
function restyleTerminals() {
  for (const p of [desk.claude, desk.term, app.session && app.session.pane]) if (p) p.restyle();
}

function paintBars() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", bg));
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
    throw new Error("Can't reach Amarchy");
  }
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error(data.error || `It didn't work (${res.status})`);
  return data;
}

let toastTimer = null;
function toast(text) {
  document.querySelectorAll(".toast:not(.stay)").forEach((t) => t.remove());
  const t = h("div", { class: "toast", role: "status" }, text);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { /* private mode */ } },
};

// ---- links out: every link in the app (the chat, the terminals) leaves through here
//
// A page can't ask which browser is the default. A Mac's web app (Safari's
// Add to Dock) gives a link to another site to the default browser itself,
// but only one clicked as a link: window.open keeps it in the web app. An
// iPhone's home-screen app shows it in a Safari sheet whatever the default
// is; only an app's own address (googlechromes://…) reaches another browser.
// So on an iPhone or iPad the settings can name one, kept on that device.

const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

const BROWSERS = [
  ["", "As iOS does", null],
  ["safari", "Safari", (u) => `x-safari-${u}`],
  ["chrome", "Chrome", (u) => u.replace(/^http/i, "googlechrome")],
  ["firefox", "Firefox", (u) => `firefox://open-url?url=${encodeURIComponent(u)}`],
  ["edge", "Edge", (u) => `microsoft-edge-${u}`],
  ["brave", "Brave", (u) => `brave://open-url?url=${encodeURIComponent(u)}`],
];

function linkBrowser() {
  const b = iOS && BROWSERS.find(([k]) => k && k === store.get("open-links"));
  return b || null;
}

// A link to somewhere else: http(s), and not this app.
function outward(uri) {
  try {
    const u = new URL(uri, location.href);
    return /^https?:$/.test(u.protocol) && u.origin !== location.origin ? u.href : null;
  } catch (e) { return null; }
}

function follow(href, target) {
  const a = h("a", { href, target, rel: "noopener noreferrer" });
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
}

// Called from a click (or a key), so the browser lets it open something.
function openLink(uri) {
  const url = outward(uri);
  if (!url) return;
  const b = linkBrowser();
  if (!b) return follow(url, "_blank");
  follow(b[2](url));
  // Nothing answers when the app isn't there: still here a moment later, say so.
  setTimeout(() => {
    if (document.visibilityState === "visible" && document.hasFocus()) toast(`If ${b[1]} didn't open, is it installed? (Settings → Links)`);
  }, 2500);
}

document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest("a[href]");
  if (!a || !a.isConnected || !outward(a.href) || !linkBrowser()) return;      // the system's way: the link as it is
  e.preventDefault();
  openLink(a.href);
}, true);

function linkSettings() {
  if (!iOS) {
    return [h("div", { class: "section" }, "Links"),
      h("p", {}, /Macintosh/.test(navigator.userAgent)
        ? "Links open in this Mac's default browser when Amarchy is in the Dock (in Safari: File → Add to Dock); in a browser tab, in a new tab."
        : "Links open in this device's default browser, as it opens them.")];
  }
  const now = (linkBrowser() || BROWSERS[0])[0];
  return [h("div", { class: "section" }, "Open links in"),
    h("div", { class: "seg wrap" }, ...BROWSERS.map(([k, label]) =>
      h("button", { class: `control${now === k ? " on" : ""}`, onclick: () => { store.set("open-links", k); openSettings(); } }, label))),
    h("p", {}, now ? `On this ${/iPhone|iPod/.test(navigator.userAgent) ? "iPhone" : "iPad"}, links open in ${(linkBrowser() || [])[1]}, which has to be installed.`
                   : "iOS opens links from a Home Screen app in a Safari sheet, whatever your default browser is: a web page can't ask which it is. Pick one to open them there instead.")];
}

function where(s) { return `${s.repo} · ${s.name || s.branch}`; }
function title(s) { return s.task || s.name; }
function statusOf(s) { return s.status === "asleep" ? "idle" : (s.status || "idle"); }
function stateOf(s) { return s.status || "idle"; }
// As the list shows it: "done" for one that finished and you haven't opened since.
function doneOf(s) { return stateOf(s) === "idle" && s.unseen === true ? "done" : stateOf(s); }
// Asleep: its Claude Code isn't running (its memory freed) until something
// you send wakes it, its conversation kept; waking: Claude on its way back.
function sleepOf(s) { return !s || s.setup ? "" : s.waking ? "waking" : s.sleeping ? "asleep" : ""; }
const SLEEP = { asleep: "Asleep", waking: "Waking…" };
function sleepMark(s) {
  const st = sleepOf(s);
  if (!st) return null;
  const el = glyph("asleep", `sleep ${st}`);
  el.title = st === "waking" ? "Waking up" : "Asleep: its memory is freed until you send it something";
  return el;
}

async function wakeSession(s) {
  try { await api(`/api/session/${encodeURIComponent(s.id)}/wake`); } catch (e) { toast(e.message); }
}

async function sleepSession(s) {
  try {
    await api(`/api/session/${encodeURIComponent(s.id)}/sleep`);
    toast("Asleep: its memory is freed until you send it something.");
  } catch (e) { toast(e.message); }
}

// The session's Claude on the other engine, the same conversation: the new
// chat (Claude Code as a chat, its questions as data) or Claude's classic
// terminal (the TUI). Once it's idle.
async function switchEngine(s, want) {
  try {
    await api(`/api/session/${encodeURIComponent(s.id)}/engine`, { engine: want });
    toast(want === "chat" ? "On the new chat now: same conversation" : "Back on Claude's classic terminal");
  } catch (e) { toast(e.message); }
}

function engineButton(s) {
  if (s.setup) return null;
  const chat = s.engine === "chat";
  return h("button", { class: "control wide", onclick: () => { closeSheets(); switchEngine(s, chat ? "terminal" : "chat"); } },
    chat ? "Back to the classic terminal" : "Try the new chat");
}

// Wake or sleep, as the session is now.
function sleepButton(s) {
  const st = sleepOf(s);
  if (st === "waking" || s.setup) return null;
  return h("button", { class: "control wide", onclick: () => { closeSheets(); st ? wakeSession(s) : sleepSession(s); } },
    st ? "Wake" : "Put to sleep");
}

// The visible part of the screen: above the keyboard while it's up.
function fitViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const up = vv.height < window.innerHeight - 120;
  // On the page's own element, for #root and the sheets over it alike.
  document.documentElement.style.setProperty("--vvh", `${vv.height}px`);
  document.documentElement.style.setProperty("--vv-top", `${vv.offsetTop}px`);
  root.style.transform = `translateY(${vv.offsetTop}px)`;
  document.body.classList.toggle("keyboard-up", up);
}
if (window.visualViewport) {
  visualViewport.addEventListener("resize", fitViewport);
  visualViewport.addEventListener("scroll", fitViewport);
}

// ---- the list

// amarchy was updated on the host (its app came back with other pages):
// the new ones, at once if you're not looking, else when you click.
function updated() {
  if (app.reloading) return;
  app.reloading = true;
  if (document.hidden) return document.addEventListener("visibilitychange", () => location.reload(), { once: true });
  const t = h("div", { class: "toast action stay", role: "status", onclick: () => location.reload() },
              "Amarchy was updated: click here to load it");
  document.body.append(t);
  document.addEventListener("visibilitychange", () => { if (document.hidden) location.reload(); });
}

function openList() {
  if (app.list) return;
  const es = new EventSource("/api/events");
  app.list = es;
  es.addEventListener("list", (e) => {
    app.view = JSON.parse(e.data);
    const o = app.organize;
    if (o && o.done && same(o.group, app.view.group) && o.sort === app.view.sort) app.organize = null;
    app.online = true;
    app.failed = "";
    app.nerd = !!app.view.nerd;
    if (app.view.build && app.build && app.view.build !== app.build) updated();
    app.build = app.build || app.view.build;
    wearLook(app.view.look);
    badge();
    refresh();
  });
  es.addEventListener("open", () => { if (!app.online) { app.online = true; refresh(); } });
  es.addEventListener("error", () => {
    app.online = false;
    refresh();
  });
}

// The list changed: on a wide screen the wide layout (desk.js), else the list's view.
function refresh() {
  if (app.desk) deskList();
  else if (!app.session) renderList();
}

function closeList() {
  if (app.list) app.list.close();
  app.list = null;
}

// What needs you, on the tab and the app's icon (manage.js).
function badge() { markWaiting(); }

function groupLabel(s, g) {
  if (g === "project") return s.repo;
  if (g === "priority") return `${PRIORITY[s.priority] || "Normal"} priority`;
  return STATUS[doneOf(s)];
}

// The list's view, built once and kept: its bar holds what you're typing
// while the list under it changes.
function listView() {
  if (app.listEl) return app.listEl;
  const meta = h("div", { class: "meta" });
  const head = h("div", { class: "hero" },
    h("div", { class: "main" }, h("h1", {}, "Amarchy"), meta),
    h("button", { class: "icon-btn", "aria-label": "Settings", onclick: openSettings }, glyph("gear")));
  // Above the list, as in the wide layout beside Claude: the search, and how
  // the list is grouped and sorted.
  const search = h("input", { type: "search", placeholder: "Search sessions", enterkeyhint: "search",
                              autocomplete: "off", autocorrect: "off", autocapitalize: "off", spellcheck: "false",
                              oninput: () => { app.query = search.value; renderList(); },
                              onkeydown: (e) => {
                                if (e.key === "Enter") search.blur();
                                else if (e.key === "ArrowDown") { e.preventDefault(); const first = menuItems(list)[0]; if (first) first.focus(); }
                              } });
  const clear = h("button", { class: "clear", "aria-label": "Clear the search",
                              onclick: () => { search.value = app.query = ""; renderList(); search.focus(); } }, glyph("close"));
  const organize = h("button", { class: "control organize", "aria-label": "Group and sort the list", "aria-haspopup": "menu",
                                 onclick: () => toggleOrganize(menu, organize, renderList),
                                 onkeydown: (e) => { if (e.key === "ArrowDown" && menu.hidden) { e.preventDefault(); toggleOrganize(menu, organize, renderList); } } },
                     glyph("organize"));
  const menu = organizeBox(() => organize, renderList);
  const shade = h("div", { class: "organize-shade", onclick: () => { menu.hidden = true; renderList(); } });
  const toolbar = h("div", { class: "toolbar" }, h("label", { class: "searchbox" }, glyph("search"), search, clear), organize, menu);
  const offline = h("div", { class: "offline" }, "Reconnecting to Amarchy…");
  const list = h("div", { class: "list" });
  menuKeys(list);       // ↑/↓ from session to session, ↵ opens one
  list.addEventListener("keydown", (e) => {     // ↑ from the first: back to the search
    if (e.key === "ArrowUp" && !e.defaultPrevented && menuItems(list)[0] === document.activeElement && !toolbar.hidden) {
      e.preventDefault();
      search.focus();
    }
  }, true);
  const scroll = h("div", { class: "scroll" }, list);
  app.newBar = newBar();
  app.listEl = h("div", { class: "view list-view" }, head, shade, toolbar, offline, scroll, h("div", { class: "dock" }, app.newBar.el));
  Object.assign(app.listEl, { meta, offline, list, scroll, toolbar, clear, organize, menu, shade });
  return app.listEl;
}

function renderList() {
  const view = listView();
  if (!root.contains(view)) {
    root.replaceChildren(view);
    view.scroll.scrollTop = 0;
  }
  const v = app.view;
  view.meta.replaceChildren();
  if (v) {
    const waiting = v.sessions.filter((s) => s.status === "waiting").length;
    view.meta.append(`${v.sessions.length} session${v.sessions.length === 1 ? "" : "s"}`);
    if (waiting) view.meta.append(" · ", h("span", { class: "waiting" }, `${waiting} need${waiting === 1 ? "s" : ""} you`));
  }
  view.offline.hidden = app.online || !v;
  view.toolbar.hidden = !v || !v.sessions.length;
  view.clear.hidden = !app.query;
  if (view.toolbar.hidden) view.menu.hidden = true;
  view.shade.hidden = view.menu.hidden;
  view.organize.classList.toggle("on", !view.menu.hidden);
  if (!view.menu.hidden) keepFocus(view.menu, () => view.menu.replaceChildren(...organizeMenu()));
  const list = view.list;
  keepFocus(list, () => {
    list.replaceChildren();
    const shown = v ? matching(v.sessions, app.query) : [];
    if (!v) {
      list.append(h("div", { class: "empty" }, app.failed || "Connecting…"));
    } else if (!v.sessions.length) {
      list.append(h("div", { class: "empty" }, "No sessions yet.", h("br"),
        v.projects && v.projects.length ? "Say what Claude should do, below, to start one."
          : h("button", { class: "control accent", onclick: () => newProjectSheet((p) => app.newBar.use(p)) }, "Add a project…")));
    } else if (!shown.length) {
      list.append(h("div", { class: "empty" }, `No session called “${app.query.trim()}”`));
    } else {
      // Your assistant first, in a place of its own above the groups (amarchy
      // assistant): its card, the other sessions of its project under it.
      const mine = shown.filter((s) => s.assistant);
      if (mine.length)
        list.append(h("div", { class: "assistant-section" },
          ...mine.map((s) => s.assistant === "main" ? assistantCard(s) : sessionRow(s, [], true))));
      // The rest grouped as amarchy groups them, outermost first. With more than
      // one grouping the outermost is a rule across the list, its name in the middle.
      grouped(list, shown, v.group || [], (s) => sessionRow(s, v.group || []));
    }
  });
  app.newBar.update();
}

// The sessions under your assistant's section, grouped as amarchy groups
// them, outermost first: a header where a group changes. With more than one
// grouping the outermost is a rule across the list, its name in the middle.
// A project's header opens the order of your projects (and in the wide
// layout, under the pointer, has arrows to move it past the project next to it).
function grouped(list, shown, groups, rowOf) {
  const rest = shown.filter((s) => !s.assistant);
  let prev = [];
  rest.forEach((s, n) => {
    const labels = groups.map((g) => groupLabel(s, g));
    const at = labels.findIndex((l, i) => l !== prev[i]);
    if (at >= 0)
      for (let i = at; i < labels.length; i++) {
        const ruled = i === 0 && groups.length > 1;
        list.append(groups[i] === "project"
          ? projectHead(s.repo, ruled, nextProject(rest, n, groups, -1), nextProject(rest, n, groups, 1))
          : h("div", { class: `group-head${ruled ? " ruled" : ""}` }, labels[i]));
      }
    prev = labels;
    list.append(rowOf(s));
  });
}

// The project next to the nth session's (dy -1 above, 1 under) inside the
// same outer groups, or "" at either end of them.
function nextProject(rest, n, groups, dy) {
  const s = rest[n], outer = groups.slice(0, groups.indexOf("project"));
  for (let i = n + dy; i >= 0 && i < rest.length; i += dy) {
    const o = rest[i];
    if (outer.some((g) => groupLabel(o, g) !== groupLabel(s, g))) return "";
    if (o.repo !== s.repo) return o.repo;
  }
  return "";
}

function projectHead(repo, ruled, above, below) {
  const arrow = (icon, label, where, other) => h("button", {
    class: "move", "aria-label": label, disabled: !other,
    onclick: (e) => { e.stopPropagation(); moveProject(repo, where, other); } }, glyph(icon));
  return h("div", { class: `group-head project-head${ruled ? " ruled" : ""}`, role: "button", tabindex: "0",
                    title: "Order your projects", onclick: () => orderProjects(repo),
                    onkeydown: (e) => { if (e.key === "Enter") orderProjects(repo); } },
    h("span", { class: "name" }, repo),
    h("span", { class: "moves" }, arrow("up", `Move ${repo} up`, "before", above),
      arrow("under", `Move ${repo} down`, "after", below)));
}

// Move a project ("before" or "after" another, "up", "down", "top", "bottom")
// in the order your projects come in, on every phone and browser.
async function moveProject(name, where, other) {
  try {
    const { projects } = await api("/api/projects/move", other ? { name, where, other } : { name, where });
    return projects;
  } catch (e) {
    toast(e.message);
    return null;
  }
}

// The order your projects come in (the list's project groups, the picker of
// a new session): each with arrows to move it, the one you came from lit.
function orderProjects(lit) {
  const names = (app.view && app.view.projects || []).map((p) => p.name);
  for (const s of (app.view && app.view.sessions) || []) if (!names.includes(s.repo)) names.push(s.repo);
  const count = Object.fromEntries(((app.view && app.view.projects) || []).map((p) => [p.name, p.sessions || 0]));
  const list = h("div", { class: "menu project-order" });
  // The keys stay on the arrow you pressed, on the project as it moves
  // (on its other arrow at either end).
  const arrowOn = (name, dir) => {
    const moves = Array.from(list.querySelectorAll(".control.move")).filter((b) => b.dataset.name === name);
    const to = moves.find((b) => b.dataset.dir === dir && !b.disabled) || moves.find((b) => !b.disabled);
    if (to) to.focus();
  };
  const draw = () => {
    const was = list.contains(document.activeElement) && document.activeElement.dataset;
    const dir = was && was.dir;
    list.replaceChildren(...rows());
    if (dir) arrowOn(lit, dir);
  };
  const rows = () => names.map((name, i) => h("div", { class: `menu-item${name === lit ? " on" : ""}` },
    h("span", { class: "label" }, glyph("project", "icon"), h("span", { class: "text" }, name),
      count[name] ? h("small", {}, String(count[name])) : null),
    h("span", { class: "moves" },
      holdable(h("button", { class: "control move", "aria-label": `Move ${name} up (hold, or Shift+Enter: to the top)`, disabled: i === 0,
                             "data-name": name, "data-dir": "up", onclick: () => move(name, "up") },
                 glyph("up")), () => move(name, "top")),
      holdable(h("button", { class: "control move", "aria-label": `Move ${name} down (hold, or Shift+Enter: to the bottom)`,
                             disabled: i === names.length - 1, "data-name": name, "data-dir": "down",
                             onclick: () => move(name, "down") }, glyph("under")),
               () => move(name, "bottom")))));
  const move = async (name, where) => {
    lit = name;
    const at = names.indexOf(name);
    names.splice(at, 1);      // at once; amarchy's own order once it answers
    names.splice({ up: at - 1, down: at + 1, top: 0, bottom: names.length }[where], 0, name);
    draw();
    const now = await moveProject(name, where);
    if (now) names.splice(0, names.length, ...now);
    draw();
  };
  list.addEventListener("keydown", (e) => {      // Shift+↵ on an arrow: as holding it
    const b = e.target.dataset;
    if (e.key !== "Enter" || !e.shiftKey || !b.dir) return;
    e.preventDefault();
    move(b.name, b.dir === "up" ? "top" : "bottom");
  });
  draw();
  sheet(sheetHead("Order projects", app.desk ? "Hold an arrow (or Shift+↵ on it): to the top or bottom" : "Hold an arrow: to the top or bottom"), list,
    h("button", { class: "control wide", onclick: closeSheet }, "Done"));
  if (lastInput.keys) arrowOn(lit || names[0], "up");
}

// The sessions the search matches by name (what it's about, Claude's title
// for it, its project and its branch), every word of it.
function matching(sessions, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return sessions;
  return sessions.filter((s) => {
    const name = `${s.task || ""} ${s.claude_title || ""} ${s.repo || ""} ${s.name || ""}`.toLowerCase();
    return words.every((w) => name.includes(w));
  });
}

function same(a, b) { return JSON.stringify(a || []) === JSON.stringify(b || []); }

// How the list is grouped (any of them, nested in the order you turn them
// on, each showing its level) and sorted inside its groups. It's one setting
// on the host (amarchy group, sort): change it here and every phone's and
// browser's list changes too.
const GROUPINGS = [["project", "project", "Project"], ["priority", "high", "Priority"],
                   ["status", "status", "Status"], ["none", "organize", "Not grouped"]];
const SORTINGS = [["priority", "high", "Priority"], ["newest", "newest", "Newest first"], ["oldest", "oldest", "Oldest first"]];

function organizeMenu() {
  const v = app.organize || app.view || {};
  const groups = v.group || [], sort = v.sort || "priority";
  const row = (icon, label, on, level, pick) =>
    h("button", { class: `menu-item${on ? " on" : ""}`, onclick: pick },
      h("span", { class: "label" }, glyph(icon, "icon"), label),
      on ? (level ? h("span", { class: "val level" }, level) : glyph("check", "val")) : null);
  return [
    h("div", { class: "menu-head top" }, "Group by",
      h("button", { class: "menu-close", "aria-label": "Close", title: "Close (Esc)", onclick: () => closeOrganize() }, glyph("close"))),
    ...GROUPINGS.map(([what, icon, label]) => {
      const on = what === "none" ? !groups.length : groups.includes(what);
      const level = on && what !== "none" && groups.length > 1 ? String(groups.indexOf(what) + 1) : "";
      const next = what === "none" ? [] : on ? groups.filter((g) => g !== what) : [...groups, what];
      return row(icon, label, on, level, () => organizeList(next, sort));
    }),
    h("div", { class: "menu-head" }, "Sort by"),
    ...SORTINGS.map(([what, icon, label]) => row(icon, label, sort === what, "", () => organizeList(groups, what))),
    h("div", { class: "menu-head" }, "Projects"),
    row("order", "Order projects…", false, "", () => { closeOrganize(); orderProjects(); }),
  ];
}

// The group & sort menu's box (the phone's list, beside Claude in the wide
// layout), with the keys of a menu: Esc closes it, back to its button.
function organizeBox(button, redraw) {
  const menu = h("div", { class: "organize-menu", role: "menu", tabindex: "-1", hidden: true });
  menu.button = button;
  menuKeys(menu, { close: () => { menu.hidden = true; redraw(); button().focus(); } });
  return menu;
}

// Its button opens it (with the keys, the cursor on its first line) or closes it.
function toggleOrganize(menu, button, redraw) {
  menu.hidden = !menu.hidden;
  redraw();
  if (!menu.hidden) menuFocus(menu);
  else if (menu.contains(document.activeElement)) button.focus();
}

// The group & sort menu goes, wherever it is (the phone's list, beside Claude in the wide layout).
// The keys, if they were in it, go back to its button.
function closeOrganize() {
  for (const menu of [app.listEl && app.listEl.menu, typeof desk !== "undefined" && desk.organize]) {
    if (!menu) continue;
    const had = menu.contains(document.activeElement);
    menu.hidden = true;
    if (had) menu.button().focus();
  }
  refresh();
}

async function organizeList(group, sort) {
  const mine = { group, sort, done: false };
  app.organize = mine;
  refresh();
  try {
    await api("/api/list", { group, sort });
    mine.done = true;
    if (app.view && same(app.view.group, group) && app.view.sort === sort && app.organize === mine) app.organize = null;
  } catch (e) {
    if (app.organize === mine) app.organize = null;
    toast(e.message);
    refresh();
  }
}

// Held down (as a right click in the wide layout): what you can change about
// it from the list, its priority. With the keys: the menu key, or Shift+F10.
function holdable(el, onHold) {
  el.addEventListener("keydown", (e) => {
    if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
    e.preventDefault();
    onHold();
  });
  let timer = null, held = false, x = 0, y = 0;
  const cancel = () => clearTimeout(timer);
  el.addEventListener("pointerdown", (e) => {
    held = false; x = e.clientX; y = e.clientY;
    cancel();
    timer = setTimeout(() => { held = true; onHold(); }, 500);
  });
  el.addEventListener("pointermove", (e) => { if (Math.hypot(e.clientX - x, e.clientY - y) > 10) cancel(); });
  for (const end of ["pointerup", "pointercancel", "pointerleave"]) el.addEventListener(end, cancel);
  el.addEventListener("click", (e) => { if (held) { e.stopImmediatePropagation(); held = false; } }, true);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  return el;
}

// High, normal or low, the one it is on.
function prioritySeg(s) {
  return h("div", { class: "seg" }, ...["high", "normal", "low"].map((p) =>
    h("button", { class: `control${(s.priority || "normal") === p ? " on" : ""}`,
                  onclick: async () => {
                    try {
                      await api(`/api/session/${encodeURIComponent(s.id)}/priority`, { level: p });
                      closeSheets();
                    } catch (e) { toast(e.message); }
                  } }, PRIORITY[p])));
}

function rowMenu(s) {
  sheet(sheetHead(title(s), where(s)), h("div", { class: "section" }, "Priority"), prioritySeg(s),
    h("button", { class: "control wide", onclick: () => { closeSheets(); go(`#/s/${encodeURIComponent(s.id)}`); } },
      "Open"),
    ...sessionActions(s),
    closeButton(s));
}

// What else you can do to a session from its menu (manage.js): name it, run
// its commands, make it your assistant (or change yours).
function sessionActions(s, opened) {
  return [
    h("button", { class: "control wide", onclick: () => renameSheet(s) }, "Rename…"),
    h("button", { class: "control wide", onclick: () => commandsSheet(s, opened) }, "Run…"),
    h("button", { class: "control wide", onclick: () => assistantSheet(s) },
      s.assistant === "main" ? `${s.assistant_name || "Assistant"}: name, picture, chime…` : "Make it my assistant…"),
    sleepButton(s),
  ].filter(Boolean);
}

function closeButton(s) {
  return h("button", { class: "control wide danger", onclick: () => confirmClose(s) }, "Close session");
}

// Closing, asked first: it removes the worktree, and
// with it any work not committed, which it says in so many words.
async function confirmClose(s, known) {
  let c = known;
  if (!c) {
    try {
      const res = await fetch(`/api/session/${encodeURIComponent(s.id)}/closing`);
      c = await res.json();
      if (!res.ok) throw new Error(c.error || "Amarchy didn't answer");
    } catch (e) {
      toast(e.message);
      return;
    }
  }
  const n = c.changes || 0;
  let detail = n ? `${n} uncommitted file${n === 1 ? "" : "s"} lost` : "Removes its worktree";
  if (c.amarchy) detail += " · amarchy runs from it, and goes back to its project's checkout";
  const yes = h("button", { class: "control wide danger", onclick: async () => {
    yes.disabled = true;
    try {
      const res = await fetch(`/api/session/${encodeURIComponent(s.id)}/close`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ discard: n > 0 }) });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && d.changes) return confirmClose(s, d);      // changes since: ask again
      if (!res.ok) throw new Error(d.error || "It didn't close");
      closeSheets();
      toast(`Closing ${s.repo} · ${s.name}`);
      if (app.session && app.session.id === s.id) go("#/");
    } catch (e) {
      yes.disabled = false;
      toast(e instanceof TypeError ? "Can't reach Amarchy" : e.message);
    }
  } }, n ? "Close and discard changes" : "Close session");
  sheet({ key: "close" }, sheetHead(`Close ${where(s)}?`, detail), yes,
    h("button", { class: "control wide", onclick: closeSheet }, "Cancel"));
}

// Your assistant's picture: yours (amarchy assistant --picture), by its hash,
// else amarchy's own (app/assistant.svg).
function avatar(s, cls) {
  const src = /^[0-9a-f]{12}$/.test(s.picture || "") ? `/picture/${s.picture}-512.png` : "/assistant.svg";
  return h("img", { class: `avatar${cls ? ` ${cls}` : ""}`, src, alt: "", draggable: "false" });
}

// Your assistant, at the top of the list: its picture with its state on it,
// its name, and what it's on.
// What it wrote and you haven't read (a turn it finished since you last
// looked, on any device) shows as its first words, with "New" by its name.
function assistantCard(s) {
  const st = doneOf(s);
  const name = s.assistant_name || "Assistant";
  const task = s.task && s.task.toLowerCase() !== name.toLowerCase() ? s.task : "";
  const unread = s.unseen && !!s.said;
  const line = s.setup ? "Setting up…" : st === "waiting" ? "Needs you" : unread ? s.said
    : task || (st === "working" ? "On it…" : "Here for you");
  return holdable(h("button", { class: `row assistant ${st}${unread ? " unread" : ""}`, "data-id": s.id,
                                onclick: () => { go(`#/s/${encodeURIComponent(s.id)}`); } },
    h("span", { class: "avatar-wrap" }, avatar(s), stateIcon(s)),
    h("span", { class: "main" },
      h("div", { class: "name" }, name, unread ? h("span", { class: "new" }, "New") : null),
      h("div", { class: `line${st === "waiting" ? " waiting" : ""}${unread ? " said" : ""}` }, line),
      h("div", { class: "meta" }, unread ? (task ? `${task} · unread` : "Unread") : STATUS[st])),
    h("span", { class: "side" }, h("span", { class: "age" }, s.age || ""), unreadDot(s), sleepMark(s))), () => rowMenu(s));
}

// A session that finished a turn you haven't opened yet: a dot by its time.
function unreadDot(s) {
  return s.unseen ? h("span", { class: "dot", title: "Unread", "aria-label": "Unread" }) : null;
}

// One session in the list: the project and the priority
// only when no header above it says them already. near: another session of
// your assistant's project, under it, with its picture small.
function sessionRow(s, groups, near = false) {
  const showRepo = !groups.includes("project"), showPriority = !groups.includes("priority");
  const prio = showPriority && s.priority && s.priority !== "normal"
    ? glyph(s.priority, `prio ${s.priority}`) : null;
  const task = s.setup ? `${title(s)} (setting up…)` : (s.task || "new session");
  const bg = s.background > 0 ? ` · +${s.background} bg` : "";
  return holdable(h("button", { class: `row${s.priority === "low" ? " low" : ""}`, "data-id": s.id,
                       onclick: () => { go(`#/s/${encodeURIComponent(s.id)}`); } },
    stateIcon(s),
    near ? avatar(s, "small") : null,
    h("span", { class: "main" },
      taskText(task, s.task ? "" : "untitled"),
      // Your assistant's other sessions, unread: what it wrote, in a line.
      near && s.unseen && s.said ? h("div", { class: "meta said" }, s.said)
        : h("div", { class: "meta" }, `${showRepo ? `${s.repo} · ` : ""}${s.name}${bg}`)),
    h("span", { class: "side" }, h("span", { class: "age" }, s.age || ""), unreadDot(s), prio, sleepMark(s))), () => rowMenu(s));
}

// ---- a session

class SessionView {
  constructor(id) {
    this.id = id;
    this.row = app.view && app.view.sessions.find((s) => s.id === id) || null;
    this.screen = null;
    this.mode = "chat";
    this.build();
    this.open();
    this.seen = setInterval(() => this.markSeen(), 10000);
    this.markSeen();
    if (app.handed && app.handed.id === id) {     // said on the new-session bar, for this one
      const handed = app.handed;
      app.handed = null;
      this.dictate(handed);
    }
  }

  build() {
    this.titleEl = h("div", { class: "title" });
    const bar = h("div", { class: "bar" },
      h("button", { class: "icon-btn", "aria-label": "Sessions", onclick: () => { go("#/"); } }, glyph("back")),
      this.titleEl,
      h("button", { class: "icon-btn", "aria-label": "More", onclick: () => this.menu() }, glyph("more")));
    // The conversation, its cards and the box you type in (chat.js).
    this.chat = new Chat({
      id: this.id, row: this.row,
      onSession: (row) => { this.row = row; this.renderHeader(); },
      onScreen: (screen) => { this.screen = screen; if (this.mode === "screen") this.renderScreen(); },
      onGone: (why) => {
        toast(why ? "Can't open that session." : "That session was closed.");
        go("#/");
      },
      // Claude's voice mode, for a terminal-engine session's mic.
      claude: { start: () => this.dictate(), stop: () => this.letGo() },
      voiceHeld: () => !!this.voice && this.voice.held,
    });
    this.screenEl = h("pre", { class: "screen" });
    this.keysRow = h("div", { class: "keys" },
      ...[["↑", "Up"], ["↓", "Down"], ["⏎", "Enter"], ["Esc", "Escape"], ["Tab", "Tab"], ["⇧Tab", "BTab"],
          ["1", "1"], ["2", "2"], ["3", "3"]].map(([label, key]) =>
        h("button", { class: "control", onclick: () => this.press([key]) }, label)));
    this.el = h("div", { class: "view" }, bar, this.chat.el);
    root.replaceChildren(this.el);
    this.renderHeader();
  }

  open() { this.chat.open(); }

  close() {
    this.chat.close();
    this.closed = true;
    if (this.pane) this.pane.disconnect();
    clearInterval(this.seen);
  }

  // Claude's own dictation (its voice mode), from the phone's microphone:
  // while the button is held, what the phone hears goes to the session's
  // Claude as if its voice key were held down; let go, and what Claude
  // made of it comes into the box, to send from there. What's said before
  // Claude can listen (it's starting, in a session just made) waits for it.
  // handed: said already, on the new-session bar ({queue}: its audio).
  async dictate(handed) {
    if (this.voice) return;
    // What was in the box before: the words go after it, as they come.
    const v = this.voice = { held: !handed, ws: null, queue: handed ? handed.queue : [], heard: false,
                             base: this.chat.input.value.replace(/\s+$/, "") };
    const write = (words) => {
      this.chat.input.value = v.base && words ? `${v.base} ${words}` : v.base || words;
      this.chat.grow();
      this.chat.sendButtons();
    };
    const done = () => {
      if (this.voice === v) this.voice = null;
      this.chat.listening(null);
    };
    if (!handed) {
      // Listening once the microphone hears: what's said before is lost.
      this.chat.listening("Starting the microphone…");
      mic.hears = () => { if (v.held) this.chat.listening("Listening…"); };
      try {
        await micOpen();
      } catch (e) {
        done();
        toast(e.name === "NotAllowedError" ? "Amarchy may not use the microphone: allow it in the phone's Settings"
                                          : `The microphone didn't start: ${e.message}`);
        return;
      }
      if (!v.held) {      // let go already (the first time, while the phone asked about the microphone)
        done();
        micRelease();
        return;
      }
      mic.take = (pcm) => {
        if (v.ws && v.ws.readyState === WebSocket.OPEN) v.ws.send(pcm);
        else if (v.queue.length < 15000) v.queue.push(pcm);      // 5 minutes, as long as one can be
      };
    }
    const url = `/api/session/${encodeURIComponent(this.id)}/voice`;
    const why = await this.voiceReady(v, url);
    if (why !== null) {
      if (v.held) micRelease();
      v.held = false;
      done();
      if (why) toast(why);
      return;
    }
    const ws = v.ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${url}`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      for (const pcm of v.queue) ws.send(pcm);
      v.queue = [];
      if (!v.held) this.end(v);
    };
    ws.onmessage = (e) => {
      let d = {};
      try { d = JSON.parse(e.data); } catch (err) { return; }
      v.heard = true;
      if (d.state === "transcribing") this.chat.listening("Claude is writing it down…");
      if (typeof d.interim === "string") write(d.interim);
      if (typeof d.text === "string") {
        ws.send("got");     // it can go from Claude's prompt now
        write(d.text);
        store.set(`draft:${this.id}`, this.chat.input.value);
      }
      if (d.error) {
        write("");
        toast(d.error);
      }
    };
    ws.onclose = async () => {
      if (v.held) micRelease();       // gone while the button was still held
      v.held = false;
      done();
      if (!v.heard) {     // it didn't take it: ask why
        try {
          const r = await fetch(url);
          const d = await r.json();
          toast(d.error || "Dictation didn't connect");
        } catch (e) {
          toast("Can't reach Amarchy");
        }
      }
    };
  }

  // Whether Claude can take a dictation now: null when it can, else why not
  // ("" when there's nothing to say: the session was left). While it can't
  // yet (it's starting, or asking something), it's asked again, for a while.
  async voiceReady(v, url) {
    const until = Date.now() + 120000;
    for (;;) {
      if (this.closed || this.voice !== v) return "";
      let d = {};
      try {
        const r = await fetch(url);
        d = await r.json();
        if (r.ok) return null;
      } catch (e) {
        return "Can't reach Amarchy";
      }
      if (!d.wait || Date.now() > until) return d.error || "Dictation didn't connect";
      if (!v.held) this.chat.listening("Waiting for Claude to start…");
      await new Promise((ok) => setTimeout(ok, 700));
    }
  }

  // Let go: the rest of what it heard, then "end" (once it's connected).
  // Let go: the microphone keeps on a moment (the last word is still being
  // said as the finger lifts), then the rest of it and "end".
  async letGo() {
    const v = this.voice;
    if (!v || !v.held) return;
    v.held = false;
    this.chat.micBtn.classList.remove("on");
    await new Promise((ok) => setTimeout(ok, MIC_TAIL));
    micRelease();
    if (v.ws && v.ws.readyState === WebSocket.OPEN) this.end(v);
    else this.chat.listening(v.ws ? "Claude is writing it down…" : "Waiting for Claude…");
  }

  end(v) {
    v.ws.send("end");
    this.chat.listening("Claude is writing it down…");
  }

  // Back from the background: everything from scratch.
  reopen() {
    this.chat.reopen();
    this.closed = false;
    if (this.mode === "terminal") this.pane.open(this.id);
    this.seen = setInterval(() => this.markSeen(), 10000);
    this.markSeen();
  }

  markSeen() {
    if (document.visibilityState === "visible")
      api(`/api/session/${encodeURIComponent(this.id)}/seen`).catch(() => {});
  }

  // The strip above Claude: its state, what it's about, project · name.
  renderHeader() {
    if (!this.row) {
      this.titleEl.replaceChildren(h("div", { class: "text" }, taskText("…")));
      return;
    }
    // Your assistant's, under its name and picture: you know who you're talking to.
    const r = this.row;
    if (r.assistant === "main") {
      const name = r.assistant_name || "Assistant";
      const task = r.task && r.task.toLowerCase() !== name.toLowerCase() ? `${r.task} · ` : "";
      this.chat.setPlaceholder(`Message ${name}`);
      this.titleEl.replaceChildren(h("span", { class: "avatar-wrap small" }, avatar(r), stateIcon(r)),
        h("div", { class: "text" }, h("div", { class: "task assistant-name" }, name),
          h("div", { class: "meta" }, `${task}${STATUS[stateOf(r)]}${sleepOf(r) ? ` · ${SLEEP[sleepOf(r)]}` : ""}`)));
      return;
    }
    this.titleEl.replaceChildren(stateIcon(r), ...[r.assistant ? avatar(r, "small") : null, sleepMark(r)].filter(Boolean),
      h("div", { class: "text" }, taskText(r.task || "New session", r.task ? "" : "untitled"),
        h("div", { class: "meta" }, `${where(r)} · ${STATUS[stateOf(r)]}${sleepOf(r) ? ` · ${SLEEP[sleepOf(r)]}` : ""}`)));
  }

  renderScreen() {
    const stick = this.chat.atBottom();
    this.screenEl.textContent = this.screen ? this.screen.text : "";
    if (stick) this.chat.toBottom(true);
  }

  // The conversation, Claude's real terminal, or its screen as text; under
  // the last two, the keys the phone's keyboard hasn't.
  setMode(mode) {
    this.mode = mode;
    this.el.classList.toggle("terminal", mode === "terminal");
    if (mode !== "terminal" && this.pane) this.pane.disconnect();
    if (mode === "terminal") {
      // Claude's real terminal (desk.js), as in the wide layout: what you type
      // goes to it, the keys below for what the phone's keyboard hasn't.
      if (!this.pane) this.pane = new TermPane("claude", { size: phoneSize, mic: true });
      this.chat.setView({ content: this.pane.box, above: [this.toolsRow(), this.keysRow], composer: false });
      this.pane.open(this.id).then(() => this.pane.fit());
    } else if (mode === "screen") {
      this.chat.setView({ content: this.screenEl, above: [this.toolsRow(), this.keysRow], composer: true });
      this.renderScreen();
      this.chat.toBottom(true);
    } else {
      this.chat.setView();
    }
  }

  // Over Claude's terminal or its screen: the text bigger or smaller (kept
  // for next time), and in the terminal the mic, held to dictate as you'd
  // hold Claude's key: the words come up in its prompt as it writes them.
  toolsRow() {
    if (!this.toolsEl) {
      const size = (d) => {
        store.set("phone-size", String(Math.max(7, Math.min(24, phoneSize() + d))));
        wearPhoneSize();
        if (this.pane) this.pane.restyle();
      };
      this.talkBtn = h("button", { class: "control talk", "aria-label": "Hold to dictate" }, glyph("mic"), "Hold to talk");
      holdToTalk(this.talkBtn, () => { this.talkBtn.classList.add("on"); talkStart(this.pane); },
                 () => { this.talkBtn.classList.remove("on"); talkStop(this.pane); });
      this.toolsEl = h("div", { class: "keys tools" }, this.talkBtn,
        h("button", { class: "control", "aria-label": "Smaller text", onclick: () => size(-1) }, "A−"),
        h("button", { class: "control", "aria-label": "Bigger text", onclick: () => size(1) }, "A+"));
    }
    this.talkBtn.hidden = this.mode !== "terminal" || !(app.view && app.view.voice);
    return this.toolsEl;
  }

  async press(keys) {
    try {
      await api(`/api/session/${encodeURIComponent(this.id)}/keys`, { keys });
    } catch (e) {
      toast(e.message);
    }
  }

  menu() {
    const row = this.row || { id: this.id };
    const seg = prioritySeg(row);
    const shown = (mode, label) =>
      h("button", { class: `menu-item${this.mode === mode ? " on" : ""}`, onclick: () => { closeSheets(); this.setMode(mode); } },
        label, this.mode === mode ? glyph("check", "val") : null);
    sheet(sheetHead(title(row), where(row)),
      h("div", { class: "section" }, "Priority"), seg,
      h("div", { class: "section" }, "Show"),
      h("div", { class: "menu" }, shown("chat", "Conversation"), shown("terminal", "Claude's terminal"),
        shown("screen", "Claude's screen, as text")),
      h("div", { class: "section" }, "Session"),
      h("button", { class: "control wide", onclick: () => { closeSheets(); pickImageInto({ id: this.id }); } }, "Paste an image into Claude…"),
      engineButton({ ...row, id: this.id }),
      ...sessionActions({ ...row, id: this.id }),
      closeButton({ ...row, id: this.id }));
  }
}

// The text size of Claude's terminal and screen on the phone (A−/A+ there).
function phoneSize() {
  const n = parseFloat(store.get("phone-size") || "");
  return n >= 7 && n <= 24 ? n : 12;
}

function wearPhoneSize() {
  document.documentElement.style.setProperty("--screen-size", `${phoneSize()}px`);
}

// ---- the microphone, while dictating
//
// iOS asks again whether Amarchy may use it once the page has gone a minute
// without it (WebKit's rule; and each time the app starts). So once it's
// allowed it's kept while the app is open: between dictations its track is
// off (nothing is heard, and iOS turns the microphone itself off) and the
// audio stops, and holding the button turns them back on, unasked.
//
// What's kept can die meanwhile, and iOS doesn't say so: a call, Siri or the
// app in the background interrupts the audio (and resuming it may never
// finish), and a track turned back on can stay silent. So it's looked at
// each time: what's interrupted or ended is made anew, what doesn't start is
// given up on rather than waited for, and a microphone that hears nothing
// at all (not a sample but 0) once held is opened afresh, there and then.

const mic = { stream: null, ctx: null, ready: null, source: null, node: null, take: null,
              pieces: 0, loud: 0, watch: null, fresh: false, gen: 0, hears: null };
const MIC_TAIL = 500;     // ms the microphone stays on after you let go: the end of the last word
const MIC_START = 3000;   // ms the phone's audio may take to start
const MIC_DEAD = 1200;    // ms held before the microphone is looked at: dead, it's opened afresh
const MIC_SILENT = 40;    // pieces (20 ms) of nothing but 0 in a row that only a dead microphone gives

// retry: the microphone opened afresh while held (see micWatch), not a new hold.
async function micOpen(retry) {
  const gen = ++mic.gen;
  if (!retry) mic.fresh = false;
  // An AudioContext is made and resumed in the touch itself (iOS starts it
  // only then): nothing awaited before.
  if (mic.ctx && mic.ctx.state !== "running" && mic.ctx.state !== "suspended") micReset();
  if (!mic.ctx) {
    mic.ctx = new AudioContext();
    mic.ready = mic.ctx.audioWorklet ? mic.ctx.audioWorklet.addModule("voice.js") : Promise.resolve();
  }
  const resumed = mic.ctx.resume();
  try {
    await within(Promise.all([mic.ready, resumed]), MIC_START, "the phone's audio didn't start");
  } catch (e) {
    micReset();       // the next hold makes it all anew
    throw e;
  }
  if (gen !== mic.gen) return;
  if (mic.stream && mic.stream.getAudioTracks().some((t) => t.readyState === "live" && !t.muted)) {
    if (mic.node && mic.node.port) mic.node.port.postMessage("reset");
    mic.stream.getTracks().forEach((t) => { t.enabled = true; });
    micWatch();
    return;
  }
  micClose();       // what's left of one that ended (a phone call took it, say)
  const stream = await within(navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
    60000, "the phone didn't answer about the microphone");
  if (gen !== mic.gen || !mic.ctx) {      // another hold took over meanwhile
    stream.getTracks().forEach((t) => t.stop());
    return;
  }
  mic.stream = stream;
  stream.getTracks().forEach((t) => t.addEventListener("ended", () => { if (mic.stream === stream) micClose(); }));
  mic.source = mic.ctx.createMediaStreamSource(stream);
  if (mic.ctx.audioWorklet) {
    mic.node = new AudioWorkletNode(mic.ctx, "amarchy-mic");
    mic.node.port.onmessage = (e) => micHeard(e.data);
  } else {        // an older phone: the same, on the page itself (see voice.js)
    const down = downsampler(mic.ctx.sampleRate, micHeard);
    mic.node = mic.ctx.createScriptProcessor(4096, 1, 1);
    mic.node.onaudioprocess = (e) => down(e.inputBuffer.getChannelData(0));
  }
  const mute = mic.ctx.createGain();    // through to the speaker, silently: some browsers only run what reaches it
  mute.gain.value = 0;
  mic.source.connect(mic.node).connect(mute).connect(mic.ctx.destination);
  micWatch();
}

// A promise, or why not if it takes longer than ms.
function within(promise, ms, why) {
  let timer;
  return Promise.race([promise, new Promise((ok, no) => { timer = setTimeout(() => no(new Error(why)), ms); })])
    .finally(() => clearTimeout(timer));
}

// 20 ms of what the microphone hears, to whoever takes it (a dictation).
function micHeard(pcm) {
  mic.pieces++;
  if (new Int16Array(pcm).some((x) => x !== 0)) {
    mic.loud = mic.pieces;
    // Hearing at last (a phone's microphone takes a moment to come on): say so.
    if (mic.hears && mic.take) {
      const hears = mic.hears;
      mic.hears = null;
      hears();
    }
  }
  if (mic.take) mic.take(pcm);
}

// Held a moment and not a sound (no audio at all, or lately nothing but 0,
// which a real microphone never gives: what came first may be the last
// dictation's end): it's dead, so it's opened afresh, once, the dictation
// going on with the new one.
function micWatch() {
  clearTimeout(mic.watch);
  mic.pieces = mic.loud = 0;
  mic.watch = setTimeout(async () => {
    if (!mic.take || mic.fresh || (mic.pieces && mic.pieces - mic.loud < MIC_SILENT)) return;
    console.warn(`amarchy: the microphone gave ${mic.pieces ? "only silence" : "nothing"}; opening it afresh`);
    mic.fresh = true;
    micReset();
    try {
      await micOpen(true);
    } catch (e) {
      return;     // the server says no sound came
    }
    if (!mic.take) micRelease();      // let go meanwhile
  }, MIC_DEAD);
}

// What voice.js does, for a phone without AudioWorklet: the microphone's
// samples down to 16 kHz 16-bit, each the average of those it stands for,
// handed on 20 ms at a time.
function downsampler(rate, take) {
  const step = rate / 16000;
  let pos = 0, acc = 0, count = 0, out = new Int16Array(320), n = 0;
  return (ch) => {
    for (let i = 0; i < ch.length; i++) {
      acc += ch[i];
      count++;
      if (++pos >= step) {
        pos -= step;
        const v = Math.max(-1, Math.min(1, acc / count));
        out[n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        acc = count = 0;
        if (n === out.length) {
          take(out.buffer);
          out = new Int16Array(320);
          n = 0;
        }
      }
    }
  };
}

// Done dictating: off, but kept for the next time (see above).
function micRelease() {
  mic.take = mic.hears = null;
  clearTimeout(mic.watch);
  if (mic.stream) mic.stream.getTracks().forEach((t) => { t.enabled = false; });
  if (mic.ctx) mic.ctx.suspend().catch(() => {});
}

function micClose() {
  clearTimeout(mic.watch);
  if (mic.stream) mic.stream.getTracks().forEach((t) => t.stop());
  if (mic.source) mic.source.disconnect();
  if (mic.node) mic.node.disconnect();
  mic.stream = mic.source = mic.node = null;
}

// All of it gone, the audio too: the next time makes it anew.
function micReset() {
  micClose();
  if (mic.ctx) mic.ctx.close().catch(() => {});
  mic.ctx = mic.ready = null;
}

// Held down: start(); let go (or the finger slides off): stop().
function holdToTalk(el, start, stop) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    start();
  });
  for (const end of ["pointerup", "pointercancel", "lostpointercapture"]) el.addEventListener(end, () => stop());
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

// ---- the keys in a menu
//
// A sheet, the group & sort menu, Claude's question, the phone's list: ↑/↓
// go from line to line (buttons side by side, as High · Normal · Low, are
// one line, ←/→ go along it), Home/End to the first and the last, ↵ or Space
// picks, Esc closes. One opened with the keys has its cursor on its first
// line (or the one that's on) at once; one opened with a tap or a click,
// once you press an arrow.

const lastInput = { keys: false };
window.addEventListener("keydown", (e) => { if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) lastInput.keys = true; }, true);
window.addEventListener("pointerdown", () => { lastInput.keys = false; }, true);

// What the cursor can be on in a menu (fields too: Tab goes to them).
function menuItems(box, fields) {
  const sel = fields ? "button, [tabindex='0'], textarea, input" : "button, [tabindex='0']";
  // A menu's ✕ is Tab's, not the arrows': they start on what it's for.
  return Array.from(box.querySelectorAll(sel)).filter((el) => !el.disabled && el.getClientRects().length
    && (fields || !el.matches(".sheet-close, .menu-close")));
}

// The line an item is on: its row of buttons side by side, or itself.
function menuLine(box, el) {
  const line = el.closest(".seg, .moves, .row-btns");
  return line && box.contains(line) && line !== box ? line : el;
}

// Where the cursor goes on a line: the button that's on, else its first.
function lineStart(items, line) {
  const on = items.filter((el) => line.contains(el));
  return on.find((el) => el.classList.contains("on")) || on[0];
}

// Where the cursor starts: what's on in a list of choices, else the first line.
function menuStart(box) {
  const items = menuItems(box);
  const on = items.find((el) => el.classList.contains("on") && el.closest(".menu, [role=menu]"));
  return on || (items[0] && lineStart(items, menuLine(box, items[0])));
}

// The keys, for a menu in box. close: what Esc does (none, Esc does
// nothing). trap: Tab stays inside it (a sheet over the page).
function menuKeys(box, { close, trap } = {}) {
  box.addEventListener("keydown", (e) => {
    if ((e.ctrlKey && e.altKey) || e.metaKey || e.defaultPrevented) return;
    const typing = e.target.matches("input, textarea");
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === "Escape") {
      if (typing) { stop(); (menuStart(box) || box).focus(); return; }      // out of the field, into the menu
      if (close) { stop(); close(); }
      return;
    }
    if (e.key === "Tab" && trap) {
      const all = menuItems(box, true);
      if (!all.length) return;
      const at = all.indexOf(document.activeElement);
      const to = at < 0 ? (e.shiftKey ? all.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + all.length) % all.length;
      stop();
      all[to].focus();
      return;
    }
    if (typing || e.altKey || e.ctrlKey) return;
    const items = menuItems(box);
    if (!items.length) return;
    const cur = items.indexOf(document.activeElement);
    const lines = [];
    for (const el of items) { const l = menuLine(box, el); if (!lines.includes(l)) lines.push(l); }
    let to = null;
    if (cur < 0) {      // on the menu itself: the first arrow starts it
      if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home"].includes(e.key)) to = menuStart(box);
      else if (e.key === "End") to = lineStart(items, lines[lines.length - 1]);
    } else {
      const line = menuLine(box, items[cur]);
      const at = lines.indexOf(line);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const next = lines[at + (e.key === "ArrowDown" ? 1 : -1)];
        if (next) to = lineStart(items, next);
        else { stop(); return; }
      } else if (e.key === "Home") to = lineStart(items, lines[0]);
      else if (e.key === "End") to = lineStart(items, lines[lines.length - 1]);
      else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && line !== items[cur]) {
        const along = items.filter((el) => line.contains(el));
        to = along[along.indexOf(items[cur]) + (e.key === "ArrowRight" ? 1 : -1)];
        if (!to) { stop(); return; }
      }
    }
    if (!to) return;
    stop();
    to.focus();
  });
}

// Puts the cursor in a menu just opened: on its first line when you opened
// it with the keys, else on the menu itself, for an arrow to start it.
function menuFocus(box) {
  const start = lastInput.keys && menuStart(box);
  if (start) start.focus();
  else box.focus({ preventScroll: true });
}

// Draws a menu anew with the cursor kept where it was: on the same session,
// or the same words, or else the same place.
function keepFocus(box, fill) {
  const was = menuItems(box, true);
  const at = was.indexOf(document.activeElement);
  const el = was[at];
  fill();
  if (at < 0) return;
  const now = menuItems(box, true);
  const text = (x) => x.getAttribute("aria-label") || x.textContent;
  const to = (el.dataset.id && now.find((x) => x.dataset.id === el.dataset.id))
    || now.find((x) => x.className === el.className && text(x) === text(el))
    || now[Math.min(at, now.length - 1)];
  if (to) to.focus({ preventScroll: true });
  else if (box.tabIndex === -1) box.focus({ preventScroll: true });
}

// ---- sheets
//
// A sheet over the page, with the keys of a menu, and four ways out that
// work on a phone as on a computer: its ✕ (at its top right, kept there as
// it scrolls), a tap on the shade around it, Esc, and (on a phone) a swipe
// down. A sheet opened from another is laid over it: closing it goes back to
// the one under it (closeSheet), what finishes the job closes them all
// (closeSheets). One with the key of one already open (the same sheet drawn
// anew, or gone back to) takes its place, and whatever was over it goes.
//
// On a phone it's a card in from the bottom that leaves a band of the shade
// under the status bar, however tall it is: that band is the shade you tap
// to close it (the status bar's own taps are iOS's).
function sheet(...kids) {
  const opts = kids[0] && !(kids[0] instanceof Node) && typeof kids[0] === "object" ? kids.shift() : {};
  const open = Array.from(document.querySelectorAll(".sheet-back"));
  const same = opts.key ? open.findIndex((s) => s.key === opts.key) : -1;
  const below = same < 0 ? open : open.slice(0, same);
  const under = below[below.length - 1] || null;
  const now = document.activeElement;
  // Back to where the keys were when it's gone: in the sheet under it, what
  // opened it; over the page, a field, or what they'd got to (on a
  // computer, not what a click left them on, as a row you right-clicked).
  const returnTo = same >= 0 ? open[same].returnTo
    : under ? (under.contains(now) ? now : null)
    : now && (now.matches("input, textarea, :focus-visible") || !app.desk) ? now : null;
  for (const s of open.slice(below.length)) s.remove();
  if (under) under.hidden = true;
  const close = h("button", { class: "sheet-close", "aria-label": "Close", title: "Close (Esc)", onclick: () => closeSheet() }, glyph("close"));
  const head = kids[0] && kids[0].classList && kids[0].classList.contains("head") ? kids[0] : h("div", { class: "head" });
  head.append(close);
  const card = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", tabindex: "-1" }, head, ...kids.filter((k) => k !== head));
  const heading = head.querySelector("h2");
  if (heading) card.setAttribute("aria-label", heading.textContent);
  // The shade closes it: a tap that began on it as well as ended there (not
  // the end of the long press that opened it, nor a swipe out of the card).
  let downOnShade = false;
  const back = h("div", { class: `sheet-back${same >= 0 ? " again" : under ? " over" : ""}`,
                          onpointerdown: (e) => { downOnShade = e.target === back; },
                          onclick: (e) => { if (e.target === back && downOnShade) closeSheet(); downOnShade = false; } }, card);
  // A finger moving on the shade moves nothing: not the page under it (in
  // the home-screen app the page is a little taller than the screen), which
  // would swallow the tap as a scroll.
  back.addEventListener("touchmove", (e) => { if (e.target === back) e.preventDefault(); }, { passive: false });
  back.key = opts.key || null;
  back.returnTo = returnTo;
  menuKeys(card, { close: closeSheet, trap: true });
  swipeToClose(back, card);
  document.body.append(back);
  menuFocus(card);
  return back;
}

// A sheet's title, with a small-caps line under it.
function sheetHead(text, meta) {
  return h("div", { class: "head" }, h("h2", {}, text), meta ? h("div", { class: "meta" }, meta) : null);
}

// The sheet on top goes, and the one under it (if any) is back, drawn anew
// (what you changed over it shows), the keys where they were in it.
function closeSheet() {
  const open = Array.from(document.querySelectorAll(".sheet-back"));
  const top = open.pop();
  if (!top) return;
  const had = top.contains(document.activeElement) || document.activeElement === document.body;
  top.remove();
  const under = open.pop();
  if (under) {
    under.hidden = false;
    under.classList.add("again");
    if (under.redraw) under.redraw();
  }
  if (!had) return;
  const to = top.returnTo;
  if (under) {
    if (to && under.contains(to) && (app.desk || lastInput.keys)) to.focus({ preventScroll: true });
    else under.querySelector(".sheet").focus({ preventScroll: true });
    return;
  }
  if (!(app.desk || lastInput.keys)) return;
  if (to && to !== document.body && to.isConnected) to.focus({ preventScroll: true });
  else if (app.desk && typeof desk !== "undefined" && desk.current)
    (desk.focus === "term" && !zenNow() ? desk.term : desk.claude).focus();
}

// Every sheet goes: what you did in them is done.
function closeSheets() {
  while (document.querySelector(".sheet-back")) closeSheet();
}

// On a phone, a sheet follows a finger that pulls it down (from its top, or
// anywhere once it's scrolled to the top), and goes when let go far enough
// down or fast; else it's back in place.
function swipeToClose(back, card) {
  let from = null, dragging = false, dy = 0;
  const skip = ".crop-frame, input, textarea, .seg.wrap, .keys, .theme-grid";
  card.addEventListener("touchstart", (e) => {
    if (app.desk || e.touches.length !== 1 || e.target.closest(skip)) { from = null; return; }
    const t = e.touches[0];
    from = { x: t.clientX, y: t.clientY, at: e.timeStamp, head: !!e.target.closest(".head") };
    dragging = false;
    dy = 0;
  }, { passive: true });
  card.addEventListener("touchmove", (e) => {
    if (!from) return;
    const t = e.touches[0];
    const dx = t.clientX - from.x;
    dy = t.clientY - from.y;
    if (!dragging) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { from = null; return; }      // sideways: not this
      if (dy < 8) { if (dy < -8) from = null; return; }
      if (!from.head && card.scrollTop > 0) { from = null; return; }      // the card scrolls up first
      dragging = true;
      card.classList.add("dragging");
    }
    e.preventDefault();
    card.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  const end = (e) => {
    if (!from || !dragging) { from = null; return; }
    const fast = dy / Math.max(1, e.timeStamp - from.at) > 0.6;
    from = null;
    dragging = false;
    card.classList.remove("dragging");
    if (dy > Math.min(140, card.offsetHeight / 3) || (fast && dy > 30)) {
      card.style.transform = "translateY(100%)";
      back.classList.add("leaving");
      setTimeout(() => { if (back.isConnected && !back.nextElementSibling?.matches(".sheet-back")) closeSheet(); }, 160);
    } else card.style.transform = "";
  };
  card.addEventListener("touchend", end);
  card.addEventListener("touchcancel", end);
}

// The bar under the list, as omalauncher's: the project on its left (tap it
// for another), and what the new session's Claude should do.
function newBar() {
  let repo = store.get("last-project");
  const name = h("span", { class: "name" });
  const pick = h("button", { class: "pick", "aria-label": "Project", onclick: () => pickProject() }, name, glyph("down"));
  const field = h("textarea", { rows: 1, placeholder: "What should Claude do?", enterkeyhint: "enter",
                                oninput: () => { store.set("draft:new", field.value); grow(); buttons(); } });
  field.value = store.get("draft:new") || "";
  const send = h("button", { class: "send", "aria-label": "Start session", onclick: () => start() }, glyph("send"));
  const micBtn = h("button", { class: "mic", "aria-label": "Dictate (hold, or tap and tap again)", hidden: true }, glyph("mic"));
  // What you say, into the box (dictate.js); or, through Claude's voice mode,
  // the session started while you speak (talk, below).
  let saying = null;
  const dictate = new Dictate({ field, button: micBtn,
                                changed: () => { store.set("draft:new", field.value); grow(); buttons(); },
                                state: (text) => { saying = text; buttons(); },
                                claude: { start: () => talk(), stop: () => letGo() } });
  const el = h("div", { class: "prompt new" }, pick, field, micBtn, send);
  const projects = () => (app.view && app.view.projects) || [];
  const grow = () => {
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight + 2, window.innerHeight * 0.4)}px`;
  };
  const buttons = () => {
    const none = !projects().length;
    send.disabled = none || !field.value.trim() || !!said || dictate.on();
    pick.hidden = none;
    micBtn.hidden = none || !dictate.available();
    micBtn.classList.toggle("on", (!!said && said.held) || (dictate.on() && dictate.run.held));
    el.classList.toggle("listening", !!said || saying !== null);
    field.placeholder = none ? (app.view ? "No projects on the host yet" : "Connecting…")
      : said ? (!said.held ? "Starting the session…" : said.hearing ? "Listening…" : "Starting the microphone…")
      : saying !== null ? saying : "What should Claude do?";
  };
  const update = () => {
    const ps = projects();
    if (added && ps.some((p) => p.name === added)) added = null;      // the list has it now
    if (ps.length && !added && !ps.some((p) => p.name === repo)) repo = ps[0].name;
    name.textContent = repo || "";
    buttons();
  };
  const pickProject = () => sheet(sheetHead("Project", "Where the new session starts"),
    h("div", { class: "menu" }, ...projects().map((p) =>
      h("button", { class: `menu-item${p.name === repo ? " on" : ""}`,
                    onclick: () => { repo = p.name; store.set("last-project", repo); closeSheets(); update(); field.focus(); } },
        p.name, p.name === repo ? glyph("check", "val") : null))),
    h("button", { class: "control wide", onclick: () => newProjectSheet(use) }, "New project…"));
  // A project just added: the next session starts there (once the list has it).
  let added = null;
  const use = (project) => {
    repo = added = project;
    store.set("last-project", project);
    update();
    field.focus();
  };
  const start = async () => {
    if (!field.value.trim() || !repo || said) return;
    send.disabled = true;
    el.classList.add("busy");
    try {
      const { id } = await api("/api/new", { repo, prompt: field.value });
      field.value = "";
      store.set("draft:new", "");
      store.set("last-project", repo);
      grow();
      field.blur();
      go(`#/s/${encodeURIComponent(id)}`);
    } catch (e) {
      toast(e.message);
    }
    el.classList.remove("busy");
    buttons();
  };
  // Or hold the mic and say it: the session starts while you speak (once
  // it's clearly held, not just tapped), and when you let go it opens, what
  // you said going to its Claude's dictation as soon as Claude is up. The
  // words come into its box, after what was typed here, to send from there.
  let said = null;
  const talk = async () => {
    if (said || !repo) return;
    const s = said = { held: true, hearing: false, queue: [], id: null, failed: null, making: null };
    mic.hears = () => { s.hearing = true; buttons(); };
    buttons();
    try {
      await micOpen();
    } catch (e) {
      said = null;
      buttons();
      toast(e.name === "NotAllowedError" ? "Amarchy may not use the microphone: allow it in the phone's Settings"
                                        : `The microphone didn't start: ${e.message}`);
      return;
    }
    if (!s.held) {      // let go already (the first time, while the phone asked about the microphone)
      micRelease();
      return;
    }
    mic.take = (pcm) => { if (s.queue.length < 15000) s.queue.push(pcm); };      // 5 minutes, as long as one can be
    s.timer = setTimeout(() => {
      s.making = api("/api/new", { repo }).then((d) => { s.id = d.id; }, (e) => { s.failed = e.message; });
    }, 400);
  };
  const letGo = async () => {
    const s = said;
    if (!s || !s.held) return;
    s.held = false;
    clearTimeout(s.timer);
    buttons();
    await new Promise((ok) => setTimeout(ok, MIC_TAIL));     // the end of the last word
    micRelease();
    if (!s.making) {        // only tapped (or let go while the phone asked about the microphone)
      said = null;
      buttons();
      if (s.queue.length) toast("Hold the mic while you speak");
      return;
    }
    buttons();
    await s.making;
    said = null;
    buttons();
    if (s.failed) return toast(s.failed);
    store.set(`draft:${s.id}`, field.value.trim());
    field.value = "";
    store.set("draft:new", "");
    store.set("last-project", repo);
    grow();
    app.handed = { id: s.id, queue: s.queue };
    go(`#/s/${encodeURIComponent(s.id)}`);
  };
  requestAnimationFrame(grow);
  return { el, update, use };
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
  // Not there when its service worker couldn't start (then it never is).
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((ok) => setTimeout(() => ok(null), 4000))]);
  if (!reg) return "unsupported";
  const sub = await reg.pushManager.getSubscription();
  if (sub) return "on";
  return Notification.permission === "denied" ? "denied" : "off";
}

async function pushOn() {
  const asked = Notification.requestPermission();      // first, while it's still your tap
  if ((await asked) !== "granted") throw new Error("Notifications weren't allowed (Settings → Notifications → Amarchy).");
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

// When a session you're not using sleeps (amarchy sleep --after): its
// Claude Code exits, freeing its memory, and comes back when you send it
// something. Not using it: idle, and open on no phone or browser.
function sleepSettings(draw) {
  const after = app.view ? app.view.sleep_after : 1;
  const choices = [[1, "1m"], [5, "5m"], [15, "15m"], [60, "1h"], ["off", "Never"]];
  if (after !== undefined && !choices.some(([v]) => v === after)) choices.splice(-1, 0, [after, `${after}m`]);
  return [h("div", { class: "section" }, "Sleep"),
    h("div", { class: "seg" }, ...choices.map(([value, label]) =>
      h("button", { class: `control${after === value ? " on" : ""}`, onclick: async () => {
        try { await api("/api/sleep", { after: value }); app.view.sleep_after = value; draw(); }
        catch (err) { toast(err.message); }
      } }, label))),
    h("p", {}, after === "off" ? "Sessions stay awake until you put one to sleep (its menu)."
      : `A session idle for ${after === 1 ? "a minute" : `${after} minutes`} and open nowhere sleeps: its Claude Code exits and frees its memory, the conversation stays, and what you send it wakes it. Never while it works, asks you something or runs something in the background.`),
    h("button", { class: "control wide", onclick: async (e) => {
      e.currentTarget.disabled = true;
      try {
        const r = await api("/api/sleep", { all: true });
        toast(`${r.slept} asleep${r.kept ? `, ${r.kept} kept awake (busy)` : ""}`);
      } catch (err) { toast(err.message); }
      draw();
    } }, "Put idle sessions to sleep now")];
}

async function openSettings() {
  const open = document.querySelector(".sheet-back.settings");
  if (open) return open.redraw();      // changed from inside it: drawn again where it is, the keys where they were
  const body = h("div", {});
  // Drawn at once, the notifications' part once it's known whether they're on.
  const draw = async (known) => {
    const state = known || await pushState().catch(() => "unsupported");
    const kids = [h("div", { class: "section" }, "Notifications")];
    if (state === "checking") {
      kids.push(h("p", {}, "…"));
    } else if (!standalone && !app.desk) {
      kids.push(h("p", {}, "To get notifications, add Amarchy to your Home Screen: tap Share, then “Add to Home Screen”, and open it from there."));
    } else if (state === "unsupported") {
      kids.push(h("p", {}, app.desk ? "This browser can't get notifications (in Safari, add Amarchy to the Dock first: File → Add to Dock)."
                                    : "This browser can't get notifications (on iPhone they need iOS 16.4 or newer)."));
    } else if (state === "denied") {
      kids.push(h("p", {}, app.desk ? "Notifications are turned off for Amarchy in this browser's settings (and System Settings → Notifications)."
                                    : "Notifications are turned off for Amarchy in the phone's Settings → Notifications."));
    } else if (state === "off") {
      kids.push(h("p", {}, "Get a notification when a session needs you or is done."),
        h("button", { class: "control wide accent", onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { await pushOn(); toast("Notifications on."); } catch (err) { toast(err.message); }
          draw();
        } }, "Turn on notifications"));
    } else {
      kids.push(h("p", {}, "On: you're told when a session needs you or is done, unless you're looking at it."),
        h("button", { class: "control wide", onclick: async () => {
          try { const r = await api("/api/push/test"); toast(r.sent ? "Sent. It should arrive in a moment." : "It couldn't be sent."); }
          catch (err) { toast(err.message); }
        } }, "Send a test"),
        h("button", { class: "control wide", onclick: async () => { await pushOff(); draw(); } }, "Turn off"));
    }
    // What the sessions tell you about (amarchy alerts), on every phone and browser.
    const alerts = (app.view && app.view.alerts) || "needs-you";
    const name = ((app.view && app.view.sessions.find((x) => x.assistant === "main")) || {}).assistant_name;
    kids.push(h("div", { class: "section" }, "Tell me"),
      h("div", { class: "seg" }, ...[["all", "All"], ["needs-you", "Needs me"], ["assistant", `${name || "Assistant"} only`]]
        .map(([value, label]) => h("button", { class: `control${alerts === value ? " on" : ""}`, onclick: async () => {
          try { await api("/api/alerts", { alerts: value }); app.view.alerts = value; draw(); }
          catch (err) { toast(err.message); }
        } }, label))),
      h("p", {}, alerts === "all" ? "Every session, when it needs you and when it's done."
               : alerts === "needs-you" ? "A session that asks you something, or needs your permission. One that's done is just marked done in the list."
               : "Nothing from the coding sessions; their list still says how they are."),
      h("p", {}, name ? `${name}, your assistant, always tells you: under its own name and picture, with its own chime.`
                      : "Your assistant, once you have one (amarchy assistant <id>), always tells you."));
    // The chimes, your assistant and your projects (manage.js), as amarchy sound,
    // assistant and add set them on the host.
    const helper = (app.view && app.view.sessions.find((x) => x.assistant === "main")) || null;
    const label = (n) => (n === "off" ? "off" : n ? n.charAt(0).toUpperCase() + n.slice(1) : "");
    kids.push(h("div", { class: "section" }, "Sound"),
      h("button", { class: "control wide", onclick: () => soundSheet(false) },
        `Chime: ${label(app.view && app.view.sound)}${helper ? ` · ${helper.assistant_name || "Assistant"}'s: ${label(app.view.assistant_sound)}` : ""}`),
      h("p", {}, app.desk ? "Rings in this browser when a session needs you or is done, unless you're looking at it."
                          : "Rings in a computer's browser; the phone's notifications ring with its own sound."),
      h("div", { class: "section" }, "Assistant"),
      helper ? h("button", { class: "control wide", onclick: () => assistantSheet(helper) }, `${helper.assistant_name || "Assistant"}: name, picture, chime…`)
             : h("p", {}, "None yet: open a session's menu (⋯, or hold it in the list) and make it your assistant."),
      h("div", { class: "section" }, "Projects"),
      h("button", { class: "control wide", onclick: () => newProjectSheet((p) => { if (app.newBar) app.newBar.use(p); }) }, "New project…"),
      h("button", { class: "control wide", onclick: () => orderProjects() }, "Order projects…"));
    kids.push(...sleepSettings(draw));
    kids.push(...dictationSettings(draw));
    const look = (app.view && app.view.look) || {};
    kids.push(h("div", { class: "section" }, "Look"),
      h("p", {}, `${look.name || "Tokyo Night"}, on every phone and browser of yours.`),
      h("button", { class: "control wide", onclick: () => openLook() }, "Theme, font, wallpaper…"),
      h("div", { class: "section" }, "Host"),
      h("p", {}, `${(app.view && app.view.hostname) || location.hostname}, as ${app.user || "you"}. ` +
                 "Reachable only on your tailnet."));
    kids.push(...linkSettings());
    if (app.desk) kids.push(...deskSettings());
    else if (store.get("layout")) kids.push(...layoutSettings());
    keepFocus(body.parentNode || body, () => body.replaceChildren(...kids));
  };
  const back = sheet(sheetHead("Settings", app.desk ? "Amarchy in this browser" : "Amarchy on your phone"), body);
  back.classList.add("settings");
  back.redraw = () => draw();
  draw("checking");
  if (body.parentNode === document.activeElement) menuFocus(body.parentNode);      // opened with the keys: now there's a first line
  draw();
}

// ---- the look
//
// The theme (amarchy's: Omarchy's palettes), the font and the wallpaper
// (Omarchy's own for the theme, which the host fetches from Omarchy's
// repository: one drawn for it until then), picked here for every phone and
// browser of yours: they're kept on the host (amarchy theme there does the
// same).

async function openLook() {
  const body = h("div", {}, h("p", {}, "…"));
  const back = sheet(sheetHead("Look", "On every phone and browser of yours"), body);
  back.classList.add("look");
  let info, polling = null;
  // While the host fetches Omarchy's wallpapers: how far, every moment, and
  // each one as it comes (the one worn too).
  const poll = () => {
    clearTimeout(polling);
    if (!info.fetch || !info.fetch.running) return;
    polling = setTimeout(async () => {
      if (!back.isConnected) return;
      try {
        const res = await fetch("/api/look");
        if (!res.ok) throw new Error();
        const was = info.look && info.look.look;
        info = await res.json();
        if (info.look && info.look.look !== was) wearIt();
      } catch (err) { /* the next one, then */ }
      if (back.isConnected) draw();
    }, 1500);
  };
  const pick = async (change, el) => {
    if (el) el.classList.add("busy");
    try {
      info = await api("/api/look", change);
      wearIt();
    } catch (err) { toast(err.message); }
    if (el) el.classList.remove("busy");
    draw();
  };
  // Worn here at once; every other device takes it from the list in a moment.
  const wearIt = () => {
    if (app.view) app.view.look = info.look;
    app.nerd = !!info.nerd;
    wearLook(info.look);
    refresh();
  };
  const draw = () => {
    const card = (t) => {
      const el = h("button", { class: `theme-card${t.key === info.theme ? " on" : ""}`, "aria-label": t.name,
                               "aria-pressed": t.key === info.theme ? "true" : "false",
                               onclick: (e) => { if (t.key !== info.theme) pick({ theme: t.key }, e.currentTarget); } },
        h("span", { class: "thumb" }),
        h("span", { class: "dots" }, ...t.colors.slice(2).map((c) => {
          const d = h("i", {});
          d.style.setProperty("--dot", c);
          return d;
        })),
        h("span", { class: "name" }, t.name));
      el.style.setProperty("--card-bg", t.colors[0]);
      el.style.setProperty("--card-fg", t.colors[1]);
      if (t.wallpaper) el.style.setProperty("--thumb", `url("${t.wallpaper}")`);
      return el;
    };
    const fonts = info.fonts.map((f) => h("button", { class: `control${f.key === info.font ? " on" : ""}`,
      onclick: (e) => pick({ font: f.key }, e.currentTarget) }, f.name));
    // The wallpapers: Omarchy's for the theme worn (a theme of yours, its
    // own), your own picture, none. Each a little picture of itself.
    const worn = info.themes.find((t) => t.key === info.theme) || { colors: [], backgrounds: [] };
    const tile = (label, on, thumb, act, note) => {
      const el = h("button", { class: `theme-card wall-card${on ? " on" : ""}${note ? " pending" : ""}`,
                               "aria-pressed": on ? "true" : "false", "aria-label": note ? `${label}, ${note}` : label,
                               onclick: (e) => { if (!on) act(e.currentTarget); } },
        h("span", { class: "thumb" }, note ? h("small", {}, note) : null),
        h("span", { class: "name" }, label));
      el.style.setProperty("--card-bg", worn.colors[0] || "var(--surface)");
      el.style.setProperty("--card-fg", worn.colors[1] || "var(--text)");
      if (thumb) el.style.setProperty("--thumb", `url("${thumb}")`);
      return el;
    };
    const notes = { fetching: "Downloading…", waiting: "Waiting to download", failed: "Not downloaded", missing: "Not downloaded" };
    const walls = (worn.backgrounds || []).length
      ? worn.backgrounds.map((b) => tile(b.name, info.wallpaper === "theme" && b.key === worn.background,
          b.thumb || worn.drawn, (el) => pick({ background: b.key }, el), b.state === "here" ? "" : notes[b.state]))
      : [tile("The theme's", info.wallpaper === "theme", worn.wallpaper, (el) => pick({ wallpaper: "theme" }, el))];
    walls.push(tile("Your own", info.wallpaper === "own", info.own,
                    (el) => (info.own ? pick({ wallpaper: "own" }, el) : file.click()), info.own ? "" : "Choose a picture"),
               tile("None", info.wallpaper === "none", "", (el) => pick({ wallpaper: "none" }, el)));
    // How far the host is with Omarchy's wallpapers, when they aren't all there.
    const f = info.fetch || {};
    const mb = (n) => Math.round((n || 0) / 1e6);
    let fetching = null;
    if (f.total && f.running) {
      const bar = h("span", { class: "wall-bar" }, h("i", {}));
      bar.firstChild.style.width = `${Math.round(100 * (f.got || 0) / (f.size || 1))}%`;
      fetching = h("div", { class: "wall-fetch", role: "status" },
        h("p", {}, `Downloading Omarchy's wallpapers to your host: ${f.have} of ${f.total} (${mb(f.got)} of ${mb(f.size)} MB). ` +
                   "A wallpaper drawn for the theme stands in until each one is there."), bar);
    } else if (f.total && f.have < f.total) {
      const why = f.error || f.why;
      fetching = h("div", { class: "wall-fetch" },
        h("p", {}, `${f.total - f.have} of Omarchy's ${f.total} wallpapers aren't on your host` +
                   (why ? ` (${why})` : "") + ": those show one drawn for the theme instead."),
        h("button", { class: "control wide", onclick: async (e) => {
          e.currentTarget.classList.add("busy");
          try { info = await api("/api/look/fetch", {}); } catch (err) { toast(err.message); }
          draw();
        } }, "Download them again"));
    }
    const file = h("input", { type: "file", accept: "image/*", hidden: true, onchange: async () => {
      const f = file.files[0];
      if (!f) return;
      toast("Cutting it to size…");
      try {
        const [phone, wide] = await Promise.all([cutPicture(f, false), cutPicture(f, true)]);
        info = await api("/api/look/wallpaper", { phone, wide });
        wearIt();
        toast("Your wallpaper is on.");
      } catch (err) { toast(err.message); }
      draw();
    } });
    keepFocus(back.firstChild, () => body.replaceChildren(...[
      h("div", { class: "section" }, "Theme"),
      themeGrid(info.themes.map(card)),
      h("div", { class: "section" }, "Font"),
      h("div", { class: "seg wrap" }, ...fonts),
      h("div", { class: "section" }, "Wallpaper"),
      wallGrid(walls),
      fetching,
      h("p", {}, (worn.backgrounds || []).length
        ? `${worn.name}'s are Omarchy's own, downloaded to your host from Omarchy's repository. Your own: ` +
          (info.own ? "the picture you chose." : "choose a picture.")
        : info.own ? "Your own: the picture you chose." : "Choose a picture to have one of your own."),
      h("button", { class: "control wide", onclick: () => file.click() }, info.own ? "Choose another picture…" : "Choose a picture…"),
      file].filter(Boolean)));
    poll();
  };
  try {
    const res = await fetch("/api/look");
    info = await res.json();
    if (!res.ok) throw new Error(info.error || `It didn't work (${res.status})`);
  } catch (err) {
    body.replaceChildren(h("p", {}, err.message));
    return;
  }
  draw();
  if (back.firstChild === document.activeElement) menuFocus(back.firstChild);
}

// The wallpapers in rows, smaller than the themes.
function wallGrid(tiles) {
  const grid = themeGrid(tiles);
  grid.classList.add("wall-grid");
  return grid;
}

// The themes in rows: the arrows go along them, and up and down a row.
function themeGrid(cards) {
  const grid = h("div", { class: "theme-grid row-btns" }, ...cards);
  grid.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const at = cards.indexOf(document.activeElement);
    if (at < 0) return;
    const cols = cards.filter((c) => c.offsetTop === cards[0].offsetTop).length;
    const to = cards[at + (e.key === "ArrowDown" ? cols : -cols)];
    if (!to) return;            // off the grid: the menu's own keys take it to the line above or below
    e.preventDefault();
    to.focus();
    to.scrollIntoView({ block: "nearest" });
  });
  return grid;
}

// A picture of yours cut as the app shows a wallpaper (as the host would):
// a phone's screen, the middle of it; or a computer's, the whole of it at
// most a laptop's screen in size. A JPEG, in base64.
async function cutPicture(file, wide) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => no(new Error("That picture can't be read here."));
      i.src = url;
    });
    const [w, h0] = [img.naturalWidth, img.naturalHeight];
    let cw, ch, sx = 0, sy = 0, sw = w, sh = h0;
    if (wide) {
      const k = Math.min(1, 2880 / w, 1800 / h0);
      [cw, ch] = [Math.round(w * k), Math.round(h0 * k)];
    } else {
      [cw, ch] = [1290, 2796];
      const k = Math.max(cw / w, ch / h0);
      [sw, sh] = [cw / k, ch / k];
      [sx, sy] = [(w - sw) / 2, (h0 - sh) / 2];
    }
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = [cw, ch];
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
    const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
    if (!blob) throw new Error("That picture can't be read here.");
    const data = await new Promise((ok) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(",")[1] || "");
      r.readAsDataURL(blob);
    });
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---- going between views
//
// In a Safari tab the view is in the address (#/s/<id>), so the browser's
// back goes back. On the home screen there's no address bar, and there iOS
// forgets that the microphone was allowed whenever the address changes
// (WebKit bug 215884): the address stays as the app opened, the view goes
// where it's told.

const routed = { hash: location.hash };

function go(hash) {
  if (!standalone) {
    location.hash = hash;
    return;
  }
  routed.hash = hash;
  route();
}

function here() { return standalone ? routed.hash : location.hash; }

function route() {
  if (app.desk) return deskRoute();
  closeSheets();
  const m = here().match(/^#\/s\/(.+)$/);
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
  if (app.desk) return;       // a computer's: its terminals stay as they are
  if (document.visibilityState === "hidden") {
    closeList();
    if (app.session) app.session.close();
  } else {
    openList();
    if (app.session) app.session.reopen();
  }
});

// On a computer's wide screen, the wide layout (desk.js): the list, Claude's
// terminal and the session's beside it; on a phone, the list and the
// conversation. The settings can say which.
function wantsDesk() {
  const layout = store.get("layout");
  if (layout) return layout === "wide" || layout === "desktop";      // desktop: what it was called before
  return window.matchMedia("(min-width: 1000px) and (hover: hover) and (pointer: fine)").matches;
}

async function start() {
  app.desk = wantsDesk();
  wearPhoneSize();
  fitViewport();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.go) go(new URL(e.data.go, location.href).hash || "#/");
    });
  }
  try {
    const res = await fetch("/api/state");
    const d = await res.json();
    if (!res.ok) throw new Error(d.error === "not yours"
      ? "This Amarchy belongs to someone else on the tailnet."
      : d.error || "Amarchy didn't answer.");
    app.key = d.key;
    app.user = d.user;
    app.nerd = !!d.nerd;
    if (d.sessions) app.view = d;
  } catch (e) {
    app.failed = e.message.includes("Amarchy") ? e.message
      : "Can't reach Amarchy. Is Tailscale on, on this phone?";
  }
  window.addEventListener("hashchange", () => {
    routed.hash = location.hash;
    route();
  });
  if (app.desk) deskStart();
  else route();
  openList();
  if (app.key) pushRefresh();
}

start();
