// The brief view, in a browser: the chat's default view. The brief over the
// timeline: where the chat stands and its goal on one line that opens to the
// rest (what changed, tests, how to check it, what's next, heads-ups, git's
// facts), what waits on you always there and answered with taps; the
// timeline oldest first, each turn your message, its headline and Claude's
// work in a fold. Also: only http(s) links, nothing running as markup, the
// brief updating live, a reconnect that moves nothing, and the Brief / Chat
// switch (in Settings on the phone). On a phone and on a wide screen, with
// screenshots.
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
  goal: "Ship the <img src=x onerror=\"window.__pwned = 1\"> search page",
  status: "waiting", headline: "Search page works: 2 choices for you",
  changed: ["Search page added", "Filters as you type"],
  tests: [{ name: "Search tests", result: "pass", detail: "42 passed" }, { name: "Lint", result: "fail" }],
  check: [{ label: "Open the page", url: "http://amarchy:5173/search" }, { label: "Bad", url: "javascript:window.__pwned=2" }, { label: "On the phone", how: "tap **Search**" }],
  waiting: [
    { question: "Ship it to main?", options: [{ label: "Ship it", send: "Ship it: merge to main and push" }, { label: "Not yet", send: "Don't ship yet" }] },
    { question: "Add filters?", options: [{ label: "Yes", send: "Yes, add filters" }, { label: "No", send: "No filters" }, { label: "Other", send: "Filters: ", draft: true }] },
  ],
  next: ["Ship after your answer"], notes: ["Lint fails on an old file"],
};
const FACTS = { branch: "search-page", base: "origin/main", commits: 3, recent: ["Search page"], files: 4, added: 120, removed: 8, uncommitted: 2, merged: false };
const OLD = "11111111-aaaa-4aaa-8aaa-000000000001";
const NEW = "22222222-bbbb-4bbb-8bbb-000000000002";
const ITEMS = [
  { kind: "user", text: "Hello", turn: true, key: `${OLD}:0`, at: "" },
  { kind: "claude", text: "Hi there. What should we build today?", key: "c1:0", at: "" },
  { kind: "user", text: "Build the search page", turn: true, key: `${NEW}:0`, at: "" },
  { kind: "claude", text: "On it.", key: "c2:0", at: "" },
  { kind: "tool", id: "t1", name: "Edit", input: { file_path: "/x/search.js" }, summary: "Edited search.js", key: "c3:0", at: "" },
  { kind: "result", tool: "t1", error: false, text: "ok", key: "c4:0", at: "" },
  { kind: "claude", text: "Done. The page runs at http://amarchy:5173/search.", key: "c5:0", at: "" },
  { kind: "tool", id: "t2", name: TOOL, summary: "Updated the brief", brief: BRIEF, key: "c6:0", at: "" },
  { kind: "claude", text: "The brief is updated.", aside: true, key: "c6b:0", at: "" },
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
  const c = window.__chat, card = document.querySelector(".brief-card.latest"), turns = [...document.querySelectorAll(".turn")];
  const sec = (t) => card && [...card.querySelectorAll(".brief-section")].find((x) => x.querySelector("h4").textContent === t);
  return {
    mode: c.mode, pinned: document.querySelectorAll(".chat > .brief").length,
    inLast: !!(card && turns.at(-1).contains(card)), open: !!(card && card.classList.contains("open")),
    state: card?.querySelector(".brief-state")?.textContent, headline: card?.querySelector(".brief-headline")?.textContent,
    goal: card?.querySelector(".brief-goal")?.textContent, toggle: card?.querySelector(".brief-toggle")?.textContent,
    questions: card ? card.querySelectorAll(".bq").length : 0,
    changed: sec("What changed")?.querySelectorAll("li").length || 0,
    tests: sec("Tests") ? [...sec("Tests").querySelectorAll("li")].map((li) => li.className).join(",") : "",
    links: card ? [...card.querySelectorAll(".brief-link")].map((x) => x.getAttribute("href")) : [],
    how: card ? [...card.querySelectorAll(".brief-how")].map((x) => x.textContent).join(" | ") : "",
    next: !!sec("Next"), notes: !!sec("Heads up"),
    facts: card ? [...card.querySelectorAll(".fact")].map((f) => f.textContent) : [],
    cards: document.querySelectorAll(".brief-card").length, lines: [...document.querySelectorAll(".turn-headline .text")].map((x) => x.textContent),
    turns: turns.length, firstSaid: turns[0]?.querySelector(".turn-you")?.textContent.trim(),
    oldText: turns[0]?.querySelector(".reply-text")?.textContent.trim(),
    work: turns.at(-1)?.querySelector(".turn-work > summary")?.textContent,
    pwned: window.__pwned,
    overflow: c.stage.scrollWidth - c.stage.clientWidth,
  };
});

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
  check(layout, s.mode === "screen" && s.pinned === 0 && s.inLast, "the brief is a message: in the last turn, nothing pinned over the chat");
  check(layout, s.state === "Waiting on you" && s.headline === "Search page works: 2 choices for you" && s.goal.startsWith("Goal Ship the <img"),
    `the card: where it stands, this turn's headline, the goal, as text (${s.state} · ${s.headline})`);
  check(layout, s.pwned === undefined, "nothing in the brief runs as markup");
  check(layout, !s.open && s.questions === 2, "its details closed, what waits on you there");
  check(layout, s.toggle === "Show details2 changes · 1 test failing · next steps", `the details' row says what they hold (${s.toggle})`);
  check(layout, s.turns === 2 && s.firstSaid === "Hello" && s.oldText === "Hi there. What should we build today?", "the timeline, oldest first; a turn from before the brief shows Claude's words");
  check(layout, /1 step/.test(s.work || ""), `the brief's own call isn't a step in Claude's work (${s.work})`);
  const aside = await page.evaluate(() => document.body.textContent.includes("The brief is updated."));
  check(layout, !aside, "what Claude says again after the brief isn't shown");
  check(layout, s.overflow <= 1, `no sideways scroll (${s.overflow}px)`);
  await shot("closed");

  // The details' row opens them: sections, git's facts, links; again, closes.
  await page.evaluate(() => document.querySelector(".brief-card.latest .brief-toggle").click());
  s = await read(page);
  check(layout, s.open && s.toggle === "Hide details", `the row opens the details (${s.toggle})`);
  check(layout, s.changed === 2 && s.tests === "is-pass,is-fail" && s.next && s.notes, `its sections: changed, tests (${s.tests}), next, heads up`);
  check(layout, JSON.stringify(s.links) === JSON.stringify(["http://amarchy:5173/search"]) && s.how.includes("On the phone") && s.how.includes("Search"),
    `check it: the http(s) link only, and how (${JSON.stringify(s.links)})`);
  check(layout, JSON.stringify(s.facts) === JSON.stringify(["search-page", "3 commits", "4 files +120 −8", "2 uncommitted", "not in main yet"]),
    `git's facts, as they are (${JSON.stringify(s.facts)})`);
  await page.evaluate(() => { const sc = window.__chat.scroller; sc.scrollTop = sc.scrollHeight; });
  await shot("open");
  await page.evaluate(() => document.querySelector(".brief-card.latest .brief-toggle").click());
  s = await read(page);
  check(layout, !s.open, "and closes them");

  // Answers: the first marks its question; the last sends both, once.
  await page.evaluate(() => document.querySelectorAll(".brief-card.latest .bq")[0].querySelector(".bq-opt").click());
  const half = await page.evaluate(() => { const b = document.querySelector(".brief-card.latest"); return { answered: b.querySelectorAll(".bq.answered").length,
    status: b.querySelector(".bq-status").textContent, send: !b.querySelector(".bq-send").hidden }; });
  check(layout, half.answered === 1 && half.status === "1 of 2 answered" && half.send && !posts.some((p) => p.url.endsWith("/send")),
    `an answer marks its question and waits for the other (${JSON.stringify(half)})`);
  await page.evaluate(() => document.querySelectorAll(".brief-card.latest .bq")[1].querySelectorAll(".bq-opt")[2].click());
  const draft = await page.evaluate(() => window.__chat.input.value);
  check(layout, draft === "Filters: " && !posts.some((p) => p.url.endsWith("/send")), `a draft option fills the box (${JSON.stringify(draft)})`);
  await page.evaluate(() => { window.__chat.input.value = ""; window.__chat.typed(); });
  await page.evaluate(() => document.querySelectorAll(".brief-card.latest .bq")[1].querySelectorAll(".bq-opt")[1].click());
  await page.waitForTimeout(300);
  const sent = posts.filter((p) => p.url.endsWith("/send"));
  check(layout, sent.length === 1 && sent[0].body === JSON.stringify({ text: "Ship it: merge to main and push\n\nNo filters" }),
    `the answers go to Claude together, once (${sent.map((p) => p.body)})`);

  // A reconnect with the same conversation: nothing drawn again, the answers kept.
  await page.evaluate(({ items }) => { window.__card = document.querySelector(".brief-card.latest");
    window.__chat.conversation({ reset: true, start: 0, items: [...items, { kind: "note", text: "Conversation compacted", key: "n1:0", at: "" }] }); }, { items: ITEMS });
  const kept = await page.evaluate(() => ({ same: document.querySelector(".brief-card.latest") === window.__card,
    status: document.querySelector(".brief-card.latest .bq-status").textContent }));
  check(layout, kept.same && kept.status === "Sent", `a reconnect moves nothing, the answers stay sent (${JSON.stringify(kept)})`);

  // A new turn: while Claude works, no reply yet (the working line says it's writing the brief); then its brief, the one before as a line.
  await page.evaluate(() => {
    const c = window.__chat;
    c.row = { ...c.row, status: "working" };
    c.live = { state: "working", activity: { tool: "mcp__amarchy__update_brief", input: {} }, pending: [] };
    c.conversation({ items: [{ kind: "user", text: "Ship it", turn: true, key: "33333333-cccc-4ccc-8ccc-000000000003:0", at: "" },
      { kind: "claude", text: "Shipping.", key: "c7:0", at: "" }] });
    c.renderTail();
  });
  const live = await page.evaluate(() => ({ reply: [...document.querySelectorAll(".turn")].at(-1).querySelector(".turn-reply").childElementCount,
    line: document.querySelector(".screen-work .now")?.textContent }));
  check(layout, live.reply === 0 && /Updating the brief/.test(live.line || ""), `while it writes the brief: the working line says so (${live.line})`);
  await page.evaluate(({ TOOL }) => {
    const c = window.__chat;
    c.conversation({ items: [{ kind: "tool", id: "t9", name: TOOL, summary: "Updated the brief", key: "c8:0", at: "",
      brief: { goal: "Ship the search page", status: "done", headline: "Shipped to main", changed: ["Search page on main"] } }] });
    c.row = { ...c.row, status: "idle" }; c.live = { state: "idle", pending: [] }; c.renderTail();
  }, { TOOL });
  s = await read(page);
  check(layout, s.state === "Done" && s.headline === "Shipped to main" && s.questions === 0 && s.cards === 1 &&
    JSON.stringify(s.lines) === JSON.stringify(["Search page works: 2 choices for you"]),
    `then its brief in full, the one before as its line (${JSON.stringify(s.lines)})`);
  await shot("done");
  // The line opens that brief in place (its questions gone: overtaken); Fold makes it a line again.
  await page.evaluate(() => document.querySelector(".turn-headline").click());
  const older = await page.evaluate(() => { const cards = document.querySelectorAll(".brief-card");
    const o = [...cards].find((x) => !x.classList.contains("latest"));
    return { cards: cards.length, headline: o?.querySelector(".brief-headline")?.textContent, questions: o ? o.querySelectorAll(".bq").length : -1 }; });
  check(layout, older.cards === 2 && older.headline === "Search page works: 2 choices for you" && older.questions === 0,
    `an older brief opens in place, without its old questions (${JSON.stringify(older)})`);
  await page.evaluate(() => document.querySelector(".brief-card:not(.latest) .brief-fold").click());
  const folded = await page.evaluate(() => document.querySelectorAll(".brief-card").length);
  check(layout, folded === 1, "Fold makes it a line again");

  // The conversation view has no brief; back again.
  await page.evaluate(() => window.__chat.showMode("chat"));
  const chat = await page.evaluate(() => ({ cards: document.querySelectorAll(".brief-card").length, users: document.querySelectorAll(".msg.user").length }));
  check(layout, chat.cards === 0 && chat.users === 3, `the Chat view: the conversation, no brief (${JSON.stringify(chat)})`);
  await page.evaluate(() => window.__chat.showMode("screen"));
  s = await read(page);
  check(layout, s.state === "Done" && s.turns === 3 && s.inLast, "back to the brief");

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
