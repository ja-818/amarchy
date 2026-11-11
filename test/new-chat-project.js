// The project a new chat starts in, in a browser. Checked: your projects in
// a row over the box, in your order, the one it starts in lit (the last one
// you used); a tap picks another, the keyboard still in the box; Tab in the
// box is the next one and Shift+Tab the one before, round the ends, the lit
// one brought into view; a project what you wrote names is lit (and says
// why) until you pick one yourself; the chat starts in the one lit; + is
// New project. On a phone and on a wide screen, with screenshots.
//
//   node test/new-chat-project.js          both layouts
//   node test/new-chat-project.js phone    one layout (phone | wide)
//
// Needs what test/reply-view.js needs (Chromium, playwright-core). It starts
// its own app server from this checkout's bin/amarchy, with a home and state
// of its own. Exits 0 when every check passed.

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "new-chat-project-"));
const ONLY = process.argv[2];

// The app server reply-view.js starts: the app's handler on 127.0.0.1, with
// the Tailscale login it expects, and the Origin of its own host on what a
// page sends (a request without one, as a Shortcut's, stays without).
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

const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};

const CHATS = [
  { id: "proj-a", repo: "proj", name: "a", task: "Fix: the login page", status: "idle", engine: "chat", path: "/tmp/a" },
  { id: "proj-b", repo: "proj", name: "b", task: "Docs: the guide", status: "working", engine: "chat", path: "/tmp/b" },
];

const failures = [];
function check(where, ok, what) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${where}: ${what}`);
  if (!ok) failures.push(`${where}: ${what}`);
}

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(page, fn, arg, ms = 6000) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; }
}

const PROJECTS = ["amarchy", "jaken", "houston-os", "houston", "taxflow", "felipe-crm", "academy", "games", "product", "demos", "agent-brief", "remote-omarchy"];

async function run(browser, layout, port) {
  const where = layout;
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}` });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const started = [];
  await page.route("**/api/session/*/stream", (r) => r.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" }));
  await page.route("**/api/session/*/composer", (r) => r.fulfill({ json: { engine: "chat", commands: [], models: [], model: "opus", mode: "default" } }));
  await page.route("**/api/new", (r) => { started.push(r.request().postDataJSON()); r.fulfill({ status: 500, json: { error: "not here" } }); });
  await page.addInitScript(({ chats, projects }) => {
    if (!sessionStorage.getItem("seeded")) { localStorage.setItem("last-project", "jaken"); sessionStorage.setItem("seeded", "1"); }
    const parse = JSON.parse;
    JSON.parse = function (text, ...rest) {
      const v = parse.call(this, text, ...rest);
      if (v && typeof v === "object" && Array.isArray(v.sessions) && "share" in v) {
        v.sessions = chats.map((c) => ({ ...c }));
        v.projects = projects.map((name, i) => ({ name, sessions: i < 2 ? 2 - i : 0 }));
      }
      return v;
    };
  }, { chats: CHATS, projects: PROJECTS });
  await page.goto("/");
  await until(page, () => window.app && app.view && app.view.sessions && app.view.sessions.length);
  await page.evaluate(() => document.querySelector(".board-new-btn").click());
  await page.waitForSelector(".start-chat .new-projects .ui-tabs .control");
  await sleep(400);

  const lit = () => page.evaluate(() => { const on = document.querySelectorAll(".start-chat .new-projects .control.on"); return on.length === 1 ? on[0].dataset.tab : `${on.length} lit`; });
  // The lit one, all of it inside the row (not scrolled out of sight).
  const inView = () => page.evaluate(() => {
    const row = document.querySelector(".start-chat .ui-tabs.scroll"), on = row.querySelector(".control.on");
    const r = on.getBoundingClientRect(), v = row.getBoundingClientRect();
    return r.left >= v.left - 1 && r.right <= v.right + 1;
  });
  const typing = () => page.evaluate(() => document.activeElement && document.activeElement.matches(".start-chat textarea"));

  // ---- the row: first, over the box, in your order
  const shape = await page.evaluate(() => {
    const row = document.querySelector(".start-chat .new-projects"), box = document.querySelector(".start-chat .prompt.new");
    return { names: [...row.querySelectorAll(".ui-tabs .control")].map((b) => b.textContent),
             over: row.getBoundingClientRect().bottom <= box.getBoundingClientRect().top + 1,
             oneRow: new Set([...row.querySelectorAll(".ui-tabs .control")].map((b) => Math.round(b.getBoundingClientRect().top))).size === 1,
             fits: row.getBoundingClientRect().right <= document.documentElement.clientWidth + 1,
             old: !!document.querySelector(".start-chat .new-under .pick:not(.model)") };
  });
  check(where, shape.names.join("|") === "Amarchy|Jaken|Houston Os|Houston|Taxflow|Felipe Crm|Academy|Games|Product|Demos|Agent Brief|Remote Omarchy",
        `your projects, in your order (${shape.names.length})`);
  check(where, shape.over && shape.oneRow && shape.fits, `one row over the box, inside the screen (${JSON.stringify(shape)})`);
  check(where, !shape.old, "no project menu under the box any more");
  check(where, await lit() === "jaken", `the last one you used is lit (${await lit()})`);
  await page.screenshot({ path: path.join(SHOTS, `${layout}-projects.png`) });

  // ---- a tap picks one
  await page.click(".start-chat textarea");
  await page.click('.start-chat .new-projects .control[data-tab="houston"]');
  check(where, await lit() === "houston", `a tap: Houston is lit (${await lit()})`);
  check(where, await typing(), "the keyboard is still in the box");

  // ---- Tab: the next one; Shift+Tab: the one before; round the ends
  await page.keyboard.press("Tab");
  check(where, await lit() === "taxflow" && await typing(), `Tab: the next project, still in the box (${await lit()})`);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  check(where, await lit() === "houston-os", `Shift+Tab: the one before (${await lit()})`);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+Tab");
  check(where, await lit() === "remote-omarchy", `before the first: the last (${await lit()})`);
  await sleep(100);
  check(where, await inView(), "the lit one is brought into view");
  await page.screenshot({ path: path.join(SHOTS, `${layout}-projects-end.png`) });
  await page.keyboard.press("Tab");
  check(where, await lit() === "amarchy", `after the last: the first (${await lit()})`);
  await sleep(100);
  check(where, await inView(), "and it's in view again");
  check(where, await page.evaluate(() => board.tab) === "chats", "the board's own Tab (Chats | Tasks) stays put");

  // ---- what you wrote names one: lit, and it says why (until you pick)
  await page.reload();
  await until(page, () => window.app && app.view && app.view.sessions && app.view.sessions.length);
  await page.evaluate(() => document.querySelector(".board-new-btn").click());
  await page.waitForSelector(".start-chat .new-projects .ui-tabs .control");
  await page.fill(".start-chat textarea", "Fix the login page in taxflow");
  check(where, await until(page, () => (document.querySelector(".start-chat .new-projects .control.on") || {}).dataset.tab === "taxflow"
                                       && !document.querySelector(".start-chat .why").hidden), "named in what you wrote: Taxflow lit, and why");
  await page.keyboard.press("Tab");
  await page.fill(".start-chat textarea", "Fix the login page in taxflow, as in jaken");
  check(where, await lit() === "felipe-crm" && await page.evaluate(() => document.querySelector(".start-chat .why").hidden),
        `picked with Tab: yours, whatever you write (${await lit()})`);
  await sleep(200);
  await page.screenshot({ path: path.join(SHOTS, `${layout}-projects-written.png`) });

  // ---- it starts in the one lit
  if (layout === "wide") await page.keyboard.press("Enter");
  else await page.click(".start-chat .send");
  await sleep(300);
  check(where, started.length === 1 && started[0].repo === "felipe-crm", `the chat starts in it (${JSON.stringify(started[0] || {})})`);

  // ---- +: New project
  await page.evaluate(() => { if (!board.composing) document.querySelector(".board-new-btn").click(); });
  await page.waitForSelector(".start-chat .new-project");
  await page.click(".start-chat .new-project");
  check(where, await until(page, () => /New project|GitHub|empty/i.test((document.querySelector(".picker, .sheet") || {}).innerText || "")), "+: New project");
  await sleep(400);
  await page.screenshot({ path: path.join(SHOTS, `${layout}-new-project.png`) });
  check(where, !errors.length, `no page errors (${errors.join("; ")})`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "new-chat-project-home-"));
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of Object.keys(LAYOUTS)) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      if (layout === "wide") await new Promise((r) => setTimeout(r, 100));
      await run(browser, layout, port).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
