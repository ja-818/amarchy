// amarchy on your computer: the app in a browser on a wide screen (its wide
// layout). The board (tasks.js) has the window: your chats and tasks as
// cards. A chat opened takes the window over it (chat.js, the phone's), and
// beside it a side panel with its Terminal (the
// session's own, and Claude's classic one: real terminals, xterm.js, attached
// to the session's tmux on the host), its Changes and its Details. The phone
// and every browser show the same session at once. The keys are amarchy's
// (Ctrl+Alt+…), the look the one picked in the app (openLook). Loaded before
// app.js, whose helpers it uses (h, glyph, api, toast, sessionRow…); app.js
// starts it on a wide screen (deskStart).
"use strict";

const desk = {
  current: null,        // the session on screen
  chat: null,           // its chat (chat.js's Chat)
  focus: "chat",        // where the keyboard is: chat, side (the panel), term (a terminal in it)
  focusPane: null,      // the terminal (TermPane) with the keyboard
  sideTab: null,        // the side panel's tab you left open: term, changes, details, none (closed)
  sideWide: false,      // the side panel over the whole width (Ctrl+Alt+F)
  sideWidth: 0,
  revealed: false,      // a terminal asked for with Show terminals off: shown, for this session
  terminal: null,       // the side panel's views
  changes: null,
  details: null,
  statuses: null,       // each session's status as last seen, for the chime
  el: null,
};
const enc = new TextEncoder();

// The terminals style themselves with <style> elements of their own, which
// the app's CSP takes only with this page's nonce (the server's, each time).
const STYLE_NONCE = (document.querySelector('meta[name="style-nonce"]') || {}).content || "";
if (STYLE_NONCE && !STYLE_NONCE.startsWith("{")) {
  const make = document.createElement.bind(document);
  document.createElement = (tag, opts) => {
    const el = make(tag, opts);
    if (String(tag).toLowerCase() === "style") el.nonce = STYLE_NONCE;
    return el;
  };
}

// ---- xterm.js, loaded when a terminal is first shown (vendor/, pinned)

const XTERM = ["vendor/xterm-6.0.0.js", "vendor/xterm-addon-fit-0.11.0.js",
               "vendor/xterm-addon-unicode11-0.9.0.js", "vendor/xterm-addon-web-links-0.12.0.js"];
const WEBGL = "vendor/xterm-addon-webgl-0.19.0.js";
// The terminals draw with the DOM unless you ask for WebGL in the settings
// (faster, but not tried on every GPU: in a headless test at 2x it drew the
// text twice too big).
const webgl = () => store.get("renderer") === "webgl";
let xtermLoading = null;

function loadXterm() {
  if (xtermLoading) return xtermLoading;
  const css = h("link", { rel: "stylesheet", href: "vendor/xterm-6.0.0.css" });
  document.head.prepend(css);
  const one = (src) => new Promise((ok, fail) => {
    const s = h("script", { src });
    s.addEventListener("load", ok);
    s.addEventListener("error", () => fail(new Error(`couldn't load ${src}`)));
    document.head.append(s);
  });
  xtermLoading = (async () => {
    for (const src of webgl() ? [...XTERM, WEBGL] : XTERM) await one(src);
    // The look's monospace font (with its Nerd Font icons), before the
    // terminals measure it.
    const family = termFont();
    try {
      await Promise.all([document.fonts.load(`16px ${family}`), document.fonts.load(`bold 16px ${family}`)]);
    } catch (e) { /* its fallback, then */ }
  })();
  return xtermLoading;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

function termFont() { return cssVar("font-code") || "ui-monospace, Menlo, monospace"; }

// The terminals' font size: yours if you changed it here, else the look's.
function termSize() {
  const mine = parseFloat(store.get("term-size") || "");
  if (mine >= 6 && mine <= 40) return mine;
  const sent = parseFloat(cssVar("term-size"));
  return sent >= 6 && sent <= 40 ? sent : 12;
}

// A color as xterm.js reads one (#rrggbb, or rgba() with its alpha times a).
const colorCtx = document.createElement("canvas").getContext("2d");
function termColor(c, a) {
  colorCtx.fillStyle = "#000";
  colorCtx.fillStyle = c || "#000";
  const v = colorCtx.fillStyle;
  let r, g, b, alpha = 1;
  if (v[0] === "#") [r, g, b] = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
  else [r, g, b, alpha] = v.replace(/[^\d.,]/g, "").split(",").map(Number);
  alpha = (alpha === undefined ? 1 : alpha) * (a === undefined ? 1 : a);
  return alpha >= 1 ? `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Your theme's terminal colors. The background is the window's (.term-box),
// as see-through as the look's terminals over the wallpaper, or the
// phone app's glass: the terminal's own is clear (what's drawn in reverse
// still takes its color, solid).
function termTheme() {
  const bg = cssVar("term-background") || cssVar("surface");
  const names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
  const theme = {
    foreground: termColor(cssVar("term-foreground") || cssVar("text")),
    background: termColor(bg, 0),
    cursor: termColor(cssVar("term-cursor") || cssVar("text")),
    cursorAccent: termColor(bg),
    selectionBackground: termColor(cssVar("term-selection-background") || cssVar("text-selection"), 0.5),
    selectionForeground: termColor(cssVar("term-selection-foreground") || cssVar("text")),
  };
  names.forEach((n, i) => {
    theme[n] = termColor(cssVar(`term-${i}`));
    theme[`bright${n[0].toUpperCase()}${n.slice(1)}`] = termColor(cssVar(`term-${i + 8}`));
  });
  return theme;
}

function wsURL(path) {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`;
}

// ---- a real terminal: a session's Claude or its own, attached to its tmux

class TermPane {
  // which: "claude" or "term". opts.size: font size.
  constructor(which, opts) {
    this.which = which;
    this.opts = opts || {};
    this.el = h("div", { class: `term-host ${which}` });
    this.statusEl = h("div", { class: "term-status", hidden: true });
    this.box = h("div", { class: `term-box ${which}` }, this.el, this.statusEl);
    this.sid = null;
    this.ws = null;
    this.term = null;
    this.retry = 0;
  }

  async build() {
    await loadXterm();
    if (this.term) return;
    const t = this.term = new Terminal({
      fontFamily: termFont(), fontSize: this.size(), lineHeight: 1,
      theme: termTheme(), allowTransparency: true, allowProposedApi: true,
      drawBoldTextInBrightColors: false, minimumContrastRatio: 1, rescaleOverlappingGlyphs: true,
      customGlyphs: true, cursorBlink: false, scrollback: 1000,
      macOptionIsMeta: store.get("option-meta") !== "off", macOptionClickForcesSelection: true,
      linkHandler: { activate: (e, uri) => openLink(uri), allowNonHttpProtocols: false },
    });
    this.fitter = new FitAddon.FitAddon();
    t.loadAddon(this.fitter);
    t.loadAddon(new Unicode11Addon.Unicode11Addon());
    t.unicode.activeVersion = "11";
    t.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => openLink(uri)));
    t.open(this.el);
    this.renderer();
    // What tmux copies (a selection, set-clipboard on) to your clipboard.
    t.parser.registerOscHandler(52, (data) => {
      const b64 = data.slice(data.indexOf(";") + 1);
      if (b64 && b64 !== "?") {
        try { copyText(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))); }
        catch (e) { /* not base64 */ }
      }
      return true;
    });
    t.onData((d) => this.send(enc.encode(d)));
    t.onBinary((d) => this.send(Uint8Array.from(d, (c) => c.charCodeAt(0) & 0xff)));
    t.onResize(({ cols, rows }) => this.control({ resize: [cols, rows] }));
    t.attachCustomKeyEventHandler((e) => this.key(e));
    t.textarea.addEventListener("focus", () => paneFocused(this));
    t.textarea.addEventListener("blur", () => paneFocused(null));
    new ResizeObserver(() => this.fit()).observe(this.el);
    if (this.which === "claude") this.pasting();
    this.fit();
  }

  // WebGL when asked for (and it works); else the DOM.
  renderer() {
    if (!webgl() || typeof WebglAddon === "undefined") return;
    try {
      const gl = new WebglAddon.WebglAddon();
      gl.onContextLoss(() => gl.dispose());
      this.term.loadAddon(gl);
    } catch (e) { /* the DOM renderer */ }
  }

  fit() {
    if (!this.term || !this.el.offsetWidth || !this.el.offsetHeight) return;
    const d = this.fitter.proposeDimensions();
    if (d && d.cols > 1 && d.rows > 1 && (d.cols !== this.term.cols || d.rows !== this.term.rows)) this.fitter.fit();
  }

  // Wear the look again (it changed), or another font size.
  restyle() {
    if (!this.term) return;
    this.term.options.theme = termTheme();
    this.term.options.fontFamily = termFont();
    this.term.options.fontSize = this.size();
    this.term.options.macOptionIsMeta = store.get("option-meta") !== "off";
    this.fit();
  }

  size() {
    const s = this.opts.size;
    return (typeof s === "function" ? s() : s) || termSize();
  }

  async open(sid) {
    if (this.sid === sid && (this.ws || this.timer)) return;
    this.disconnect();
    this.sid = sid;
    this.exited = null;
    await this.build();
    if (this.sid === sid && !this.ws) this.connect();
  }

  connect() {
    clearTimeout(this.timer);
    this.timer = null;
    this.fit();
    const sid = this.sid;
    const q = new URLSearchParams({ cols: this.term.cols, rows: this.term.rows });
    const ws = this.ws = new WebSocket(wsURL(`/api/session/${encodeURIComponent(sid)}/tty/${this.which}?${q}`));
    ws.binaryType = "arraybuffer";
    let fresh = true;
    ws.onopen = () => { this.retry = 0; this.status(null); };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        let d = {};
        try { d = JSON.parse(e.data); } catch (err) { return; }
        if (typeof d.exit === "number") this.exited = d.exit;
        return;
      }
      // tmux draws the whole screen when it attaches: the last one's goes first.
      if (fresh) { this.term.reset(); fresh = false; }
      this.term.write(new Uint8Array(e.data));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;     // let go of on purpose
      this.ws = null;
      if (this.exited === 3) {        // the session is gone (attach said why on the screen)
        this.status("This chat was closed");
        return;
      }
      // Back as soon as it can: the network dropped, the server restarted
      // (amarchy was updated), or tmux started over.
      const wait = this.exited !== null ? 300 : Math.min(500 * 2 ** this.retry++, 8000);
      this.exited = null;
      if (wait > 600) this.status("Reconnecting…");
      this.timer = setTimeout(() => { if (this.sid === sid && !this.ws) this.connect(); }, wait);
    };
  }

  disconnect() {
    clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close();
    this.sid = null;
  }

  status(text) {
    this.statusEl.hidden = !text;
    this.statusEl.textContent = text || "";
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  control(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  focus() { if (this.term) this.term.focus(); }

  // The keys a browser would otherwise have, as a terminal sends them.
  key(e) {
    if (e.type !== "keydown") return true;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (this.which === "claude") {
      // Shift+Enter: a new line in Claude's prompt, as Alt+Enter is.
      if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        this.send(enc.encode("\x1b\r"));
        return false;
      }
      // Ctrl+V: Claude pastes an image, from this browser's clipboard.
      if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.code === "KeyV") {
        e.preventDefault();
        this.pasteFromClipboard();
        return false;
      }
    }
    return true;
  }

  // An image pasted (⌘V) or dropped on Claude: to the host, then Ctrl+V,
  // with which Claude asks for it.
  pasting() {
    const image = (list) => Array.from(list || []).find((f) => /^image\//.test(f.type));
    this.box.addEventListener("paste", (e) => {
      const item = e.clipboardData && Array.from(e.clipboardData.items).find((i) => i.kind === "file" && /^image\//.test(i.type));
      if (!item) {        // text: the terminal pastes it, and wl-paste on the host has it too
        clipText(e.clipboardData && e.clipboardData.getData("text/plain"));
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.pasteImage(item.getAsFile());
    }, true);
    this.box.addEventListener("dragover", (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
    });
    this.box.addEventListener("drop", (e) => {
      const f = e.dataTransfer && image(e.dataTransfer.files);
      if (!f) return;
      e.preventDefault();
      this.focus();
      this.pasteImage(f);
    });
  }

  async pasteFromClipboard() {
    let blob = null;
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => /^image\//.test(t));
        if (type) { blob = await item.getType(type); break; }
        if (item.types.includes("text/plain")) clipText(await (await item.getType("text/plain")).text());
      }
    } catch (e) {
      // Not allowed (or nothing to read): Claude says so, as it would there.
    }
    if (blob) await this.pasteImage(blob);
    else this.send(enc.encode("\x16"));
  }

  async pasteImage(blob) {
    try {
      const png = blob.type === "image/png" ? blob : await asPNG(blob);
      const data = await new Promise((ok, fail) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(",", 2)[1]);
        r.onerror = () => fail(new Error("couldn't read the image"));
        r.readAsDataURL(png);
      });
      await api("/api/clip", { type: "image/png", data });
      this.send(enc.encode("\x16"));
    } catch (e) {
      toast(e.message);
    }
  }
}

async function asPNG(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("couldn't read the image"))), "image/png"));
}

// What tmux copied, to your clipboard. Safari only lets a page write it
// right after a click or a key: then a click on the notice does it.
async function copyText(text) {
  clipText(text);       // the host's wl-paste has it too
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    toast("Copied in the terminal: click here to copy it here too");
    const t = document.querySelector(".toast:not(.stay)");
    if (t) {
      t.classList.add("action");
      t.addEventListener("click", () => { navigator.clipboard.writeText(text).catch(() => {}); t.remove(); }, { once: true });
    }
  }
}

// ---- the layout: a chat opened from the board, and beside it the side
// panel: its Terminal, Changes and Details

const MIN_CHAT = 440;       // the chat no narrower than this beside the side panel
const SIDE_MIN = 340;       // the side panel's narrowest
const SIDE_START = 560;     // and its width until you drag its edge
const SIDE_TABS = [["term", "Terminal", "Ctrl+Alt+→"], ["changes", "Changes", "Ctrl+Alt+G"], ["details", "Details", "Ctrl+Alt+I"]];

// Whether the terminals show (Settings → Show terminals, the host's, on
// unless it says off). Off, they're under the session's menu (Advanced), and
// asking for one by its key shows it in this window until it reloads.
function showTerminals() {
  return desk.revealed || !(app.view && app.view.show_terminals === false);
}

// The side panel's tab open now, or null: the one you left open (or closed),
// else the terminal if terminals show (as the terminal beside Claude was).
function sideTab() {
  const t = desk.sideTab === null ? (showTerminals() ? "term" : "none") : desk.sideTab;
  if (t === "none" || (t === "term" && !showTerminals())) return null;
  return SIDE_TABS.some(([k]) => k === t) ? t : null;
}

function deskStart() {
  document.body.classList.add("desk");
  desk.sideTab = store.get("desk-side") || null;
  desk.sideWidth = parseInt(store.get("desk-side-width"), 10) || SIDE_START;
  desk.terminal = makeTerminal();
  desk.changes = new DeskChanges();
  desk.details = new DeskDetails();
  desk.head = h("header", { class: "desk-head chat-head ui-bar" });
  desk.chatSlot = h("div", { class: "desk-chat" });
  desk.column = h("main", { class: "column" }, desk.head, desk.chatSlot);
  desk.side = buildSide();
  // The board (tasks.js), and over it the chat you open: the whole window,
  // its Terminal, Changes and Details beside it.
  desk.el = h("div", { class: "desk-root" }, boardBuild(), h("div", { class: "stage" }, desk.column, desk.side.el));
  root.replaceChildren(desk.el);
  // Where the keyboard is: the chat, the side panel, or a terminal in it
  // (its TermPane says so itself, paneFocused).
  desk.column.addEventListener("focusin", () => { desk.focus = "chat"; desk.focusPane = null; deskPanes(); });
  desk.side.el.addEventListener("focusin", (e) => {
    if (!e.target.closest(".term-box")) { desk.focus = "side"; desk.focusPane = null; deskPanes(); }
  });
  dropImages();
  window.addEventListener("keydown", deskKeys, true);
  window.addEventListener("keyup", deskKeysUp, true);
  window.addEventListener("keydown", typeToChat);
  window.addEventListener("resize", () => deskLayout());
  // A notification's card, tapped (chat.js answers it in its Chat): another
  // session's, and the chat goes there first.
  window.addEventListener("amarchy-ask", (e) => {
    const id = e.detail && e.detail.id;
    if (id && id !== desk.current && row(id)) go2(id);
  });
  window.addEventListener("focus", () => markSeen());
  setInterval(markSeen, 10000);
  deskLayout();
  deskRoute();
}

// The widths: the side panel (if open) as wide as you dragged it, the chat
// the rest. Short of room, the panel goes over the chat.
function deskLayout() {
  if (!desk.el) return;
  const W = window.innerWidth, tab = desk.current ? sideTab() : null;
  const wide = !!tab && desk.sideWide;
  let side = 0, over = false;
  if (tab) {
    const room = W - MIN_CHAT;
    if (wide) side = W;
    else if (room >= SIDE_MIN) side = Math.max(SIDE_MIN, Math.min(desk.sideWidth, room));
    else { over = true; side = Math.min(Math.max(desk.sideWidth, SIDE_MIN), W - 48); }
  }
  desk.el.classList.toggle("side-open", !!tab);
  desk.el.classList.toggle("side-over", over);
  desk.el.classList.toggle("side-wide", wide);
  desk.el.style.setProperty("--side", `${side}px`);
  renderSide();
  deskHead();
  requestAnimationFrame(() => { desk.terminal.fit(); if (desk.chat) desk.chat.grow(); });
}

// The panes' outlines: which one has the keyboard.
function deskPanes() {
  desk.column.classList.toggle("active", desk.focus === "chat");
  desk.side.el.classList.toggle("active", desk.focus !== "chat");
}

function paneFocused(pane) {
  if (pane) {
    desk.focus = "term";
    desk.focusPane = pane;
  }
  if (desk.el) deskPanes();
}

function row(id) { return app.view && app.view.sessions.find((s) => s.id === id) || null; }

// The address: a chat's (#/s/<id>) opens it over the board; a new chat's
// (#/new) is the box at the board's top; anything else, the board.
function deskRoute() {
  closeSheets();
  const m = here().match(/^#\/s\/(.+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (row(id)) { board.waitFor = null; show(id); }
    else if (app.view) { board.waitFor = id; boardBack(true); }      // just started: once the list has it (boardRefresh)
    return;
  }
  board.waitFor = null;
  show(null);
  if (here() === "#/new") boardCompose();
}

// The chat over the board (id), or the board (null).
function show(id) {
  if (id && app.view && !row(id)) id = null;
  const changed = id !== desk.current;
  if (changed && id && !desk.current) board.from = board.scroll.scrollTop;      // where the board was
  desk.current = id;
  desk.el.classList.toggle("chat-open", !!id);
  if (changed) {
    if (desk.chat) desk.chat.close();
    desk.chat = id ? deskChat(id) : null;
    desk.chatSlot.replaceChildren(...(desk.chat ? [desk.chat.el] : []));
    if (desk.chat) desk.chat.open();
    if (desk.revealed && !(app.view && app.view.show_terminals !== false)) desk.revealed = false;     // shown for that session
  }
  if (id) {
    if (changed) {
      board.composing = false;
      boardComposeShow();
      deskLayout();
      toChat();
      api(`/api/session/${encodeURIComponent(id)}/seen`).catch(() => {});      // opened: seen
    }
  } else {
    desk.terminal.close();
    desk.changes.close();
    desk.details.close();
    deskLayout();
    if (changed) boardShown();
  }
}

// The new chat, in that project (one just added).
function newChatIn(name) {
  newSession();
  if (desk.newChat) desk.newChat.use(name);
}

// Escape in an empty new chat: the box goes, the board stays.
function leaveNewChat() {
  board.composing = false;
  boardComposeShow();
  board.scroll.focus({ preventScroll: true });
}

// The session's chat (chat.js): its conversation, its cards, the box you
// type in, read from its stream.
function deskChat(id) {
  const chat = new Chat({
    id, row: row(id), noSwitch: true,
    onSession: (r) => { if (chat === desk.chat) { deskHead(); desk.details.sessionChanged(r); } },
    onGoal: () => { if (chat === desk.chat) deskHead(); },        // what the chat is for, under its name
    onSent: () => { if (chat === desk.chat) boardSent(id); },     // it works on it: back to the board (tasks.js)
    onGone: (why) => {
      // Closed: back to the board. Not reachable (the host restarted): again in a moment.
      if (!why) { if (chat === desk.chat) boardBack(true); return; }
      if (chat === desk.chat) setTimeout(() => { if (chat === desk.chat && !chat.closed) chat.reopen(); }, 3000);
    },
  });
  return chat;
}

function go2(id) {
  if (!id) return;
  go(`#/s/${encodeURIComponent(id)}`);
}

function markSeen() {
  if (desk.current && document.visibilityState === "visible" && document.hasFocus())
    api(`/api/session/${encodeURIComponent(desk.current)}/seen`).catch(() => {});
}

// ---- over the chat: Back to the board, its project, its name (a click:
// rename), where it stands and what it's for; the side panel's tabs,
// Complete mission and its menu

function deskHead() {
  if (!desk.head) return;
  const s = row(desk.current);
  if (!s) { desk.head.replaceChildren(); return; }
  // The chat's head (ui.js), as the phone's; its side panel's tabs in ⋯.
  keepFocus(desk.head, () => desk.head.replaceChildren(...uiChatHead(s, {
    backTitle: "Back to the board (Esc)", back: () => boardBack(), rename: () => renameSession(),
    complete: () => closeCurrent(), more: () => sessionMenu(s) })));
}

const SIDE_ICONS = { term: "run", changes: "diff", details: "info" };

// The desk's own icons, drawn as the chat's are (chat.js's icon()).
const DESK_ICONS = {
  diff: '<path d="M12 4v8M8 8h8M8 18h8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  wide: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  narrow: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
};

function deskIcon(name, cls) {
  if (!DESK_ICONS[name]) return icon(name, cls);
  return h("span", { class: `ic${cls ? ` ${cls}` : ""}`, "aria-hidden": "true",
                     html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
                           `stroke-linecap="round" stroke-linejoin="round">${DESK_ICONS[name]}</svg>` });
}

// ---- the side panel: the session's Terminal, Changes and Details, a tab
// at a time, as wide as you drag its edge (or the whole width)

function buildSide() {
  const side = {};
  side.tabs = h("div", { class: "side-tabs", role: "tablist" });
  side.body = h("div", { class: "side-body" });
  side.wideBtn = h("button", { class: "side-btn", type: "button", onclick: () => sideWide() });
  side.grip = h("div", { class: "side-grip", title: "Drag to resize; double-click: back to its width", role: "separator",
                         "aria-orientation": "vertical" });
  side.el = h("aside", { class: "sidepanel", "aria-label": "Side panel" }, side.grip,
    h("div", { class: "side-head" }, side.tabs, side.wideBtn,
      h("button", { class: "side-btn", type: "button", title: "Close the panel (Ctrl+Alt+B)", "aria-label": "Close the panel",
                    onclick: () => sideToggle(null) }, glyph("close"))),
    side.body);
  // Its edge, dragged: its width (kept in this browser).
  side.grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    side.grip.setPointerCapture(e.pointerId);
    desk.el.classList.add("resizing");
    const move = (ev) => {
      desk.sideWide = false;
      desk.sideWidth = Math.max(SIDE_MIN, Math.round(window.innerWidth - ev.clientX));
      deskLayout();
    };
    const up = () => {
      side.grip.removeEventListener("pointermove", move);
      desk.el.classList.remove("resizing");
      store.set("desk-side-width", String(desk.sideWidth));
    };
    side.grip.addEventListener("pointermove", move);
    side.grip.addEventListener("pointerup", up, { once: true });
    side.grip.addEventListener("pointercancel", up, { once: true });
  });
  side.grip.addEventListener("dblclick", () => {
    desk.sideWidth = SIDE_START;
    store.set("desk-side-width", "");
    deskLayout();
  });
  return side;
}

// The panel's tab: open it (or close the panel with null). Asked for again,
// an open tab closes, unless keep.
function sideToggle(tab, keep) {
  const now = sideTab();
  const next = tab && (tab !== now || keep) ? tab : null;
  if (now === "term" && next !== "term") releaseClassic();      // Claude's classic terminal: back to the chat
  if (next === "term" && !showTerminals()) desk.revealed = true;
  desk.sideTab = next || "none";
  if (next) desk.lastTab = next;
  if (!next) desk.sideWide = false;
  store.set("desk-side", desk.sideTab);
  deskLayout();
  // The keyboard was in what's gone (the terminal, the panel): to the chat.
  if (desk.focus !== "chat" && (!next || (desk.focus === "term" && next !== "term") || !desk.side.el.contains(document.activeElement))) toChat();
}

function sideWide(on) {
  desk.sideWide = on === undefined ? !desk.sideWide : on;
  deskLayout();
}

// What the panel shows: its tabs, and the open one's view (a view not shown
// lets go of its terminal, or stops reading).
function renderSide() {
  const side = desk.side, tab = desk.current ? sideTab() : null;
  side.tabs.replaceChildren(...SIDE_TABS.filter(([k]) => k !== "term" || showTerminals()).map(([key, label, keys]) =>
    h("button", { class: `side-tab${tab === key ? " on" : ""}`, type: "button", role: "tab", "aria-selected": String(tab === key),
                  title: `${label} (${keys})`, onclick: () => sideToggle(key, true) }, label)));
  side.wideBtn.title = desk.sideWide ? "Back beside the chat (Ctrl+Alt+F)" : "Full width (Ctrl+Alt+F)";
  side.wideBtn.setAttribute("aria-label", side.wideBtn.title);
  side.wideBtn.replaceChildren(deskIcon(desk.sideWide ? "narrow" : "wide"));
  const views = { term: desk.terminal, changes: desk.changes, details: desk.details };
  for (const [key, view] of Object.entries(views)) {
    if (key === tab && desk.current) {
      if (view.el.parentNode !== side.body) side.body.replaceChildren(view.el);
      view.open(desk.current);
    } else {
      view.close();
    }
  }
  if (!tab) side.body.replaceChildren();
  side.body.classList.toggle("fill", tab === "term");
}

// ---- the Terminal tab: the session's own terminal, and Claude's classic
// terminal (the TUI). terminal.js's SessionTerminal (C3) when it's there,
// else the same two terminals with a switch of their own.

function makeTerminal() {
  if (typeof SessionTerminal === "function")
    return new SessionTerminal({ id: null, phone: false, onShow: () => deskHead(), onBack: () => toChat() });
  return new DeskTerminal();
}

class DeskTerminal {
  constructor() {
    this.id = null;
    this.showing = "term";
    this.term = new TermPane("term");
    this.claude = new TermPane("claude");
    this.seg = h("div", { class: "seg term-switch" });
    this.el = h("div", { class: "desk-term" },
      h("div", { class: "term-bar" }, this.seg,
        h("button", { class: "control", type: "button", title: "Run the project (Ctrl+Alt+R)", onclick: () => runProject() }, glyph("send"), "Run"),
        h("button", { class: "control", type: "button", title: "Run a saved command (Ctrl+Alt+C)", onclick: () => pickCommand() }, "Commands…")),
      h("div", { class: "term-body" }, this.term.box, this.claude.box));
    this.draw();
  }

  pane() { return this.showing === "claude" ? this.claude : this.term; }
  which() { return this.showing; }

  open(id) {
    if (this.id !== id) {
      releaseClassic();
      this.id = id;
    }
    const other = this.showing === "claude" ? this.term : this.claude;
    other.disconnect();
    this.pane().open(id);
    this.draw();
  }

  close() {
    releaseClassic(this.id);
    this.term.disconnect();
    this.claude.disconnect();
    this.id = null;
  }

  show(which) {
    this.showing = which === "claude" ? "claude" : "term";
    if (this.showing !== "claude") releaseClassic(this.id);
    if (this.id) this.open(this.id);
    this.draw();
    deskHead();
  }

  // Claude's classic terminal: held on while it shows (terminal.js), the
  // same conversation.
  async classic() {
    const s = row(this.id);
    if (!(await holdClassic(this.id, s && s.engine))) return;
    this.show("claude");
  }

  draw() {
    const s = row(this.id);
    this.seg.replaceChildren(...[["term", "Project terminal"], ["claude", "Claude's classic terminal"]].map(([k, label]) =>
      h("button", { class: `control${this.showing === k ? " on" : ""}`, type: "button", onclick: () => { this.show(k); this.focus(); } }, label)));
    this.term.box.hidden = this.showing !== "term";
    this.claude.box.hidden = this.showing !== "claude";
  }

  fit() { this.pane().fit(); }
  restyle() { this.term.restyle(); this.claude.restyle(); }
  focus() { this.pane().focus(); }
}

// ---- the Changes tab: everything the session changed (its worktree
// against where its branch left its base), file by file, side by side
// where it's wide enough

const SPLIT_AT = 760;       // the panel's width from which a diff goes side by side
const BIG_FILE = 1500;      // lines: a file this big starts folded

class DeskChanges {
  constructor() {
    this.el = h("div", { class: "changes" });
    this.id = null;
    this.data = null;
    this.layout = store.get("diff-layout") || "auto";      // auto, split, stacked
    new ResizeObserver(() => { if (this.data && this.split() !== this.drawnSplit) this.draw(); }).observe(this.el);
  }

  open(id) {
    if (id !== this.id) {
      this.id = id;
      this.data = null;
      this.sig = null;
      this.folded = new Set();
      this.opened = new Set();
      this.el.replaceChildren(h("div", { class: "side-note" }, "Reading the changes…"));
    }
    if (!this.timer) { this.load(); this.tick(); }
  }

  close() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  // Read again: every few seconds while Claude works, now and then while not.
  tick() {
    clearTimeout(this.timer);
    const s = row(this.id);
    this.timer = setTimeout(() => {
      if (document.visibilityState === "visible") this.load();
      this.tick();
    }, s && s.status === "working" ? 4000 : 15000);
  }

  async load() {
    const id = this.id;
    try {
      const r = await fetch(`/api/session/${encodeURIComponent(id)}/changes`);
      const d = await r.json();
      if (id !== this.id) return;
      if (!r.ok) throw new Error(d.error || "Couldn't read the changes");
      if (this.data && d.sig === this.data.sig) return;
      this.data = d;
      this.draw();
    } catch (e) {
      if (id === this.id && !this.data)
        this.el.replaceChildren(h("div", { class: "side-note" }, e instanceof TypeError ? "Can't reach Amarchy" : e.message));
    }
  }

  split() {
    return this.layout === "split" || (this.layout === "auto" && this.el.clientWidth >= SPLIT_AT);
  }

  draw() {
    const d = this.data;
    const scroller = this.el.parentNode;
    const top = scroller ? scroller.scrollTop : 0;
    this.drawnSplit = this.split();
    const files = d.files || [];
    const kids = [];
    const summary = files.length
      ? h("div", { class: "changes-sum" }, h("b", {}, `${files.length}${d.more ? `+${d.more}` : ""} file${files.length === 1 ? "" : "s"} changed`),
          diffChip(files) || null)
      : h("div", { class: "changes-sum" }, h("b", {}, "No changes yet"));
    const layoutSeg = h("div", { class: "seg diff-layout" }, ...[["auto", "Auto"], ["split", "Side by side"], ["stacked", "Stacked"]].map(([k, label]) =>
      h("button", { class: `control${this.layout === k ? " on" : ""}`, type: "button", onclick: () => {
        this.layout = k;
        store.set("diff-layout", k === "auto" ? "" : k);
        this.draw();
      } }, label)));
    kids.push(h("div", { class: "changes-head" }, summary,
      h("div", { class: "changes-since" }, `Since it left ${d.base || "its base"}${d.since ? ` (${d.since.slice(0, 7)})` : ""}, committed or not`),
      files.length ? layoutSeg : null));
    if (d.commits && d.commits.length)
      kids.push(h("details", { class: "changes-commits" },
        h("summary", {}, `${d.commits.length} commit${d.commits.length === 1 ? "" : "s"} on its branch`),
        ...d.commits.map((c) => h("div", { class: "commit" }, h("code", {}, c.sha), h("span", {}, c.subject),
                                  h("span", { class: "age" }, ago(c.at))))));
    if (files.length) {
      const index = h("div", { class: "changes-index" });
      for (const f of files) index.append(h("button", { class: "file-row", type: "button", title: f.path,
          onclick: () => { this.folded.delete(f.path); this.opened.add(f.path); this.draw(); this.reveal(f.path); } },
        h("span", { class: `badge ${f.status}` }, STATUS_WORD[f.status] || f.status),
        h("span", { class: "name" }, baseName(f.path)), h("span", { class: "dir" }, dirOf(f.path)), diffChip([f])));
      kids.push(index);
      for (const f of files) kids.push(this.file(f));
    }
    this.el.replaceChildren(...kids);
    if (scroller) scroller.scrollTop = top;
  }

  reveal(path) {
    const el = Array.from(this.el.querySelectorAll(".change")).find((x) => x.dataset.path === path);
    if (el) el.scrollIntoView({ block: "start" });
  }

  // One file: its name, what happened to it, and its lines (folded if huge).
  file(f) {
    const lines = (f.hunks || []).reduce((n, hk) => n + hk.lines.length, 0);
    const folded = this.folded.has(f.path) || (lines > BIG_FILE && !this.opened.has(f.path));
    const head = h("button", { class: "change-head", type: "button", "aria-expanded": String(!folded), onclick: () => {
      if (folded) { this.folded.delete(f.path); this.opened.add(f.path); } else { this.folded.add(f.path); this.opened.delete(f.path); }
      this.draw();
    } }, icon("chevron", "chev"), h("span", { class: `badge ${f.status}` }, STATUS_WORD[f.status] || f.status),
      h("span", { class: "name" }, baseName(f.path)),
      h("span", { class: "dir" }, f.old_path ? `from ${f.old_path}` : dirOf(f.path)), diffChip([f]));
    const box = h("section", { class: `change${folded ? " folded" : ""}`, "data-path": f.path }, head);
    if (folded) return box;
    if (f.binary) box.append(h("div", { class: "side-note" }, "A binary file: not shown"));
    else if (!lines) box.append(h("div", { class: "side-note" }, f.status === "renamed" ? "Moved, unchanged" : "An empty file"));
    else box.append(this.split() ? splitDiff(f) : stackedDiff(f));
    if (f.cut) box.append(h("div", { class: "side-note" }, "The rest of this file's changes isn't shown here"));
    return box;
  }
}

const STATUS_WORD = { added: "New", untracked: "New", modified: "Edited", deleted: "Deleted", renamed: "Moved" };

function dirOf(p) {
  const s = String(p || "");
  return s.includes("/") ? s.slice(0, s.lastIndexOf("/")) : "";
}

function ago(t) {
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// A file's lines one under the other (the chat's diff, chat.js).
function stackedDiff(f) {
  const view = diffView([{ ...f, created: false }]);
  return view.querySelector(".diff-lines");
}

// A file's lines side by side: what it was on the left, what it is on the
// right, each change's removed lines beside the lines that replaced them.
function splitDiff(f) {
  const body = h("div", { class: "diff-lines split" });
  const cell = (cls, n, sg, text) => [h("span", { class: `ln ${cls}` }, n === null ? "" : String(n)),
                                      h("span", { class: `tx ${cls}` }, sg ? h("span", { class: "sg" }, sg) : null, text)];
  let drawn = 0;
  const more = [];
  const put = (els) => { if (drawn++ < DIFF_SHOWN) body.append(...els); else more.push(...els); };
  (f.hunks || []).forEach((hk, n) => {
    if (n) put([h("span", { class: "gap" }, "⋯")]);
    let o = typeof hk.old === "number" ? hk.old : null, w = typeof hk.new === "number" ? hk.new : null;
    const ls = hk.lines || [];
    for (let i = 0; i < ls.length;) {
      if (ls[i][0] !== "-" && ls[i][0] !== "+") {
        const t = ls[i].slice(1) || " ";
        put([...cell("ctx", o, "", t), ...cell("ctx", w, "", t)]);
        if (o !== null) o++;
        if (w !== null) w++;
        i++;
        continue;
      }
      const dels = [], adds = [];
      while (i < ls.length && ls[i][0] === "-") dels.push(ls[i++].slice(1));
      while (i < ls.length && ls[i][0] === "+") adds.push(ls[i++].slice(1));
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        const left = k < dels.length ? cell("del", o === null ? null : o++, "−", dels[k] || " ") : cell("none", null, "", "");
        const right = k < adds.length ? cell("add", w === null ? null : w++, "+", adds[k] || " ") : cell("none", null, "", "");
        put([...left, ...right]);
      }
    }
  });
  if (more.length) {
    const btn = h("button", { class: "diff-more", type: "button", onclick: () => btn.replaceWith(...more) },
                  `Show ${Math.ceil(more.length / 4)} more lines`);
    body.append(btn);
  }
  return body;
}

// ---- the Details tab: where the session works, how its Claude runs, and
// what runs in the background

// "claude-opus-5-5[1m]": "Opus 5.5 (1M context)".
function modelWords(id) {
  const m = String(id || "").match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i);
  if (!m) return id || "";
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}${m[4] ? " (1M context)" : ""}`;
}

class DeskDetails {
  constructor() {
    this.el = h("div", { class: "details" });
    this.id = null;
    this.data = null;
  }

  open(id) {
    if (id !== this.id) {
      this.id = id;
      this.data = null;
      this.el.replaceChildren(h("div", { class: "side-note" }, "Reading…"));
    }
    if (!this.timer) { this.load(); this.tick(); }
  }

  close() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  tick() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (document.visibilityState === "visible") this.load();
      this.tick();
    }, 10000);
  }

  // The session's row changed (its engine, its state): read again, soon.
  sessionChanged(r) {
    if (!this.timer || !r || r.id !== this.id) return;
    const key = `${r.engine}|${r.status}|${r.sleeping}|${r.background}`;
    if (key === this.rowKey) return;
    this.rowKey = key;
    clearTimeout(this.soon);
    this.soon = setTimeout(() => this.load(), 600);
  }

  async load() {
    const id = this.id;
    try {
      const r = await fetch(`/api/session/${encodeURIComponent(id)}/details`);
      const d = await r.json();
      if (id !== this.id) return;
      if (!r.ok) throw new Error(d.error || "Couldn't read it");
      if (this.data && JSON.stringify(d) === JSON.stringify(this.data)) return;
      this.data = d;
      this.draw();
    } catch (e) {
      if (id === this.id && !this.data)
        this.el.replaceChildren(h("div", { class: "side-note" }, e instanceof TypeError ? "Can't reach Amarchy" : e.message));
    }
  }

  draw() {
    const d = this.data, s = row(this.id) || {};
    const item = (label, value, extra) => value === undefined || value === null || value === "" ? null
      : h("div", { class: "kv" }, h("span", { class: "k" }, label), h("span", { class: "v" }, value, extra || null));
    const copy = (text) => h("button", { class: "text-btn", type: "button", onclick: () => copyText(text).then(() => toast("Copied")) }, "Copy");
    const chat = d.engine === "chat";
    const live = d.live || {};
    const kids = [
      h("div", { class: "section" }, "Where it works"),
      item("Project", projectName(d.repo)),
      item("Branch", h("code", {}, d.branch || d.name || "")),
      item("Made from", d.base ? h("code", {}, d.base) : null,
           d.ahead !== undefined ? h("span", { class: "muted" }, ` · ${d.ahead} commit${d.ahead === 1 ? "" : "s"} ahead, ${d.behind} behind`) : null),
      item("Not committed", d.uncommitted !== undefined ? (d.uncommitted ? `${d.uncommitted} file${d.uncommitted === 1 ? "" : "s"}` : "Nothing") : null),
      item("Last commit", d.head && d.head[1] ? h("span", {}, h("code", {}, d.head[0]), ` ${d.head[1]}`) : null),
      item("Worktree", h("code", { class: "path" }, d.path), copy(d.path)),
      h("div", { class: "section" }, "Claude"),
      // The model and the mode, changed in the composer's own menus (chat.js).
      h("div", { class: "kv-hook", "data-hook": "model-mode" },
        item("Model", d.model ? modelWords(d.model) : "As Claude Code's default", pillButton("model")),
        item("Mode", d.mode ? (MODE_WORDS[d.mode] || { label: d.mode }).label : "As Claude Code's default", chat ? pillButton("mode") : null)),
      item("State", statusWords(s)),
    ];
    if (chat) {
      const lim = (live.rate_limits && live.rate_limits.unifiedWindows) || {};
      const use = (w, label) => w && typeof w.utilization === "number"
        ? item(label, `${Math.round(w.utilization * 100)}% used`, w.resetsAt ? h("span", { class: "muted" }, ` · resets ${when(w.resetsAt)}`) : null) : null;
      kids.push(use(lim.five_hour, "Plan, 5 hours"), use(lim.seven_day, "Plan, this week"),
        live.turns ? item("This run", `${live.turns} turn${live.turns === 1 ? "" : "s"}${live.cost_usd ? ` · $${live.cost_usd.toFixed(2)} at API prices` : ""}`) : null);
    }
    const tasks = Array.isArray(live.tasks) ? live.tasks : [];
    const bg = d.background || [];
    kids.push(h("div", { class: "section" }, "In the background"));
    if (!tasks.length && !bg.length) kids.push(h("div", { class: "side-note left" }, "Nothing runs in the background."));
    for (const t of tasks)
      kids.push(h("div", { class: "bg-row" }, icon("clock"), h("span", { class: "what" }, cut(t.description || t.summary || t.command || t.task_id || t.id || "A task", 90)),
                  t.status ? h("span", { class: "muted" }, t.status) : null));
    for (const b of bg)
      kids.push(h("div", { class: "bg-row" }, icon("helper"), h("span", { class: "what" }, `Background task ${b.name}`),
                  h("span", { class: "muted" }, [b.status, b.started ? `since ${ago(b.started)}` : ""].filter(Boolean).join(" · "))));
    kids.push(h("div", { class: "section" }, "Ids"),
      item("Chat id", h("code", {}, d.id)),
      item("Conversation", d.conversation ? h("code", {}, d.conversation) : null));
    this.el.replaceChildren(...kids.filter(Boolean));
  }
}

// Details' Change: the composer's model or mode menu, over the chat's box.
function pillButton(which) {
  return h("button", { class: "text-btn", type: "button", onclick: () => {
    if (desk.chat && desk.chat.dock.contains(desk.chat.box)) desk.chat.openMenu(which);
    else toast("Answer what Claude asks first");
  } }, "Change");
}

function when(t) {
  const d = new Date(t * 1000);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
               : d.toLocaleDateString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

// ---- the chat's keys on a computer

// Typing with the keyboard nowhere in particular: into the box you type in.
function typeToChat(e) {
  const c = desk.chat;
  // No chat: the new chat's box, when it's there.
  const fresh = !c && board.composing && desk.newChat && desk.newChat.el.isConnected ? desk.newChat : null;
  if ((!c && !fresh) || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return;
  const at = document.activeElement;
  if (at && at !== document.body && (at.matches("input, textarea, [contenteditable], select") || at.closest(".term-box, .sheet-back, .picker-back, .card")))
    return;
  if (e.key === " " && at && at.matches("button, a, summary, [role]")) return;     // Space presses what's focused
  if (fresh) return fresh.focus();
  if (!c.dock.contains(c.input)) return;      // a card's up: its keys are its own
  c.input.focus({ preventScroll: true });
}

// A picture or file dropped on the chat goes with your message (chat.js's
// composer: the chat takes the drops on it, this the rest of the column).
function dropImages() {
  desk.column.addEventListener("dragover", (e) => {
    if (desk.chat && e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault();
      desk.column.classList.add("dropping");
    }
  });
  desk.column.addEventListener("dragleave", (e) => { if (!desk.column.contains(e.relatedTarget)) desk.column.classList.remove("dropping"); });
  desk.column.addEventListener("drop", (e) => {
    desk.column.classList.remove("dropping");
    if (e.defaultPrevented || !desk.chat) return;
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (!files.length) return;
    e.preventDefault();
    desk.chat.addFiles(files);
    desk.chat.input.focus();
  });
}

// The keyboard to the chat: its card if it asks something, else the box.
function toChat() {
  const c = desk.chat;
  if (!c) return;
  const card = c.dock.querySelector(".card");
  if (card) (menuStart(card) || card).focus({ preventScroll: true });
  else c.input.focus({ preventScroll: true });
  desk.focus = "chat";
  desk.focusPane = null;
  deskPanes();
}

// Where the keyboard goes back to (a sheet or menu closed): where it was.
function deskRefocus() {
  if (!desk.current) return boardRefocus();      // the card the keys were on (tasks.js)
  if (desk.focus === "term" && sideTab() === "term") desk.terminal.focus();
  else toChat();
}

// The look changed: the terminals wear it again.
function deskRestyle() {
  if (desk.terminal) desk.terminal.restyle();
}

// The list changed (app.js's events): the chat open (closed: the board),
// the window's title, and the chime for a session that went on to need you
// or finished.
function deskList() {
  if (!desk.el) return;
  const v = app.view;
  if (v && desk.current && !row(desk.current)) return boardBack(true);     // closed
  chime(v);
  const waiting = !v ? 0 : typeof v.needs === "number" ? v.needs : v.sessions.filter((s) => s.status === "waiting").length;
  document.title = waiting ? `(${waiting}) Amarchy` : "Amarchy";
  // Show terminals turned on or off: the panel and the header follow.
  const shows = showTerminals();
  if (shows !== desk.shows) { desk.shows = shows; deskLayout(); } else deskHead();
}

// The chime this page plays when a session needs you or is done (the one
// you're looking at only when this window isn't), as amarchy alerts lets the
// others: your assistant's always, with its own chime.
let chimeAudio = null;
function chime(v) {
  if (!v) return;
  const now = Object.fromEntries(v.sessions.map((s) => [s.id, s.status]));
  const was = desk.statuses;
  desk.statuses = now;
  if (!was) return;
  const rings = v.sessions.filter((s) => {
    const prev = was[s.id];
    if (!prev || prev === s.status) return false;
    const done = s.status === "idle" && prev === "working";
    if (!(s.status === "waiting" || done)) return false;
    if (s.id === desk.current && document.hasFocus()) return false;
    if (s.assistant === "main") return true;
    const alerts = v.alerts || "needs-you";
    return alerts === "all" || (alerts === "needs-you" && s.status === "waiting");
  });
  if (!rings.length) return;
  const sound = rings.some((s) => s.assistant === "main") ? v.assistant_sound || "herald" : v.sound || "kalimba";
  if (sound === "off") return;
  const src = `/sound/${encodeURIComponent(sound)}`;
  if (!chimeAudio || !chimeAudio.src.endsWith(src)) chimeAudio = new Audio(src);
  chimeAudio.currentTime = 0;
  chimeAudio.play().catch(() => { /* not until you've clicked the page once */ });
}

// ---- Go to a chat (Ctrl+Alt+A): every chat, by its name, its project or
// where it stands, a few keys away

function chatPicker() {
  const v = app.view;
  if (!v) return;
  const ss = v.sessions.filter((s) => !s.setup && !todayUI.closing.has(s.id));
  picker({ title: "Go to a chat", placeholder: "Its name or project", items: ss.map((s) => ({
    label: s.assistant === "main" ? s.assistant_name || "Assistant" : s.task || "New chat",
    detail: [projectName(s.repo), statusWords(s)].filter(Boolean).join(" · "),
    icon: s.id === desk.current ? "check" : s.status === "waiting" ? "waiting" : "project",
    act: () => boardOpen(s.id) })) });
}

// ---- the keys: amarchy's, Ctrl+Alt+… (Super is the browser's or the Mac's)

const DESK_KEYS = {
  KeyJ: () => step(1), KeyK: () => step(-1),
  KeyS: () => deskSearch(), KeyA: () => chatPicker(),
  ArrowLeft: () => toChat(), ArrowRight: () => toTerminal(),
  KeyG: () => desk.current && sideToggle("changes"), KeyI: () => desk.current && sideToggle("details"),
  KeyB: () => desk.current && toggleSide(), KeyF: () => desk.current && sideTab() && sideWide(),
  KeyL: () => classicTerminal(),
  KeyR: () => runProject(), KeyC: () => pickCommand(),
  KeyN: () => newSession(), KeyP: () => newProject(), KeyT: () => openLook(), KeyH: () => boardBack(),
  ArrowUp: () => keyedId() && setPriority(row(keyedId()), "up"),
  ArrowDown: () => keyedId() && setPriority(row(keyedId()), "down"),
  KeyE: () => renameSession(), KeyM: () => deskMenu(), KeyX: () => closeCurrent(),
};

function deskKeys(e) {
  if (!(e.ctrlKey && e.altKey) || e.metaKey) return;
  if (TALK_KEYS.includes(e.code)) return talkKey(e);
  const act = DESK_KEYS[e.code];
  if (!act) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.repeat && !["KeyJ", "KeyK"].includes(e.code)) return;
  document.querySelectorAll(".picker-back").forEach((p) => p.close && p.close());
  act();
}

// Ctrl+Alt+Space or Ctrl+Alt+Enter: dictate into the chat's box, held as its
// mic is (let go and it's written down), or tapped (it listens until tapped
// again).
const TALK_KEYS = ["Space", "Enter", "NumpadEnter"];

function talkKey(e) {
  e.preventDefault();
  e.stopPropagation();
  const c = desk.chat;
  const fresh = !c && desk.newChat && desk.newChat.el.isConnected ? desk.newChat : null;     // into the new chat's box
  if (e.repeat || (!fresh && (!c || !c.dock.contains(c.input)))) return;
  const t = fresh ? fresh.dictate : c.talk;
  if (t.locked) { t.stop(); return; }
  if (t.run || !t.available()) { if (!t.available()) toast("No dictation here: see Settings"); return; }
  if (fresh) fresh.focus(); else c.input.focus({ preventScroll: true });
  desk.talkDown = e.timeStamp;
  desk.talkCode = e.code;
  t.start();
}

function deskKeysUp(e) {
  if (e.code !== desk.talkCode || desk.talkDown === undefined || desk.talkDown === null) return;
  const c = desk.chat, fresh = !c && desk.newChat && desk.newChat.el.isConnected ? desk.newChat : null;
  const t = fresh ? fresh.dictate : c && c.talk;
  const tapped = e.timeStamp - desk.talkDown < DICTATE_TAP;
  desk.talkDown = null;
  if (!t || !t.run) return;
  e.preventDefault();
  if (tapped && t.run.held) {       // tapped: listening until tapped again, as the mic does
    t.locked = true;
    t.say(`Listening… ${e.code === "Space" ? "Ctrl+Alt+Space" : "Ctrl+Alt+Enter"} again when you're done`);
    (fresh ? fresh.dictate.opts.button : c.micBtn).classList.add("on");
    return;
  }
  t.stop();
}

// Ctrl+Alt+J / K: the next chat, in the board's order (tasks.js).
function step(n) { boardStep(n); }

// Ctrl+Alt+S: the board's search.
function deskSearch() {
  if (desk.current) boardBack(true);
  board.search.focus();
  board.search.select();
}

// The side panel closed, or back on the tab it had.
function toggleSide() {
  if (sideTab()) return sideToggle(null);
  const last = desk.lastTab || (showTerminals() ? "term" : "changes");
  sideToggle(last, true);
}

// The session's terminal, in the side panel, with the keyboard.
function toTerminal(which) {
  if (!desk.current) return;
  sideToggle("term", true);
  if (which && desk.terminal.which && desk.terminal.which() !== which) desk.terminal.show(which);
  requestAnimationFrame(() => desk.terminal.focus());
}

// Claude's classic terminal (the TUI) in the side panel, a chat-engine
// session switched back onto it; asked again, back to the project's terminal.
// Claude's classic terminal is for when Show terminals is on (the host's setting).
function classicAllowed() {
  return !!(app.view && app.view.show_terminals);
}

function classicTerminal() {
  if (!desk.current || !classicAllowed()) return;
  const t = desk.terminal;
  if (sideTab() === "term" && t.which && t.which() === "claude") return toTerminal("term");
  sideToggle("term", true);
  t.classic();
  requestAnimationFrame(() => t.focus());
}

// ---- pickers: a menu card, for everything amarchy asks

// items: [{label, detail, icon, key, group (a function giving items), act,
// keep}], or text (a field to type in, value its start). Typing filters;
// ↑/↓ move, ↵ picks, → opens a group, ← and Esc go back.
function picker(opts) {
  const stack = [];
  const input = h("input", { type: "text", autocomplete: "off", spellcheck: "false" });
  const list = h("div", { class: "picker-list" });
  const titleEl = h("div", { class: "picker-title" });
  const shut = h("button", { class: "picker-close", "aria-label": "Close", title: "Close (Esc)", tabindex: "-1", onclick: () => close() }, glyph("close"));
  const card = h("div", { class: "picker", role: "dialog" }, h("div", { class: "picker-top" }, titleEl, shut),
    h("label", { class: "picker-input" }, input), list);
  const back = h("div", { class: "picker-back", onpointerdown: (e) => { if (e.target === back) close(); } }, card);
  let level, items = [], at = 0;
  const close = back.close = () => {
    back.remove();
    deskRefocus();
  };
  const enter = (o) => {
    level = o;
    titleEl.textContent = o.title || "";
    titleEl.hidden = !o.title;
    input.value = o.value || "";
    input.placeholder = o.placeholder || (o.text ? "" : "Search");
    at = 0;
    draw();
    input.focus();
  };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const all = typeof level.items === "function" ? level.items(input.value) : (level.items || []);
    items = level.text ? all : all.filter((it) => !q || `${it.label} ${it.detail || ""}`.toLowerCase().includes(q) || it.always);
    at = Math.min(at, Math.max(items.length - 1, 0));
    list.replaceChildren(...items.map((it, i) => h("button", {
      class: `picker-row${i === at ? " on" : ""}${it.danger ? " danger" : ""}`,
      onmousemove: () => { if (at !== i) { at = i; draw(); } }, onclick: () => pick(it) },
    it.icon ? glyph(it.icon, "icon") : h("span", { class: "icon" }),
    h("span", { class: "label" }, it.label, it.detail ? h("small", {}, it.detail) : null),
    it.group ? h("span", { class: "chev" }, "›") : it.key && i === at ? h("span", { class: "key" }, it.key) : null)));
    if (level.text && !items.length) list.replaceChildren(h("div", { class: "picker-note" }, level.note || "↵ to go on, Esc to cancel"));
    const on = list.querySelector(".on");
    if (on) on.scrollIntoView({ block: "nearest" });
  };
  const pick = async (it) => {
    if (it.group) {
      stack.push(level);
      return enter({ ...await it.group(), back: true });
    }
    if (!it.keep) close();
    if (it.act) it.act(input.value);
  };
  input.addEventListener("input", () => { at = 0; draw(); });
  input.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.altKey) return;       // amarchy's keys (it closes)
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "j")) { e.preventDefault(); at = Math.min(at + 1, items.length - 1); draw(); }
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "k")) { e.preventDefault(); at = Math.max(at - 1, 0); draw(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (level.text && (!items.length || e.shiftKey)) { const v = input.value; close(); level.act(v); }
      else if (items[at]) pick(items[at]);
    } else if (e.key === "ArrowRight" && items[at] && items[at].group && !input.value) { e.preventDefault(); pick(items[at]); }
    else if ((e.key === "ArrowLeft" && !input.value) || e.key === "Escape") {
      e.preventDefault();
      if (stack.length) enter(stack.pop());
      else close();
    }
  });
  document.querySelectorAll(".picker-back").forEach((p) => p.close());
  document.body.append(back);
  enter(opts);
  return back;
}

function ask(title, value, act, opts) {
  return picker({ title, text: true, value: value || "", act, ...(opts || {}) });
}

// ---- what the keys do

// The new chat, in the middle: "What do you want to do?" (drawEmpty).
function newSession() {
  boardCompose();       // at the top of the board (tasks.js)
}

// A project: one of your GitHub repos, a git URL, or an empty one.
async function newProject() {
  let repos = null;
  const load = fetch("/api/github").then((r) => r.json()).then((d) => { repos = d.repos || []; }).catch(() => { repos = []; });
  const items = (typed) => {
    const t = typed.trim();
    const out = [];
    if (/^(https?:\/\/|git@|ssh:\/\/)\S+$/.test(t) || /^[\w.-]+\/[\w.-]+$/.test(t))
      out.push({ label: `Add ${t}`, icon: "plus", always: true, act: () => addProject({ repo: t }) });
    out.push({ label: "Empty project…", icon: "plus", always: true, act: () => emptyProject(t) });
    if (repos === null) out.push({ label: "Your GitHub repos…", detail: "loading", always: true, keep: true });
    for (const r of repos || []) if (!r.added)
      out.push({ label: r.name, detail: r.private ? "private" : "", icon: "project", act: () => addProject({ repo: r.name }) });
    return out;
  };
  const p = picker({ title: "New project", placeholder: "A GitHub repo, or paste a git URL", items });
  await load;
  if (document.body.contains(p)) p.querySelector("input").dispatchEvent(new Event("input"));
}

function emptyProject(name) {
  ask("Name of the new project", name.replace(/[^\w.-]/g, "-"), async (n) => {
    if (!n.trim()) return;
    // A GitHub repo too only where GitHub is connected: else it's just here, with no question.
    const connected = await fetch("/api/github").then((r) => r.json()).then((d) => Array.isArray(d.repos)).catch(() => false);
    if (!connected) return addProject({ new: n.trim() });
    picker({ title: `${n.trim()}: also on GitHub?`, items: [
      { label: "Only on this server", act: () => addProject({ new: n.trim() }) },
      { label: "On this server, and a private GitHub repo", act: () => addProject({ new: n.trim(), github: true }) }] });
  });
}

async function addProject(body) {
  toast("Adding the project…");
  try {
    const d = await api("/api/add", body);
    const name = (body.new || d.name || body.repo.split("/").pop()).replace(/\.git$/, "");
    const known = ((app.view && app.view.projects) || []).map((p) => p.name);
    toast(`${name} is one of your projects now`);
    newChatIn(known.includes(name) ? name : (d.name || name));
  } catch (e) {
    toast(e.message);
  }
}

// The chat the keys act on (rename, priority, close, the menu's This chat):
// the one open, else the card the keyboard is on.
function keyedId() {
  if (desk.current) return desk.current;
  const t = document.activeElement && document.activeElement.closest(".ticket, .tcard[data-id]");
  return t ? t.dataset.id : null;
}

// What needs a chat open (Run, its commands): from the board, the card the
// keyboard is on opens first, its terminal beside it.
function needsChat(again) {
  if (desk.current) return false;
  const id = keyedId();
  if (!id) { toast("Open a chat first"); return true; }
  boardOpen(id);
  setTimeout(again, 300);
  return true;
}

function renameSession() {
  const s = row(keyedId());
  if (!s) return;
  picker({ title: `Name for ${s.task || where(s)}`, text: true, value: s.title || "",
           note: "↵ names it; empty, it goes back to Claude's title",
           act: async (t) => {
             try {
               await api(`/api/session/${encodeURIComponent(s.id)}/rename`, t.trim() ? { title: t.trim() } : { reset: true });
             } catch (e) { toast(e.message); }
           } });
}

const LEVELS = ["low", "normal", "high"];
async function setPriority(s, dir) {
  if (!s) return;
  const at = LEVELS.indexOf(s.priority || "normal");
  const level = LEVELS[Math.max(0, Math.min(2, at + (dir === "up" ? 1 : -1)))];
  if (level === (s.priority || "normal")) return toast(`${PRIORITY[level]} priority already`);
  try {
    await api(`/api/session/${encodeURIComponent(s.id)}/priority`, { level });
    toast(`${s.task || s.name}: ${PRIORITY[level]} priority`);
  } catch (e) { toast(e.message); }
}

async function closeCurrent() {
  const s = row(keyedId());
  if (!s) return;
  // At once with Undo when nothing would be lost (today.js).
  if (s.assistant === "main") return toast("Your assistant stays: it isn't closed");
  if (desk.current === s.id) boardBack(true);
  todayClose(s);
}

async function runProject(name) {
  if (needsChat(() => runProject(name))) return;
  const s = row(desk.current);
  if (!s) return;
  try {
    await api(`/api/session/${encodeURIComponent(s.id)}/run`, name ? { name } : {});
    toTerminal("term");
  } catch (e) {
    if (/No run command/.test(e.message))
      return ask(`Run command for ${projectName(s.repo)}`, "", async (cmd) => {
        if (!cmd.trim()) return;
        try {
          await api(`/api/session/${encodeURIComponent(s.id)}/commands`, { name: "run", command: cmd.trim() });
          runProject();
        } catch (err) { toast(err.message); }
      }, { note: "↵ saves it for the project and runs it (amarchy run --set)" });
    toast(e.message);
  }
}

async function pickCommand() {
  if (needsChat(() => pickCommand())) return;
  const s = row(desk.current);
  if (!s) return;
  let cmds = [];
  try {
    const r = await fetch(`/api/session/${encodeURIComponent(s.id)}/commands`);
    cmds = (await r.json()).commands || [];
  } catch (e) { return toast("Can't reach Amarchy"); }
  picker({ title: `Run in ${projectName(s.repo)}`, items: [
    ...cmds.map((c) => ({ label: c.name, detail: c.command, icon: "send", act: () => runProject(c.name) })),
    { label: "Save a new command…", icon: "plus", always: true, act: () => saveCommand(s) }] });
}

function saveCommand(s) {
  ask("Name for the command", "", (name) => {
    if (!/^[\w.-]{1,40}$/.test(name.trim())) return toast("A short name: letters, numbers, - and .");
    ask(`Command for ${name.trim()}`, "", async (cmd) => {
      if (!cmd.trim()) return;
      try {
        await api(`/api/session/${encodeURIComponent(s.id)}/commands`, { name: name.trim(), command: cmd.trim() });
        runProject(name.trim());
      } catch (e) { toast(e.message); }
    });
  });
}

// The Amarchy menu (the Ⓐ, m on the board, Ctrl+Alt+M): everything you
// can do from here, each with its key. A keyboard's card on a computer, a
// sheet on the phone (ui.js uiMenu); what needs keys or a chat open, on a
// computer only.
function deskMenu() {
  const s = app.desk ? row(keyedId()) : null;
  uiMenu("Amarchy", [
    { label: "New chat", icon: "plus", key: app.desk ? "N" : "", act: () => boardCompose() },
    { label: "Group & sort…", icon: "organize", key: "O", act: () => organizeSheet() },
    { label: "Go to a chat…", icon: "project", key: "Ctrl+Alt+A", desk: true, act: () => chatPicker() },
    desk.current ? { label: "Back to the board", icon: "back", key: "Esc", desk: true, act: () => boardBack() } : null,
    s && desk.current ? { label: "View", icon: "status", desk: true, group: () => ({ title: "View", items: viewItems() }) } : null,
    s && desk.current ? { label: "Run", icon: "send", desk: true, group: () => ({ title: "Run", items: [
      { label: "Run the project", key: "Ctrl+Alt+R", act: () => runProject() },
      { label: "Run a command…", key: "Ctrl+Alt+C", act: () => pickCommand() },
      { label: "Saved commands…", detail: "change, forget", act: () => commandsSheet(s, () => toTerminal("term")) },
      { label: "The terminal", key: "Ctrl+Alt+→", act: () => toTerminal("term") }] }) } : null,
    s && desk.current ? { label: "This chat", icon: "more", desk: true, group: () => ({ title: s.task || where(s), items: sessionItems(s) }) } : null,
    { label: "Automations", icon: "clock", detail: autoState.failed ? `${autoState.failed} failed last time` : "what runs by itself", act: () => automationsSheet() },
    { label: "Theme, font and wallpaper…", icon: "image", key: "Ctrl+Alt+T", act: () => openLook() },
    { label: "Sound…", icon: "status", detail: "the chimes", act: () => soundSheet(false) },
    { label: "New project…", icon: "plus", key: "Ctrl+Alt+P", act: () => (app.desk ? newProject() : newProjectSheet()) },
    { label: "Settings", icon: "gear", act: () => openSettings() },
    { label: "Keys", icon: "keys", key: "?", desk: true, act: () => showKeys() },
  ]);
}

// What the window shows: the chat, the side panel's tabs, its width.
function viewItems() {
  const tab = sideTab(), on = (x) => (x ? "on" : "");
  return [
    { label: "The chat", key: "Ctrl+Alt+←", act: () => toChat() },
    ...(showTerminals() ? [
      { label: "Terminal", detail: on(tab === "term"), key: "Ctrl+Alt+→", act: () => toTerminal("term") },
      { label: "Claude's classic terminal", detail: "Claude Code's own, same conversation", key: "Ctrl+Alt+L", act: () => classicTerminal() }] : []),
    { label: "Changes", detail: on(tab === "changes"), key: "Ctrl+Alt+G", act: () => sideToggle("changes", true) },
    { label: "Details", detail: on(tab === "details"), key: "Ctrl+Alt+I", act: () => sideToggle("details", true) },
    { label: tab ? "Close the side panel" : "Open the side panel", key: "Ctrl+Alt+B", act: () => toggleSide() },
    ...(tab ? [{ label: "Side panel full width", detail: on(desk.sideWide), key: "Ctrl+Alt+F", act: () => sideWide() }] : []),
  ];
}

// What you can do to a session (the menu's This session, the header's ⋯).
function sessionItems(s) {
  const on = (x) => (x ? "on" : "");
  return [
    { label: "Rename", key: "Ctrl+Alt+E", act: () => renameSession() },
    { label: "Add a picture or a file…", detail: "it goes with your next message",
      act: () => (desk.chat && desk.current === s.id ? desk.chat.openMenu("add") : pickImageInto({ id: s.id })) },
    { label: "Add a secret…", detail: "an API key or password, never in the chat", act: () => addSecretSheet({ project: s.repo }) },
    ...(s.setup || s.waking ? [] : [s.sleeping ? { label: "Wake", act: () => wakeSession(s) }
                                              : { label: "Put to sleep", act: () => sleepSession(s) }]),
    { label: s.assistant === "main" ? "Your assistant…" : "Make it your assistant…", detail: s.assistant === "main" ? "name, picture, chime" : "",
      act: () => assistantSheet(s) },
    ...LEVELS.slice().reverse().map((p) => ({ label: `${PRIORITY[p]} priority`, detail: on((s.priority || "normal") === p),
                                                key: p === "high" ? "Ctrl+Alt+Up" : p === "low" ? "Ctrl+Alt+Down" : "",
                                                act: () => api(`/api/session/${encodeURIComponent(s.id)}/priority`, { level: p }).catch((e) => toast(e.message)) })),
    { label: "Advanced", icon: "gear", group: () => ({ title: "Advanced", items: [
      { label: "Open terminal", detail: "this chat's own, in the side panel", key: "Ctrl+Alt+→", act: () => toTerminal("term") },
      ...(classicAllowed() ? [{ label: "Open Claude's classic terminal", detail: "Claude Code's own, same conversation", key: "Ctrl+Alt+L", act: () => classicTerminal() }] : []),
      { label: "Details", detail: "branch, worktree, model, mode", key: "Ctrl+Alt+I", act: () => sideToggle("details", true) }] }) },
    { label: "Complete mission", key: "Ctrl+Alt+X", danger: true, act: () => closeCurrent() },
  ];
}

// A chat's ⋯: what it shows beside it (Terminal, Changes, Details, each
// with its key; on, it closes), then what you can do to it.
function sessionMenu(s) {
  const tab = desk.current === s.id ? sideTab() : null;
  const panel = SIDE_TABS.filter(([k]) => k !== "term" || showTerminals()).map(([key, label, keys]) => ({
    label, icon: { term: "send", changes: "organize", details: "status" }[key], key: keys, detail: tab === key ? "open: closes it" : "",
    act: () => sideToggle(key) }));
  picker({ title: s.task || where(s), items: [...(desk.current === s.id ? panel : []), ...sessionItems(s)] });
}

function showKeys() {
  const part = (title, keys) => [h("div", { class: "section" }, title),
    h("div", { class: "keys-table" }, ...keys.map(([k, what]) => h("div", { class: "keys-row" }, h("kbd", {}, k), h("span", {}, what))))];
  sheet(sheetHead("Keys", "amarchy's, in the browser"),
    ...part("On the board", [["j / k  or  ↓ / ↑", "Next / previous card"], ["g / G  or  Home / End", "First / last card"],
      ["Enter  or  o", "Open the chat (a folded group: unfold it)"], ["1 – 4", "Pick that answer on the card"],
      ["x", "Complete the chat's mission, with Undo"], ["r", "Review: open the link a done chat gave"],
      ["s", "Seen: off Needs you without opening it"], ["Tab", "The card's buttons, one by one"],
      ["← / →  or  h / l", "Chats / Tasks"], ["/", "Search"], ["n", "New chat"], ["m", "The Amarchy menu"], ["o", "Group & sort"], ["?", "These keys"]]),
    ...part("In a chat", [["Esc", "Back to the board"], ["Enter / Shift+Enter", "Send / a new line"],
      ["Ctrl+Alt+J / K", "Next / previous chat"], ["Ctrl+Alt+← / →", "The chat / the terminal"],
      ...(classicAllowed() ? [["Ctrl+Alt+L", "Claude's classic terminal"]] : []),
      ["Ctrl+Alt+G / I", "Changes / Details, beside the chat"], ["Ctrl+Alt+B", "Open or close the side panel"],
      ["Ctrl+Alt+F", "The side panel full width"], ["Ctrl+Alt+R / C", "Run the project / a command"],
      ["Ctrl+Alt+Space / Enter", "Dictate: hold, or tap and tap again"], ["⌘V / drop", "A picture goes with your message"]]),
    ...part("Anywhere", [["Ctrl+Alt+N / P", "New chat / new project"], ["Ctrl+Alt+A", "Go to a chat"], ["Ctrl+Alt+S", "Search"],
      ["Ctrl+Alt+H", "The board"], ["Ctrl+Alt+X", "Complete the chat's mission"], ["Ctrl+Alt+E", "Rename"],
      ["Ctrl+Alt+↑ / ↓", "Raise / lower priority"], ["Ctrl+Alt+M", "Amarchy menu"], ["Ctrl+Alt+T", "Theme, font and wallpaper"]]));
}

// Settings that are this browser's own (the rest is in app.js's sheet).
function deskSettings() {
  const size = termSize();
  const sizeBtn = (d) => h("button", { class: "control", onclick: () => {
    store.set("term-size", String(Math.max(6, Math.min(40, termSize() + d))));
    deskRestyle();
    openSettings();
  } }, d > 0 ? "A+" : "A−");
  const meta = store.get("option-meta") !== "off";
  return [
    h("div", { class: "section" }, "Terminals"),
    h("div", { class: "seg" }, sizeBtn(-1), h("span", { class: "control size" }, `${size}px`), sizeBtn(1),
      h("button", { class: "control", onclick: () => { store.set("term-size", ""); deskRestyle(); openSettings(); } }, "As the theme")),
    h("button", { class: `control wide${meta ? " on" : ""}`, onclick: () => {
      store.set("option-meta", meta ? "off" : "");
      deskRestyle();
      openSettings();
    } }, meta ? "Option is Alt in the terminals (on)" : "Option types characters (Option isn't Alt)"),
    h("button", { class: `control wide${webgl() ? " on" : ""}`, onclick: () => {
      store.set("renderer", webgl() ? "" : "webgl");
      location.reload();
    } }, webgl() ? "Drawn with WebGL (on): click for the DOM" : "Draw with WebGL (faster; reloads)"),
    ...layoutSettings(),
    h("button", { class: "control wide", onclick: () => showKeys() }, "Keys"),
  ];
}

// Wide or phone layout, in this browser: in the phone layout's settings too,
// once picked by hand (a computer's way back to the wide one).
function layoutSettings() {
  return [
    h("div", { class: "section" }, "Layout"),
    h("div", { class: "seg" }, ...[["", "As the window fits"], ["wide", "Wide"], ["phone", "Phone"]].map(([v, label]) =>
      h("button", { class: `control${(store.get("layout") || "").replace("desktop", "wide") === v ? " on" : ""}`, onclick: () => {
        store.set("layout", v);
        location.reload();
      } }, label))),
  ];
}
