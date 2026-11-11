// What Claude said, in a browser: the conversation is the only view. A
// reply shows as Claude wrote it, every word in its order, rendered as
// markdown: lists, tables (a card per row on a phone), code. A long reply
// is three parts, each under its small head: Briefing (its opening and its
// brief block's rows, one card), Action items (its actions block, what to
// use for it, its questions; or that there's nothing for you to do) and
// Content (its "## " sections folded under their headings, one box of
// heads: a tap opens one, Open all every one; the words are all there,
// folded or not).
// In their place, the blocks it made for you to use (a draft, a link,
// a command, an event, to-dos, a contact, a chat), open, each with its
// buttons (a link folded: its row has Copy and Open); its questions (choices) as buttons, a tap sending the answer;
// asked before something newer, no longer to tap. The goal block isn't
// shown (it's the chat's). An old reply written with update_brief shows as
// the text it held (bin/amarchy brief_text). Nothing runs as markup, only
// safe links open, no Brief | Chat switch anywhere. On a phone and on a wide
// screen, with screenshots.
//
//   node test/reply-view.js            both layouts
//   node test/reply-view.js phone      one layout (phone | wide)
//
// Needs a Chromium and Playwright's `playwright-core` (PLAYWRIGHT_CORE=<its folder>
// or on NODE_PATH; CHROME=<the chrome binary>, else the one Playwright installed,
// found under ~/.cache/ms-playwright). It starts its own app server from this
// checkout's bin/amarchy, with a home and state of its own. Screenshots go to
// SHOTS (default: a folder under the system's temp dir). Exits 0 when every check passed.

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "reply-view-"));
const ONLY = process.argv[2];

// The same app server look-switch.js starts: the app's handler on 127.0.0.1,
// with the Tailscale login and Origin the app expects from its own host.
const SHIM = `
import importlib.machinery, importlib.util, os, sys, threading, http.server
bin, port, home = sys.argv[1], int(sys.argv[2]), sys.argv[3]
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", bin)
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
am.app_key(); am.migrate()
st = am.AppState(); st.transcriber = None
Handler = am.app_handler(st, ["tester@test"], "127.0.0.1")
class Local(Handler):
    def parse_request(self):
        ok = super().parse_request()
        if ok and not self.headers.get("Tailscale-User-Login"):
            self.headers["Tailscale-User-Login"] = "tester@test"
        if ok and self.headers.get("Origin"):
            self.headers.replace_header("Origin", "https://" + self.headers.get("Host", ""))
        return ok
server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Local)
server.daemon_threads = True
threading.Thread(target=am.app_watch, args=(st,), daemon=True).start()
print("listening", flush=True)
server.serve_forever()
`;

function freePort() {
  return new Promise((ok, no) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
    s.on("error", no);
  });
}

function startServer(port, home) {
  return new Promise((ok, no) => {
    const py = spawn("python3", ["-c", SHIM, BIN, String(port), home], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    py.stderr.on("data", (d) => { err += d; });
    py.stdout.once("data", () => ok(py));
    py.on("exit", (code) => no(new Error(`the app server stopped (${code}): ${err.slice(-400)}`)));
  });
}

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), ".cache", "ms-playwright");
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith("chromium-")).sort().reverse() : [];
  for (const d of dirs) for (const sub of ["chrome-linux64", "chrome-linux"]) {
    const bin = path.join(base, d, sub, "chrome");
    if (fs.existsSync(bin)) return bin;
  }
  return undefined;
}

function loadPlaywright() {
  for (const id of [process.env.PLAYWRIGHT_CORE, "playwright-core", "playwright"]) {
    if (!id) continue;
    try { return require(id); } catch (err) { /* the next one */ }
  }
  console.error("playwright-core not found: set PLAYWRIGHT_CORE to its folder");
  process.exit(2);
}

const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};


// An old reply written with update_brief, as the server shows it now (bin/amarchy brief_text).
function briefText(b) {
  const py = `
import importlib.machinery, importlib.util, json, sys
loader = importlib.machinery.SourceFileLoader("am", sys.argv[1])
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
print(json.dumps(am.brief_text(json.loads(sys.argv[2]))))
`;
  const r = require("child_process").spawnSync("python3", ["-I", "-c", py, BIN, JSON.stringify(b)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

// A reply's blocks as the server reads them (bin/amarchy reply_blocks).
function serverBlocks(text) {
  const py = `
import importlib.machinery, importlib.util, json, sys
loader = importlib.machinery.SourceFileLoader("am", sys.argv[1])
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
print(json.dumps(am.reply_blocks(sys.stdin.read())))
`;
  const r = require("child_process").spawnSync("python3", ["-I", "-c", py, BIN], { input: text, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

const OLD_BRIEF = {
  title: "A plan for the search page", status: "done", goal: "Plan the search page",
  answer: [{ point: "Three steps", detail: "build, test, ship" }],
  artifacts: [{ type: "link", title: "The mockup", url: "https://example.com/mock" }],
  waiting: [{ question: "Start now?", options: [{ label: "Start", send: "Start building" }, { label: "Later" }] }],
};

const REPLY = [
  "The search page works: it filters as you type, <img src=x onerror=\"window.__pwned = 1\">.",
  "",
  "```brief",
  "Checked: Both view tests pass, **phone and wide**",
  "Open: Algolia isn't wired",
  "You: Send the draft, then **say** whether to ship it",
  "```",
  "",
  "It reads **120 items** and answers in under 50 ms. Draft for the group:",
  "",
  "```whatsapp to=\"C21 group\" phone=\"+57 300 123 4567\"",
  "Hola equipo, les comparto el resumen:",
  "1. Piloto PQR",
  "2. Datos por Excel",
  "```",
  "",
  "```choices question=\"Ship it to main?\"",
  "- Ship it | Ship it: merge to main and push",
  "- Not yet",
  "```",
  "",
  "## It filters as you **type**",
  "",
  "- Each key narrows the list, with no button to press.",
  "- An empty search shows everything.",
  "",
  "```js",
  "## not a heading",
  "```",
  "",
  "## How it compares",
  "",
  "| Option | Speed | Cost |",
  "|---|---|---|",
  "| Local index | 50 ms | free |",
  "| Algolia | 20 ms | $29/mo |",
  "",
  "To run it:",
  "",
  "```command cwd=\"~/Work/search\"",
  "npm run dev -- --host 100.89.29.4",
  "```",
  "",
  "```js",
  "const x = search(\"a\");",
  "```",
  "",
  "```event title=\"ECOS panel\" when=\"2026-10-29T15:40:00-05:00\" end=\"2026-10-29T17:00:00-05:00\" where=\"Teatro Panorama, Bogotá\"",
  "Bring the deck",
  "```",
  "",
  "```link label=\"Bad\"",
  "javascript:window.__pwned=3",
  "```",
  "",
  "```todos title=\"Still open\"",
  "- [ ] Send the C21 summary (today)",
  "- [x] Twilio top-up",
  "```",
  "",
  "```fields title=\"Twilio number\"",
  "Number: +1 628 296 2190",
  "Cost: **$1.15**/month",
  "```",
  "",
  "```chart type=\"bar\" title=\"Replies per day\" unit=\"$\"",
  "Mon: 1,200",
  "Tue: 18",
  "Wed: -40",
  "```",
  "",
  "```chart type=\"line\" title=\"Speed\" unit=\"ms\"",
  "| Week | Local | Algolia |",
  "|---|---|---|",
  "| W1 | 50 | 20 |",
  "| W2 | 45 | 22 |",
  "| W3 | 40 | 21 |",
  "| W4 | 38 | 19 |",
  "| W5 | 30 | 20 |",
  "```",
  "",
  "## Sources",
  "",
  "- [Search UX guide](https://www.nngroup.com/articles/search/)",
  "",
  "```goal state=\"waiting\"",
  "Ship the search page",
  "```",
].join("\n");

const OLD = "11111111-aaaa-4aaa-8aaa-000000000001";
const MID = "44444444-dddd-4ddd-8ddd-000000000004";
const NEW = "22222222-bbbb-4bbb-8bbb-000000000002";
const items = () => [
  { kind: "user", text: "Plan it", turn: true, key: `${OLD}:0`, at: "" },
  { kind: "claude", text: briefText(OLD_BRIEF), key: "b1:0", at: "" },
  { kind: "claude", text: "The plan is in.", aside: true, key: "b2:0", at: "" },
  { kind: "user", text: "Build the search page", turn: true, key: `${MID}:0`, at: "" },
  { kind: "claude", text: "On it.", key: "c2:0", at: "" },
  { kind: "tool", id: "r1", name: "Read", input: { file_path: "/x/app.js" }, key: "c3:0", at: "" },
  { kind: "result", tool: "r1", error: false, text: "", key: "c4:0", at: "" },
  { kind: "claude", text: REPLY, key: "c5:0", at: "" },
];

const failures = [];
function check(where, ok, what) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${where}: ${what}`);
  if (!ok) failures.push(`${where}: ${what}`);
}

async function mount(page, list) {
  await page.evaluate(({ list }) => {
    document.body.innerHTML = "";
    const box = document.createElement("div");
    box.style.cssText = "height:100vh;height:100dvh;display:flex;flex-direction:column;background:var(--surface)";
    document.body.append(box);
    window.__chat = new Chat({ id: "fake-reply",
      row: { id: "fake-reply", engine: "chat", status: "idle", sleeping: false, awake: true, repo: "r", name: "n", path: "/tmp" },
      onSession() {}, onScreen() {}, onGone() {} });
    box.append(window.__chat.el);
    window.__chat.conversation({ reset: true, start: 0, items: list });
  }, { list });
}

async function run(browser, base, layout) {
  console.log(`\n${layout}`);
  const ctx = await browser.newContext({ ...LAYOUTS[layout], extraHTTPHeaders: { "Tailscale-User-Login": "tester@test" } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const posts = [];
  await page.route("**/api/session/fake-reply/*", async (route) => {
    posts.push({ url: route.request().url(), body: route.request().postData() });
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(base);
  await page.waitForSelector("#look", { state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  const list = items();
  await mount(page, list);
  await page.waitForTimeout(300);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${layout}-${name}.png`), fullPage: false });

  const s = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll(".chat-conv > .msg.claude")];
    const last = msgs.at(-1);
    return {
      switch: !!document.querySelector(".view-switch, .vs-btn, .reply, .screen-stage"),
      msgs: msgs.length,
      said: msgs.map((m) => m.textContent.slice(0, 40)),
      order: (function name(box) { return [...box.children].map((x) => x.matches(".md") ? `md:${(x.firstElementChild || x).textContent.slice(0, 18)}`
        : x.matches(".artifacts") ? `block:${x.querySelector(".art").className.split(" ")[1]}` : x.matches(".choices") ? "choices"
        : x.matches(".tsec") ? [`part:${x.querySelector(".tsec-title").textContent}`, ...name(x.querySelector(".tsec-cards"))]
        : x.matches(".ufolds") ? [...x.children].map((f) => [`${f.classList.contains("open") ? "open" : "folded"}:${f.querySelector(".ufold-title").textContent}`, ...name(f.querySelector(".ufold-body"))])
        : x.className); })(last),
      folds: [...last.querySelectorAll(".ufold")].map((f) => ({ open: f.classList.contains("open"), said: f.querySelector(".ufold-head").getAttribute("aria-expanded"),
        seen: f.querySelector(".ufold-body").getBoundingClientRect().height > 0 })),
      headBold: last.querySelector(".ufold-title strong")?.textContent,
      headings: last.querySelectorAll(".md h2, .md h3").length,
      all: last.querySelector(".today-content .tsec-head .tbtn")?.textContent,
      lead: last.querySelector(".brief .brief-lead")?.textContent,
      brief: [...last.querySelectorAll(".brief .brief-rows > *")].map((x) => `${x.tagName.toLowerCase()}:${x.innerHTML.replace(/<\/?span>/g, "")}`),
      you: (() => { const dt = last.querySelector(".brief dt.you"), dd = last.querySelector(".brief dd.you"), other = last.querySelector(".brief dt:not(.you)");
        return !!dt && !!dd && getComputedStyle(dt).color !== getComputedStyle(other).color && +getComputedStyle(dd).fontWeight >= 700; })(),
      work: (() => { const w = document.querySelector(".chat-conv > .work"); return w && { head: w.querySelector(".work-head").textContent, open: w.classList.contains("open"), plain: w.classList.contains("plain"),
        said: w.querySelector(".work-body .msg.claude")?.textContent, seen: w.querySelector(".work-body").getBoundingClientRect().height > 0,
        headSeen: w.querySelector(".work-head").getBoundingClientRect().height > 0, before: !!(w.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING) }; })(),
      landed: Math.round(last.getBoundingClientRect().top - window.__chat.scroller.getBoundingClientRect().top),
      stepMarks: getComputedStyle(document.querySelector(".chat-conv .fold > .fold-head"), "::before").content,
      heads: [...last.querySelectorAll(":scope > .tsec > .tsec-head")].map((x) => `${x.querySelector(".tsec-title").textContent}:${Math.round(parseFloat(getComputedStyle(x).fontSize))}:${getComputedStyle(x).marginTop}`),
      above: (() => { const r = (q) => last.querySelector(q).getBoundingClientRect(); return r(".brief").bottom <= r(".today-actions").top && r(".today-actions").bottom <= r(".today-content").top; })(),
      text: last.textContent,
      open: [...last.querySelectorAll(".art:not(.art-link)")].map((a) => a.classList.contains("open")),
      link: (() => { const a = msgs[0].querySelector(".art-link"); return { open: a.classList.contains("open"), row: [...a.querySelectorAll(".art-head > .art-btn")].map((b) => `${b.tagName.toLowerCase()}:${b.textContent}`),
        address: !!a.querySelector(".art-pre") }; })(),
      wa: last.querySelector(".art-message .art-actions a")?.getAttribute("href"),
      pre: last.querySelector(".art-message .art-pre")?.textContent,
      gcal: last.querySelector(".art-event .art-actions a")?.getAttribute("href"),
      unsafe: [...last.querySelectorAll("a")].some((a) => /^javascript/i.test(a.getAttribute("href") || "")),
      code: [...last.querySelectorAll(".md .code code")].map((c) => c.textContent),
      table: [...last.querySelectorAll(".md table.rtable tbody tr")].map((tr) => [...tr.children].map((td) => `${td.dataset.label || ""}=${td.textContent}`).join(",")),
      todos: [...last.querySelectorAll(".art-todos li")].map((li) => `${li.className}|${li.querySelector(".t").textContent}`),
      qs: [...last.querySelectorAll(".choices .bq-opt")].map((b) => `${b.textContent}${b.disabled ? "(off)" : ""}`),
      oldQs: [...msgs[0].querySelectorAll(".choices .bq-opt")].map((b) => `${b.textContent}${b.disabled ? "(off)" : ""}`),
      old: msgs[0].textContent,
      oldLink: msgs[0].querySelector(".art-link .art-head > a")?.getAttribute("href"),
      goal: window.__chat.goal, goalShown: /Ship the search page|goal state/.test(last.textContent),
      pwned: window.__pwned,
      overflow: window.__chat.scroller.scrollWidth - window.__chat.scroller.clientWidth,
    };
  });
  check(layout, !s.switch, "one view: no Brief | Chat switch, no reply cards");
  check(layout, s.msgs === 2 && s.work && s.work.said === "On it.", `Claude's replies; what it said on the way to one is with its steps (${JSON.stringify(s.said)})`);
  check(layout, s.work && s.work.head === "Worked · 1 step" && !s.work.open && !s.work.plain && !s.work.seen && s.work.headSeen && s.work.before,
    `a turn's work is one line over its reply, folded (${JSON.stringify(s.work)})`);
  check(layout, s.landed >= 0 && s.landed <= 24, `a chat you open lands on the reply's top, its Briefing (${s.landed}px from the top)`);
  check(layout, s.stepMarks === "none", `the steps' line keeps its own look (${s.stepMarks})`);
  const order = [["part:Briefing", "brief"], ["part:Action items", "md:It reads 120 items", "block:art-message", "choices"], ["part:Content", [
    ["folded:It filters as you type", "md:Each key narrows t"],
    ["folded:How it compares", "md:OptionSpeedCostLoc", "block:art-command", "md:jsCopyconst x = se", "block:art-event", "block:art-link", "block:art-todos", "block:art-fields",
      "block:art-chart", "block:art-chart"],
    ["folded:Sources", "md:Search UX guide"]]]];
  check(layout, JSON.stringify(s.order) === JSON.stringify(order), `three parts, in Claude's order: Briefing, Action items, Content (${JSON.stringify(s.order)})`);
  check(layout, JSON.stringify(s.heads) === JSON.stringify(["Briefing:11:0px", "Action items:11:0px", "Content:11:0px"]) && s.above,
    `each part under its small head, one under the other (${JSON.stringify(s.heads)})`);
  check(layout, s.lead.startsWith("The search page works: it filters as you type, <img src=x") && JSON.stringify(s.brief) === JSON.stringify(["dt:Checked",
    "dd:Both view tests pass, <strong>phone and wide</strong>", "dt:Open", "dd:Algolia isn't wired", "dt:You", "dd:Send the draft, then <strong>say</strong> whether to ship it"]) && s.you,
    `Briefing: its opening and its rows, one card, what you need to do lit (${JSON.stringify([s.lead, s.brief])})`);
  check(layout, s.folds.length === 3 && s.folds.every((f) => !f.open && f.said === "false" && !f.seen),
    `Content: every section folded under its heading (${JSON.stringify(s.folds)})`);
  check(layout, s.headBold === "type" && s.headings === 0 && s.text.includes("## not a heading") && s.all === "Open all",
    `a heading is its section's head, not said twice; one in code stays code; Open all (${JSON.stringify([s.headBold, s.headings, s.all])})`);
  check(layout, s.text.includes("<img src=x onerror") && s.pwned === undefined && s.text.includes("120 items") && s.text.includes("Search UX guide"),
    "every word, as text: nothing runs as markup");
  check(layout, s.open.every(Boolean) && s.pre.startsWith("Hola equipo") &&
    s.wa === "https://wa.me/573001234567?text=Hola%20equipo%2C%20les%20comparto%20el%20resumen%3A%0A1.%20Piloto%20PQR%0A2.%20Datos%20por%20Excel",
    `the blocks open: the whole draft and Open in WhatsApp (${s.wa})`);
  check(layout, !s.link.open && !s.link.address && JSON.stringify(s.link.row) === JSON.stringify(["button:Copy", "a:Open"]),
    `a link is its row, folded: Copy and Open at hand (${JSON.stringify(s.link)})`);
  check(layout, /dates=20261029T204000Z\/20261029T220000Z/.test(s.gcal || "") && !s.unsafe, `an event's Add to Google Calendar; a javascript: link isn't made (${s.gcal})`);
  check(layout, JSON.stringify(s.code) === JSON.stringify(["## not a heading", "const x = search(\"a\");"]), `a code block stays code (${JSON.stringify(s.code)})`);
  check(layout, JSON.stringify(s.table) === JSON.stringify(["=Local index,Speed=50 ms,Cost=free", "=Algolia,Speed=20 ms,Cost=$29/mo"]), `a table, its cells named for the phone's cards (${JSON.stringify(s.table)})`);
  check(layout, JSON.stringify(s.todos) === JSON.stringify(["|Send the C21 summary", "done|Twilio top-up"]), `to-dos (${JSON.stringify(s.todos)})`);
  check(layout, !s.goalShown && s.goal === "Ship the search page", `the goal block isn't shown, it's the chat's (${s.goal})`);
  check(layout, JSON.stringify(s.qs) === JSON.stringify(["Ship it", "Not yet"]) && JSON.stringify(s.oldQs) === JSON.stringify(["Start(off)", "Later(off)"]),
    `the newest questions to tap, an older one's not (${JSON.stringify([s.qs, s.oldQs])})`);
  check(layout, s.old.includes("A plan for the search page") && s.old.includes("Three steps build, test, ship") && s.oldLink === "https://example.com/mock",
    "an old update_brief reply: the text it held, its link a block");
  check(layout, s.overflow <= 1, `no sideways scroll (${s.overflow}px)`);
  await page.evaluate(() => { const m = [...document.querySelectorAll(".chat-conv > .msg.claude")].at(-1); m.scrollIntoView(); });
  await shot("reply-top");
  await page.evaluate(() => { const sc = window.__chat.scroller; sc.scrollTop = sc.scrollHeight; });
  await shot("reply-end");

  // A tap on a heading opens its section, another folds it; Open all, Fold all; kept when it's drawn again.
  const tapFold = (n) => page.evaluate((n) => [...document.querySelectorAll(".chat-conv > .msg.claude")].at(-1).querySelectorAll(".ufold-head")[n].click(), n);
  const foldState = () => page.evaluate(() => { const last = [...document.querySelectorAll(".chat-conv > .msg.claude")].at(-1);
    return { open: [...last.querySelectorAll(".ufold")].map((f) => f.classList.contains("open") && f.querySelector(".ufold-body").getBoundingClientRect().height > 0),
      all: last.querySelector(".today-content .tsec-head .tbtn").textContent }; });
  await tapFold(0);
  let f = await foldState();
  check(layout, JSON.stringify(f.open) === "[true,false,false]" && f.all === "Open all", `a tap on a heading opens its section (${JSON.stringify(f)})`);
  await shot("section-open");
  await page.evaluate(() => [...document.querySelectorAll(".chat-conv > .msg.claude")].at(-1).querySelector(".today-content .tsec-head .tbtn").click());
  f = await foldState();
  check(layout, JSON.stringify(f.open) === "[true,true,true]" && f.all === "Fold all", `Open all opens every one (${JSON.stringify(f)})`);
  await page.evaluate(({ list }) => window.__chat.conversation({ reset: true, start: 0, items: list }), { list });
  f = await foldState();
  check(layout, JSON.stringify(f.open) === "[true,true,true]", `drawn again, they're as you left them (${JSON.stringify(f)})`);
  await page.evaluate(() => [...document.querySelectorAll(".chat-conv > .msg.claude")].at(-1).querySelector(".today-content .tsec-head .tbtn").click());
  f = await foldState();
  check(layout, JSON.stringify(f.open) === "[false,false,false]" && f.all === "Open all", `Fold all folds every one (${JSON.stringify(f)})`);
  await tapFold(1);
  // While it's written: as it comes, nothing folded.
  const live = await page.evaluate((t) => { const v = window.__chat.claudeView(t, "stream", true, true); return { folds: v.querySelectorAll(".ufold").length, h: v.querySelectorAll(".md h3").length, brief: !!v.querySelector(".brief") }; }, REPLY);
  check(layout, live.folds === 0 && live.h === 3 && live.brief, `while it's written, its sections come open, as headings (${JSON.stringify(live)})`);
  // Nothing to tap: no Action items. A short reply: no parts. One written an older way: as it is, its to-dos in the Briefing.
  const shapes = await page.evaluate(() => {
    const view = (t) => window.__chat.claudeView(t, "k", false);
    const heads = (v) => [...v.querySelectorAll(".tsec-title")].map((x) => x.textContent);
    const none = view("Done.\n\n```brief\nChecked: x\nYou: Nothing.\n```\n\n## One\n\nMore.");
    const short = view("Done, it works.");
    const older = view("Done.\n\n## One\n\nMore.\n\n```brief\nDone: x\nYou: Nothing.\n```\n\n```choices question=\"Q?\"\n- a\n- b\n```");
    const acts = view("Done.\n\n```brief\nChecked: x\n```\n\n```actions\n- Do **this** (today)\n- And that\n```\n\n## One\n\nMore.");
    const asks = view("Done.\n\n```brief\nChecked: x\nYou: Decide\n```\n\n```choices question=\"Q?\"\n- a\n- b\n```\n\n```link label=\"PR\"\nhttps://github.com/x/1\n```");
    return { none: [heads(none), [...none.querySelectorAll(".brief dd")].map((d) => d.className)], short: [heads(short), short.textContent],
      older: [heads(older), [...older.querySelectorAll(".brief dd")].map((d) => d.className), !!older.querySelector(".brief ~ .choices"), !!older.querySelector(".brief-lead")],
      acts: [heads(acts), [...acts.querySelectorAll(".brief dd.you .acts li")].map((li) => li.textContent)],
      asks: [heads(asks), !!asks.querySelector(".today-actions .choices"), !!asks.querySelector(".today-actions .art-link")], oneFold: none.querySelector(".today-content .tbtn").hidden };
  });
  check(layout, JSON.stringify(shapes.none) === JSON.stringify([["Briefing", "Content"], ["", "none"]]) && shapes.oneFold,
    `nothing to tap: no Action items, You: Nothing said quietly; one section, no Open all (${JSON.stringify(shapes.none)})`);
  check(layout, JSON.stringify(shapes.short) === JSON.stringify([[], "Done, it works."]), `a short reply is just its words (${JSON.stringify(shapes.short)})`);
  check(layout, JSON.stringify(shapes.older) === JSON.stringify([["Content"], ["", "none"], true, false]), `one written the older way, its brief after its sections: as it is (${JSON.stringify(shapes.older)})`);
  check(layout, JSON.stringify(shapes.acts) === JSON.stringify([["Briefing", "Content"], ["Do thistoday", "And that"]]), `an older reply's list of things to do is in its Briefing (${JSON.stringify(shapes.acts)})`);
  check(layout, JSON.stringify(shapes.asks) === JSON.stringify([["Briefing", "Action items"], true, true]), `Action items: what to tap, a decision and a link (${JSON.stringify(shapes.asks)})`);

  // Fields and charts.
  const viz = await page.evaluate(() => {
    const last = [...document.querySelectorAll(".chat-conv > .msg.claude")].at(-1);
    const [bar, line] = last.querySelectorAll(".art-chart");
    const r = (el) => el.getBoundingClientRect();
    const bars = [...bar.querySelectorAll(".chart-bar")].map((b) => Math.round(r(b).width));
    const vals = [...bar.querySelectorAll(".chart-val")];
    const outside = vals.every((v, i) => { const b = bar.querySelectorAll(".chart-bar")[i]; return i === 2 ? r(v).right <= r(b).left + 1 : r(v).left >= r(b).right - 1; });
    const inside = vals.every((v) => r(v).right <= r(bar).right + 1 && r(v).left >= r(bar).left - 1);
    return {
      fields: [...last.querySelectorAll(".art-dl dt, .art-dl dd")].map((x) => x.innerHTML),
      bars, vals: vals.map((v) => v.textContent), outside, inside, barLegend: !!bar.querySelector(".chart-legend"),
      legend: [...line.querySelectorAll(".chart-key")].map((k) => k.textContent),
      lines: line.querySelectorAll(".chart-line").length, colors: [...line.querySelectorAll(".chart-line")].map((p) => getComputedStyle(p).stroke),
      width: [...line.querySelectorAll(".chart-line")].map((p) => getComputedStyle(p).strokeWidth),
      y: [...line.querySelectorAll(".chart-y span")].map((s) => s.textContent), x: [...line.querySelectorAll(".chart-x span")].map((s) => s.textContent),
      sub: line.querySelector(".art-sub").textContent,
    };
  });
  check(layout, JSON.stringify(viz.fields) === JSON.stringify(["Number", "+1 628 296 2190", "Cost", "<strong>$1.15</strong>/month"]), `fields: label and value a row each (${JSON.stringify(viz.fields)})`);
  check(layout, viz.bars[0] > viz.bars[1] * 20 && viz.bars[2] > 0 && JSON.stringify(viz.vals) === JSON.stringify(["$1,200", "$18", "-$40"]) && viz.outside && viz.inside && !viz.barLegend,
    `bars from one baseline, each value at its tip and in the block, one series without a legend (${JSON.stringify([viz.bars, viz.vals, viz.outside, viz.inside])})`);
  check(layout, JSON.stringify(viz.legend) === JSON.stringify(["Local", "Algolia"]) && viz.lines === 2 && viz.colors[0] !== viz.colors[1] && viz.width.every((w) => w === "2px"),
    `lines: a legend, a 2px line each in its own color (${JSON.stringify([viz.legend, viz.colors, viz.width])})`);
  check(layout, JSON.stringify(viz.y) === JSON.stringify(["15", "20", "25", "30", "35", "40", "45", "50"]) || viz.y.length >= 3 && viz.y.length <= 9,
    `round ticks on the one axis (${viz.y.join(" ")})`);
  check(layout, JSON.stringify(viz.x) === JSON.stringify(["W1", "W3", "W5"]) && /ms/.test(viz.sub), `the first, middle and last labels; its unit in the line under its name (${viz.x}, ${viz.sub})`);
  // Under the pointer: the crosshair and every series there.
  const plot = await page.evaluate(() => { const el = [...document.querySelectorAll(".msg.claude")].at(-1).querySelectorAll(".chart-plot")[0];
    el.scrollIntoView({ block: "center" });
    const p = el.getBoundingClientRect();
    return { x: p.left + p.width * 0.25, y: p.top + p.height / 2 }; });
  await page.mouse.move(plot.x, plot.y);
  const tip = await page.evaluate(() => { const t = [...document.querySelectorAll(".msg.claude")].at(-1).querySelector(".chart-tip"); return t.hidden ? null : t.textContent; });
  check(layout, tip === "W245Local22Algolia", `the pointer on W2: its values, each series (${tip})`);
  await page.evaluate(() => [...document.querySelectorAll(".msg.claude")].at(-1).querySelectorAll(".chart-numbers")[1].click());
  const numbers = await page.evaluate(() => [...[...document.querySelectorAll(".msg.claude")].at(-1).querySelectorAll(".chart-table")[1].querySelectorAll("tbody tr")].map((tr) => tr.textContent));
  check(layout, numbers.length === 5 && numbers[0] === "W15020", `Numbers: the chart as a table (${numbers[0]})`);
  await page.evaluate(() => { const m = [...document.querySelectorAll(".msg.claude")].at(-1).querySelector(".art-dl"); m.scrollIntoView(); });
  await shot("charts");

  // One catalog: the app reads every block as the server does, and draws every kind.
  const samples = [REPLY, briefText(OLD_BRIEF), "```todos\n- [ ] a (today)\n- b\n- [x] c\n```\n```place address=\"Cl 72\" colour=\"x\" “a”\nnote\n```\n```chart\nMon: 12%\nTue: x\n```\n```whatsapp\nunclosed"];
  for (const t of samples) {
    const js = await page.evaluate((t) => JSON.stringify(replyBlocks(t)), t);
    const py = JSON.stringify(serverBlocks(t));
    check(layout, js === py, `the app reads the blocks as the server does${js === py ? "" : `\n    app:    ${js}\n    server: ${py}`}`);
  }
  const kinds = await page.evaluate(() => [...BLOCKS.values()].filter((b) => !b.hidden).map((b) => {
    const p = replyBlocks(`\`\`\`${b.kind} ${b.example.attrs}\n${b.example.body || "x"}\n\`\`\``)[0];
    const drawn = b.kind === "brief" ? window.__chat.briefView(p).querySelectorAll("dt").length === 4
      : b.kind === "actions" ? window.__chat.actionsView(p).querySelectorAll("li").length === 2
      : b.kind === "choices" ? !!window.__chat.choicesView({ waiting: [{ question: p.attrs.question, options: p.options }] }, "kinds")
      : p && !window.__chat.artifactParts(p).fallback;
    return `${b.kind}:${drawn ? "drawn" : "MISSING"}`;
  }));
  check(layout, kinds.length >= 15 && kinds.every((k) => k.endsWith("drawn")), `every kind in the catalog is drawn (${kinds.join(" ")})`);

  // Copy, folding a block, and answering with a tap.
  await page.evaluate(() => { window.copyText = async (t) => { window.__copied = t; }; });
  await page.evaluate(() => [...document.querySelectorAll(".msg.claude")].at(-1).querySelector(".art-command .art-head > .art-btn").click());
  await page.waitForTimeout(100);
  const copied = await page.evaluate(() => window.__copied);
  check(layout, copied === "npm run dev -- --host 100.89.29.4", `Copy copies the command (${copied})`);
  await page.evaluate(() => [...document.querySelectorAll(".msg.claude")].at(-1).querySelector(".art-message .art-toggle").click());
  const folded = await page.evaluate(() => { const a = [...document.querySelectorAll(".msg.claude")].at(-1).querySelector(".art-message");
    return { open: a.classList.contains("open"), quick: a.querySelector(".art-head > .art-btn")?.textContent }; });
  check(layout, !folded.open && folded.quick === "Copy", "a block folds to its row, its Copy at hand");
  await page.evaluate(() => document.querySelector(".chat-conv > .msg.claude .art-link .art-head > button.art-btn").click());
  await page.waitForTimeout(100);
  const linkCopied = await page.evaluate(() => window.__copied);
  await page.evaluate(() => document.querySelector(".chat-conv > .msg.claude .art-link .art-toggle").click());
  const linkOpen = await page.evaluate(() => { const a = document.querySelector(".chat-conv > .msg.claude .art-link"); return { open: a.classList.contains("open"), address: a.querySelector(".art-pre")?.textContent, more: a.querySelectorAll(".art-actions .art-btn").length }; });
  check(layout, linkCopied === "https://example.com/mock" && linkOpen.open && linkOpen.address === "https://example.com/mock" && linkOpen.more === 0,
    `a link's Copy copies its address; a tap on its row shows it, no more buttons under it (${JSON.stringify([linkCopied, linkOpen])})`);
  await page.evaluate(() => document.querySelector(".chat-conv > .msg.claude").scrollIntoView());
  await shot("link");
  const before = posts.filter((p) => p.url.endsWith("/send")).length;
  await page.evaluate(() => [...document.querySelectorAll(".msg.claude")].at(-1).querySelector(".choices .bq-opt").click());
  await page.waitForTimeout(300);
  const sent = posts.filter((p) => p.url.endsWith("/send")).slice(before)[0];
  check(layout, !!sent && sent.body === JSON.stringify({ text: "Ship it: merge to main and push" }), `a tap sends the option's message (${sent && sent.body})`);
  // Your answer comes in: the question's past.
  await page.evaluate(() => window.__chat.conversation({ items: [{ kind: "user", text: "Ship it: merge to main and push", turn: true, key: "33333333-cccc-4ccc-8ccc-000000000003:0", at: "" }] }));
  const past = await page.evaluate(() => { const c = [...document.querySelectorAll(".msg.claude")].at(-1).querySelector(".choices");
    return { past: c.classList.contains("past"), off: [...c.querySelectorAll(".bq-opt")].every((b) => b.disabled), chosen: c.querySelector(".bq-opt.chosen")?.textContent }; });
  check(layout, past.past && past.off && past.chosen === "Ship it", `answered, the question stays as it was, your pick lit (${JSON.stringify(past)})`);

  // A turn's work: a tap shows it; while Claude works it's all there as it comes, and one line once it's done.
  await page.evaluate(() => document.querySelector(".chat-conv > .work .work-head").click());
  const shown = await page.evaluate(() => { const w = document.querySelector(".chat-conv > .work"); return w.classList.contains("open") && w.querySelector(".work-body .msg.claude").getBoundingClientRect().height > 0; });
  check(layout, shown, "a tap on a turn's work shows what Claude did and said on the way");
  const turn = await page.evaluate(() => {
    const c = window.__chat, at = "";
    c.live = { state: "working", partial: "" };
    c.conversation({ items: [{ kind: "user", text: "And now?", turn: true, key: "55555555-eeee-4eee-8eee-000000000005:0", at },
      { kind: "claude", text: "Checking the index.", key: "d1:0", at }, { kind: "tool", id: "r2", name: "Read", input: { file_path: "/x/a.js" }, key: "d2:0", at },
      { kind: "result", tool: "r2", error: false, text: "", key: "d3:0", at }, { kind: "claude", text: "Now the tests.", key: "d4:0", at },
      { kind: "tool", id: "r3", name: "Bash", input: { command: "npm test", description: "Run the tests" }, key: "d5:0", at }] });
    const w = [...document.querySelectorAll(".chat-conv > .work")].at(-1);
    const see = () => ({ live: w.classList.contains("live"), head: w.querySelector(".work-head").getBoundingClientRect().height > 0,
      said: [...w.querySelectorAll(".work-body .msg.claude")].map((m) => `${m.textContent}:${m.getBoundingClientRect().height > 0}`), steps: w.querySelectorAll(".step").length });
    const during = see();
    c.conversation({ items: [{ kind: "result", tool: "r3", error: false, text: "", key: "d6:0", at }, { kind: "claude", text: "All **green**.", key: "d7:0", at }] });
    c.live = { state: "idle", partial: "" };
    c.renderTail();
    const lastMsg = c.tail.previousElementSibling;
    return { during, after: see(), headText: w.querySelector(".work-head").textContent, reply: lastMsg.matches(".msg.claude") && lastMsg.textContent, inWork: !!lastMsg.closest(".work") };
  });
  check(layout, turn.during.live && !turn.during.head && JSON.stringify(turn.during.said) === JSON.stringify(["Checking the index.:true", "Now the tests.:true"]) && turn.during.steps === 2,
    `while Claude works, what it does and says is all there, as it comes (${JSON.stringify(turn.during)})`);
  check(layout, !turn.after.live && turn.after.head && turn.after.said.every((x) => x.endsWith(":false")) && turn.headText === "Worked · 2 steps" && turn.reply === "All green." && !turn.inWork,
    `once it's done, its work is one line and its reply is what you see (${JSON.stringify([turn.after, turn.headText, turn.reply])})`);
  await page.evaluate(() => { const sc = window.__chat.scroller; sc.scrollTop = sc.scrollHeight; });
  await shot("work");

  // Settings: no Replies choice any more.
  await page.evaluate(() => openSettings());
  await page.waitForSelector(".sheet-back.settings");
  const settings = await page.evaluate(() => [...document.querySelectorAll(".sheet-back.settings .section")].map((x) => x.textContent));
  check(layout, !settings.includes("Replies") && !settings.includes("Show replies as"), `Settings: no Brief | Chat (${settings.join(", ")})`);
  await page.evaluate(() => closeSheets());
  check(layout, errors.length === 0, `no page errors (${errors.join("; ") || "none"})`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "reply-view-home-"));
  const server = await startServer(port, home);
  const base = `http://127.0.0.1:${port}/`;
  const browser = await pw.chromium.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
  try {
    for (const layout of Object.keys(LAYOUTS)) {
      if (ONLY && ONLY !== layout) continue;
      await run(browser, base, layout);
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\nscreenshots: ${SHOTS}`);
  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nall checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
