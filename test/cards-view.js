// The cards view, in a browser: the chat's default view. Each turn reads in
// order, oldest first: your message, Claude's work in a closed fold (its words
// and steps), and its reply as cards you swipe through (bin/amarchy cmd_cards).
// Checked: the order and the fold, the deck (its cards, dots and arrows, a
// swipe, More), a card's button sending its message once and a draft one
// going into the box, a turn without cards showing Claude's words with "Sum it
// up", the wait while cards are made, only http(s) links, nothing in a card
// running as markup, and the Cards / Chat switch. On a phone and on a wide
// screen, with screenshots.
//
//   node test/cards-view.js            both layouts
//   node test/cards-view.js phone      one layout (phone | wide)
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
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "cards-view-"));
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

// A conversation as app_items gives it (your messages marked turn), and the
// cards cmd_cards made: the newer turn has three, the older none.
const OLD = "11111111-aaaa-4aaa-8aaa-000000000001";
const NEW = "22222222-bbbb-4bbb-8bbb-000000000002";
const ITEMS = [
  { kind: "user", text: "Hello", turn: true, key: `${OLD}:0`, at: "" },
  { kind: "claude", text: "Hi there. What should we build today?", key: "c1:0", at: "" },
  { kind: "user", text: "Build the search page", turn: true, key: `${NEW}:0`, at: "" },
  { kind: "claude", text: "On it. I'll check the layout on both sizes.", key: "c2:0", at: "" },
  { kind: "tool", id: "t1", name: "Edit", input: { file_path: "/x/search.js" }, summary: "Edited search.js", key: "c3:0", at: "" },
  { kind: "result", tool: "t1", error: false, text: "ok", key: "c4:0", at: "" },
  { kind: "claude", text: "Done. The page runs at http://amarchy:5173/search and the 42 tests pass.", key: "c5:0", at: "" },
];
const CARDS = {
  [NEW]: { state: "ready", at: 1000, cards: [
    { tone: "ok", label: "Done", title: "Search page is ready", body: "It **filters** as you type.",
      stats: [{ label: "Tests", value: "42" }, { label: "Files", value: "2" }],
      checklist: [{ text: "Page built", done: true }, { text: "Ship to main", done: false }],
      link: { label: "Open the page", url: "http://amarchy:5173/search" },
      actions: [{ label: "Ship it", send: "Ship it: merge to main and push" }, { label: "Change it", send: "Change the search page: ", draft: true }] },
    { tone: "info", label: "To know", title: "<img src=x onerror=\"window.__pwned = 1\"> Two things", points: ["Debounced at 200 ms", "Empty query shows all"],
      more: "- Works offline\n- Keyboard: / focuses it", link: { label: "Bad", url: "javascript:window.__pwned=2" } },
    { tone: "ask", title: "Add filters too?", actions: [{ label: "Yes", send: "Yes, add filters" }, { label: "No", send: "No filters" }] },
  ] },
};

const failures = [];
function check(where, ok, what) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${where}: ${what}`);
  if (!ok) failures.push(`${where}: ${what}`);
}

// The chat, alone on the page, on the app's own look (its stylesheets and theme).
async function mount(page) {
  await page.evaluate(({ items, cards }) => {
    document.body.innerHTML = "";
    const box = document.createElement("div");
    box.style.cssText = "height:100vh;height:100dvh;display:flex;flex-direction:column;background:var(--surface)";
    document.body.append(box);
    store.set("chatView", null);
    window.__chat = new Chat({ id: "fake-cards",
      row: { id: "fake-cards", engine: "chat", status: "idle", sleeping: false, awake: true, repo: "r", name: "n", path: "/tmp" },
      onSession() {}, onScreen() {}, onGone() {} });
    box.append(window.__chat.el);
    window.__chat.conversation({ reset: true, start: 0, items });
    window.__chat.setCards(cards);
  }, { items: ITEMS, cards: CARDS });
}

async function run(browser, base, layout) {
  console.log(`\n${layout}`);
  const ctx = await browser.newContext({ ...LAYOUTS[layout], extraHTTPHeaders: { "Tailscale-User-Login": "tester@test" } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const posts = [];
  await page.route("**/api/session/fake-cards/*", async (route) => {
    posts.push({ url: route.request().url(), body: route.request().postData() });
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(base);
  await page.waitForSelector("#look", { state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  await mount(page);
  await page.waitForTimeout(300);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${layout}-${name}.png`) });

  const s = await page.evaluate(() => {
    const c = window.__chat, turns = [...document.querySelectorAll(".turn")];
    const last = turns.at(-1), first = turns[0];
    const sc = c.scroller;
    return {
      mode: c.mode, stageShown: sc.firstChild === c.stage,
      turns: turns.length,
      firstSaid: first?.querySelector(".turn-you")?.textContent.trim(),
      lastSaid: last?.querySelector(".turn-you")?.textContent.trim(),
      workOpen: last?.querySelector(".turn-work")?.open, workHidden: last?.querySelector(".turn-work")?.hidden,
      workSummary: last?.querySelector(".turn-work > summary")?.textContent,
      firstWork: first?.querySelector(".turn-work > summary")?.textContent,
      workText: last?.querySelector(".turn-work-body")?.textContent || "",
      cards: last?.querySelectorAll(".rcard").length,
      title: last?.querySelector(".rcard .rcard-title")?.textContent,
      label: last?.querySelector(".rcard .rcard-label")?.textContent,
      bold: last?.querySelector(".rcard .rcard-body strong")?.textContent,
      stats: last?.querySelectorAll(".rcard:first-child .rcard-stat").length,
      checks: [...last.querySelectorAll(".rcard:first-child .rcard-checks li")].map((li) => li.className.replace("is-", "")).join(","),
      ticks: last?.querySelectorAll(".rcard:first-child .rcard-checks li.is-done .box svg").length,
      links: [...last.querySelectorAll(".rcard-link")].map((a) => a.getAttribute("href")),
      dots: last?.querySelectorAll(".deck-dot").length, dotOn: [...last.querySelectorAll(".deck-dot")].findIndex((d) => d.classList.contains("on")),
      oldText: first?.querySelector(".reply-plain .reply-text")?.textContent.trim(),
      oldMake: first?.querySelector(".reply-make")?.textContent,
      pwned: window.__pwned,
      atBottom: sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2,
      overflow: c.stage.scrollWidth - c.stage.clientWidth,
    };
  });
  check(layout, s.mode === "screen" && s.stageShown, "the cards view is the default");
  check(layout, s.turns === 2 && s.firstSaid === "Hello" && s.lastSaid === "Build the search page", "turns read oldest first, your message at each");
  check(layout, !/null|undefined/.test(s.firstWork || ""), `the fold's line has no stray words (${JSON.stringify(s.firstWork)})`);
  check(layout, s.workHidden === false && s.workOpen === false && /Claude's work/.test(s.workSummary) && /1 step/.test(s.workSummary),
    `Claude's work is a closed fold, with its steps counted (${JSON.stringify(s.workSummary)})`);
  check(layout, s.workText.includes("On it.") && s.workText.includes("Edited search.js"), "the fold holds Claude's words and steps");
  check(layout, s.cards === 3 && s.title === "Search page is ready" && s.label === "Done", `the reply is a deck of 3 cards (got ${s.cards})`);
  check(layout, s.bold === "filters" && s.stats === 2, "a card's body (markdown) and numbers draw");
  check(layout, s.checks === "done,todo" && s.ticks === 1, `a checklist draws, done ticked (got ${s.checks}, ${s.ticks} tick)`);
  check(layout, JSON.stringify(s.links) === JSON.stringify(["http://amarchy:5173/search"]), `only the http(s) link is made (got ${JSON.stringify(s.links)})`);
  check(layout, s.pwned === undefined, "a card's markup does not run");
  check(layout, s.dots === 3 && s.dotOn === 0, `three dots, the first on (on: ${s.dotOn})`);
  check(layout, s.oldText === "Hi there. What should we build today?" && s.oldMake === "Sum it up in cards",
    "a turn without cards shows Claude's words, and offers to sum them up");
  check(layout, s.atBottom, "it opens at the newest, at the bottom");
  check(layout, s.overflow <= 1, `no sideways scroll on the page (overflow ${s.overflow}px)`);
  await shot("cards");

  // A swipe to the next card: its dot comes on.
  await page.evaluate(() => {
    const track = document.querySelector(".turn:last-child .deck-track") || [...document.querySelectorAll(".deck-track")].at(-1);
    const cards = track.children;
    track.scrollTo({ left: cards[1].offsetLeft - cards[0].offsetLeft });
  });
  await page.waitForTimeout(400);
  const dot = await page.evaluate(() => [...[...document.querySelectorAll(".deck")].at(-1).querySelectorAll(".deck-dot")].findIndex((d) => d.classList.contains("on")));
  check(layout, dot === 1, `a swipe shows the next card (dot ${dot})`);
  if (layout === "wide") {
    await page.locator(".deck-arrow[aria-label='Next card']").last().click();
    await page.waitForTimeout(500);
    const d2 = await page.evaluate(() => [...[...document.querySelectorAll(".deck")].at(-1).querySelectorAll(".deck-dot")].findIndex((d) => d.classList.contains("on")));
    check(layout, d2 === 2, `the arrow shows the next card (dot ${d2})`);
  } else {
    const arrows = await page.evaluate(() => getComputedStyle(document.querySelector(".deck-arrow")).display);
    check(layout, arrows === "none", "a phone swipes: no arrows");
  }

  // More, on the second card.
  await page.evaluate(() => [...document.querySelectorAll(".rcard-more-btn")].at(-1).click());
  const more = await page.evaluate(() => { const m = [...document.querySelectorAll(".rcard-more")].at(-1); return !m.hidden && m.textContent.includes("Works offline"); });
  check(layout, more, "More opens the card's detail");
  await shot("swiped");

  // A draft button fills the box; a send button sends, once.
  await page.evaluate(() => [...document.querySelectorAll(".rcard-action.draft")].at(-1).click());
  const draft = await page.evaluate(() => window.__chat.input.value);
  check(layout, draft === "Change the search page: " && posts.length === 0, `a draft button fills the box (got ${JSON.stringify(draft)})`);
  await page.evaluate(() => { window.__chat.input.value = ""; window.__chat.typed(); });
  await page.evaluate(() => [...document.querySelectorAll(".rcard-action.primary")][0].click());
  await page.waitForTimeout(300);
  const sent = posts.find((p) => p.url.endsWith("/send"));
  const deckSent = await page.evaluate(() => [...document.querySelectorAll(".deck")].at(-1).classList.contains("sent"));
  check(layout, !!sent && sent.body.includes('"text":"Ship it: merge to main and push"') && deckSent, `a card's button sends its message, once (got ${sent && sent.body})`);

  // "Sum it up" on the older turn asks for its cards, and waits for them.
  await page.evaluate(() => document.querySelector(".reply-make").click());
  await page.waitForTimeout(300);
  const asked = posts.find((p) => p.url.endsWith("/cards"));
  const waiting = await page.evaluate(() => document.querySelector(".turn .reply-wait")?.textContent);
  check(layout, !!asked && asked.body.includes(OLD) && /Summing it up…$/.test(waiting || ""), `Sum it up asks for the turn's cards and waits (got ${asked && asked.body})`);
  await page.evaluate(({ OLD }) => window.__chat.setCards({ ...window.__chat.cards, [OLD]: { state: "ready", at: 2000, cards: [{ tone: "info", title: "Said hello" }] } }), { OLD });
  const oldCard = await page.evaluate(() => document.querySelector(".turn .rcard-title")?.textContent);
  check(layout, oldCard === "Said hello", "its cards come in when made");

  // The fold opened: Claude's words, as the conversation shows them.
  await page.evaluate(() => { [...document.querySelectorAll(".turn-work")].at(-1).open = true; });
  await page.evaluate(() => { const sc = window.__chat.scroller; sc.scrollTop = sc.scrollHeight; });
  await shot("work");

  // The conversation view, and back.
  await page.locator(".view-switch .vs-btn", { hasText: "Chat" }).click();
  await page.waitForTimeout(200);
  const chat = await page.evaluate(() => ({ mode: window.__chat.mode, conv: window.__chat.scroller.firstChild === window.__chat.conv,
    users: document.querySelectorAll(".msg.user").length, kept: store.get("chatView"), decks: document.querySelectorAll(".deck").length }));
  check(layout, chat.mode === "chat" && chat.conv && chat.users === 2 && chat.decks === 0 && chat.kept === "chat", "the Chat switch shows the conversation, as before");
  await shot("chat");
  await page.locator(".view-switch .vs-btn", { hasText: "Cards" }).click();
  await page.waitForTimeout(200);
  const back = await page.evaluate(() => ({ decks: document.querySelectorAll(".deck").length, turns: document.querySelectorAll(".turn").length }));
  check(layout, back.decks === 2 && back.turns === 2, `back to the cards (decks ${back.decks}, turns ${back.turns})`);

  // A new turn: while Claude works, no reply yet; when it ends, the wait; then its cards.
  await page.evaluate(() => {
    const c = window.__chat;
    c.row = { ...c.row, status: "working" };
    c.conversation({ items: [{ kind: "user", text: "Add filters", turn: true, key: "33333333-cccc-4ccc-8ccc-000000000003:0", at: "" },
      { kind: "claude", text: "Adding them.", key: "c6:0", at: "" }] });
    c.renderTail();
  });
  const live = await page.evaluate(() => ({ reply: [...document.querySelectorAll(".turn")].at(-1).querySelector(".turn-reply").childElementCount,
    work: !document.querySelector(".screen-work").hidden }));
  check(layout, live.reply === 0 && live.work, "while Claude works: no reply, the working line");
  await page.evaluate(() => { const c = window.__chat; c.row = { ...c.row, status: "idle" }; c.renderTail(); });
  const wait = await page.evaluate(() => [...document.querySelectorAll(".turn")].at(-1).querySelector(".reply-wait")?.textContent);
  check(layout, /Summing it up…$/.test(wait || ""), `when it ends, its cards are awaited (got ${JSON.stringify(wait)})`);
  await page.evaluate(() => window.__chat.setCards({ ...window.__chat.cards, "33333333-cccc-4ccc-8ccc-000000000003": { state: "ready", at: 3000, cards: [{ tone: "ok", title: "Filters added" }] } }));
  const done = await page.evaluate(() => [...document.querySelectorAll(".turn")].at(-1).querySelector(".rcard-title")?.textContent);
  check(layout, done === "Filters added", "then its cards");

  check(layout, errors.length === 0, `no page errors (${errors.join("; ") || "none"})`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cards-view-home-"));
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
