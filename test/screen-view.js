// The screen, in a browser: the chat's default view. The newest turn's screen
// is big at the top, what Claude wrote under it is a fold, the turns before it
// sit below. Its blocks draw, its choices send, its links open and only
// http(s) links are made, the Screen / Chat switch changes the view and keeps
// the one last tapped, and nothing a screen says runs as markup. Checked on a
// phone and on a wide screen, both views, with screenshots.
//
//   node test/screen-view.js            both layouts
//   node test/screen-view.js phone      one layout (phone | wide)
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
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "screen-view-"));
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

// A conversation as app_items gives it: two turns, the newer with a screen that
// has every block, the older with a screen and one unsafe link.
const ITEMS = [
  { kind: "user", text: "Hello", key: "r6:0", at: "" },
  { kind: "claude", text: "Hi.", key: "r7:0", at: "" },
  { kind: "tool", id: "t3", name: "mcp__amarchy__show_screen", summary: "Drew the screen", key: "r8:0", at: "",
    screen: {
      title: "<img src=x onerror=\"window.__pwned = 1\"> Greeting",
      blocks: [
        { type: "link", label: "Bad", url: "javascript:window.__pwned=2" },
        { type: "note", tone: "info", text: "Hello back." },
      ],
    } },
  { kind: "user", text: "Build the search page", key: "r1:0", at: "" },
  { kind: "claude", text: "On it. I'll check the layout on both sizes.", key: "r2:0", at: "" },
  { kind: "tool", id: "t1", name: "Edit", input: { file_path: "/x/search.js" }, summary: "Edited search.js", key: "r3:0", at: "" },
  { kind: "result", tool: "t1", error: false, text: "ok", key: "r4:0", at: "" },
  { kind: "tool", id: "t2", name: "mcp__amarchy__show_screen", summary: "Drew the screen", key: "r5:0", at: "",
    screen: {
      title: "Search page is ready",
      blocks: [
        { type: "stats", items: [{ label: "Tests", value: "42", tone: "ok" }, { label: "Build time", value: "12 s" }] },
        { type: "note", tone: "ok", text: "The build passed." },
        { type: "text", text: "The page **filters** as you type. See `search.js`." },
        { type: "steps", items: [{ label: "Build", state: "done" }, { label: "Test", state: "doing" }, { label: "Ship", state: "todo" }] },
        { type: "table", columns: ["File", "Lines"], rows: [["search.js", "120"], ["search.css", "48"]] },
        { type: "code", language: "js", code: "const x = 1 < 2" },
        { type: "link", label: "Open the page", url: "https://example.com/search", detail: "Test it on your phone" },
        { type: "choices", prompt: "What next?", options: [
          { label: "Ship it", detail: "Merge to main", send: "Ship it" },
          { label: "Show the diff", send: "Show the diff" }] },
      ],
    } },
];

const failures = [];
function check(where, ok, what) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${where}: ${what}`);
  if (!ok) failures.push(`${where}: ${what}`);
}

// The chat, alone on the page, on the app's own look (its stylesheets and theme).
async function mount(page) {
  await page.evaluate((items) => {
    document.body.innerHTML = "";
    const box = document.createElement("div");
    box.style.cssText = "height:100vh;height:100dvh;display:flex;flex-direction:column;background:var(--surface)";
    document.body.append(box);
    store.set("chatView", null);
    window.__chat = new Chat({ id: "fake-screen",
      row: { id: "fake-screen", engine: "chat", status: "idle", sleeping: false, awake: true, repo: "r", name: "n", path: "/tmp" },
      onSession() {}, onScreen() {}, onGone() {} });
    box.append(window.__chat.el);
    window.__chat.conversation({ reset: true, start: 0, items });
  }, ITEMS);
}

async function run(browser, base, layout) {
  console.log(`\n${layout}`);
  const ctx = await browser.newContext({ ...LAYOUTS[layout], extraHTTPHeaders: { "Tailscale-User-Login": "tester@test" } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForSelector("#look", { state: "attached" });
  await page.waitForTimeout(300);
  await mount(page);
  // The first frames still swap the page's font in: the screen's place is read once it has settled.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${layout}-${name}.png`), fullPage: false });

  // The screen is the default, and the newest turn's screen is on top.
  const s = await page.evaluate(() => ({
    mode: window.__chat.mode,
    stageShown: window.__chat.scroller.firstChild === window.__chat.stage,
    title: document.querySelector(".screen-card.current .sb-title")?.textContent,
    stats: document.querySelectorAll(".screen-card.current .sb-stat").length,
    note: document.querySelectorAll(".screen-card.current .sb-note.ok").length,
    steps: document.querySelectorAll(".screen-card.current .sb-step").length,
    doing: document.querySelectorAll(".screen-card.current .sb-step.s-doing").length,
    rows: document.querySelectorAll(".screen-card.current .sb-table tbody tr").length,
    code: document.querySelectorAll(".screen-card.current .sb-code .code").length,
    links: [...document.querySelectorAll(".screen-card.current .sb-link")].map((a) => a.getAttribute("href")),
    options: [...document.querySelectorAll(".screen-card.current .sb-option")].map((b) => b.textContent),
    bold: document.querySelector(".screen-card.current .screen-text strong")?.textContent,
    fold: document.querySelector(".screen-card.current details.screen-wrote"),
    foldOpen: document.querySelector(".screen-card.current details.screen-wrote")?.open,
    foldText: document.querySelector(".screen-card.current details.screen-wrote")?.textContent || "",
    old: document.querySelectorAll(".screen-old").length,
    pwned: window.__pwned,
    overflow: window.__chat.stage.scrollWidth - window.__chat.stage.clientWidth,
    top: window.__chat.scroller.scrollTop,
  }));
  check(layout, s.mode === "screen" && s.stageShown, "the screen is the default view, on the scroller");
  check(layout, s.top === 0, `the screen opens at its top (scrolled ${s.top}px)`);
  check(layout, s.title === "Search page is ready", `the newest title is big (got ${JSON.stringify(s.title)})`);
  check(layout, s.stats === 2 && s.note === 1 && s.steps === 3 && s.doing === 1, "stats, note and steps draw");
  check(layout, s.rows === 2 && s.code === 1, "table rows and a code block draw");
  check(layout, JSON.stringify(s.links) === JSON.stringify(["https://example.com/search"]), `the https link draws (got ${JSON.stringify(s.links)})`);
  check(layout, JSON.stringify(s.options) === JSON.stringify(["Ship itMerge to main", "Show the diff"]), `the choices draw as buttons (got ${JSON.stringify(s.options)})`);
  check(layout, s.bold === "filters", "markdown in a text block (bold) draws");
  check(layout, !!s.fold && s.foldOpen === false && s.foldText.includes("On it."), "what Claude wrote is a closed fold, with its words");
  check(layout, s.old === 1, `the turn before is a fold below (got ${s.old})`);
  check(layout, s.pwned === undefined, "a title's markup does not run");
  check(layout, s.overflow <= 1, `no sideways scroll on the screen (overflow ${s.overflow}px)`);

  // The unsafe link of the older turn is not made.
  const unsafe = await page.evaluate(() => document.querySelectorAll('.screen-old a[href^="javascript"]').length);
  check(layout, unsafe === 0, "a javascript: link is not made");

  await page.evaluate(() => { document.querySelector(".screen-card.current details.screen-wrote").open = true; });
  await shot("screen");
  await page.evaluate(() => { document.querySelector(".screen-card.current details.screen-wrote").open = false; });

  // A choice sends its text, once: the others wait with it.
  let sent = null;
  await page.route("**/api/session/fake-screen/send", async (route) => {
    sent = route.request().postData();
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.locator(".screen-card.current .sb-option", { hasText: "Ship it" }).click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ sent: document.querySelector(".sb-choices").classList.contains("sent"),
    chosen: document.querySelectorAll(".sb-option.chosen").length }));
  check(layout, !!sent && sent.includes('"text":"Ship it"'), `a choice sends its text (got ${sent})`);
  check(layout, after.sent && after.chosen === 1, "the choices wait after one is sent");

  // The conversation view, and back. The view kept is the one last tapped.
  await page.locator(".view-switch .vs-btn", { hasText: "Chat" }).click();
  await page.waitForTimeout(200);
  const chat = await page.evaluate(() => ({
    mode: window.__chat.mode,
    convShown: window.__chat.scroller.firstChild === window.__chat.conv,
    users: document.querySelectorAll(".msg.user").length,
    claude: document.querySelectorAll(".msg.claude").length,
    kept: store.get("chatView"),
  }));
  check(layout, chat.mode === "chat" && chat.convShown, "the Chat switch shows the conversation");
  check(layout, chat.users === 2 && chat.claude === 2, `the conversation has its messages (users ${chat.users}, claude ${chat.claude})`);
  check(layout, chat.kept === "chat", "the view last tapped is kept");
  await shot("chat");
  await page.locator(".view-switch .vs-btn", { hasText: "Screen" }).click();
  await page.waitForTimeout(200);
  const back = await page.evaluate(() => ({ mode: window.__chat.mode, title: document.querySelector(".screen-card.current .sb-title")?.textContent }));
  check(layout, back.mode === "screen" && back.title === "Search page is ready", `back to the screen, on the newest turn (got ${JSON.stringify(back.title)})`);

  // A new screen while it's open comes on top.
  await page.evaluate(() => {
    window.__chat.conversation({ items: [{ kind: "user", text: "Ship it", key: "r9:0", at: "" },
      { kind: "tool", id: "t4", name: "mcp__amarchy__show_screen", summary: "Drew the screen", key: "r10:0", at: "",
        screen: { title: "Shipped", blocks: [{ type: "text", text: "Merged to main." }] } }] });
  });
  await page.waitForTimeout(100);
  const live = await page.evaluate(() => document.querySelector(".screen-card.current .sb-title")?.textContent);
  check(layout, live === "Shipped", `a new screen comes on top (got ${JSON.stringify(live)})`);
  await shot("new");

  check(layout, errors.length === 0, `no page errors (${errors.join("; ") || "none"})`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "screen-view-home-"));
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
