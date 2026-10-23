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
//                         terminal), the terminal, and on the phone the keys
//                         its keyboard hasn't
//   t.open(id) / t.close()  attach it to a session / let go (when it's hidden)
//   t.show("term"|"claude") / t.which()   which terminal it shows
//   t.classic()           Claude's classic terminal: held on (a heartbeat)
//                         while it shows; leaving it, or "Back to chat", puts
//                         the session back on the chat engine
//   t.fit() t.restyle() t.focus()
//
// Whether the app shows terminals at all is the host's "Show terminals"
// (app.view.show_terminals, amarchy terminals on|off): off, a session's menu
// still opens them (Advanced). Loaded after desk.js and before chat.js and
// app.js, whose helpers it uses at run time (h, glyph, api, toast, store,
// sheet...).
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
    this.el = h("div", { class: `session-term${this.phone ? " phone" : ""}` }, this.bar, this.banner, this.body, this.keysEl);
  }

  // The phone's row of keys: they go to the terminal shown; Ctrl waits for
  // the next key (typed, or one of these) and sends it as Ctrl+that.
  buildKeys() {
    this.ctrlBtn = null;
    const button = ([label, key]) => {
      const b = h("button", { class: "control", type: "button", "aria-label": label === "^C" ? "Ctrl+C" : label === "^D" ? "Ctrl+D" : label },
                  label);
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
      const p = this.panes[which] = new TermPane(which, this.phone ? { size: phoneSize } : {});
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
    }
    this.closed = false;
    await this.show(this.shown, { quiet: true });
  }

  close() {
    this.closed = true;
    releaseClassic(this.id);
    for (const p of Object.values(this.panes)) p.disconnect();
  }

  // Show one of the two (and attach it), the other let go of. Leaving
  // Claude's classic terminal lets go of the session (back to the chat).
  async show(which, { quiet } = {}) {
    this.shown = which === "claude" ? "claude" : "term";
    if (this.id) store.set(`term-shown:${this.id}`, this.shown);
    if (this.shown !== "claude") releaseClassic(this.id);
    this.setCtrl(false);
    const p = this.pane(this.shown);
    const other = this.panes[this.shown === "claude" ? "term" : "claude"];
    if (other) other.disconnect();
    this.body.replaceChildren(p.box);
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
    if (this.ctrlBtn) this.ctrlBtn.classList.toggle("on", on);
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

  async commands() {
    let cmds = [];
    try {
      const r = await fetch(`/api/session/${encodeURIComponent(this.id)}/commands`);
      cmds = (await r.json()).commands || [];
    } catch (e) { return toast("Can't reach Amarchy"); }
    const s = this.row();
    if (app.desk && typeof picker === "function") {
      return picker({ title: `Run in ${projectName(s.repo) || "the project"}`, items: [
        ...cmds.map((c) => ({ label: c.name, detail: c.command, icon: "send", act: () => this.run(c.name === "run" ? undefined : c.name) })),
        { label: "Save a new command…", icon: "plus", always: true, act: () => this.saveCommand() }] });
    }
    sheet(sheetHead(`Run in ${projectName(s.repo) || "the project"}`, "In this chat's terminal; again restarts it"),
      h("div", { class: "menu" }, ...cmds.map((c) => h("button", { class: "menu-item", onclick: () => { closeSheets(); this.run(c.name === "run" ? undefined : c.name); } },
        h("span", { class: "label" }, h("span", { class: "text" }, c.name, h("small", {}, c.command)))))),
      h("button", { class: "control wide", onclick: () => this.saveCommand() }, "Save a new command…"));
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
    h("p", {}, on ? "The project's terminal and Claude's classic terminal open in each chat: the Terminal tab on the phone, the panel beside the chat on a computer."
                  : "Just the chat. A chat's terminals are still in its menu, under Advanced, for when you need one.")];
}
