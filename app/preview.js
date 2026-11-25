// A chat's preview beside it: its page in a frame of the app's own, so you
// talk in the chat while you watch it change. On a computer, the side
// panel's Preview tab (desk.js); on the phone, Chat | Preview (app.js's
// SessionView), as Chat | Terminal. One component for both:
//
//   const pane = new PreviewPane({ phone });
//   pane.el                 its bar (which one, of several; Reload; Open in a
//                           tab) over its stage (the page, or what stands in
//                           for it)
//   pane.show(s, key)       chat s's preview (of several: key's; else the one
//                           you picked last, else its first)
//   pane.hide()             out of sight: its pages stay loaded
//   pane.update()           the list came (each preview's state): drawn again
//
// Its pages stay loaded while you're elsewhere (another tab, another chat,
// the board) and are there as you left them when you come back: a frame
// taken out of the page loads again, so each lives in the pane's stage
// from the moment it's made until it's let go (the pane itself never
// leaves the page: desk.js keeps it in the side panel, the phone's in the
// body). The last few are kept (PREVIEW_KEPT), each until it's gone unseen
// for PREVIEW_KEEP (a page kept open keeps its server from stopping, unused).
//
// What it shows, as the list has the preview: answering, its page; not
// running, Start it (where you are, as its button does); starting, a
// spinner and what it writes; failed, why; an address only nothing answers,
// Ask Claude to start it. A page that won't be shown in another's (its
// X-Frame-Options, its frame-ancestors: bin/amarchy preview_frame reads them)
// says so, with Open in a tab and Ask Claude to allow it. The desktop app
// shows only what its shell lets it (amarchyDesktop.frames: "any", or only
// the tailnet's; one from before, none). Its frames are sandboxed: a page
// can't take the app's window (no top navigation), its links out go to a
// new tab (your browser), and it gets no microphone, camera or place.
"use strict";

const PREVIEW_KEPT = 4;                 // pages kept loaded, at most (the phone: 2)
const PREVIEW_KEEP = 60 * 60 * 1000;    // ms one stays loaded unseen
const PREVIEW_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox " +
                        "allow-modals allow-downloads allow-pointer-lock allow-presentation";
const PREVIEW_ALLOW = "fullscreen; clipboard-write; autoplay; web-share; screen-wake-lock";

const previewPanes = new Set();         // every pane made (one: the desk's or the phone's)
const previewPicked = new Map();        // chat -> the key of the one you last looked at

class PreviewPane {
  constructor({ phone = false } = {}) {
    this.phone = phone;
    this.id = null;               // the chat shown
    this.key = "";                // which of its previews
    this.frames = new Map();      // chat + key -> {iframe, id, key, url, seen, loaded, stale}
    this.checks = new Map();      // chat + key -> {url, frame, why} | {url, pending}
    this.states = new Map();      // chat + key -> its state as last drawn
    this.build();
    previewPanes.add(this);
  }

  build() {
    this.pick = h("div", { class: "preview-pick" });
    this.note = h("span", { class: "preview-note", role: "status" });
    this.reloadBtn = uiTool("reload", "Reload it", () => this.reload(), { title: "Reload the page" });
    this.tabBtn = uiTool("preview", "Open in a tab", () => this.openTab(), { title: "Open it in a tab of its own" });
    this.bar = h("div", { class: "preview-bar" }, this.pick, this.note, h("span", { class: "preview-gap" }), this.reloadBtn, this.tabBtn);
    this.card = h("div", { class: "preview-card", hidden: true });
    this.stage = h("div", { class: "preview-stage" }, this.card);
    this.el = h("div", { class: `preview-pane${this.phone ? " phone" : ""}`, hidden: true }, this.bar, this.stage);
    // Into a page's frame (a tap on it): a dropdown open over it closes, as a tap anywhere else would.
    window.addEventListener("blur", () => setTimeout(() => {
      if (document.activeElement && document.activeElement.tagName === "IFRAME" && this.el.contains(document.activeElement)) uiDropdownClose();
    }));
  }

  // ---- which: a chat, and one of its previews

  show(s, key = null) {
    const id = s && s.id;
    if (!id) return;
    const ps = uiPreviews(rowOf(id) || s);
    const want = key !== null ? key : previewPicked.has(id) ? previewPicked.get(id) : (ps[0] && ps[0].key) || "";
    this.id = id;
    this.key = ps.some((p) => (p.key || "") === want) ? want : (ps[0] && ps[0].key) || "";
    previewPicked.set(id, this.key);
    this.el.hidden = false;
    this.draw();
  }

  hide() {
    if (this.el.hidden) return;
    const f = this.id ? this.frames.get(uiPreviewAt(this.id, { key: this.key })) : null;
    if (f) f.seen = Date.now();       // (kept from now, unseen)
    this.el.hidden = true;
    for (const x of this.frames.values()) x.iframe.hidden = true;
    if (uiState.dropdown && this.el.contains(uiState.dropdown.anchor)) uiDropdownClose();
  }

  // On screen (not hidden, nor in a panel that's closed; the phone's is fixed: no offsetParent).
  shown() { return !this.el.hidden && this.el.isConnected && this.el.getClientRects().length > 0; }

  // The one shown: [chat row, its preview], or nulls.
  now() {
    const s = this.id ? rowOf(this.id) : null;
    const p = s ? uiPreviewFind(s, this.key) || uiPreviews(s)[0] || null : null;
    return [s, p];
  }

  // ---- drawn as the list has it

  update() {
    this.prune();
    if (!this.el.hidden && this.id) this.draw();
  }

  draw() {
    const [s, p] = this.now();
    this.drawPick(s, p);
    if (!s || !p) return this.say({ title: s ? "No preview in this chat" : "This chat is gone", text: s ? "Claude registers one with amarchy preview." : "" }, null);
    this.key = p.key || "";
    const at = uiPreviewAt(s.id, p);
    const state = uiPreviewOf(p);
    const was = this.states.get(at);
    this.states.set(at, state);
    let f = this.frames.get(at);
    if (f && f.url !== p.url) { this.drop(at); f = null; }     // registered again at another address
    // Its server stopped (not a moment's no answer while it runs): the page
    // it had is gone with it, loaded again once it's back.
    if (f && (state === "stopped" || state === "failed")) f.stale = true;
    if (state === "up" && was && was !== "up") this.checks.delete(at);      // back up: its headers read again
    const why = previewCant(p.url);
    if (why) return this.say({ title: "Not here in this app", text: why, actions: [["Open in a tab", () => this.openTab(), true]] }, null);
    // At the app's own address: a frame of it would be the app's own (its
    // sandbox no wall), so never.
    if (previewOwn(p.url)) return this.say({ title: "Not here", text: "It's at this app's own address.", actions: [["Open in a tab", () => this.openTab(), true]] }, null);
    // Plain http, the app over HTTPS: the browser shows nothing of it in a frame.
    if (location.protocol === "https:" && /^http:/i.test(p.url)) {
      return this.say({ title: "Not here over HTTPS", text: `Its address is plain http (${uiPreviewWhere(p.url)}): it shows here at its HTTPS one.`,
                        actions: [["Open in a tab", () => this.openTab(), true], ["Ask Claude to serve it over HTTPS", () => this.askHttps(s, p)]] }, null);
    }

    if (state === "up") {
      const c = this.checks.get(at);
      if (!f && (!c || c.url !== p.url)) { this.check(s, p); return this.say({ title: "Opening…", busy: true }, null); }
      if (!f && c.pending) return this.say({ title: "Opening…", busy: true }, null);
      if (!f && c.frame === false) {
        return this.say({ title: "It won't show inside amarchy", text: `Its page says no: ${c.why}.`,
                          actions: [["Open in a tab", () => this.openTab(), true], ["Ask Claude to allow it", () => this.askAllow(s, p, c.why)]] }, null);
      }
      if (!f) f = this.make(at, s.id, p);
      else if (f.stale) this.load(f, p.url);
      return this.say(null, f, f.loaded ? "" : "Loading…");
    }
    // Still running with a page there (restarting, or a moment without an
    // answer): the page stays, the bar says so.
    if (f && !f.stale && (state === "starting" || state === "down")) {
      return this.say(null, f, state === "starting" ? "Restarting…" : "Not answering");
    }
    if (state === "starting") {
      return this.say({ title: "Starting…", busy: true, text: uiPreviewWhere(p.url), actions: [["See what it writes", () => uiPreviewSheet(s, p)]] }, null);
    }
    if (state === "stopped") {
      return this.say({ title: "Not running", text: p.why === "idle" ? "It stopped after a while unused." : uiPreviewWhere(p.url),
                        actions: [["Start it", () => uiPreviewStart(s, p), true]] }, null);
    }
    if (state === "failed") {
      return this.say({ title: "It stopped with an error", bad: true, text: uiPreviewWhere(p.url),
                        actions: [["See why", () => uiPreviewSheet(s, p), true], ["Try again", () => uiPreviewStart(s, p)]] }, null);
    }
    const asked = uiPreviewAsking(s, p);
    return this.say({ title: "Not answering", text: uiPreviewWhere(p.url),
                      actions: [[asked ? "Asked Claude…" : "Ask Claude to start it", () => { uiPreviewAsk(s, p); this.draw(); }, true, asked]] }, null);
  }

  // Of several, which one: its name, ▾ (a tap: the others, each where it
  // stands); one: where it is.
  drawPick(s, p) {
    const ps = s ? uiPreviews(s) : [];
    const sig = JSON.stringify([s && s.id, ps.map((x) => [x.key, x.label, uiPreviewOf(x)]), p && p.key]);
    if (sig === this.pickSig) return;
    this.pickSig = sig;
    this.reloadBtn.disabled = !p || null;
    this.tabBtn.disabled = !p || null;
    if (!p) return this.pick.replaceChildren();
    if (ps.length < 2) return this.pick.replaceChildren(h("span", { class: "preview-where", title: p.url }, uiPreviewWhere(p.url)));
    const key = `preview-pick:${s.id}`;
    const items = () => {
      const r = rowOf(s.id) || s;
      return uiPreviewItems(r, (q) => uiPreviewBeside(r, q, () => this.show(r, q.key || "")), UI_PREVIEW_SHOW)
        .map((it, i) => ({ ...it, on: (uiPreviews(r)[i].key || "") === this.key }));
    };
    this.pick.replaceChildren(h("button", { class: "head-btn preview-which", type: "button", title: `${ps.length} previews: which one`,
      "aria-label": `Preview: ${p.label || uiPreviewWhere(p.url)}. Pick another`, "aria-haspopup": "menu", "aria-expanded": "false", "data-dropdown": key,
      onclick: (e) => {
        e.stopPropagation();
        if (uiDropdownOpen(key)) return uiDropdownClose();
        uiDropdown(e.currentTarget, items, { label: "Previews", key });
      } }, h("span", { class: "preview-which-label" }, p.label || uiPreviewWhere(p.url)), glyph("down", "ui-drop-mark")));
  }

  // What the stage shows: a card (what stands for the page), or the page
  // (f); the bar's note.
  say(card, f, note = "") {
    for (const x of this.frames.values()) x.iframe.hidden = x !== f;
    if (f) f.seen = Date.now();
    this.stage.classList.toggle("page", !!f);
    if (note !== this.noteSaid) {
      this.noteSaid = note;
      this.note.replaceChildren(...(note ? [note === "Loading…" || note === "Restarting…" ? spinner() : null, note].filter(Boolean) : []));
      this.note.classList.toggle("bad", note === "Not answering");
    }
    const sig = JSON.stringify(card && [card.title, card.text, card.busy, card.bad, (card.actions || []).map((a) => [a[0], !!a[2], !!a[3]])]);
    if (!card) { this.card.hidden = true; this.cardSig = null; return; }
    this.card.hidden = false;
    if (sig === this.cardSig) return;
    this.cardSig = sig;
    this.card.replaceChildren(...[
      card.busy ? spinner() : null,
      h("b", { class: card.bad ? "bad" : null }, card.title),
      card.text ? h("p", {}, card.text) : null,
      (card.actions || []).length ? h("div", { class: "preview-acts" }, ...card.actions.map(([label, act, primary, disabled]) =>
        h("button", { class: `control${primary ? " primary" : ""}`, type: "button", disabled: disabled || null, onclick: act }, label))) : null].filter(Boolean));
  }

  // ---- its pages

  make(at, id, p) {
    const iframe = h("iframe", { class: "preview-frame", title: `${p.label || "Preview"}: ${p.url}`, sandbox: PREVIEW_SANDBOX, allow: PREVIEW_ALLOW,
                                 referrerpolicy: "no-referrer", hidden: true });
    const f = { iframe, id, key: p.key || "", url: p.url, seen: Date.now(), loaded: false, stale: false };
    iframe.addEventListener("load", () => {
      f.loaded = true;
      if (this.frames.get(at) === f && !this.el.hidden) this.draw();
    });
    this.frames.set(at, f);
    this.stage.append(iframe);
    this.load(f, p.url);
    this.prune(at);
    return f;
  }

  load(f, url) {
    f.loaded = false;
    f.stale = false;
    f.url = url;
    f.iframe.src = url;
  }

  drop(at) {
    const f = this.frames.get(at);
    if (f) f.iframe.remove();
    this.frames.delete(at);
  }

  // The ones let go: a chat gone, a preview it no longer has, one unseen a
  // long while, and past the last few (the one shown never).
  prune(keep = null) {
    const shown = this.id && !this.el.hidden ? uiPreviewAt(this.id, { key: this.key }) : null;
    const now = Date.now();
    for (const [at, f] of [...this.frames]) {
      if (at === keep || at === shown) continue;
      const s = rowOf(f.id);
      const p = s ? uiPreviewFind(s, f.key) : null;
      if (!p || p.url !== f.url || now - f.seen > PREVIEW_KEEP) this.drop(at);
    }
    const most = this.phone ? 2 : PREVIEW_KEPT;
    const old = [...this.frames].filter(([at]) => at !== keep && at !== shown).sort((a, b) => a[1].seen - b[1].seen);
    while (this.frames.size > most && old.length) this.drop(old.shift()[0]);
  }

  // Whether its page lets the app show it (bin/amarchy preview_frame):
  // asked once for each address (and again when it's back up, or reloaded).
  check(s, p) {
    const at = uiPreviewAt(s.id, p), url = p.url;
    this.checks.set(at, { url, pending: true });
    const q = `?key=${encodeURIComponent(p.key || "")}&origin=${encodeURIComponent(location.origin)}`;
    fetch(chatPath(s.id, `/preview/frame${q}`)).then((r) => r.json().then((d) => (r.ok ? d : { frame: null, why: d.error })))
      .catch(() => ({ frame: null }))
      .then((d) => {
        if ((this.checks.get(at) || {}).url !== url) return;
        this.checks.set(at, { url, frame: d.frame, why: d.why || "" });
        if (!this.el.hidden) this.draw();
      });
  }

  // ---- what its bar does

  reload() {
    const [s, p] = this.now();
    if (!s || !p) return;
    const at = uiPreviewAt(s.id, p);
    const f = this.frames.get(at);
    this.checks.delete(at);
    if (f && uiPreviewOf(p) === "up") this.load(f, p.url);
    else if (f) this.drop(at);
    this.draw();
  }

  openTab() {
    const [, p] = this.now();
    if (p) openLink(p.url);
  }

  askHttps(s, p) {
    const named = p.name && uiPreviews(s).length > 1 ? ` --name '${p.name.replace(/'/g, "")}'` : "";
    sendTo(s.id, { text: `I want to watch the preview at ${p.url} beside this chat in amarchy, but it's plain http and the app is on HTTPS, so it can't show it. `
                         + `Serve it on 127.0.0.1 and register it at its HTTPS address (amarchy preview --run '<command>' https://<this machine's tailnet name>:<port>${named}), as your session's start says.` })
      .then(() => toast("Asked Claude to serve it over HTTPS"), (e) => toast(e.message));
  }

  askAllow(s, p, why) {
    const named = p.name && uiPreviews(s).length > 1 ? ` --name '${p.name.replace(/'/g, "")}'` : "";
    sendTo(s.id, { text: `I want to watch the preview at ${p.url} beside this chat in amarchy, but its page won't be shown inside another (${why}). `
                         + `Let ${location.origin} frame it (Content-Security-Policy: frame-ancestors 'self' ${location.origin}; no X-Frame-Options), `
                         + `in development only if it should stay off elsewhere, then restart it (amarchy preview restart${named}).` })
      .then(() => toast("Asked Claude to allow it"), (e) => toast(e.message));
  }
}

// Why this app can't show a page at url beside the chat, or "": the desktop
// app shows what its shell lets its frames load (amarchyDesktop.frames: any
// page, or the tailnet's previews only; one from before, none).
function previewCant(url) {
  const d = window.amarchyDesktop;
  if (!d) return "";
  if (!d.frames) return "This desktop app is from before previews could show here: it updates with amarchy.";
  if (d.frames === "any") return "";
  try {
    const host = new URL(url).hostname.toLowerCase(), here = location.hostname.toLowerCase();
    const tailnet = here.endsWith(".ts.net") ? here.split(".").slice(1).join(".") : "";
    if (host === here || (tailnet && host.endsWith(`.${tailnet}`)) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return "";
  } catch (e) { return ""; }
  return "This desktop app shows only your tailnet's previews here.";
}

// Whether url is at the app's own origin.
function previewOwn(url) {
  try { return new URL(url, location.href).origin === location.origin; } catch (e) { return true; }
}

// The pane on screen now showing chat id's preview key (a toast that it's
// ready isn't needed: you're looking at it).
function previewShowing(id, key) {
  return [...previewPanes].some((pane) => pane.id === id && pane.key === (key || "") && pane.shown());
}

// Chat s's preview p beside it, when that chat is open here (a computer's
// side panel, the phone's Chat | Preview): true when it is now.
function previewHere(s, p) {
  if (app.desk && typeof desk !== "undefined" && desk.current === s.id) { deskPreview(p.key || ""); return true; }
  if (!app.desk && app.session && app.session.id === s.id) { app.session.setMode("preview", p.key || ""); return true; }
  return false;
}

// The list came: every pane drawn as it has it (app.js refresh).
function previewRefresh() {
  for (const pane of previewPanes) pane.update();
}
