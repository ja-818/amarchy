// The brief view, in a browser: the chat's default view. Each turn is your
// message and Claude's reply as one card: its title folds and opens it, and
// its sections (Needs you, Answer, Plan, Changes, Checks, Activity, Notes,
// Original message) each fold to a line saying what they hold. Checked: the
// sections and their summaries, what's built from the record (files and
// their +/−, commits, test runs, the activity with the looking around
// grouped), the questions answered with taps, the live card while Claude
// works, older replies as their title, an old-style brief and a turn from
// before the brief, only http(s) links, nothing running as markup, a
// reconnect that moves nothing, and the Brief / Chat switch. On a phone and
// on a wide screen, with screenshots.
//
//   node test/brief-view.js            both layouts
//   node test/brief-view.js phone      one layout (phone | wide)
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
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "brief-view-"));
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

const TOOL = "mcp__amarchy__update_brief";
const BRIEF = {
  title: "Search page works: 2 choices for <img src=x onerror=\"window.__pwned = 1\">", status: "waiting", kind: "change",
  goal: "Ship the search page",
  answer: [{ point: "The page filters as you type", detail: "Debounced at 200 ms" }, { point: "Empty query shows all 120 items" }],
  plan: [{ step: "Build the page", state: "done" }, { step: "Ship to main", state: "doing" }, { step: "Add filters", state: "next" }],
  waiting: [
    { question: "Ship it to main?", options: [{ label: "Ship it", send: "Ship it: merge to main and push" }, { label: "Not yet", send: "Don't ship yet" }] },
    { question: "Add filters?", options: [{ label: "Yes", send: "Yes, add filters" }, { label: "No", send: "No filters" }, { label: "Other", send: "Filters: ", draft: true }] },
  ],
  tests: [{ name: "Search tests", result: "pass", detail: "42 passed" }, { name: "Lint", result: "fail" }],
  check: [{ label: "Open the page", url: "http://amarchy:5173/search" }, { label: "Bad", url: "javascript:window.__pwned=2" }],
  notes: ["Lint fails on an old file"],
  sources: [{ label: "Search UX guide", url: "https://www.nngroup.com/articles/search/" }, { url: "https://developer.mozilla.org/en-US/docs/Web/API" },
            { label: "Bad", url: "javascript:alert(1)" }],
  artifacts: [
    { type: "message", channel: "whatsapp", to: "C21 group", phone: "+57 300 123 4567", title: "WhatsApp to the C21 group",
      body: "Hola equipo, les comparto el resumen:\n1. Piloto PQR\n2. Datos por Excel" },
    { type: "link", title: "Sign in to Gmail", url: "https://accounts.google.com/x?y=1", note: "Expires in 10 minutes" },
    { type: "link", title: "Bad", url: "javascript:window.__pwned=3" },
    { type: "command", title: "Log in the ringer", command: "ringer login --account houston", where: "~/Work/jaken" },
    { type: "event", title: "ECOS panel", when: "2026-10-29T15:40:00-05:00", end: "2026-10-29T17:00:00-05:00", where: "Teatro Panorama, Bogotá" },
    { type: "todos", title: "Loops", items: [{ text: "Send the C21 summary", due: "today" }, { text: "Twilio top-up", done: true }] },
    { type: "contact", name: "Gaby Mendez", role: "Quantística", phone: "+57 310 555 0101", email: "gaby@example.com" },
    { type: "session", name: "houston-os-c21-crm", title: "C21 Kanban CRM" },
  ],
};
const FACTS = { branch: "search-page", base: "origin/main", commits: 3, recent: ["Search page"], files: 4, added: 120, removed: 8, uncommitted: 2, merged: false };
const OLD = "11111111-aaaa-4aaa-8aaa-000000000001";
const MID = "44444444-dddd-4ddd-8ddd-000000000004";
const NEW = "22222222-bbbb-4bbb-8bbb-000000000002";
const ITEMS = [
  { kind: "user", text: "Hello", turn: true, key: `${OLD}:0`, at: "" },
  { kind: "claude", text: "Hi there. **What** should we build today?", key: "c1:0", at: "" },
  { kind: "user", text: "Plan it", turn: true, key: `${MID}:0`, at: "" },
  { kind: "claude", text: "Here's a plan.", key: "m1:0", at: "" },
  { kind: "tool", id: "m2", name: TOOL, summary: "Updated the brief", key: "m2:0", at: "",
    brief: { headline: "A plan for the search page", status: "done", changed: ["Plan written"], next: ["Build it"] } },
  { kind: "user", text: "Build the search page", turn: true, key: `${NEW}:0`, at: "2026-10-23T10:00:00Z" },
  { kind: "claude", text: "On it.", key: "c2:0", at: "2026-10-23T10:00:05Z" },
  { kind: "tool", id: "r1", name: "Read", input: { file_path: "/x/app.js" }, key: "c3:0", at: "" },
  { kind: "tool", id: "r2", name: "Read", input: { file_path: "/x/list.js" }, key: "c4:0", at: "" },
  { kind: "tool", id: "g1", name: "Grep", input: { pattern: "search" }, key: "c5:0", at: "" },
  { kind: "result", tool: "r1", error: false, text: "", key: "c5a:0", at: "" },
  { kind: "result", tool: "r2", error: false, text: "", key: "c5b:0", at: "" },
  { kind: "result", tool: "g1", error: false, text: "", key: "c5c:0", at: "" },
  { kind: "tool", id: "e1", name: "Edit", input: { file_path: "/x/search.js", old_string: "a\nb", new_string: "a\nc\nd" }, key: "c6:0", at: "" },
  { kind: "result", tool: "e1", error: false, text: "ok", key: "c7:0", at: "" },
  { kind: "tool", id: "b1", name: "Bash", input: { command: "node test/search.js", description: "Run the search tests" }, key: "c8:0", at: "" },
  { kind: "result", tool: "b1", error: false, text: "42 passed", key: "c9:0", at: "" },
  { kind: "tool", id: "b2", name: "Bash", input: { command: "git add -A && git commit -q -m \"Add search page\"", description: "Commit" }, key: "c10:0", at: "" },
  { kind: "result", tool: "b2", error: false, text: "", key: "c11:0", at: "" },
  { kind: "user", text: "<task-notification><tool-use-id>x</tool-use-id><status>completed</status><summary>Background build finished</summary></task-notification>", key: "c12:0", at: "" },
  { kind: "claude", text: "Done. The page runs at http://amarchy:5173/search.", key: "c13:0", at: "2026-10-23T10:04:10Z" },
  { kind: "tool", id: "t2", name: TOOL, summary: "Updated the brief", brief: BRIEF, key: "c14:0", at: "" },
  { kind: "claude", text: "The brief is updated.", aside: true, key: "c15:0", at: "" },
];

const failures = [];
function check(where, ok, what) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${where}: ${what}`);
  if (!ok) failures.push(`${where}: ${what}`);
}

async function mount(page) {
  await page.evaluate(({ items, facts }) => {
    document.body.innerHTML = "";
    const box = document.createElement("div");
    box.style.cssText = "height:100vh;height:100dvh;display:flex;flex-direction:column;background:var(--surface)";
    document.body.append(box);
    store.set("chatView", null);
    window.__chat = new Chat({ id: "fake-brief",
      row: { id: "fake-brief", engine: "chat", status: "idle", sleeping: false, awake: true, repo: "r", name: "n", path: "/tmp" },
      onSession() {}, onScreen() {}, onGone() {} });
    box.append(window.__chat.el);
    window.__chat.conversation({ reset: true, start: 0, items });
    window.__chat.facts = facts;
    window.__chat.drawBrief();
  }, { items: ITEMS, facts: FACTS });
}

const read = (page) => page.evaluate(() => {
  const replies = [...document.querySelectorAll(".reply")], card = replies.at(-1);
  const sec = (name) => card && card.querySelector(`.rsec-${name}`);
  const sum = (name) => sec(name)?.querySelector(".rsec-sum")?.textContent;
  return {
    mode: window.__chat.mode, replies: replies.length,
    open: replies.map((r) => r.classList.contains("open")),
    titles: replies.map((r) => r.querySelector(".reply-title")?.textContent),
    cls: card?.className, goal: card?.querySelector(".reply-goal")?.textContent,
    sections: card ? [...card.querySelectorAll(".rsec-label")].map((x) => x.textContent) : [],
    openSecs: card ? [...card.querySelectorAll(".rsec.open .rsec-label")].map((x) => x.textContent) : [],
    sums: { plan: sum("plan"), changes: sum("changes"), checks: sum("checks"), activity: sum("activity"), notes: sum("notes"), words: sum("words") },
    answer: card ? [...card.querySelectorAll(".reply-summary .answer-list .pt-text")].map((x) => x.textContent) : [],
    blocks: card ? [...card.querySelectorAll(":scope > .reply-summary > .reply-k, :scope > .reply-needs > .reply-k")].map((x) => x.textContent) : [],
    more: card?.querySelector(".rsec-more .rsec-sum")?.textContent,
    questions: card ? card.querySelectorAll(".reply-needs .bq").length : 0,
    files: card ? [...card.querySelectorAll(".change-files li")].map((li) => li.querySelector(".change-path").textContent + " " + li.querySelector(".change-n").textContent) : [],
    git: card ? [...card.querySelectorAll(".brief-list.git li")].map((x) => x.textContent) : [],
    facts: card ? [...card.querySelectorAll(".fact")].map((f) => f.textContent) : [],
    tests: card ? [...card.querySelectorAll(".brief-list.tests li")].map((li) => li.className).join(",") : "",
    links: card ? [...card.querySelectorAll(".brief-link")].map((x) => x.getAttribute("href")) : [],
    activity: card ? [...card.querySelectorAll(".activity > li")].map((li) => `${li.className}|${(li.querySelector(".act-title, .act-quote") || {}).textContent}`) : [],
    words: sec("words")?.querySelector(".turn-work-body")?.textContent || "",
    badge: card?.querySelector(".reply-badge")?.textContent || null,
    pwned: window.__pwned,
    overflow: window.__chat.stage.scrollWidth - window.__chat.stage.clientWidth,
  };
});
const openSec = (page, name) => page.evaluate((n) => [...document.querySelectorAll(".reply")].at(-1).querySelector(`.rsec-${n} .rsec-head`).click(), name);

async function run(browser, base, layout) {
  console.log(`\n${layout}`);
  const ctx = await browser.newContext({ ...LAYOUTS[layout], extraHTTPHeaders: { "Tailscale-User-Login": "tester@test" } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const posts = [];
  await page.route("**/api/session/fake-brief/*", async (route) => {
    posts.push({ url: route.request().url(), body: route.request().postData() });
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(base);
  await page.waitForSelector("#look", { state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  await mount(page);
  await page.waitForTimeout(300);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${layout}-${name}.png`) });

  let s = await read(page);
  check(layout, s.mode === "screen" && s.replies === 3, `each turn is a reply card (${s.replies})`);
  check(layout, JSON.stringify(s.open) === "[false,false,true]", `the newest open, the ones before as their title (${JSON.stringify(s.open)})`);
  check(layout, s.titles[0] === "Hi there. What should we build today?" && s.titles[1] === "A plan for the search page" && s.titles[2].startsWith("Search page works: 2 choices for <img"),
    `titles: Claude's message, an old-style brief, the new (${JSON.stringify(s.titles)})`);
  const goal = await page.evaluate(() => window.__chat.goal);
  check(layout, s.pwned === undefined && /waiting/.test(s.cls) && s.goal === undefined && goal === "Ship the search page",
    `where it stands; the goal isn't on the card, it's the chat's (${goal}); nothing runs as markup`);
  check(layout, JSON.stringify(s.blocks) === JSON.stringify(["Summary", "Needs you"]) && s.questions === 2 &&
    JSON.stringify(s.answer) === JSON.stringify(["The page filters as you type", "Empty query shows all 120 items"]),
    `the summary right under the title, then what needs you (${JSON.stringify(s.blocks)})`);
  // For you: what the reply made to use, right after the summary, each a row with its quick action.
  await page.evaluate(() => { window.copyText = async (t) => { window.__copied = t; }; });
  const arts = await page.evaluate(() => {
    const r = [...document.querySelectorAll(".reply")].at(-1);
    return { order: [...r.children].map((x) => x.className.split(" ")[0]).slice(1, 5),
      rows: [...r.querySelectorAll(".art")].map((x) => `${x.className.split(" ")[1]}|${x.querySelector(".art-title").textContent}|${x.querySelector(".art-head > .art-btn")?.textContent || ""}`),
      linkHref: r.querySelector(".art-link .art-head > a")?.getAttribute("href"),
      sessionHref: r.querySelector(".art-session .art-head > a")?.getAttribute("href"),
      unsafe: [...r.querySelectorAll(".art a")].some((a) => /^javascript/i.test(a.getAttribute("href") || "")) };
  });
  check(layout, JSON.stringify(arts.order) === JSON.stringify(["reply-summary", "reply-artifacts", "reply-sources", "reply-needs"]),
    `For you after the summary, then Sources, then Needs you (${JSON.stringify(arts.order)})`);
  check(layout, JSON.stringify(arts.rows) === JSON.stringify(["art-message|WhatsApp to the C21 group|Copy", "art-link|Sign in to Gmail|Open", "art-link|Bad|",
    "art-command|Log in the ringer|Copy", "art-event|ECOS panel|", "art-todos|Loops|", "art-contact|Gaby Mendez|", "art-session|C21 Kanban CRM|Open"]),
    `each artifact a row, its quick action at hand (${JSON.stringify(arts.rows)})`);
  check(layout, arts.linkHref === "https://accounts.google.com/x?y=1" && arts.sessionHref === "#/s/houston-os-c21-crm" && !arts.unsafe,
    "links open, a chat opens in the app, a javascript: link isn't made");
  await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelector(".art-message .art-head > .art-btn").click());
  await page.waitForTimeout(100);
  const copied = await page.evaluate(() => ({ text: window.__copied, label: [...document.querySelectorAll(".reply")].at(-1).querySelector(".art-message .art-head > .art-btn").textContent }));
  check(layout, copied.text === "Hola equipo, les comparto el resumen:\n1. Piloto PQR\n2. Datos por Excel" && copied.label === "Copied", "Copy copies the whole draft, folded");
  await page.evaluate(() => { const r = [...document.querySelectorAll(".reply")].at(-1); r.querySelector(".art-message .art-toggle").click(); });
  await page.evaluate(() => { const r = [...document.querySelectorAll(".reply")].at(-1); r.querySelector(".art-event .art-toggle").click(); });
  const opened = await page.evaluate(() => {
    const r = [...document.querySelectorAll(".reply")].at(-1);
    return { pre: r.querySelector(".art-message .art-pre")?.textContent, wa: r.querySelector(".art-message .art-actions a")?.getAttribute("href"),
      gcal: [...r.querySelectorAll(".art-event .art-actions a")].map((a) => a.getAttribute("href")) };
  });
  check(layout, opened.pre.startsWith("Hola equipo") && opened.wa === "https://wa.me/573001234567?text=Hola%20equipo%2C%20les%20comparto%20el%20resumen%3A%0A1.%20Piloto%20PQR%0A2.%20Datos%20por%20Excel",
    `the draft open: all of it, and Open in WhatsApp filled in (${opened.wa})`);
  check(layout, /dates=20261029T204000Z\/20261029T220000Z/.test(opened.gcal[0] || "") && /maps\/search/.test(opened.gcal[1] || ""), `an event: Add to Google Calendar at the right time, a map (${opened.gcal[0]})`);
  await page.evaluate(() => { const sc = window.__chat.scroller; sc.scrollTop = 0; [...document.querySelectorAll(".reply")].at(-1).scrollIntoView(); });
  await shot("artifacts");
  await page.evaluate(() => { const r = [...document.querySelectorAll(".reply")].at(-1); r.querySelector(".art-message .art-toggle").click(); r.querySelector(".art-event .art-toggle").click(); });
  check(layout, JSON.stringify(s.sections) === JSON.stringify(["More"]) && s.more === "1 test failing · Plan · Changes · Checks · Activity · Notes · Original message",
    `the rest waits under More, which says what's there and flags a failing test (${s.more})`);
  await openSec(page, "more");
  s = await read(page);
  check(layout, JSON.stringify(s.sections) === JSON.stringify(["Less", "Plan", "Changes", "Checks", "Activity", "Notes", "Original message"]) &&
    JSON.stringify(s.openSecs) === JSON.stringify(["Checks"]), `More opens them, Checks open as a test fails (${JSON.stringify(s.sections)})`);
  check(layout, s.sums.plan === "1 of 3 done · next: Ship to main" && s.sums.changes === "1 file +2 −1 · 1 commit" &&
    /^6 steps · 4 min$/.test(s.sums.activity) &&
    s.sums.notes === "1 · Lint fails on an old file" && s.sums.words === "2 messages · 6 steps",
    `each folded section says what it holds (${JSON.stringify(s.sums)})`);
  check(layout, s.overflow <= 1, `no sideways scroll (${s.overflow}px)`);
  await shot("reply");

  // What's built from the record.
  await openSec(page, "changes");
  await openSec(page, "activity");
  await openSec(page, "words");
  s = await read(page);
  check(layout, JSON.stringify(s.files) === JSON.stringify(["search.js +2 −1"]) && JSON.stringify(s.git) === JSON.stringify(["Committed “Add search page”"]),
    `changes: the file and its +/−, the commit (${JSON.stringify(s.files)} ${JSON.stringify(s.git)})`);
  check(layout, JSON.stringify(s.facts) === JSON.stringify(["search-page", "3 commits", "4 files +120 −8", "2 uncommitted", "not in main yet"]), "git now, on the newest");
  check(layout, s.tests === "is-pass,is-fail" && JSON.stringify(s.links) === JSON.stringify(["http://amarchy:5173/search"]), "checks: tests, the http(s) link only");
  check(layout, JSON.stringify(s.activity) === JSON.stringify([
    "act act-said|On it.", "act act-fold|Read 2 files, edited search.js, ran 2 commands and searched once",
    "act act-event|Done in the background: Background build finished", "act act-said|Done. The page runs at http://amarchy:5173/search."]),
    `activity: in order, each run of steps one row in the chat's words (${JSON.stringify(s.activity)})`);
  const fold = await page.evaluate(() => { const li = [...document.querySelectorAll(".reply")].at(-1).querySelector(".act-fold");
    const chips = [...li.querySelectorAll(".act-chips .chip")].map((c) => c.textContent);
    li.querySelector(".act-row").click();
    const steps = [...li.querySelectorAll(".act-step")].map((x) => x.querySelector(".act-step-what").textContent + (x.querySelector(".act-cmd") ? ` [${x.querySelector(".act-cmd").textContent}]` : ""));
    return { chips, open: li.classList.contains("open"), steps }; });
  check(layout, JSON.stringify(fold.chips) === JSON.stringify(["6 steps", "+2−1"]) && fold.open &&
    JSON.stringify(fold.steps) === JSON.stringify(["Read app.js", "Read list.js", "Searched the code for “search”", "Edited search.js+2−1",
      "Run the search tests [node test/search.js]", "Commit [git add -A && git commit -q -m \"Add search page\"]"]),
    `the row opens to its steps: commands, an edit's +/− (${JSON.stringify(fold)})`);
  check(layout, s.words.includes("On it.") && !s.words.includes("The brief is updated."), "Original message: the turn as the conversation shows it, without what it said again");
  await page.evaluate(() => { const sc = window.__chat.scroller; sc.scrollTop = sc.scrollHeight; });
  await shot("sections");
  await openSec(page, "activity");
  await openSec(page, "changes");
  await openSec(page, "checks");
  s = await read(page);
  check(layout, s.sums.checks === "1 failing of 2 · 2 ways to try it", `folded, Checks says what it holds (${s.sums.checks})`);
  await openSec(page, "words");

  // A point's why, on a tap: the point is a row that opens it.
  await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelector(".answer-toggle").click());
  const detail = await page.evaluate(() => { const li = [...document.querySelectorAll(".reply")].at(-1).querySelector(".answer-list li.has-detail");
    return { open: li.classList.contains("open"), why: !li.querySelector(".answer-detail").hidden && li.querySelector(".answer-detail").textContent,
             plain: [...document.querySelectorAll(".reply")].at(-1).querySelectorAll(".answer-list li:not(.has-detail) .answer-toggle").length }; });
  check(layout, detail.open && detail.why === "Debounced at 200 ms" && detail.plain === 0, `a point with its why opens on a tap; one without stays a plain point (${JSON.stringify(detail)})`);
  // Sources: a row, folded, that opens to every link (only http(s)).
  const src = await page.evaluate(() => { const r = [...document.querySelectorAll(".reply")].at(-1), row = r.querySelector(".reply-sources");
    const sum = row.querySelector(".sources-sum").textContent; row.querySelector(".sources-head").click();
    const links = [...[...document.querySelectorAll(".reply")].at(-1).querySelectorAll(".sources-list a")].map((a) => `${a.textContent}|${a.getAttribute("href")}`);
    return { sum, links, order: [...r.children].map((x) => x.className.split(" ")[0]).includes("reply-sources") }; });
  check(layout, src.sum === "2 · nngroup.com, developer.mozilla.org" &&
    JSON.stringify(src.links) === JSON.stringify(["Search UX guide|https://www.nngroup.com/articles/search/", "developer.mozilla.org|https://developer.mozilla.org/en-US/docs/Web/API"]),
    `sources: a folded row, every http(s) link in it (${JSON.stringify(src)})`);
  await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelector(".sources-head").click());

  // Answers: the first marks its question; the last sends both, once.
  await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelectorAll(".bq")[0].querySelector(".bq-opt").click());
  const half = await page.evaluate(() => { const b = [...document.querySelectorAll(".reply")].at(-1);
    return { answered: b.querySelectorAll(".bq.answered").length, status: b.querySelector(".bq-status").textContent }; });
  check(layout, half.answered === 1 && half.status === "1 of 2 answered" && !posts.some((p) => p.url.endsWith("/send")), `an answer marks its question (${JSON.stringify(half)})`);
  await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelectorAll(".bq")[1].querySelectorAll(".bq-opt")[2].click());
  const draft = await page.evaluate(() => window.__chat.input.value);
  check(layout, draft === "Filters: ", `a draft option fills the box (${JSON.stringify(draft)})`);
  await page.evaluate(() => { window.__chat.input.value = ""; window.__chat.typed(); });
  await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelectorAll(".bq")[1].querySelectorAll(".bq-opt")[1].click());
  await page.waitForTimeout(300);
  const sent = posts.filter((p) => p.url.endsWith("/send"));
  check(layout, sent.length === 1 && sent[0].body === JSON.stringify({ text: "Ship it: merge to main and push\n\nNo filters" }), "the answers go to Claude together, once");

  // Folding the whole reply: its title, and a mark that it needs you.
  await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelector(".reply-head").click());
  s = await read(page);
  check(layout, s.open[2] === false && s.badge === "Needs you" && s.sections.length === 0, "a folded reply is its title, marked when it needs you");
  await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelector(".reply-head").click());
  // An older reply opens on a tap: a turn from before the brief, Original message as its answer.
  await page.evaluate(() => document.querySelector(".reply .reply-head").click());
  const old = await page.evaluate(() => { const r = document.querySelector(".reply");
    return { open: r.classList.contains("open"), title: r.querySelector(".reply-title").textContent, body: r.querySelector(".reply-body")?.textContent.trim() || "" }; });
  check(layout, old.open && old.title === "Hi there. What should we build today?" && old.body === "", `an older reply opens on a tap: Claude's message, laid out (${JSON.stringify(old)})`);
  await page.evaluate(() => document.querySelector(".reply .reply-head").click());

  // A reconnect with the same conversation: nothing drawn again.
  await page.evaluate(({ items }) => { window.__card = [...document.querySelectorAll(".reply")].at(-1);
    window.__chat.conversation({ reset: true, start: 0, items: [...items] }); }, { items: ITEMS });
  const same = await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1) === window.__card);
  check(layout, same, "a reconnect moves nothing");

  // A new turn: a live card while Claude works (its activity filling in), then its reply; the one before folds.
  await page.evaluate(() => {
    const c = window.__chat;
    c.row = { ...c.row, status: "working" };
    c.live = { state: "working", activity: { tool: "Bash", input: { description: "Merging" } }, pending: [] };
    c.conversation({ items: [{ kind: "user", text: "Ship it", turn: true, key: "33333333-cccc-4ccc-8ccc-000000000003:0", at: "" },
      { kind: "tool", id: "s1", name: "Bash", input: { command: "git merge x && git push", description: "Merge and push" }, key: "s1:0", at: "" }] });
    c.renderTail();
  });
  s = await read(page);
  const liveNow = await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelector(".reply-now")?.textContent);
  check(layout, s.replies === 4 && /working/.test(s.cls) && s.titles[3].startsWith("Working…") && /Merging/.test(liveNow || "") &&
    s.openSecs.includes("Activity"), `while it works: a live card, its activity open (${s.titles[3]})`);
  // The live reply says what it's doing: the line under the turns doesn't too, even before the next live update.
  await page.evaluate(() => { const c = window.__chat; c.stageWork.hidden = false;
    c.conversation({ items: [] }); });
  const stale = await page.evaluate(() => window.__chat.stageWork.hidden);
  check(layout, stale, "with a live reply, no second working line (synced as the reply is drawn)");
  const nowRow = await page.evaluate(() => { const r = [...document.querySelectorAll(".reply")].at(-1), f = r.querySelector(".act-fold.going");
    return { going: f && f.querySelector(".act-title").textContent, spin: !!(f && f.querySelector(".act-node .spinner")), nowHidden: r.querySelector(".act-now").hidden }; });
  check(layout, nowRow.going === "Merge and push…" && nowRow.spin && nowRow.nowHidden, `while a step runs, its row says so, spinning (${JSON.stringify(nowRow)})`);
  await page.evaluate(() => { const c = window.__chat; c.live = { ...c.live, partial: "Merged.\nNow I'm pushing the branch to origin" }; c.renderTail(); });
  const writing = await page.evaluate(() => { const n = [...document.querySelectorAll(".reply")].at(-1).querySelector(".act-now"); return !n.hidden && n.querySelector(".act-title").textContent; });
  check(layout, writing === "Writing: “Now I'm pushing the branch to origin”", `the line Claude is writing, live, at the end (${writing})`);
  await shot("live");
  await page.evaluate(({ TOOL }) => {
    const c = window.__chat;
    c.conversation({ items: [{ kind: "tool", id: "t9", name: TOOL, summary: "Updated the brief", key: "c20:0", at: "",
      brief: { title: "Shipped to main", status: "done", kind: "task", answer: [{ point: "Merged and pushed" }],
        explanation: "Merging takes the branch's **3 commits** into main.\n\n- `git merge` joins them\n- `git push` sends main to GitHub" } }] });
    c.row = { ...c.row, status: "idle" }; c.live = { state: "idle", pending: [] }; c.renderTail();
  }, { TOOL });
  s = await read(page);
  check(layout, JSON.stringify(s.open) === "[false,false,false,true]" && s.titles[3] === "Shipped to main" && /Changes/.test(s.more || ""),
    `then its reply, the one before folded (${JSON.stringify(s.open)} · ${s.more})`);
  const lean = await page.evaluate(() => { const r = [...document.querySelectorAll(".reply")].at(-1);
    return { labels: [...r.querySelectorAll(".rsec-label")].map((x) => x.textContent), more: r.querySelector(".rsec-more .rsec-sum")?.textContent,
             dots: document.querySelectorAll(".reply-dot").length }; });
  check(layout, JSON.stringify(lean.labels) === JSON.stringify(["More"]) && lean.more === "Changes · Activity · Original message" && lean.dots === 0,
    `a short reply: its summary, the rest under More; no dot before the title (${JSON.stringify(lean)})`);
  const explain = await page.evaluate(() => { const r = [...document.querySelectorAll(".reply")].at(-1), e = r.querySelector(".reply-explain");
    const kids = [...r.children].map((x) => x.className.split(" ")[0]);
    return { label: e?.querySelector(".reply-k")?.textContent, bold: e?.querySelector("strong")?.textContent, items: e ? e.querySelectorAll("li").length : 0,
             order: kids.slice(1, 3).join(",") }; });
  check(layout, explain.label === "Explanation" && explain.bold === "3 commits" && explain.items === 2 && explain.order === "reply-summary,reply-explain",
    `an explanation shows in full, after the summary (${JSON.stringify(explain)})`);
  await shot("done");

  // Helpers Claude left running in the background: one line over the box (idle or not), opening to name each.
  await page.evaluate(() => {
    const c = window.__chat, now = Date.now() / 1000;
    c.live = { state: "idle", pending: [], tasks: [
      { task_id: "a1", task_type: "local_agent", description: "A: pipelines apart from agents", started: now - 720 },
      { task_id: "a2", task_type: "local_agent", description: "B: Houston brand look", started: now - 300 },
      { task_id: "a3", task_type: "local_agent", description: "C: WhatsApp token", started: now - 60 },
      { task_id: "b1", task_type: "local_bash", description: "npm run dev", started: now - 30 }] };
    c.renderDock();
  });
  const bg = await page.evaluate(() => { const el = document.querySelector(".chat-dock .bg-strip");
    return { shown: !!el && !el.hidden && el.offsetHeight > 0, what: `${el?.querySelector(".bg-what")?.textContent} · ${el?.querySelector(".bg-head > .bg-took")?.textContent}`, dots: el?.querySelectorAll(".bg-pulse i").length,
             first: el?.nextElementSibling ? true : false }; });
  check(layout, bg.shown && bg.what === "3 helpers and 1 command in the background · 12 min" && bg.dots === 4,
    `background helpers: a line over the box (${JSON.stringify(bg)})`);
  await page.click(".bg-head");
  const bgRows = await page.evaluate(() => [...document.querySelectorAll(".bg-task")].map((x) => `${x.querySelector(".bg-name").textContent}|${x.querySelector(".bg-took").textContent}`));
  check(layout, bgRows.length === 4 && bgRows[0] === "A: pipelines apart from agents|12 min" && bgRows[3] === "npm run dev|30 s",
    `opened, it names each and for how long (${JSON.stringify(bgRows)})`);
  await shot("background");
  await page.evaluate(() => { const c = window.__chat; c.live = { ...c.live, tasks: [] }; c.renderDock(); });
  check(layout, await page.evaluate(() => document.querySelector(".bg-strip").hidden), "and gone once they finish");

  // A question's turn: the answer card. The short answer, the verdicts, the
  // takeaways, the explanation folded by topic.
  await page.evaluate(({ TOOL }) => {
    window.__chat.conversation({ items: [{ kind: "user", text: "Are peptides good or bad?", turn: true, key: "55555555-eeee-4eee-8eee-000000000005:0", at: "" },
      { kind: "claude", text: "It depends on the kind.", key: "q1:0", at: "" },
      { kind: "tool", id: "q2", name: TOOL, key: "q2:0", at: "", brief: { title: "Peptides: it depends on the kind", status: "done", kind: "answer",
        short: "Prescribed ones are **fine**; online injectables are risky.",
        verdicts: [{ option: "Prescription", rating: "good", reason: "Tested, dosed by a doctor" },
          { option: "Online injectables", rating: "bad", reason: "Unregulated, often impure" },
          { option: "Collagen powders", rating: "caution", reason: "Small benefit" }],
        explanation: "Peptides are short chains of amino acids.\n\n## Side effects\nNausea with GLP-1 drugs.\n\n## Contamination\nOnline products are often impure.",
        tables: [{ title: "Beelink models", columns: ["Model", "Chip", "RAM", "Verdict"], pick: 0, note: "Prices move often",
          rows: [["SER8", "Ryzen 7 8845HS", "**upgradeable** to 64 GB", "Best fit"], ["SER9 Pro", "Ryzen 7 H255", "24 GB soldered", "Too little RAM"],
                 ["GTR9 Pro", "Ryzen AI Max+ 395", "128 GB", "Overkill"]] }],
        answer: [{ point: "Ask a doctor before any injectable" }] } }] });
  }, { TOOL });
  const ans = await page.evaluate(() => {
    const r = [...document.querySelectorAll(".reply")].at(-1);
    return { order: [...r.children].map((x) => x.className.split(" ")[0]),
      short: r.querySelector(".reply-short")?.textContent, bold: r.querySelector(".reply-short strong")?.textContent,
      verdicts: [...r.querySelectorAll(".verdict")].map((v) => `${v.className.replace("verdict ", "")}|${v.querySelector(".verdict-badge").textContent}|${v.querySelector(".verdict-option").textContent}`),
      keys: [...r.querySelectorAll(".reply-k")].map((x) => x.textContent),
      intro: r.querySelector(".reply-explain > .explain-body")?.textContent.trim(),
      topics: [...r.querySelectorAll(".topic")].map((x) => `${x.querySelector(".topic-title").textContent}|${x.classList.contains("open")}`) };
  });
  const tbl = await page.evaluate(() => {
    const t = [...document.querySelectorAll(".reply")].at(-1).querySelector(".reply-table");
    return { title: t?.querySelector(".reply-k")?.textContent, cols: [...t.querySelectorAll("th")].map((x) => x.textContent),
      rows: t.querySelectorAll("tbody tr").length, pick: t.querySelector("tr.pick td.lead")?.textContent, bold: t.querySelector("td strong")?.textContent,
      label: t.querySelector("tbody td[data-label]")?.getAttribute("data-label"), head: getComputedStyle(t.querySelector("thead")).display,
      note: t.querySelector(".rtable-note")?.textContent };
  });
  check(layout, tbl.title === "Beelink models" && JSON.stringify(tbl.cols) === JSON.stringify(["Model", "Chip", "RAM", "Verdict"]) && tbl.rows === 3 &&
    tbl.pick === "PickSER8" && tbl.bold === "upgradeable" && tbl.label === "Chip" && tbl.note === "Prices move often",
    `a comparison table, open, its pick marked (${JSON.stringify(tbl)})`);
  check(layout, layout === "phone" ? tbl.head === "none" : tbl.head === "table-header-group", `a real table wide, a card per row on a phone (${tbl.head})`);
  check(layout, JSON.stringify(ans.order) === JSON.stringify(["reply-head", "reply-short", "verdicts", "reply-table", "reply-summary", "reply-explain", "rsec"]),
    `the answer card, in order: short answer, verdicts, takeaways, explanation, More (${JSON.stringify(ans.order)})`);
  check(layout, ans.short === "Prescribed ones are fine; online injectables are risky." && ans.bold === "fine", "the short answer, its markdown drawn");
  check(layout, JSON.stringify(ans.verdicts) === JSON.stringify(["is-good|Good|Prescription", "is-bad|Avoid|Online injectables", "is-caution|Careful|Collagen powders"]),
    `the verdicts, a row each with its badge (${JSON.stringify(ans.verdicts)})`);
  check(layout, JSON.stringify(ans.keys) === JSON.stringify(["Beelink models", "Takeaways", "Explanation"]) && ans.intro === "Peptides are short chains of amino acids." &&
    JSON.stringify(ans.topics) === JSON.stringify(["Side effects|false", "Contamination|false"]), `takeaways; the explanation's intro, its topics folded (${JSON.stringify(ans.topics)})`);
  await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelector(".topic-head").click());
  const topic = await page.evaluate(() => { const x = [...document.querySelectorAll(".reply")].at(-1).querySelector(".topic");
    return { open: x.classList.contains("open"), body: x.querySelector(".topic-body")?.textContent.trim() }; });
  check(layout, topic.open && topic.body === "Nausea with GLP-1 drugs.", `a topic opens on a tap (${JSON.stringify(topic)})`);
  await page.evaluate(() => { const sc = window.__chat.scroller; sc.scrollTop = sc.scrollHeight; });
  await shot("answer");

  // A reply in amarchy's format (no update_brief): Claude's own message is the
  // card. Its first line the title; its text; its table as cards on a phone;
  // its blocks as things to use, choices as buttons; its sections folding.
  const REPLY = [
    "The demo moved to Friday: here's the message for Felipe.",
    "",
    "Felipe asked for a later slot, so **Friday 5pm** works for everyone.",
    "",
    "| Option | Day | Works for |",
    "|---|---|---|",
    "| A | Friday 5pm | everyone |",
    "| B | Monday 9am | not Felipe |",
    "",
    "```whatsapp to=\"Felipe\" phone=\"+57 300 111 2233\"",
    "Hola Felipe, la demo pasa al viernes a las 5pm.",
    "```",
    "",
    "```todos title=\"Still open\"",
    "- [ ] Send Felipe the message (today)",
    "- [x] Book the room",
    "```",
    "",
    "## Details",
    "The room is booked from 4:30.",
    "",
    "## Reminder",
    "```event title=\"Decide\" when=\"2026-10-30T10:00:00-05:00\"",
    "Pick one.",
    "```",
    "",
    "## Sources",
    "- [Calendar](https://calendar.google.com/)",
    "",
    "```choices question=\"Send it now?\"",
    "- Send it | Send Felipe the WhatsApp now",
    "- Not yet",
    "```",
  ].join("\n");
  await page.evaluate(({ REPLY }) => {
    window.__chat.conversation({ items: [{ kind: "user", text: "Move the demo", turn: true, key: "66666666-ffff-4fff-8fff-000000000006:0", at: "" },
      { kind: "claude", text: REPLY, key: "f1:0", at: "" }] });
  }, { REPLY });
  const fmt = await page.evaluate(() => {
    const r = [...document.querySelectorAll(".reply")].at(-1);
    return { title: r.querySelector(".reply-title")?.textContent, bold: r.querySelector(".reply-body strong")?.textContent,
      table: r.querySelector(".reply-body table.rtable") ? [...r.querySelectorAll(".reply-body tbody td[data-label]")].map((x) => x.dataset.label).slice(0, 2) : null,
      arts: [...r.querySelectorAll(".reply-artifacts .art")].map((x) => `${x.className.split(" ")[1]}|${x.querySelector(".art-title").textContent}`),
      forYouFirst: [...r.children].map((x) => x.className.split(" ")[0]).indexOf("reply-artifacts") < [...r.children].map((x) => x.className.split(" ")[0]).indexOf("topics"),
      secs: [...r.querySelectorAll(".reply-sec")].map((x) => `${x.querySelector(".topic-title").textContent}|${x.classList.contains("open")}`),
      choices: [...r.querySelectorAll(".reply-needs .bq-opt")].map((x) => x.textContent),
      needsLabel: r.querySelector(".reply-needs .reply-k")?.textContent, needsCount: r.querySelectorAll(".reply-needs").length,
      needsBeforeSecs: [...r.children].map((x) => x.className.split(" ")[0]).indexOf("reply-needs") < [...r.children].map((x) => x.className.split(" ")[0]).indexOf("topics"),
      edge: r.classList.contains("st-waiting"),
      more: r.querySelector(".rsec-more .rsec-sum")?.textContent };
  });
  check(layout, fmt.title === "The demo moved to Friday: here's the message for Felipe." && fmt.bold === "Friday 5pm", `the reply's first line is the title, its text the body (${fmt.title})`);
  check(layout, JSON.stringify(fmt.table) === JSON.stringify(["Day", "Works for"]), `its table, cards per row on a phone (${JSON.stringify(fmt.table)})`);
  check(layout, JSON.stringify(fmt.arts) === JSON.stringify(["art-message|WhatsApp draft", "art-todos|Still open", "art-event|Decide"]) && fmt.forYouFirst,
    `its blocks as things to use, under For you, before the sections (${JSON.stringify(fmt.arts)})`);
  check(layout, JSON.stringify(fmt.secs) === JSON.stringify(["Details|true", "Sources|false"]), `its sections: open, Sources folded (${JSON.stringify(fmt.secs)})`);
  check(layout, JSON.stringify(fmt.choices) === JSON.stringify(["Send it", "Not yet"]) && fmt.needsLabel === "Needs you" && fmt.needsCount === 1 && fmt.needsBeforeSecs && fmt.edge,
    `its choices: the Needs you form, once, above the sections, the card edged as waiting (${JSON.stringify([fmt.needsLabel, fmt.needsCount, fmt.needsBeforeSecs, fmt.edge])})`);
  check(layout, /Transcript/.test(fmt.more || ""), `the transcript under More (${fmt.more})`);
  const badge = await page.evaluate(() => { const r = [...document.querySelectorAll(".reply")].at(-1); r.querySelector(".reply-head").click();
    const b = [...document.querySelectorAll(".reply")].at(-1).querySelector(".reply-badge")?.textContent; [...document.querySelectorAll(".reply")].at(-1).querySelector(".reply-head").click(); return b; });
  check(layout, badge === "Needs you", "folded, it says it needs you");
  await page.evaluate(() => { window.copyText = async (t) => { window.__copied = t; }; [...document.querySelectorAll(".reply")].at(-1).querySelector(".art-message .art-head > .art-btn").click(); });
  await page.waitForTimeout(100);
  check(layout, (await page.evaluate(() => window.__copied)) === "Hola Felipe, la demo pasa al viernes a las 5pm.", "its draft copies whole");
  const before = posts.filter((p) => p.url.endsWith("/send")).length;
  await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelector(".reply-needs .bq-opt").click());
  await page.waitForTimeout(300);
  const lastSend = posts.filter((p) => p.url.endsWith("/send")).slice(before)[0];
  check(layout, !!lastSend && lastSend.body === JSON.stringify({ text: "Send Felipe the WhatsApp now" }), `a choice sends its message (${lastSend && lastSend.body})`);
  await page.evaluate(() => { const sc = window.__chat.scroller; [...document.querySelectorAll(".reply")].at(-1).scrollIntoView(); });
  await shot("format");

  // A long reply: its sections start folded, each saying what's in it; a long
  // opening shows a few lines, the rest a tap away.
  const rows = Array.from({ length: 8 }, (_, i) => `| ${i + 1} | Slide ${i + 1} | ${"what this slide says in some detail ".repeat(3)}|`);
  const LONG = [
    "The deck and the email are drafted; nothing was sent.",
    "",
    ...Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1} of the opening, long enough to need clipping on a phone screen when it all adds up.`),
    "",
    "## What each slide says", "| # | Slide | Content |", "|---|---|---|", ...rows,
    "", "## Notes", "- one", "- two", "- three", "- four", "- five",
    "", "## The email", "```email to=\"ana@example.com\" subject=\"Deck\"", "Hola Ana, adjunto la presentación.", "```",
    "", "```choices question=\"Send it?\"", "- Send it | Send the email to Ana", "- Not yet", "```",
  ].join("\n");
  await page.evaluate(({ LONG }) => {
    window.__chat.conversation({ items: [{ kind: "user", text: "Make the deck", turn: true, key: "77777777-aaaa-4aaa-8aaa-000000000007:0", at: "" },
      { kind: "claude", text: LONG, key: "g1:0", at: "" }] });
  }, { LONG });
  const lng = await page.evaluate(() => {
    const r = [...document.querySelectorAll(".reply")].at(-1);
    return { secs: [...r.querySelectorAll(".reply-sec")].map((x) => `${x.querySelector(".topic-title").textContent}|${x.classList.contains("open")}|${x.querySelector(".topic-hint")?.textContent || ""}`),
      arts: [...r.querySelectorAll(".reply-artifacts .art-title")].map((x) => x.textContent), needs: r.querySelectorAll(".reply-needs .bq-opt").length,
      clipped: r.querySelector(".reply-body.clipped") !== null, more: r.querySelector(".reply-opening .reply-all")?.textContent };
  });
  check(layout, JSON.stringify(lng.secs) === JSON.stringify(["What each slide says|false|Table · 8 rows", "Notes|false|5 points"]),
    `a long reply's sections start folded, each saying what's in it (${JSON.stringify(lng.secs)})`);
  check(layout, JSON.stringify(lng.arts) === JSON.stringify(["Email draft"]) && lng.needs === 2, "its draft under For you, its question under Needs you, at first sight");
  check(layout, lng.clipped && lng.more === "Show all", `a long opening shows a few lines, Show all for the rest (${JSON.stringify([lng.clipped, lng.more])})`);
  await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelector(".reply-opening .reply-all").click());
  const shown = await page.evaluate(() => { const r = [...document.querySelectorAll(".reply")].at(-1); return [r.querySelector(".reply-body.clipped") === null, r.querySelector(".reply-opening .reply-all").textContent]; });
  check(layout, shown[0] && shown[1] === "Show less", `Show all opens the rest (${JSON.stringify(shown)})`);
  await page.evaluate(() => { [...document.querySelectorAll(".reply")].at(-1).querySelector(".reply-opening .reply-all").click(); [...document.querySelectorAll(".reply")].at(-1).scrollIntoView(); });
  await shot("long");
  await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelector(".rsec-more .rsec-head").click());
  const all = await page.evaluate(() => [...[...document.querySelectorAll(".reply")].at(-1).querySelectorAll(".rsec-label")].map((x) => x.textContent));
  check(layout, JSON.stringify(all) === JSON.stringify(["Less", "Changes", "Activity", "Transcript"]), `More brings them up (on the newest, a reply in the format: its transcript) (${JSON.stringify(all)})`);

  // The conversation view has no replies; back again.
  await page.evaluate(() => window.__chat.showMode("chat"));
  const chat = await page.evaluate(() => ({ replies: document.querySelectorAll(".reply").length, users: document.querySelectorAll(".msg.user").length }));
  check(layout, chat.replies === 0 && chat.users === 7, `the Chat view: the conversation (${JSON.stringify(chat)})`);
  await page.evaluate(() => window.__chat.showMode("screen"));
  s = await read(page);
  check(layout, s.replies === 7 && s.titles[3] === "Shipped to main" && s.titles[4] === "Peptides: it depends on the kind" &&
    s.titles[5] === "The demo moved to Friday: here's the message for Felipe." && s.titles[6] === "The deck and the email are drafted; nothing was sent.", "back to the brief view");

  // The keys, as on the board: Esc out of the box onto the latest, k / j
  // through the messages, l into one (a folded reply opens), h out, Enter
  // folds it, G the latest, i the box, Tab Brief | Chat.
  const keys = [];
  const where = () => page.evaluate(() => {
    const a = document.activeElement, items = window.__chat.navItems();
    const at = items.findIndex((it) => it === a || it.contains(a));
    return { at, n: items.length, on: a === items[at] ? "item" : a === window.__chat.input ? "box" : at >= 0 ? "inside" : a.tagName,
             kind: at >= 0 ? items[at].className.split(" ")[0] : "", mode: window.__chat.mode };
  });
  await page.evaluate(() => { window.__navKeys = (e) => window.__chat.navKey(e); window.addEventListener("keydown", window.__navKeys, true); window.__chat.input.focus(); });
  for (const k of ["Escape", "k", "k", "l", "h", "j", "G", "i"]) { await page.keyboard.press(k); keys.push([k, await where()]); }
  const last = keys[0][1].n - 1;
  const ok = keys[0][1].on === "item" && keys[0][1].at === last && keys[1][1].at === last - 1 && keys[2][1].at === last - 2 && keys[2][1].kind === "turn-reply"
    && keys[3][1].on === "inside" && keys[3][1].at === last - 2 && keys[4][1].on === "item" && keys[4][1].at === last - 2
    && (keys[5][1].at === last - 1 || keys[5][1].at === last - 2 /* a tall one: j reads down it first */) && keys[6][1].at === last && keys[7][1].on === "box";
  check(layout, ok, `the keys: Esc out of the box, k / j, l into a reply, h out, G, i (${JSON.stringify(keys.map(([k, w]) => `${k}:${w.at}/${w.on}`))})`);
  await page.keyboard.press("Escape");
  const wasOpen = await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).classList.contains("open"));
  await page.keyboard.press("Enter");
  const nowOpen = await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).classList.contains("open"));
  const stays = await where();
  check(layout, wasOpen !== nowOpen && stays.on === "item" && stays.at === last, `Enter folds or opens the reply, the keys on it (${wasOpen} → ${nowOpen})`);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  const tabbed = await where();
  await page.keyboard.press("Tab");
  const back = await where();
  check(layout, tabbed.mode === "chat" && tabbed.on === "item" && back.mode === "screen" && back.on === "item" && back.at === back.n - 1,
    `Tab: Brief | Chat, the keys on a message in each (${JSON.stringify([tabbed, back])})`);
  // A button in a reply pressed (a section opened): the reply's drawn again,
  // the keys stay on that button, not lost.
  const pressed = await page.evaluate(() => {
    const items = window.__chat.navItems(), item = items[items.length - 1];
    const head = item.querySelector(".rsec-head");
    window.__chat.navTo(head);
    return !!head;
  });
  await page.keyboard.press("Enter");
  const kept = await page.evaluate(() => { const a = document.activeElement; const items = window.__chat.navItems(); return items[items.length - 1].contains(a) && a.matches(".rsec-head"); });
  check(layout, pressed && kept, "Enter on a reply's section: it opens, the keys stay on it");
  // A reply taller than the page: j reads down through it, then goes on; k reads back up.
  const tall = await page.evaluate(() => {
    const c = window.__chat, items = c.navItems(), item = items[items.length - 2 >= 0 ? items.length - 1 : 0];
    item.style.minHeight = `${c.scroller.clientHeight * 2}px`;
    c.navTo(item, true);
    return { top: Math.round(c.scroller.scrollTop) };
  });
  await page.keyboard.press("j");
  const paged = await page.evaluate(() => ({ top: Math.round(window.__chat.scroller.scrollTop), on: document.activeElement === window.__chat.navItems().at(-1) }));
  await page.keyboard.press("k");
  const pagedUp = await page.evaluate(() => ({ top: Math.round(window.__chat.scroller.scrollTop), on: document.activeElement === window.__chat.navItems().at(-1) }));
  await page.evaluate(() => { window.__chat.navItems().at(-1).style.minHeight = ""; });
  const upTo = await page.evaluate(() => document.activeElement === window.__chat.navItems().at(-2));
  check(layout, paged.top > tall.top && paged.on && upTo,
    `a tall reply: j reads down through it, the keys on it; k straight to the one before (${JSON.stringify([tall, paged, pagedUp, upTo])})`);
  // Going up and down moves the messages only: the box you type in stays at
  // the bottom, nothing around the list scrolls (Safari scrolled the page).
  const dockAt = await page.evaluate(() => Math.round(window.__chat.dock.getBoundingClientRect().bottom));
  for (const k of ["G", "k", "k", "k", "k", "j", "k", "k"]) await page.keyboard.press(k);
  const still = await page.evaluate(() => {
    let el = window.__chat.scroller.parentElement, moved = [];
    for (; el; el = el.parentElement) if (el.scrollTop) moved.push(el.className || el.tagName);
    return { dock: Math.round(window.__chat.dock.getBoundingClientRect().bottom), moved, y: scrollY };
  });
  check(layout, still.dock === dockAt && !still.moved.length && still.y === 0, `k and j move the messages only, the box stays put (${JSON.stringify([dockAt, still])})`);
  const lit = await page.evaluate(() => { const a = document.activeElement, r = a.querySelector(":scope > .reply"), b = a.querySelector(".msg.user .bubble");
    return a.matches(":focus-visible") && (r ? getComputedStyle(r).boxShadow !== "none" : b ? getComputedStyle(b).boxShadow !== "none" : getComputedStyle(a).outlineStyle !== "none"); });
  check(layout, lit, "the message the keys are on is lit");
  await shot("keys");
  // The browser's focus off the messages (a click on nothing, a button of
  // the bar Safari doesn't focus, the window left and back): the message
  // stays lit, and j / k go on from it, not from the latest.
  const sel = () => page.evaluate(() => { const items = window.__chat.navItems(), l = document.querySelector(".chat .nav-sel"); return l ? items.indexOf(l) : -1; });
  await page.evaluate(() => { const items = window.__chat.navItems(); window.__chat.navTo(items[Math.max(0, items.length - 3)]); });
  const from = await sel();
  const ways = {
    "nothing": () => page.evaluate(() => document.activeElement.blur()),
    "the window back": () => page.evaluate(() => { document.activeElement.blur(); window.dispatchEvent(new Event("focus")); }),
    "a click on its text": () => page.evaluate(() => { document.activeElement.blur(); const it = window.__chat.navItems().at(-3); it.dispatchEvent(new MouseEvent("click", { bubbles: true })); }),
  };
  const moved = {};
  for (const [name, go] of Object.entries(ways)) {
    await page.evaluate((n) => { const items = window.__chat.navItems(); window.__chat.navTo(items[n]); }, from);
    await go();
    const before = await sel();
    const shown = await page.evaluate(() => { const l = document.querySelector(".chat .nav-sel"), r = l && l.querySelector(":scope > .reply"), b = l && l.querySelector(".msg.user .bubble");
      return !!l && (r ? getComputedStyle(r).boxShadow !== "none" : b ? getComputedStyle(b).boxShadow !== "none" : getComputedStyle(l).outlineStyle !== "none"); });
    await page.keyboard.press("k");
    const up = await sel();
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press("j");
    moved[name] = [before, shown, up, await sel()];
  }
  check(layout, from >= 1 && Object.values(moved).every(([b, sh, u, d]) => b === from && sh && u === from - 1 && d === from),
        `focus off the messages any way: the message stays lit, k / j go on from it (${JSON.stringify({ from, moved })})`);
  // Writing: nothing lit; written, the latest again.
  await page.evaluate(() => window.__chat.input.focus());
  const unlit = await page.evaluate(() => { const l = document.querySelector(".chat .nav-sel"), r = l && (l.querySelector(":scope > .reply") || l);
    return !l || (getComputedStyle(r).boxShadow === "none" && getComputedStyle(r).outlineStyle === "none") || !r.matches(".keyed .chat:not(.writing) *"); });
  await page.keyboard.press("Escape");
  const after = await sel();
  check(layout, unlit && after === (await page.evaluate(() => window.__chat.navItems().length)) - 1, `writing: no message lit; Esc, the latest (${JSON.stringify([unlit, after])})`);
  await page.evaluate(() => window.removeEventListener("keydown", window.__navKeys, true));

  // A reply that asks and lists in its prose, not in blocks (a persona's own
  // style): its question still gets buttons, its open list a to-do list, its link a button.
  const PROSE = [
    "Touch point with Felipe: Houston becomes a platform for implementers.",
    "",
    "The new price is **$250 a month**. The plan is at [the plan](https://example.com/plan).",
    "",
    "This changes the brief for `houston-os-iteration`. Shall Jaken pass it the pivot and the Friday demo? (yes)",
    "",
    "====",
    "Still open:",
    "- **Anthropic:** finish today",
    "- Rotate the Meta token",
  ].join("\n");
  await page.evaluate(({ PROSE }) => {
    window.__chat.conversation({ items: [{ kind: "user", text: "Felipe call", turn: true, key: "88888888-aaaa-4aaa-8aaa-000000000008:0", at: "" },
      { kind: "claude", text: PROSE, key: "h1:0", at: "" }] });
  }, { PROSE });
  const prose = await page.evaluate(() => {
    const r = [...document.querySelectorAll(".reply")].at(-1);
    return { q: r.querySelector(".reply-needs .bq-q")?.textContent, opts: [...r.querySelectorAll(".reply-needs .bq-opt")].map((x) => x.textContent),
      arts: [...r.querySelectorAll(".reply-artifacts .art-title")].map((x) => x.textContent), body: r.querySelector(".reply-body")?.textContent || "" };
  });
  check(layout, prose.q === "Shall Jaken pass it the pivot and the Friday demo?" && JSON.stringify(prose.opts) === JSON.stringify(["Yes", "No", "Answer"]),
    `a question in the prose gets buttons (${JSON.stringify([prose.q, prose.opts])})`);
  check(layout, JSON.stringify(prose.arts) === JSON.stringify(["Still open", "the plan"]) && !/Rotate the Meta|====/.test(prose.body) && /\$250/.test(prose.body),
    `its open list a to-do list (out of the text), its link a button (${JSON.stringify(prose.arts)})`);
  const before2 = posts.filter((p) => p.url.endsWith("/send")).length;
  await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelector(".reply-needs .bq-opt").click());
  await page.waitForTimeout(300);
  const yes = posts.filter((p) => p.url.endsWith("/send")).slice(before2)[0];
  check(layout, !!yes && yes.body === JSON.stringify({ text: "Yes" }), `Yes sends "Yes" (${yes && yes.body})`);

  // On the phone the choice is in Settings: Replies, Brief | Chat.
  await page.evaluate(() => openSettings());
  await page.waitForSelector(".sheet-back.settings .seg");
  const settings = await page.evaluate(() => {
    const sh = document.querySelector(".sheet-back.settings");
    const sec = [...sh.querySelectorAll(".section")].find((x) => x.textContent === "Replies");
    return sec ? [...sec.nextElementSibling.querySelectorAll("button")].map((x) => x.textContent).join() : "";
  });
  check(layout, settings === "Brief,Chat", `Settings: Replies, Brief | Chat (${settings})`);
  await page.evaluate(() => closeSheets());

  // On the phone, the chat's head is its name and where it stands: its goal isn't a second line under it.
  if (layout === "phone") {
    const head = await page.evaluate(({ items }) => {
      window.EventSource = class { constructor() {} addEventListener() {} close() {} };
      app.session = new SessionView("fake-brief");
      app.session.row = { id: "fake-brief", task: "Search page", status: "idle", repo: "r", name: "n", engine: "chat" };
      app.session.chat.conversation({ reset: true, start: 0, items });
      const t = app.session.titleEl;
      app.session.renderHeader();
      return { task: t.querySelector(".task")?.textContent, goal: !!t.querySelector(".head-goal"), pill: !!t.querySelector(".head-state .tpill") };
    }, { items: ITEMS });
    check(layout, /Search/.test(head.task || "") && !head.goal && head.pill, `the chat's head: its name and its pill, no second line (${JSON.stringify(head)})`);
  }
  check(layout, errors.length === 0, `no page errors (${errors.join("; ") || "none"})`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "brief-view-home-"));
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
