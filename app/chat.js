// The conversation with a session's Claude, as a chat: what you said in
// bubbles, what Claude said as text (real markdown), its steps folded into
// one line in words (each one tap away: the command, the diff), its
// checklist, and at the bottom its question, permission or plan as a card
// with buttons, or the box you type in. One component for the phone
// (app.js's SessionView) and the wide layout.
//
// It reads the session's stream (/api/session/<id>/stream) itself:
//   session:      the session's row (status, engine, sleep)
//   conversation: {items, reset, start}: the transcript as app_items in
//                 bin/amarchy makes it (tool items carry their input, results
//                 their diff and answers)
//   screen:       Claude's screen and the dialog read off it (terminal engine)
//   live:         the chat engine's state: partial text, the step under way,
//                 the requests waiting (pending), the queue (chat engine only)
// The cards are one model whichever engine asks: a terminal-engine session's
// are drawn from its screen's dialog and answered with keys, a chat-engine
// session's from live.pending and answered at /answer.
//
// Uses app.js's helpers (h, glyph, api, toast, store, menuKeys...) at run
// time, and dictate.js's Dictate.

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
const TASK_BOX = /^\[([ xX])\]\s+/;
const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

// A code block: its language and a copy button over it (the button works
// through the conversation's own click handler, see Chat.build).
function codeBlock(code, lang) {
  return `<div class="code"><div class="code-head"><span class="lang">${esc(lang || "")}</span>` +
         `<button class="copy" type="button" aria-label="Copy the code">Copy</button></div>` +
         `<pre><code>${esc(code)}</code></pre></div>`;
}

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
      out += codeBlock(code.join("\n"), m[1]);
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
        // A task list's [ ] and [x], as boxes.
        const box = !ordered && it[0].match(TASK_BOX);
        if (box) it[0] = it[0].replace(TASK_BOX, "");
        const body = md(it.join("\n")).replace(/^<p>([\s\S]*?)<\/p>/, "$1");
        return box ? `<li class="task-item${box[1] === " " ? "" : " checked"}"><span class="box" aria-hidden="true">${box[1] === " " ? "" : TICK}</span>${body}</li>`
                   : `<li>${body}</li>`;
      }).join("") + `</${tag}>`;
    } else {
      const p = [];
      for (; i < lines.length && lines[i].trim() && !(p.length && starts(lines[i])); i++) p.push(lines[i].trim());
      out += `<p>${p.map(inline).join("<br>")}</p>`;
    }
  }
  return out;
}

// ---- icons of the chat (drawn: they read the same in every font)

const CHAT_ICONS = {
  read: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  create: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  run: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  helper: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  other: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  failed: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  list: '<path d="M10 6h10M10 12h10M10 18h10M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>',
  plan: '<path d="M8 4h11v16H5V7z"/><path d="M8 4v3H5M9 11h6M9 15h6"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
};

function icon(name, cls) {
  return h("span", { class: `ic${cls ? ` ${cls}` : ""}`, "aria-hidden": "true",
                     html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
                           `stroke-linecap="round" stroke-linejoin="round">${CHAT_ICONS[name] || ""}</svg>` });
}

// The spinner app.js turns (with the sessions' own): Claude at work.
function spinner() {
  return h("span", { class: "spinner", "aria-hidden": "true" }, SPINNER[spin.frame]);
}

// ---- Claude's steps, in words

function baseName(p) {
  const s = String(p || "");
  return s.split("/").filter(Boolean).pop() || s;
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return String(u || ""); }
}

function quoted(s, n = 60) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return `“${t.length > n ? `${t.slice(0, n - 1)}…` : t}”`;
}

function cut(s, n = 80) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// "mcp__claude_ai_Gmail__send_email": Gmail, "send email".
function mcpParts(name) {
  const m = String(name).match(/^mcp__(.+?)__(.+)$/);
  if (!m) return null;
  const server = m[1].replace(/^claude_ai_/, "").replace(/[_-]+/g, " ").trim();
  return { server, what: m[2].replace(/[_-]+/g, " ").toLowerCase() };
}

function camelWords(name) {
  const w = String(name || "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

// A session's name as SendMessage has it ("chat-engine-ae"), or another
// session for a socket address.
function peerName(to) {
  const t = String(to || "");
  return !t || /^uds:|^bridge:|\//.test(t) ? "another session" : `session ${t}`;
}

// Tools that are Claude's bookkeeping: not shown.
const HIDDEN_TOOLS = new Set(["ToolSearch", "TodoRead", "TaskList", "TaskGet"]);

// A step in words: {kind (its icon, and what it counts as), past, now (while
// it's under way), path (a file it's about)}.
function stepWords(name, input) {
  const i = input || {};
  const file = baseName(i.file_path || i.notebook_path || i.path);
  const mcp = mcpParts(name);
  if (mcp) return { kind: "other", past: `Used ${mcp.server}: ${mcp.what}`, now: `Using ${mcp.server}: ${mcp.what}` };
  // Claude's plan file (plan mode keeps it in ~/.claude/plans).
  if (/\/\.claude\/plans\//.test(i.file_path || "")) {
    if (name === "Read") return { kind: "other", past: "Read the plan", now: "Reading the plan" };
    if (/^(Edit|MultiEdit|Write)$/.test(name)) return { kind: "other", past: "Wrote down the plan", now: "Writing down the plan" };
  }
  switch (name) {
    case "Read":
      return { kind: "read", past: `Read ${file || "a file"}`, now: `Reading ${file || "a file"}`, path: i.file_path };
    case "Edit": case "MultiEdit": case "NotebookEdit":
      return { kind: "edit", past: `Edited ${file || "a file"}`, now: `Editing ${file || "a file"}`, path: i.file_path || i.notebook_path };
    case "Write":
      return { kind: "create", past: `Wrote ${file || "a file"}`, now: `Writing ${file || "a file"}`, path: i.file_path };
    case "Bash": {
      const d = i.description ? cut(i.description, 90) : "";
      if (i.run_in_background) return { kind: "run", past: `Started in the background: ${d || cut(i.command, 50)}`, now: `Starting ${d || "a command"} in the background` };
      return { kind: "run", past: d || "Ran a command", now: d || "Running a command" };
    }
    case "Grep":
      return { kind: "search", past: `Searched the code for ${quoted(i.pattern, 40)}`, now: `Searching the code for ${quoted(i.pattern, 40)}` };
    case "Glob":
      return { kind: "search", past: `Looked for files named ${quoted(i.pattern, 40)}`, now: `Looking for files named ${quoted(i.pattern, 40)}` };
    case "WebSearch":
      return { kind: "web", past: `Searched the web for ${quoted(i.query, 50)}`, now: `Searching the web for ${quoted(i.query, 50)}` };
    case "WebFetch":
      return { kind: "web", past: `Read a page on ${hostOf(i.url)}`, now: `Reading a page on ${hostOf(i.url)}` };
    case "Agent": case "Task":
      return { kind: "helper", past: `Asked a helper: ${cut(i.description, 70) || "a task"}`, now: `A helper is on it: ${cut(i.description, 60) || "a task"}` };
    case "Skill":
      return { kind: "other", past: `Used the ${i.skill || ""} skill`.replace("  ", " "), now: `Using the ${i.skill || ""} skill`.replace("  ", " ") };
    case "SendMessage":
      return { kind: "message", past: `Messaged ${peerName(i.to)}`, now: `Messaging ${peerName(i.to)}` };
    case "ListAgents":
      return { kind: "other", past: "Looked at the other sessions", now: "Looking at the other sessions" };
    case "TaskOutput": case "BashOutput":
      return { kind: "run", past: "Checked on a background task", now: "Checking on a background task" };
    case "TaskStop": case "KillShell": case "KillBash":
      return { kind: "run", past: "Stopped a background task", now: "Stopping a background task" };
    case "Monitor":
      return { kind: "run", past: `Watched: ${cut(i.description, 70) || "a background task"}`, now: `Watching: ${cut(i.description, 60) || "a background task"}` };
    case "ScheduleWakeup":
      return { kind: "other", past: "Set itself a reminder to check back", now: "Setting a reminder to check back" };
    case "EnterPlanMode":
      return { kind: "other", past: "Started planning", now: "Planning" };
    case "Artifact":
      return { kind: "web", past: "Published a page", now: "Publishing a page" };
    case "TodoWrite":
      return { kind: "other", past: "Updated the checklist", now: "Updating the checklist" };
    case "AskUserQuestion":
      return { kind: "other", past: "Asked you something", now: "Asking you something" };
    case "ExitPlanMode":
      return { kind: "other", past: "Wrote a plan", now: "Writing a plan" };
    default: {
      const w = camelWords(name);
      return { kind: "other", past: w, now: w };
    }
  }
}

// What a failed step says, in words.
function failedWords(name, words, text) {
  const t = String(text || "");
  if (/doesn't want to proceed|rejected|denied|not allowed/i.test(t)) return `You said no: ${words.now.charAt(0).toLowerCase()}${words.now.slice(1)}`;
  if (/Request interrupted|interrupted by user/i.test(t)) return `Stopped: ${words.past}`;
  if (name === "Bash") return `The command didn't work: ${words.past}`;
  if (name === "Read") return `Couldn't read ${baseName((words.path) || "the file")}`;
  if (words.kind === "edit" || words.kind === "create") return `Couldn't change ${baseName(words.path || "the file")}`;
  return `${words.past} · didn't work`;
}

// The steps of a fold, counted in words: "Read 5 files, edited 2, ran 3 commands".
function stepsSummary(steps) {
  const files = { read: new Map(), edit: new Map(), create: new Map() };
  const n = { run: 0, search: 0, web: 0, helper: 0, message: 0, other: 0 };
  for (const s of steps) {
    const k = s.words.kind;
    const path = s.words.path || s.id;
    if (k === "create") { files.create.set(path, s.words.path); files.edit.delete(path); }
    else if (k === "edit") { if (!files.create.has(path)) files.edit.set(path, s.words.path); }
    else if (k === "read") files.read.set(path, s.words.path);
    else n[k]++;
  }
  const plural = (x, one, many) => `${x} ${x === 1 ? one : many}`;
  // One file by its name, more by how many.
  const some = (m) => (m.size === 1 && [...m.values()][0] ? baseName([...m.values()][0]) : plural(m.size, "file", "files"));
  const parts = [];
  if (files.read.size) parts.push(`read ${some(files.read)}`);
  if (files.edit.size) parts.push(`edited ${some(files.edit)}`);
  if (files.create.size) parts.push(`wrote ${some(files.create)}`);
  if (n.run) parts.push(`ran ${plural(n.run, "command", "commands")}`);
  if (n.search) parts.push(`searched ${n.search === 1 ? "once" : `${n.search} times`}`);
  if (n.web) parts.push(`looked at ${plural(n.web, "page", "pages")}`);
  if (n.helper) parts.push(`asked ${plural(n.helper, "helper", "helpers")}`);
  if (n.message) parts.push(`sent ${plural(n.message, "message", "messages")}`);
  if (n.other) parts.push(plural(n.other, "other step", "other steps"));
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "Worked";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function duration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

// ---- diffs: an edit's, a write's, from its result's patch or its input

// Lines removed and added between two texts, with up to 3 lines around each
// change: [[" " | "-" | "+", line]].
function lineDiff(before, after) {
  const a = String(before || "").split("\n"), b = String(after || "").split("\n");
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const A = a.slice(s, a.length - e), B = b.slice(s, b.length - e);
  let mid = [];
  if (A.length * B.length > 200000) {
    mid = [...A.map((l) => ["-", l]), ...B.map((l) => ["+", l])];
  } else {
    // The longest common subsequence, walked from the start.
    const W = B.length + 1, t = new Uint16Array((A.length + 1) * W);
    for (let i = A.length - 1; i >= 0; i--)
      for (let j = B.length - 1; j >= 0; j--)
        t[i * W + j] = A[i] === B[j] ? t[(i + 1) * W + j + 1] + 1 : Math.max(t[(i + 1) * W + j], t[i * W + j + 1]);
    let i = 0, j = 0;
    while (i < A.length || j < B.length) {
      if (i < A.length && j < B.length && A[i] === B[j]) { mid.push([" ", A[i]]); i++; j++; }
      else if (i < A.length && (j === B.length || t[(i + 1) * W + j] >= t[i * W + j + 1])) mid.push(["-", A[i++]]);
      else mid.push(["+", B[j++]]);
    }
  }
  const head = a.slice(Math.max(0, s - 3), s).map((l) => [" ", l]);
  const tail = a.slice(a.length - e, a.length - e + 3).map((l) => [" ", l]);
  return [...head, ...mid, ...tail];
}

// The diff of a step: its result's (what really changed), else made from
// its input (before the result, or for an old transcript).
function stepDiff(name, input, result) {
  if (result && Array.isArray(result.diff) && result.diff.length) return result.diff;
  const i = input || {};
  const path = i.file_path || i.notebook_path || "";
  const file = (lines) => {
    const flat = lines.map(([sg, l]) => sg + l);
    return { path, hunks: [{ lines: flat }], add: flat.filter((l) => l[0] === "+").length,
             del: flat.filter((l) => l[0] === "-").length };
  };
  if (name === "Edit" && typeof i.old_string === "string") return [file(lineDiff(i.old_string, i.new_string))];
  if (name === "MultiEdit" && Array.isArray(i.edits)) {
    const hunks = i.edits.filter((x) => x && typeof x.old_string === "string")
      .map((x) => ({ lines: lineDiff(x.old_string, x.new_string).map(([sg, l]) => sg + l) }));
    const all = hunks.flatMap((x) => x.lines);
    return [{ path, hunks, add: all.filter((l) => l[0] === "+").length, del: all.filter((l) => l[0] === "-").length }];
  }
  if (name === "Write" && typeof i.content === "string") {
    const lines = i.content.replace(/\n$/, "").split("\n").map((l) => `+${l}`);
    return [{ path, hunks: [{ new: 1, lines }], add: lines.length, del: 0, created: true }];
  }
  return null;
}

function diffCounts(files) {
  return (files || []).reduce((n, f) => ({ add: n.add + (f.add || 0), del: n.del + (f.del || 0) }), { add: 0, del: 0 });
}

function diffChip(files) {
  const { add, del } = diffCounts(files);
  if (!add && !del) return null;
  return h("span", { class: "chip diffstat" }, add ? h("span", { class: "add" }, `+${add}`) : null,
           del ? h("span", { class: "del" }, `−${del}`) : null);
}

const DIFF_SHOWN = 400;     // lines drawn at first; the rest a tap away

// Files' changes, red and green, one under the other: each file's name and
// counts, its lines numbered where the patch says where they are.
function diffView(files) {
  const box = h("div", { class: "diff" });
  for (const f of files) {
    const created = f.created && !f.del;
    box.append(h("div", { class: "diff-file" },
      h("span", { class: "name" }, baseName(f.path) || "File"),
      h("span", { class: "dir" }, f.path && f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""),
      created ? h("span", { class: "chip" }, "new") : null, files.length > 1 ? diffChip([f]) : null));
    const body = h("div", { class: "diff-lines" });
    let drawn = 0;
    const more = [];
    (f.hunks || []).forEach((hk, n) => {
      if (n) body.append(h("div", { class: "dl gap" }, h("span", { class: "ln" }), h("span", { class: "sg" }), h("span", { class: "tx" }, "⋯")));
      let o = typeof hk.old === "number" ? hk.old : null, w = typeof hk.new === "number" ? hk.new : null;
      for (const raw of hk.lines || []) {
        const sg = raw[0] === "+" || raw[0] === "-" ? raw[0] : " ";
        const tx = sg === " " && raw[0] !== " " ? raw : raw.slice(1);
        const ln = sg === "-" ? o : w;
        if (sg !== "+" && o !== null) o++;
        if (sg !== "-" && w !== null) w++;
        const row = h("div", { class: `dl ${sg === "+" ? "add" : sg === "-" ? "del" : "ctx"}` },
          h("span", { class: "ln" }, ln === null ? "" : String(ln)), h("span", { class: "sg" }, sg === " " ? "" : sg === "-" ? "−" : "+"),
          h("span", { class: "tx" }, tx || " "));
        if (drawn++ < DIFF_SHOWN) body.append(row);
        else more.push(row);
      }
    });
    if (more.length) {
      const btn = h("button", { class: "diff-more", type: "button", onclick: () => { btn.replaceWith(...more); } },
                    `Show ${more.length} more lines`);
      body.append(btn);
    }
    if (f.cut) body.append(h("div", { class: "dl gap" }, h("span", { class: "ln" }), h("span", { class: "sg" }),
                             h("span", { class: "tx" }, "The rest isn't shown here")));
    box.append(body);
  }
  return box;
}

// ---- the checklist (TodoWrite)

function todoCard(todos) {
  const list = Array.isArray(todos) ? todos.filter((t) => t && t.content) : [];
  const done = list.filter((t) => t.status === "completed").length;
  const el = h("div", { class: "todo" });
  const head = h("button", { class: "todo-head", type: "button", onclick: () => el.classList.toggle("open") },
    icon("list"), h("span", { class: "what" }, "Checklist"),
    h("span", { class: "count" }, `${done} of ${list.length} done`), icon("chevron", "chev"));
  const bar = h("div", { class: "todo-bar" }, h("span", { style: `width:${list.length ? (100 * done) / list.length : 0}%` }));
  const ul = h("ul", {}, ...list.map((t) => h("li", { class: t.status === "completed" ? "done" : t.status === "in_progress" ? "now" : "next" },
    h("span", { class: "mark", "aria-hidden": "true" }, t.status === "completed" ? icon("check") : null),
    h("span", { class: "text" }, t.status === "in_progress" && t.activeForm ? t.activeForm : t.content))));
  el.append(head, bar, ul);
  return el;
}

// ---- the cards: Claude's question, a permission, a plan
//
// A card is drawn from a model, whichever engine asks:
//   {kind: "question", questions, answered, step(question, answer), other: text field allowed}
//   {kind: "permission", tool, input, text, title, details, always (its label), allow(), alwaysAllow(), deny(why)}
//   {kind: "plan", plan, approve(), approveEdits(), keep(what)}
//   {kind: "choice", question, options: [{label, detail, on, pick(), write}], hint}: any other menu (scraped)
// Each action returns a promise; the card waits on it, and on a failure
// says why and is ready again.

// Permission's title and its main line, in words, from the tool and its input.
function permissionWords(tool, input, description) {
  const i = input || {};
  const file = baseName(i.file_path || i.notebook_path || "");
  const mcp = mcpParts(tool);
  if (mcp) return { title: `Claude wants to use ${mcp.server}`, text: description || mcp.what };
  switch (tool) {
    case "Bash": return { title: "Claude wants to run a command", text: i.description || description || cut(i.command, 120),
                          details: i.command };
    case "Edit": case "MultiEdit": case "NotebookEdit":
      return { title: `Claude wants to edit ${file || "a file"}`, text: description && !/^Edit\b/.test(description) ? description : "",
               details: i.file_path || i.notebook_path };
    case "Write": return { title: `Claude wants to write ${file || "a file"}`, text: "", details: i.file_path };
    case "WebFetch": return { title: "Claude wants to read a web page", text: `A page on ${hostOf(i.url)}`, details: i.url };
    case "WebSearch": return { title: "Claude wants to search the web", text: quoted(i.query, 120) };
    case "Read": return { title: `Claude wants to read ${file || "a file"}`, text: description || "", details: i.file_path };
    case "Grep": case "Glob": return { title: "Claude wants to search files", text: description || quoted(i.pattern, 80), details: i.path };
    case "Agent": case "Task": return { title: "Claude wants to ask a helper", text: i.description || description || "" };
    case "SendMessage": return { title: `Claude wants to message ${peerName(i.to)}`, text: i.summary || description || "" };
    default: return { title: `Claude wants to use ${camelWords(tool)}`, text: description || "" };
  }
}

// An "always allow" suggestion of the chat engine's, in words: "Always
// allow “npm install” in this project".
function ruleWords(suggestions) {
  const s = (suggestions || []).find((x) => x && x.type === "addRules" && Array.isArray(x.rules) && x.rules.length);
  if (!s) return null;
  const words = s.rules.map((r) => {
    const c = r.ruleContent || "";
    const mcp = mcpParts(r.toolName);
    if (mcp) return `using ${mcp.server}`;
    if (r.toolName === "Bash") return c ? (/:\*$|\s\*$/.test(c) ? `commands starting with “${c.replace(/:?\s?\*$/, "")}”` : `“${cut(c, 50)}”`) : "every command";
    if (r.toolName === "WebFetch") return c.startsWith("domain:") ? `pages on ${c.slice(7)}` : "web pages";
    if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(r.toolName)) return c ? `edits to ${c}` : "edits";
    if (r.toolName === "Read") return c ? `reading ${c}` : "reading files";
    return camelWords(r.toolName).toLowerCase();
  });
  const where = { localSettings: "in this project", projectSettings: "in this project", userSettings: "in every project",
                  session: "for this chat", cliArg: "for this chat" }[s.destination] || "";
  return `Always allow ${[...new Set(words)].join(", ")}${where ? ` ${where}` : ""}`;
}

// A scraped "Yes, and don't ask again for … commands in …": the words after "Yes, and".
function alwaysWords(label) {
  const t = String(label).replace(/\s*\((shift\+tab|tab)\)\s*$/i, "").replace(/^yes,?\s*(and\s+)?/i, "")
    .replace(/\s+in\s+\/\S+$/, " in this project").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Always allow";
}

// The card's model for a request of the chat engine's (live.pending).
function requestCard(chat, p) {
  // Paths as the worktree sees them (Claude asks with whole ones).
  const root = chat.row && chat.row.path ? `${chat.row.path.replace(/\/$/, "")}/` : null;
  const rel = (v) => (root && typeof v === "string" && v.startsWith(root) ? v.slice(root.length) : v);
  if (p.input && typeof p.input === "object") {
    p = { ...p, input: { ...p.input } };
    for (const k of ["file_path", "notebook_path", "path"]) if (k in p.input) p.input[k] = rel(p.input[k]);
  }
  const post = (body) => chat.post("answer", { request_id: p.request_id, ...body });
  if (p.tool === "AskUserQuestion") {
    const qs = Array.isArray(p.input && p.input.questions) ? p.input.questions : [];
    return { kind: "question", id: p.request_id, questions: qs, answered: p.answered || {}, other: true,
             step: (question, answer) => post({ question, answer }) };
  }
  if (p.tool === "ExitPlanMode") {
    return { kind: "plan", id: p.request_id, plan: (p.input && p.input.plan) || "",
             approve: () => post({ choice: "allow" }), approveEdits: () => post({ choice: "allow", mode: "acceptEdits" }),
             keep: (why) => post({ choice: "deny", message: why || "Keep planning." }) };
  }
  const w = permissionWords(p.tool, p.input, p.description);
  return { kind: "permission", id: p.request_id, tool: p.tool, input: p.input, ...w, reason: p.reason,
           diff: stepDiff(p.tool, p.input, null), always: ruleWords(p.suggestions),
           allow: () => post({ choice: "allow" }), alwaysAllow: () => post({ choice: "always" }),
           deny: (why) => post({ choice: "deny", ...(why ? { message: why } : {}) }) };
}

// A permission Claude Code draws, in words, when the conversation hasn't the
// tool call it's about: its first line says what kind ("Bash command", "Edit
// file"...), the question names the file.
function screenPermission(lines) {
  const kind = lines[0] || "";
  const ask = lines.find((l) => /^do you want/i.test(l)) || "";
  const rest = lines.slice(1).filter((l) => l !== ask);
  const file = (ask.match(/(?:edit to|create|write to|overwrite|read|delete)\s+(.+?)\?$/i) || [])[1];
  if (/^bash/i.test(kind)) return { title: "Claude wants to run a command", text: rest.length > 1 ? rest[rest.length - 1] : "" };
  if (/^(edit|update)/i.test(kind) || /make this edit/i.test(ask)) return { title: `Claude wants to edit ${file ? baseName(file) : "a file"}`, text: "" };
  if (/^(create|write)/i.test(kind)) return { title: `Claude wants to create ${file ? baseName(file) : "a file"}`, text: "" };
  if (/^read/i.test(kind)) return { title: `Claude wants to read ${file ? baseName(file) : "a file"}`, text: "" };
  if (/^fetch/i.test(kind)) return { title: "Claude wants to read a web page", text: rest[0] || "" };
  if (/search/i.test(kind)) return { title: "Claude wants to search the web", text: rest[0] || "" };
  return { title: "Claude asks to go ahead", text: ask && ask !== kind ? kind : "" };
}

// The card's model for a dialog read off a terminal-engine session's screen
// (claude_dialog in bin/amarchy), answered with its keys. step: the tool
// call it's about (the conversation's last one without a result), when
// there is one, for the words and the diff the screen hasn't room for.
function screenCard(chat, d, step) {
  const keys = (o) => () => chat.post("keys", { keys: o.keys, dialog: d.id });
  const say = (o) => (text) => chat.post("send", { text, answer: { dialog: d.id, keys: o.keys } });
  const opts = d.options || [];
  const find = (re, not) => opts.find((o) => re.test(o.label) && o !== not);
  const lines = String(d.question || "").split("\n").map((l) => l.trim()).filter(Boolean);
  // A plan to approve (ExitPlanMode): "Yes, and auto-accept edits", "Yes, manually approve edits", "No, keep planning".
  const keep = find(/keep planning/i);
  if (keep) {
    const edits = find(/auto-accept|accept edits/i);
    const approve = opts.find((o) => o !== edits && o !== keep && /^yes/i.test(o.label) && !/clear context/i.test(o.label)) ||
                    opts.find((o) => o !== edits && o !== keep && /^yes/i.test(o.label));
    const plan = step && step.name === "ExitPlanMode" && step.input && step.input.plan ? step.input.plan : "";
    const others = opts.filter((o) => o !== edits && o !== keep && o !== approve)
      .map((o) => ({ label: o.label, detail: o.detail, pick: keys(o) }));
    return { kind: "plan", id: d.id, plan, approve: approve ? keys(approve) : null, approveEdits: edits ? keys(edits) : null,
             keep: /tell claude|what to change/i.test(keep.label) ? (why) => (why ? say(keep)(why) : keys(keep)()) : keys(keep),
             others };
  }
  // A permission: "Yes", "Yes, and don't ask again…", "No (and tell Claude what to do differently)".
  const no = find(/^no\b/i);
  if (opts.length >= 2 && /^yes\b/i.test(opts[0].label) && no) {
    const always = opts.find((o, n) => n > 0 && o !== no && /^yes\b/i.test(o.label));
    const tool = step && step.name !== "AskUserQuestion" ? step : null;
    const w = tool ? permissionWords(tool.name, tool.input, "") : screenPermission(lines);
    const shown = lines.slice(1).filter((l) => !/^do you want/i.test(l));
    return { kind: "permission", id: d.id, tool: tool && tool.name, input: tool && tool.input, ...w,
             details: w.details || shown.join("\n"), diff: tool ? stepDiff(tool.name, tool.input, null) : null,
             always: always ? alwaysWords(always.label) : null,
             allow: keys(opts[0]), alwaysAllow: always ? keys(always) : null,
             deny: (why) => (why ? say(no)(why) : keys(no)()) };
  }
  // Claude's question (AskUserQuestion), single choice: the options in full
  // (with their descriptions), each picked by its keys on the screen.
  if (step && step.name === "AskUserQuestion" && Array.isArray(step.input.questions)) {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const text = norm(d.question);
    const qi = step.input.questions.findIndex((q) => q && q.question && text.includes(norm(q.question).slice(0, 60)));
    const q = step.input.questions[qi];
    if (q && !q.multiSelect) {
      const matched = (q.options || []).map((o) => {
        const label = norm(o.label);
        return opts.find((x) => norm(x.label) === label || (label.length > 12 && norm(x.label).startsWith(label.slice(0, 24))));
      });
      const other = opts.find((o) => /^type something/i.test(o.label));
      if (matched.every(Boolean)) {
        return { kind: "question", id: d.id, questions: [q], index: qi, total: step.input.questions.length,
                 picks: matched.map((o) => keys(o)), other: other ? say(other) : null };
      }
    }
  }
  // Any other menu: its choices as they are.
  return { kind: "choice", id: d.id, question: d.question, hint: d.hint,
           numbered: opts.length && opts[0].keys && opts[0].keys[0] === "1",
           options: opts.map((o) => ({ label: o.label, detail: o.detail, on: o.selected,
                                       write: /^Type something/i.test(o.label) ? say(o) : null, pick: keys(o) })),
           escape: () => chat.post("keys", { keys: ["Escape"] }) };
}

// ---- the chat

class Chat {
  // opts: id; onSession(row), onScreen(screen), onGone(): for whoever
  // shows the chat (its header, its other views); claude: Claude's own voice
  // mode for the mic ({start, stop}, see SessionView), or none.
  constructor(opts) {
    this.opts = opts;
    this.id = opts.id;
    this.row = opts.row || null;
    this.screen = null;
    this.live = null;
    this.placeholder = "Message Claude";
    this.view = { content: null, above: [], composer: true };
    this.reset();
    this.build();
  }

  reset() {
    this.steps = new Map();     // tool call id -> its step
    this.keys = new Set();      // items shown already
    this.fold = null;           // the steps being added to, until Claude says something
    this.todo = null;           // the newest checklist
    this.tasks = new Map();     // Claude's tasks (TaskCreate, TaskUpdate), and their checklist
    this.taskCard = null;
    this.lastStep = null;
  }

  get engine() { return this.row && this.row.engine === "chat" ? "chat" : "terminal"; }

  build() {
    this.conv = h("div", { class: "conv chat-conv" });
    this.tail = h("div", { class: "chat-tail" });
    this.conv.append(this.tail);
    // A code block's Copy, a fold opened.
    this.conv.addEventListener("click", (e) => {
      const copy = e.target.closest(".copy");
      if (!copy) return;
      const code = copy.closest(".code").querySelector("code").textContent;
      copyText(code).then(() => { copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy"; }, 1500); });
    });
    this.scroller = h("div", { class: "scroll chat-scroll" }, this.conv);
    this.latest = h("button", { class: "to-latest", type: "button", hidden: true, "aria-label": "Go to the latest",
                                onclick: () => this.toBottom(true) }, icon("down"));
    this.scroller.addEventListener("scroll", () => { if (this.atBottom()) this.latest.hidden = true; }, { passive: true });
    this.dock = h("div", { class: "dock chat-dock" });
    this.buildComposer();
    this.el = h("div", { class: "chat" }, h("div", { class: "chat-main" }, this.scroller, this.latest), this.dock);
    this.renderDock();
  }

  buildComposer() {
    this.input = h("textarea", { rows: 1, placeholder: this.placeholder, enterkeyhint: "enter", "aria-label": "Message",
                                 oninput: () => this.typed() });
    this.input.value = store.get(`draft:${this.id}`) || "";
    // An image pasted into the box goes with the next message (manage.js).
    this.input.addEventListener("paste", (e) => {
      const item = e.clipboardData && Array.from(e.clipboardData.items).find((i) => i.kind === "file" && /^image\//.test(i.type));
      if (!item) return;
      e.preventDefault();
      pasteImageInto({ id: this.id }, item.getAsFile());
    });
    // On a computer, Enter sends and Shift+Enter is a new line; on a phone
    // its keyboard's return is a new line, the arrow sends.
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(hover: hover) and (pointer: fine)").matches) {
        e.preventDefault();
        this.send();
      }
    });
    this.attachBtn = h("button", { class: "cbtn attach", type: "button", "aria-label": "Add an image",
                                   onclick: () => pickImageInto({ id: this.id }) }, icon("plus"));
    this.micBtn = h("button", { class: "cbtn mic", type: "button", "aria-label": "Dictate (hold, or tap and tap again)", hidden: true },
                    glyph("mic"));
    this.sendBtn = h("button", { class: "cbtn send", type: "button", "aria-label": "Send", onclick: () => this.send() }, glyph("send"));
    this.stopBtn = h("button", { class: "cbtn stop", type: "button", "aria-label": "Stop Claude", onclick: () => this.stop() }, glyph("stop"));
    // What you say, into the box (dictate.js), or through Claude's voice mode
    // (a terminal-engine session's: a chat-engine session has none).
    const claude = this.opts.claude;
    this.talk = new Dictate({ field: this.input, button: this.micBtn,
                              changed: () => this.typed(),
                              state: (text) => this.listening(text),
                              claude: claude ? { ...claude, off: () => this.engine === "chat" } : undefined });
    this.composer = h("div", { class: "composer" }, this.attachBtn, this.input, this.micBtn, this.stopBtn, this.sendBtn);
    this.queueEl = h("div", { class: "queue" });
  }

  // ---- the stream

  open() {
    const es = new EventSource(`/api/session/${encodeURIComponent(this.id)}/stream`);
    this.es = es;
    es.addEventListener("session", (e) => {
      this.row = JSON.parse(e.data);
      if (this.opts.onSession) this.opts.onSession(this.row);
      this.renderDock();
      this.renderTail();
    });
    es.addEventListener("conversation", (e) => this.conversation(JSON.parse(e.data)));
    es.addEventListener("screen", (e) => {
      this.screen = JSON.parse(e.data);
      if (this.opts.onScreen) this.opts.onScreen(this.screen);
      this.renderDock();
    });
    es.addEventListener("live", (e) => {
      this.live = JSON.parse(e.data);
      this.renderDock();
      this.renderTail();
    });
    es.addEventListener("gone", () => { if (this.opts.onGone) this.opts.onGone(); });
    es.addEventListener("error", () => {
      if (es.readyState === EventSource.CLOSED && this.opts.onGone) this.opts.onGone("error");
    });
  }

  close() {
    if (this.es) this.es.close();
    this.es = null;
    this.closed = true;
    this.talk.cancel();
  }

  reopen() {
    this.close();
    this.closed = false;
    this.open();
  }

  // A request to the session's routes ("keys", "send", "answer", "interrupt"...).
  post(route, body) {
    return api(`/api/session/${encodeURIComponent(this.id)}/${route}`, body);
  }

  // ---- what shows: the conversation, or another view of the session's
  // (its terminal, its screen) with rows of keys above the dock and maybe
  // the box you type in.

  setView({ content = null, above = [], composer = true } = {}) {
    this.view = { content, above, composer };
    this.scroller.replaceChildren(content || this.conv);
    this.el.classList.toggle("other", !!content);
    this.cardKey = null;
    this.renderDock();
    if (!content) this.toBottom(true);
  }

  atBottom() {
    const s = this.scroller;
    return s.scrollTop + s.clientHeight >= s.scrollHeight - 120;
  }

  toBottom(now) {
    const go = () => { this.scroller.scrollTop = this.scroller.scrollHeight; this.latest.hidden = true; };
    if (now) go();
    else requestAnimationFrame(go);
  }

  // ---- the conversation

  conversation(d) {
    const stick = d.reset || this.atBottom();
    if (d.reset) {
      this.reset();
      this.conv.replaceChildren(this.tail);
      this.start = d.start;
      this.earlierBtn = h("button", { class: "earlier", type: "button", onclick: () => this.earlier() }, "Show earlier messages");
      if (this.start > 0) this.conv.prepend(this.earlierBtn);
      this.emptyEl = d.items.length ? null
        : h("div", { class: "chat-empty" }, h("div", { class: "big" }, "What should Claude do?"),
            h("div", {}, "Write it below, or hold the mic and say it."));
      if (this.emptyEl) this.conv.prepend(this.emptyEl);
    } else if (d.items.length && this.emptyEl) {
      this.emptyEl.remove();
      this.emptyEl = null;
    }
    const frag = document.createDocumentFragment();
    for (const item of d.items) this.add(item, frag);
    this.tail.before(frag);
    this.renderTail();
    if (this.screen && this.screen.dialog) this.renderDock();     // the card may be about what came in
    if (stick) this.toBottom();
    else if (d.items.some((i) => i.kind !== "result")) this.latest.hidden = false;
  }

  async earlier() {
    this.earlierBtn.disabled = true;
    try {
      const res = await fetch(`/api/session/${encodeURIComponent(this.id)}/earlier?before=${this.start}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "couldn't load it");
      // Its own folds: what came before doesn't join the ones after it.
      const kept = { fold: this.fold, todo: this.todo, lastStep: this.lastStep, tasks: this.tasks, taskCard: this.taskCard };
      this.fold = null;
      this.todo = null;
      this.tasks = new Map();
      this.taskCard = null;
      const frag = document.createDocumentFragment();
      for (const item of d.items) this.add(item, frag, true);
      if (kept.todo) frag.querySelectorAll(".todo").forEach((t) => t.classList.remove("open"));
      Object.assign(this, kept);
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

  // One item of the conversation, into where (a fragment going at the end,
  // or before what's shown when earlier).
  add(it, where, earlier) {
    if (it.key && this.keys.has(it.key)) return;
    if (it.key) this.keys.add(it.key);
    this.where = where;
    if (it.kind === "result") return this.result(it);
    if (it.kind === "tool") return this.tool(it, where, earlier);
    this.fold = null;       // anything else ends the steps before it
    if (it.kind === "user") {
      const said = this.userView(it.text);
      if (said.note) where.append(h("div", { class: "msg note" }, said.note));
      else if (said.summary) where.append(h("details", { class: "msg note long" }, h("summary", {}, said.summary), h("pre", {}, said.text)));
      else where.append(h("div", { class: "msg user" }, h("div", { class: "bubble" }, ...said.parts)));
    } else if (it.kind === "command") {
      where.append(h("div", { class: "msg command" }, h("span", { class: "chip" }, it.text)));
    } else if (it.kind === "note") {
      const text = it.text === "Interrupted" ? "You stopped Claude" : it.text;
      const long = text.split("\n").length > 3 || text.length > 240;
      where.append(long ? h("details", { class: "msg note long" }, h("summary", {}, cut(text.split("\n")[0], 70)), h("pre", {}, text))
                        : h("div", { class: "msg note" }, text));
    } else if (it.kind === "claude") {
      where.append(h("div", { class: "msg claude", html: md(it.text) }));
    }
  }

  // What you said, as the bubble shows it: images as a chip, pasted text
  // set apart; or what Claude Code put in your name (a background task that
  // finished, the summary a conversation went on from) as a quiet line.
  userView(text) {
    const t = String(text || "");
    const tag = (name) => { const m = t.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? unescapeHTML(m[1].trim()) : ""; };
    if (/^<task-notification>/.test(t)) {
      const step = this.steps.get(tag("tool-use-id"));
      const what = step ? step.words.past.replace(/^Started in the background: /, "") : tag("summary").replace(/^Background command /, "");
      const status = tag("status");
      return { note: `${status === "completed" ? "Done in the background" : status === "killed" ? "Stopped" : "Didn't work in the background"}: ${cut(what, 90)}` };
    }
    if (/^This session is being continued from a previous conversation/.test(t))
      return { summary: "Continued from an earlier conversation", text: t };
    const parts = [];
    const re = /\[(?:image|Image #\d+)\]|<pasted_content[^>]*>([\s\S]*?)<\/pasted_content>/g;
    let at = 0, m;
    while ((m = re.exec(t))) {
      if (m.index > at) parts.push(t.slice(at, m.index));
      parts.push(m[0].startsWith("<") ? h("span", { class: "pasted" }, m[1].trim())
                                      : h("span", { class: "chip image" }, icon("image"), "Image"));
      at = m.index + m[0].length;
    }
    if (at < t.length) parts.push(t.slice(at));
    return { parts: parts.map((p) => (typeof p === "string" ? p.replace(/^\s*\n|\n\s*$/g, "") : p)).filter((p) => p !== "") };
  }

  // A tool call: a step in the fold under way (a new one when Claude said
  // something since), or a card of its own (the checklist, a question, a plan).
  tool(it, where, earlier) {
    const input = it.input || {};
    const step = { id: it.id, name: it.name, input, at: it.at, words: stepWords(it.name, input), result: null };
    this.steps.set(it.id, step);
    if (!earlier) this.lastStep = step;
    if (HIDDEN_TOOLS.has(it.name)) return;
    if (it.name === "TodoWrite") {
      step.el = todoCard(input.todos);
      // The newest checklist is open; the ones before it fold to their line.
      if (this.todo) this.todo.classList.remove("open");
      step.el.classList.add("open");
      this.todo = step.el;
      where.append(step.el);
      return;
    }
    if (it.name === "TaskCreate" || it.name === "TaskUpdate") {
      // Claude's task list (the tools that replace TodoWrite): one checklist
      // for the conversation, changed in place as tasks are added and done.
      if (it.name === "TaskUpdate") this.taskChanged(input);
      return;
    }
    if (it.name === "AskUserQuestion") {
      this.fold = null;
      step.el = this.askedCard(step);
      where.append(step.el);
      return;
    }
    if (it.name === "ExitPlanMode") {
      this.fold = null;
      step.el = this.planCard(step);
      where.append(step.el);
      return;
    }
    if (!this.fold) {
      this.fold = this.newFold();
      where.append(this.fold.el);
    }
    this.fold.steps.push(step);
    step.fold = this.fold;
    step.el = this.stepRow(step);
    this.fold.list.append(step.el);
    this.drawFold(this.fold);
  }

  result(it) {
    const step = this.steps.get(it.tool);
    if (!step) return;
    step.result = it;
    if (step.name === "TaskCreate" && !it.error) {
      const id = (String(it.text).match(/#(\w+)/) || [])[1];
      if (id) this.taskChanged({ taskId: id, subject: step.input.subject, activeForm: step.input.activeForm, status: "pending" }, true);
      return;
    }
    if (step.name === "AskUserQuestion" && step.el) step.el.replaceWith(step.el = this.askedCard(step));
    else if (step.name === "ExitPlanMode" && step.el) step.el.replaceWith(step.el = this.planCard(step));
    else if (step.fold) {
      const row = this.stepRow(step);
      if (step.el.classList.contains("open")) row.classList.add("open");
      step.el.replaceWith(row);
      step.el = row;
      this.drawFold(step.fold);
    }
  }

  // A task added or changed: the checklist drawn anew where it is (first
  // made where the first task came).
  taskChanged(t, created) {
    const id = String(t.taskId || t.id || "");
    if (!id) return;
    if (!this.tasks.has(id) && !created) return;
    const was = this.tasks.get(id) || {};
    if (t.status === "deleted") this.tasks.delete(id);
    else this.tasks.set(id, { ...was, ...Object.fromEntries(Object.entries({ content: t.subject, activeForm: t.activeForm, status: t.status })
                                                              .filter(([, v]) => v)) });
    const card = todoCard([...this.tasks.values()]);
    card.classList.add("open");
    if (this.taskCard && this.taskCard.parentNode) this.taskCard.replaceWith(card);
    else {
      this.fold = null;
      this.where.append(card);
    }
    this.taskCard = card;
  }

  newFold() {
    const list = h("div", { class: "fold-steps" });
    const head = h("button", { class: "fold-head", type: "button", "aria-expanded": "false" });
    const el = h("div", { class: "fold" }, head, list);
    const fold = { el, head, list, steps: [] };
    head.addEventListener("click", () => {
      const open = el.classList.toggle("open");
      head.setAttribute("aria-expanded", String(open));
    });
    return fold;
  }

  // A fold's line: what its steps did, in words, how long they took, the
  // lines its edits changed.
  drawFold(fold) {
    const steps = fold.steps;
    fold.el.classList.toggle("single", steps.length === 1);
    if (steps.length === 1) return;
    const failed = steps.filter((s) => s.result && s.result.error).length;
    const running = steps.some((s) => !s.result);
    const times = steps.flatMap((s) => [s.at, s.result && s.result.at]).filter(Boolean).map((t) => Date.parse(t)).filter((t) => !isNaN(t));
    const took = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;
    const diffs = steps.flatMap((s) => (s.words.kind === "edit" || s.words.kind === "create" ? stepDiff(s.name, s.input, s.result) || [] : []));
    fold.head.replaceChildren(...[
      running ? spinner() : icon(failed ? "failed" : "check", failed ? "bad" : "ok"),
      h("span", { class: "what" }, steps.some((s) => s.result) ? stepsSummary(steps.filter((s) => s.result))
                                                               : `${steps[0].words.now}…`),
      diffChip(diffs),
      failed ? h("span", { class: "chip bad" }, `${failed} didn't work`) : null,
      took >= 5000 ? h("span", { class: "took" }, duration(took)) : null,
      icon("chevron", "chev")].filter(Boolean));
  }

  // One step: its icon (spinning while it runs), what it did in words, and
  // what's behind it (the diff, the command and its output) a tap away.
  stepRow(step) {
    const r = step.result;
    const failed = r && r.error;
    const w = step.words;
    const diff = w.kind === "edit" || w.kind === "create" ? stepDiff(step.name, step.input, r) : null;
    if (w.kind === "create" && r && diff && diff[0] && diff[0].created === false && diff[0].del) w.past = `Rewrote ${baseName(w.path)}`;
    const label = failed ? failedWords(step.name, w, r.text) : r ? w.past : w.now;
    const row = h("div", { class: `step ${failed ? "failed" : r ? "done" : "running"}` });
    const head = h("button", { class: "step-head", type: "button", "aria-expanded": "false" },
      r ? icon(failed ? "failed" : w.kind, failed ? "bad" : "") : spinner(),
      h("span", { class: "what" }, label), diffChip(diff), icon("chevron", "chev"));
    let body = null;
    head.addEventListener("click", () => {
      if (!body) row.append(body = this.stepBody(step, diff));       // drawn the first time it's opened
      const open = row.classList.toggle("open");
      head.setAttribute("aria-expanded", String(open));
    });
    row.append(head);
    return row;
  }

  stepBody(step, diff) {
    const i = step.input, r = step.result;
    const body = h("div", { class: "step-body" });
    const detail = (name, value, code) => value ? body.append(h("div", { class: "detail" }, h("div", { class: "label" }, name),
                                                                code ? h("pre", {}, value) : h("div", { class: "value" }, value))) : null;
    if (diff && diff.length) body.append(diffView(diff));
    switch (step.name) {
      case "Bash": detail("Command", i.command, true); break;
      case "Read": case "Edit": case "MultiEdit": case "Write": case "NotebookEdit":
        if (!diff || !diff.length) detail("File", i.file_path || i.notebook_path); break;
      case "Grep": case "Glob": detail("Looked for", i.pattern, true); detail("In", i.path || i.glob); break;
      case "WebFetch": detail("Page", i.url); break;
      case "WebSearch": detail("Searched for", i.query); break;
      default: {
        const shown = Object.entries(i).filter(([, v]) => typeof v === "string" && v.trim());
        for (const [k, v] of shown.slice(0, 4)) detail(camelWords(k.replace(/_/g, " ")), cut(v, 2000), v.includes("\n"));
      }
    }
    // The output: for a read, the file itself is noise; for an edit, the diff says it.
    const quiet = !r || (!r.error && /^(Read|Edit|MultiEdit|Write|NotebookEdit)$/.test(step.name));
    if (!quiet && r.text && r.text.trim()) detail(r.error ? "What went wrong" : "Output", r.text, true);
    else if (!r) body.append(h("div", { class: "detail" }, h("div", { class: "value muted" }, "Still going…")));
    // Every link in the step's text opens through the app's own handler.
    return body;
  }

  // Claude's question, once asked: the questions and what you answered.
  askedCard(step) {
    const qs = Array.isArray(step.input.questions) ? step.input.questions : [];
    const answers = (step.result && step.result.answers) || {};
    const failed = step.result && step.result.error;
    return h("div", { class: "asked" },
      h("div", { class: "asked-head" }, icon("question"), h("span", {}, "Claude asked")),
      ...qs.map((q) => h("div", { class: "asked-q" }, h("div", { class: "q" }, q.question || ""),
        answers[q.question] ? h("div", { class: "a" }, h("span", { class: "you" }, "You:"), ` ${answers[q.question]}`)
          : h("div", { class: "a muted" }, step.result ? (failed ? "Not answered" : "Answered") : "Waiting for your answer…"))));
  }

  // A plan Claude wrote (ExitPlanMode), as a document: the start of it, the
  // rest a tap away, and what you made of it.
  planCard(step) {
    const r = step.result;
    const doc = h("div", { class: "plan-doc", html: md(step.input.plan || "") });
    const el = h("div", { class: "planned" },
      h("div", { class: "planned-head" }, icon("plan"), h("span", {}, "Claude's plan")), doc);
    const more = h("button", { class: "plan-more", type: "button", onclick: () => { el.classList.add("open"); more.remove(); } },
                   "Show the whole plan");
    el.append(more);
    // Waiting for your answer, it's the card in the dock: here once answered.
    if (!r) el.hidden = true;
    if (r) el.append(h("div", { class: `plan-said${r.error ? " bad" : ""}` },
      r.error ? (/Request interrupted/i.test(r.text) ? "Stopped" : "You asked for changes") : "You approved it"));
    requestAnimationFrame(() => { if (doc.scrollHeight <= doc.clientHeight + 4) { el.classList.add("open"); more.remove(); } });
    return el;
  }

  // ---- the end of the conversation: what Claude is writing (the chat
  // engine's partial text) and what it's doing now.

  working() {
    if (this.live && this.engine === "chat") return this.live.state === "working" || this.live.state === "starting";
    return !!this.row && this.row.status === "working";
  }

  renderTail() {
    const kids = [];
    const live = this.engine === "chat" ? this.live : null;
    const partial = live && live.partial && live.partial.trim();
    if (partial && this.working()) {
      // Shown until it's in the transcript (the last thing Claude said).
      const said = this.conv.querySelectorAll(".msg.claude");
      const last = said.length ? said[said.length - 1].textContent : "";
      if (!last || !partial.startsWith(last.slice(0, 40)) || partial.length > last.length + 2)
        kids.push(h("div", { class: "msg claude streaming", html: md(partial) }));
    }
    // What it's doing, unless that's the step spinning just above.
    const shown = this.lastStep && !this.lastStep.result && this.lastStep.el && this.tail.previousElementSibling &&
                  this.tail.previousElementSibling.contains(this.lastStep.el) && !this.lastStep.el.closest(".fold:not(.open):not(.single)");
    if (this.working() && !shown) {
      let now = "Working…";
      if (live && live.activity && live.activity.tool) now = `${stepWords(live.activity.tool, live.activity.input || {}).now}…`;
      else if (live && live.thinking) now = "Thinking…";
      else if (!live && this.lastStep && !this.lastStep.result && !HIDDEN_TOOLS.has(this.lastStep.name)) now = `${this.lastStep.words.now}…`;
      kids.push(h("div", { class: "working", role: "status" }, spinner(), h("span", {}, now)));
    }
    const stick = this.atBottom();
    this.tail.replaceChildren(...kids);
    if (stick) this.toBottom();
  }

  // ---- the dock: Claude's question as a card, or the box you type in

  // The card that's up now, as a model, or a note in its place.
  current() {
    const sc = this.screen, r = this.row;
    if (r && r.setup) return { note: "Setting up…" };
    if (this.engine === "chat") {
      const p = this.live && Array.isArray(this.live.pending) && this.live.pending[0];
      if (p) return { card: requestCard(this, p), key: `req:${p.request_id}:${JSON.stringify(p.answered || {})}` };
      // (Stopped while asleep is what asleep is: the dock says so already.)
      if (this.live && this.live.state === "exited" && !sleepOf(this.row))
        return { exited: true, key: "exited" };
      return null;
    }
    if (sc && sc.exited) return { exited: true, key: "exited" };
    if (sc && sc.dialog) {
      const step = this.lastStep && !this.lastStep.result && !HIDDEN_TOOLS.has(this.lastStep.name) ? this.lastStep : null;
      return { card: screenCard(this, sc.dialog, step), key: `dialog:${sc.dialog.id}:${step ? step.id : ""}` };
    }
    return null;
  }

  renderDock() {
    const content = !this.view.content;
    const now = content ? this.current() : null;
    const sleep = sleepOf(this.row);
    const key = [now ? now.key || now.note : "composer", sleep, this.view.composer, this.view.above.length, content].join("|");
    this.renderQueue();
    if (key === this.cardKey) { this.sendButtons(); return; }
    this.cardKey = key;
    const kids = [...this.view.above];
    if (now && now.card) kids.push(this.card(now.card));
    else if (now && now.note) kids.push(h("div", { class: "dock-note" }, now.note));
    else if (now && now.exited && this.engine !== "chat") {
      kids.push(this.cardShell("question", "Claude stopped", "Start it again to go on where you left off.",
        h("div", { class: "card-actions" }, h("button", { class: "cta primary", type: "button",
          onclick: () => this.post("keys", { keys: ["Enter"] }).catch((e) => toast(e.message)) }, "Start Claude again"))));
    } else if (this.view.composer) {
      if (now && now.exited) kids.push(h("div", { class: "dock-note" }, "Claude stopped. Send a message to start it again."));
      // Asleep, what you send wakes it (with that as Claude's first message).
      if (sleep === "asleep") kids.push(h("div", { class: "dock-note" }, glyph("asleep", "sleep"),
        h("span", {}, "Asleep to save memory. Send something to wake it."),
        h("button", { class: "text-btn", type: "button", onclick: () => wakeSession(this.row) }, "Wake")));
      else if (sleep === "waking") kids.push(h("div", { class: "dock-note" }, glyph("asleep", "sleep waking"), h("span", {}, "Waking Claude…")));
      kids.push(this.queueEl, this.composer);
    }
    // The keys, if they were here, stay: on the card (its first choice), and
    // back in the box you type in once it's answered.
    const had = lastInput.keys && (this.dock.contains(document.activeElement) || document.activeElement === document.body);
    const stick = this.atBottom();
    this.dock.replaceChildren(...kids);
    if (had) {
      const card = this.dock.querySelector(".card");
      if (card) (menuStart(card) || card).focus({ preventScroll: true });
      else if (this.dock.contains(this.input)) this.input.focus({ preventScroll: true });
    }
    this.sendButtons();
    this.grow();
    if (content && stick) this.toBottom();
  }

  // What you sent while Claude works (the chat engine keeps it until it's
  // free): each with Send now and Edit. And the images going with the next.
  renderQueue() {
    const live = this.engine === "chat" ? this.live : null;
    const queue = live && Array.isArray(live.queue) ? live.queue : [];
    const kids = queue.map((q) => h("div", { class: "queued" },
      icon("clock"), h("div", { class: "text" }, h("div", { class: "what" }, q.text || (q.images ? "An image" : "")),
        h("div", { class: "when" }, "Will send when Claude finishes")),
      h("button", { class: "text-btn", type: "button", onclick: () => this.sendNow(q) }, "Send now"),
      h("button", { class: "text-btn", type: "button", onclick: () => this.editQueued(q) }, "Edit")));
    const n = live && live.attachments;
    if (n) kids.push(h("div", { class: "queued images" }, icon("image"),
      h("div", { class: "text" }, h("div", { class: "what" }, n === 1 ? "An image goes with your next message" : `${n} images go with your next message`))));
    this.queueEl.replaceChildren(...kids);
  }

  async sendNow(q) {
    try {
      await this.post("unqueue", { uuid: q.uuid });
      await this.post("send", { text: q.text, when: "now" });
    } catch (e) { toast(e.message); }
  }

  async editQueued(q) {
    try {
      await this.post("unqueue", { uuid: q.uuid });
      const now = this.input.value.trim();
      this.input.value = now ? `${q.text}\n${now}` : q.text;
      this.typed();
      this.input.focus();
    } catch (e) { toast(e.message); }
  }

  // ---- a card

  cardShell(kind, title, text, ...kids) {
    const el = h("div", { class: `card ${kind}`, role: "group", tabindex: "-1", "aria-label": title });
    el.append(h("div", { class: "card-head" }, icon({ question: "question", permission: "shield", plan: "plan", choice: "question" }[kind] || "question"),
                h("span", { class: "title" }, title)));
    if (text) el.append(h("div", { class: "card-text" }, text));
    el.append(...kids.filter(Boolean));
    return el;
  }

  // Run a card's action: its buttons off while it goes; on a failure, why, and the card back.
  act(card, fn, btn) {
    card.querySelectorAll("button, textarea").forEach((b) => { b.disabled = true; });
    if (btn) btn.classList.add("chosen");
    Promise.resolve().then(fn).then(() => {
      // Answered: the next state takes the card's place. Should none come,
      // the card is back, to answer again.
      setTimeout(() => { if (card.isConnected) { this.cardKey = null; this.renderDock(); } }, 10000);
    }, (e) => {
      toast(e.message);
      this.cardKey = null;
      this.renderDock();
    });
  }

  // A field to say something with (why not, what to change, your own answer).
  writeField(card, placeholder, label, send) {
    const field = h("textarea", { class: "field", rows: 2, placeholder });
    const go = h("button", { class: "cta primary", type: "button", onclick: () => { if (field.value.trim() || send.empty) this.act(card, () => send(field.value.trim()), go); } }, label);
    const box = h("div", { class: "write", hidden: true }, field, h("div", { class: "card-actions" }, go));
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go.click(); }
    });
    return { box, open: () => { box.hidden = false; field.focus(); } };
  }

  card(m) {
    const card = m.kind === "question" ? this.questionCard(m) : m.kind === "permission" ? this.permissionCard(m)
               : m.kind === "plan" ? this.planAsk(m) : this.choiceCard(m);
    menuKeys(card, { close: m.kind === "choice" && m.escape ? () => this.act(card, m.escape) : null });
    // A choice's number picks it, as on Claude's own menu.
    card.addEventListener("keydown", (e) => {
      if (!/^[1-9]$/.test(e.key) || e.ctrlKey || e.altKey || e.metaKey || e.target.matches("textarea")) return;
      const opt = card.querySelectorAll(".opt")[Number(e.key) - 1];
      if (!opt || opt.disabled) return;
      e.preventDefault();
      opt.click();
    });
    return card;
  }

  // Claude's question: in big type, each option a button with what it
  // means (and its preview), several to pick as boxes with Done, and your
  // own words. Several questions go one at a time ("1 of 3").
  questionCard(m) {
    const qs = m.questions;
    const done = m.answered || {};
    const index = typeof m.index === "number" ? m.index : Math.max(0, qs.findIndex((q) => !(q.question in done)));
    const q = qs[typeof m.index === "number" ? 0 : index] || {};
    const total = m.total || qs.length;
    const card = this.cardShell("question", q.header || "Claude asks", null);
    if (total > 1) card.querySelector(".card-head").append(h("span", { class: "count" }, `${index + 1} of ${total}`));
    card.append(h("div", { class: "question" }, q.question || ""));
    const opts = h("div", { class: "opts" });
    const multi = !!q.multiSelect && !m.picks;
    const picked = new Set();
    let doneBtn = null;
    (q.options || []).forEach((o, n) => {
      const btn = h("button", { class: `opt${multi ? " multi" : ""}`, type: "button", role: multi ? "checkbox" : null, "aria-checked": multi ? "false" : null },
        multi ? h("span", { class: "box", "aria-hidden": "true" }, icon("check")) : h("span", { class: "n", "aria-hidden": "true" }, String(n + 1)),
        h("span", { class: "what" }, h("b", {}, o.label), o.description ? h("small", {}, o.description) : null));
      btn.addEventListener("click", () => {
        if (multi) {
          if (picked.has(o.label)) picked.delete(o.label); else picked.add(o.label);
          btn.classList.toggle("on", picked.has(o.label));
          btn.setAttribute("aria-checked", String(picked.has(o.label)));
          doneBtn.disabled = !picked.size;
          return;
        }
        this.act(card, m.picks ? m.picks[n] : () => m.step(q.question, o.label), btn);
      });
      opts.append(btn);
      if (o.preview) opts.append(h("pre", { class: "preview" }, o.preview));
    });
    card.append(opts);
    const own = m.other ? this.writeField(card, "Your answer", "Send answer",
                                          (text) => (m.picks ? m.other(text) : m.step(q.question, text))) : null;
    const actions = h("div", { class: "card-actions" });
    if (multi) {
      doneBtn = h("button", { class: "cta primary", type: "button", disabled: true,
                              onclick: () => this.act(card, () => m.step(q.question, [...picked].join(", ")), doneBtn) }, "Done");
      actions.append(doneBtn);
    }
    if (own) actions.append(h("button", { class: "cta", type: "button", onclick: () => { actions.hidden = true; own.open(); } }, "Something else…"));
    if (actions.children.length) card.append(actions);
    if (own) card.append(own.box);
    return card;
  }

  // A permission: what Claude wants to do in words, the exact command (or
  // the diff) under it, and Allow / Always allow / Don't allow.
  permissionCard(m) {
    const card = this.cardShell("permission", m.title, m.text || null);
    if (m.diff && m.diff.length) card.append(diffView(m.diff));
    if (m.details && !(m.diff && m.diff.length)) {
      const more = h("details", { class: "card-details" }, h("summary", {}, "Details"), h("pre", {}, m.details));
      if (m.tool === "Bash" && !m.text) more.open = true;
      card.append(more);
    }
    if (m.reason) card.append(h("div", { class: "card-note" }, m.reason));
    const no = this.writeField(card, "Tell Claude why, or what to do instead (optional)", "Don't allow", (why) => m.deny(why));
    no.box.querySelector(".cta").classList.replace("primary", "danger");
    const actions = h("div", { class: "card-actions stack" });
    const allow = h("button", { class: "cta primary opt", type: "button", onclick: () => this.act(card, m.allow, allow) }, "Allow");
    actions.append(allow);
    if (m.always && m.alwaysAllow) {
      const always = h("button", { class: "cta opt", type: "button", onclick: () => this.act(card, m.alwaysAllow, always) }, m.always);
      actions.append(always);
    }
    actions.append(h("button", { class: "cta opt", type: "button", onclick: () => { actions.hidden = true; no.open(); } }, "Don't allow…"));
    card.append(actions, no.box);
    return card;
  }

  // A plan to approve: the plan as a document, and what to do with it.
  planAsk(m) {
    const card = this.cardShell("plan", "Claude's plan is ready",
                                m.plan ? "Read it, then say whether Claude should start." : "Say whether Claude should start on it.");
    if (m.plan) card.append(h("div", { class: "plan-doc", html: md(m.plan) }));
    const keep = this.writeField(card, "What should change?", "Keep planning", (what) => m.keep(what));
    keep.box.querySelector(".cta").classList.remove("primary");
    const actions = h("div", { class: "card-actions stack" });
    if (m.approve) {
      const b = h("button", { class: "cta primary opt", type: "button", onclick: () => this.act(card, m.approve, b) }, "Approve and start");
      actions.append(b);
    }
    if (m.approveEdits) {
      const b = h("button", { class: "cta opt", type: "button", onclick: () => this.act(card, m.approveEdits, b) },
                  "Approve, and make the edits without asking");
      actions.append(b);
    }
    for (const o of m.others || []) {
      const b = h("button", { class: "cta opt", type: "button", onclick: () => this.act(card, o.pick, b) }, o.label);
      actions.append(b);
    }
    actions.append(h("button", { class: "cta opt", type: "button", onclick: () => { actions.hidden = true; keep.open(); } }, "Keep planning…"));
    card.append(actions, keep.box);
    return card;
  }

  // Any other menu Claude shows (read off its screen): its choices as they
  // are, the one its cursor is on lit.
  choiceCard(m) {
    const lines = String(m.question || "").split("\n");
    const card = this.cardShell("choice", lines[0] || "Claude asks", lines.slice(1).join("\n") || null);
    const opts = h("div", { class: "opts" });
    m.options.forEach((o, n) => {
      if (o.write) {
        const own = this.writeField(card, "Your answer", "Send answer", o.write);
        opts.append(h("button", { class: "opt", type: "button", onclick: () => own.open() },
          h("span", { class: "n" }, m.numbered ? String(n + 1) : ""), h("span", { class: "what" }, h("b", {}, "Answer in your own words…"))), own.box);
        return;
      }
      const btn = h("button", { class: `opt${o.on ? " on" : ""}`, type: "button", onclick: () => this.act(card, o.pick, btn) },
        h("span", { class: "n" }, m.numbered ? String(n + 1) : ""),
        h("span", { class: "what" }, h("b", {}, o.label), o.detail ? h("small", {}, o.detail) : null));
      opts.append(btn);
    });
    card.append(opts);
    if (m.escape) card.append(h("div", { class: "card-actions" },
      h("button", { class: "text-btn", type: "button", onclick: () => this.act(card, m.escape) }, "Cancel"),
      m.hint ? h("span", { class: "hint" }, m.hint) : null));
    return card;
  }

  // ---- the box you type in

  typed() {
    this.grow();
    store.set(`draft:${this.id}`, this.input.value);
    this.sendButtons();
  }

  grow() {
    this.input.style.height = "auto";
    this.input.style.height = `${Math.min(this.input.scrollHeight, window.innerHeight * 0.4)}px`;
  }

  sendButtons() {
    this.micBtn.hidden = !this.talk.available();
    const empty = !this.input.value.trim();
    const stop = this.working() && empty;
    this.stopBtn.hidden = !stop;
    this.sendBtn.hidden = stop;
    this.sendBtn.disabled = empty || this.talk.on();     // what you say is still coming into the box
    this.composer.classList.toggle("ready", !empty);
  }

  async send() {
    const text = this.input.value;
    if (!text.trim() || this.talk.on()) return;
    this.sendBtn.disabled = true;
    try {
      const r = await this.post("send", { text });
      if (r.waking) toast("Waking Claude with it…");
      this.input.value = "";
      store.set(`draft:${this.id}`, "");
      this.grow();
      this.toBottom();
    } catch (e) {
      toast(e.message);
    }
    this.sendButtons();
  }

  // Stop: the chat engine's interrupt, or Esc in Claude's terminal.
  async stop() {
    try {
      if (this.engine === "chat") await this.post("interrupt", {});
      else await this.post("keys", { keys: ["Escape"] });
    } catch (e) {
      toast(e.message);
    }
  }

  // The box while dictating: what's going on, in place of its placeholder.
  listening(text) {
    this.composer.classList.toggle("listening", text !== null);
    this.micBtn.classList.toggle("on", (this.opts.voiceHeld && this.opts.voiceHeld()) || (this.talk.on() && this.talk.run.held));
    this.input.placeholder = text || this.placeholder;
  }

  setPlaceholder(text) {
    this.placeholder = text;
    if (!this.composer.classList.contains("listening")) this.input.placeholder = text;
  }
}

function unescapeHTML(s) {
  return String(s).replace(/&(lt|gt|amp|quot|#39);/g, (_, e) => ({ lt: "<", gt: ">", amp: "&", quot: '"', "#39": "'" })[e]);
}

// Copied: to this device's clipboard, and the web clipboard (what wl-paste
// in a session reads).
async function copyText(text) {
  clipText(text);
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const t = h("textarea", { class: "offscreen" });
    t.value = text;
    document.body.append(t);
    t.select();
    try { document.execCommand("copy"); } catch (err) { /* nothing more to try */ }
    t.remove();
  }
}
