// A session's terminals, as a view of their own beside its chat: the
// project's terminal (the session's own, where the project runs: a command,
// a password typed in) and Claude's classic terminal (Claude Code's own
// app, for what the chat can't do: /login, /config...). One
// component for the phone's Terminal tab (app.js's SessionView) and the
// wide layout's side panel (desk.js), both real terminals (desk.js's
// TermPane) attached to the session's tmux on the host.
//
//   const t = new SessionTerminal({ id, phone, onShow(which), onBack() });
//   t.el                  a toolbar (Run, the saved commands; Claude's classic
//                         terminal), the terminal, on the phone the keys its
//                         keyboard hasn't, and under them the message line
//   t.open(id) / t.close()  attach it to a session / let go (when it's hidden)
//   t.show("term"|"claude") / t.which()   which terminal it shows
//   t.classic()           Claude's classic terminal: held on (a heartbeat)
//                         while it shows; leaving it, or "Back to chat", puts
//                         the session back on the chat engine
//   t.fit() t.restyle() t.focus()
//
// Used as a messaging app's chat is, on the phone and on a computer alike:
// the message line (uiComposer: write, dictate, paste, send), + (Paste,
// Select text, a picture or a file), a finger held on the terminal (a
// right click) for Paste and Select text, and a swipe to scroll it back
// (TermPane's touching).
//
// Whether the app shows terminals at all is the host's "Show terminals"
// (app.view.show_terminals, amarchy terminals on|off): off, a session's menu
// still opens them (Advanced). Loaded after desk.js and before chat.js and
// app.js, whose helpers it uses at run time (h, glyph, icon, api, toast,
// store, uiDropdown, Dictate, claudeImage, pickFiles, base64Of, clipText...).
"use strict";

// Show terminals, as the host says (undefined until the list came: shown).
function terminalsShown() {
  return !app.view || app.view.show_terminals !== false;
}

async function setTerminalsShown(on) {
  await api("/api/terminals", { on });
  if (app.view) app.view.show_terminals = on;
}

// Claude's classic terminal is held on only while the app shows it: a
// heartbeat every 15 s keeps the session on the terminal engine. Leaving it
// asks for the chat at once (the server also goes back on its own once the
// heartbeat stops). One session at a time.
const CLASSIC_BEAT_MS = 15000;
let classicHeld = null;     // { id, timer }

// The session on Claude's classic terminal (from the chat engine first, the
// same conversation). False, with the reason in a toast, when it can't be.
async function holdClassic(id, engine) {
  if (classicHeld && classicHeld.id === id) return true;
  releaseClassic();
  const enc = encodeURIComponent(id);
  try {
    if (engine === "chat") await api(`/api/session/${enc}/engine`, { engine: "terminal" });
    await api(`/api/session/${enc}/classic`, {});
  } catch (e) {
    toast(e.message);      // Claude works or asks something: once it's done
    return false;
  }
  const held = { id, timer: null };
  held.timer = setInterval(() => beatClassic(held), CLASSIC_BEAT_MS);
  classicHeld = held;
  return true;
}

function beatClassic(held) {
  api(`/api/session/${encodeURIComponent(held.id)}/classic`, {}).catch((e) => {
    clearInterval(held.timer);      // no longer on the terminal engine: stop
    if (classicHeld === held) classicHeld = null;
    toast(e.message);
  });
}

// Let go of Claude's classic terminal: the session goes back to the chat.
// With an id, only if that session is the one held.
function releaseClassic(id) {
  const held = classicHeld;
  if (!held || (id && held.id !== id)) return;
  clearInterval(held.timer);
  classicHeld = null;
  api(`/api/session/${encodeURIComponent(held.id)}/engine`, { engine: "chat" }).catch(() => {});
}

// The keys a phone's keyboard hasn't, as a terminal sends them.
const TERM_KEYS = [
  ["Esc", "\x1b"], ["Tab", "\t"], ["Ctrl", "ctrl"], ["↑", "up"], ["↓", "down"], ["←", "left"], ["→", "right"],
  ["^C", "\x03"], ["^D", "\x04"], ["|", "|"], ["~", "~"], ["/", "/"], ["-", "-"],
];
// Claude's classic terminal also takes these: its menus are picked with them.
const CLASSIC_KEYS = [["⇧Tab", "\x1b[Z"], ["⏎", "\r"], ["1", "1"], ["2", "2"], ["3", "3"]];
const ARROWS = { up: "A", down: "B", right: "C", left: "D" };
// What a key button says to a screen reader (its label is a symbol).
const SPOKEN = { "⇧Tab": "Shift+Tab", "⏎": "Enter", "↑": "Up arrow", "↓": "Down arrow", "←": "Left arrow", "→": "Right arrow",
                 "^C": "Control+C", "^D": "Control+D", "|": "Pipe", "~": "Tilde", "/": "Slash", "-": "Dash", "Ctrl": "Control",
                 "A−": "Smaller text", "A+": "Bigger text" };

class SessionTerminal {
  constructor(opts) {
    this.opts = opts || {};
    this.id = this.opts.id || null;
    this.phone = !!this.opts.phone;
    this.shown = "term";
    this.panes = {};
    this.ctrl = false;
    this.build();
  }

  build() {
    this.runBtn = h("button", { class: "control", type: "button", "aria-label": "Run the project", onclick: () => this.run() }, "Run");
    this.cmdsBtn = h("button", { class: "control", type: "button", "aria-label": "The project's commands",
                                 onclick: () => this.commands() }, "Commands…");
    this.classicBtn = h("button", { class: "control", type: "button", onclick: () => this.classic() },
                        this.phone ? "Claude's classic" : "Claude's classic terminal");
    this.bar = h("div", { class: "term-bar" }, this.runBtn, this.cmdsBtn, h("span", { class: "term-gap" }), this.classicBtn);
    // Over Claude's classic terminal: what it is, and the way back.
    this.banner = h("div", { class: "term-banner", hidden: true },
      h("div", { class: "text" }, h("b", {}, "Claude's classic terminal"),
        h("span", {}, "The chat is the usual way. This is for what it can't do: logins, /config, an MCP login…")),
      h("div", { class: "actions" },
        h("button", { class: "control", type: "button", onclick: () => this.show("term") }, "Project terminal"),
        h("button", { class: "control accent", type: "button", onclick: () => this.back() }, "Back to chat")));
    this.body = h("div", { class: "term-body" });
    this.keysEl = this.phone ? this.buildKeys() : null;
    this.lineEl = this.buildLine();
    // Where a finger was held (or a right click was): its menu opens there.
    this.point = h("span", { class: "term-point", "aria-hidden": "true" });
    this.el = h("div", { class: `session-term${this.phone ? " phone" : ""}` }, this.bar, this.banner, this.body, this.keysEl, this.lineEl, this.point);
  }

  // ---- the message line: under the terminal, as a messaging app's box
  //
  // What you write there (with the phone's own keyboard: its autocorrect,
  // its dictation, holding it to paste; or the mic) goes to the terminal
  // shown when you send it, as one paste, and Enter after it: a command
  // runs, Claude gets the message. Sent empty, it's Enter alone. + adds a
  // picture or a file (Claude's: into its prompt; else saved in the project
  // and its path typed), pastes, or selects the terminal's text to copy.

  buildLine() {
    this.field = h("textarea", { rows: 1, enterkeyhint: "send", autocomplete: "off", "aria-label": "Message to the terminal",
                                 oninput: () => this.lineTyped() });
    this.field.addEventListener("keydown", (e) => {
      // Dictating: Enter or Esc stops it, the words stay (dictate.js).
      if (this.talk.keyStops(e)) { e.preventDefault(); e.stopPropagation(); return; }
      // Enter sends, on the phone too (a terminal's line is one line);
      // Shift+Enter is a new line in it.
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.sendLine();
      }
    });
    // A picture or a file pasted into it goes as + would add it (text
    // pasted is text, even with a picture of it along, as from a sheet).
    this.field.addEventListener("paste", (e) => {
      const d = e.clipboardData;
      const files = d ? Array.from(d.files || []) : [];
      if (!files.length || (d.getData("text/plain") || "").trim()) return;
      e.preventDefault();
      this.addFiles(files);
    });
    this.addBtn = uiComposerButton("attach", "Paste, copy, a picture or a file", icon("plus"), () => this.addMenu(),
                                   { "aria-haspopup": "menu", "data-dropdown": "term-add" });
    this.micBtn = uiComposerButton("mic", "Dictate (hold, or tap and tap again)", glyph("mic"), null, { hidden: true });
    this.sendBtn = uiComposerButton("send", "Enter", glyph("enter"), () => this.sendLine());
    // A tap on them mustn't take the keyboard away from the box.
    for (const b of [this.addBtn, this.sendBtn]) b.addEventListener("pointerdown", (e) => { if (document.activeElement === this.field) e.preventDefault(); });
    this.talk = new Dictate({ field: this.field, button: this.micBtn, changed: () => this.lineTyped(),
                              state: (text) => this.listening(text) });
    this.line = uiComposer({ field: this.field, before: [this.addBtn], after: [this.micBtn, this.sendBtn], cls: "term-line" });
    this.uploading = 0;
    this.lineWords();
    return h("div", { class: "term-compose" }, this.line);
  }

  // Its words for the terminal shown: a command (no autocorrect, no
  // capitals), or Claude's (a message, as you'd write one).
  lineWords() {
    const claude = this.shown === "claude";
    this.field.placeholder = claude ? "Write to Claude" : "Type a command";
    this.field.setAttribute("autocapitalize", claude ? "sentences" : "off");
    this.field.setAttribute("autocorrect", claude ? "on" : "off");
    this.field.setAttribute("spellcheck", claude ? "true" : "false");
    this.field.value = (this.id && store.get(`term-draft:${this.id}:${this.shown}`)) || "";
    this.lineTyped(false);
  }

  lineTyped(keep = true) {
    if (keep && this.id) store.set(`term-draft:${this.id}:${this.shown}`, this.field.value);
    uiFitField(this.field, { max: Math.max(80, window.innerHeight * 0.3) });
    this.micBtn.hidden = !this.talk.available();
    // Empty, it's Enter (⏎); with words, Send (↑).
    const empty = !this.field.value.trim();
    this.sendBtn.replaceChildren(glyph(empty ? "enter" : "send"));
    this.sendBtn.setAttribute("aria-label", empty ? "Enter" : "Send (and Enter)");
    this.sendBtn.disabled = this.talk.on();
    this.line.classList.toggle("ready", !empty);
  }

  // While dictating: what's going on, where the placeholder is.
  listening(text) {
    this.line.classList.toggle("listening", text !== null);
    if (text !== null) this.field.placeholder = text;
    else this.lineWords();
    this.lineTyped(false);
  }

  // What's written goes, as a paste (whole, a new line in it runs nothing),
  // then Enter; nothing written: Enter alone. The terminal back at its
  // bottom first (scrolled back, tmux would take the keys as its own).
  sendLine() {
    if (this.talk.on()) return;
    const p = this.active;
    if (!p || !p.live()) return toast("The terminal isn't connected yet: a moment");
    if (this.uploading) return toast("A file is still on its way: a moment");
    const text = this.field.value.replace(/[\r\n]+$/, "");
    this.setCtrl(false);
    // In the order sent (one sent right after another waits for its Enter).
    const go = async () => {
      if (text) p.paste(text);      // (at the bottom first: TermPane.paste)
      else p.bottom();
      // Enter a moment after the paste: Claude takes a key right on a
      // paste's heels as part of it.
      if (text) await new Promise((ok) => setTimeout(ok, 60));
      p.send(enc.encode("\r"));
    };
    this.sending = (this.sending || Promise.resolve()).then(go, go);
    this.field.value = "";
    this.lineTyped();
  }

  // A word at the cursor in the box: a space between it and what's there.
  insert(word) {
    const f = this.field, at = f.selectionStart ?? f.value.length, end = f.selectionEnd ?? at;
    const before = f.value.slice(0, at), after = f.value.slice(end);
    const add = `${before && !/\s$/.test(before) ? " " : ""}${word}${after && !/^\s/.test(after) ? " " : ""}`;
    f.value = before + add + after;
    f.selectionStart = f.selectionEnd = before.length + add.length;
    this.lineTyped();
  }

  // + : what you can do here, the long-press menu's first.
  addMenu() {
    if (uiDropdownOpen("term-add")) return uiDropdownClose();
    const phone = matchMedia("(pointer: coarse)").matches;
    const claude = this.shown === "claude";
    const saved = "Saved in the project, its path typed";
    uiDropdown(this.addBtn, [
      ...this.pressItems(),
      { icon: "image", label: phone ? "Photos" : "A picture", detail: claude ? "Into Claude's prompt" : saved, act: () => this.pick("photos") },
      ...(phone ? [{ icon: "camera", label: "Take a photo", detail: claude ? "Into Claude's prompt" : saved, act: () => this.pick("camera") }] : []),
      { icon: "file", label: "A file", detail: saved, act: () => this.pick("files") },
    ], { label: "Add", key: "term-add" });
  }

  // Paste and Select text: the long-press (right-click) menu, and the +'s;
  // Copy first when there's a selection in the terminal (Shift and drag).
  pressItems() {
    const p = this.active, picked = p && p.term && p.term.hasSelection() ? p.term.getSelection() : "";
    return [
      ...(picked ? [{ icon: "copy", label: "Copy", detail: "What you selected", act: () => copyText(picked).then((ok) => ok && toast("Copied")) }] : []),
      { icon: "paste", label: "Paste", detail: "What you copied, into the terminal", act: () => this.pasteClip() },
      { icon: "select", label: "Select text", detail: "Copy any of what it printed", act: () => this.selectText() },
    ];
  }

  // A finger held on the terminal (a right click on a computer): the menu, there.
  holdMenu(x, y) {
    if (!this.id) return;
    if (navigator.vibrate) navigator.vibrate(10);
    this.point.style.left = `${Math.round(x)}px`;
    this.point.style.top = `${Math.round(y)}px`;
    uiDropdown(this.point, this.pressItems(), { label: "Terminal" });
  }

  async pick(what) {
    const files = await pickFiles(what === "files" ? "" : "image/*", { multiple: what !== "camera", capture: what === "camera" });
    if (files.length) this.addFiles(files);
  }

  // Pictures and files for the terminal shown. Claude's takes a picture
  // into its prompt, as Ctrl+V does ([Image #1]); anything else is saved in
  // the project (.amarchy/uploads/, never committed) and its path typed:
  // into the box (into: "line"), or straight into the terminal ("term":
  // pasted or dropped on it).
  async addFiles(files, { into = "line" } = {}) {
    const p = this.active;
    if (!p || !this.id) return;
    for (const f of files) {
      if (this.shown === "claude" && /^image\//.test(f.type) && !/svg/.test(f.type)) {
        let img = null;
        try { img = await claudeImage(f); } catch (e) { /* one the browser can't read (HEIC on a computer): a file then */ }
        if (img && await p.pasteImage(img)) { toast("In Claude's prompt: it goes with what you send next"); continue; }
        if (img) continue;      // it said why
      }
      const path = await this.upload(f);
      if (!path) continue;
      if (into === "term") p.paste(`${shellWord(path)} `);
      else this.insert(shellWord(path));
    }
    if (into === "line" && document.activeElement !== this.field && !this.phone) this.field.focus({ preventScroll: true });
  }

  // A file into the worktree's .amarchy/uploads/: its whole path, or null.
  async upload(file) {
    if (file.size > UPLOAD_MAX) { toast(`${file.name} is too big (50 MB at most)`); return null; }
    this.uploading++;
    this.lineTyped(false);
    toast(`Uploading ${file.name || "the file"}…`);
    try {
      const r = await api(`/api/session/${encodeURIComponent(this.id)}/upload`, { name: file.name || "file", data: await base64Of(file) });
      toast(`Saved in the project as ${r.path}`);
      return r.full || r.path;
    } catch (e) {
      toast(`${file.name || "The file"} didn't upload: ${e.message}`);
      return null;
    } finally {
      this.uploading--;
      this.lineTyped(false);
    }
  }

  // Paste: what you copied, into the terminal at its cursor (a picture as +
  // takes one). The browser asks first on a phone (iOS: its Paste button);
  // where it won't let a page read it, holding the box pastes there.
  async pasteClip() {
    const p = this.active;
    if (!p || !p.live()) return toast("The terminal isn't connected yet: a moment");
    // (iOS shows its Paste button once: turned down, it isn't asked again.)
    const cb = navigator.clipboard;
    let items = null;
    if (cb && cb.read) {
      try { items = await cb.read(); } catch (e) { /* not allowed */ }
    }
    if (items) {
      for (const item of items) {
        const type = item.types.find((t) => /^image\//.test(t));
        if (type && !item.types.includes("text/plain")) {
          const blob = await item.getType(type);
          return this.addFiles([new File([blob], `pasted.${type.split("/")[1].replace("jpeg", "jpg")}`, { type })], { into: "term" });
        }
        if (item.types.includes("text/plain")) return this.pasteText(await (await item.getType("text/plain")).text());
      }
      return toast("Nothing to paste: copy something first");
    }
    let text = null;
    if (cb && !cb.read && cb.readText) {      // a browser that reads only text
      try { text = await cb.readText(); } catch (e) { /* not allowed */ }
    }
    if (text !== null) return text ? this.pasteText(text) : toast("Nothing to paste: copy something first");
    toast("This browser won't let Amarchy read what you copied: hold the box under the terminal, then Paste");
    this.field.focus();
  }

  pasteText(text) {
    if (!text) return toast("Nothing to paste: copy something first");
    clipText(text);         // the host's wl-paste has it too
    this.active.paste(text);
  }

  // ---- Select text: what the terminal printed, as text to select and copy
  //
  // Over the terminal, still (nothing moves under your finger): its last
  // lines as the host's tmux has them (a line it wrapped whole again, an
  // address too), at their end. Hold a word and drag, as in any message;
  // its addresses are links. Copy all, or Done (Esc).

  async selectText() {
    if (!this.id) return;
    const which = this.shown;
    let text;
    try {
      const r = await fetch(`/api/session/${encodeURIComponent(this.id)}/tty/${which}/text`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't read the terminal");
      text = d.text || "";
    } catch (e) {
      return toast(e instanceof TypeError ? "Can't reach Amarchy" : e.message);
    }
    if (this.shown !== which) return;
    this.unselect();
    const pre = h("pre", { class: "term-text-body", tabindex: "0" }, ...linkified(text));
    pre.addEventListener("copy", () => clipText(String(getSelection() || "")));
    const copyAll = h("button", { class: "control", type: "button", onclick: () => this.copyAll(text, pre) }, "Copy all");
    const done = h("button", { class: "control accent", type: "button", onclick: () => this.unselect(true) }, "Done");
    this.selecting = h("div", { class: "term-text", role: "dialog", "aria-label": "The terminal's text" },
      h("div", { class: "term-text-bar" },
        h("span", { class: "term-text-hint" }, matchMedia("(pointer: coarse)").matches ? "Hold a word to select" : "Select, then copy"),
        copyAll, done),
      pre);
    this.selecting.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.unselect(true); } });
    const pane = this.panes[which];
    if (pane) this.selecting.style.setProperty("--term-text-size", `${pane.size()}px`);
    this.body.append(this.selecting);
    this.el.classList.add("selecting");
    pre.scrollTop = pre.scrollHeight;
    if (!this.phone) pre.focus({ preventScroll: true });
  }

  unselect(back = false) {
    if (!this.selecting) return;
    this.selecting.remove();
    this.selecting = null;
    this.el.classList.remove("selecting");
    if (back && !this.phone) this.focus();
  }

  async copyAll(text, pre) {
    clipText(text);
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied: all of it");
    } catch (e) {
      // Not allowed: all of it selected, for the browser's own Copy.
      const r = document.createRange();
      r.selectNodeContents(pre);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      toast("All of it selected: now Copy");
    }
  }

  // The phone's row of keys: they go to the terminal shown; Ctrl waits for
  // the next key (typed, or one of these) and sends it as Ctrl+that.
  buildKeys() {
    this.ctrlBtn = null;
    const button = ([label, key]) => {
      const b = h("button", { class: "control", type: "button", "aria-label": SPOKEN[label] || label }, label);
      // A tap mustn't take the keyboard away from the terminal.
      b.addEventListener("pointerdown", (e) => e.preventDefault());
      b.addEventListener("click", () => this.key(key));
      if (key === "ctrl") this.ctrlBtn = b;
      return b;
    };
    this.classicKeys = h("div", { class: "keys term-keys classic" }, ...CLASSIC_KEYS.map(button));
    // The text bigger or smaller (kept for next time), at the end of the row.
    const size = (label, d, name) => {
      const b = h("button", { class: "control", type: "button", "aria-label": name }, label);
      b.addEventListener("pointerdown", (e) => e.preventDefault());
      b.addEventListener("click", () => this.size(d));
      return b;
    };
    return h("div", { class: "term-keyrows" }, this.classicKeys,
      h("div", { class: "keys term-keys" }, ...TERM_KEYS.map(button), size("A−", -1, "Smaller text"), size("A+", 1, "Bigger text")));
  }

  pane(which) {
    if (!this.panes[which]) {
      const p = this.panes[which] = new TermPane(which, {
        ...(this.phone ? { size: phoneSize } : {}),
        hold: (x, y) => this.holdMenu(x, y),
        files: (files) => this.addFiles(files, { into: "term" }) });
      // Ctrl from the keys row, on what's typed next.
      const send = p.send.bind(p);
      p.send = (data) => {
        if (this.ctrl && data && data.length === 1) {
          const c = data[0];
          const ch = c >= 97 && c <= 122 ? c - 96 : c >= 64 && c <= 95 ? c - 64 : c === 32 ? 0 : null;
          this.setCtrl(false);
          if (ch !== null) return send(Uint8Array.of(ch));
        }
        return send(data);
      };
    }
    return this.panes[which];
  }

  which() { return this.shown; }

  get active() { return this.panes[this.shown] || null; }

  async open(id) {
    if (id && id !== this.id) {
      releaseClassic();
      for (const p of Object.values(this.panes)) p.disconnect();
      this.id = id;
      this.shown = "term";      // Claude's classic terminal is held on only when asked for
      this.unselect();
    }
    this.closed = false;
    await this.show(this.shown, { quiet: true });
  }

  close() {
    this.closed = true;
    releaseClassic(this.id);
    this.unselect();
    if (this.talk.on()) this.talk.stop();
    for (const p of Object.values(this.panes)) p.disconnect();
  }

  // Show one of the two (and attach it), the other let go of. Leaving
  // Claude's classic terminal lets go of the session (back to the chat).
  async show(which, { quiet } = {}) {
    const was = this.shown;
    this.shown = which === "claude" ? "claude" : "term";
    if (this.id && store.get(`term-shown:${this.id}`) !== this.shown) store.set(`term-shown:${this.id}`, this.shown);
    if (this.shown !== "claude") releaseClassic(this.id);
    this.setCtrl(false);
    if (was !== this.shown) this.unselect();
    // The message line's words for this one (its draft, its keyboard).
    if (!this.talk.on()) this.lineWords();
    const p = this.pane(this.shown);
    const other = this.panes[this.shown === "claude" ? "term" : "claude"];
    if (other) other.disconnect();
    // Already there: left as it is (taken out and back, its terminal would lose the keyboard).
    if (p.box.parentNode !== this.body) this.body.replaceChildren(p.box);
    const classic = this.shown === "claude";
    this.banner.hidden = !classic;
    this.runBtn.hidden = this.cmdsBtn.hidden = this.classicBtn.hidden = classic;
    this.el.classList.toggle("classic", classic);
    if (this.classicKeys) {
      this.classicKeys.hidden = !classic;
    }
    if (!quiet && this.opts.onShow) this.opts.onShow(this.shown);
    if (this.id && !this.closed) {
      await p.open(this.id);
      p.fit();
    }
  }

  fit() { if (this.active) this.active.fit(); }

  restyle() { for (const p of Object.values(this.panes)) p.restyle(); }

  focus() { if (this.active) this.active.focus(); }

  row() { return (app.view && app.view.sessions.find((s) => s.id === this.id)) || { id: this.id }; }

  // ---- Claude's classic terminal

  // Claude's classic terminal: the session moves to the terminal engine (the
  // conversation carries on) and is held there while this view shows.
  async classic() {
    if (!(await holdClassic(this.id, this.row().engine))) return;
    await this.show("claude");
    if (!this.phone) this.focus();      // (on a phone the keyboard would come up over it)
  }

  // Back to the chat: the session goes back on it.
  async back() {
    releaseClassic(this.id);
    await this.show("term", { quiet: true });
    if (this.opts.onBack) this.opts.onBack();
  }

  // ---- the keys row (phone)

  setCtrl(on) {
    this.ctrl = on;
    if (this.ctrlBtn) { this.ctrlBtn.classList.toggle("on", on); this.ctrlBtn.setAttribute("aria-pressed", String(on)); }
  }

  key(key) {
    const p = this.active;
    if (!p) return;
    if (key === "ctrl") return this.setCtrl(!this.ctrl);
    let data = key;
    if (ARROWS[key]) {
      const app_ = p.term && p.term.modes && p.term.modes.applicationCursorKeysMode;
      data = `\x1b${app_ ? "O" : "["}${ARROWS[key]}`;
    }
    p.send(enc.encode(data));
  }

  size(d) {
    store.set("phone-size", String(Math.max(7, Math.min(24, phoneSize() + d))));
    wearPhoneSize();
    this.restyle();
  }

  // ---- the project's commands

  async run(name) {
    if (!this.id) return;
    try {
      await api(`/api/session/${encodeURIComponent(this.id)}/run`, name ? { name } : {});
      if (this.shown !== "term") await this.show("term");
    } catch (e) {
      if (/No run command/.test(e.message)) return this.saveCommand("run");
      toast(e.message);
    }
  }

  commands() {
    commandsSheet(this.row(), () => { if (this.shown !== "term") this.show("term"); });
  }

  // Save a command for the project (name "run": the run command), then run it.
  saveCommand(name) {
    const s = this.row();
    const save = async (n, cmd) => {
      if (!/^[\w.-]{1,40}$/.test(n)) return toast("A short name: letters, numbers, - and .");
      if (!cmd) return toast("Which command?");
      try {
        await api(`/api/session/${encodeURIComponent(this.id)}/commands`, { name: n, command: cmd });
        closeSheets();
        this.run(n === "run" ? undefined : n);
      } catch (e) { toast(e.message); }
    };
    const nameF = name ? null : field({ placeholder: "Its name (test, build…)", maxlength: "40" }, () => cmdF.focus());
    const cmdF = field({ placeholder: name === "run" ? "npm run dev, bin/dev…" : "The command" },
                       () => save(name || nameF.value.trim(), cmdF.value.trim()));
    sheet(sheetHead(name === "run" ? `How ${projectName(s.repo) || "the project"} runs` : "A new command",
                    "Saved for the project, run in the chat's terminal"),
      ...(nameF ? [h("div", { class: "section" }, "Name"), nameF] : []),
      h("div", { class: "section" }, "Command"), cmdF,
      h("button", { class: "control wide accent", onclick: () => save(name || nameF.value.trim(), cmdF.value.trim()) }, "Save and run"));
    (nameF || cmdF).focus();
  }
}

// A path as a shell reads it, one word: quoted when it has more than
// letters, digits and ./_-+@:,= (a space, a parenthesis: "photo (2).jpg").
function shellWord(s) {
  return /^[\w./+@:,=-]+$/.test(s) ? s : `'${String(s).replace(/'/g, "'\\''")}'`;
}

// Text as nodes, its web addresses links (a tap opens one, holding it copies it).
const TEXT_LINK = /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/g;
function linkified(text) {
  const out = [];
  let at = 0;
  for (const m of text.matchAll(TEXT_LINK)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    const url = m[0];
    out.push(h("a", { href: url, target: "_blank", rel: "noopener noreferrer",
                      onclick: (e) => { e.preventDefault(); openLink(url); } }, url));
    at = m.index + url.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

// Settings → Terminals: Show terminals, for every phone and browser.
function terminalSettings(draw) {
  const on = terminalsShown();
  const set = async (value) => {
    try {
      await setTerminalsShown(value);
      draw();
      refresh();
    } catch (e) { toast(e.message); }
  };
  return [h("div", { class: "section" }, "Terminals"),
    h("div", { class: "seg" }, ...[[true, "Show"], [false, "Hide"]].map(([value, label]) =>
      h("button", { class: `control${on === value ? " on" : ""}`, onclick: () => set(value) }, label))),
    h("p", {}, on ? "The project's terminal and Claude's classic terminal open in each chat: from the chat's menu (⋯) on the phone, the panel beside the chat on a computer."
                  : "Just the chat. A chat's terminals are still in its menu, under Advanced, for when you need one.")];
}
