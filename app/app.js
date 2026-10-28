// amarchy on your phone: the sessions of the host it's served from (`amarchy
// app`), each one's conversation, what you send it, and its questions as
// buttons. No libraries, no build: the server sends these files as they are.
"use strict";

const root = document.getElementById("root");
const app = { view: null, key: "", user: "", online: true, list: null, session: null, failed: "", nerd: false,
              query: "", organize: null, tab: "today" };     // tab: the phone's home, Today or Chats (today.js)
// running: its turn ended, but something it started still runs (a test run,
// a helper): Claude goes on when that ends (bin/amarchy session_view).
const STATUS = { waiting: "Needs your answer", working: "Working", running: "Running", done: "Done", idle: "Ready", asleep: "Asleep" };
const PRIORITY = { high: "High", normal: "Normal", low: "Low" };
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// The glyphs of amarchy's list (Nerd Font icons), when the
// look's font has them; else the drawings below and plain marks.
const NERD = {
  waiting: "\u{F009E}", idle: "\u{F012C}", done: "\u{F05E0}", asleep: "\u{F04B2}", high: "\u{F023B}", low: "\u{F0045}",
  back: "\u{F0141}", plus: "\u{F0415}", more: "\u{F01D8}", gear: "\u{F0493}", send: "\u{F005D}",
  stop: "\u{F04DB}", check: "\u{F012C}", down: "\u{F0140}", search: "\u{F0349}", close: "\u{F0156}",
  organize: "\u{F04BC}", mic: "\u{F036C}", project: "\u{F024B}", status: "\u{F0279}", newest: "\u{F1548}", oldest: "\u{F1547}",
  up: "\u{F005D}", under: "\u{F0045}", order: "\u{F04BA}", image: "\u{F02E9}", clock: "\u{F0150}", next: "\u{F0142}",
};
const PLAIN = { waiting: "●", idle: "✓", done: "✔", asleep: "☾", high: "▲", low: "▼", check: "✓", close: "✕",
                project: "▤", status: "●", newest: "↓", oldest: "↑", up: "▲", under: "▼", order: "⇅", clock: "◷", next: "›" };
const ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>',
  organize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 6h16M4 12h10M4 18h6"/></svg>',
  keys: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14.5h8"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
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

// A project as a person reads it: "houston-os" is "Houston Os". The repo's own
// name stays what the CLI, paths, branches and the server use.
function projectName(repo) {
  return String(repo || "").split(/[-_]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
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
  if (st === "working" || st === "running") return h("span", { class: `state working${st === "running" ? " running" : ""}`, title: STATUS[st] }, SPINNER[spin.frame]);
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
// One stylesheet link, whose href moves to the new look: the browser wears
// the old look until the new theme.css has loaded (no unstyled flash), and a
// quick run of picks can't leave an older sheet in the page to win.
function wearLook(look) {
  const link = document.getElementById("look");
  const stamp = look ? `${look.look || ""}${look.font || ""}` : "";
  if (!link || !stamp) return paintBars();
  if (!link.dataset.stamp) link.dataset.stamp = stamp;     // the page came with this one
  else if (link.dataset.stamp !== stamp) {
    const v = `${(look.look || "").slice(0, 12)}${(look.font || "").slice(0, 12)}`;
    link.dataset.stamp = stamp;
    if (!link.dataset.loads) {
      link.dataset.loads = "1";
      link.addEventListener("load", lookLoaded);
      // A look that didn't come (the network blipped): asked for again, a moment on.
      link.addEventListener("error", () => setTimeout(() => link.setAttribute("href", link.dataset.want), 2000));
    }
    link.dataset.want = `theme.css?v=${v}`;
    link.setAttribute("href", link.dataset.want);
  }
  paintBars();
}

// The new look's sheet is in: the status bar, and the terminals (which
// measure the font, so it's loaded before they do, or a moment's wait).
async function lookLoaded() {
  paintBars();
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font").trim();
  if (family && document.fonts) await Promise.race([
    Promise.all([document.fonts.load(`16px ${family}`), document.fonts.load(`bold 16px ${family}`)]).catch(() => {}),
    new Promise((ok) => setTimeout(ok, 3000))]);
  restyleTerminals();
}

// The real terminals wear it too (desk.js's, the phone's).
function restyleTerminals() {
  if (app.desk) deskRestyle();
  if (app.session && app.session.pane) app.session.pane.restyle();
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

function where(s) { return `${projectName(s.repo)} · ${s.name || s.branch}`; }
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

// A session's state in words, as the list and the chat's header say it,
// and its tone (the color of those words): asleep is quiet, whatever it did last.
function statusTone(s) {
  return s.setup || sleepOf(s) ? "quiet" : doneOf(s);
}

function statusWords(s) {
  if (s.setup) return "Setting up…";
  const sl = sleepOf(s);
  if (sl) return SLEEP[sl];
  return STATUS[doneOf(s)] || "";
}

// The list's: what it's doing too, while it works ("Working · reading app.js"),
// or what runs while it waits on that ("Running · the e2e tests").
function statusLine(s) {
  const words = statusWords(s);
  if (statusTone(s) === "running") return s.running ? `${words} · ${s.running}` : words;
  const d = s.doing;
  if (statusTone(s) !== "working" || !d || !d.tool || typeof stepWords !== "function" || HIDDEN_TOOLS.has(d.tool)) return words;
  const now = stepWords(d.tool, d.input || {}).now;
  return `${words} · ${now.charAt(0).toLowerCase()}${now.slice(1)}`;
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

// ---- updates: amarchy was updated on the host, and this page loads the new one
// by itself, at a moment that loses nothing. Until then it waits and tries
// again; it never asks.

const KEPT = "amarchy-kept";        // the page's own state, across the reload (sessionStorage)
const KEPT_FOR = 30000;             // ms it's taken back for, at most
const RELOAD_WAIT = 1500;           // ms between the looks while a reload waits
const NOT_WORDS = ["checkbox", "radio", "hidden", "range", "file", "button", "submit", "reset", "color", "search"];
let kept = null;                    // what the page held before its reload, taken once

function updated() {
  if (app.updating) return;
  app.updating = true;
  // The new service worker first, so the new page is served by it (sw.js).
  if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update()).catch(() => {});
  loadWhenSafe();
}

function loadWhenSafe() {
  if (reloadWait()) return setTimeout(loadWhenSafe, RELOAD_WAIT);
  keepForReload();
  location.reload();
}

// Waits while a dictation is under way, a picture or a file is on its way to a
// message, a card has an answer begun, or a box holds words not sent. The
// composer's and the new chat's words are no reason: they're kept as drafts
// (chat.js, newChat) and come back with the page.
function reloadWait() {
  if (dictationUnderWay()) return true;
  if ([app.session && app.session.chat, desk.chat].some((c) => c && c.tray.length)) return true;
  if ([app.newChat, desk.newChat].some((n) => n && n.tray().length)) return true;      // pictures for a new chat
  if (document.querySelector(".card .chosen, .card .opt.on, .card .q-tab.done")) return true;     // an answer picked, not sent
  return [...document.querySelectorAll("textarea, input")].some((f) =>
    !NOT_WORDS.includes(f.type) && f.value.trim() && !f.closest(".composer-wrap, .start-chat"));
}

// What only this page holds, for the new one to take back: the view (on a
// phone the address stays as it opened, so the view is kept as here() says),
// the scrolls, the search. The drafts are in the store already.
function keepForReload() {
  const chat = (app.session && app.session.chat) || desk.chat;
  const list = app.desk ? board.scroll : app.listEl && app.listEl.scroll;
  const search = app.desk ? board.search : app.listEl && app.listEl.search;
  try {
    sessionStorage.setItem(KEPT, JSON.stringify({
      at: Date.now(), hash: here(),
      list: list ? list.scrollTop : null,
      chat: chat ? { id: chat.id, top: chat.scroller.scrollTop } : null,
      search: search ? search.value : "",
    }));
  } catch (e) { /* no session storage: the page loads as it is */ }
}

function takeKept() {
  try {
    const d = JSON.parse(sessionStorage.getItem(KEPT) || "null");
    sessionStorage.removeItem(KEPT);
    if (d && Date.now() - d.at < KEPT_FOR) kept = d;
  } catch (e) { /* none */ }
  if (kept && kept.search) app.query = kept.search;      // the list's search, whether or not the list is on screen
}

// The list's scroll, once the list is on screen.
function keptListScroll() {
  if (!kept || kept.list === null) return;
  const el = app.desk ? board.box && board.scroll : (!app.session && app.listEl && app.listEl.scroll);
  if (!el || !el.childElementCount) return;
  el.scrollTop = kept.list;
  kept.list = null;
}

// The chat's scroll, once its conversation is drawn (chat.js conversation).
function keptChatScroll(id) {
  if (!kept || !kept.chat || kept.chat.id !== id) return null;
  const top = kept.chat.top;
  kept.chat = null;
  return top;
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
    app.build = app.build || app.view.build;     // the page's own: index.html's (start)
    wearLook(app.view.look);
    badge();
    refresh();
    shareCheck();
  });
  es.addEventListener("open", () => { if (!app.online) { app.online = true; refresh(); } });
  es.addEventListener("error", () => {
    app.online = false;
    refresh();
  });
}

// The list changed: on a wide screen the wide layout (desk.js), else the list's view.
function refresh() {
  if (app.desk) { deskList(); boardRefresh(); }      // Tasks (tasks.js)
  else if (!app.session) renderList();
  keptListScroll();
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
    // A new chat, one tap away: its box comes up over Today (which keeps the room otherwise).
    h("button", { class: "icon-btn new-btn", "aria-label": "New chat", title: "New chat", onclick: () => composeNew() }, glyph("plus")),
    automationsButton(), h("button", { class: "icon-btn", "aria-label": "Settings", onclick: openSettings }, glyph("gear")));      // automations.js
  // Above the list, as in the wide layout beside Claude: the search, and how
  // the list is grouped and sorted.
  const search = h("input", { type: "search", placeholder: "Search chats", enterkeyhint: "search",
                              autocomplete: "off", autocorrect: "off", autocapitalize: "off", spellcheck: "false",
                              oninput: () => { app.query = search.value; renderList(); },
                              onkeydown: (e) => {
                                if (e.key === "Enter") search.blur();
                                else if (e.key === "ArrowDown") { e.preventDefault(); const first = menuItems(list)[0]; if (first) first.focus(); }
                              } });
  if (app.query) search.value = app.query;
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
  // Today (what to do now: today.js) or Chats (all of them), Today first: it's home.
  const tab = (key, label) => h("button", { class: "tab", type: "button", role: "tab", "data-tab": key,
                                             onclick: () => { app.tab = key; renderList(); view.scroll.scrollTop = 0; } }, label);
  const tabs = h("div", { class: "home-tabs", role: "tablist" }, tab("today", "Today"), tab("chats", "Chats"));
  const today = h("div", { class: "today phone-today" });      // its count line is the header's
  const list = h("div", { class: "list" });
  menuKeys(list);       // ↑/↓ from session to session, ↵ opens one
  list.addEventListener("keydown", (e) => {     // ↑ from the first: back to the search
    if (e.key === "ArrowUp" && !e.defaultPrevented && menuItems(list)[0] === document.activeElement && !toolbar.hidden) {
      e.preventDefault();
      search.focus();
    }
  }, true);
  const scroll = h("div", { class: "scroll" }, today, list);
  app.newChat = newChat();
  const dock = h("div", { class: "dock" }, app.newChat.el);
  // On Today the new chat's box shows only while you're starting one: left
  // empty, it goes again.
  dock.addEventListener("focusout", () => setTimeout(() => {
    if (app.composing && !dock.contains(document.activeElement) && !app.newChat.field.value.trim() && !document.querySelector(".sheet-back, .picker-back")) {
      app.composing = false;
      renderList();
    }
  }, 250));
  const view = app.listEl = h("div", { class: "view list-view" }, head, tabs, shade, toolbar, offline, scroll, dock);
  Object.assign(app.listEl, { meta, offline, list, scroll, search, toolbar, clear, organize, menu, shade, dock, tabs, today });
  return app.listEl;
}

function renderList() {
  const view = listView();
  if (!root.contains(view)) {
    root.replaceChildren(view);
    view.scroll.scrollTop = 0;
  }
  const v = app.view;
  const first = !!v && !v.sessions.length && !(v.projects && v.projects.length);      // a new user: the welcome
  view.meta.replaceChildren();
  // Today, unless there's nothing yet (the welcome) or you're searching.
  const onToday = app.tab === "today" && !!v && !!v.sessions.length && !app.query;
  // Under the name, one count: Today's (what's your move, what's to close), or the chats'.
  if (onToday) view.meta.append(h("span", { class: todayCount(v) ? "waiting" : "" }, todaySummary(v)));
  else if (v && v.sessions.length) {
    const waiting = typeof v.needs === "number" ? v.needs : v.sessions.filter((s) => s.status === "waiting").length;
    view.meta.append(`${v.sessions.length} chat${v.sessions.length === 1 ? "" : "s"}`);
    if (waiting) view.meta.append(" · ", h("span", { class: "waiting" }, `${waiting} need${waiting === 1 ? "s" : ""} you`));
  }
  view.offline.hidden = app.online || !v;
  view.tabs.hidden = !v || !v.sessions.length;
  for (const b of view.tabs.children) {
    const on = (b.dataset.tab === "today") === onToday;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
    if (b.dataset.tab === "today") {
      const n = todayCount(v);
      b.replaceChildren("Today", n ? h("span", { class: "tab-count" }, String(n)) : "");
    }
  }
  view.today.hidden = !onToday;
  view.list.hidden = onToday;
  if (onToday) todayFill(view.today);      // only when what it shows changed: its scroll stays (today.js)
  view.toolbar.hidden = !v || !v.sessions.length || onToday;
  view.dock.hidden = first || (onToday && !app.composing && !(app.newChat && app.newChat.field.value.trim()));
  view.clear.hidden = !app.query;
  if (view.toolbar.hidden) view.menu.hidden = true;
  view.shade.hidden = view.menu.hidden;
  view.organize.classList.toggle("on", !view.menu.hidden);
  if (!view.menu.hidden) keepFocus(view.menu, () => view.menu.replaceChildren(...organizeMenu()));
  const list = view.list;
  const top = view.scroll.scrollTop;      // a session going or coming: the list stays where it is
  keepFocus(list, () => {
    list.replaceChildren();
    const shown = v ? matching(v.sessions, app.query) : [];
    if (!v) {
      list.append(h("div", { class: "empty" }, app.failed || "Connecting…"));
    } else if (first) {
      list.append(welcome((p) => app.newChat.use(p)));
    } else if (!v.sessions.length) {
      list.append(noChats());
    } else if (!shown.length) {
      list.append(h("div", { class: "empty" }, `No chat matches “${app.query.trim()}”`, h("br"),
        h("button", { class: "control", onclick: () => { app.listEl.querySelector(".clear").click(); } }, "Show them all")));
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
  view.scroll.scrollTop = top;
  app.newChat.update();
}

// The + over the list: the new chat's box, its keyboard up.
function composeNew() {
  app.composing = true;
  if (app.session) go("#/");
  renderList();
  if (app.newChat) app.newChat.focus();     // now, in the tap: iOS brings the keyboard up only then
}

// A new user's first screen, with no projects yet: what Amarchy is, in a
// sentence or two, and the two ways to start: a project of theirs from
// GitHub, or an empty one for something new. added(name): the project
// they added, for the new chat to start in.
function welcome(added) {
  const add = (how) => (app.desk ? (how === "github" ? newProject() : emptyProject("")) : newProjectSheet(added, how));
  return h("div", { class: "welcome" },
    h("div", { class: "welcome-mark", "aria-hidden": "true" }, "Ⓐ"),
    h("h2", {}, "Welcome to Amarchy"),
    h("p", {}, "Tell Claude what you want, and it does the work on your projects: reads them, writes the code, runs it, and asks you whenever it needs you."),
    h("p", { class: "muted" }, "Claude works in a project: a folder of your work. Add one of your GitHub repos, or start an empty folder for something new."),
    h("div", { class: "welcome-actions" },
      h("button", { class: "cta", onclick: () => add("github") }, "Add a project from GitHub"),
      h("button", { class: "cta", onclick: () => add("empty") }, "Start an empty project")));
}

// Projects, but no chat yet: the new chat is the way to start one.
function noChats() {
  return h("div", { class: "empty no-chats" },
    h("div", { class: "big" }, "No chats yet"),
    h("div", {}, app.desk ? "Say what you want to do, and Claude starts on it." : "Say what you want to do below, and Claude starts on it."));
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
    h("span", { class: "name" }, projectName(repo)),
    h("span", { class: "moves" }, arrow("up", `Move ${projectName(repo)} up`, "before", above),
      arrow("under", `Move ${projectName(repo)} down`, "after", below)));
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
    h("span", { class: "label" }, glyph("project", "icon"), h("span", { class: "text" }, projectName(name)),
      count[name] ? h("small", {}, String(count[name])) : null),
    h("span", { class: "moves" },
      holdable(h("button", { class: "control move", "aria-label": `Move ${projectName(name)} up (hold, or Shift+Enter: to the top)`, disabled: i === 0,
                             "data-name": name, "data-dir": "up", onclick: () => move(name, "up") },
                 glyph("up")), () => move(name, "top")),
      holdable(h("button", { class: "control move", "aria-label": `Move ${projectName(name)} down (hold, or Shift+Enter: to the bottom)`,
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
  for (const menu of [app.listEl && app.listEl.menu, typeof board !== "undefined" && board.organize]) {
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
  return h("button", { class: "control wide danger", onclick: () => confirmClose(s) }, "Complete mission");
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
  // What it runs that hasn't ended (a test run, a helper) stops halfway: said whole.
  const runs = c.running || [];
  const stops = runs.length ? h("p", { class: "close-stops" }, `Stops what's still running: ${runs[0]}${runs.length > 1 ? ` (and ${runs.length - 1} more)` : ""}.`) : null;
  const yes = h("button", { class: "control wide danger", onclick: async () => {
    yes.disabled = true;
    try {
      const res = await fetch(`/api/session/${encodeURIComponent(s.id)}/close`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ discard: n > 0 }) });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && d.changes) return confirmClose(s, d);      // changes since: ask again
      if (!res.ok) throw new Error(d.error || "It didn't close");
      closeSheets();
      // A chat closed is a mission completed (today.js): celebrated.
      if (typeof missionComplete === "function") missionComplete(s.task || `${projectName(s.repo)} · ${s.name}`);
      else toast(`Closing ${s.task || `${projectName(s.repo)} · ${s.name}`}`);
      if (app.session && app.session.id === s.id) go("#/");
    } catch (e) {
      yes.disabled = false;
      toast(e instanceof TypeError ? "Can't reach Amarchy" : e.message);
    }
  } }, n ? "Complete and discard changes" : runs.length ? "Stop it and complete" : "Complete mission ✓");
  sheet({ key: "close" }, sheetHead(`Complete ${s.task || where(s)}?`, `${detail} · ${where(s)}`), stops, yes,
    h("button", { class: "control wide", onclick: closeSheet }, "Cancel"));
}

// Your assistant's picture: yours (amarchy assistant --picture), by its hash,
// else amarchy's own (app/assistant.svg).
// The 192 one is what the lists show (about 70 KB, not the 512's 420 KB, and
// every row's picture is drawn again each time the list changes); the big one
// only where it's shown big.
function avatar(s, cls) {
  const size = cls === "big" ? 512 : 192;
  const src = /^[0-9a-f]{12}$/.test(s.picture || "") ? `/picture/${s.picture}-${size}.png` : "/assistant.svg";
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
  const line = s.setup ? "Setting up…" : st === "waiting" ? s.asks || STATUS.waiting : unread ? s.said
    : task || (st === "working" ? "On it…" : "Here for you");
  return holdable(h("button", { class: `row assistant ${st}${unread ? " unread" : ""}`, "data-id": s.id,
                                onclick: () => { go(`#/s/${encodeURIComponent(s.id)}`); } },
    h("span", { class: "avatar-wrap" }, avatar(s), stateIcon(s)),
    h("span", { class: "main" },
      h("div", { class: "name" }, name, unread ? h("span", { class: "new" }, "New") : null),
      h("div", { class: `line${st === "waiting" ? " waiting" : ""}${unread ? " said" : ""}` }, line),
      h("div", { class: "status-line" }, h("span", { class: `status is-${statusTone(s)}` }, statusLine(s)),
        unread && task ? ` · ${task}` : "")),
    h("span", { class: "side" }, h("span", { class: "age" }, s.age || ""), unreadDot(s))), () => rowMenu(s));
}

// A session that finished a turn you haven't opened yet: a dot by its time.
function unreadDot(s) {
  return s.unseen ? h("span", { class: "dot", title: "Unread", "aria-label": "Unread" }) : null;
}

// One session in the list, the same on the phone and beside the chat on a
// computer: what it's about (the keyword in bold); its state in words, in
// its color ("Needs your answer", "Working · reading app.js", "Done",
// "Ready", "Asleep") and its project, unless a header above says it; then
// what it asks you, or the last thing its Claude wrote. Its time, the unread
// dot and its priority (unless a header says it) on the right. near:
// another session of your assistant's project, under it, with its picture small.
function sessionRow(s, groups, near = false) {
  const st = doneOf(s), tone = statusTone(s);
  const prio = !groups.includes("priority") && s.priority && s.priority !== "normal"
    ? glyph(s.priority, `prio ${s.priority}`) : null;
  const task = s.setup ? title(s) : (s.task || "New chat");
  // Running says the first of them already: the others, if any.
  const others = (s.background || 0) - (st === "running" ? 1 : 0);
  const bg = others > 0 ? ` · ${others}${st === "running" ? " more" : ""} in the background` : "";
  const preview = s.setup ? "" : st === "waiting" ? s.asks || "" : s.said || "";
  return holdable(h("button", { class: `row session-row is-${tone}${s.priority === "low" ? " low" : ""}${s.unseen ? " unread" : ""}`,
                                "data-id": s.id, onclick: () => { go(`#/s/${encodeURIComponent(s.id)}`); } },
    stateIcon(s),
    near ? avatar(s, "small") : null,
    h("span", { class: "main" },
      taskText(task, s.task ? "" : "untitled"),
      h("div", { class: "status-line" }, h("span", { class: `status is-${tone}` }, statusLine(s)),
        groups.includes("project") ? null : h("span", { class: "repo" }, ` · ${projectName(s.repo)}`), bg),
      preview ? h("div", { class: `preview${st === "waiting" ? " asks" : ""}` }, preview) : null),
    h("span", { class: "side" }, h("span", { class: "age" }, s.age || ""), unreadDot(s), prio)), () => rowMenu(s));
}

// ---- a session

class SessionView {
  constructor(id) {
    this.id = id;
    this.row = app.view && app.view.sessions.find((s) => s.id === id) || null;
    this.mode = "chat";
    this.build();
    this.open();
    this.seen = setInterval(() => this.markSeen(), 10000);
    this.markSeen();
  }

  build() {
    this.titleEl = h("div", { class: "title" });
    const bar = h("div", { class: "bar" },
      // Back: from a terminal to the chat, from the chat to the list.
      h("button", { class: "icon-btn", "aria-label": "Back", onclick: () => { if (this.mode === "terminal") this.setMode("chat"); else go("#/"); } }, glyph("back")),
      this.titleEl,
      h("button", { class: "icon-btn", "aria-label": "More", onclick: () => this.menu() }, glyph("more")));
    // The conversation, its cards and the box you type in (chat.js).
    this.chat = new Chat({
      id: this.id, row: this.row, noSwitch: true,      // Cards | Chat: in Settings and the menu (⋯)
      onGoal: () => this.renderHeader(),              // what the chat is for, under its name
      onSession: (row) => { this.row = row; this.renderHeader(); },
      onGone: (why) => {
        toast(why ? "Can't open that chat." : "That chat was closed.");
        go("#/");
      },
      // A notification about its card was tapped: the conversation, where the card is.
      onAsk: () => { if (this.mode !== "chat") this.setMode("chat"); },
      // Opened from Today and sent something: back to Today, the next thing in sight.
      onSent: () => {
        if (app.fromToday !== this.id) return;
        app.fromToday = null;
        todayAnswered(this.id);
        app.tab = "today";
        go("#/");
        toast("Sent: it's working on it");
      },
    });
    // (The terminals open from the menu, ⋯: the chat keeps the whole screen.)
    this.el = h("div", { class: "view" }, bar, this.chat.el);
    root.replaceChildren(this.el);
    this.renderHeader();
  }

  // The session's terminals (terminal.js): the project's, and Claude's
  // classic one; made the first time one shows.
  get terminal() {
    if (!this._terminal) {
      this._terminal = new SessionTerminal({ id: this.id, phone: true,
        onBack: () => this.setMode("chat") });
      this.el.append(this._terminal.el);
    }
    return this._terminal;
  }

  // What restyleTerminals() wears the look again on.
  get pane() { return this._terminal || null; }

  open() { this.chat.open(); }

  close() {
    this.chat.close();
    this.closed = true;
    if (this._terminal) this._terminal.close();
    clearInterval(this.seen);
  }

  // Back from the background: everything from scratch.
  reopen() {
    this.chat.reopen();
    this.closed = false;
    if (this.mode === "terminal") this.terminal.open(this.id);
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
          h("div", { class: "status-line" }, task, h("span", { class: `status is-${statusTone(r)}` }, statusWords(r)))));
      return;
    }
    // Under its name, what the chat is for (the goal in its replies: chat.js), else its state in
    // words and its project as the list says them (the branch: in its menu; the state: its icon).
    const goal = this.chat && this.chat.goal;
    this.titleEl.replaceChildren(stateIcon(r), ...[r.assistant ? avatar(r, "small") : null].filter(Boolean),
      h("div", { class: "text" }, taskText(r.task || "New chat", r.task ? "" : "untitled"),
        goal ? h("div", { class: "status-line goal", title: goal }, goal)
             : h("div", { class: "status-line" }, h("span", { class: `status is-${statusTone(r)}` }, statusWords(r)), ` · ${projectName(r.repo)}`)));
  }

  // The conversation, or the session's terminals (the project's, or Claude's
  // classic one: terminal.js, its keys under it).
  setMode(mode, which) {
    this.mode = mode;
    this.el.classList.toggle("terminal", mode === "terminal");
    const term = mode === "terminal";
    if (!term && this._terminal) this._terminal.close();
    this.chat.el.hidden = term;
    if (this._terminal) this._terminal.el.hidden = !term;
    if (term) {
      const t = this.terminal;
      t.el.hidden = false;
      if (which === "classic") t.classic();
      else t.open(this.id).then(() => { if (which) t.show(which); });
    }
  }

  menu() {
    const row = this.row || { id: this.id };
    const seg = prioritySeg(row);
    const item = (on, label, act) =>
      h("button", { class: `menu-item${on ? " on" : ""}`, onclick: () => { closeSheets(); act(); } },
        label, on ? glyph("check", "val") : null);
    const t = this._terminal;
    const shownTerm = this.mode === "terminal" && t && t.which() === "term";
    const shownClassic = this.mode === "terminal" && t && t.which() === "claude";
    // With Show terminals off, they're here still, under Advanced (the classic
    // terminal only when Show terminals is on: it's for what the chat can't do).
    const classicOk = !!(app.view && app.view.show_terminals);
    const terminals = h("div", { class: "menu" },
      ...(this.mode === "terminal" ? [item(false, "Back to the chat", () => this.setMode("chat"))] : []),
      item(shownTerm, "Open terminal", () => this.setMode("terminal", "term")),
      ...(classicOk ? [item(shownClassic, "Open Claude's classic terminal", () => this.setMode("terminal", "classic"))] : []));
    sheet(sheetHead(title(row), where(row)),
      h("div", { class: "section" }, "Priority"), seg,
      h("div", { class: "section" }, "Show replies as"), chatViewSeg(() => { closeSheets(); if (this.mode === "terminal") this.setMode("chat"); }),
      h("div", { class: "section" }, "Chat"),
      h("button", { class: "control wide", onclick: () => { closeSheets(); this.chat.openMenu("add"); } }, "Add a picture or a file…"),
      h("button", { class: "control wide", onclick: () => addSecretSheet({ project: row.repo }) }, "Add a secret…"),
      ...sessionActions({ ...row, id: this.id }),
      closeButton({ ...row, id: this.id }),
      h("div", { class: "section" }, terminalsShown() ? "Terminals" : "Advanced"), terminals);
  }
}

// The text size of the terminals on the phone (A−/A+ there).
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
// allowed it's kept a little after a dictation: its track off (nothing is
// heard) and the audio stopped, and holding the button again turns them back
// on, unasked and at once. But kept, the browser still has the microphone
// (a Mac shows it in use, and the music you're playing goes quieter), so
// MIC_KEEP after the last dictation, or as soon as the app is out of sight,
// it's let go entirely; the next dictation opens it anew.
//
// What's kept can die meanwhile, and iOS doesn't say so: a call, Siri or the
// app in the background interrupts the audio (and resuming it may never
// finish), and a track turned back on can stay silent. So it's looked at
// each time: what's interrupted or ended is made anew, what doesn't start is
// given up on rather than waited for, and a microphone that hears nothing
// at all (not a sample but 0) once held is opened afresh, there and then.

const mic = { stream: null, ctx: null, ready: null, source: null, node: null, take: null,
              pieces: 0, loud: 0, watch: null, fresh: false, gen: 0, hears: null, idle: null };
const MIC_KEEP = 30000;   // ms the microphone is kept, off, after a dictation: then let go
const MIC_TAIL = 500;     // ms the microphone stays on after you let go: the end of the last word
const MIC_START = 3000;   // ms the phone's audio may take to start
const MIC_DEAD = 1200;    // ms held before the microphone is looked at: dead, it's opened afresh
const MIC_SILENT = 40;    // pieces (20 ms) of nothing but 0 in a row that only a dead microphone gives

// retry: the microphone opened afresh while held (see micWatch), not a new hold.
//
// Called in the touch itself, and nothing is awaited before both asks are
// made: the microphone first (the phone asks whether Amarchy may use it,
// there and then), and the audio. On an iPhone a touch only lets the audio
// start once the finger lifts (pointerdown isn't a gesture for it; pointerup
// is), so the audio isn't waited for before the microphone is asked for:
// micNudge, from the lift, starts it then.
async function micOpen(retry) {
  const gen = ++mic.gen;
  clearTimeout(mic.idle);
  if (!retry) mic.fresh = false;
  if (mic.ctx && mic.ctx.state !== "running" && mic.ctx.state !== "suspended") micReset();
  const kept = mic.stream && mic.stream.getAudioTracks().some((t) => t.readyState === "live" && !t.muted);
  let asked = null;
  if (!kept) {
    micClose();       // what's left of one that ended (a phone call took it, say)
    asked = navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  }
  if (!mic.ctx) {
    mic.ctx = new AudioContext();
    mic.ready = mic.ctx.audioWorklet ? mic.ctx.audioWorklet.addModule("voice.js") : Promise.resolve();
  }
  const ctx = mic.ctx;
  ctx.resume().catch(() => {});
  let stream = null;
  try {
    if (asked) stream = await within(asked, 60000, "the phone didn't answer about the microphone");
    // Asked just now, the answer took a while: the lift that would have
    // started the audio came before it, so it's asked again.
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    await within(Promise.all([mic.ready, micRunning(ctx)]), MIC_START, "the phone's audio didn't start");
  } catch (e) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (gen === mic.gen) micReset();       // the next hold makes it all anew
    throw e;
  }
  if (gen !== mic.gen || mic.ctx !== ctx) {      // another hold took over meanwhile
    if (stream) stream.getTracks().forEach((t) => t.stop());
    return;
  }
  if (!stream) {
    if (mic.node && mic.node.port) mic.node.port.postMessage("reset");
    mic.stream.getTracks().forEach((t) => { t.enabled = true; });
    micWatch();
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

// Once the audio runs, whichever ask started it (a resume() iOS turned down
// can stay pending for good, so its promise isn't what's waited for).
function micRunning(ctx) {
  if (ctx.state === "running") return Promise.resolve();
  return new Promise((ok) => {
    const seen = () => {
      if (ctx.state !== "running") return;
      ctx.removeEventListener("statechange", seen);
      ok();
    };
    ctx.addEventListener("statechange", seen);
  });
}

// The finger lifted off the mic: a gesture the phone starts the audio in.
function micNudge() {
  if (mic.ctx && mic.ctx.state !== "running" && mic.ctx.state !== "closed") mic.ctx.resume().catch(() => {});
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
  clearTimeout(mic.idle);
  mic.idle = setTimeout(micLetGo, MIC_KEEP);
}

// Not dictating: the microphone and the audio let go entirely.
function micLetGo() {
  clearTimeout(mic.idle);
  if (mic.take || !(mic.stream || mic.ctx)) return;
  mic.gen++;        // an opening under way gives back what it gets
  micReset();
}

// Out of sight (another app, another tab, the phone locked): let it go.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") micLetGo(); });
window.addEventListener("pagehide", micLetGo);

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
  else if (app.desk) deskRefocus();     // desk.js: the chat, or the terminal you were in
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
// The new chat: "What do you want to do?", typed or dictated, and under it
// the project it starts in: the one you pick, else one that what you wrote
// names ("…in jaken…"), else the last one you used; and the model it starts
// on, the host's for every new chat (Opus until you pick another here, for
// this chat and the ones after, on every device). Under the list on the
// phone; on a computer, the middle of the window (wide: desk.js's
// newSession, Ctrl+Alt+N), where Enter starts it. Started, it isn't opened:
// you stay where you were, as after sending any chat something. started(id):
// what else to do then.
function newChat({ wide = false, started = null } = {}) {
  let repo = store.get("last-project");
  let picked = false;       // you picked the project for this one: no guessing
  let guessed = false;      // what you wrote named it
  const name = h("b", { class: "name" });
  const pick = h("button", { class: "pick", type: "button", "aria-label": "Project: where Claude works on it", "aria-haspopup": "menu",
                             onclick: () => pickProject() }, h("span", { class: "in" }, "in"), name, glyph("down"));
  const why = h("span", { class: "why" }, "named in what you wrote");
  const modelLabel = h("b", { class: "name" });
  const modelPick = h("button", { class: "pick model", type: "button", "aria-label": "Model: which Claude answers", "aria-haspopup": "menu",
                                  onclick: () => pickModel() }, h("span", { class: "in" }, "on"), modelLabel, glyph("down"));
  const field = h("textarea", { rows: wide ? 3 : 1, placeholder: "What do you want to do?", enterkeyhint: wide ? "go" : "enter",
                                "aria-label": "What do you want to do?",
                                oninput: () => { store.set("draft:new", field.value); grow(); guess(); buttons(); },
                                onkeydown: (e) => {
                                  // Dictating: Enter or Escape stops it, the words stay here (dictate.js), unsent.
                                  if (dictate.keyStops(e)) { e.preventDefault(); e.stopPropagation(); return; }
                                  // A computer's: Enter starts it (Shift+Enter, a new line); Escape, back to the chat you were in.
                                  if (!wide || e.isComposing) return;
                                  if (e.key === "Enter" && !e.shiftKey && !e.altKey) { e.preventDefault(); start(); }
                                  else if (e.key === "Escape" && !field.value.trim() && typeof leaveNewChat === "function") { e.preventDefault(); leaveNewChat(); }
                                } });
  field.value = store.get("draft:new") || "";
  // Pictures that go with it (a screenshot pasted, dropped, or picked): its
  // first message's, as a chat's tray has them (chat.js).
  let tray = [];
  const trayEl = h("div", { class: "tray", hidden: true });
  const drawTray = () => {
    trayEl.hidden = !tray.length;
    trayEl.replaceChildren(...tray.map((a) => h("div", { class: `att image${a.url ? "" : " busy"}`, title: a.name },
      a.url ? h("img", { src: a.url, alt: a.name }) : spinner(),
      h("button", { class: "att-x", type: "button", "aria-label": `Take ${a.name} off`, title: "Take it off",
                    onclick: () => { a.removed = true; tray = tray.filter((x) => x !== a); if (a.url) URL.revokeObjectURL(a.url); drawTray(); field.focus(); } },
        icon("failed")))));
    buttons();
  };
  const addFiles = (files) => {
    for (const f of files) {
      if (!f) continue;
      if (!/^image\//.test(f.type) || /svg/.test(f.type)) { toast(`${f.name || "That file"}: only pictures go with a new chat (files, once it's started)`); continue; }
      if (tray.length >= IMAGES_MAX) { toast(`${IMAGES_MAX} pictures at most`); break; }
      const a = { name: f.name || "image" };
      tray.push(a);
      claudeImage(f).then(async (img) => {
        if (a.removed) return;
        Object.assign(a, { type: img.type, data: await base64Of(img), url: URL.createObjectURL(img) });
        drawTray();
      }).catch(() => { tray = tray.filter((x) => x !== a); drawTray(); toast(`This browser can't read ${a.name}`); });
    }
    drawTray();
  };
  // Pasted: a picture goes with it (text pasted is text, even when an image of it comes along).
  field.addEventListener("paste", (e) => {
    const d = e.clipboardData;
    const files = d ? Array.from(d.files || []) : [];
    if (!files.length || (d.getData("text/plain") || "").trim()) return;
    e.preventDefault();
    addFiles(files);
  });
  const imgBtn = h("button", { class: "mic pic", type: "button", "aria-label": "Add a picture", title: "Add a picture (or paste one, or drop it here)",
                               onclick: async () => { const f = await pickFiles("image/*", { multiple: true }); if (f.length) addFiles(f); field.focus(); } }, glyph("image"));
  const send = h("button", { class: wide ? "cta go" : "send", type: "button", "aria-label": "Start the chat", title: wide ? "Start (Enter)" : null,
                             onclick: () => start() }, wide ? "Start" : glyph("send"));
  const micBtn = h("button", { class: "mic", type: "button", "aria-label": "Dictate (hold, or tap and tap again)", hidden: true }, glyph("mic"));
  // What you say, into the box (dictate.js); or, on the phone through
  let saying = null;
  const dictate = new Dictate({ field, button: micBtn,
                                changed: () => { store.set("draft:new", field.value); grow(); guess(); buttons(); },
                                state: (text) => { saying = text; buttons(); } });
  const box = h("div", { class: "prompt new" }, field, imgBtn, micBtn, wide ? null : send);
  const under = h("div", { class: "new-under" }, pick, why, modelPick, wide ? h("span", { class: "hint" }, "Enter starts it · Shift+Enter, a new line · paste a screenshot") : null, wide ? send : null);
  const el = h("div", { class: `start-chat${wide ? " wide" : ""}` },
    wide ? h("h1", { class: "new-title" }, "What do you want to do?") : null, trayEl, box, under);
  // Dropped on it: the pictures go with it too.
  const files = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  el.addEventListener("dragover", (e) => { if (files(e)) { e.preventDefault(); el.classList.add("dropping"); } });
  el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove("dropping"); });
  el.addEventListener("drop", (e) => {
    el.classList.remove("dropping");
    if (!files(e)) return;
    e.preventDefault();
    addFiles(Array.from(e.dataTransfer.files || []));
    field.focus();
  });
  const projects = () => (app.view && app.view.projects) || [];
  const grow = () => {
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight + 2, window.innerHeight * 0.4)}px`;
  };
  // A project what you wrote names, as a word of its own ("the jaken app",
  // "houston os"): the longest name that fits, so "houston-os" beats "houston".
  const guess = () => {
    if (picked) return;
    const text = ` ${field.value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
    const hit = projects().map((p) => p.name)
      .filter((n) => text.includes(` ${n.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `))
      .sort((x, y) => y.length - x.length)[0];
    const was = repo;
    if (hit) { repo = hit; guessed = true; }
    else if (guessed) { repo = store.get("last-project") || repo; guessed = false; }
    if (repo !== was) update();
    else why.hidden = !guessed;
  };
  const buttons = () => {
    const none = !projects().length;
    send.disabled = none || !field.value.trim() || dictate.on() || tray.some((a) => !a.data);
    imgBtn.hidden = none;
    under.hidden = none;
    micBtn.hidden = none || !dictate.available();
    micBtn.classList.toggle("on", dictate.on() && dictate.run.held);
    box.classList.toggle("listening", saying !== null);
    field.placeholder = none ? (app.view ? "Add a project first" : "Connecting…")
      : saying !== null ? saying : wide ? "Say it in your own words: what you want, and anything Claude should know" : "What do you want to do?";
  };
  const update = () => {
    const ps = projects();
    if (added && ps.some((p) => p.name === added)) added = null;      // the list has it now
    if (ps.length && !added && !ps.some((p) => p.name === repo)) { repo = ps[0].name; guessed = false; }
    name.textContent = projectName(repo);
    why.hidden = !guessed;
    modelLabel.textContent = modelName(model(), models()) || model();
    modelPick.title = "Which Claude answers: every new chat starts on it, until you pick another";
    buttons();
  };
  // The models Claude said there are (the newest Claude's), else the short list.
  const models = () => (app.view && app.view.models && app.view.models.length ? app.view.models : FALLBACK_MODELS);
  const model = () => (app.view && app.view.new_model) || "opus";
  const setModel = async (m) => {
    const was = model();
    if (app.view) app.view.new_model = m.value;
    update();
    field.focus({ preventScroll: true });
    if (m.value === was) return;
    try {
      await api("/api/new/model", { model: m.value });
      toast(`New chats start on ${m.displayName || m.value}`);
    } catch (e) {
      if (app.view) app.view.new_model = was;
      update();
      toast(e.message);
    }
  };
  // The main ones (opus, sonnet...: each its latest), the dated versions under "Other versions…".
  const pickModel = () => {
    const list = models(), on = modelOf(model(), list);
    const main = list.filter((x) => !/^claude-/.test(x.value));
    const others = list.filter((x) => !main.includes(x));
    const row = (x) => ({ label: x.displayName || x.value, detail: x.description || "", icon: on && on.value === x.value ? "check" : "",
                          act: () => setModel(x) });
    if (app.desk) return picker({ title: "Which Claude answers? New chats start on it", placeholder: "Model", items: [
      ...(main.length ? main : list).map(row),
      ...(main.length && others.length ? [{ label: "Other versions…", always: true, group: () => ({ title: "Other versions", items: others.map(row) }) }] : [])] });
    const item = (x) => h("button", { class: `menu-item${on && on.value === x.value ? " on" : ""}`, onclick: () => { closeSheets(); setModel(x); } },
      h("span", { class: "label" }, x.displayName || x.value, x.description ? h("small", {}, x.description) : null),
      on && on.value === x.value ? glyph("check", "val") : null);
    const rest = h("div", { class: "menu", hidden: true }, ...others.map(item));
    sheet(sheetHead("Model", "Which Claude answers: new chats start on it"),
      h("div", { class: "menu" }, ...(main.length ? main : list).map(item)),
      main.length && others.length ? h("button", { class: "control wide", onclick: (e) => { rest.hidden = false; e.currentTarget.remove(); } }, "Other versions…") : null,
      main.length && others.length ? rest : null);
  };
  const choose = (p) => { repo = p; picked = true; guessed = false; store.set("last-project", repo); update(); field.focus(); };
  const pickProject = () => {
    if (app.desk) return picker({ title: "Where should Claude work on it?", placeholder: "Project", items: [
      ...projects().map((p) => ({ label: projectName(p.name), icon: p.name === repo ? "check" : "project",
                                  detail: p.sessions ? `${p.sessions} chat${p.sessions === 1 ? "" : "s"}` : "", act: () => choose(p.name) })),
      { label: "New project…", icon: "plus", key: "Ctrl+Alt+P", always: true, act: () => newProject() }] });
    sheet(sheetHead("Project", "Where Claude works on it"),
      h("div", { class: "menu" }, ...projects().map((p) =>
        h("button", { class: `menu-item${p.name === repo ? " on" : ""}`, onclick: () => { closeSheets(); choose(p.name); } },
          projectName(p.name), p.name === repo ? glyph("check", "val") : null))),
      h("button", { class: "control wide", onclick: () => newProjectSheet(use) }, "New project…"));
  };
  // A project just added: the next chat starts there (once the list has it).
  let added = null;
  const use = (project) => {
    repo = added = project;
    picked = true;
    guessed = false;
    store.set("last-project", project);
    update();
    field.focus();
  };
  const reset = () => {
    for (const a of tray) if (a.url) URL.revokeObjectURL(a.url);
    tray = [];
    drawTray();
    field.value = "";
    store.set("draft:new", "");
    store.set("last-project", repo);
    picked = guessed = false;
    grow();
    update();
  };
  const start = async () => {
    if (!field.value.trim() || !repo) return;
    if (tray.some((a) => !a.data)) return toast("A picture is still on its way: a moment");
    send.disabled = true;
    el.classList.add("busy");
    try {
      const images = tray.map((a) => ({ type: a.type, data: a.data }));
      const { id } = await api("/api/new", { repo, prompt: field.value, model: model(), ...(images.length ? { images } : {}) });
      // It works on it; you stay where you were, on with the rest. It's
      // under At work, and asks you (Needs you) once it's done.
      const where = projectName(repo);
      reset();
      field.blur();
      toast(`Started in ${where}: it shows under Needs you once it's done`);
      if (started) started(id);
    } catch (e) {
      toast(e.message);
    }
    el.classList.remove("busy");
    buttons();
  };
  requestAnimationFrame(() => { grow(); guess(); update(); });
  return { el, update, use, dictate, focus: () => field.focus({ preventScroll: true }), field, addFiles, tray: () => tray };
}

// ---- what you shared into amarchy (bin/amarchy's "sharing into amarchy")
//
// A screenshot shared from the phone's share sheet (an iPhone's Shortcut,
// Android's own) waits on the host until a chat takes it, and shows here on
// every screen of yours: "Send" on a chat sends it as it is; the chat itself
// opens with it in the box (Chat.takeShare), to say more first. Closed
// without either, it's let go.

let shareInbox = null;      // {id: the chat's, files, text}: for that chat's box (Chat.takeShare)
let shareShown = null;      // the share whose sheet this page showed

function shareCheck() {
  const s = app.view && app.view.share;
  const open = document.querySelector(".sheet-back.share");
  if (open && (!s || open.shareId !== s.id)) {       // taken on another screen, or another came
    open.taken = true;
    if (open === Array.from(document.querySelectorAll(".sheet-back")).pop()) closeSheet();
    else open.remove();
  }
  if (s && s.id !== shareShown && app.view.sessions) shareSheet(s);
}

function shareSheet(s) {
  shareShown = s.id;
  const pics = Array.from({ length: s.pictures }, (_, i) => `/api/share/${i}?id=${encodeURIComponent(s.id)}`);
  const chats = app.view.sessions.filter((x) => !x.setup);
  let busy = false;
  const take = async (x, send) => {
    if (busy) return;
    busy = true;
    back.classList.add("busy");
    try {
      const files = await Promise.all(pics.map(async (src, i) => {
        const r = await fetch(src);
        if (!r.ok) throw new Error("It's gone: share it again");
        const b = await r.blob();
        return new File([b], `shared-${i + 1}.${(b.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: b.type });
      }));
      if (send) {
        const images = [];
        for (const f of files) {
          const img = await claudeImage(f).catch(() => { throw new Error("This browser can't read that picture: open the chat on the phone"); });
          images.push({ type: img.type, data: await base64Of(img) });
        }
        const r = await api(`/api/session/${encodeURIComponent(x.id)}/send`, { text: s.text || "", ...(images.length ? { images } : {}) });
        toast(r.waking ? "Sent: waking Claude with it…" : `Sent to ${x.task || "the chat"}`);
      } else {
        shareInbox = { id: x.id, files, text: s.text || "" };
      }
      back.taken = true;
      api("/api/share/clear", { id: s.id }).catch(() => {});
      closeSheets();
      go(`#/s/${encodeURIComponent(x.id)}`);
      // Already open: it takes it now (else as it opens).
      const chat = app.desk ? desk.chat : app.session && app.session.chat;
      if (!send && chat && chat.id === x.id) chat.takeShare();
    } catch (e) {
      toast(e.message);
    }
    busy = false;
    back.classList.remove("busy");
  };
  const row = (x) => h("div", { class: "share-row" },
    h("button", { class: "share-open", title: "Open it with this in the box, to say more", onclick: () => take(x, false) },
      taskText(x.task || "New chat", x.task ? "" : "untitled"),
      h("small", {}, [projectName(x.repo), statusLine(x)].filter(Boolean).join(" · "))),
    h("button", { class: "control share-send", onclick: () => take(x, true) }, "Send"));
  const n = s.pictures;
  const back = sheet({ key: "share" },
    sheetHead(n > 1 ? `Send these ${n} pictures to a chat` : n ? "Send this picture to a chat" : "Send this to a chat",
              "Send it, or tap a chat to say more"),
    h("div", { class: "share-preview" }, ...pics.map((src) => h("img", { src, alt: "What you shared" })),
      s.text ? h("p", { class: "share-text" }, s.text) : null),
    chats.length ? h("div", { class: "share-list" }, ...chats.map(row))
      : h("p", { class: "note" }, "No chats yet: start one, then share it again."),
    h("button", { class: "control wide", onclick: () => closeSheet() }, "Don't send it"));
  back.classList.add("share");
  back.shareId = s.id;
  // Gone without a chat taking it (closed, swiped away): let go on the host.
  new MutationObserver((_, obs) => {
    if (back.isConnected) return;
    obs.disconnect();
    if (!back.taken) api("/api/share/clear", { id: s.id }).catch(() => {});
  }).observe(document.body, { childList: true });
}

// Settings → Share to Amarchy: how to put it in the phone's share sheet.
function shareSettings() {
  return [h("div", { class: "section" }, "Share to Amarchy"),
    h("p", {}, "A screenshot or photo, from the share sheet to a chat: sent as it is, or with more to say."),
    h("button", { class: "control wide", onclick: () => shareSetup() }, "Put Amarchy in the share sheet…")];
}

async function shareSetup() {
  const url = h("code", { class: "share-url" }, "…");
  const copy = h("button", { class: "control wide accent", disabled: true }, "Copy the address");
  const step = (...kids) => h("li", {}, ...kids);
  sheet(sheetHead("Share to Amarchy", "In the share sheet, like any app"),
    h("div", { class: "section" }, "iPhone, iPad and Mac: a Shortcut"),
    h("p", {}, "A web app can't be in Apple's share sheet itself; a Shortcut can, and hands what you share to Amarchy."),
    h("ol", { class: "share-steps" },
      step("Copy this address (it has your share key: keep it to yourself):", url, copy),
      step("In the Shortcuts app, tap +. Name it Amarchy (tap its name at the top)."),
      step("Add the action Get Contents of URL, and paste the address as its URL. Tap the arrow by it: Method POST, Request Body File, and for the file, Shortcut Input."),
      step("Tap ⓘ at the bottom (or the name's menu, Details): turn on Show in Share Sheet. At the top it then says Receive: set it to Images (and Screenshots)."),
      step("Done. Share a screenshot (Share, then Amarchy), open Amarchy: pick the chat.")),
    h("p", {}, "Several pictures at once: put the action in a Repeat with Each (of Shortcut Input), with Repeat Item as the file. Your Mac's share menu has the Shortcut too, through iCloud."),
    h("div", { class: "section" }, "Android"),
    h("p", {}, "Add Amarchy to the Home screen from Chrome (installed again, if it was before): it's in the share sheet itself."));
  try {
    const r = await fetch("/api/share/key");
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "");
    url.textContent = d.url;
    copy.disabled = false;
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(d.url); toast("Copied: paste it in the Shortcut"); }
      catch (e) { toast("Couldn't copy it: hold the address to copy it"); }
    };
  } catch (e) {
    url.textContent = "Couldn't get it: try again in a moment";
  }
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
    h("p", {}, after === "off" ? "Chats stay awake until you put one to sleep (its menu)."
      : `A chat idle for ${after === 1 ? "a minute" : `${after} minutes`} and open nowhere sleeps: its Claude Code exits and frees its memory, the conversation stays, and what you send it wakes it. Never while it works, asks you something or runs something in the background.`),
    h("button", { class: "control wide", onclick: async (e) => {
      e.currentTarget.disabled = true;
      try {
        const r = await api("/api/sleep", { all: true });
        toast(`${r.slept} asleep${r.kept ? `, ${r.kept} kept awake (busy)` : ""}`);
      } catch (err) { toast(err.message); }
      draw();
    } }, "Put idle chats to sleep now")];
}

// The chat engine's check (the protocol test) failed on this Claude Code:
// said once, in Settings, only then.
function engineSettings() {
  const problem = app.view && app.view.engine_problem;
  return problem ? [h("p", { class: "note" }, `Amarchy's check of the chat with this Claude Code failed: ${problem}.`)] : [];
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
      kids.push(h("p", {}, "Get a notification when a chat needs you or is done."),
        h("button", { class: "control wide accent", onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { await pushOn(); toast("Notifications on."); } catch (err) { toast(err.message); }
          draw();
        } }, "Turn on notifications"));
    } else {
      kids.push(h("p", {}, "On: you're told when a chat needs you or is done, unless you're looking at it."),
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
      h("p", {}, alerts === "all" ? "Every chat, when it needs you and when it's done."
               : alerts === "needs-you" ? "A chat that asks you something, or needs your permission. One that's done is just marked done in the list."
               : "Nothing from the chats; their list still says how they are."),
      h("p", {}, name ? `${name}, your assistant, always tells you: under its own name and picture, with its own chime.`
                      : "Your assistant, once you have one (amarchy assistant <id>), always tells you."));
    // The chimes, your assistant and your projects (manage.js), as amarchy sound,
    // assistant and add set them on the host.
    const helper = (app.view && app.view.sessions.find((x) => x.assistant === "main")) || null;
    const label = (n) => (n === "off" ? "off" : n ? n.charAt(0).toUpperCase() + n.slice(1) : "");
    kids.push(h("div", { class: "section" }, "Sound"),
      h("button", { class: "control wide", onclick: () => soundSheet(false) },
        `Chime: ${label(app.view && app.view.sound)}${helper ? ` · ${helper.assistant_name || "Assistant"}'s: ${label(app.view.assistant_sound)}` : ""}`),
      h("p", {}, app.desk ? "Rings in this browser when a chat needs you or is done, unless you're looking at it."
                          : "Rings in a computer's browser; the phone's notifications ring with its own sound."),
      h("div", { class: "section" }, "Assistant"),
      helper ? h("button", { class: "control wide", onclick: () => assistantSheet(helper) }, `${helper.assistant_name || "Assistant"}: name, picture, chime…`)
             : h("p", {}, "None yet: open a chat's menu (⋯, or hold it in the list) and make it your assistant."),
      h("div", { class: "section" }, "Projects"),
      h("button", { class: "control wide", onclick: () => newProjectSheet((p) => { if (app.newChat) app.newChat.use(p); if (app.desk) newChatIn(p); }) }, "New project…"),
      h("button", { class: "control wide", onclick: () => orderProjects() }, "Order projects…"));
    kids.push(h("div", { class: "section" }, "Replies"), chatViewSeg(() => draw()),
      h("p", {}, chatView() === "screen" ? "Brief: each chat's goal, where it stands, what changed and what waits on you, kept up to date by Claude; its own words a tap away."
                                         : "Chat: Claude's replies as it writes them, the whole conversation."));
    kids.push(...shareSettings());
    kids.push(...sleepSettings(draw));
    kids.push(...dictationSettings(draw));
    kids.push(...engineSettings());
    kids.push(...todaySettings());      // today.js
    kids.push(...terminalSettings(draw), ...secretsSettings(), ...automationsSettings());     // terminal.js, secrets.js, automations.js
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
      const asked = picks;
      try {
        const res = await fetch("/api/look");
        if (!res.ok) throw new Error();
        const fresh = await res.json();
        // Read before a pick of yours was answered: that's the older look.
        if (asked === picks) {
          const was = info.look && info.look.look;
          info = fresh;
          if (info.look && info.look.look !== was) wearIt();
        }
      } catch (err) { /* the next one, then */ }
      if (back.isConnected) draw();
    }, 1500);
  };
  // The picks go to the host one after another, so the last one tapped is
  // the one kept (and worn), however quickly they're tapped.
  let picks = 0, picking = Promise.resolve();
  const pick = (change, el) => {
    if (el) el.classList.add("busy");
    picking = picking.then(async () => {
      try {
        info = await api("/api/look", change);
        picks++;
        wearIt();
      } catch (err) { toast(err.message); }
      if (el) el.classList.remove("busy");
      draw();
    }).catch((err) => console.error(err));     // one that failed doesn't hold up the next
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
  if (id !== app.fromToday) app.fromToday = null;      // only the chat Today opened goes back there on send
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

// Opening the app is for something new: on the phone, back after a while
// away (AWAY), the list and its "What do you want to do?" rather than the
// chat you left; on a computer, launched (not reloaded), the new chat in
// the middle (start). A tapped notification still goes to its chat, and a
// chat with something unsent (reloadWait) stays.
const AWAY = 10 * 60 * 1000;        // ms in the background before the phone comes back to the new chat
const away = { since: 0, told: 0 };   // hidden since; a notification's go, last (start's message)

document.addEventListener("visibilitychange", () => {
  if (app.desk) return;       // a computer's: its terminals stay as they are
  if (document.visibilityState === "hidden") {
    away.since = Date.now();
    closeList();
    if (app.session) app.session.close();
  } else {
    openList();
    if (backFromAway()) app.tab = "today";       // home again: Today first
    if (app.session && backFromAway()) go("#/");
    else if (app.session) app.session.reopen();
  }
});

function backFromAway() {
  return away.since && Date.now() - away.since >= AWAY && away.told < away.since && !reloadWait();
}

// Launched, not reloaded: a reload (or the page after an update, kept)
// stays where it was.
function launched() {
  const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
  return !kept && !(nav && nav.type === "reload");
}

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
      if (e.data && e.data.go) {
        away.told = Date.now();
        go(new URL(e.data.go, location.href).hash || "#/");
      }
      // A notification about a card: the session's chat shows it (chat.js).
      if (e.data && e.data.ask) window.dispatchEvent(new CustomEvent("amarchy-ask", { detail: { id: e.data.ask } }));
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
  // Started by tapping a notification about a card (sw.js): that card, once
  // the session's chat is up; the address without it, for a reload.
  const asked = new URLSearchParams(location.search).get("ask");
  // Android's share sheet brought something the host didn't take (bin/amarchy's share_in).
  const shareError = new URLSearchParams(location.search).get("share-error");
  if (asked || shareError) history.replaceState(null, "", location.pathname + location.hash);
  // The page after an update: the view it had (on a phone's home screen the
  // address never shows it, so it's kept), and the build it is.
  takeKept();
  if (kept && standalone && kept.hash) routed.hash = kept.hash;
  // A computer's, launched with no chat (or new chat) asked for: the board,
  // not the last chat.
  if (app.desk && launched() && !asked && !/^#\/(s\/|new$)/.test(here())) {
    routed.hash = "#/today";
    if (!standalone) history.replaceState(null, "", location.pathname + location.search + "#/today");
  }
  app.build = (document.querySelector('meta[name="app-build"]') || {}).content || null;
  if (app.desk) deskStart();
  else route();
  if (asked) window.dispatchEvent(new CustomEvent("amarchy-ask", { detail: { id: asked } }));
  if (shareError) toast(`Couldn't share that: ${shareError}`);
  shareCheck();     // something you shared, waiting for a chat
  openList();
  if (app.key) pushRefresh();
}

start();
