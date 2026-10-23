// amarchy on your computer: the app in a browser on a wide screen (its wide
// layout). Your sessions on the left, the session's chat in the middle
// (chat.js, the phone's), and beside it a side panel with its Terminal (the
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
  focusPane: null,      // the terminal (TermPane) with the keyboard, micPane the last Claude one
  micPane: null,
  zen: false,           // the list hidden (Ctrl+Alt+Z)
  sideTab: null,        // the side panel's tab you left open: term, changes, details, none (closed)
  sideWide: false,      // the side panel over the whole width (Ctrl+Alt+F)
  sideWidth: 0,
  revealed: false,      // a terminal asked for with Show terminals off: shown, for this session
  terminal: null,       // the side panel's views
  changes: null,
  details: null,
  cursor: null,         // the session under the list's cursor, while searching it
  pending: null,        // a session just started, {id, until}: shown once the list has it
  query: "",
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
  // which: "claude" or "term". opts.mic: this page's microphone is Claude's
  // rec while it has the keyboard (the wide layout); opts.size: font size.
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
    const q = new URLSearchParams({ cols: this.term.cols, rows: this.term.rows });
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

  // The keys a browser would otherwise have, as a terminal sends them.
  key(e) {
    // Space let go while Claude listens: held a moment more (as key repeats),
    // so the last word, still on its way, is in what Claude writes down.
    if (e.type === "keyup" && e.code === "Space" && this.which === "claude" && !voice.on) voiceTyped();
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
      // Space down: Claude's voice mode may be about to listen (it waits
      // for the key to repeat, half a second on a Mac), so the microphone
      // comes on now, and nothing said at the start is lost. Let go before
      // it repeats, it was just a space.
      if (this.opts.mic && plain && e.code === "Space" && app.view && app.view.voice) voiceWarm(this.sid, e.repeat);
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

// ---- the microphone, for Claude's own voice mode (/voice)
//
// Hold Space in Claude, as in a terminal of its own: Claude records with rec, and
// while this page has the keyboard in Claude, the host's rec for that
// session is this browser's microphone (DeskMic in amarchy). The page opens
// the microphone as soon as the key is held (what's said before Claude
// listens waits on the host) and the host says when Claude starts and stops
// recording.

const voice = { ws: null, sid: null, on: false, warmed: null, idle: null, held: false, typed: null };
const MIC_KEEP = 600000;  // ms the microphone is kept, off, after the last dictation (on a computer)

// Claude's terminal has the keyboard (in the side panel, or the phone's).
function micWanted() {
  const p = desk.micPane;
  return !!p && desk.focusPane === p && !!p.sid && document.hasFocus() && document.visibilityState === "visible";
}

function voiceWarm(sid, held) {
  if (held) voice.held = true;
  if (voice.ws && voice.sid === sid) return;
  voiceStart(sid);
  voice.held = !!held;
  clearTimeout(voice.warmed);
  // Held, and yet Claude didn't start listening (its voice mode is off).
  voice.warmed = setTimeout(() => { if (!voice.on) voiceStop(); }, 4000);
}

// Space let go, Claude not listening: a space typed, unless Claude takes
// it as the key tapped (its tap mode), which it says in a moment.
function voiceTyped() {
  if (!voice.ws || voice.on) return;
  clearTimeout(voice.typed);
  const tap = !!(app.view && app.view.voice_mode === "tap");
  if (!tap && !voice.held) voiceStop();
  else if (tap) voice.typed = setTimeout(() => { if (!voice.on) voiceStop(); }, 1000);
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
  voice.on = voice.held = false;
  clearTimeout(voice.warmed);
  clearTimeout(voice.typed);
  document.body.classList.remove("dictating");
  if (ws) {
    try { if (ws.readyState === WebSocket.OPEN) ws.send("end"); } catch (e) { /* gone */ }
    ws.close();
  }
  if (mic.stream) {
    micRelease();
    // On a computer, off for good after a while, so the browser stops
    // showing it in use (a phone keeps it: iOS would ask again); until then
    // the next dictation starts at once, not a second or two later.
    clearTimeout(voice.idle);
    if (app.desk) voice.idle = setTimeout(() => { if (!voice.ws) micClose(); }, MIC_KEEP);
  }
}

// Claude's key held from a button (the phone's terminal), as you'd hold it
// on a keyboard: Space as a key repeats (or once, in tap mode), the
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
  if (desk.micPane) desk.micPane.control({ mic: micWanted() });
  if (!micWanted() && voice.ws && !voice.on) voiceStop();
  if (app.desk && document.visibilityState === "hidden" && !voice.ws && mic.stream) micClose();     // out of sight: let it go
}

// ---- the layout: your sessions on the left, the session's chat in the
// middle, and beside it the side panel: its Terminal, Changes and Details

const SIDEBAR = 300;        // the list's width
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
  desk.zen = store.get("zen") === "on";
  desk.sideTab = store.get("desk-side") || null;
  desk.sideWidth = parseInt(store.get("desk-side-width"), 10) || SIDE_START;
  desk.terminal = makeTerminal();
  desk.changes = new DeskChanges();
  desk.details = new DeskDetails();
  desk.listEl = h("div", { class: "list" });
  desk.search = h("input", { type: "search", placeholder: "Search chats", title: "Search chats (Ctrl+Alt+S)", autocomplete: "off", spellcheck: "false",
                             oninput: () => { desk.query = desk.search.value; desk.cursor = null; deskList(); },
                             onkeydown: (e) => searchKeys(e, desk.search, () => desk.listEl) });
  if (kept && kept.search) desk.search.value = desk.query = kept.search;      // kept over an update (app.js)
  const organizeBtn = h("button", { class: "control organize", title: "Group and sort the list", "aria-haspopup": "menu",
                                    onclick: () => toggleOrganize(desk.organize, organizeBtn, deskList),
                                    onkeydown: (e) => { if (e.key === "ArrowDown" && desk.organize.hidden) { e.preventDefault(); toggleOrganize(desk.organize, organizeBtn, deskList); } } },
                        glyph("organize"));
  desk.organize = organizeBox(() => organizeBtn, deskList);
  desk.panel = h("aside", { class: "panel", "aria-label": "Your sessions" },
    h("div", { class: "panel-buttons" },
      desk.brand = h("button", { class: "control brand", title: "Amarchy menu (Ctrl+Alt+M)", onclick: () => deskMenu() },
                     h("span", { class: "a" }, "Ⓐ"), "Amarchy Menu"),
      // The new chat ("What do you want to do?") in the middle: newSession().
      h("button", { class: "control new-chat", title: "New chat (Ctrl+Alt+N)", onclick: () => newSession() }, glyph("plus"), "New chat")),
    desk.toolbar = h("div", { class: "toolbar" },
      h("label", { class: "searchbox" }, glyph("search"), desk.search,
        h("span", { class: "hint" }, "Ctrl+Alt+S")),
      organizeBtn, desk.organize),
    h("div", { class: "scroll" }, desk.listEl));
  desk.head = h("header", { class: "desk-head" });
  desk.chatSlot = h("div", { class: "desk-chat" });
  desk.empty = h("div", { class: "desk-empty", hidden: true });
  desk.column = h("main", { class: "column" }, desk.head, desk.chatSlot, desk.empty);
  desk.side = buildSide();
  // In zen mode, with no list, the way to your sessions: the Ⓐ in the corner.
  desk.ball = h("button", { class: "ball", title: "Your chats (Ctrl+Alt+A; right click: a new chat)",
                            onclick: () => barDrop(), oncontextmenu: (e) => { e.preventDefault(); newSession(); } }, "Ⓐ");
  desk.el = h("div", { class: "desk-root" }, h("div", { class: "stage" }, desk.panel, desk.column, desk.side.el), desk.ball);
  root.replaceChildren(desk.el);
  // Where the keyboard is: the chat, the side panel, or a terminal in it
  // (its TermPane says so itself, paneFocused).
  desk.column.addEventListener("focusin", () => { desk.focus = "chat"; desk.focusPane = null; deskPanes(); });
  desk.side.el.addEventListener("focusin", (e) => {
    if (!e.target.closest(".term-box")) { desk.focus = "side"; desk.focusPane = null; deskPanes(); }
  });
  chatKeys();
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
  window.addEventListener("focus", () => { micFocus(); markSeen(); });
  window.addEventListener("blur", micFocus);
  document.addEventListener("visibilitychange", micFocus);
  setInterval(markSeen, 10000);
  deskLayout();
  deskRoute();
}

// Zen: the list is hidden, because you said so (Ctrl+Alt+Z) or because the
// window has no room for it.
function zenNow() {
  return !!desk.el && desk.el.classList.contains("zen");
}

// The widths: the list (unless zen), the side panel (if open) as wide as you
// dragged it, the chat the rest. Short of room, the list goes first, then
// the panel goes over the chat.
function deskLayout() {
  if (!desk.el) return;
  const W = window.innerWidth, tab = desk.current ? sideTab() : null;
  const wide = !!tab && desk.sideWide;
  let list = desk.zen ? 0 : SIDEBAR;
  if (list && W - list - (tab ? SIDE_MIN : 0) < MIN_CHAT) list = 0;
  let side = 0, over = false;
  if (tab) {
    const room = W - list - MIN_CHAT;
    if (wide) side = W - list;
    else if (room >= SIDE_MIN) side = Math.max(SIDE_MIN, Math.min(desk.sideWidth, room));
    else { over = true; side = Math.min(Math.max(desk.sideWidth, SIDE_MIN), W - 48); }
  }
  desk.el.classList.toggle("zen", !list);
  desk.el.classList.toggle("side-open", !!tab);
  desk.el.classList.toggle("side-over", over);
  desk.el.classList.toggle("side-wide", wide);
  desk.el.style.setProperty("--sidebar", `${list}px`);
  desk.el.style.setProperty("--side", `${side}px`);
  renderSide();
  deskHead();
  requestAnimationFrame(() => { desk.terminal.fit(); if (desk.chat) desk.chat.grow(); });
}

// The panes' outlines: which one has the keyboard.
function deskPanes() {
  desk.column.classList.toggle("active", desk.focus === "chat");
  desk.side.el.classList.toggle("active", desk.focus !== "chat");
  micFocus();
}

function paneFocused(pane) {
  if (pane) {
    desk.focus = "term";
    desk.focusPane = pane;
    if (pane.which === "claude" && pane.opts.mic) desk.micPane = pane;
  }
  if (desk.el) deskPanes();
  else micFocus();
}

function row(id) { return app.view && app.view.sessions.find((s) => s.id === id) || null; }

// The session in the address (#/s/<id>), else the one you were on, else the first.
// One you just started that the list doesn't have yet: it shows when it does.
function deskRoute() {
  closeSheets();
  if (here() === "#/new") return show(null, true);
  const m = here().match(/^#\/s\/(.+)$/);
  let id = m ? decodeURIComponent(m[1]) : null;
  const p = desk.pending;
  if (p && (p.id !== id || Date.now() > p.until || row(id))) desk.pending = null;
  if (desk.pending) return;
  if (app.view && !row(id)) {
    const last = store.get("desk-last");
    id = row(last) ? last : (app.view.sessions[0] || {}).id || null;
  }
  show(id);
}

// The session's chat in the middle, or (id null) the new chat: "What do
// you want to do?" (#/new, Ctrl+Alt+N, and what there is with no chat yet),
// or with no project yet the welcome.
function show(id, fresh = false) {
  if (id && app.view && !row(id)) id = null;
  const changed = id !== desk.current || (!id && fresh !== !!desk.fresh);
  desk.current = id;
  desk.fresh = !id && fresh;
  desk.empty.hidden = !!id || !app.view;
  desk.chatSlot.hidden = !id;
  if (changed) {
    if (desk.chat) desk.chat.close();
    desk.chat = id ? deskChat(id) : null;
    desk.chatSlot.replaceChildren(...(desk.chat ? [desk.chat.el] : []));
    if (desk.chat) desk.chat.open();
    if (desk.revealed && !(app.view && app.view.show_terminals !== false)) desk.revealed = false;     // shown for that session
  }
  if (id) {
    store.set("desk-last", id);
    if (changed) {
      deskLayout();
      toChat();
      markSeen();
    }
  } else {
    desk.terminal.close();
    desk.changes.close();
    desk.details.close();
    drawEmpty(changed);
    deskLayout();
  }
  deskList();
}

// The middle with no chat in it: the new chat, the welcome (no project yet),
// or what's wrong.
function drawEmpty(changed) {
  const v = app.view;
  const first = !!v && !v.sessions.length && !(v.projects && v.projects.length);
  const kind = !v ? "off" : first ? "welcome" : "new";
  if (kind === "new") {
    if (!desk.newChat) desk.newChat = newChat({ wide: true, started: (id) => {
      desk.pending = { id, until: Date.now() + 15000 };
      go2(id);
    } });
    if (desk.emptyKind !== "new") desk.empty.replaceChildren(desk.newChat.el);
    desk.newChat.update();
    if (changed || desk.emptyKind !== "new") requestAnimationFrame(() => {
      if (!desk.current && !document.querySelector(".picker-back, .sheet-back")) desk.newChat.focus();
    });
  } else if (kind === "welcome") {
    if (desk.emptyKind !== "welcome") desk.empty.replaceChildren(welcome((p) => newChatIn(p)));
  } else {
    desk.empty.replaceChildren(h("div", { class: "big" }, app.failed || "Connecting…"));
  }
  desk.empty.classList.toggle("new", kind === "new");
  desk.emptyKind = kind;
}

// The new chat, in that project (one just added).
function newChatIn(name) {
  newSession();
  if (desk.newChat) desk.newChat.use(name);
}

// Escape in an empty new chat: back to the chat you were in.
function leaveNewChat() {
  const last = store.get("desk-last");
  if (row(last)) go2(last);
}

// The session's chat (chat.js): its conversation, its cards, the box you
// type in, read from its stream.
function deskChat(id) {
  const chat = new Chat({
    id, row: row(id),
    onSession: (r) => { if (chat === desk.chat) { deskHead(); desk.details.sessionChanged(r); } },
    onGone: (why) => {
      // Closed: the list moves on when it drops it. Not reachable (the host
      // restarted): again in a moment.
      if (why && chat === desk.chat) setTimeout(() => { if (chat === desk.chat && !chat.closed) chat.reopen(); }, 3000);
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

// ---- over the chat: the session's name, its state in words, and the side
// panel's tabs

function deskHead() {
  if (!desk.head) return;
  const s = row(desk.current);
  if (!s) { desk.head.replaceChildren(); return; }
  const tab = sideTab();
  const st = doneOf(s);
  const name = s.assistant === "main"
    ? [avatar(s, "small"), taskText(s.assistant_name || "Assistant", "assistant-name")]
    : [taskText(s.task || "New chat", s.task ? "" : "untitled")];
  const toggle = ([key, label, keys]) => h("button", {
    class: `head-btn${tab === key ? " on" : ""}`, type: "button", "aria-pressed": String(tab === key),
    title: `${label} (${keys})`, onclick: () => sideToggle(key) }, deskIcon(SIDE_ICONS[key]), h("span", { class: "label" }, label));
  desk.head.replaceChildren(
    h("button", { class: "head-title", type: "button", title: `${where(s)} · rename (Ctrl+Alt+E)`, onclick: () => renameSession() },
      stateIcon(s), ...name,
      h("span", { class: `head-state is-${statusTone(s)}` }, statusWords(s)), sleepMark(s)),
    h("div", { class: "head-btns" },
      // The panel's tabs, while it's closed (open, its own head has them).
      ...(tab ? [] : SIDE_TABS.filter(([k]) => k !== "term" || showTerminals()).map(toggle)),
      h("button", { class: "head-btn more", type: "button", title: "This session (Ctrl+Alt+M)", "aria-label": "This session",
                    onclick: () => sessionMenu(s) }, glyph("more"))));
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
    this.claude = new TermPane("claude", { mic: true });
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
      kids.push(h("div", { class: "bg-row" }, icon("helper"), h("span", { class: "what" }, `Background session ${b.name}`),
                  h("span", { class: "muted" }, [b.status, b.started ? `since ${ago(b.started)}` : ""].filter(Boolean).join(" · "))));
    kids.push(h("div", { class: "section" }, "Ids"),
      item("Session", h("code", {}, d.id)),
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

// Esc in the box (empty) while Claude works stops it, as Esc in its terminal did.
function chatKeys() {
  desk.column.addEventListener("keydown", (e) => {
    const c = desk.chat;
    if (e.key !== "Escape" || !c || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target === c.input && !c.input.value.trim() && c.working()) {
      e.preventDefault();
      c.stop();
    }
  });
}

// Typing with the keyboard nowhere in particular: into the box you type in.
function typeToChat(e) {
  const c = desk.chat;
  // No chat: the new chat's box, when it's there.
  const fresh = !c && desk.newChat && desk.newChat.el.isConnected && !desk.empty.hidden ? desk.newChat : null;
  if ((!c && !fresh) || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return;
  const at = document.activeElement;
  if (at && at !== document.body && (at.matches("input, textarea, [contenteditable], select") || at.closest(".term-box, .sheet-back, .picker-back, .bar-drop, .card")))
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
  if (!desk.current) return;
  if (desk.focus === "term" && sideTab() === "term") desk.terminal.focus();
  else toChat();
}

// The look changed: the terminals wear it again.
function deskRestyle() {
  if (desk.terminal) desk.terminal.restyle();
}

// The list changed (app.js's events): the panel, the header, the Ⓐ, and the
// chime for a session that went on to need you or finished.
function deskList() {
  if (!desk.el) return;
  const v = app.view;
  if (v && desk.current && !row(desk.current)) {     // closed: on to the next one in the list
    const ids = desk.order || [];
    const at = ids.indexOf(desk.current);
    const next = [...ids.slice(at + 1), ...ids.slice(0, Math.max(at, 0)).reverse()].find((id) => row(id))
      || (v.sessions[0] || {}).id;
    if (next) return go2(next);
    return show(null);
  }
  if (v && !desk.current && !desk.fresh && v.sessions.length) return deskRoute();
  if (!desk.current) drawEmpty(false);      // the welcome, once there's a project: the new chat
  if (desk.pending && (row(desk.pending.id) || Date.now() > desk.pending.until)) return deskRoute();
  chime(v);
  const waiting = v ? v.sessions.filter((s) => s.status === "waiting").length : 0;
  document.title = waiting ? `(${waiting}) Amarchy` : "Amarchy";
  for (const b of [desk.brand, desk.ball]) b.classList.toggle("lit", waiting > 0);
  // Show terminals turned on or off: the panel and the header follow.
  const shows = showTerminals();
  if (shows !== desk.shows) { desk.shows = shows; deskLayout(); } else deskHead();
  desk.toolbar.hidden = !v || !v.sessions.length;      // nothing to search yet
  desk.organize.hidden = desk.organize.hidden || !v || !v.sessions.length;
  if (!desk.organize.hidden) keepFocus(desk.organize, () => desk.organize.replaceChildren(...organizeMenu()));
  const shown = fillList(desk.listEl, desk.query, desk.cursor || desk.current);
  if (!desk.query) desk.order = shown.map((x) => x.id);     // already in list order: the assistant's first
  const drop = document.querySelector(".bar-drop");
  if (drop) drop.refresh();
}

// The sessions as the list beside the chat draws them, the cursor's on the
// one you're in (or the one you move it to).
function fillList(list, query, cursorId) {
  const v = app.view;
  // The list is redrawn on every change: its scroll stays where it was, and
  // the cursor is brought into view only when it moved (a key, a click), not
  // when a session comes or goes under it.
  const box = list.parentElement;
  const top = box ? box.scrollTop : 0;
  const cursor = cursorId || "";
  list.replaceChildren();
  if (!v) {
    list.append(h("div", { class: "empty" }, app.failed || "Connecting…"));
    return [];
  }
  const shown = matching(v.sessions, query);
  const prev = list.dataset.cursor;
  // Moved: to a session the list had (or from none). Not from one that's gone.
  const moved = cursor !== (prev || "") && (!prev || shown.some((s) => s.id === prev));
  list.dataset.cursor = cursor;
  if (!v.sessions.length) list.append(h("div", { class: "empty" }, (v.projects || []).length ? "No chats yet" : "No projects yet"));
  else if (!shown.length) list.append(h("div", { class: "empty" }, `No chat matches “${query.trim()}”`));
  const place = (el, s) => {
    el.dataset.id = s.id;
    el.classList.toggle("cursor", s.id === cursorId);
    el.addEventListener("contextmenu", (e) => { e.preventDefault(); rowMenu(s); });
    return el;
  };
  // Your assistant first, in a place of its own above the groups, as on the phone.
  const mine = shown.filter((s) => s.assistant);
  if (mine.length)
    list.append(h("div", { class: "assistant-section" },
      ...mine.map((s) => place(s.assistant === "main" ? assistantCard(s) : sessionRow(s, [], true), s))));
  grouped(list, shown, v.group || [], (s) => place(sessionRow(s, v.group || []), s));
  if (box) box.scrollTop = top;
  const cur = list.querySelector(".row.cursor");
  if (cur && moved) cur.scrollIntoView({ block: "nearest" });
  return shown;
}

// In the search (beside the chat, or under the Ⓐ): ↑/↓ move, ↵ goes there, Esc leaves.
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
  deskRefocus();
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

// ---- the Ⓐ in the bar: your sessions, dropped from it (in zen mode, the way to them)

function barDrop(search) {
  const open = document.querySelector(".bar-drop");
  if (open) { open.close(); return; }
  const input = h("input", { type: "search", placeholder: "Search sessions", autocomplete: "off", spellcheck: "false" });
  const list = h("div", { class: "list" });
  const back = h("div", { class: "bar-shade", onclick: () => drop.close() });
  const drop = h("div", { class: "bar-drop" },
    h("div", { class: "bar-drop-top" }, h("label", { class: "searchbox" }, glyph("search"), input),
      h("button", { class: "picker-close", "aria-label": "Close", title: "Close (Esc)", tabindex: "-1", onclick: () => drop.close() }, glyph("close"))),
    h("div", { class: "scroll" }, list));
  let query = "";
  drop.refresh = () => fillList(list, query, desk.cursor || desk.current);
  drop.close = () => { back.remove(); drop.remove(); desk.cursor = null; deskRefocus(); };
  input.addEventListener("input", () => { query = input.value; desk.cursor = null; drop.refresh(); });
  // The session list's keys: j/k and ↵ in the list, / to search,
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

// ---- the keys: amarchy's, Ctrl+Alt+… (Super is the browser's or the Mac's)

const DESK_KEYS = {
  KeyJ: () => step(1), KeyK: () => step(-1),
  KeyS: () => deskSearch(), KeyZ: () => toggleZen(),
  ArrowLeft: () => toChat(), ArrowRight: () => toTerminal(),
  KeyG: () => desk.current && sideToggle("changes"), KeyI: () => desk.current && sideToggle("details"),
  KeyB: () => desk.current && toggleSide(), KeyF: () => desk.current && sideTab() && sideWide(),
  KeyL: () => classicTerminal(),
  KeyR: () => runProject(), KeyC: () => pickCommand(),
  KeyN: () => newSession(), KeyP: () => newProject(), KeyT: () => openLook(),
  ArrowUp: () => desk.current && setPriority(row(desk.current), "up"),
  ArrowDown: () => desk.current && setPriority(row(desk.current), "down"),
  KeyE: () => renameSession(), KeyM: () => deskMenu(), KeyX: () => closeCurrent(), KeyA: () => barDrop(),
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
  requestAnimationFrame(() => deskRefocus());
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
  if (here() === "#/new" && !desk.current) {
    if (desk.newChat) desk.newChat.focus();
    return;
  }
  go("#/new");
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
    toast(`${name} is one of your projects now`);
    newChatIn(known.includes(name) ? name : (d.name || name));
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
                                                act: () => organizeList(groups, what) })),
    { label: "Order projects…", icon: "order", act: () => orderProjects() }] });
}

// The amarchy menu (Ctrl+Alt+M): everything you can do from here, with its key.
function deskMenu() {
  const s = row(desk.current);
  const on = (x) => (x ? "on" : "");
  const items = [
    { label: "New chat", icon: "plus", key: "Ctrl+Alt+N", act: () => newSession() },
    { label: "New project", icon: "plus", key: "Ctrl+Alt+P", act: () => newProject() },
  ];
  if (s) items.push(
    { label: "View", icon: "status", group: () => ({ title: "View", items: viewItems() }) },
    { label: "Run", icon: "send", group: () => ({ title: "Run", items: [
      { label: "Run the project", key: "Ctrl+Alt+R", act: () => runProject() },
      { label: "Run a command…", key: "Ctrl+Alt+C", act: () => pickCommand() },
      { label: "Saved commands…", detail: "change, forget", act: () => commandsSheet(s, () => toTerminal("term")) },
      { label: "The terminal", key: "Ctrl+Alt+→", act: () => toTerminal("term") }] }) },
    { label: "This session", icon: "more", group: () => ({ title: s.task || where(s), items: sessionItems(s) }) });
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
      { label: "Notifications, layout…", act: () => openSettings() },
      { label: "Theme, font, wallpaper…", key: "Ctrl+Alt+T", act: () => openLook() },
      { label: "Sound…", detail: "the chimes, each played as you pick it", act: () => soundSheet(false) },
      { label: "Keys", act: () => showKeys() }] }) });
  picker({ title: "Amarchy", items });
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
    { label: "Zen mode", detail: on(desk.zen), key: "Ctrl+Alt+Z", act: () => toggleZen() },
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
      { label: "Open terminal", detail: "the session's own, in the side panel", key: "Ctrl+Alt+→", act: () => toTerminal("term") },
      ...(classicAllowed() ? [{ label: "Open Claude's classic terminal", detail: "Claude Code's own, same conversation", key: "Ctrl+Alt+L", act: () => classicTerminal() }] : []),
      { label: "Details", detail: "branch, worktree, model, mode", key: "Ctrl+Alt+I", act: () => sideToggle("details", true) }] }) },
    { label: "Close", key: "Ctrl+Alt+X", danger: true, act: () => closeCurrent() },
  ];
}

function sessionMenu(s) {
  picker({ title: s.task || where(s), items: sessionItems(s) });
}

function showKeys() {
  const keys = [["Ctrl+Alt+J / K", "Next / previous session"], ["Ctrl+Alt+S", "Search sessions"],
    ["Ctrl+Alt+Z", "Zen mode: the list hidden"],
    ["Ctrl+Alt+← / →", "The chat / the terminal"],
    ...(classicAllowed() ? [["Ctrl+Alt+L", "Claude's classic terminal"]] : []),
    ["Ctrl+Alt+G / I", "Changes / Details, beside the chat"], ["Ctrl+Alt+B", "Open or close the side panel"],
    ["Ctrl+Alt+F", "The side panel full width"], ["Ctrl+Alt+R", "Run the project"],
    ["Ctrl+Alt+C", "Run a command"], ["Ctrl+Alt+N / P", "New chat / new project"],
    ["Ctrl+Alt+Up / Down", "Raise / lower priority"], ["Ctrl+Alt+E", "Rename"], ["Ctrl+Alt+M", "Amarchy menu"],
    ["Ctrl+Alt+X", "Close this session"], ["Ctrl+Alt+T", "Theme, font and wallpaper"], ["Ctrl+Alt+A", "Your sessions, in a list to pick from"],
    ["Ctrl+Alt+Space / Enter", "Dictate into the chat: hold, or tap and tap again"],
    ["Enter / Shift+Enter", "Send / a new line, in the chat"], ["Esc", "Stop Claude, in the chat's empty box"],
    ["⌘V / drop", "An image goes with your next message"],
    ["Hold Space", "In Claude's classic terminal: dictate (/voice) with this computer's microphone"]];
  sheet(sheetHead("Keys", "amarchy's, in the browser"),
    h("div", { class: "keys-table" }, ...keys.map(([k, what]) => h("div", { class: "keys-row" }, h("kbd", {}, k), h("span", {}, what)))));
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
