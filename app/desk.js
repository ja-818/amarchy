// amarchy on your computer: the app in a browser on a wide screen, laid out
// as amarchy is on your Omarchy desktop. Your sessions on the left, the
// session's Claude in the column in the middle and its terminal on the right,
// both of them real terminals (xterm.js) attached to the session's tmux on the
// host, as your desktop's windows are: the desktop, the phone and the browser
// all show the same session at once. The keys are amarchy's (Ctrl+Alt+…), the
// look your desktop's. Loaded before app.js, whose helpers it uses (h, glyph,
// api, toast, sessionRow…); app.js starts it on a wide screen (deskStart).
"use strict";

const desk = {
  current: null,        // the session on screen
  focus: "claude",      // which of its terminals has the keyboard
  zen: false,           // Claude alone in the column (Ctrl+Alt+Z)
  claude: null,         // its two terminals (TermPane)
  term: null,
  cursor: null,         // the session under the list's cursor, while searching it
  query: "",
  statuses: null,       // each session's status as last seen, for the chime
  el: null,
};
const COLUMN = 900;     // Claude's column, as AMARCHY_ZEN_WIDTH on your desktop
const PAD = 8;          // between it and the panels beside it
const MIN_SIDE = 200;   // narrower than this beside the column, and it's zen mode
const HEADER = 30;      // the strip with the session's name above Claude, in zen mode
// This page, as the host knows it: what it pasted, for its terminals' Claude.
const PAGE_ID = (() => {
  const a = new Uint8Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
})();
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
    // The monospace font your desktop sent (with its Nerd Font icons), before
    // the terminals measure it.
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

function termFont() { return cssVar("font") || "ui-monospace, Menlo, monospace"; }

// The terminals' font size: yours if you changed it here, else as your
// desktop's terminal has it (sent with the look), a bit bigger on a phone.
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
// as see-through as your desktop's terminals over the wallpaper, or the
// phone app's glass: the terminal's own is clear (what's drawn in reverse
// still takes its color, solid).
function termTheme() {
  const bg = cssVar("term-background") || cssVar("bg");
  const names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
  const theme = {
    foreground: termColor(cssVar("term-foreground") || cssVar("fg")),
    background: termColor(bg, 0),
    cursor: termColor(cssVar("term-cursor") || cssVar("fg")),
    cursorAccent: termColor(bg),
    selectionBackground: termColor(cssVar("term-selection-background") || cssVar("selection"), 0.5),
    selectionForeground: termColor(cssVar("term-selection-foreground") || cssVar("fg")),
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
  // which: "claude" or "term". opts.mic: this page's microphone is Claude's
  // rec while it has the keyboard (desktop); opts.size: font size.
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

  // Whether this page's microphone is its Claude's now: on a computer, while
  // the keyboard is in Claude; on the phone, while it shows Claude's terminal.
  wantsMic() {
    return app.desk ? micWanted() : document.visibilityState === "visible";
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
    const q = new URLSearchParams({ page: PAGE_ID, cols: this.term.cols, rows: this.term.rows });
    if (this.which === "claude" && this.opts.mic) {
      q.set("mic", "1");
      q.set("focus", this.wantsMic() ? "1" : "0");
    }
    const ws = this.ws = new WebSocket(wsURL(`/api/session/${encodeURIComponent(sid)}/tty/${this.which}?${q}`));
    ws.binaryType = "arraybuffer";
    let fresh = true;
    ws.onopen = () => { this.retry = 0; this.status(null); };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        let d = {};
        try { d = JSON.parse(e.data); } catch (err) { return; }
        if (typeof d.mic === "boolean") voiceSignal(sid, d.mic);
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
        this.status("This session was closed");
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

  // The keys a browser would otherwise have, as your desktop's terminal sends them.
  key(e) {
    // Space let go while Claude listens: held a moment more (as key repeats),
    // so the last word, still on its way, is in what Claude writes down.
    if (e.type === "keyup" && e.code === "Space" && voice.on && this.which === "claude") {
      const until = Date.now() + MIC_TAIL;
      const hold = setInterval(() => {
        if (Date.now() > until) clearInterval(hold);
        else this.send(enc.encode(" "));
      }, 40);
      return true;
    }
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
      // Holding Space: Claude's voice mode is about to listen, so the
      // microphone opens now, and nothing said at the start is lost.
      if (this.opts.mic && plain && e.code === "Space" && e.repeat) voiceWarm(this.sid);
    }
    return true;
  }

  // An image pasted (⌘V) or dropped on Claude: to the host, then Ctrl+V,
  // with which Claude asks for it.
  pasting() {
    const image = (list) => Array.from(list || []).find((f) => /^image\//.test(f.type));
    this.box.addEventListener("paste", (e) => {
      const item = e.clipboardData && Array.from(e.clipboardData.items).find((i) => i.kind === "file" && /^image\//.test(i.type));
      if (!item) return;        // text: the terminal pastes it
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
      await api("/api/clip", { page: PAGE_ID, type: "image/png", data });
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

function openLink(uri) {
  if (/^https?:\/\//i.test(uri)) window.open(uri, "_blank", "noopener,noreferrer");
}

// What tmux copied, to your clipboard. Safari only lets a page write it
// right after a click or a key: then a click on the notice does it.
async function copyText(text) {
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

// ---- the microphone, for Claude's own voice mode (/voice)
//
// Hold Space in Claude, as on your desktop: Claude records with rec, and
// while this page has the keyboard in Claude, the host's rec for that
// session is this browser's microphone (DeskMic in amarchy). The page opens
// the microphone as soon as the key is held (what's said before Claude
// listens waits on the host) and the host says when Claude starts and stops
// recording.

const voice = { ws: null, sid: null, on: false, warmed: null, idle: null };

function micWanted() {
  return !!desk.claude && desk.focus === "claude" && document.hasFocus() && document.visibilityState === "visible";
}

function voiceWarm(sid) {
  if (voice.ws && voice.sid === sid) return;
  voiceStart(sid);
  clearTimeout(voice.warmed);
  // Held, and yet Claude didn't start listening (its voice mode is off).
  voice.warmed = setTimeout(() => { if (!voice.on) voiceStop(); }, 4000);
}

function voiceSignal(sid, on) {
  if (on) {
    voice.on = true;
    clearTimeout(voice.warmed);
    if (!voice.ws || voice.sid !== sid) voiceStart(sid);
  } else if (voice.sid === sid) {
    voiceStop();
  }
}

async function voiceStart(sid) {
  voiceStop();
  clearTimeout(voice.idle);
  voice.sid = sid;
  const ws = voice.ws = new WebSocket(wsURL(`/api/session/${encodeURIComponent(sid)}/mic`));
  ws.binaryType = "arraybuffer";
  const queue = [];
  mic.take = (pcm) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
    else if (queue.length < 250) queue.push(pcm);
  };
  ws.onopen = () => { for (const pcm of queue.splice(0)) ws.send(pcm); };
  ws.onclose = () => { if (voice.ws === ws) voiceStop(); };
  document.body.classList.add("dictating");
  try {
    await micOpen();
  } catch (e) {
    voiceStop();
    toast(e.name === "NotAllowedError" ? "This browser may not use the microphone: allow it for Amarchy in its settings"
                                      : `The microphone didn't start: ${e.message}`);
  }
}

function voiceStop() {
  const ws = voice.ws;
  voice.ws = null;
  voice.on = false;
  clearTimeout(voice.warmed);
  document.body.classList.remove("dictating");
  if (ws) {
    try { if (ws.readyState === WebSocket.OPEN) ws.send("end"); } catch (e) { /* gone */ }
    ws.close();
  }
  if (mic.stream) {
    micRelease();
    // On a computer, off for good after a while, so the browser stops
    // showing it in use (a phone keeps it: iOS would ask again).
    clearTimeout(voice.idle);
    if (app.desk) voice.idle = setTimeout(() => { if (!voice.ws) micClose(); }, 20000);
  }
}

// Claude's key held from a button (the phone's terminal), as you'd hold it
// on your desktop: Space as a key repeats (or once, in tap mode), the
// microphone Claude's meanwhile. Let go, and it's held a moment more for the
// last word; the host says when Claude is done with rec.
function talkStart(pane) {
  if (!pane || !pane.sid || pane.talking) return;
  const tap = !!(app.view && app.view.voice_mode === "tap");
  pane.talking = { tap, timer: null };
  voiceStart(pane.sid);
  if (tap) pane.send(enc.encode(" "));
  else pane.talking.timer = setInterval(() => pane.send(enc.encode(" ")), 40);
}

async function talkStop(pane) {
  const t = pane && pane.talking;
  if (!t || t.stopping) return;
  t.stopping = true;
  await new Promise((ok) => setTimeout(ok, MIC_TAIL));
  if (t.tap) pane.send(enc.encode(" "));
  else clearInterval(t.timer);
  pane.talking = null;
  setTimeout(() => { if (!voice.on && !pane.talking) voiceStop(); }, 3000);     // Claude never listened
}

// Whether the page's microphone is Claude's now: it has the keyboard in Claude.
function micFocus() {
  if (desk.claude) desk.claude.control({ mic: micWanted() });
  if (!micWanted() && voice.ws && !voice.on) voiceStop();
}

// ---- the layout

function deskStart() {
  document.body.classList.add("desk");
  desk.zen = store.get("zen") === "on";
  desk.claude = new TermPane("claude", { mic: true });
  desk.term = new TermPane("term");
  desk.listEl = h("div", { class: "list" });
  desk.search = h("input", { type: "search", placeholder: "Search sessions", autocomplete: "off", spellcheck: "false",
                             oninput: () => { desk.query = desk.search.value; desk.cursor = null; deskList(); },
                             onkeydown: (e) => searchKeys(e, desk.search, () => desk.listEl) });
  desk.organize = h("div", { class: "organize-menu", hidden: true });
  const organizeBtn = h("button", { class: "control organize", title: "Group and sort the list",
                                    onclick: () => { desk.organize.hidden = !desk.organize.hidden; deskList(); } }, glyph("organize"));
  desk.panel = h("aside", { class: "panel" },
    h("div", { class: "panel-buttons" },
      desk.brand = h("button", { class: "control brand", title: "Amarchy menu (Ctrl+Alt+M)", onclick: () => deskMenu() },
                     h("span", { class: "a" }, "Ⓐ"), "Amarchy Menu"),
      h("button", { class: "control", title: "Ctrl+Alt+N", onclick: () => newSession() }, glyph("plus"), "New session")),
    h("div", { class: "toolbar" },
      h("label", { class: "searchbox" }, glyph("search"), desk.search,
        h("span", { class: "hint" }, "Ctrl+Alt+S")),
      organizeBtn, desk.organize),
    h("div", { class: "scroll" }, desk.listEl));
  desk.strip = h("button", { class: "strip", title: "Rename (Ctrl+Alt+E)", onclick: () => renameSession() });
  desk.claudeWin = h("section", { class: "window claude" }, desk.claude.box);
  desk.termWin = h("section", { class: "window term" }, desk.term.box);
  for (const [pane, win] of [[desk.claude, desk.claudeWin], [desk.term, desk.termWin]]) {
    // As on Omarchy, the keyboard follows the pointer between the windows.
    win.addEventListener("pointerenter", () => {
      if (!document.querySelector(".sheet-back, .picker-back, .bar-drop") && document.activeElement !== desk.search
          && desk.focus !== pane.which) pane.focus();
    });
    win.addEventListener("mousedown", () => pane.focus());
  }
  desk.empty = h("div", { class: "desk-empty", hidden: true });
  desk.column = h("main", { class: "column" }, desk.strip, desk.claudeWin, desk.empty);
  // In zen mode, with no list, the way to your sessions: the Ⓐ in the corner.
  desk.ball = h("button", { class: "ball", title: "Your sessions (Ctrl+Alt+A; right click: new session)",
                            onclick: () => barDrop(), oncontextmenu: (e) => { e.preventDefault(); newSession(); } }, "Ⓐ");
  desk.el = h("div", { class: "desk-root" }, h("div", { class: "stage" }, desk.panel, desk.column, desk.termWin), desk.ball);
  root.replaceChildren(desk.el);
  window.addEventListener("keydown", deskKeys, true);
  window.addEventListener("resize", () => deskLayout());
  window.addEventListener("focus", () => { micFocus(); markSeen(); });
  window.addEventListener("blur", micFocus);
  document.addEventListener("visibilitychange", micFocus);
  setInterval(markSeen, 10000);
  deskLayout();
  deskRoute();
}

// Zen when you said so, or when the window has no room beside the column.
function zenNow() {
  return desk.zen || (window.innerWidth - COLUMN) / 2 < MIN_SIDE;
}

function deskLayout() {
  const zen = zenNow();
  desk.el.classList.toggle("zen", zen);
  desk.el.style.setProperty("--column", `${Math.min(COLUMN, window.innerWidth)}px`);
  desk.el.style.setProperty("--header", `${zen ? HEADER : 0}px`);
  if (zen && desk.focus === "term") desk.claude.focus();
  if (!zen && desk.current) desk.term.open(desk.current);
  requestAnimationFrame(() => { desk.claude.fit(); desk.term.fit(); });
}

function paneFocused(pane) {
  if (pane) desk.focus = pane.which;
  desk.claudeWin.classList.toggle("active", desk.focus === "claude");
  desk.termWin.classList.toggle("active", desk.focus === "term");
  micFocus();
}

function row(id) { return app.view && app.view.sessions.find((s) => s.id === id) || null; }

// The session in the address (#/s/<id>), else the one you were on, else the first.
function deskRoute() {
  closeSheet();
  const m = here().match(/^#\/s\/(.+)$/);
  let id = m ? decodeURIComponent(m[1]) : null;
  if (app.view && !row(id)) {
    const last = store.get("desk-last");
    id = row(last) ? last : (app.view.sessions[0] || {}).id || null;
  }
  show(id);
}

function show(id) {
  if (id && app.view && !row(id)) id = null;
  const changed = id !== desk.current;
  desk.current = id;
  desk.empty.hidden = !!id || !app.view;
  desk.claudeWin.hidden = !id;
  desk.termWin.classList.toggle("none", !id);
  if (id) {
    store.set("desk-last", id);
    desk.claude.open(id);
    if (!zenNow()) desk.term.open(id);
    if (changed) {
      desk.claude.focus();
      paneFocused(desk.claude);
      markSeen();
    }
  } else {
    desk.claude.disconnect();
    desk.term.disconnect();
    desk.empty.replaceChildren(h("div", {}, app.view ? "No sessions yet." : (app.failed || "Connecting…")),
      app.view ? h("button", { class: "control", onclick: () => newSession() }, "New session (Ctrl+Alt+N)") : null);
  }
  deskList();
}

function go2(id) {
  if (!id) return;
  go(`#/s/${encodeURIComponent(id)}`);
}

function markSeen() {
  if (desk.current && document.visibilityState === "visible" && document.hasFocus())
    api(`/api/session/${encodeURIComponent(desk.current)}/seen`).catch(() => {});
}

// The list changed (app.js's events): the panel, the strip, the Ⓐ, and the
// chime for a session that went on to need you or finished.
function deskList() {
  if (!desk.el) return;
  const v = app.view;
  if (v && desk.current && !row(desk.current)) {     // closed: on to the next one in the list
    const ids = desk.order || [];
    const at = ids.indexOf(desk.current);
    const next = [...ids.slice(at + 1), ...ids.slice(0, Math.max(at, 0)).reverse()].find((id) => row(id))
      || (v.sessions[0] || {}).id;
    desk.current = null;
    if (next) return go2(next);
    return show(null);
  }
  if (v && !desk.current && v.sessions.length) return deskRoute();
  chime(v);
  const waiting = v ? v.sessions.filter((s) => s.status === "waiting").length : 0;
  document.title = waiting ? `(${waiting}) Amarchy` : "Amarchy";
  for (const b of [desk.brand, desk.ball]) b.classList.toggle("lit", waiting > 0);
  // The strip above Claude in zen mode: what it is, project · branch on hover.
  const s = row(desk.current);
  desk.strip.replaceChildren(...(s ? [stateIcon(s), taskText(s.task || "New session", s.task ? "" : "untitled"),
                                       h("span", { class: "more" }, `${where(s)}  \u{F03EB}`)] : []));
  // The panel.
  desk.organize.hidden = desk.organize.hidden || !v || !v.sessions.length;
  if (!desk.organize.hidden) desk.organize.replaceChildren(...organizeMenu());
  const shown = fillList(desk.listEl, desk.query, desk.cursor || desk.current);
  if (!desk.query) desk.order = shown.map((x) => x.id);
  const drop = document.querySelector(".bar-drop");
  if (drop) drop.refresh();
}

// The sessions as the list beside Claude draws them, the cursor's on the
// one you're in (or the one you move it to).
function fillList(list, query, cursorId) {
  const v = app.view;
  list.replaceChildren();
  if (!v) {
    list.append(h("div", { class: "empty" }, app.failed || "Connecting…"));
    return [];
  }
  const shown = matching(v.sessions, query);
  if (!v.sessions.length) list.append(h("div", { class: "empty" }, "No sessions yet."));
  else if (!shown.length) list.append(h("div", { class: "empty" }, `No session called “${query.trim()}”`));
  const groups = v.group || [];
  let prev = [];
  for (const s of shown) {
    const labels = groups.map((g) => groupLabel(s, g));
    const at = labels.findIndex((l, i) => l !== prev[i]);
    if (at >= 0)
      for (let i = at; i < labels.length; i++)
        list.append(h("div", { class: `group-head${i === 0 && groups.length > 1 ? " ruled" : ""}` }, labels[i]));
    prev = labels;
    const el = sessionRow(s, groups);
    el.dataset.id = s.id;
    el.classList.toggle("cursor", s.id === cursorId);
    el.addEventListener("contextmenu", (e) => { e.preventDefault(); rowMenu(s); });
    list.append(el);
  }
  const cur = list.querySelector(".row.cursor");
  if (cur) cur.scrollIntoView({ block: "nearest" });
  return shown;
}

// In the search (beside Claude, or under the Ⓐ): ↑/↓ move, ↵ goes there, Esc leaves.
function searchKeys(e, input, listOf, done) {
  const ids = Array.from(listOf().querySelectorAll(".row")).map((r) => r.dataset.id);
  const at = ids.indexOf(desk.cursor || desk.current);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!ids.length) return;
    const i = at < 0 ? 0 : (at + (e.key === "ArrowDown" ? 1 : ids.length - 1)) % ids.length;
    desk.cursor = ids[i];
    deskList();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const id = at >= 0 ? ids[at] : ids[0];
    leaveSearch(input);
    if (done) done();
    go2(id);
  } else if (e.key === "Escape") {
    e.preventDefault();
    leaveSearch(input);
    if (done) done();
  }
}

function leaveSearch(input) {
  input.value = "";
  desk.query = "";
  desk.cursor = null;
  input.blur();
  deskList();
  if (desk.current) (desk.focus === "term" && !zenNow() ? desk.term : desk.claude).focus();
}

// The chime your desktop plays when a session needs you or is done (the one
// you're looking at only when this window isn't).
let chimeAudio = null;
function chime(v) {
  if (!v) return;
  const now = Object.fromEntries(v.sessions.map((s) => [s.id, s.status]));
  const was = desk.statuses;
  desk.statuses = now;
  if (!was || v.sound === "off") return;
  const rang = v.sessions.some((s) => {
    const prev = was[s.id];
    if (!prev || prev === s.status) return false;
    if (!(s.status === "waiting" || (s.status === "idle" && prev === "working"))) return false;
    return !(s.id === desk.current && document.hasFocus());
  });
  if (!rang) return;
  const src = `/sound/${encodeURIComponent(v.sound || "kalimba")}`;
  if (!chimeAudio || !chimeAudio.src.endsWith(src)) chimeAudio = new Audio(src);
  chimeAudio.currentTime = 0;
  chimeAudio.play().catch(() => { /* not until you've clicked the page once */ });
}

// ---- the Ⓐ in the bar: your sessions, dropped from it (in zen mode, the way to them)

function barDrop(search) {
  const open = document.querySelector(".bar-drop");
  if (open) { open.close(); return; }
  const input = h("input", { type: "search", placeholder: "Search sessions", autocomplete: "off", spellcheck: "false" });
  const list = h("div", { class: "list" });
  const back = h("div", { class: "bar-shade", onclick: () => drop.close() });
  const drop = h("div", { class: "bar-drop" },
    h("label", { class: "searchbox" }, glyph("search"), input), h("div", { class: "scroll" }, list));
  let query = "";
  drop.refresh = () => fillList(list, query, desk.cursor || desk.current);
  drop.close = () => { back.remove(); drop.remove(); desk.cursor = null; if (desk.current) desk.claude.focus(); };
  input.addEventListener("input", () => { query = input.value; desk.cursor = null; drop.refresh(); });
  // Under the Ⓐ, as on your desktop: j/k and ↵ in the list, / to search,
  // +/- for priority, g for group & sort, p/f/s to group, o to sort.
  const keys = (e) => {
    if (e.target === input) {
      if (e.key === "Escape" && input.value) { e.preventDefault(); input.value = query = ""; drop.refresh(); return; }
      if (e.key === "Escape") { e.preventDefault(); input.blur(); drop.focus(); return; }
      searchKeys(e, input, () => list, () => drop.close());
      return;
    }
    const ids = Array.from(list.querySelectorAll(".row")).map((r) => r.dataset.id);
    const at = Math.max(0, ids.indexOf(desk.cursor || desk.current));
    const s = row(ids[at]);
    const v = app.view || {};
    const groups = v.group || [];
    const toggle = (g) => organizeList(groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g], v.sort || "priority");
    const k = e.key;
    if (k === "j" || k === "ArrowDown") desk.cursor = ids[(at + 1) % ids.length];
    else if (k === "k" || k === "ArrowUp") desk.cursor = ids[(at + ids.length - 1) % ids.length];
    else if (k === "Enter") { drop.close(); go2(ids[at]); return; }
    else if (k === "/") { input.focus(); }
    else if ((k === "+" || k === "=") && s) setPriority(s, "up");
    else if (k === "-" && s) setPriority(s, "down");
    else if (k === "g") { drop.close(); organizePicker(); return; }
    else if (k === "p") toggle("project");
    else if (k === "f") toggle("priority");
    else if (k === "s") toggle("status");
    else if (k === "o") {
      const order = ["priority", "newest", "oldest"];
      organizeList(groups, order[(order.indexOf(v.sort || "priority") + 1) % order.length]);
    } else if (k === "Escape") { drop.close(); return; }
    else return;
    e.preventDefault();
    drop.refresh();
  };
  drop.tabIndex = -1;
  drop.addEventListener("keydown", keys);
  document.body.append(back, drop);
  drop.refresh();
  if (search) input.focus();
  else drop.focus();
}

// ---- the keys: amarchy's, Ctrl+Alt+… (Hyprland's Super ones are the
// browser's or the Mac's: Super+Alt+N is Ctrl+Alt+N here, Super+arrows
// Ctrl+Alt+←/→)

const DESK_KEYS = {
  KeyJ: () => step(1), KeyK: () => step(-1),
  KeyS: () => deskSearch(), KeyZ: () => toggleZen(), Enter: () => toggleTerminal(),
  ArrowLeft: () => toPane("claude"), ArrowRight: () => toPane("term"),
  KeyR: () => runProject(), KeyC: () => pickCommand(),
  KeyN: () => newSession(), KeyP: () => newProject(), KeyT: () => toast("The theme is your desktop's: change it there (Ctrl+Alt+T) and it changes here"),
  ArrowUp: () => desk.current && setPriority(row(desk.current), "up"),
  ArrowDown: () => desk.current && setPriority(row(desk.current), "down"),
  KeyE: () => renameSession(), KeyM: () => deskMenu(), KeyX: () => closeCurrent(), KeyA: () => barDrop(),
};

function deskKeys(e) {
  if (!(e.ctrlKey && e.altKey) || e.metaKey) return;
  const act = DESK_KEYS[e.code];
  if (!act) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.repeat && !["KeyJ", "KeyK"].includes(e.code)) return;
  document.querySelectorAll(".picker-back").forEach((p) => p.close && p.close());
  act();
}

function step(n) {
  const ids = Array.from(desk.listEl.querySelectorAll(".row")).map((r) => r.dataset.id);
  const all = ids.length ? ids : ((app.view && app.view.sessions) || []).map((s) => s.id);
  if (!all.length) return;
  const at = all.indexOf(desk.current);
  go2(all[(at + n + all.length) % all.length]);
  if (zenNow()) flashDrop();
}

// In zen mode the list drops from the Ⓐ for a moment as you move between sessions.
let flashTimer = null;
function flashDrop() {
  if (!document.querySelector(".bar-drop")) barDrop();
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { const d = document.querySelector(".bar-drop"); if (d && !d.contains(document.activeElement)) d.close(); }, 1200);
  requestAnimationFrame(() => { if (desk.current) desk.claude.focus(); });
}

function deskSearch() {
  if (zenNow()) return barDrop(true);
  desk.search.focus();
  desk.search.select();
}

function toggleZen(on) {
  desk.zen = on === undefined ? !desk.zen : on;
  store.set("zen", desk.zen ? "on" : "");
  deskLayout();
}

function toPane(which) {
  if (which === "term" && !leaveZen()) return;
  (which === "term" ? desk.term : desk.claude).focus();
}

function toggleTerminal() {
  toPane(desk.focus === "term" && !zenNow() ? "claude" : "term");
}

// The terminal lives beside Claude: asking for it leaves zen mode.
function leaveZen() {
  if (desk.zen) toggleZen(false);
  if (zenNow()) {
    toast("No room for the terminal beside Claude in this window.");
    return false;
  }
  return true;
}

// ---- pickers: Omarchy's menu card, for everything amarchy asks

// items: [{label, detail, icon, key, group (a function giving items), act,
// keep}], or text (a field to type in, value its start). Typing filters;
// ↑/↓ move, ↵ picks, → opens a group, ← and Esc go back.
function picker(opts) {
  const stack = [];
  const input = h("input", { type: "text", autocomplete: "off", spellcheck: "false" });
  const list = h("div", { class: "picker-list" });
  const titleEl = h("div", { class: "picker-title" });
  const card = h("div", { class: "picker", role: "dialog" }, titleEl, h("label", { class: "picker-input" }, input), list);
  const back = h("div", { class: "picker-back", onmousedown: (e) => { if (e.target === back) close(); } }, card);
  let level, items = [], at = 0;
  const close = back.close = () => {
    back.remove();
    if (desk.current) (desk.focus === "term" && !zenNow() ? desk.term : desk.claude).focus();
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

async function newSession() {
  const projects = (app.view && app.view.projects) || [];
  picker({ title: "New session", placeholder: "Project", items: [
    ...projects.map((p) => ({ label: p.name, icon: "project", detail: p.sessions ? `${p.sessions} session${p.sessions === 1 ? "" : "s"}` : "",
                               act: () => startSession(p.name) })),
    { label: "New project…", icon: "plus", key: "Ctrl+Alt+P", always: true, act: () => newProject() }] });
}

async function startSession(repo, prompt) {
  toast(`Starting a session in ${repo}…`);
  try {
    const { id } = await api("/api/new", prompt ? { repo, prompt } : { repo });
    store.set("last-project", repo);
    go2(id);
  } catch (e) {
    toast(e.message);
  }
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
  ask("Name of the new project", name.replace(/[^\w.-]/g, "-"), (n) => {
    if (!n.trim()) return;
    picker({ title: `${n.trim()}: a GitHub repo too?`, items: [
      { label: "Just here", act: () => addProject({ new: n.trim() }) },
      { label: "With a private GitHub repo", act: () => addProject({ new: n.trim(), github: true }) }] });
  });
}

async function addProject(body) {
  toast("Adding the project…");
  try {
    const d = await api("/api/add", body);
    const name = (body.new || d.name || body.repo.split("/").pop()).replace(/\.git$/, "");
    const known = ((app.view && app.view.projects) || []).map((p) => p.name);
    await startSession(known.includes(name) ? name : (d.name || name));
  } catch (e) {
    toast(e.message);
  }
}

function renameSession() {
  const s = row(desk.current);
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
  const s = row(desk.current);
  if (s) confirmClose(s);
}

async function runProject(name) {
  const s = row(desk.current);
  if (!s) return;
  if (!leaveZen()) return;
  try {
    await api(`/api/session/${encodeURIComponent(s.id)}/run`, name ? { name } : {});
    desk.term.open(s.id);
  } catch (e) {
    if (/No run command/.test(e.message))
      return ask(`Run command for ${s.repo}`, "", async (cmd) => {
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
  const s = row(desk.current);
  if (!s) return;
  let cmds = [];
  try {
    const r = await fetch(`/api/session/${encodeURIComponent(s.id)}/commands`);
    cmds = (await r.json()).commands || [];
  } catch (e) { return toast("Can't reach Amarchy"); }
  picker({ title: `Run in ${s.repo}`, items: [
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

function organizePicker() {
  const v = app.view || {};
  const groups = v.group || [], sort = v.sort || "priority";
  picker({ title: "Group & sort", items: [
    ...GROUPINGS.map(([what, icon, label]) => {
      const on = what === "none" ? !groups.length : groups.includes(what);
      const next = what === "none" ? [] : on ? groups.filter((g) => g !== what) : [...groups, what];
      return { label: `Group by ${label.toLowerCase()}`, icon, detail: on ? "on" : "", act: () => organizeList(next, sort) };
    }),
    ...SORTINGS.map(([what, icon, label]) => ({ label: `Sort: ${label.toLowerCase()}`, icon, detail: sort === what ? "on" : "",
                                                act: () => organizeList(groups, what) }))] });
}

// The amarchy menu (Ctrl+Alt+M), as on your desktop.
function deskMenu() {
  const s = row(desk.current);
  const on = (x) => (x ? "on" : "");
  const items = [
    { label: "New session", icon: "plus", key: "Ctrl+Alt+N", act: () => newSession() },
    { label: "New project", icon: "plus", key: "Ctrl+Alt+P", act: () => newProject() },
  ];
  if (s) items.push(
    { label: "Run", icon: "send", group: () => ({ title: "Run", items: [
      { label: "Run the project", key: "Ctrl+Alt+R", act: () => runProject() },
      { label: "Run a command…", key: "Ctrl+Alt+C", act: () => pickCommand() },
      { label: "The terminal", key: "Ctrl+Alt+Return", act: () => toPane("term") }] }) },
    { label: "This session", icon: "more", group: () => ({ title: s.task || where(s), items: [
      { label: "Rename", key: "Ctrl+Alt+E", act: () => renameSession() },
      ...LEVELS.slice().reverse().map((p) => ({ label: `${PRIORITY[p]} priority`, detail: on((s.priority || "normal") === p),
                                                  key: p === "high" ? "Ctrl+Alt+Up" : p === "low" ? "Ctrl+Alt+Down" : "",
                                                  act: () => api(`/api/session/${encodeURIComponent(s.id)}/priority`, { level: p }).catch((e) => toast(e.message)) })),
      { label: "Close", key: "Ctrl+Alt+X", danger: true, act: () => closeCurrent() }] }) });
  items.push(
    { label: "Sessions", icon: "status", group: () => ({ title: "Sessions", items: [
      { label: "Next", key: "Ctrl+Alt+J", act: () => step(1) },
      { label: "Previous", key: "Ctrl+Alt+K", act: () => step(-1) },
      { label: "Search", key: "Ctrl+Alt+S", act: () => deskSearch() },
      { label: "Zen mode", detail: on(desk.zen), key: "Ctrl+Alt+Z", act: () => toggleZen() },
      { label: "Group & sort", act: () => organizePicker() },
      { label: "Close one…", act: () => picker({ title: "Close which session?", items: ((app.view && app.view.sessions) || []).map((x) =>
        ({ label: x.task || x.name, detail: where(x), act: () => confirmClose(x) })) }) }] }) },
    { label: "Settings", icon: "gear", group: () => ({ title: "Settings", items: [
      { label: "Notifications, look, layout…", act: () => openSettings() },
      { label: "Keys", act: () => showKeys() }] }) });
  picker({ title: "Amarchy", items });
}

function showKeys() {
  const keys = [["Ctrl+Alt+J / K", "Next / previous session"], ["Ctrl+Alt+S", "Search sessions"],
    ["Ctrl+Alt+Z", "Zen mode"], ["Ctrl+Alt+Return", "Between Claude and the terminal"],
    ["Ctrl+Alt+← / →", "Claude / the terminal (Super+arrows on Omarchy)"], ["Ctrl+Alt+R", "Run the project"],
    ["Ctrl+Alt+C", "Run a command"], ["Ctrl+Alt+N / P", "New session / new project"],
    ["Ctrl+Alt+Up / Down", "Raise / lower priority"], ["Ctrl+Alt+E", "Rename"], ["Ctrl+Alt+M", "Amarchy menu"],
    ["Ctrl+Alt+X", "Close this session"], ["Ctrl+Alt+A", "Your sessions under the Ⓐ (Super+Alt+A)"],
    ["Hold Space", "Dictate to Claude (/voice), with this computer's microphone"],
    ["⌘V / Ctrl+V", "Paste an image into Claude (or drop it there)"], ["Shift+Enter", "A new line in Claude's prompt"]];
  sheet(sheetHead("Keys", "amarchy's, in the browser"),
    h("div", { class: "keys-table" }, ...keys.map(([k, what]) => h("div", { class: "keys-row" }, h("kbd", {}, k), h("span", {}, what)))));
}

// Settings that are this browser's own (the rest is in app.js's sheet).
function deskSettings() {
  const size = termSize();
  const sizeBtn = (d) => h("button", { class: "control", onclick: () => {
    store.set("term-size", String(Math.max(6, Math.min(40, termSize() + d))));
    for (const p of [desk.claude, desk.term, app.session && app.session.pane]) if (p) p.restyle();
    openSettings();
  } }, d > 0 ? "A+" : "A−");
  const meta = store.get("option-meta") !== "off";
  return [
    h("div", { class: "section" }, "Terminals"),
    h("div", { class: "seg" }, sizeBtn(-1), h("span", { class: "control size" }, `${size}px`), sizeBtn(1),
      h("button", { class: "control", onclick: () => { store.set("term-size", ""); for (const p of [desk.claude, desk.term]) if (p) p.restyle(); openSettings(); } }, "As the desktop")),
    h("button", { class: `control wide${meta ? " on" : ""}`, onclick: () => {
      store.set("option-meta", meta ? "off" : "");
      for (const p of [desk.claude, desk.term]) if (p) p.restyle();
      openSettings();
    } }, meta ? "Option is Alt in the terminals (on)" : "Option types characters (Option isn't Alt)"),
    h("button", { class: `control wide${webgl() ? " on" : ""}`, onclick: () => {
      store.set("renderer", webgl() ? "" : "webgl");
      location.reload();
    } }, webgl() ? "Drawn with WebGL (on): click for the DOM" : "Draw with WebGL (faster; reloads)"),
    h("div", { class: "section" }, "Layout"),
    h("div", { class: "seg" }, ...[["", "As the window fits"], ["desktop", "Desktop"], ["phone", "Phone"]].map(([v, label]) =>
      h("button", { class: `control${(store.get("layout") || "") === v ? " on" : ""}`, onclick: () => {
        store.set("layout", v);
        location.reload();
      } }, label))),
    h("button", { class: "control wide", onclick: () => { closeSheet(); showKeys(); } }, "Keys"),
  ];
}
