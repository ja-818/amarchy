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
// The glyphs amarchy's list uses on the desktop (Nerd Font icons), when the
// font your desktop sent has them; else the drawings below and plain marks.
const NERD = {
  waiting: "\u{F009E}", idle: "\u{F012C}", done: "\u{F05E0}", asleep: "\u{F04B2}", high: "\u{F023B}", low: "\u{F0045}",
  back: "\u{F0141}", plus: "\u{F0415}", more: "\u{F01D8}", gear: "\u{F0493}", send: "\u{F005D}",
  stop: "\u{F04DB}", check: "\u{F012C}", down: "\u{F0140}", search: "\u{F0349}", close: "\u{F0156}",
  organize: "\u{F04BC}", mic: "\u{F036C}", project: "\u{F024B}", status: "\u{F0279}", newest: "\u{F1548}", oldest: "\u{F1547}",
  up: "\u{F005D}", under: "\u{F0045}", order: "\u{F04BA}",
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
  document.querySelectorAll(".state.working").forEach((el) => { el.textContent = SPINNER[spin.frame]; });
}, 90);

// What a session is about, the keyword before ": " in bold (as the desktop list has it).
function taskText(task, cls) {
  const el = h("div", { class: `task${cls ? ` ${cls}` : ""}` });
  const i = task.indexOf(": ");
  if (i > 0) el.append(h("b", {}, task.slice(0, i + 1)), " ", task.slice(i + 2));
  else el.append(h("b", {}, task));
  return el;
}

// The look your desktop sent (theme.css), again whenever it changes; the
// status bar in its background.
function wearLook(look) {
  const stamp = look ? `${look.look || ""}${look.font || ""}` : "";
  const link = document.getElementById("look");
  if (link && !link.dataset.stamp) link.dataset.stamp = stamp;     // the page came with this one
  else if (link && stamp && link.dataset.stamp !== stamp) {
    const v = `${(look.look || "").slice(0, 12)}${(look.font || "").slice(0, 12)}`;
    const next = h("link", { rel: "stylesheet", href: `theme.css?v=${v}`, id: "look" });
    next.dataset.stamp = stamp;
    next.addEventListener("load", () => { link.remove(); paintBars(); restyleTerminals(); });
    link.after(next);
  }
  paintBars();
}

// The real terminals wear it too (desk.js).
function restyleTerminals() {
  for (const p of [desk.claude, desk.term, app.session && app.session.pane]) if (p) p.restyle();
}

function paintBars() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
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

function where(s) { return `${s.repo} · ${s.name || s.branch}`; }
function title(s) { return s.task || s.name; }
function statusOf(s) { return s.status === "asleep" ? "idle" : (s.status || "idle"); }
function stateOf(s) { return s.status || "idle"; }
// As the list shows it: "done" for one that finished and you haven't opened since.
function doneOf(s) { return stateOf(s) === "idle" && s.unseen === true ? "done" : stateOf(s); }

// The visible part of the screen: above the keyboard while it's up.
function fitViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const up = vv.height < window.innerHeight - 120;
  root.style.setProperty("--vvh", `${vv.height}px`);
  root.style.transform = `translateY(${vv.offsetTop}px)`;
  document.body.classList.toggle("keyboard-up", up);
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

// The list changed: on a wide screen the desktop's layout (desk.js), else the list's view.
function refresh() {
  if (app.desk) deskList();
  else if (!app.session) renderList();
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
  // Above the list, as on the desktop beside Claude: the search, and how
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
      list.append(h("div", { class: "empty" }, "No sessions yet.", h("br"), "Say what Claude should do, below, to start one."));
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
// A project's header opens the order of your projects (and on the desktop,
// under the pointer, has arrows to move it past the project next to it).
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
// in the order your projects come in, here and on your desktop.
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
// for it, its project and its branch), every word of it, as on the desktop.
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
// on, each showing its level) and sorted inside its groups: the desktop's
// group & sort menu. It's one setting with your desktop's: change it here
// and the desktop's list changes too, and the other way round.
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
    h("div", { class: "menu-head" }, "Group by"),
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

// The group & sort menu's box (the phone's list, beside Claude on the
// desktop), with the keys of a menu: Esc closes it, back to its button.
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

// The group & sort menu goes, wherever it is (the phone's list, beside Claude on the desktop).
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

// Held down (as on a right click on the desktop): what you can change about
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
                      closeSheet();
                    } catch (e) { toast(e.message); }
                  } }, PRIORITY[p])));
}

function rowMenu(s) {
  sheet(sheetHead(title(s), where(s)), h("div", { class: "section" }, "Priority"), prioritySeg(s),
    h("button", { class: "control wide", onclick: () => { closeSheet(); go(`#/s/${encodeURIComponent(s.id)}`); } },
      "Open"),
    closeButton(s));
}

function closeButton(s) {
  return h("button", { class: "control wide danger", onclick: () => confirmClose(s) }, "Close session");
}

// Closing, asked first as the desktop asks: it removes the worktree, and
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
      closeSheet();
      toast(`Closing ${s.repo} · ${s.name}`);
      if (app.session && app.session.id === s.id) go("#/");
    } catch (e) {
      yes.disabled = false;
      toast(e instanceof TypeError ? "Can't reach Amarchy" : e.message);
    }
  } }, n ? "Close and discard changes" : "Close session");
  sheet(sheetHead(`Close ${where(s)}?`, detail), yes,
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
    h("span", { class: "side" }, h("span", { class: "age" }, s.age || ""), unreadDot(s))), () => rowMenu(s));
}

// A session that finished a turn you haven't opened yet: a dot by its time.
function unreadDot(s) {
  return s.unseen ? h("span", { class: "dot", title: "Unread", "aria-label": "Unread" }) : null;
}

// One session, as the desktop list draws it: the project and the priority
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
    h("span", { class: "side" }, h("span", { class: "age" }, s.age || ""), unreadDot(s), prio)), () => rowMenu(s));
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
    this.conv = h("div", { class: "conv" });
    this.screenEl = h("pre", { class: "screen" });
    this.scroller = h("div", { class: "scroll" }, this.conv);
    this.dock = h("div", { class: "dock" });
    this.input = h("textarea", { rows: 1, placeholder: "Message Claude", enterkeyhint: "enter",
                                 oninput: () => { this.grow(); store.set(`draft:${this.id}`, this.input.value); this.sendButtons(); } });
    this.input.value = store.get(`draft:${this.id}`) || "";
    this.sendBtn = h("button", { class: "send", "aria-label": "Send", onclick: () => this.send() }, glyph("send"));
    this.stopBtn = h("button", { class: "stop", "aria-label": "Stop Claude",
                                 onclick: () => this.press(["Escape"]) }, glyph("stop"));
    this.micBtn = h("button", { class: "mic", "aria-label": "Hold to dictate", hidden: !(app.view && app.view.voice) },
                    glyph("mic"));
    holdToTalk(this.micBtn, () => this.dictate(), () => this.letGo());
    this.composer = h("div", { class: "prompt" }, this.input, this.micBtn, this.stopBtn, this.sendBtn);
    this.keysRow = h("div", { class: "keys" },
      ...[["↑", "Up"], ["↓", "Down"], ["⏎", "Enter"], ["Esc", "Escape"], ["Tab", "Tab"], ["⇧Tab", "BTab"],
          ["1", "1"], ["2", "2"], ["3", "3"]].map(([label, key]) =>
        h("button", { class: "control", onclick: () => this.press([key]) }, label)));
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
      go("#/");
    });
    es.addEventListener("error", () => {
      if (es.readyState === EventSource.CLOSED) {
        toast("Can't open that session.");
        go("#/");
      }
    });
  }

  close() {
    if (this.es) this.es.close();
    this.es = null;
    this.closed = true;
    if (this.pane) this.pane.disconnect();
    clearInterval(this.seen);
    this.letGo();
  }

  // Claude's own dictation (its voice mode), from the phone's microphone:
  // while the button is held, what the phone hears goes to the session's
  // Claude as if its key were held on the desktop; let go, and what Claude
  // made of it comes into the box, to send from there. What's said before
  // Claude can listen (it's starting, in a session just made) waits for it.
  // handed: said already, on the new-session bar ({queue}: its audio).
  async dictate(handed) {
    if (this.voice) return;
    // What was in the box before: the words go after it, as they come.
    const v = this.voice = { held: !handed, ws: null, queue: handed ? handed.queue : [], heard: false,
                             base: this.input.value.replace(/\s+$/, "") };
    const write = (words) => {
      this.input.value = v.base && words ? `${v.base} ${words}` : v.base || words;
      this.grow();
      this.sendButtons();
    };
    const done = () => {
      if (this.voice === v) this.voice = null;
      this.listening(null);
    };
    if (!handed) {
      // Listening once the microphone hears: what's said before is lost.
      this.listening("Starting the microphone…");
      mic.hears = () => { if (v.held) this.listening("Listening…"); };
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
      if (d.state === "transcribing") this.listening("Claude is writing it down…");
      if (typeof d.interim === "string") write(d.interim);
      if (typeof d.text === "string") {
        ws.send("got");     // it can go from Claude's prompt now
        write(d.text);
        store.set(`draft:${this.id}`, this.input.value);
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
      if (!v.held) this.listening("Waiting for Claude to start…");
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
    this.micBtn.classList.remove("on");
    await new Promise((ok) => setTimeout(ok, MIC_TAIL));
    micRelease();
    if (v.ws && v.ws.readyState === WebSocket.OPEN) this.end(v);
    else this.listening(v.ws ? "Claude is writing it down…" : "Waiting for Claude…");
  }

  end(v) {
    v.ws.send("end");
    this.listening("Claude is writing it down…");
  }

  // The box while dictating: what's going on, in place of its placeholder.
  listening(text) {
    this.composer.classList.toggle("listening", text !== null);
    this.micBtn.classList.toggle("on", !!this.voice && this.voice.held);
    this.input.placeholder = text || "Message Claude";
  }

  // Back from the background: everything from scratch.
  reopen() {
    this.close();
    this.closed = false;
    this.open();
    if (this.mode === "terminal") this.pane.open(this.id);
    this.seen = setInterval(() => this.markSeen(), 10000);
    this.markSeen();
  }

  markSeen() {
    if (document.visibilityState === "visible")
      api(`/api/session/${encodeURIComponent(this.id)}/seen`).catch(() => {});
  }

  // As the strip above Claude on the desktop: its state, what it's about, project · name.
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
      this.input.placeholder = `Message ${name}`;
      this.titleEl.replaceChildren(h("span", { class: "avatar-wrap small" }, avatar(r), stateIcon(r)),
        h("div", { class: "text" }, h("div", { class: "task assistant-name" }, name),
          h("div", { class: "meta" }, `${task}${STATUS[stateOf(r)]}`)));
      return;
    }
    this.titleEl.replaceChildren(stateIcon(r), r.assistant ? avatar(r, "small") : null,
      h("div", { class: "text" }, taskText(r.task || "New session", r.task ? "" : "untitled"),
        h("div", { class: "meta" }, `${where(r)} · ${STATUS[stateOf(r)]}`)));
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
      this.earlierBtn = h("button", { class: "link earlier", onclick: () => this.earlier() }, "earlier");
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
      // As Claude Code prints one: ● Name(what), its output under ⎿.
      const result = h("pre", {}, "…");
      const el = h("div", { class: "tool" },
        h("button", { onclick: () => el.classList.toggle("open") },
          h("span", { class: "tdot" }, "●"),
          h("span", { class: "tline" }, h("span", { class: "tname" }, it.name),
            it.summary ? h("span", { class: "tsum" }, `(${it.summary})`) : null)),
        h("div", { class: "tbody" }, h("div", { class: "out" }, result)));
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
    this.el.classList.toggle("terminal", mode === "terminal");
    if (mode !== "terminal" && this.pane) this.pane.disconnect();
    if (mode === "terminal") {
      // Claude's real terminal (desk.js), as on your desktop: what you type
      // goes to it, the keys below for what the phone's keyboard hasn't.
      if (!this.pane) this.pane = new TermPane("claude", { size: phoneSize, mic: true });
      this.scroller.replaceChildren(this.pane.box);
      this.pane.open(this.id).then(() => this.pane.fit());
    } else if (mode === "screen") {
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
    this.micBtn.hidden = !(app.view && app.view.voice);
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
    if (this.mode === "terminal") key = "terminal";
    if (key === this.dialogId) { this.sendButtons(); return; }
    this.dialogId = key;
    const kids = [];
    if (this.mode !== "chat") kids.push(this.toolsRow(), this.keysRow);
    if (this.mode === "terminal") {
      // Its prompt is in the terminal itself.
    } else if (sc && sc.exited) {
      kids.push(h("div", { class: "ask" },
        h("div", { class: "q" }, h("div", { class: "head" }, "Claude Code exited"), "Start it again to go on with this session."),
        h("button", { class: "opt first", onclick: () => this.press(["Enter"]) },
          h("span", { class: "n" }), h("span", { class: "what" }, h("b", {}, "Start Claude again")))));
    } else if (this.row && this.row.setup) {
      kids.push(h("div", { class: "note" }, "Setting up the worktree…"));
    } else if (dialog && this.mode === "chat") {
      kids.push(this.ask(dialog));
    } else {
      kids.push(this.composer);
    }
    // The keys, if they were here, stay: on Claude's question (its cursor's
    // choice), and back in the box you type in once it's answered.
    const had = lastInput.keys && (this.dock.contains(document.activeElement) || document.activeElement === document.body);
    this.dock.replaceChildren(...kids);
    if (had) {
      const ask = this.dock.querySelector(".ask");
      if (ask) (menuStart(ask) || ask).focus({ preventScroll: true });
      else if (this.dock.contains(this.input)) this.input.focus({ preventScroll: true });
    }
    this.sendButtons();
    this.grow();
    if (this.mode === "chat" && this.atBottom()) requestAnimationFrame(() => this.toBottom());
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

  // Claude's question as its own menu draws it: the choices numbered (when
  // they are), its cursor on one; tap one to pick it. Or as in Claude's own:
  // ↑/↓ and ↵, a choice's number, Esc to say no.
  ask(d) {
    const box = h("div", { class: "ask", role: "menu", tabindex: "-1" });
    menuKeys(box, { close: () => this.press(["Escape"]) });
    box.addEventListener("keydown", (e) => {
      if (!/^[1-9]$/.test(e.key) || e.ctrlKey || e.altKey || e.metaKey || e.target.matches("textarea")) return;
      const opt = box.querySelectorAll(".opt")[Number(e.key) - 1];
      if (!opt || opt.disabled) return;
      e.preventDefault();
      opt.click();
    });
    const q = d.question.split("\n");
    box.append(h("div", { class: "q" }, h("div", { class: "head" }, q[0] || "Claude asks"), q.slice(1).join("\n")));
    const numbered = d.options.length && d.options[0].keys[0] === "1";
    const cursor = Math.max(0, d.options.findIndex((o) => o.selected));
    d.options.forEach((o, i) => {
      const n = h("span", { class: "n" }, numbered ? `${i + 1}.` : "");
      if (/^Type something/i.test(o.label)) {
        const field = h("textarea", { class: "field", placeholder: "Your answer" });
        const write = h("div", { class: "write", style: "display:none" }, field,
          h("button", { class: "control accent", onclick: () => this.answer(d, o, field.value) }, "Send answer"));
        box.append(h("button", { class: "opt", onclick: () => { write.style.display = ""; field.focus(); } },
          n, h("span", { class: "what" }, h("b", {}, "Answer in your own words…"))), write);
        return;
      }
      box.append(h("button", { class: `opt${i === cursor ? " first on" : ""}`,
                               onclick: (e) => this.pick(d, o, e.currentTarget) },
        n, h("span", { class: "what" }, h("b", {}, o.label), o.detail ? h("small", {}, o.detail) : null)));
    });
    box.append(h("div", { class: "row-btns" },
      h("button", { class: "link", onclick: () => this.press(["Escape"]) }, "esc"),
      h("button", { class: "link", onclick: () => this.setMode("screen") }, "screen"),
      h("span", { class: "hint" }, d.hint)));
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
    const row = this.row || { id: this.id };
    const seg = prioritySeg(row);
    const shown = (mode, label) =>
      h("button", { class: `menu-item${this.mode === mode ? " on" : ""}`, onclick: () => { closeSheet(); this.setMode(mode); } },
        label, this.mode === mode ? glyph("check", "val") : null);
    sheet(sheetHead(title(row), where(row)),
      h("div", { class: "section" }, "Priority"), seg,
      h("div", { class: "section" }, "Show"),
      h("div", { class: "menu" }, shown("chat", "Conversation"), shown("terminal", "Claude's terminal"),
        shown("screen", "Claude's screen, as text")),
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
  return Array.from(box.querySelectorAll(sel)).filter((el) => !el.disabled && el.getClientRects().length);
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

// A sheet over the page, with the keys of a menu. One in place of another
// keeps where the keys go back to when it's gone.
function sheet(...kids) {
  const was = document.querySelector(".sheet-back");
  // Back to where the keys were: a field, or what they'd got to (on a
  // computer, not what a click left them on, as a row you right-clicked).
  const now = document.activeElement;
  const returnTo = was ? was.returnTo
    : now && (now.matches("input, textarea, :focus-visible") || !app.desk) ? now : null;
  if (was) was.remove();
  const card = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", tabindex: "-1" }, ...kids);
  const back = h("div", { class: "sheet-back", onclick: (e) => { if (e.target === back) closeSheet(); } }, card);
  back.returnTo = returnTo;
  menuKeys(card, { close: closeSheet, trap: true });
  document.body.append(back);
  menuFocus(card);
  return back;
}

// A sheet's title, with a small-caps line under it.
function sheetHead(text, meta) {
  return h("div", { class: "head" }, h("h2", {}, text), meta ? h("div", { class: "meta" }, meta) : null);
}

// The keys go back where they were (on a computer, to Claude or the
// terminal), unless something else has taken them meanwhile.
function closeSheet() {
  document.querySelectorAll(".sheet-back").forEach((s) => {
    const had = s.contains(document.activeElement) || document.activeElement === document.body;
    s.remove();
    if (!had || !(app.desk || lastInput.keys)) return;
    const to = s.returnTo;
    if (to && to !== document.body && to.isConnected) to.focus({ preventScroll: true });
    else if (app.desk && typeof desk !== "undefined" && desk.current)
      (desk.focus === "term" && !zenNow() ? desk.term : desk.claude).focus();
  });
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
  const micBtn = h("button", { class: "mic", "aria-label": "Hold to dictate", hidden: true }, glyph("mic"));
  holdToTalk(micBtn, () => talk(), () => letGo());
  const el = h("div", { class: "prompt new" }, pick, field, micBtn, send);
  const projects = () => (app.view && app.view.projects) || [];
  const grow = () => {
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight + 2, window.innerHeight * 0.4)}px`;
  };
  const buttons = () => {
    const none = !projects().length;
    send.disabled = none || !field.value.trim() || !!said;
    pick.hidden = none;
    micBtn.hidden = none || !(app.view && app.view.voice);
    micBtn.classList.toggle("on", !!said && said.held);
    el.classList.toggle("listening", !!said);
    field.placeholder = none ? (app.view ? "No projects on the host yet" : "Connecting…")
      : said ? (!said.held ? "Starting the session…" : said.hearing ? "Listening…" : "Starting the microphone…")
      : "What should Claude do?";
  };
  const update = () => {
    const ps = projects();
    if (ps.length && !ps.some((p) => p.name === repo)) repo = ps[0].name;
    name.textContent = repo || "";
    buttons();
  };
  const pickProject = () => sheet(sheetHead("Project", "Where the new session starts"),
    h("div", { class: "menu" }, ...projects().map((p) =>
      h("button", { class: `menu-item${p.name === repo ? " on" : ""}`,
                    onclick: () => { repo = p.name; store.set("last-project", repo); closeSheet(); update(); field.focus(); } },
        p.name, p.name === repo ? glyph("check", "val") : null))));
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
  return { el, update };
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
    // What the sessions tell you about (amarchy alerts), here and on your desktop.
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
    const look = app.view && app.view.look && app.view.look.look;
    kids.push(h("div", { class: "section" }, "Look"),
      h("p", {}, look ? "Your theme and font, as your desktop wears them. Change your theme there and it changes here."
                      : "Omarchy's default. Your own theme shows up here once your desktop has sent it (it does on its own when amarchy remote points at this host)."),
      h("div", { class: "section" }, "Host"),
      h("p", {}, `${(app.view && app.view.hostname) || location.hostname}, as ${app.user || "you"}. ` +
                 "Reachable only on your tailnet."));
    if (app.desk) kids.push(...deskSettings());
    keepFocus(body.parentNode || body, () => body.replaceChildren(...kids));
  };
  const back = sheet(sheetHead("Settings", app.desk ? "Amarchy in this browser" : "Amarchy on your phone"), body);
  back.classList.add("settings");
  back.redraw = () => draw();
  draw("checking");
  if (body.parentNode === document.activeElement) menuFocus(body.parentNode);      // opened with the keys: now there's a first line
  draw();
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
  closeSheet();
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

// On a computer's wide screen, amarchy as your desktop lays it out (desk.js);
// on a phone, the list and the conversation. The settings can say which.
function wantsDesk() {
  const layout = store.get("layout");
  if (layout) return layout === "desktop";
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
