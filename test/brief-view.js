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
    answer: card ? [...card.querySelectorAll(".reply-summary .answer-list > li > span:first-child")].map((x) => x.textContent) : [],
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
    `titles: Original message, an old-style brief, the new (${JSON.stringify(s.titles)})`);
  const goal = await page.evaluate(() => window.__chat.goal);
  check(layout, s.pwned === undefined && /waiting/.test(s.cls) && s.goal === undefined && goal === "Ship the search page",
    `where it stands; the goal isn't on the card, it's the chat's (${goal}); nothing runs as markup`);
  check(layout, JSON.stringify(s.blocks) === JSON.stringify(["Needs you"]) && s.questions === 2 &&
    JSON.stringify(s.answer) === JSON.stringify(["The page filters as you type", "Empty query shows all 120 items"]),
    `the summary right under the title, no label, then what needs you (${JSON.stringify(s.blocks)})`);
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

  // An answer's detail, on a tap.
  await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelector(".answer-more").click());
  const detail = await page.evaluate(() => { const d = [...document.querySelectorAll(".reply")].at(-1).querySelector(".answer-detail"); return !d.hidden && d.textContent; });
  check(layout, detail === "Debounced at 200 ms", "a point's detail opens on a tap");

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
    return { open: r.classList.contains("open"), answer: r.querySelector(".reply-summary .reply-said")?.textContent.trim() }; });
  check(layout, old.open && old.answer === "Hi there. What should we build today?", `an older reply opens on a tap, Claude's words its summary (${JSON.stringify(old)})`);
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
      brief: { title: "Shipped to main", status: "done", kind: "task", answer: [{ point: "Merged and pushed" }] } }] });
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
  await shot("done");
  await page.evaluate(() => [...document.querySelectorAll(".reply")].at(-1).querySelector(".rsec-more .rsec-head").click());
  const all = await page.evaluate(() => [...[...document.querySelectorAll(".reply")].at(-1).querySelectorAll(".rsec-label")].map((x) => x.textContent));
  check(layout, JSON.stringify(all) === JSON.stringify(["Less", "Changes", "Activity", "Original message"]), `More brings them up (${JSON.stringify(all)})`);

  // The conversation view has no replies; back again.
  await page.evaluate(() => window.__chat.showMode("chat"));
  const chat = await page.evaluate(() => ({ replies: document.querySelectorAll(".reply").length, users: document.querySelectorAll(".msg.user").length }));
  check(layout, chat.replies === 0 && chat.users === 4, `the Chat view: the conversation (${JSON.stringify(chat)})`);
  await page.evaluate(() => window.__chat.showMode("screen"));
  s = await read(page);
  check(layout, s.replies === 4 && s.titles[3] === "Shipped to main", "back to the brief view");

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

  // On the phone, the chat's goal is under its name in the header.
  if (layout === "phone") {
    const head = await page.evaluate(({ items }) => {
      window.EventSource = class { constructor() {} addEventListener() {} close() {} };
      app.session = new SessionView("fake-brief");
      app.session.row = { id: "fake-brief", task: "Search page", status: "idle", repo: "r", name: "n", engine: "chat" };
      app.session.chat.conversation({ reset: true, start: 0, items });
      const t = app.session.titleEl;
      return { task: t.querySelector(".task")?.textContent, line: t.querySelector(".status-line")?.textContent, goal: !!t.querySelector(".status-line.goal") };
    }, { items: ITEMS });
    check(layout, head.goal && head.line === "Ship the search page", `the goal under the chat's name in the header (${JSON.stringify(head)})`);
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
