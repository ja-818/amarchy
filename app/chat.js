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
  // No "*" in a bare link: "**https://x**" (bold) must not take the closing "**".
  s = s.replace(/https?:\/\/[^\s<>()*\u0000]+[^\s<>().,;:!?'"*\u0000]/g,
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
  chart: '<path d="M4 20h16M7 16v-4M12 16V7M17 16v-7"/>',
  fields: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h3M13 9h4M7 15h3M13 15h4"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
};

function icon(name, cls) {
  return h("span", { class: `ic${cls ? ` ${cls}` : ""}`, "aria-hidden": "true",
                     html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
                           `stroke-linecap="round" stroke-linejoin="round">${CHAT_ICONS[name] || ""}</svg>` });
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
const CHATS_SEEN = 16;      // chats whose conversation is kept, to draw it at once when opened again
const chatsSeen = new Map();
const chatsOpen = new Map();      // the chat open now for an id (a message that didn't go comes back to its box)
const ASK_HELD = 15000;     // ms a card you answered stays off the dock while Claude hasn't moved on (Chat.act)

// A message as sent and as the conversation has it, to tell they're one (Chat.settleOutbox).
function outKey(text) { return String(text || "").replace(/\s+/g, " ").trim(); }

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
      return { kind: "other", past: "Looked at the other chats", now: "Looking at the other chats" };
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

// A step's result when you said no to it.
const DENIED = /doesn't want to proceed|rejected|denied|not allowed/i;

// What a failed step says, in words.
function failedWords(name, words, text) {
  const t = String(text || "");
  if (DENIED.test(t)) return `You said no: ${words.now.charAt(0).toLowerCase()}${words.now.slice(1)}`;
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
//   {kind: "question", questions, answered, submit(answers, annotations), other: text field allowed}
//     (a terminal-engine one: one question, index and total, picks: each option's pick(), other(text))
//   {kind: "permission", tool, input, text, title, details, diff, reason, at, count,
//    always: [{label, pick()}], allow(), deny(why)}
//   {kind: "plan", plan, back (the mode approving goes on in), approve(), modes: [{mode | label, pick()}], keep(what)}
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

// The permission modes, in words (the mode picker's too).
const MODE_WORDS = {
  default: { label: "Ask before changes", about: "Claude asks before it edits a file or runs a command" },
  acceptEdits: { label: "Accept edits", about: "Claude edits files without asking, and asks before commands" },
  auto: { label: "Auto", about: "Claude goes ahead with what's safe, and asks about the rest" },
  plan: { label: "Plan first", about: "Claude plans, and changes nothing until you approve" },
  dontAsk: { label: "Only what's allowed", about: "Claude does only what you've always allowed, and asks nothing" },
  bypassPermissions: { label: "Don't ask", about: "Claude does everything without asking" },
};

// Where a rule goes, in words.
const RULE_WHERE = { localSettings: "in this project", projectSettings: "in this project", userSettings: "in every project",
                     session: "for this chat", cliArg: "for this chat" };

// A folder or files a rule names ("//etc/**", "src/**", "app.js"), in words: "in /etc", "app.js".
function rulePath(c) {
  const p = String(c || "").replace(/^\/\//, "/").replace(/^~\//, "your home's ");
  const dir = p.match(/^(.*?)\/\*\*(\/\*)?$/);
  return dir ? `files in ${dir[1] || "/"}` : p;
}

// One rule, in words: "commands starting with “git status”", "pages on example.com".
function rulePhrase(r) {
  const c = r.ruleContent || "";
  const mcp = mcpParts(r.toolName);
  if (mcp) return c ? `${mcp.server}: ${mcp.what}` : `using ${mcp.server}`;
  switch (r.toolName) {
    case "Bash": {
      if (!c) return "every command";
      const start = c.match(/^(.*?)(?::\*| \*)$/);
      return start ? `commands starting with “${cut(start[1], 40)}”` : `the command “${cut(c, 50)}”`;
    }
    case "WebFetch": return c.startsWith("domain:") ? `pages on ${c.slice(7)}` : "reading web pages";
    case "WebSearch": return "searching the web";
    case "Read": case "Glob": case "Grep": return c ? `reading ${rulePath(c)}` : "reading files";
    case "Edit": case "Write": case "MultiEdit": case "NotebookEdit": return c ? `changes to ${rulePath(c)}` : "changing files";
    default: return camelWords(r.toolName).toLowerCase();
  }
}

// What "always allow" can mean for a request of the chat engine's, from
// the suggestions Claude makes with it, each as a button: {label, picks:
// the suggestions it takes (their indexes)}. Claude's rules go together, as
// Claude Code's own "Yes, and don't ask again" takes them all: "Always
// allow commands starting with “git status” in this project, and reading
// files in /etc for this chat". A mode for the chat ("Allow all edits for
// this chat") and folders are choices of their own.
function alwaysChoices(suggestions) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  const out = [];
  const rules = list.map((x, i) => [x, i]).filter(([x]) => x && x.type === "addRules" && Array.isArray(x.rules) && x.rules.length);
  if (rules.length) {
    const where = new Map();      // destination -> its phrases, in order
    for (const [x] of rules) {
      const at = RULE_WHERE[x.destination] || "";
      if (!where.has(at)) where.set(at, []);
      for (const r of x.rules) if (!where.get(at).includes(rulePhrase(r))) where.get(at).push(rulePhrase(r));
    }
    const and = (ws) => (ws.length > 1 ? `${ws.slice(0, -1).join(", ")} and ${ws[ws.length - 1]}` : ws[0]);
    const parts = [...where].map(([at, ws]) => `${and(ws)}${at ? ` ${at}` : ""}`);
    out.push({ label: `Always allow ${parts.join(", and ")}`, picks: rules.map(([, i]) => i) });
  }
  list.forEach((x, i) => {
    if (!x) return;
    if (x.type === "setMode" && x.mode) {
      const at = RULE_WHERE[x.destination] || "for this chat";
      const label = x.mode === "acceptEdits" ? `Allow all edits ${at}`
                  : x.mode === "bypassPermissions" ? `Allow everything ${at}`
                  : `Switch to “${(MODE_WORDS[x.mode] || { label: x.mode }).label}” ${at}`;
      out.push({ label, picks: [i] });
    } else if (x.type === "addDirectories" && Array.isArray(x.directories) && x.directories.length) {
      const dirs = x.directories.map((d) => String(d).replace(/\/$/, ""));
      out.push({ label: `Always allow working in ${dirs.length > 1 ? `${dirs.length} folders` : dirs[0]} ${RULE_WHERE[x.destination] || ""}`.trim(),
                 picks: [i] });
    }
  });
  return out;
}

// A request's reason, when it says more than that it asks.
function reasonWords(reason) {
  const r = String(reason || "").trim();
  return !r || /^(this (command|tool use|operation) )?requires? (approval|permission)\.?$/i.test(r) ? "" : r;
}

// A scraped "Yes, and don't ask again for … commands in …": the words after "Yes, and".
function alwaysWords(label) {
  const t = String(label).replace(/\s*\((shift\+tab|tab)\)\s*$/i, "").replace(/^yes,?\s*(and\s+)?/i, "")
    .replace(/\s+in\s+\/\S+$/, " in this project").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Always allow";
}

// The card's model for a request of the chat engine's (live.pending).
// count: how many requests wait (several tool calls at once ask one after
// the other), at: which this is.
function requestCard(chat, p, at = 0, count = 1) {
  // Paths as the worktree sees them (Claude asks with whole ones).
  const root = chat.row && chat.row.path ? `${chat.row.path.replace(/\/$/, "")}/` : null;
  const rel = (v) => (root && typeof v === "string" && v.startsWith(root) ? v.slice(root.length) : v);
  if (p.input && typeof p.input === "object") {
    p = { ...p, input: { ...p.input } };
    for (const k of ["file_path", "notebook_path", "path"]) if (k in p.input) p.input[k] = rel(p.input[k]);
  }
  const post = (body) => chat.post("answer", { request_id: p.request_id, ...body });
  if (p.tool === "AskUserQuestion") {
    const qs = Array.isArray(p.input && p.input.questions) ? p.input.questions.filter((q) => q && q.question) : [];
    return { kind: "question", id: p.request_id, questions: qs, answered: p.answered || {}, other: true,
             submit: (answers, annotations) => post({ choice: "allow", answers, annotations }) };
  }
  if (p.tool === "ExitPlanMode") {
    const live = chat.live || {};
    // Approved, Claude goes back to the mode it planned from (else asks before changes).
    const back = live.before_plan && live.before_plan !== "plan" ? live.before_plan : "default";
    const others = ["auto", "acceptEdits", "default"].filter((m) => m !== back);
    return { kind: "plan", id: p.request_id, plan: (p.input && p.input.plan) || "", back,
             approve: () => post({ choice: "allow" }),
             modes: others.map((mode) => ({ mode, pick: () => post({ choice: "allow", mode }) })),
             keep: (why) => post({ choice: "deny", message: why || "Keep planning." }) };
  }
  const w = permissionWords(p.tool, p.input, p.description);
  return { kind: "permission", id: p.request_id, tool: p.tool, input: p.input, ...w, reason: reasonWords(p.reason),
           diff: stepDiff(p.tool, p.input, null), at, count,
           always: alwaysChoices(p.suggestions).map((c) => ({ label: c.label, pick: () => post({ choice: "always", suggestions: c.picks }) })),
           allow: () => post({ choice: "allow" }),
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
    return { kind: "plan", id: d.id, plan, approve: approve ? keys(approve) : null,
             modes: [...(edits ? [{ mode: "acceptEdits", pick: keys(edits) }] : []), ...others],
             keep: /tell claude|what to change/i.test(keep.label) ? (why) => (why ? say(keep)(why) : keys(keep)()) : keys(keep) };
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
             always: always ? [{ label: alwaysWords(always.label), pick: keys(always) }] : [],
             allow: keys(opts[0]),
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

// ---- what Claude says: its markdown, and in their place the blocks named
// for what they hold (bin/amarchy REPLY_FORMAT), each with its buttons.

const CHANNEL_WORDS = { whatsapp: "WhatsApp", email: "Email", slack: "Slack", sms: "Text message", other: "Message" };

// An address a block may open: the web, mail, a call or a text
// message, WhatsApp, or a chat of yours in the app. Nothing else.
function artifactHref(href) {
  const v = String(href || "").trim();
  if (/^#\/s\/[\w.-]+$/.test(v)) return v;
  try {
    const u = new URL(v);
    return ["https:", "http:", "mailto:", "tel:", "sms:"].includes(u.protocol) ? u.href : null;
  } catch { return null; }
}

// An event's start or end as a Date, when it's a date and time written out.
function artifactDate(v) {
  const d = typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v) : null;
  return d && !isNaN(d) ? d : null;
}

// The first line of what Claude said (its markdown's marks left out).
function firstLine(text) {
  const line = String(text || "").split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").replace(/[*_`]/g, "").trim()).find(Boolean) || "";
  return cut(line, 120);
}

// ---- the blocks (app/blocks.json, served as blocks.js: BLOCK_CATALOG): one
// catalog for the guidance Claude gets (bin/amarchy REPLY_FORMAT), what's
// read here, and the check when a turn ends (bin/amarchy reply_issues).
// Read here as bin/amarchy reads them (reply_blocks, block_body): the same
// blocks, the same parts of them (test/blocks-catalog.js compares the two).

const BLOCKS = new Map((typeof BLOCK_CATALOG === "object" && BLOCK_CATALOG ? BLOCK_CATALOG.blocks : []).map((b) => [b.kind, b]));
const BLOCK_COMMON = (typeof BLOCK_CATALOG === "object" && BLOCK_CATALOG && BLOCK_CATALOG.common) || {};
const BLOCK_ATTR = /(\w+)\s*=\s*"([^"]*)"/g;
const BLOCK_FIELD = /^\s*(?:[-*]\s+)?([^:]{1,60}?)\s*:\s+(.+?)\s*$/;

// A number as a chart's row has it ("1,200", "$4.2", "12%", "50 ms"), or null.
function blockNumber(text) {
  const m = String(text || "").trim().match(/^[^\d\-+.]{0,3}([-+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+))\s*[%a-zA-Z/]*$/);
  const v = m ? parseFloat(m[1].replace(/,/g, "")) : NaN;
  return isFinite(v) ? v : null;
}

// A block's body read by its shape (bin/amarchy block_body).
function blockBody(shape, body) {
  const lines = body.split("\n").filter((l) => l.trim());
  if (shape === "todos") {
    const items = [], bad = [];
    for (const l of lines) {
      const m = l.match(/^\s*[-*]\s*(?:\[( |x|X)\]\s*)?(.+?)\s*$/);
      if (!m) { bad.push(l); continue; }
      const due = m[2].match(/\s*\(([^)]{1,40})\)\s*$/);
      items.push({ text: due ? m[2].slice(0, due.index) : m[2], due: due ? due[1] : "", done: (m[1] || "").toLowerCase() === "x" });
    }
    return { items, bad };
  }
  if (shape === "options") {
    const options = [], bad = [];
    for (const l of lines) {
      const m = l.match(/^\s*[-*]\s*(.+?)\s*$/);
      if (!m) { bad.push(l); continue; }
      const at = m[1].search(/\s+\|\s+/);
      const label = at < 0 ? m[1] : m[1].slice(0, at), send = at < 0 ? m[1] : m[1].slice(at).replace(/^\s+\|\s+/, "");
      options.push({ label: label.trim(), send: send.trim() });
    }
    return { options, bad };
  }
  if (shape === "fields") {
    const fields = [], bad = [];
    for (const l of lines) {
      const m = l.match(BLOCK_FIELD);
      if (m) fields.push({ label: m[1].trim(), value: m[2] }); else bad.push(l);
    }
    return { fields, bad };
  }
  if (shape === "series") {
    let series = [];
    const points = [], bad = [];
    if (lines.length && lines[0].trimStart().startsWith("|")) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(lines[0]);
      series = head.slice(1);
      for (const l of lines.slice(1)) {
        if (/^\s*\|?\s*:?-{2,}/.test(l)) continue;
        const row = cells(l), values = row.slice(1).map(blockNumber);
        if (row.length !== head.length || values.some((v) => v === null)) bad.push(l);
        else points.push({ label: row[0], values });
      }
    } else {
      series = [""];
      for (const l of lines) {
        const m = l.match(BLOCK_FIELD), v = m ? blockNumber(m[2]) : null;
        if (v === null) bad.push(l); else points.push({ label: m[1].trim(), values: [v] });
      }
    }
    return { series, points, bad };
  }
  if (shape === "url") return { url: lines.length ? lines[0].trim() : "" };
  return {};
}

// The catalog's blocks in what Claude said, in order (bin/amarchy reply_blocks).
function replyBlocks(text) {
  return replyParts(text, true).filter((p) => p.kind);
}

// What Claude said, in order: its markdown ({md}) and the catalog's blocks
// ({kind, attrs, body...}), each where it wrote it. A fence of any other
// kind (code) stays in the markdown; a hidden block (the goal) isn't a part
// unless all: asked for (replyBlocks).
function replyParts(text, all) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const parts = [];
  let buf = [];
  const flush = () => {
    if (buf.join("\n").trim()) parts.push({ md: buf.join("\n").trim() });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^ {0,3}```\s*([A-Za-z]+)?(.*)$/);
    if (!fence) { buf.push(lines[i]); continue; }
    const kind = (fence[1] || "").toLowerCase(), start = i;
    const body = [];
    for (i++; i < lines.length && !/^ {0,3}```\s*$/.test(lines[i]); i++) body.push(lines[i]);
    const d = BLOCKS.get(kind);
    if (!d) { buf.push(lines[start], ...body, "```"); continue; }
    if (d.hidden && !all) continue;
    const specs = { ...BLOCK_COMMON, ...(d.attrs || {}) };
    const names = new Map(Object.entries(specs).flatMap(([name, spec]) => [name, ...(spec.alias || [])].map((a) => [a, name])));
    const raw = [...fence[2].matchAll(BLOCK_ATTR)].map((m) => [m[1].toLowerCase(), m[2]]);
    const attrs = {};
    for (const [k, v] of raw) if (names.has(k) && !(names.get(k) in attrs)) attrs[names.get(k)] = v;
    const text = body.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
    flush();
    parts.push({ kind, attrs, unknown: raw.map(([k]) => k).filter((k) => !names.has(k)), rest: fence[2].replace(BLOCK_ATTR, "").trim(),
                 body: text, closed: i < lines.length, line: start + 1, ...blockBody((d.body || {}).shape || "text", text) });
  }
  flush();
  return parts;
}

// What Claude said, as it folds (bin/amarchy reply_outline): its parts in
// order, those under a "# " or "## " heading together as a section ({title,
// parts}), the rest loose. A section ends at the next heading, or at the
// briefing or a question: those are never folded away.
const SECTION_HEAD = /^#{1,2}\s+(.+?)\s*#*\s*$/;
function replyOutline(parts) {
  const out = [];
  let sec = null;
  const put = (p) => (sec ? sec.parts : out).push(p);
  for (const p of parts) {
    if (p.md === undefined) {
      if (p.kind === "brief" || p.kind === "choices") sec = null;
      put(p);
      continue;
    }
    let buf = [], code = false;
    const flush = () => {
      if (buf.join("\n").trim()) put({ md: buf.join("\n").trim() });
      buf = [];
    };
    for (const l of p.md.split("\n")) {
      if (code ? /^\s*```\s*$/.test(l) : /^\s*```/.test(l)) code = !code;
      const m = code ? null : l.match(SECTION_HEAD);
      if (!m) { buf.push(l); continue; }
      flush();
      out.push(sec = { title: m[1], parts: [] });
    }
    flush();
  }
  return out;
}

// Where the chat stands, in the goal block each reply ends with: its goal
// and its state. Not shown as words: under the chat's name, on Today, and
// as the strip that offers to close a done chat.
const GOAL_STATES = ["working", "waiting", "blocked", "done"];
const GOAL_FENCE = /^```[ \t]*goal\b([^\n]*)\n([\s\S]*?)^```[ \t]*$\n?/gm;

function replyGoal(text) {
  const found = replyBlocks(text).filter((b) => b.kind === "goal").pop();
  if (!found) return null;
  const state = (found.attrs.state || "").trim().toLowerCase();
  const goal = found.body.split(/\s+/).join(" ").trim();
  return goal || state ? { goal, state: GOAL_STATES.includes(state) ? state : "" } : null;
}

function withoutGoal(text) { return String(text || "").replace(GOAL_FENCE, "").replace(/\s+$/, ""); }

// ---- a chart block, drawn (docs/plan-chat-app.md, the dataviz method): one
// axis, thin marks, the series' colors in a fixed order (--chart-1..8, ui.css;
// one series, the theme's accent), text in the text's colors, a legend for
// two or more series, and its numbers a tap away (Numbers: a table).
// Bars: a row each, its value at the tip (HTML: crisp at any width). Lines:
// the plot stretched to its box (vector-effect keeps them 2px), its labels
// and end dots in HTML over it, a crosshair and what each series is there
// under the finger or the pointer.

// A chart's number in words: compact from 10,000 (12K, 4.2M), its unit
// ($ before, % after; any other is the chart's subtitle).
function chartNumber(v, unit) {
  const a = Math.abs(v);
  const n = a >= 1e9 ? `${+(v / 1e9).toFixed(1)}B` : a >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : a >= 1e4 ? `${+(v / 1e3).toFixed(1)}K`
    : `${+v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const u = String(unit || "").trim();
  return /^[$€£¥]$/.test(u) ? (v < 0 ? `-${u}${n.slice(1)}` : `${u}${n}`) : u === "%" ? `${n}%` : n;
}

// Round ticks for a range: about four, at 1, 2 or 5 times a power of ten.
function chartTicks(lo, hi) {
  if (lo === hi) { lo = lo > 0 ? 0 : lo - 1; hi = hi > 0 ? hi : hi + 1; }
  const raw = (hi - lo) / 4, pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((x) => x >= raw);
  const ticks = [];
  for (let t = Math.floor(lo / step) * step; t <= hi + step * 1e-9; t += step) ticks.push(+t.toFixed(10));
  if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function chartView(a) {
  const unit = (a.attrs.unit || "").trim(), pts = a.points || [], series = a.series || [];
  const many = series.length > 1;
  const color = (i) => (many ? `s${(i % 8) + 1}` : "s0");
  const box = h("div", { class: "chart" });
  if (!pts.length) return box;
  if (many) box.append(h("div", { class: "chart-legend" }, ...series.map((name, i) =>
    h("span", { class: "chart-key" }, h("span", { class: `chart-swatch ${color(i)}` }), name))));
  const line = (a.attrs.type || "").toLowerCase() === "line";
  const all = pts.flatMap((p) => p.values);
  if (!line) {
    // Bars from one baseline (0), a row per label, a bar per series.
    const lo = Math.min(0, ...all), hi = Math.max(0, ...all), span = hi - lo || 1, zero = (-lo / span) * 100;
    box.append(h("div", { class: `chart-bars${many ? " grouped" : ""}`, role: "img", "aria-label": a.attrs.title || "Chart" },
      ...pts.map((p) => h("div", { class: "chart-row" }, h("span", { class: "chart-label" }, p.label),
        h("div", { class: "chart-cells" }, ...p.values.map((v, i) => {
          const bar = h("span", { class: `chart-bar ${color(i)}${v < 0 ? " neg" : ""}` });
          bar.style.left = `${v < 0 ? zero - (-v / span) * 100 : zero}%`;
          bar.style.width = `${(Math.abs(v) / span) * 100}%`;
          const val = h("span", { class: "chart-val" }, chartNumber(v, unit));
          // At its tip, past the bar's end (before it for one below 0).
          if (v < 0) val.style.right = `${100 - (zero - (-v / span) * 100)}%`;
          else val.style.left = `${zero + (v / span) * 100}%`;
          return h("div", { class: "chart-track" }, bar, val);
        }))))));
  } else {
    // Lines: x by order, y on round ticks; the plot's 0..100 box stretched to its size.
    const ticks = chartTicks(Math.min(...all), Math.max(...all));
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const x = (i) => (pts.length === 1 ? 50 : (i / (pts.length - 1)) * 100), y = (v) => 100 - ((v - lo) / (hi - lo)) * 100;
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "chart-svg");
    const el = (name, attrs) => { const e = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
    for (const t of ticks) svg.append(el("line", { x1: 0, x2: 100, y1: y(t), y2: y(t), class: `chart-grid${t === 0 ? " zero" : ""}`, "vector-effect": "non-scaling-stroke" }));
    series.forEach((_, si) => {
      const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.values[si])}`).join(" ");
      if (!many) svg.append(el("path", { d: `${d} L${x(pts.length - 1)},100 L${x(0)},100 Z`, class: `chart-area ${color(si)}` }));
      svg.append(el("path", { d, class: `chart-line ${color(si)}`, "vector-effect": "non-scaling-stroke" }));
    });
    const plot = h("div", { class: "chart-plot" }, svg);
    // The last value of each series: its dot, and its number beside it (one series).
    series.forEach((_, si) => {
      const v = pts[pts.length - 1].values[si];
      const dot = h("span", { class: `chart-dot ${color(si)}` });
      dot.style.left = `${x(pts.length - 1)}%`;
      dot.style.top = `${y(v)}%`;
      plot.append(dot);
      if (!many) {
        const end = h("span", { class: "chart-end" }, chartNumber(v, unit));
        end.style.top = `${y(v)}%`;
        plot.append(end);
      }
    });
    // Under the finger or the pointer: a crosshair, and every series there.
    const cross = h("span", { class: "chart-cross", hidden: true });
    const tip = h("div", { class: "chart-tip", hidden: true });
    const dots = series.map((_, si) => h("span", { class: `chart-dot hover ${color(si)}`, hidden: true }));
    plot.append(cross, ...dots, tip);
    const at = (e) => {
      const r = plot.getBoundingClientRect();
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1))));
      cross.hidden = tip.hidden = false;
      cross.style.left = `${x(i)}%`;
      dots.forEach((d, si) => { d.hidden = false; d.style.left = `${x(i)}%`; d.style.top = `${y(pts[i].values[si])}%`; });
      tip.replaceChildren(h("div", { class: "chart-tip-head" }, pts[i].label), ...series.map((name, si) =>
        h("div", { class: "chart-tip-row" }, many ? h("span", { class: `chart-swatch ${color(si)}` }) : null,
          h("strong", {}, chartNumber(pts[i].values[si], unit)), many ? h("span", {}, name) : null)));
      tip.classList.toggle("left", x(i) > 55);
      tip.style.left = `${x(i)}%`;
    };
    const off = () => { cross.hidden = tip.hidden = true; dots.forEach((d) => { d.hidden = true; }); };
    plot.addEventListener("pointermove", at);
    plot.addEventListener("pointerdown", at);
    plot.addEventListener("pointerleave", off);
    const yAxis = h("div", { class: "chart-y" }, ...ticks.map((t) => { const l = h("span", {}, chartNumber(t, unit)); l.style.top = `${y(t)}%`; return l; }));
    const marks = pts.length > 4 ? [0, Math.floor((pts.length - 1) / 2), pts.length - 1] : pts.map((_, i) => i);
    const xAxis = h("div", { class: "chart-x" }, ...marks.map((i) => {
      const l = h("span", { class: i === 0 ? "first" : i === pts.length - 1 ? "last" : "" }, pts[i].label);
      l.style.left = `${x(i)}%`;
      return l;
    }));
    box.append(h("div", { class: "chart-lines", role: "img", "aria-label": a.attrs.title || "Chart" }, yAxis, plot, h("span"), xAxis));
  }
  // Its numbers, as a table, a tap away (and for whoever can't tell the colors).
  const table = h("div", { class: "table-wrap rtable-wrap chart-table", hidden: true },
    h("table", { class: "rtable" }, h("thead", {}, h("tr", {}, h("th", {}, ""), ...series.map((name) => h("th", {}, name || "Value")))),
      h("tbody", {}, ...pts.map((p) => h("tr", {}, h("td", { class: "lead" }, p.label),
        ...p.values.map((v, i) => h("td", { "data-label": series[i] || "Value" }, chartNumber(v, unit))))))));
  const toggle = h("button", { class: "art-btn chart-numbers", type: "button", "aria-expanded": "false", onclick: (e) => {
    e.stopPropagation();
    table.hidden = !table.hidden;
    toggle.setAttribute("aria-expanded", String(!table.hidden));
    toggle.textContent = table.hidden ? "Numbers" : "Hide numbers";
  } }, "Numbers");
  box.append(toggle, table);
  return box;
}

// Tables in what Claude said: on a phone, each row a little card, its cells
// under their column's name (blocks.css, from data-label).
function tableize(el) {
  el.querySelectorAll("table").forEach((tb) => {
    tb.classList.add("rtable");
    if (tb.parentElement && tb.parentElement.classList.contains("table-wrap")) tb.parentElement.classList.add("rtable-wrap");
    const heads = [...tb.querySelectorAll("thead th")].map((th) => th.textContent.replace(/[*_`]/g, "").trim());
    tb.querySelectorAll("tbody tr").forEach((tr) => [...tr.children].forEach((td, j) => {
      if (j === 0) td.classList.add("lead");
      else if (heads[j]) td.dataset.label = heads[j];
    }));
  });
  return el;
}

// ---- a chat's stream, asked for as your finger lands on its card
//
// A tap's click comes when the finger lifts, a tenth of a second or more
// after it landed: the chat's stream (its conversation, its state) is on
// its way from then, so the chat has it when it opens. What comes before
// it's open is kept, and given to it in order (Chat.open). Not opened (the
// finger scrolled, or went elsewhere): closed.

const STREAM_EVENTS = ["session", "conversation", "screen", "live", "gone"];
let streamEarly = null;       // {id, es, got: [[type, event]], keep: {type: listener}, timer}

function chatStreamEarly(id) {
  if (streamEarly && streamEarly.id === id && streamEarly.es.readyState !== EventSource.CLOSED) return;
  chatStreamDrop();
  const es = new EventSource(streamURL(`/api/session/${encodeURIComponent(id)}/stream`));
  const early = { id, es, got: [], keep: {} };
  for (const type of STREAM_EVENTS) {
    early.keep[type] = (e) => early.got.push([type, e]);
    es.addEventListener(type, early.keep[type]);
  }
  early.timer = setTimeout(() => { if (streamEarly === early) chatStreamDrop(); }, 5000);
  streamEarly = early;
}

function chatStreamDrop() {
  if (!streamEarly) return;
  clearTimeout(streamEarly.timer);
  streamEarly.es.close();
  streamEarly = null;
}

// The one asked for early, for the chat opening now: its stream and what came on it.
function chatStreamTake(id) {
  const early = streamEarly;
  if (!early || early.id !== id || early.es.readyState === EventSource.CLOSED) { chatStreamDrop(); return null; }
  clearTimeout(early.timer);
  streamEarly = null;
  for (const type of STREAM_EVENTS) early.es.removeEventListener(type, early.keep[type]);
  return early;
}

// A finger (or the mouse) still on a chat's card a moment (not on one of its
// buttons), or lifted from it: its stream, now. A finger that moves (a
// scroll) or is taken by the browser lets it go: flicking the board
// doesn't download conversations.
const EARLY_STILL = 80;      // ms a finger rests before its chat is asked for
const earlyTouch = { id: null, x: 0, y: 0, timer: 0 };
addEventListener("pointerdown", (e) => {
  clearTimeout(earlyTouch.timer);
  earlyTouch.id = null;
  if (e.button !== 0) return;
  const card = e.target.closest && e.target.closest(".tcard[data-id]");
  if (!card) return;
  const control = e.target.closest("button, a, input, textarea, select, summary");
  if (control && !control.matches(".today-go")) return;      // its own buttons do their own thing
  Object.assign(earlyTouch, { id: card.dataset.id, x: e.clientX, y: e.clientY });
  earlyTouch.timer = setTimeout(() => chatStreamEarly(earlyTouch.id), EARLY_STILL);
}, true);
addEventListener("pointermove", (e) => {
  if (!earlyTouch.id || Math.hypot(e.clientX - earlyTouch.x, e.clientY - earlyTouch.y) < 10) return;
  clearTimeout(earlyTouch.timer);
  if (streamEarly && streamEarly.id === earlyTouch.id) chatStreamDrop();
  earlyTouch.id = null;
}, { capture: true, passive: true });
addEventListener("pointerup", () => {
  clearTimeout(earlyTouch.timer);
  if (earlyTouch.id) chatStreamEarly(earlyTouch.id);      // a quick tap: its click comes now
  earlyTouch.id = null;
}, true);
addEventListener("pointercancel", () => {
  clearTimeout(earlyTouch.timer);
  earlyTouch.id = null;
  chatStreamDrop();
}, true);

class Chat {
  // opts: id; onSession(row), onScreen(screen), onGone(): for whoever
  // shows the chat (its header, its other views).
  constructor(opts) {
    this.opts = opts;
    this.id = opts.id;
    this.row = opts.row || null;
    this.screen = null;
    this.live = null;
    this.placeholder = "Message Claude";
    this.view = { content: null, above: [], composer: true };
    // The conversation's items, in order (see keepItems).
    this.goal = null;           // what the chat is for, from its replies (keepItems)
    this.items = [];
    this.itemKeys = new Set();
    this.answers = new Map();   // your answers to a message's choices, by its key: {picks, sent}
    this.opened = new Map();    // the blocks you opened or folded, by their key -> open
    this.outbox = [];           // what you sent, shown at once, until the conversation (or the queue) has it (send)
    this.answeredAsks = new Map();      // the cards you answered, off the dock at once: their id -> when (act)
    this.reset();
    this.build();
  }

  reset() {
    this.steps = new Map();     // tool call id -> its step
    this.keys = new Set();      // items shown already
    this.fold = null;           // the steps being added to, until Claude says something
    this.work = null;           // the turn's work: what Claude did and said on the way to its reply
    this.loose = null;          // what Claude said last this turn, not in its work (its reply, unless a step follows)
    this.todo = null;           // the newest checklist
    this.tasks = new Map();     // Claude's tasks (TaskCreate, TaskUpdate), and their checklist
    this.taskCard = null;
    this.lastStep = null;
    this.said = null;           // the last thing Claude said, as the conversation has it
    this.endStream();
  }

  get engine() { return this.row && this.row.engine === "chat" ? "chat" : "terminal"; }

  build() {
    this.conv = h("div", { class: "conv chat-conv" });
    this.tail = h("div", { class: "chat-tail" });
    this.conv.append(this.tail);
    // A code block's Copy.
    this.conv.addEventListener("click", (e) => {
      const btn = e.target.closest(".copy");
      if (!btn) return;
      const code = btn.closest(".code").querySelector("code").textContent;
      copyText(code).then(() => { btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy"; }, 1500); });
    });
    this.outboxEl = h("div", { class: "chat-conv chat-outbox" });
    this.scroller = h("div", { class: "scroll chat-scroll" }, this.conv, this.outboxEl);
    this.latest = h("button", { class: "to-latest", type: "button", hidden: true, "aria-label": "Go to the latest",
                                onclick: () => this.toBottom(true) }, icon("down"));
    // At the bottom, it stays there as what's under grows (a reply coming in,
    // a picture loading, the box growing): read once per scroll you make, not
    // again by everything that draws (atBottom).
    this.stuck = true;
    this.scroller.addEventListener("scroll", () => { this.stuck = this.measureBottom(); if (this.stuck) this.latest.hidden = true; }, { passive: true });
    this.sizes = new ResizeObserver(() => { if (this.stuck) this.scroller.scrollTop = this.scroller.scrollHeight; });
    for (const el of [this.scroller, this.conv, this.outboxEl]) this.sizes.observe(el);
    this.dock = h("div", { class: "dock chat-dock" });
    this.buildComposer();
    // The message the keys are on, lit (navMark), kept by the chat whatever
    // the browser does with its focus: wherever the keys or a click go in the
    // messages, that one; drawn again, the one in its place.
    this.navSel = null;
    this.scroller.addEventListener("focusin", (e) => {
      const it = this.navItemOf(e.target);
      if (it) this.navPick(it);
      uiInner(this.scroller, it && this.navInside(it).includes(e.target) ? e.target : null);
    });
    this.scroller.addEventListener("click", (e) => { const it = this.navItemOf(e.target); if (it) this.navPick(it); });
    // Writing (the box, what's asked in the dock): no message lit.
    this.dock.addEventListener("focusin", () => this.el.classList.add("writing"));
    this.dock.addEventListener("focusout", (e) => { if (!this.dock.contains(e.relatedTarget)) this.el.classList.remove("writing"); });
    this.input.addEventListener("focus", () => { this.navSel = null; });      // written to: the latest one, after
    let marking = 0;
    new MutationObserver(() => { if (!marking) marking = requestAnimationFrame(() => { marking = 0; this.navMark(); }); })
      .observe(this.scroller, { childList: true, subtree: true });
    this.el = h("div", { class: "chat" }, h("div", { class: "chat-main" }, this.scroller, this.latest), this.dock);
    this.listenDrops();
    this.renderDock();
  }

  buildComposer() {
    this.input = h("textarea", { rows: 1, placeholder: this.placeholder, enterkeyhint: "enter", "aria-label": "Message",
                                 "aria-autocomplete": "list", oninput: () => this.typed() });
    this.input.value = store.get(`draft:${this.id}`) || "";
    // A picture or a file pasted into the box goes with the message (text
    // pasted is text, even when an image of it comes along, as from a sheet).
    this.input.addEventListener("paste", (e) => {
      const d = e.clipboardData;
      const files = d ? Array.from(d.files || []) : [];
      if (!files.length || (d.getData("text/plain") || "").trim()) return;
      e.preventDefault();
      this.addFiles(files);
    });
    this.input.addEventListener("keydown", (e) => {
      // Dictating: Enter or Esc stops it, the words stay in the box (dictate.js),
      // and the key goes no further (not to send, not to stop Claude).
      if (this.talk.keyStops(e)) { e.preventDefault(); e.stopPropagation(); return; }
      if (this.slashKeys(e)) return;
      // On a computer, Enter sends and Shift+Enter is a new line; on a phone
      // its keyboard's return is a new line, the arrow sends.
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(hover: hover) and (pointer: fine)").matches) {
        e.preventDefault();
        this.send();
      }
    });
    this.input.addEventListener("blur", () => setTimeout(() => {
      if (this.menu && this.menu.name === "slash" && !this.box.contains(document.activeElement)) this.closeMenu();
    }, 150));
    this.attachBtn = h("button", { class: "cbtn attach", type: "button", "aria-label": "Add a photo or a file", "aria-haspopup": "menu",
                                   onclick: () => this.toggleMenu("add") }, icon("plus"));
    this.micBtn = h("button", { class: "cbtn mic", type: "button", "aria-label": "Dictate (hold, or tap and tap again)", hidden: true },
                    glyph("mic"));
    this.sendBtn = h("button", { class: "cbtn send", type: "button", "aria-label": "Send", onclick: () => this.send() }, glyph("send"));
    this.stopBtn = h("button", { class: "cbtn stop", type: "button", "aria-label": "Stop Claude", onclick: () => this.stop() }, glyph("stop"));
    // What you say, into the box (dictate.js).
    this.talk = new Dictate({ field: this.input, button: this.micBtn,
                              changed: () => this.typed(),
                              state: (text) => this.listening(text) });
    // The pictures and files going with the message, over the line you type on.
    this.tray = [];
    this.trayEl = h("div", { class: "tray", hidden: true });
    this.composer = h("div", { class: "composer" }, this.trayEl,
      h("div", { class: "composer-row" }, this.attachBtn, this.input, this.micBtn, this.stopBtn, this.sendBtn));
    // Over it: the model and the mode, and the menu that's open (+, /, a pill's).
    this.info = null;           // /composer: the commands, the models, the model and mode
    this.modelPill = h("button", { class: "pill", type: "button", "aria-haspopup": "menu", onclick: () => this.toggleMenu("model") });
    this.modePill = h("button", { class: "pill", type: "button", "aria-haspopup": "menu", onclick: () => this.toggleMenu("mode") });
    this.pills = h("div", { class: "pills" }, this.modelPill, this.modePill);
    this.menuEl = h("div", { class: "cmenu", role: "menu", tabindex: "-1", hidden: true });
    menuKeys(this.menuEl, { close: () => this.closeMenu(true) });
    this.box = h("div", { class: "composer-wrap" }, this.menuEl, this.pills, this.composer);
    this.queueEl = h("div", { class: "queue" });
    this.bgEl = h("div", { class: "bg-strip", hidden: true });
    this.doneEl = h("div", { class: "done-strip", hidden: true });
    this.drawPills();
    this.drawTray();
    this.takeShare();
  }

  // What you shared into amarchy, opened in this chat to say more first
  // (app.js's share sheet): in the box, as if pasted, its words before yours.
  takeShare() {
    const s = typeof shareInbox !== "undefined" ? shareInbox : null;
    if (!s || s.id !== this.id) return;
    shareInbox = null;
    this.addFiles(s.files);
    if (s.text) this.input.value = this.input.value.trim() ? `${s.text}\n\n${this.input.value}` : `${s.text}\n\n`;
    this.typed();
    requestAnimationFrame(() => this.input.focus({ preventScroll: true }));
  }

  // A file dropped on the chat goes with the message too (the wide layout
  // hands its drops here as well).
  listenDrops() {
    this.el.addEventListener("dragover", (e) => {
      if (!this.canDrop(e)) return;
      e.preventDefault();
      this.el.classList.add("dropping");
    });
    this.el.addEventListener("dragleave", (e) => { if (!this.el.contains(e.relatedTarget)) this.el.classList.remove("dropping"); });
    this.el.addEventListener("drop", (e) => {
      this.el.classList.remove("dropping");
      if (!this.canDrop(e)) return;
      e.preventDefault();
      this.addFiles(Array.from(e.dataTransfer.files || []));
      this.input.focus();
    });
  }

  // ---- the stream

  open() {
    this.loadInfo();
    // Opened before: drawn at once as it was when you left it, the stream's
    // own then adding only what came since (conversation).
    const was = chatsSeen.get(this.id);
    if (was && !this.items.length) {
      this.conversation({ reset: true, items: was.items, start: was.start });
    }
    chatsOpen.set(this.id, this);
    // Asked for already, as your finger landed on its card: that one, and what came on it.
    const early = chatStreamTake(this.id);
    const es = early ? early.es : new EventSource(streamURL(`/api/session/${encodeURIComponent(this.id)}/stream`));
    this.es = es;
    if (!early || !early.got.length) streamWatch(es, () => { if (this.es === es && !this.closed) this.reopen(); });
    this.onAskEvent = this.onAskEvent || ((e) => { if (e.detail && e.detail.id === this.id) this.showCard(); });
    window.addEventListener("amarchy-ask", this.onAskEvent);
    this.onNavKey = this.onNavKey || ((e) => this.navKey(e));
    window.addEventListener("keydown", this.onNavKey, true);
    this.clearNotes();
    const on = {
      session: (e) => {
        this.row = JSON.parse(e.data);
        if (this.opts.onSession) this.opts.onSession(this.row);
        this.renderDock();
        this.renderTail();
      },
      conversation: (e) => this.conversation(JSON.parse(e.data)),
      screen: (e) => {
        this.screen = JSON.parse(e.data);
        if (this.opts.onScreen) this.opts.onScreen(this.screen);
        this.renderDock();
      },
      live: (e) => {
        this.live = JSON.parse(e.data);
        this.renderDock();
        this.renderTail();
      },
      gone: () => { if (this.opts.onGone) this.opts.onGone(); },
    };
    for (const type of STREAM_EVENTS) es.addEventListener(type, on[type]);
    if (early) for (const [type, e] of early.got) { if (this.es !== es) break; on[type](e); }
    es.addEventListener("error", () => {
      if (es.readyState === EventSource.CLOSED && this.opts.onGone) this.opts.onGone("error");
    });
  }

  close() {
    clearInterval(this.bgTimer);
    if (this.items.length) {
      chatsSeen.delete(this.id);
      chatsSeen.set(this.id, { items: this.items.slice(), start: this.start });
      while (chatsSeen.size > CHATS_SEEN) chatsSeen.delete(chatsSeen.keys().next().value);
    }
    if (this.es) this.es.close();
    this.es = null;
    window.removeEventListener("amarchy-ask", this.onAskEvent);
    window.removeEventListener("keydown", this.onNavKey, true);
    clearInterval(this.workingTimer);
    this.workingEl = null;
    this.closeMenu();       // (its listener on the page held the chat after it closed)
    this.endStream();
    this.bgSig = this.pillsSig = null;
    if (chatsOpen.get(this.id) === this) chatsOpen.delete(this.id);
    this.closed = true;
    this.talk.cancel();
  }

  reopen() {
    this.close();
    this.closed = false;
    this.open();
  }

  // A notification about this session's card was tapped: the conversation,
  // and the card in it (now, or as soon as it's there).
  showCard() {
    this.askWanted = Date.now();
    if (this.opts.onAsk) this.opts.onAsk();
    else if (this.view.content) this.setView();
    this.focusCard();
  }

  focusCard() {
    if (!this.askWanted || Date.now() - this.askWanted > 15000) { this.askWanted = null; return; }
    const card = this.dock.querySelector(".card");
    if (!card) return;
    this.askWanted = null;
    this.toBottom(true);
    (menuStart(card) || card).focus({ preventScroll: true });
    card.classList.remove("called");
    void card.offsetWidth;
    card.classList.add("called");
  }

  // ---- the keys, as on the board: j / k (↓ ↑) from message to message,
  // l (→) into one, along its buttons and links, h (←) back and out of it,
  // Enter on a button presses it, g / G the first and the latest, d / u half
  // a page, i the box you type in and Esc out of it again. Esc on a message:
  // opts.back.
  // Messages are commands then, not words: i to write (Ctrl+Alt+Enter to
  // dictate works from anywhere).

  navItems() {
    if (!this.conv.isConnected) return [];
    return [...this.conv.querySelectorAll(":scope > :not(.chat-tail)")].filter((el) => el.childElementCount && el.getClientRects().length);
  }

  // The message el is in, if it's one the keys go through.
  navItemOf(el) {
    return this.navItems().find((it) => it === el || it.contains(el)) || null;
  }

  // The keys on this message now.
  navPick(item) {
    const items = this.navItems();
    if (!items.includes(item)) return;
    this.navSel = { el: item, fromEnd: items.length - 1 - items.indexOf(item) };
    this.navMark();
  }

  // The message the keys are on: kept; drawn again, the one in its place;
  // none picked yet (or written since), the latest.
  navLit(items = this.navItems()) {
    if (!items.length) return null;
    const s = this.navSel;
    if (!s) return items[items.length - 1];
    if (items.includes(s.el)) return s.el;
    return items[Math.max(0, items.length - 1 - s.fromEnd)];
  }

  // The one lit (.nav-sel).
  navMark() {
    if (this.closed) return null;
    const items = this.navItems();
    const lit = this.navLit(items);
    for (const x of this.scroller.querySelectorAll(".nav-sel")) if (x !== lit) x.classList.remove("nav-sel");
    if (!lit) return null;
    lit.classList.add("nav-sel");
    if (this.navSel) this.navSel = { el: lit, fromEnd: items.length - 1 - items.indexOf(lit) };
    return lit;
  }

  // What's in a message to go to: its buttons and links.
  navInside(item) {
    return item ? [...item.querySelectorAll("button, a[href], summary")].filter((b) => !b.disabled && b.getClientRects().length) : [];
  }

  // up: come to from below (k), so a message taller than the page shows its
  // end, to read up through it; else its top. One that fits: just in sight.
  navTo(el, start, up) {
    if (!el) return;
    if (!el.matches("button, a[href], summary, input, textarea")) { el.tabIndex = -1; el.classList.add("nav-item"); }
    el.focus({ preventScroll: true });
    const it = this.navItemOf(el);
    if (it) this.navPick(it);
    uiInner(this.scroller, it && it !== el ? el : null);
    const r = el.getBoundingClientRect(), v = this.scroller.getBoundingClientRect();
    uiReveal(el, { scroller: this.scroller, block: start ? "start" : r.height > v.height ? (up ? "end" : "start") : "nearest" });
  }

  // The keys on the latest message (Esc out of the box, a chat opened with the keys).
  navLatest() {
    const items = this.navItems();
    if (!items.length) return false;
    this.navTo(items[items.length - 1]);
    return true;
  }

  // Whether the keys are in this chat's messages (not the box, the side, a sheet).
  navHere() {
    const a = document.activeElement;
    return !!a && this.scroller.contains(a);
  }

  navKey(e) {
    if (this.closed || !this.el.isConnected || !this.el.getClientRects().length) return false;
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return false;
    if (document.querySelector(".sheet-back, .picker-back, .mission")) return false;
    const a = document.activeElement;
    const k = e.key;
    const done = () => { e.preventDefault(); e.stopPropagation(); return true; };
    // In the box: Esc leaves it for the messages (once more: back), unless
    // it's for something in it (a menu, the dictation, the / list).
    if (a === this.input) {
      if (k !== "Escape" || this.menu || this.talk.on()) return false;
      return this.navLatest() ? done() : false;
    }
    // The box's card, the side panel, the terminal: theirs. A button of the
    // bar clicked (one Safari didn't focus, too): the messages' still.
    const ours = !a || a === document.body || this.scroller.contains(a) || (a.closest && a.closest(".ui-bar") && !this.dock.contains(a));
    if (!ours) return false;
    if (a && a.closest && a.closest("textarea, input, select, [contenteditable]")) return false;
    const items = this.navItems();
    let at = items.findIndex((it) => it === a || it.contains(a));
    // The browser's focus off the messages (a click on nothing, on the bar,
    // the window left and back): the keys go on from the one lit.
    const focused = at >= 0;
    if (!focused) at = items.indexOf(this.navLit(items));
    const item = items[at];
    const inside = this.navInside(item);
    // On a button in it, or the focus off it: the one lit in it (uiInner).
    let on = inside.indexOf(a);
    if (on < 0 && !focused) on = inside.indexOf(uiInnerOf(item, inside));
    const go = (i, up) => { this.navTo(items[Math.max(0, Math.min(items.length - 1, i))], false, up); return done(); };
    if (k === "i") {
      if (!this.dock.contains(this.input)) return false;      // a card's up: its keys are its own
      this.input.focus({ preventScroll: true });
      this.toBottom(true);
      return done();
    }
    if (!items.length) return false;
    // A message taller than the page reads as pages going down: j goes
    // through it first, then on. k goes straight to the one before (going
    // up through it, the messages under it slid away under you).
    const v = this.scroller.getBoundingClientRect(), step = v.height * 0.7;
    const r = item && (a === item || !focused) ? item.getBoundingClientRect() : null;
    if ((k === "j" || k === "ArrowDown") && r && r.bottom > v.bottom + 8) { this.scroller.scrollBy({ top: Math.min(step, r.bottom - v.bottom + 16) }); return done(); }
    if (k === "j" || k === "ArrowDown") return go(at < 0 ? items.length - 1 : at + 1);
    if (k === "k" || k === "ArrowUp") return go(at < 0 ? items.length - 1 : at - 1, true);
    if (k === "g" || k === "Home") { this.navTo(items[0], true); return done(); }
    if (k === "G" || k === "End") { go(items.length - 1); this.toBottom(true); return true; }
    if (k === "d" || k === "u") { this.scroller.scrollBy({ top: (k === "d" ? 1 : -1) * this.scroller.clientHeight / 2 }); return done(); }
    if (!item) return false;
    if (k === "l" || k === "ArrowRight") {
      if (inside.length) this.navTo(inside[Math.min(on + 1, inside.length - 1)]);
      return done();
    }
    if (k === "h" || k === "ArrowLeft") { if (on >= 0) this.navTo(on === 0 ? item : inside[on - 1]); return done(); }
    if (k === "Escape" && on >= 0) { this.navTo(item); return done(); }
    if (k === "Escape" && this.opts.back) { this.opts.back(); return done(); }      // the phone's; a computer's board has its own Esc
    // Enter, the focus off the message: the button lit in it, pressed.
    if (k === "Enter" && !focused && on >= 0 && !(a && a.closest && a.closest("button, a[href], summary"))) { this.navTo(inside[on]); inside[on].click(); return done(); }
    if (k === "Enter" && (a === item || (!focused && !(a && a.closest && a.closest("button, a[href], summary")))) && !item.matches("button, a[href]")) return done();
    return false;
  }

  // The notifications about this session: seen, now it's open.
  clearNotes() {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.getRegistration) return;
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg || !reg.getNotifications) return;
      return Promise.all([reg.getNotifications({ tag: this.id }), reg.getNotifications({ tag: `assistant-${this.id}` })])
        .then((lists) => lists.flat().forEach((n) => n.close()));
    }).catch(() => {});
  }

  // A request to the session's routes ("keys", "send", "answer", "interrupt"...).
  // What you send or answer goes, and whoever holds the chat is told at
  // once, not when the server answers (opts.onSent: back to the board, its
  // card answered); should the server not take it, told that too
  // (opts.onUnsent: its card asks again). Not Esc's stop. told: the caller
  // tells them itself (send).
  post(route, body, { told = false } = {}) {
    const sent = route === "send" || route === "answer" || (route === "keys" && body && body.dialog !== undefined);
    const done = api(`/api/session/${encodeURIComponent(this.id)}/${route}`, body);
    if (sent && !told && this.opts.onSent) {
      this.opts.onSent(route);
      done.catch(() => this.unsent());
    }
    return done;
  }

  unsent() { if (this.opts.onUnsent) this.opts.onUnsent(); }

  // ---- what shows: the conversation, or another view of the session's
  // (its terminal, its screen) with rows of keys above the dock and maybe
  // the box you type in.

  setView({ content = null, above = [], composer = true } = {}) {
    this.view = { content, above, composer };
    this.showBody(content);
    this.el.classList.toggle("other", !!content);
    this.cardKey = null;
    this.renderDock();
    if (!content) this.toBottom(true);
  }

  // What the scroller shows: another view's content, or the conversation
  // with what you sent under it, on its way.
  showBody(content = null) {
    this.scroller.replaceChildren(...(content ? [content] : [this.conv, this.outboxEl]));
  }

  atBottom() { return this.stuck; }

  measureBottom() {
    const s = this.scroller;
    return s.scrollTop + s.clientHeight >= s.scrollHeight - 120;
  }

  toBottom(now) {
    this.stuck = true;
    const go = () => { this.scroller.scrollTop = this.scroller.scrollHeight; this.latest.hidden = true; };
    if (now) go();
    else requestAnimationFrame(go);
  }

  // Where a chat you open (or a turn that just ended) lands: on the top of
  // Claude's reply, its Briefing, when the reply is the last thing and
  // doesn't fit the screen; else the bottom. Not while Claude works.
  toReply() {
    if (this.working()) return this.toBottom();
    this.stuck = true;
    requestAnimationFrame(() => {
      const s = this.scroller, last = this.tail.previousElementSibling;
      const bottom = s.scrollHeight - s.clientHeight;
      const top = last && last.matches(".msg.claude") ? last.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop - 12 : bottom;
      s.scrollTop = Math.max(0, Math.min(bottom, top));
      this.stuck = this.measureBottom();
      this.latest.hidden = true;
    });
  }

  // ---- the conversation

  conversation(d) {
    this.conversationDraw(d);
    // Opened with the keys: on the latest message, once there is one.
    if (this.navWanted && Date.now() - this.navWanted < 8000 && (document.activeElement === document.body || document.activeElement === this.input)
        && this.navLatest()) this.navWanted = 0;
  }

  // The keys on the latest message, now or once the conversation's in (a
  // chat opened with the keys: Enter on its card). False when they can't be.
  navStart() {
    if (this.dock.querySelector(".card")) return false;      // what it asks you: that, first
    if (this.navLatest()) return true;
    this.navWanted = Date.now();
    return true;
  }

  conversationDraw(d) {
    // The stream again (it reconnected: the phone woke, the server restarted)
    // with the conversation as it was and maybe more: only the more, so the
    // view doesn't jump, nor the answers you started go.
    if (d.reset && !d.redraw && d.start === this.start && this.items.length && d.items.length >= this.items.length &&
        this.items.every((it, i) => it.key && d.items[i].key === it.key)) {
      d = { items: d.items.slice(this.items.length) };
    }
    if (d.reset) {
      this.items = [];
      this.itemKeys = new Set();
      this.start = d.start;
      // What you sent, looked for again in all of it: by its words only (the
      // conversation came again, its places aren't the ones before).
      this.claimed = new WeakSet();
      for (const out of this.outbox) { out.mark = 0; out.redrawn = true; }
    }
    this.keepItems(d.items);
    // The page after an update: its scroll, as it was (app.js keptChatScroll).
    const back = d.reset ? keptChatScroll(this.id) : null;
    const stick = back === null && (d.reset || this.atBottom());
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
    // The classic terminal's model and mode are read off its conversation:
    // again once Claude said something (the chat engine's are live).
    if (this.engine !== "chat" && d.items.some((i) => i.kind === "claude" || i.kind === "command") && !d.reset) {
      clearTimeout(this.infoTimer);
      this.infoTimer = setTimeout(() => this.loadInfo(), 1500);
    }
    if (this.screen && this.screen.dialog) this.renderDock();     // the card may be about what came in
    if (stick && (d.reset || d.items.some((i) => i.kind === "claude"))) this.toReply();
    else if (stick) this.toBottom();
    else if (d.items.some((i) => i.kind !== "result")) this.latest.hidden = false;
    if (back !== null) {
      // Now, and after the frame: a bottom asked for while the conversation was
      // still empty (renderTail's toBottom) lands on the frame, over this.
      const to = () => { this.scroller.scrollTop = back; this.stuck = this.measureBottom(); this.latest.hidden = this.stuck; };
      to();
      requestAnimationFrame(to);
    }
  }

  async earlier() {
    this.earlierBtn.disabled = true;
    try {
      const res = await fetch(`/api/session/${encodeURIComponent(this.id)}/earlier?before=${this.start}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "couldn't load it");
      // Nothing before it after all: the button goes, nothing drawn again.
      if (!(d.items || []).length) { this.start = d.start || 0; if (this.start <= 0) this.earlierBtn.remove(); return; }
      this.keepItems(d.items, true);
      // Its own folds: what came before doesn't join the ones after it.
      const kept = { fold: this.fold, todo: this.todo, lastStep: this.lastStep, tasks: this.tasks, taskCard: this.taskCard, work: this.work, loose: this.loose };
      this.fold = null;
      this.work = null;
      this.loose = null;
      this.todo = null;
      this.tasks = new Map();
      this.taskCard = null;
      const frag = document.createDocumentFragment();
      for (const item of d.items) this.add(item, frag, true);
      if (kept.todo) frag.querySelectorAll(".todo").forEach((t) => t.classList.remove("open"));
      Object.assign(this, kept);
      // What you're reading stays put: moved down by what came above it, once
      // (the browser's own scroll anchoring off meanwhile, so it isn't twice).
      const sc = this.scroller, top = sc.scrollTop, before = sc.scrollHeight;
      sc.style.overflowAnchor = "none";
      this.earlierBtn.after(frag);
      sc.scrollTop = top + (sc.scrollHeight - before);
      sc.style.overflowAnchor = "";
      this.start = d.start;
      if (this.start <= 0) this.earlierBtn.remove();
    } catch (e) {
      toast(e.message);
    }
    this.earlierBtn.disabled = false;
  }

  // The items the conversation has, in order.
  keepItems(items, front) {
    const fresh = items.filter((it) => !it.key || !this.itemKeys.has(it.key));
    for (const it of fresh) if (it.key) this.itemKeys.add(it.key);
    if (front) {
      this.items.unshift(...fresh);
      for (const out of this.outbox) out.mark += fresh.length;
    } else this.items.push(...fresh);
    // What the chat is for: the goal in the newest reply that says one (shown
    // under its name, opts.onGoal; not on each reply).
    // Its state with it (the goal block's): a done chat offers to close (renderDone).
    let goal = null, state = "";
    for (let i = this.items.length - 1; i >= 0 && goal === null; i--) {
      const it = this.items[i];
      if (it.kind === "claude" && !it.aside && /```[ \t]*goal\b/.test(it.text || "")) {
        const g = replyGoal(it.text);
        if (g && g.goal) { goal = g.goal; state = g.state; }
      }
    }
    if (!front) this.settleOutbox();
    if (state !== this.goalState) {
      this.goalState = state;
      this.renderDone();
    }
    if (goal !== this.goal) {
      this.goal = goal;
      if (this.opts.onGoal) this.opts.onGoal(goal);
      this.renderDone();
    }
  }

  isOpen(k, otherwise) { return this.opened.has(k) ? this.opened.get(k) : otherwise; }

  // What Claude said, as it wrote it (replyParts): its markdown, and in
  // their place the blocks it made for you to use, each with its buttons;
  // its questions (choices) as buttons to tap, together where the first one
  // is. A long reply is three parts, each under its small head (the reply
  // format has Claude write them in this order): Briefing, its opening and
  // its brief block's rows in one card, what you need to do among them;
  // Action items, what to tap (its questions, what to use: a link, a
  // draft), when there's something; Content, its sections (replyOutline) folded under their
  // headings, which say their points: a tap opens one, Open all every one.
  // key: the message's, for what you open, fold and answer in it. Questions
  // that aren't the newest thing any more are past (markPast). live: still
  // being written, so as it comes, nothing folded or put together.
  claudeView(text, key, past, live) {
    const el = h("div", { class: "msg claude" });
    const parts = replyParts(text);
    const asked = parts.filter((p) => p.kind === "choices" && p.options.length);
    let n = 0;
    const draw = (p) => {
      if (p.md !== undefined) return tableize(h("div", { class: "md", html: md(p.md) }));
      if (p.kind === "brief") return this.briefView(p);
      if (p.kind === "actions") return this.actionsView(p);
      if (p.kind !== "choices") return this.blockView(p, `${key}|b${n++}`);
      if (p !== asked[0]) return null;
      const box = this.choicesView({ waiting: asked.map((q) => ({ question: q.attrs.question || "", options: q.options.slice(0, 4) })) }, `${key}|q`);
      if (box && past) this.markPast(box);
      return box;
    };
    if (live) {
      el.append(...parts.map(draw).filter(Boolean));
      return el;
    }
    const nodes = replyOutline(parts);
    const isSec = (x) => x.title !== undefined;
    const at = nodes.findIndex((x) => x.kind === "brief"), sec = nodes.findIndex(isSec);
    let rest = nodes;
    if (at >= 0 && (sec < 0 || at < sec)) {
      // Briefing: what it wrote before its brief block, the block's rows, and
      // what's yours to do (an older reply's actions block).
      const lead = nodes.slice(0, at);
      el.append(...lead.filter((x) => x.md === undefined).map(draw).filter(Boolean));
      const words = lead.filter((x) => x.md !== undefined).map((x) => x.md).join("\n\n");
      const end = sec < 0 ? nodes.length : sec;
      const after = nodes.slice(at + 1, end);
      el.append(uiSection("brief", "Briefing", {}, this.briefView(nodes[at], words ? h("div", { class: "md", html: md(words) }) : null,
        after.filter((x) => x.kind === "actions"))));
      // Action items: what to tap, up to the first section: its questions, what to use.
      const mine = after.filter((x) => x.kind !== "actions");
      const drawn = mine.map(draw).filter(Boolean);
      if (mine.some((x) => x.kind)) el.append(uiSection("actions", "Action items", {}, ...drawn));
      else el.append(...drawn);
      rest = nodes.slice(end);
    }
    // Content: the sections, folded; what's written around them, where it is.
    const folds = [];
    const all = uiButton("Open all", () => {
      const on = folds.some((f) => !f.classList.contains("open"));
      for (const f of folds) { f.set(on); this.opened.set(f.dataset.k, on); }
      sync();
    }, false, "quiet");
    const sync = () => { all.textContent = folds.some((f) => !f.classList.contains("open")) ? "Open all" : "Fold all"; };
    let group = null;
    for (const node of rest) {
      if (!isSec(node)) {
        const v = draw(node);
        if (v) { el.append(v); group = null; }
        continue;
      }
      const k = `${key}|s${folds.length}`;
      const fold = uiFold(h("span", { html: inline(node.title) }),
        { open: this.isOpen(k, false), toggle: (on) => { this.opened.set(k, on); sync(); } }, ...node.parts.map(draw));
      fold.dataset.k = k;
      if (!group) {
        group = uiFolds();
        el.append(folds.length ? group : uiSection("content", "Content", { extra: all }, group));
      }
      group.append(fold);
      folds.push(fold);
    }
    all.hidden = folds.length < 2;
    sync();
    return el;
  }

  // Its briefing (the brief block): what the reply comes to (lead: its
  // opening, when the block follows it) and its rows; what you need to do
  // (its You row; an older reply's actions blocks, a line each) lit, unless
  // it's nothing.
  briefView(p, lead = null, actions = []) {
    const rows = (p.fields || []).map((f) => {
      const you = f.label.toLowerCase() === "you";
      const none = you && /^(nothing|none|nada|no)\b/i.test(f.value.trim());
      return { label: f.label, value: h("span", { html: inline(f.value) }), tone: you ? (none ? "none" : "you") : "" };
    });
    const items = actions.flatMap((a) => a.items || []);
    if (items.length) rows.push({ label: "You", value: this.actionsView({ items }), tone: "you" });
    return uiBrief(rows, { lead });
  }

  // What's yours to do, a line each (an older reply's actions block).
  actionsView(p) {
    return uiActions((p.items || []).map((x) => ({ text: h("span", { html: inline(x.text) }), due: x.due, done: x.done })));
  }

  // The questions asked before what comes now (you or Claude said something
  // since), in the conversation and in what's going into it (where).
  pastQuestions(where) {
    for (const root of new Set([this.conv, where]))
      if (root && root.querySelectorAll) root.querySelectorAll(".choices:not(.past)").forEach((b) => this.markPast(b));
  }

  // A message's questions that aren't the newest thing any more: shown as
  // they were, no longer to tap.
  markPast(box) {
    box.classList.add("past");
    box.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  }

  // A block Claude made for you to use (replyBlock), where it wrote it: a row
  // with its kind, its name, what it is and its quick actions (Copy, Open);
  // under it all of it and every action that fits. Open, unless you fold it
  // (a link starts folded: its row is all of it).
  blockView(a, key) {
    const v = this.artifactParts(a);
    const on = this.isOpen(key, !v.folded);
    const toggle = () => {
      this.opened.set(key, !on);
      const next = this.blockView(a, key);
      const had = box.contains(document.activeElement);
      box.replaceWith(next);
      if (had) next.querySelector(".art-toggle").focus({ preventScroll: true });
    };
    const li = h("li", { class: `art art-${v.look || a.kind}${on ? " open" : ""}` },
      h("div", { class: "art-head" },
        h("button", { class: "art-toggle", type: "button", "aria-expanded": String(on), onclick: toggle },
          h("span", { class: "art-ic" }, icon(v.icon)),
          h("span", { class: "art-text" }, h("span", { class: "art-title" }, v.title), v.sub ? h("span", { class: "art-sub" }, v.sub) : null),
          icon("chevron", "chev")),
        ...[v.quick].flat().filter(Boolean)));
    if (on) li.append(h("div", { class: "art-body" }, ...v.body.filter(Boolean),
      v.actions.filter(Boolean).length ? h("div", { class: "art-actions" }, ...v.actions.filter(Boolean)) : null,
      a.attrs.note ? h("div", { class: "art-note", html: inline(String(a.attrs.note)) }) : null));
    const box = h("ul", { class: "artifacts block" }, li);
    return box;
  }

  // A block's parts (a reply's block: replyParts): its icon, title, the line
  // under it, its quick action, what it shows open and the actions there;
  // look: its class, when it's not its kind's (a message's channels share one).
  artifactParts(a) {
    const str = (x) => (typeof x === "string" ? x.trim() : "");
    const at = a.attrs || {}, body = str(a.body), title = str(at.title);
    const copy = (text, label = "Copy") => {
      const b = h("button", { class: "art-btn", type: "button", onclick: (e) => {
        e.stopPropagation();
        copyText(text).then(() => { b.textContent = "Copied"; setTimeout(() => { b.textContent = label; }, 1500); });
      } }, label);
      return b;
    };
    const open = (href, label, primary) => {
      const safe = artifactHref(href);
      return safe ? h("a", { class: `art-btn${primary ? " primary" : ""}`, href: safe, ...(safe.startsWith("#") ? {} : { target: "_blank", rel: "noopener" }),
        onclick: (e) => e.stopPropagation() }, label) : null;
    };
    const digits = (p) => str(p).replace(/[^\d]/g, "");
    const pre = (text) => h("div", { class: "art-pre" }, text);
    const field = (k, ...v) => h("div", { class: "art-field" }, h("span", { class: "k" }, k), h("span", {}, ...v));
    switch (a.kind) {
      case "whatsapp": case "email": case "slack": case "sms": {
        const ch = a.kind, to = str(at.to);
        const wa = ch === "whatsapp" ? `https://wa.me/${digits(at.phone)}?text=${encodeURIComponent(body)}` : null;
        const mailTo = str(at.email) || (/@/.test(to) ? to : "");
        const mail = ch === "email" ? `mailto:${encodeURIComponent(mailTo)}?subject=${encodeURIComponent(str(at.subject))}&body=${encodeURIComponent(body)}` : null;
        const sms = ch === "sms" && digits(at.phone) ? `sms:+${digits(at.phone)}?&body=${encodeURIComponent(body)}` : null;
        return { look: "message", icon: "message", title: title || `${CHANNEL_WORDS[ch]} draft`, sub: [CHANNEL_WORDS[ch], to ? `to ${to}` : ""].filter(Boolean).join(" · "),
          quick: body ? copy(body) : null,
          body: [at.subject ? field("Subject", str(at.subject)) : null, pre(body)],
          actions: [wa && open(wa, "Open in WhatsApp", true), mail && open(mail, "Open in mail", true), sms && open(sms, "Open in Messages", true),
            body ? copy(body, "Copy the message") : null] };
      }
      case "link": {
        const href = artifactHref(a.url);
        let host = "";
        try { host = new URL(a.url).host; } catch { /* not a URL */ }
        // A link is its row: Copy and Open at hand, its address a tap away.
        return { folded: true, icon: "web", title: str(at.label) || title || host || "Link", sub: host,
          quick: href ? [copy(href), open(href, "Open", true)] : null, body: [pre(str(a.url))], actions: [] };
      }
      case "command":
        return { icon: "run", title: title || "Command to run", sub: str(at.cwd) ? `in ${str(at.cwd)}` : cut(body, 60),
          quick: copy(body), body: [h("div", { class: "art-code" }, body)], actions: [] };
      case "event": {
        const start = artifactDate(at.when), end = artifactDate(at.end) || (start ? new Date(start.getTime() + 3600000) : null);
        const when = start ? start.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : str(at.when);
        const gstamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
        const gcal = start ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title || "Event")}` +
          `&dates=${gstamp(start)}/${gstamp(end)}&location=${encodeURIComponent(str(at.where))}&details=${encodeURIComponent(body)}` : null;
        const map = str(at.where) ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(str(at.where))}` : null;
        return { icon: "clock", title: title || "Event", sub: [when, str(at.where)].filter(Boolean).join(" · "), quick: null,
          body: [when ? field("When", when, end && at.end ? ` → ${end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "") : null,
            str(at.where) ? field("Where", str(at.where)) : null, body ? h("div", { class: "art-note", html: inline(body) }) : null],
          actions: [gcal && open(gcal, "Add to Google Calendar", true), map && open(map, "Map")] };
      }
      case "todos": {
        const items = (a.items || []).filter((x) => str(x.text));
        const left = items.filter((x) => !x.done).length;
        return { icon: "list", title: title || "To-dos", sub: `${left} to do${items.length > left ? ` · ${items.length - left} done` : ""}`, quick: null,
          body: [h("ul", { class: "art-todos" }, ...items.map((x) => h("li", { class: x.done ? "done" : "" },
            h("span", { class: "box", html: x.done ? TICK : "" }), h("span", { class: "t", html: inline(str(x.text)) }),
            str(x.due) ? h("span", { class: "meta" }, str(x.due)) : null)))],
          actions: [] };
      }
      case "fields": {
        const fields = a.fields || [];
        return { icon: "fields", title: title || "Details", sub: `${fields.length} detail${fields.length === 1 ? "" : "s"}`,
          quick: fields.length ? copy(fields.map((f) => `${f.label}: ${f.value}`).join("\n")) : null,
          body: [h("dl", { class: "art-dl" }, ...fields.flatMap((f) => [h("dt", {}, f.label), h("dd", { html: inline(f.value) })]))],
          actions: [] };
      }
      case "chart": {
        const pts = a.points || [];
        const tsv = [["", ...a.series], ...pts.map((p) => [p.label, ...p.values])].map((r) => r.join("\t")).join("\n");
        return { icon: "chart", title: title || "Chart", sub: [/^[$€£¥%]$/.test(str(at.unit)) ? "" : str(at.unit), `${pts.length} ${(at.type || "bar") === "line" ? "points" : "values"}`,
            a.series.length > 1 ? `${a.series.length} series` : ""].filter(Boolean).join(" · "),
          quick: pts.length ? copy(tsv) : null, body: [chartView(a)], actions: [] };
      }
      case "contact": {
        const ph = digits(at.phone);
        return { icon: "helper", title: str(at.name) || title || "Contact", sub: str(at.role), quick: null,
          body: [ph ? field("Phone", `+${ph}`) : null, str(at.email) ? field("Email", str(at.email)) : null, body ? h("div", { class: "art-note", html: inline(body) }) : null],
          actions: [ph && open(`tel:+${ph}`, "Call", true), ph && open(`https://wa.me/${ph}`, "WhatsApp"), str(at.email) && open(`mailto:${str(at.email)}`, "Email"),
            ph ? copy(`+${ph}`, "Copy the number") : null] };
      }
      case "place": {
        const where = str(at.where);
        const map = where || str(at.name) ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([str(at.name), where].filter(Boolean).join(", "))}` : null;
        const ph = digits(at.phone);
        return { icon: "web", title: str(at.name) || title || "Place", sub: [str(at.hours), where].filter(Boolean).join(" · "), quick: map ? open(map, "Map") : null,
          body: [where ? field("Address", where) : null, str(at.hours) ? field("Hours", str(at.hours)) : null, ph ? field("Phone", `+${ph}`) : null,
            body ? h("div", { class: "art-note", html: inline(body) }) : null],
          actions: [map && open(map, "Map", true), ph && open(`tel:+${ph}`, "Call"), str(at.url) && open(str(at.url), "Website")] };
      }
      case "session": {
        const id = str(at.id);
        return { icon: "message", title: title || id || "A chat", sub: id && title ? id : "Another chat", quick: id ? open(`#/s/${id}`, "Open") : null,
          body: [body ? h("div", { class: "msg claude", html: md(body) }) : null], actions: [] };
      }
      case "file":
        return { icon: "file", title: title || baseName(str(at.path)) || "File", sub: str(at.path), quick: copy(str(at.path), "Copy path"),
          body: [body ? pre(body) : null], actions: [] };
      default:
        return { fallback: true, icon: "file", title: title || a.kind, sub: cut(firstLine(body), 70), quick: body ? copy(body) : null,
          body: [h("div", { class: "msg claude", html: md(body) })], actions: [] };
    }
  }

  // What waits on you: each question and its options. One question: a tap
  // sends. Several: a tap marks it answered, and they go together once all
  // are (or with Send). A draft option puts its start in the box.
  choicesView(b, key) {
    const qs = (Array.isArray(b.waiting) ? b.waiting : [])
      .filter((q) => q && typeof q.question === "string" && Array.isArray(q.options) && q.options.length).slice(0, 3);
    if (!qs.length) return null;
    let st = this.answers.get(key);
    if (!st) this.answers.set(key, st = { picks: {}, sent: false });
    const box = h("div", { class: "choices" });
    const rows = qs.map((q, i) => {
      const opts = q.options.filter((o) => o && typeof o.label === "string").slice(0, 4);
      return h("div", { class: "bq" }, h("div", { class: "bq-q", html: inline(q.question) }),
        h("div", { class: "bq-opts" }, ...opts.map((o, k) =>
          h("button", { class: `bq-opt${k === 0 ? " primary" : ""}${o.draft ? " draft" : ""}`, type: "button", "data-k": k,
                        onclick: () => pick(i, k) }, o.label))));
    });
    const status = h("span", { class: "bq-status", role: "status" });
    const sendBtn = h("button", { class: "text-btn bq-send", type: "button", onclick: () => send() });
    const paint = () => {
      rows.forEach((row, i) => {
        const k = st.picks[i];
        row.classList.toggle("answered", k !== undefined);
        row.querySelectorAll(".bq-opt:not(.draft)").forEach((btn) => {
          btn.classList.toggle("chosen", +btn.dataset.k === k);
          btn.disabled = st.sent && +btn.dataset.k !== k;
        });
      });
      box.classList.toggle("sent", st.sent);
      const done = qs.filter((_, i) => st.picks[i] !== undefined).length;
      status.textContent = st.sent ? "Sent" : qs.length > 1 && done ? `${done} of ${qs.length} answered` : "";
      sendBtn.hidden = st.sent || !done || done === qs.length;
      sendBtn.textContent = `Send ${done === 1 ? "this answer" : `these ${done}`}`;
    };
    const send = async () => {
      const text = qs.map((q, i) => (st.picks[i] === undefined ? null : q.options[st.picks[i]]))
        .filter(Boolean).map((o) => String(o.send || o.label)).join("\n\n");
      if (!text.trim() || st.sent) return;
      st.sent = true;
      paint();
      try {
        await this.post("send", { text });
      } catch (e) {
        st.sent = false;
        paint();
        toast(e.message);
      }
    };
    const pick = (i, k) => {
      const o = qs[i].options[k];
      if (o.draft) return this.fillDraft(String(o.send || o.label || ""));
      if (st.sent) return;
      st.picks[i] = k;
      paint();
      if (qs.every((_, j) => st.picks[j] !== undefined)) send();
    };
    box.append(...rows, h("div", { class: "bq-foot" }, status, sendBtn));
    paint();
    return box;
  }

  // An option for a message you finish yourself: its start goes into the box.
  fillDraft(text) {
    this.input.value = text;
    this.typed();
    this.grow();
    this.input.focus();
    this.input.setSelectionRange(text.length, text.length);
  }

  // One item of the conversation, into where (a fragment going at the end,
  // or before what's shown when earlier).
  add(it, where, earlier) {
    if (it.key && this.keys.has(it.key)) return;
    if (it.key) this.keys.add(it.key);
    if (it.kind === "claude" && it.aside) return;      // said again after an old reply (update_brief: bin/amarchy app_items)
    this.where = where;
    if (it.kind === "result") return this.result(it);
    if (it.kind === "tool") return this.tool(it, where, earlier);
    this.fold = null;       // anything else ends the steps before it
    if (it.kind === "user") {
      this.endWork();         // what came before you (or what was put in your name) stays as it is
      if (it.turn && !earlier) this.pastQuestions(where);
      // A message's pictures and its words are items of their own (keyed
      // "<its record>:<n>"): one bubble.
      const rec = it.rec || String(it.key || "").split(":")[0];
      const prev = rec && (where.lastElementChild || (!earlier && this.tail.previousElementSibling));
      const same = prev && prev.matches(".msg.user") && prev.dataset.rec === rec ? prev.querySelector(".bubble") : null;
      if (typeof it.image === "number") {
        const url = `/api/session/${encodeURIComponent(this.id)}/image/${encodeURIComponent(rec)}/${it.image}`;
        const shot = h("button", { class: "shot", type: "button", "aria-label": "Show the picture",
                                   onclick: () => sheet(sheetHead("Your picture"), h("img", { class: "shot-full", src: url, alt: "A picture you sent" })) },
                       h("img", { src: url, alt: "A picture you sent", loading: "lazy" }));
        const bubble = same || h("div", { class: "bubble" });
        let shots = bubble.querySelector(".shots");
        if (!shots) bubble.prepend(shots = h("div", { class: "shots" }));
        shots.append(shot);
        bubble.querySelectorAll(".chip.image").forEach((c) => c.remove());      // [Image #1]: the picture's here
        if (!same) where.append(h("div", { class: "msg user", "data-rec": rec }, bubble));
        return;
      }
      const said = this.userView(it.text);
      if (said.note) where.append(h("div", { class: "msg note" }, said.note));
      else if (said.summary) where.append(h("details", { class: "msg note long" }, h("summary", {}, said.summary), h("pre", {}, said.text)));
      else if (same) {
        const parts = same.querySelector(".shots") ? said.parts.filter((p) => !(p instanceof Node && p.matches(".chip.image"))) : said.parts;
        same.append(h("div", { class: "said" }, ...parts));
      } else where.append(h("div", { class: "msg user", "data-rec": rec || null }, h("div", { class: "bubble" }, ...said.parts)));
    } else if (it.kind === "command") {
      where.append(h("div", { class: "msg command" }, h("span", { class: "chip" }, it.text)));
    } else if (it.kind === "note") {
      const text = it.text === "Interrupted" ? "You stopped Claude" : it.text;
      const long = text.split("\n").length > 3 || text.length > 240;
      where.append(long ? h("details", { class: "msg note long" }, h("summary", {}, cut(text.split("\n")[0], 70)), h("pre", {}, text))
                        : h("div", { class: "msg note" }, text));
    } else if (it.kind === "claude") {
      // (Only a goal block, added to the reply before it when it had none: nothing to show.)
      const view = this.claudeView(it.text, it.key || `said:${this.items.indexOf(it)}`, earlier);
      if (view.childElementCount) {
        if (!earlier) this.pastQuestions(where);
        where.append(view);
        this.loose = view;
      }
      if (!earlier) {
        // What Claude was writing is in the conversation now.
        this.said = String(it.text || "").replace(/\s+$/, "");
        if (this.stream && (this.stream.done || this.said.startsWith(this.stream.text.slice(0, 40)))) this.endStream();
      }
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
    const re = /\[(?:image|Image #\d+)\]|<pasted_content[^>]*>([\s\S]*?)<\/pasted_content>|^\[File: ([^\]\n]+)\]$/gm;
    let at = 0, m;
    while ((m = re.exec(t))) {
      if (m.index > at) parts.push(t.slice(at, m.index));
      // A file you gave Claude (the composer names it so): its name, where it is.
      parts.push(m[2] ? h("span", { class: "chip file", title: m[2] }, icon("file"), baseName(m[2]))
                 : m[0].startsWith("<") ? h("span", { class: "pasted" }, m[1].trim())
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
      this.intoWork(where, step.el);
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
      this.endWork();
      step.el = this.askedCard(step);
      where.append(step.el);
      return;
    }
    if (it.name === "ExitPlanMode") {
      this.fold = null;
      this.endWork();
      step.el = this.planCard(step);
      where.append(step.el);
      return;
    }
    if (!this.fold) {
      this.fold = this.newFold();
      this.intoWork(where, this.fold.el);
    }
    this.fold.steps.push(step);
    step.fold = this.fold;
    step.work = this.work;
    this.work.steps.push(step);
    step.el = this.stepRow(step);
    this.fold.list.append(step.el);
    this.drawFold(this.fold);
    this.drawWork(this.work);
  }

  // A turn's work: Claude's steps and what it said between them, on the way
  // to its reply. While Claude works it's all there, as it comes (live);
  // after, it folds to one line (how long, how many steps) over the reply,
  // a tap away, so a chat you open shows the reply, not how it got there.
  // What Claude said is its reply until a step follows it: then it was a
  // word on the way, and goes in with the steps. One run of steps and
  // nothing said between: no line of its own (plain).
  intoWork(where, el) {
    if (!this.work) {
      const body = h("div", { class: "work-body" });
      const head = h("button", { class: "fold-head work-head", type: "button", "aria-expanded": "false" });
      const box = h("div", { class: "work" }, head, body);
      head.addEventListener("click", () => head.setAttribute("aria-expanded", String(box.classList.toggle("open"))));
      for (const live of this.conv.querySelectorAll(".work.live")) live.classList.remove("live");
      this.work = { el: box, head, body, steps: [] };
      if (this.loose && this.loose.parentNode) this.loose.before(box);
      else where.append(box);
    }
    if (this.loose && this.loose.parentNode) this.work.body.append(this.loose);
    this.loose = null;
    this.work.body.append(el);
    this.drawWork(this.work);
  }

  endWork() {
    if (this.work) this.work.el.classList.remove("live");
    this.work = null;
    this.loose = null;
  }

  // Its line: how long it took, how many steps.
  drawWork(work) {
    if (!work) return;
    const steps = work.steps;
    const times = steps.flatMap((s) => [s.at, s.result && s.result.at]).filter(Boolean).map((x) => Date.parse(x)).filter((x) => !isNaN(x));
    const took = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;
    const failed = steps.filter((s) => s.result && s.result.error && !DENIED.test(String(s.result.text || ""))).length;
    work.el.classList.toggle("plain", work.body.children.length < 2);
    work.head.replaceChildren(...[
      steps.some((s) => !s.result) ? spinner() : icon("check", "ok"),
      h("span", { class: "what" }, `Worked${took >= 5000 ? ` ${duration(took)}` : ""} · ${steps.length} step${steps.length === 1 ? "" : "s"}`),
      failed ? h("span", { class: "chip bad" }, `${failed} didn't work`) : null,
      icon("chevron", "chev")].filter(Boolean));
  }

  // The work under way is all there while Claude works; folded once it isn't.
  syncWork() {
    if (this.work) this.work.el.classList.toggle("live", this.working());
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
      this.drawWork(step.work);
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
      this.intoWork(this.where, card);
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
    // What you said no to isn't something that didn't work.
    const refused = steps.filter((s) => s.result && s.result.error && DENIED.test(String(s.result.text || ""))).length;
    const failed = steps.filter((s) => s.result && s.result.error).length - refused;
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
      refused ? h("span", { class: "chip" }, `you said no to ${refused}`) : null,
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
    const notes = (step.result && step.result.notes) || {};
    const failed = step.result && step.result.error;
    // Waiting for your answer, it's the card in the dock: here once answered.
    return h("div", { class: "asked", hidden: !step.result },
      h("div", { class: "asked-head" }, icon("question"), h("span", {}, "Claude asked")),
      ...qs.map((q) => h("div", { class: "asked-q" }, h("div", { class: "q" }, q.question || ""),
        answers[q.question] ? h("div", { class: "a" }, h("span", { class: "you" }, "You:"), ` ${answers[q.question]}`,
                                notes[q.question] ? h("div", { class: "note" }, notes[q.question]) : null)
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
    const live = this.engine === "chat" ? this.live : null;
    const stick = this.atBottom();
    // The turn's work: all there while Claude works, one line once it's done
    // (and then, at the bottom, you're on the reply's top).
    const working = this.working(), ended = this.wasWorking && !working;
    this.wasWorking = working;
    this.syncWork();
    this.streamTo(live && this.working() ? live.partial || "" : "");
    // What it's doing, in words, unless that's the step spinning just above,
    // or the words it's writing say so already.
    const now = this.activity(live);
    if (now) {
      if (!this.workingEl) {
        this.workingEl = h("div", { class: "working", role: "status" }, spinner(), h("span", { class: "now" }), h("span", { class: "took" }));
        this.workingTimer = setInterval(() => this.drawWorking(), 1000);
      }
      this.workingNow = now;
      this.drawWorking();
    } else if (this.workingEl) {
      clearInterval(this.workingTimer);
      this.workingEl = null;
    }
    const kids = [this.streamEl, this.workingEl].filter(Boolean);
    if (kids.length !== this.tail.children.length || kids.some((k, i) => this.tail.children[i] !== k)) this.tail.replaceChildren(...kids);
    if (stick && ended) this.toReply();
    else if (stick) this.toBottom();
  }

  // The line under the conversation: what Claude is doing now, or null.
  activity(live) {
    if (!this.working()) return null;
    if (live) {
      if (live.state === "starting") return { text: "Starting Claude…" };
      if (Array.isArray(live.pending) && live.pending.length) return null;     // the card asks
      if (this.stream && !this.stream.done) return null;                        // its words are coming in
      const since = live.working_since ? live.working_since * 1000 : null;
      const a = live.activity;
      if (a && a.tool && !HIDDEN_TOOLS.has(a.tool)) {
        let text = stepWords(a.tool, a.input || {}).now;
        // A helper's own step: "A helper is on it: … · reading app.js".
        if (a.step && a.step.tool && !HIDDEN_TOOLS.has(a.step.tool)) {
          const w = stepWords(a.step.tool, a.step.input || {}).now;
          text += ` · ${w.charAt(0).toLowerCase()}${w.slice(1)}`;
        }
        return { text: `${text}…`, since };
      }
      return { text: live.thinking ? "Thinking…" : "Working…", since };
    }
    const shown = this.lastStep && !this.lastStep.result && this.lastStep.el && this.tail.previousElementSibling &&
                  this.tail.previousElementSibling.contains(this.lastStep.el) && !this.lastStep.el.closest(".fold:not(.open):not(.single)");
    if (shown) return null;
    if (this.lastStep && !this.lastStep.result && !HIDDEN_TOOLS.has(this.lastStep.name)) return { text: `${this.lastStep.words.now}…` };
    return { text: "Working…" };
  }

  drawWorking() {
    if (!this.workingEl) return;
    const { text, since } = this.workingNow;
    this.workingEl.querySelector(".now").textContent = text;
    const took = since ? Date.now() - since : 0;
    this.workingEl.querySelector(".took").textContent = took >= 10000 ? duration(took) : "";
  }

  // Claude's words as it writes them (the chat engine's partial text),
  // shown at an even pace however they arrive, and kept once written until
  // the conversation has them (it comes from the transcript, a moment later).
  streamTo(partial) {
    const text = partial.replace(/\s+$/, "");
    const s = this.stream;
    if (text) {
      // Already in the conversation (the transcript can be quicker than the live state).
      if (this.said && (text === this.said || (text.length > 20 && this.said.startsWith(text)))) return this.endStream();
      if (!s || !text.startsWith(s.text.slice(0, Math.min(s.text.length, 24)))) {
        this.endStream();
        this.stream = { text, shown: 0, done: false };
        this.streamEl = h("div", { class: "msg claude streaming", "aria-live": "off" });
      } else {
        s.text = text;
        s.shown = Math.min(s.shown, text.length);
        s.done = false;
      }
      clearTimeout(this.streamTimer);
      this.streamTimer = null;
      this.streamStep();
    } else if (s && !s.done) {
      // Written: whole, without its caret, until the conversation has it (or a while).
      s.done = true;
      s.shown = s.text.length;
      this.drawStream();
      this.streamTimer = setTimeout(() => { this.endStream(); this.renderTail(); }, 6000);
    }
  }

  streamStep() {
    if (this.streamFrame) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let last = performance.now();
    const frame = (t) => {
      this.streamFrame = null;
      const s = this.stream;
      if (!s) return;
      const behind = s.text.length - s.shown;
      if (behind > 0) {
        // Catches up in about a quarter of a second, never slower than a fast reader.
        const dt = Math.min(100, t - last);
        s.shown = reduce ? s.text.length : Math.min(s.text.length, s.shown + Math.max(1, Math.ceil(dt * Math.max(0.08, behind / 250))));
        last = t;
        this.drawStream();      // (at the bottom, it stays there as it grows: build's ResizeObserver)
      }
      if (s.shown < s.text.length) this.streamFrame = requestAnimationFrame(frame);
    };
    this.streamFrame = requestAnimationFrame(frame);
  }

  drawStream() {
    const s = this.stream;
    if (!s || !this.streamEl) return;
    let shown = s.text.slice(0, s.shown);
    // Half a word, or the ** of bold not closed yet, would flash: up to the last space.
    if (!s.done && s.shown < s.text.length) shown = shown.replace(/\S*$/, "");
    // The goal block a reply ends with isn't shown (as in the conversation), nor half of one.
    shown = withoutGoal(shown).replace(/\n?```[ \t]*goal\b[\s\S]*$/, "");
    // The paragraphs written whole are drawn once; only the one being written
    // is drawn again each frame (a long reply drew all of it sixty times a second).
    let cut = -1;
    for (let i = shown.lastIndexOf("\n\n"); i > 0; i = shown.lastIndexOf("\n\n", i - 1)) {
      if ((shown.slice(0, i).match(/```/g) || []).length % 2 === 0) { cut = i; break; }      // not inside a code block
    }
    const head = cut > 0 ? shown.slice(0, cut) : "";
    let tail = cut > 0 ? shown.slice(cut + 2) : shown;
    if (!s.done) {
      // (A code fence's ``` aren't inline code's marks.)
      for (const re of [/\*\*/g, /(?<!`)`(?!`)/g]) {
        const marks = [...tail.matchAll(re)];
        if (marks.length % 2) {
          const at = marks[marks.length - 1].index;
          tail = tail.slice(0, at) + tail.slice(at + marks[marks.length - 1][0].length);
        }
      }
    }
    if (!s.parts || !this.streamEl.contains(s.parts[0])) {
      s.parts = [h("div", { class: "stream-part" }), h("div", { class: "stream-part" })];
      s.head = null;
      this.streamEl.replaceChildren(...s.parts);
    }
    // (What's written whole, as the conversation will show it: its blocks drawn, not to tap yet.)
    if (head !== s.head) { s.head = head; s.parts[0].replaceChildren(...(head ? this.claudeView(head, "stream", true, true).childNodes : [])); }
    s.parts[1].innerHTML = md(tail || " ");
    this.streamEl.classList.toggle("done", s.done);
    // The caret, at the end of the last line written (in a list's last item, not under it).
    if (!s.done) {
      const lines = s.parts[1].querySelectorAll("p, li, h2, h3, h4, td, th, pre code");
      (lines[lines.length - 1] || s.parts[1]).append(h("span", { class: "caret", "aria-hidden": "true" }));
    }
  }

  endStream() {
    clearTimeout(this.streamTimer);
    if (this.streamFrame) cancelAnimationFrame(this.streamFrame);
    this.streamFrame = this.streamTimer = null;
    this.stream = null;
    this.streamEl = null;
  }

  // ---- the dock: Claude's question as a card, or the box you type in

  // The card that's up now, as a model, or a note in its place.
  current() {
    const sc = this.screen, r = this.row;
    if (r && r.setup) return { note: "Setting up…" };
    // A secret Claude asks for (amarchy secret ask): secrets.js's card, first.
    const secret = typeof secretDock === "function" ? secretDock(this) : null;
    if (secret) return secret;
    if (this.engine === "chat") {
      const pending = this.live && Array.isArray(this.live.pending) ? this.live.pending.filter((q) => !this.answeredAsk(q.request_id)) : [];
      const p = pending[0];
      if (p) return { card: requestCard(this, p, 0, pending.length),
                      key: `req:${p.request_id}:${JSON.stringify(p.answered || {})}:${pending.length}:${p.tool === "ExitPlanMode" ? this.live.before_plan : ""}` };
      // (Stopped while asleep is what asleep is: the dock says so already.)
      if (this.live && this.live.state === "exited" && !sleepOf(this.row))
        return { exited: true, key: "exited" };
      return null;
    }
    if (sc && sc.exited) return { exited: true, key: "exited" };
    if (sc && sc.dialog && !this.answeredAsk(sc.dialog.id)) {
      const step = this.lastStep && !this.lastStep.result && !HIDDEN_TOOLS.has(this.lastStep.name) ? this.lastStep : null;
      return { card: screenCard(this, sc.dialog, step), key: `dialog:${sc.dialog.id}:${step ? step.id : ""}` };
    }
    return null;
  }

  renderDock() {
    const content = !this.view.content;
    const now = content ? this.current() : null;
    const sleep = sleepOf(this.row);
    const cut = !!(this.row && this.row.interrupted);
    const key = [now ? now.key || now.note : "composer", sleep, cut, this.view.composer, this.view.above.length, content].join("|");
    this.renderQueue();
    this.renderBackground();
    this.drawPills();
    if (key === this.cardKey) { this.sendButtons(); return; }
    this.cardKey = key;
    this.renderDone();
    const kids = [content ? this.bgEl : null, content ? this.doneEl : null, ...this.view.above].filter(Boolean);
    if (now && now.card) kids.push(this.card(now.card));
    else if (now && now.note) kids.push(h("div", { class: "dock-note" }, now.note));
    else if (now && now.exited && this.engine !== "chat") {
      kids.push(this.cardShell("question", "Claude stopped", "Start it again to go on where you left off.",
        h("div", { class: "card-actions" }, h("button", { class: "cta primary", type: "button",
          onclick: () => this.post("keys", { keys: ["Enter"] }).catch((e) => toast(e.message)) }, "Start Claude again"))));
    } else if (this.view.composer) {
      if (now && now.exited) kids.push(h("div", { class: "dock-note" }, "Claude stopped. Send a message to start it again."));
      // Its last turn was cut off (the machine ran out of memory): it says so,
      // asleep or not (what you send wakes it all the same).
      if (cut && sleep !== "waking") kids.push(h("div", { class: "dock-note interrupted" }, glyph("interrupted", "cut-mark"),
        h("span", {}, "Interrupted before it finished."),
        h("button", { class: "text-btn resume", type: "button", title: `Send it: ${RESUME_TEXT}`,
                      onclick: () => this.post("send", { text: RESUME_TEXT }).catch((e) => toast(e.message)) }, "Resume")));
      // Asleep, what you send wakes it (with that as Claude's first message).
      else if (sleep === "asleep") kids.push(h("div", { class: "dock-note" }, glyph("asleep", "sleep"),
        h("span", {}, "Asleep to save memory. Send something to wake it."),
        h("button", { class: "text-btn", type: "button", onclick: () => wakeSession(this.row) }, "Wake")));
      else if (sleep === "waking") kids.push(h("div", { class: "dock-note" }, glyph("asleep", "sleep waking"), h("span", {}, "Waking Claude…")));
      kids.push(this.queueEl, this.box);
    }
    // The keys, if they were here, stay: on the card (its first choice), and
    // back in the box you type in once it's answered.
    if (!kids.includes(this.box)) this.closeMenu();
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
    // A question's answers in progress, for requests still waiting only.
    if (this.drafts) {
      const waiting = new Set((this.live && this.live.pending || []).map((p) => p.request_id));
      for (const id of this.drafts.keys()) if (!waiting.has(id)) this.drafts.delete(id);
    }
    if (this.askWanted) this.focusCard();
    // A card came up while you're here: no need for its notification.
    if (now && now.card && document.visibilityState === "visible") this.clearNotes();
  }

  // What you sent while Claude works (the chat engine keeps it until it's
  // free): each with Send now, Edit and Remove. And the images Claude's
  // terminal pasted, going with the next.
  renderQueue() {
    const live = this.engine === "chat" ? this.live : null;
    const queue = live && Array.isArray(live.queue) ? live.queue : [];
    // Queued now: the broker has it, so it's no longer only ours.
    for (const q of queue) { const out = this.outbox.find((o) => o.key === outKey(q.text || "")); if (out) this.outDone(out); }
    const kids = queue.map((q) => {
      const pics = q.images ? (q.images === 1 ? "an image" : `${q.images} images`) : "";
      const btn = (label, fn, aria) => h("button", { class: "text-btn", type: "button", "aria-label": aria, onclick: fn }, label);
      return h("div", { class: "queued" },
        icon("clock"), h("div", { class: "text" }, h("div", { class: "what" }, q.text || (pics ? pics.charAt(0).toUpperCase() + pics.slice(1) : "")),
          h("div", { class: "when" }, `Will send when Claude finishes${q.text && pics ? ` · with ${pics}` : ""}`)),
        btn("Send now", () => this.sendNow(q), "Send it now"),
        btn("Edit", () => this.editQueued(q), "Edit it"),
        h("button", { class: "cbtn small", type: "button", "aria-label": "Don't send it", title: "Don't send it",
                      onclick: () => this.removeQueued(q) }, icon("failed")));
    });
    // Sent while it works, not in the broker's queue yet: there already.
    for (const o of this.outbox) if (o.queued) kids.push(h("div", { class: "queued sending" }, icon("clock"),
      h("div", { class: "text" }, h("div", { class: "what" }, o.text || (o.shots.length === 1 ? "An image" : `${o.shots.length} images`)),
        h("div", { class: "when" }, "Will send when Claude finishes"))));
    const n = live && live.attachments;
    if (n) kids.push(h("div", { class: "queued images" }, icon("image"),
      h("div", { class: "text" }, h("div", { class: "what" }, n === 1 ? "An image goes with your next message" : `${n} images go with your next message`))));
    uiSwap(this.queueEl, kids);      // the same, it stays: its buttons under your finger
  }

  // What Claude left running in the background (live.tasks): its helpers
  // (subagents) and commands, as one line over the box that opens to name
  // each and say for how long. Shown whatever Claude itself is doing, as
  // they go on after its turn ends.
  // The chat reached its goal (its newest goal block says done) and Claude
  // isn't at work: a strip over the box you type in that says so, and
  // offers to close it (app.js confirmClose, which says what would be lost).
  // A chat exists to reach its goal and be closed. Not your assistant's: it
  // stays.
  renderDone() {
    if (!this.doneEl) return;
    const r = this.row || {};
    const show = this.goalState === "done" && !["working", "waiting", "running"].includes(r.status) && r.assistant !== "main"
      && typeof confirmClose === "function";
    const key = show ? `${this.goal}|${r.id}` : "";
    if (key === this.doneKey) return;
    this.doneKey = key;
    this.doneEl.hidden = !show;
    if (!show) return this.doneEl.replaceChildren();
    this.doneEl.replaceChildren(glyph("check", "done-mark"),
      h("span", { class: "done-words" }, h("b", {}, "Done"), this.goal ? ` · ${this.goal}` : ""),
      h("button", { class: "text-btn", type: "button", title: "The goal is reached: close the chat",
                    onclick: () => (typeof todayComplete === "function" ? todayComplete(this.row || { id: this.id }) : confirmClose(this.row || { id: this.id })) }, "Complete mission ✓"));
  }

  renderBackground() {
    const live = this.engine === "chat" ? this.live : null;
    const tasks = live && Array.isArray(live.tasks) ? live.tasks : [];
    // The same tasks, open or not as they were: left as drawn, its clock going.
    const sig = JSON.stringify([tasks.map((t) => [t.task_type, t.started, t.description, t.summary, t.command, t.subagent_type]), this.bgOpen === true]);
    if (sig === this.bgSig && this.bgEl.isConnected) return;
    this.bgSig = sig;
    clearInterval(this.bgTimer);
    this.bgEl.hidden = !tasks.length;
    if (!tasks.length) return this.bgEl.replaceChildren();
    const plural = (x, one, many) => `${x} ${x === 1 ? one : many}`;
    const since = (at) => duration(Math.max(0, Date.now() - at * 1000));
    const helpers = tasks.filter((t) => t.task_type !== "local_bash").length, runs = tasks.length - helpers;
    const what = [helpers ? plural(helpers, "helper", "helpers") : "", runs ? plural(runs, "command", "commands") : ""].filter(Boolean).join(" and ");
    const first = Math.min(...tasks.map((t) => t.started || Infinity));
    const open = this.bgOpen === true;
    const took = h("span", { class: "bg-took" });
    const tooks = [];
    const rows = tasks.map((t) => {
      const el = h("span", { class: "bg-took" });
      tooks.push([el, t.started]);
      return h("li", { class: "bg-task" }, h("span", { class: "bg-dot" }), icon(t.task_type === "local_bash" ? "run" : "helper"),
        h("span", { class: "bg-name" }, cut(t.description || t.summary || t.command || t.subagent_type || "A task", 120)), el);
    });
    const tick = () => {
      took.textContent = first !== Infinity ? since(first) : "";
      for (const [el, at] of tooks) el.textContent = at ? since(at) : "";
    };
    this.bgEl.replaceChildren(
      h("button", { class: "bg-head", type: "button", "aria-expanded": String(open),
                    onclick: () => { this.bgOpen = !open; this.renderBackground(); } },
        h("span", { class: "bg-pulse" }, ...tasks.slice(0, 5).map(() => h("i"))),
        h("span", { class: "bg-what" }, `${what} in the background`), took,
        icon("chevron", "bg-chev")),
      ...(open ? [h("ul", { class: "bg-list" }, ...rows)] : []));      // (replaceChildren would write a null as "null")
    tick();
    this.bgTimer = setInterval(tick, 1000);
  }

  // A queued message taken back from Claude's broker: its content (text,
  // and the images in it), or null if it went already.
  async unqueue(q) {
    try {
      const r = await this.post("unqueue", { uuid: q.uuid });
      const c = r.response && r.response.content;
      return Array.isArray(c) ? c : [{ type: "text", text: typeof c === "string" ? c : q.text || "" }];
    } catch (e) {
      toast(/no such message/i.test(e.message) ? "It went to Claude already" : e.message);
      return null;
    }
  }

  async sendNow(q) {
    const content = await this.unqueue(q);
    if (!content) return;
    const text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const images = content.filter((b) => b.type === "image" && b.source).map((b) => ({ type: b.source.media_type, data: b.source.data }));
    try {
      await this.post("send", { text, images, when: "now" });
    } catch (e) {
      toast(e.message);
      this.restore(content);
    }
  }

  async editQueued(q) {
    const content = await this.unqueue(q);
    if (content) this.restore(content);
  }

  async removeQueued(q) {
    if (await this.unqueue(q)) toast("Taken back: it won't be sent");
  }

  // What was taken back, into the box: its text before what's there, its
  // images on the tray.
  restore(content) {
    const text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    for (const b of content) {
      if (b.type !== "image" || !b.source || !b.source.data) continue;
      const bin = atob(b.source.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: b.source.media_type });
      this.tray.push({ kind: "image", type: blob.type, data: b.source.data, url: URL.createObjectURL(blob), name: "image" });
    }
    const now = this.input.value.trim();
    if (text) this.input.value = now ? `${text}\n${now}` : text;
    this.drawTray();
    this.typed();
    this.input.focus();
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

  // Run a card's action: what you picked lit, and the card off the dock a
  // blink later, the next thing (another question, the box you type in) in
  // its place, without waiting on Claude to say it heard. On a failure, why,
  // and the card back. Should Claude still ask it a while on, it's back too,
  // to answer again.
  act(card, fn, btn) {
    card.querySelectorAll("button, textarea").forEach((b) => { b.disabled = true; });
    if (btn) btn.classList.add("chosen");
    const ask = card.dataset.ask;
    const redraw = () => { this.cardKey = null; this.renderDock(); };
    if (ask) {
      this.answeredAsks.set(ask, Date.now());
      setTimeout(() => { if (card.isConnected) redraw(); }, 120);
    }
    Promise.resolve().then(fn).then(() => {
      // A while on: should Claude still ask it, the card's back to answer
      // again; else nothing's drawn again (the box you're writing in stays).
      setTimeout(() => {
        if (!ask) { if (card.isConnected) redraw(); return; }
        this.answeredAsks.delete(ask);
        const still = (this.live && (this.live.pending || []).some((p) => p.request_id === ask)) ||
                      (this.screen && this.screen.dialog && this.screen.dialog.id === ask);
        if (still && !this.closed) redraw();
      }, ASK_HELD);
    }, (e) => {
      toast(e.message);
      if (ask) this.answeredAsks.delete(ask);
      redraw();
    });
  }

  // A card you answered, held off the dock until Claude moves on (act).
  answeredAsk(id) {
    const at = id && this.answeredAsks.get(id);
    return !!at && Date.now() - at < ASK_HELD;
  }

  // A field to say something with (why not, what to change, your own
  // answer). empty: it goes empty too; direct: send isn't an answer yet (the
  // next question), so the card stays as it is.
  writeField(card, placeholder, label, send, { empty = false, direct = false } = {}) {
    const field = h("textarea", { class: "field", rows: 2, placeholder });
    const go = h("button", { class: "cta primary", type: "button", onclick: () => {
      const text = field.value.trim();
      if (!text && !empty) return;
      if (direct) send(text);
      else this.act(card, () => send(text), go);
    } }, label);
    const box = h("div", { class: "write", hidden: true }, field, h("div", { class: "card-actions" }, go));
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go.click(); }
    });
    return { box, field, open: () => { box.hidden = false; field.focus(); } };
  }

  card(m) {
    const card = m.kind === "secret" ? secretCard(this, m)      // secrets.js
               : m.kind === "question" ? this.questionCard(m) : m.kind === "permission" ? this.permissionCard(m)
               : m.kind === "plan" ? this.planAsk(m) : this.choiceCard(m);
    if (m.id && m.kind !== "secret") card.dataset.ask = String(m.id);
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
  // means, several to pick as boxes, and your own words. Several questions
  // go one at a time ("1 of 3"), with Back and a tab for each, then your
  // answers to look over and send together. A question whose options have
  // previews (a mockup, some code) shows the one of the option you're on,
  // and takes a note with your choice. A terminal-engine session's question
  // is one of its screen's: each pick is its keys (questionPicks).
  questionCard(m) {
    if (m.picks) return this.questionPicks(m);
    const qs = m.questions;
    // Where you are, kept while the card is redrawn (a live event, a new
    // stream): answers so far (the pane's too), your picks, notes.
    this.drafts = this.drafts || new Map();
    let d = this.drafts.get(m.id);
    if (!d) {
      d = { answers: { ...m.answered }, notes: {}, picked: {}, on: {}, own: {}, at: 0 };
      d.at = Math.max(0, qs.findIndex((q) => !(q.question in d.answers)));
      if (qs.every((q) => q.question in d.answers)) d.at = qs.length;
      this.drafts.set(m.id, d);
    }
    const card = this.cardShell("question", "Claude asks", null);
    const keyed = () => lastInput.keys && card.contains(document.activeElement);
    const go = (at) => {
      const keys = keyed() || document.activeElement === card;
      d.at = at;
      draw();
      if (keys) (card.querySelector(".opt.on") || card.querySelector(".opt, .cta.primary") || card).focus({ preventScroll: true });
    };
    // Answered: the next question you haven't, else your answers (several), else sent.
    const next = () => {
      const left = qs.findIndex((q, n) => n > d.at && !(q.question in d.answers));
      const any = qs.findIndex((q) => !(q.question in d.answers));
      if (left >= 0) return go(left);
      if (any >= 0) return go(any);
      if (qs.length > 1) return go(qs.length);
      send();
    };
    const send = () => {
      const notes = {};
      for (const q of qs) {
        const chosen = (q.options || []).find((o) => o.label === d.answers[q.question]);
        const one = {};
        if (chosen && chosen.preview) one.preview = chosen.preview;
        if (d.notes[q.question] && d.notes[q.question].trim()) one.notes = d.notes[q.question].trim();
        if (Object.keys(one).length) notes[q.question] = one;
      }
      this.act(card, () => m.submit(d.answers, notes), card.querySelector(".cta.primary"));
    };
    const draw = () => {
      card.querySelectorAll(":scope > :not(.card-head)").forEach((el) => el.remove());
      const head = card.querySelector(".card-head");
      head.querySelector(".title").textContent = qs.length > 1 ? "Claude asks" : qs[0].header || "Claude asks";
      head.querySelector(".count") && head.querySelector(".count").remove();
      if (qs.length > 1) head.append(h("span", { class: "count" }, d.at < qs.length ? `${d.at + 1} of ${qs.length}` : "Look them over"));
      // A tab for each question: answered ones ticked, any one a tap away.
      if (qs.length > 1) {
        card.append(h("div", { class: "q-tabs", role: "tablist" }, ...qs.map((q, n) => h("button", {
          class: `q-tab${n === d.at ? " on" : ""}${q.question in d.answers ? " done" : ""}`, type: "button", role: "tab",
          "aria-selected": String(n === d.at), "aria-label": `${q.header || `Question ${n + 1}`}${q.question in d.answers ? ", answered" : ""}`,
          onclick: () => go(n) }, q.question in d.answers ? icon("check") : h("span", { class: "dot" }), h("span", {}, q.header || String(n + 1)))),
          h("button", { class: `q-tab review${d.at === qs.length ? " on" : ""}`, type: "button", role: "tab",
                        disabled: !qs.every((q) => q.question in d.answers), onclick: () => go(qs.length) }, h("span", {}, "Send"))));
      }
      if (d.at >= qs.length) return drawReview();
      const q = qs[d.at];
      const multi = !!q.multiSelect;
      const previews = !multi && (q.options || []).some((o) => o.preview);
      card.append(h("div", { class: "question" }, q.question || ""));
      if (multi) card.append(h("div", { class: "card-note" }, "Pick all that apply"));
      const picked = d.picked[q.question] = d.picked[q.question] ||
        new Set(multi && d.answers[q.question] ? d.answers[q.question].split(", ").filter((l) => (q.options || []).some((o) => o.label === l)) : []);
      if (!multi && !(q.question in d.on) && d.answers[q.question]) d.on[q.question] = d.answers[q.question];
      const opts = h("div", { class: `opts${previews ? " with-preview" : ""}` });
      const shown = h("pre", { class: "preview", "aria-live": "polite" });
      const showPreview = (o) => {
        shown.textContent = (o && o.preview) || "";
        shown.hidden = !(o && o.preview);
      };
      const primary = h("button", { class: "cta primary", type: "button" });
      const ready = () => {
        if (multi) {
          primary.disabled = !picked.size;
          primary.textContent = qs.length > 1 ? "Next" : "Send";
        } else {
          primary.disabled = !d.on[q.question];
          primary.textContent = d.on[q.question] ? `${qs.length > 1 ? "Choose" : "Send"} “${cut(d.on[q.question], 28)}”` : "Pick one";
        }
      };
      (q.options || []).forEach((o, n) => {
        const on = multi ? picked.has(o.label) : d.on[q.question] === o.label;
        const btn = h("button", { class: `opt${multi ? " multi" : ""}${on ? " on" : ""}`, type: "button",
                                  role: multi ? "checkbox" : previews ? "radio" : null,
                                  "aria-checked": multi || previews ? String(on) : null },
          multi ? h("span", { class: "box", "aria-hidden": "true" }, icon("check")) : h("span", { class: "n", "aria-hidden": "true" }, String(n + 1)),
          h("span", { class: "what" }, h("b", {}, o.label), o.description ? h("small", {}, o.description) : null));
        if (previews) {
          btn.addEventListener("mouseenter", () => showPreview(o));
          btn.addEventListener("focus", () => showPreview(o));
          btn.addEventListener("mouseleave", () => showPreview((q.options || []).find((x) => x.label === d.on[q.question]) ||
                                                               (q.options || []).find((x) => x.preview)));
        }
        btn.addEventListener("click", () => {
          if (multi) {
            if (picked.has(o.label)) picked.delete(o.label); else picked.add(o.label);
            btn.classList.toggle("on", picked.has(o.label));
            btn.setAttribute("aria-checked", String(picked.has(o.label)));
            return ready();
          }
          if (previews) {
            // With a preview, a tap shows it; the button under it chooses.
            d.on[q.question] = o.label;
            opts.querySelectorAll(".opt").forEach((x) => { x.classList.toggle("on", x === btn); x.setAttribute("aria-checked", String(x === btn)); });
            showPreview(o);
            return ready();
          }
          d.answers[q.question] = o.label;
          delete d.own[q.question];
          btn.classList.add("chosen");
          next();
        });
        opts.append(btn);
      });
      if (!previews) card.append(opts);
      if (previews) {
        // The one picked, else the first (as Claude Code shows it).
        showPreview((q.options || []).find((x) => x.label === d.on[q.question]) || (q.options || []).find((x) => x.preview));
        card.append(h("div", { class: "preview-pair" }, opts, shown));      // beside each other where there's room
        // A note with your choice (Claude gets it with the answer).
        const note = h("textarea", { class: "field note", rows: 1, placeholder: "Add a note for Claude (optional)",
                                     "aria-label": "A note with your answer" });
        note.value = d.notes[q.question] || "";
        note.addEventListener("input", () => { d.notes[q.question] = note.value; });
        card.append(note);
      }
      // Your own words, for when no option fits.
      const own = m.other ? this.writeField(card, "Your answer", qs.length > 1 ? "Next" : "Send answer", (text) => {
        d.answers[q.question] = text;
        d.own[q.question] = true;
        next();
      }, { direct: true }) : null;
      if (own && d.own[q.question]) own.field.value = d.answers[q.question] || "";
      const actions = h("div", { class: "card-actions" });
      if (d.at > 0) actions.append(h("button", { class: "cta", type: "button", onclick: () => go(d.at - 1) }, "Back"));
      if (multi || previews) {
        primary.addEventListener("click", () => {
          d.answers[q.question] = multi ? (q.options || []).map((o) => o.label).filter((l) => picked.has(l)).join(", ") : d.on[q.question];
          delete d.own[q.question];
          next();
        });
        ready();
        actions.append(primary);
      }
      if (own) actions.append(h("button", { class: "cta", type: "button", onclick: () => { actions.hidden = true; own.open(); } },
                                d.own[q.question] ? "Change your answer…" : "Something else…"));
      if (actions.children.length) card.append(actions);
      if (own) {
        if (d.own[q.question]) { actions.hidden = true; own.box.hidden = false; }
        card.append(own.box);
      }
    };
    // Your answers, before they go: each a tap away from changing.
    const drawReview = () => {
      card.append(h("div", { class: "review" }, ...qs.map((q, n) => h("button", { class: "review-row", type: "button", onclick: () => go(n) },
        h("span", { class: "q" }, q.question), h("span", { class: "a" }, d.answers[q.question] || "—"),
        d.notes[q.question] && d.notes[q.question].trim() ? h("span", { class: "note" }, d.notes[q.question].trim()) : null))));
      const sendBtn = h("button", { class: "cta primary", type: "button", onclick: send }, "Send answers");
      card.append(h("div", { class: "card-actions" }, h("button", { class: "cta", type: "button", onclick: () => go(qs.length - 1) }, "Back"), sendBtn));
    };
    draw();
    return card;
  }

  // A question read off a terminal-engine session's screen: one at a time,
  // as its screen asks it, each option picked by its keys.
  questionPicks(m) {
    const q = m.questions[0] || {};
    const card = this.cardShell("question", q.header || "Claude asks", null);
    if (m.total > 1) card.querySelector(".card-head").append(h("span", { class: "count" }, `${m.index + 1} of ${m.total}`));
    card.append(h("div", { class: "question" }, q.question || ""));
    const opts = h("div", { class: "opts" });
    (q.options || []).forEach((o, n) => {
      const btn = h("button", { class: "opt", type: "button", onclick: () => this.act(card, m.picks[n], btn) },
        h("span", { class: "n", "aria-hidden": "true" }, String(n + 1)),
        h("span", { class: "what" }, h("b", {}, o.label), o.description ? h("small", {}, o.description) : null));
      opts.append(btn);
      if (o.preview) opts.append(h("pre", { class: "preview" }, o.preview));
    });
    card.append(opts);
    if (m.other) {
      const own = this.writeField(card, "Your answer", "Send answer", (text) => m.other(text));
      const actions = h("div", { class: "card-actions" },
        h("button", { class: "cta", type: "button", onclick: () => { actions.hidden = true; own.open(); } }, "Something else…"));
      card.append(actions, own.box);
    }
    return card;
  }

  // A permission: what Claude wants to do in words, the exact command (or
  // the diff) under it, and Allow / Always allow … (each way Claude
  // suggests, in words) / Don't allow (and why).
  permissionCard(m) {
    const card = this.cardShell("permission", m.title, m.text || null);
    if (m.count > 1) card.querySelector(".card-head").append(h("span", { class: "count" }, `${m.at + 1} of ${m.count}`));
    if (m.diff && m.diff.length) card.append(diffView(m.diff));
    if (m.details && !(m.diff && m.diff.length)) {
      const more = h("details", { class: "card-details" }, h("summary", {}, m.tool === "Bash" ? "The command" : "Details"), h("pre", {}, m.details));
      if (m.tool === "Bash" && (!m.text || m.details.length <= 160)) more.open = true;
      card.append(more);
    }
    if (m.reason) card.append(h("div", { class: "card-note" }, m.reason));
    const no = this.writeField(card, "Tell Claude why, or what to do instead (optional)", "Don't allow", (why) => m.deny(why));
    no.box.querySelector(".cta").classList.replace("primary", "danger");
    const actions = h("div", { class: "card-actions stack" });
    const allow = h("button", { class: "cta primary opt", type: "button", onclick: () => this.act(card, m.allow, allow) }, "Allow");
    actions.append(allow);
    for (const a of m.always || []) {
      const b = h("button", { class: "cta opt always", type: "button", onclick: () => this.act(card, a.pick, b) }, a.label);
      actions.append(b);
    }
    actions.append(h("button", { class: "cta opt", type: "button", onclick: () => { actions.hidden = true; no.open(); } }, "Don't allow…"));
    card.append(actions, no.box);
    return card;
  }

  // A plan to approve: the plan as a document, Approve and start (in the
  // mode Claude planned from, named), approving in another mode, and Keep
  // planning with what to change.
  planAsk(m) {
    const card = this.cardShell("plan", "Claude's plan is ready",
                                m.plan ? "Read it, then say whether Claude should start." : "Say whether Claude should start on it.");
    if (m.plan) {
      const doc = h("div", { class: "plan-doc", html: md(m.plan) });
      const big = h("button", { class: "text-btn plan-grow", type: "button", "aria-expanded": "false", onclick: () => {
        const open = card.classList.toggle("tall");
        big.setAttribute("aria-expanded", String(open));
        big.textContent = open ? "Show less" : "Read it bigger";
      } }, "Read it bigger");
      card.append(doc, big);
      requestAnimationFrame(() => { if (doc.scrollHeight <= doc.clientHeight + 4) big.remove(); });
    }
    const keep = this.writeField(card, "What should change? (optional)", "Keep planning", (what) => m.keep(what), { empty: true });
    keep.box.querySelector(".cta").classList.remove("primary");
    const actions = h("div", { class: "card-actions stack" });
    const mode = (k) => MODE_WORDS[k] || { label: k, about: "" };
    if (m.approve) {
      const b = h("button", { class: "cta primary opt approve", type: "button", onclick: () => this.act(card, m.approve, b) },
        h("span", { class: "big" }, "Approve and start"), m.back ? h("small", {}, `${mode(m.back).label}: ${mode(m.back).about}`) : null);
      actions.append(b);
    }
    // The other modes, a tap away (the first way is the one for most).
    const other = (m.modes || []).length && m.approve
      ? h("details", { class: "card-details approve-more" }, h("summary", {}, "Approve another way")) : null;
    for (const o of m.modes || []) {
      const words = { acceptEdits: "Approve, and accept edits without asking", auto: "Approve, in Auto mode",
                      default: "Approve, and ask before each change", bypassPermissions: "Approve, and don't ask about anything" }[o.mode];
      const b = h("button", { class: "cta opt approve", type: "button", onclick: () => this.act(card, o.pick, b) },
        h("span", { class: "big" }, words || o.label), o.mode ? h("small", {}, mode(o.mode).about) : o.detail ? h("small", {}, o.detail) : null);
      (other || actions).append(b);
    }
    if (other) actions.append(other);
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
    this.slashCheck();
  }

  // Its height to what's in it: measured again only when what's in it (or
  // the window) changed, not by every update of Claude's that draws the dock.
  grow() {
    const now = `${this.input.value}\u0000${window.innerWidth}x${window.innerHeight}`;
    if (now === this.grownFor) return;
    this.input.style.height = "auto";
    const tall = this.input.scrollHeight;
    this.input.style.height = `${Math.min(tall, window.innerHeight * 0.4)}px`;
    this.grownFor = this.input.isConnected && tall ? now : null;      // (not in the page yet: measured again once it is)
  }

  sendButtons() {
    this.micBtn.hidden = !this.talk.available();
    const empty = !this.input.value.trim() && !this.tray.length;
    const busy = this.tray.some((a) => a.state === "reading" || a.state === "uploading");
    const stop = this.working() && empty;
    this.stopBtn.hidden = !stop;
    this.sendBtn.hidden = stop;
    // (What you say is still coming into the box, a file still on its way.)
    this.sendBtn.disabled = empty || busy || this.sending || this.talk.on();
    this.composer.classList.toggle("ready", !empty);
  }

  // What's in the box goes: its text, the files it names (uploaded into the
  // worktree already), its images as image blocks (the chat engine) or
  // pasted into Claude's prompt (its classic terminal, as Ctrl+V does).
  async send() {
    const text = this.input.value;
    const tray = this.tray.slice();
    if ((!text.trim() && !tray.length) || this.talk.on() || this.sending) return;
    if (tray.some((a) => a.state === "reading" || a.state === "uploading")) return toast("A file is still on its way: a moment");
    const failed = tray.find((a) => a.state === "failed");
    if (failed) return toast(`${failed.name} didn't upload: take it off, or add it again`);
    // /model written out, in the chat: as its menu does it (sent as a
    // message, the live state wouldn't know of it).
    const model = this.engine === "chat" && !tray.length && text.trim().match(/^\/model(?:\s+(\S+))?$/);
    if (model) {
      this.input.value = "";
      this.typed();
      if (!model[1]) return this.openMenu("model");
      const s = this.settings();
      const m = modelOf(model[1], s.models) || { value: model[1], displayName: modelName(model[1], s.models) };
      return this.setModel(m);
    }
    const files = tray.filter((a) => a.kind === "file").map((a) => `[File: ${a.path}]`);
    const message = files.length ? `${text.replace(/\s+$/, "")}${text.trim() ? "\n\n" : ""}${files.join("\n")}` : text;
    const images = tray.filter((a) => a.kind === "image").map((a) => ({ type: a.type, data: a.data }));
    // Pictures into Claude's classic terminal: pasted one by one, and only
    // then the words (it may have to wake first): sent as before, the box
    // kept until they're in.
    if (images.length && this.engine !== "chat") {
      this.sending = true;
      this.sendButtons();
      try {
        await this.pasteIntoTerminal(images, message);
        this.sentOff(tray);
      } catch (e) {
        toast(e.message);
      }
      this.sending = false;
      this.sendButtons();
      return;
    }
    // Everything else: it's sent the moment you send it. The box empties, what
    // you said is in the conversation (or in the queue, while Claude works),
    // and whoever holds the chat moves on (back to the board); the server's
    // answer comes after. Should it not take it: why, and your words back in
    // the box (its draft, if the chat's closed by then).
    const out = this.outgo(message, text, tray);
    this.sentOff(tray, true);
    if (this.opts.onSent) this.opts.onSent("send");
    // One after the other, in the order you sent them.
    const prev = this.sendQueue || Promise.resolve();
    const done = this.sendQueue = prev.catch(() => {}).then(() => this.post("send", { text: message, ...(images.length ? { images } : {}) }, { told: true }));
    try {
      const r = await done;
      out.sent = true;
      out.el.classList.remove("sending");
      this.settleOutbox();      // (the conversation may have it already)
      if (r && r.waking) toast("Waking Claude with it…");
      if (r && r.queued) this.outDone(out);       // in the broker's queue now: the queue shows it
      // Should the conversation never say it (a classic terminal's answer to a dialog), it goes anyway.
      setTimeout(() => this.outDone(out), 30000);
    } catch (e) {
      this.takeBack(text, tray);
      this.outDone(out);
      this.unsent();
      toast(`Didn't send: ${e.message}`);
    } finally {
      if (this.sendQueue === done) this.sendQueue = null;
    }
  }

  // What was sent is off the box: its words, its draft, the tray's.
  sentOff(tray, keepPictures = false) {
    this.input.value = "";
    this.takenBack = "";
    store.set(`draft:${this.id}`, "");
    if (!keepPictures) for (const a of tray) if (a.url) URL.revokeObjectURL(a.url);
    this.tray = this.tray.filter((a) => !tray.includes(a));
    this.drawTray();
    this.closeMenu();
    this.grow();
    this.typed();
    this.toBottom(true);
  }

  // A message on its way, shown now: a bubble under the conversation, or
  // (Claude at work, so it waits for it) in the queue over the box.
  outgo(message, text, tray) {
    const shots = tray.filter((a) => a.kind === "image" && a.url);
    const said = this.userView(message);
    const bubble = h("div", { class: "bubble" },
      shots.length ? h("div", { class: "shots" }, ...shots.map((a) => h("span", { class: "shot" }, h("img", { src: a.url, alt: "" })))) : null,
      ...(said.parts || [said.note || said.summary || ""]));
    tray.forEach((a) => { a.taken = false; });
    // (What the conversation had then: after it comes again in full, not one of those.)
    const out = { text: text.trim(), key: outKey(message), shots, tray, mark: this.items.length, known: new Set(this.itemKeys), queued: this.engine === "chat" && this.working(),
                  sent: false, el: h("div", { class: "msg user sending" }, bubble) };
    this.outbox.push(out);
    if (out.queued) this.renderQueue();
    else this.outboxEl.append(out.el);
    return out;
  }

  // The conversation has what you sent (a message of yours since you sent
  // it, the same words; or, once the server took it, the next one of yours
  // whatever its words): its bubble here goes, the conversation's in its place.
  settleOutbox() {
    if (!this.outbox.length) return;
    this.claimed = this.claimed || new WeakSet();
    for (const out of [...this.outbox]) {
      // Yours since you sent it: a message, or a command (/compact) as the conversation shows it.
      const since = this.items.slice(out.mark).filter((it) => (it.kind === "user" || it.kind === "command") && !this.claimed.has(it) &&
        !(out.redrawn && it.key && out.known.has(it.key)));
      const same = since.find((x) => outKey(x.text || "") === out.key);
      // Else (taken by the server, its words not the same), the next of yours: not
      // one Claude Code put in your name (a task's note), nor one from before a redraw.
      const next = out.sent && !out.redrawn ? since.find((x) => x.kind === "user" && !/^\s*</.test(x.text || "")) : null;
      const it = same || next;
      if (!it) continue;
      this.claimed.add(it);
      this.outDone(out);
    }
  }

  outDone(out) {
    const at = this.outbox.indexOf(out);
    if (at < 0) return;
    this.outbox.splice(at, 1);
    out.el.remove();
    if (out.queued) this.renderQueue();
    for (const a of out.shots) if (a.url && !a.taken) URL.revokeObjectURL(a.url);
  }

  // A message that didn't go: its words back in the box, before what's
  // there now, and its files and pictures back on the tray.
  takeBack(text, tray) {
    tray.forEach((a) => { a.taken = true; });
    // Opened again meanwhile: back in that one's box (its draft read already).
    const open = chatsOpen.get(this.id);
    if (this.closed && open && open !== this && !open.closed) return open.takeBack(text, tray);
    if (this.closed) {
      const was = store.get(`draft:${this.id}`) || "";
      store.set(`draft:${this.id}`, was ? `${text}\n${was}` : text);
      return;
    }
    // Several that didn't go: back in the order they were sent, before what you wrote since.
    const kept = this.takenBack && this.input.value.startsWith(this.takenBack) ? this.takenBack : "";
    const rest = this.input.value.slice(kept.length).trim();
    this.takenBack = kept ? `${kept}\n${text}` : text;
    this.input.value = rest ? `${this.takenBack}\n${rest}` : this.takenBack;
    this.tray = [...tray, ...this.tray];
    this.drawTray();
    this.typed();
    this.grow();
  }

  // Images into Claude's classic terminal: each pasted into its prompt (it
  // shows [Image #1]), then the words, sent as you'd press Enter.
  async pasteIntoTerminal(images, text) {
    const up = () => { const sc = this.screen || {}; return !sleepOf(this.row) && sc.live && !sc.exited && !sc.asleep; };
    if (!up()) {
      // Asleep: woken, and the pictures go in once its prompt is back.
      if (sleepOf(this.row) === "asleep" || (this.screen && this.screen.asleep)) wakeSession(this.row);
      toast("Waking Claude to give it the pictures…");
      for (let i = 0; i < 60 && !up() && !this.closed; i++) await new Promise((ok) => setTimeout(ok, 500));
      if (!up()) throw new Error("Claude's terminal isn't running: start it, then send the pictures again");
      await new Promise((ok) => setTimeout(ok, 2000));      // its prompt drawn
    }
    for (const im of images) {
      await api("/api/clip", { ...im, session: this.id, paste: true });
      await new Promise((ok) => setTimeout(ok, 400));       // Claude reads the clipboard
    }
    return text.trim() ? this.post("send", { text }) : this.post("keys", { keys: ["Enter"] });
  }

  // Stop: the chat engine's interrupt, or Esc in Claude's terminal. As Esc
  // does in Claude Code, what was waiting to go comes back into the box.
  async stop() {
    try {
      if (this.engine === "chat") {
        const queue = (this.live && Array.isArray(this.live.queue) && this.live.queue) || [];
        for (const q of queue.slice().reverse()) {
          const content = await this.unqueue(q);
          if (content) this.restore(content);
        }
        await this.post("interrupt", {});
      } else await this.post("keys", { keys: ["Escape"] });
    } catch (e) {
      toast(e.message);
    }
  }

  // The box while dictating: what's going on, in place of its placeholder.
  listening(text) {
    this.composer.classList.toggle("listening", text !== null);
    this.micBtn.classList.toggle("on", this.talk.on() && this.talk.run.held);
    this.input.placeholder = text || this.placeholder;
  }

  setPlaceholder(text) {
    this.placeholder = text;
    if (!this.composer.classList.contains("listening")) this.input.placeholder = text;
  }

  // ---- what goes with the message: pictures and files (the tray)

  // Files picked, pasted or dropped: an image goes as an image (made small
  // enough for Claude first), anything else is uploaded into the worktree.
  addFiles(files) {
    for (const f of files) {
      if (!f) continue;
      if (/^image\//.test(f.type) && !/svg/.test(f.type)) this.addImage(f);
      else this.upload(f);
    }
  }

  async addImage(file) {
    if (this.tray.filter((a) => a.kind === "image").length >= IMAGES_MAX)
      return toast(`${IMAGES_MAX} images at most in one message`);
    const a = { kind: "image", name: file.name || "image", state: "reading" };
    this.tray.push(a);
    this.drawTray();
    try {
      const img = await claudeImage(file);
      if (a.removed) return;
      Object.assign(a, { type: img.type, data: await base64Of(img), url: URL.createObjectURL(img), state: "ready" });
      this.drawTray();
    } catch (e) {
      // An image the browser can't read (HEIC on a computer...): a file then.
      this.tray = this.tray.filter((x) => x !== a);
      if (!a.removed) this.upload(file);
      else this.drawTray();
    }
  }

  // A file into the worktree's .amarchy/uploads/ (git-ignored), named in
  // the message so Claude reads it there.
  async upload(file) {
    if (file.size > UPLOAD_MAX) return toast(`${file.name} is too big (50 MB at most)`);
    const a = { kind: "file", name: file.name || "file", size: file.size, state: "uploading" };
    this.tray.push(a);
    this.drawTray();
    try {
      const r = await this.post("upload", { name: a.name, data: await base64Of(file) });
      a.path = r.path;
      a.state = "ready";
      if (a.removed) this.post("upload", { remove: r.path }).catch(() => {});
      else toast(`Saved in the project as ${r.path}`);
    } catch (e) {
      a.state = "failed";
      a.error = e.message;
    }
    this.drawTray();
  }

  unattach(a) {
    a.removed = true;
    this.tray = this.tray.filter((x) => x !== a);
    if (a.url) URL.revokeObjectURL(a.url);
    // Uploaded and not sent: out of the worktree again.
    if (a.kind === "file" && a.path) this.post("upload", { remove: a.path }).catch(() => {});
    this.drawTray();
    this.input.focus({ preventScroll: true });
  }

  drawTray() {
    this.trayEl.hidden = !this.tray.length;
    this.trayEl.replaceChildren(...this.tray.map((a) => {
      const x = h("button", { class: "att-x", type: "button", "aria-label": `Take ${a.name} off`, title: "Take it off",
                              onclick: () => this.unattach(a) }, icon("failed"));
      if (a.kind === "image")
        return h("div", { class: `att image${a.url ? "" : " busy"}`, title: a.name },
                 a.url ? h("img", { src: a.url, alt: a.name }) : spinner(), x);
      const where = a.state === "uploading" ? "Uploading…" : a.state === "failed" ? a.error || "Didn't upload" : `Saved in the project: ${a.path}`;
      return h("div", { class: `att file ${a.state}`, title: a.path || a.name },
        a.state === "uploading" ? spinner() : icon(a.state === "failed" ? "failed" : "file", a.state === "failed" ? "bad" : ""),
        h("div", { class: "att-text" }, h("div", { class: "name" }, a.name), h("div", { class: "where" }, where)), x);
    }));
    this.sendButtons();
  }

  // The + menu's choices, or a session menu's "Add a photo".
  async pick(what) {
    this.closeMenu();
    const files = await pickFiles(what === "files" ? "" : "image/*", { multiple: what !== "camera", capture: what === "camera" });
    if (files.length) this.addFiles(files);
    this.input.focus({ preventScroll: true });
  }

  canDrop(e) {
    return !this.view.content && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  }

  // ---- the model, the mode, the commands (GET /composer)

  async loadInfo() {
    const want = this.engine;
    this.infoAt = Date.now();
    try {
      const r = await fetch(`/api/session/${encodeURIComponent(this.id)}/composer`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "");
      this.info = d;
      this.infoEngine = want;
    } catch (e) {
      this.infoAt = 0;
    }
    this.drawPills();
    if (this.menu) this.drawMenu();
  }

  // The model and mode the session's Claude is in: the live state's on the
  // chat engine, else what its conversation said last.
  settings() {
    const live = this.engine === "chat" ? this.live : null;
    const info = this.info || {};
    const fresh = info.engine === this.engine;
    return { model: (live && live.model) || (fresh && info.model) || "", mode: (live && live.permission_mode) || (fresh && info.mode) || "",
             models: info.models && info.models.length ? info.models : FALLBACK_MODELS };
  }

  drawPills() {
    if (this.row && this.infoEngine && this.infoEngine !== this.engine && !this.infoLoading) {
      this.infoLoading = true;      // switched engines: what it offers changed
      this.loadInfo().then(() => { this.infoLoading = false; });
    }
    const s = this.settings();
    const mode = s.mode ? modeWords(s.mode).label : "";
    // The same as drawn: left as it is (each update of Claude's state would
    // take the pill from under a finger on its way to tap it).
    const sig = JSON.stringify([s.model, mode, s.mode, this.engine, this.menu && this.menu.name]);
    if (sig === this.pillsSig) return;
    this.pillsSig = sig;
    this.modelPill.replaceChildren(h("span", { class: "k" }, modelName(s.model, s.models) || "Default model"), icon("chevron", "chev"));
    this.modelPill.title = "Which Claude answers";
    this.modePill.replaceChildren(icon("shield"), h("span", { class: "k" }, mode || "How Claude asks"), icon("chevron", "chev"));
    this.modePill.title = s.mode ? modeWords(s.mode).about || "" : "How Claude asks before it changes things";
    this.modePill.classList.toggle("off", this.engine !== "chat");
    for (const [p, n] of [[this.modelPill, "model"], [this.modePill, "mode"]])
      p.setAttribute("aria-expanded", String(!!this.menu && this.menu.name === n));
  }

  async setModel(m) {
    this.closeMenu(true);
    try {
      // For this chat only (set_model): not the classic terminal's /model,
      // which makes it the default of every new session too.
      const r = await this.post("model", { model: m.value });
      toast(r.later ? `${m.displayName} once Claude wakes` : `Now on ${m.displayName}`);
      if (this.info) this.info.model = m.value;
      if (this.live && this.engine === "chat") this.live.model = m.resolvedModel || m.value;
      this.drawPills();
    } catch (e) {
      toast(e.message);
    }
  }

  async setMode(mode) {
    this.closeMenu(true);
    try {
      const r = await this.post("mode", { mode });
      toast(r.later ? `${modeWords(mode).label} once Claude wakes` : modeWords(mode).label);
      if (this.info) this.info.mode = mode;
      if (this.live) this.live.permission_mode = mode;
      this.drawPills();
    } catch (e) {
      toast(e.message);
    }
  }

  // ---- the menus over the box: + (add), / (commands), the model, the mode

  toggleMenu(name) {
    if (this.menu && this.menu.name === name) this.closeMenu(true);
    else this.openMenu(name);
  }

  openMenu(name) {
    this.menu = { name, at: 0, all: false };
    this.menuEl.hidden = false;
    this.menuEl.setAttribute("aria-label", { add: "Add", slash: "Commands", model: "Model", mode: "Mode" }[name]);
    if (!this.outside) {
      this.outside = (e) => { if (this.menu && !this.box.contains(e.target)) this.closeMenu(); };
      document.addEventListener("pointerdown", this.outside, true);
    }
    if ((name === "slash" || name === "model") && (!this.info || Date.now() - (this.infoAt || 0) > 30000)) this.loadInfo();
    this.drawMenu();
    this.drawPills();
    if (name !== "slash") menuFocus(this.menuEl);
  }

  // back: the keys go back where the menu was opened from.
  closeMenu(back) {
    if (!this.menu) return;
    const was = this.menu.name;
    this.menu = null;
    this.menuEl.hidden = true;
    this.menuEl.replaceChildren();
    this.input.removeAttribute("aria-activedescendant");
    if (this.outside) document.removeEventListener("pointerdown", this.outside, true);
    this.outside = null;
    this.drawPills();
    if (back) ({ add: this.attachBtn, model: this.modelPill, mode: this.modePill }[was] || this.input).focus({ preventScroll: true });
  }

  drawMenu() {
    const m = this.menu;
    if (!m) return;
    const head = (text) => h("div", { class: "cm-head" }, text);
    const item = (o) => h("button", { class: `cm-item${o.on ? " on" : ""}`, type: "button", role: "menuitem", disabled: o.disabled || null,
                                      onclick: o.act },
      o.icon ? icon(o.icon) : null,
      h("span", { class: "what" }, h("b", {}, o.label), o.detail ? h("small", {}, o.detail) : null),
      o.on ? icon("check", "on-mark") : null);
    let kids = [];
    if (m.name === "add") {
      const phone = matchMedia("(pointer: coarse)").matches;
      kids = [
        item({ icon: "image", label: phone ? "Photos" : "A picture", detail: "Claude sees it", act: () => this.pick("photos") }),
        phone ? item({ icon: "camera", label: "Take a photo", act: () => this.pick("camera") }) : null,
        item({ icon: "file", label: "A file", detail: "Saved in the project, for Claude to read", act: () => this.pick("files") }),
        h("div", { class: "cm-note" }, phone ? "You can paste a picture into the box too." : "You can paste a picture into the box, or drop files on the chat."),
      ];
    } else if (m.name === "model") {
      const s = this.settings();
      const current = modelOf(s.model, s.models);
      const main = s.models.filter((x) => !/^claude-/.test(x.value));
      const list = m.all || !main.length ? s.models : main;
      const chat = this.engine === "chat";
      kids = [head("Model"), ...list.map((x) => item({ label: x.displayName || x.value, detail: x.description, disabled: !chat,
                                                         on: current && current.value === x.value, act: () => this.setModel(x) }))];
      if (list !== s.models) kids.push(item({ label: "Other versions…", act: () => { m.all = true; this.drawMenu(); menuFocus(this.menuEl); } }));
      if (!chat) kids.push(h("div", { class: "cm-note" }, "Claude's classic terminal changes this itself. Here you change it for this chat only."));
    } else if (m.name === "mode") {
      const now = this.settings().mode;
      const modes = ["default", "acceptEdits", "plan", "auto", ...(["default", "acceptEdits", "plan", "auto"].includes(now) || !now ? [] : [now])];
      const chat = this.engine === "chat";
      kids = [head("How Claude asks"),
              ...modes.map((k) => item({ label: modeWords(k).label, detail: modeWords(k).about, on: k === now, disabled: !chat,
                                         act: () => this.setMode(k) }))];
      if (!chat) kids.push(h("div", { class: "cm-note" }, "Claude's classic terminal changes this itself. Here you change it for this chat only."));
    } else if (m.name === "slash") {
      kids = this.slashItems(item, head);
    }
    this.menuEl.replaceChildren(...kids.filter(Boolean));
    if (m.name === "slash") this.lightSlash();
  }

  // ---- the / menu: Claude Code's commands that work in a chat, in plain
  // words, then the project's own, then every other skill and command.

  slashCheck() {
    const m = this.input.value.match(/^\/(\S*)$/);
    if (m) {
      if (!this.menu || this.menu.name !== "slash") this.openMenu("slash");
      else { this.menu.at = 0; this.drawMenu(); }
    } else if (this.menu && this.menu.name === "slash") this.closeMenu();
    this.drawHint();
  }

  // Every command, as the menu shows it: {name, label, about, where, core, run, menu, arg}.
  commands() {
    const info = this.info || {};
    const seen = new Set();
    const out = [];
    for (const c of CORE_COMMANDS) { seen.add(c.name); out.push({ ...c, core: true }); }
    for (const c of info.commands || []) {
      if (seen.has(c.name) || HIDDEN_COMMANDS.has(c.name) || /^__/.test(c.name)) continue;
      seen.add(c.name);
      out.push({ name: c.name, label: `/${c.name}`, about: plainAbout(c.description), where: c.where || "", arg: c.argumentHint || "",
                 aliases: c.aliases || [] });
    }
    return out;
  }

  slashItems(item, head) {
    const q = (this.input.value.match(/^\/(\S*)$/) || [])[1] || "";
    const all = this.commands();
    const ql = q.toLowerCase();
    const starts = (c) => [c.name, ...(c.aliases || [])].some((n) => n.toLowerCase().startsWith(ql));
    const has = (c) => ql.length > 1 && `${c.name} ${c.core ? c.label : ""} ${c.about}`.toLowerCase().includes(ql);
    const draw = (c) => {
      const el = item({ label: c.core ? c.label : `/${c.name}`, detail: c.core ? `/${c.name} · ${c.about}` : c.about, act: () => this.slashPick(c) });
      el.classList.add("slash");
      el.tabIndex = -1;
      el.id = `${this.id}-cmd-${c.name.replace(/[^\w-]/g, "_")}`;
      el.cmd = c;
      return el;
    };
    if (!q) {
      const groups = [["In this chat", all.filter((c) => c.core)], ["This project", all.filter((c) => !c.core && c.where === "project")],
                      ["Skills and commands", all.filter((c) => !c.core && c.where !== "project")]];
      const kids = [];
      for (const [name, list] of groups) if (list.length) kids.push(head(name), ...list.map(draw));
      if (!this.info) kids.push(h("div", { class: "cm-note" }, "Reading the skills and commands…"));
      return kids;
    }
    const found = [...all.filter(starts), ...all.filter((c) => !starts(c) && has(c))].slice(0, 60);
    return found.length ? found.map(draw) : [h("div", { class: "cm-note" }, `No command starts with /${q}. Send it as it is if you know it.`)];
  }

  // The command under the keys' cursor, lit (the cursor stays in the box).
  lightSlash() {
    const items = Array.from(this.menuEl.querySelectorAll(".cm-item.slash"));
    if (!items.length) return this.input.removeAttribute("aria-activedescendant");
    this.menu.at = Math.max(0, Math.min(this.menu.at, items.length - 1));
    items.forEach((el, n) => el.classList.toggle("lit", n === this.menu.at));
    const lit = items[this.menu.at];
    this.input.setAttribute("aria-activedescendant", lit.id);
    uiReveal(lit, { scroller: lit.parentElement, pad: 0 });
  }

  // The keys in the box while the / menu is open: arrows move, Enter or Tab
  // picks, Esc closes it. true: handled.
  slashKeys(e) {
    if (!this.menu || this.menu.name !== "slash" || e.isComposing) return false;
    const items = this.menuEl.querySelectorAll(".cm-item.slash");
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.closeMenu();
      return true;
    }
    if (!items.length) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      this.menu.at = (this.menu.at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      this.lightSlash();
      return true;
    }
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
      e.preventDefault();
      this.slashPick(items[this.menu.at].cmd);
      return true;
    }
    return false;
  }

  slashPick(c) {
    this.closeMenu();
    if (c.menu) {           // the model, the mode: their menus
      this.input.value = "";
      this.typed();
      this.openMenu(c.menu);
      return;
    }
    this.input.value = `/${c.name}${c.run ? "" : " "}`;
    this.typed();
    if (c.run) this.send();
    else this.input.focus();
  }

  // Under a command being written: what it takes after it.
  drawHint() {
    const m = this.input.value.match(/^\/(\S+)\s/);
    const c = m && this.commands().find((x) => x.name === m[1]);
    const hint = c && (c.argHelp || c.arg);
    if (!this.hintEl) {
      this.hintEl = h("div", { class: "slash-hint" });
      this.box.insertBefore(this.hintEl, this.composer);
    }
    this.hintEl.hidden = !hint;
    this.hintEl.replaceChildren(...(hint ? [h("code", {}, `/${c.name}`), ` ${hint}`] : []));
  }
}

// ---- the composer's helpers

const IMAGES_MAX = 20;              // images in one message (the server's limit)
const IMAGE_EDGE = 2000;            // px: a bigger picture is made this size (Claude sees no more)
const IMAGE_BYTES = 3_700_000;      // a picture bigger than this is made smaller (Claude takes 5 MB, in base64)
const UPLOAD_MAX = 50_000_000;      // bytes of a file you upload

// Claude Code's commands that work in a chat, in plain words, friendliest
// first. run: sent as soon as it's picked; menu: opens the composer's own.
const CORE_COMMANDS = [
  { name: "compact", label: "Compact the conversation", about: "Claude sums up what's been said, to make room for more", run: true },
  { name: "clear", label: "Start fresh", about: "A new conversation (this one stays saved)", run: true },
  { name: "context", label: "How full is the conversation?", about: "What fills Claude's memory of this chat", run: true },
  { name: "model", label: "Change the model", about: "Which Claude answers", menu: "model" },
  { name: "mode", label: "Change how Claude asks", about: "Before changes, never, or plan first", menu: "mode" },
  { name: "effort", label: "How hard Claude thinks", about: "More is slower, and better at hard things", argHelp: "low, medium, high, xhigh or max" },
  { name: "usage", label: "How much of your plan is used", about: "This chat's and this week's share of your Claude plan", run: true },
  { name: "init", label: "Write notes about this project", about: "Claude studies the project and writes a CLAUDE.md for itself", run: true },
];

// Claude Code's own that need its terminal (menus, logins, its screen) or
// that amarchy does itself: not in the menu.
const HIDDEN_COMMANDS = new Set(["config", "mcp", "resume", "login", "logout", "voice", "bg", "rewind", "color", "focus", "heapdump",
  "agents", "auto-mode-setup", "import", "reload-plugins", "output-style", "rename", "design-consent", "design-revoke",
  "extra-usage", "usage-credits", "team-onboarding", "workflow-launch-exec", "exit", "quit", "terminal-setup", "ide",
  "permissions", "hooks", "theme", "vim", "statusline", "memory", "add-dir", "doctor", "release-notes", "upgrade",
  "privacy-settings", "status", "feedback", "bug", "export", "keybindings", "remote-control", "plugin", "plugins",
  "install-github-app", "install-slack-app", "tasks", "todos", "pr-comments", "migrate-installer", "sandbox"]);

// The models when no Claude has said which there are yet.
const FALLBACK_MODELS = [
  { value: "default", displayName: "Default (recommended)", description: "Claude Code's choice" },
  { value: "opus", displayName: "Opus", description: "For complex work and everyday tasks" },
  { value: "sonnet", displayName: "Sonnet", description: "For simpler tasks" },
  { value: "haiku", displayName: "Haiku", description: "Fastest for quick answers" },
];

// A model as the menu has it, for an id or alias Claude says it's on.
function modelOf(id, models) {
  if (!id) return null;
  const list = models || [];
  return list.find((x) => x.value === id) || list.find((x) => x.resolvedModel === id && x.value !== "default")
    || list.find((x) => x.resolvedModel === id) || null;
}

// "claude-opus-5-5[1m]": "Opus 5.5 (1M)"; an alias as its model's name.
function modelName(id, models) {
  const m = modelOf(id, models);
  if (m && m.value === "default") return "Default";
  if (m) return m.displayName || m.value;
  const r = String(id || "").match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i);
  return r ? `${r[1][0].toUpperCase()}${r[1].slice(1)} ${r[2]}${r[3] ? `.${r[3]}` : ""}${r[4] ? " (1M)" : ""}` : String(id || "");
}

// A mode in words (MODE_WORDS, shared with the plan card).
function modeWords(k) {
  return MODE_WORDS[k] || { label: k || "", about: "" };
}

// A skill's description, short: its first sentence, without "(user)" and
// the plugin's name.
function plainAbout(text) {
  const t = String(text || "").replace(/^\([\w:-]+\)\s*/, "").replace(/\s*\((user|project|plugin|bundled|[\w-]+:[\w-]+)\)\s*$/i, "")
    .replace(/\s+/g, " ").trim();
  const first = t.match(/^.{20,}?[.!?](?=\s|$)/);
  return cut(first ? first[0] : t, 110);
}

// Files from the browser's chooser: pictures (the camera's, with capture),
// or any.
function pickFiles(accept, { multiple, capture } = {}) {
  return new Promise((ok) => {
    const input = h("input", { type: "file", accept: accept || null, multiple: multiple || null,
                               capture: capture ? "environment" : null, class: "hidden-file" });
    input.addEventListener("change", () => { ok(Array.from(input.files || [])); input.remove(); });
    input.addEventListener("cancel", () => { ok([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

// A picture as Claude takes it: PNG, JPEG, GIF or WebP, at most IMAGE_EDGE
// on its long side and IMAGE_BYTES big (a photo off a phone is made
// smaller). Throws for one the browser can't read.
async function claudeImage(file) {
  const fits = /^image\/(png|jpeg|gif|webp)$/.test(file.type);
  let bmp = null;
  try { bmp = await createImageBitmap(file); } catch (e) { if (!fits) throw e; }
  if (fits && file.size <= IMAGE_BYTES && (!bmp || Math.max(bmp.width, bmp.height) <= IMAGE_EDGE)) return file;
  if (!bmp) throw new Error("couldn't read the image");
  const k = Math.min(1, IMAGE_EDGE / Math.max(bmp.width, bmp.height));
  const encode = (type, quality) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext("2d");
    if (type === "image/jpeg") { g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); }      // no see-through in a JPEG
    g.drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("couldn't read the image"))), type, quality));
  };
  let out = file.type === "image/png" ? await encode("image/png") : null;
  for (const q of [0.85, 0.7, 0.5]) if (!out || out.size > IMAGE_BYTES) out = await encode("image/jpeg", q);
  return out;
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
