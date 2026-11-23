// A chat in Ghostty, from the app, phone and wide: a chat's menu has "Open in
// Ghostty on <machine>" when the machine has Ghostty and a desktop (the
// board's ghostty), and it asks the host to open it (POST
// /api/session/<id>/ghostty); on a computer Ctrl+Alt+O does too, and the keys
// list says so. Not there for a chat of another machine's, nor on a machine
// without it. Screenshots of each layout go to SHOTS.
//
//   node test/ghostty-view.js
//
// Needs what test/reply-view.js needs (Chromium, playwright-core). Its app
// server is this checkout's, with a home of its own; the board's chats are
// the test's own (put into what the host says), and the host's answer to the
// open is the test's: nothing opens anywhere.

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), "ghostty-shots");

const SHIM = `
import importlib.machinery, importlib.util, os, sys, threading, http.server
bin, port, home = sys.argv[1], int(sys.argv[2]), sys.argv[3]
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", bin)
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
import sys as _sys; _sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(bin)), "..", "test")); import isolate; isolate.timers(am)      # (test/isolate.py: none of this machine's automations)
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
    const py = spawn("python3", ["-c", SHIM, BIN, String(port), home], { stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, AMARCHY_HOST_NAME: "desk", AMARCHY_WORK: path.join(home, "Work") } });
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
const NOW = Date.now() / 1000;
const T = { goal: "", state: "", goal_at: 0, asks: [], at: NOW - 600 };
const MINE = { id: "proj-pop", repo: "proj", name: "pop", task: "Build: the pop-out", status: "idle", engine: "chat", path: "/tmp/p", today: T, machine: "desk" };

// ghostty: what the host says of it; chats: the board's.
async function page(browser, layout, port, { ghostty = true, chats = [MINE] } = {}) {
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}` });
  const p = await ctx.newPage();
  p.errors = [];
  p.posts = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.route("**/api/session/*/stream", (r) => r.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" }));
  await p.route("**/api/session/*/composer", (r) => r.fulfill({ json: { engine: "chat", commands: [], models: [], model: "opus", mode: "default" } }));
  await p.route("**/api/session/*/ghostty", (r) => { p.posts.push({ url: r.request().url(), body: r.request().postDataJSON() }); r.fulfill({ json: { opened: true } }); });
  await p.addInitScript(({ chats, ghostty }) => {
    Object.defineProperty(Navigator.prototype, "standalone", { get: () => true });
    try { localStorage.setItem("amarchy-push", "no"); } catch (e) { /* no storage yet */ }
    const parse = JSON.parse;
    JSON.parse = function (text, ...rest) {
      const v = parse.call(this, text, ...rest);
      if (v && typeof v === "object" && Array.isArray(v.sessions) && "hostname" in v) {
        v.sessions = chats; v.ghostty = ghostty; v.machine = "desk";
        v.machines = [{ name: "desk", label: "desk", me: true, on: true }, { name: "box", label: "box", me: false, on: true }];
      }
      return v;
    };
  }, { chats, ghostty });
  await p.goto("/");
  await p.waitForFunction(() => typeof ghosttyOpen === "function" && app.view && app.view.sessions && app.view.sessions.length);
  return p;
}

async function openChat(p, id) {
  await p.evaluate((id) => (app.desk ? boardOpen(id) : go(`#/s/${encodeURIComponent(id)}`)), id);
  await p.locator('button.more[aria-label="This chat"]').first().waitFor({ timeout: 8000 });
}

async function menuItems(p, layout) {
  await p.locator('button.more[aria-label="This chat"]').first().click();
  if (layout === "wide") {
    await p.locator(".picker-row", { hasText: "Advanced" }).first().click();
    await p.waitForTimeout(300);
    return p.locator(".picker-row").allInnerTexts();
  }
  await p.waitForTimeout(400);
  return p.locator(".sheet .menu-item").allInnerTexts();
}

async function run(browser, port, layout) {
  const shot = (p, name) => p.waitForTimeout(300).then(() => p.screenshot({ path: path.join(SHOTS, `${layout}-${name}.png`) }));
  let p = await page(browser, layout, port);
  await openChat(p, "proj-pop");
  const items = await menuItems(p, layout);
  const item = items.find((t) => /Open in Ghostty on desk/.test(t));
  check(layout, !!item, `the chat's menu has Open in Ghostty on desk (${items.map((t) => t.split("\n")[0]).join(", ")})`);
  if (layout === "wide") {
    const key = await p.evaluate(() => {
      const adv = sessionItems(app.view.sessions[0]).find((x) => x.label === "Advanced");
      const it = adv && adv.group().items.find((x) => /Ghostty/.test(x.label));
      return it && it.key;
    });
    check(layout, key === "Ctrl+Alt+O", `with its key, Ctrl+Alt+O (${key})`);
  }
  await shot(p, "menu");
  await (layout === "wide" ? p.locator(".picker-row", { hasText: "Open in Ghostty" }) : p.locator(".sheet .menu-item", { hasText: "Open in Ghostty" })).first().click();
  await p.waitForTimeout(500);
  check(layout, p.posts.length === 1 && /\/api\/session\/proj-pop\/ghostty$/.test(p.posts[0].url) && p.posts[0].body.which === "term",
    `it asks the host to open its terminal (${JSON.stringify(p.posts)})`);
  const said = await p.locator(".toast").last().innerText().catch(() => "");
  check(layout, /in Ghostty on desk/.test(said), `and says where (${said})`);
  if (layout === "wide") {
    await p.keyboard.press("Escape").catch(() => {});
    await p.locator("body").click({ position: { x: 5, y: 400 } }).catch(() => {});
    await p.keyboard.press("Control+Alt+KeyO");
    await p.waitForTimeout(500);
    check(layout, p.posts.length === 2, `Ctrl+Alt+O opens it too (${p.posts.length} asked)`);
    await p.evaluate(() => showKeys());
    const keys = await p.locator(".keys-row").allInnerTexts();
    check(layout, keys.some((k) => /Ctrl\+Alt\+O/.test(k) && /Ghostty/.test(k)), "the keys list has it");
  }
  check(layout, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();

  // A machine without Ghostty or a desktop (a server): not offered.
  p = await page(browser, layout, port, { ghostty: false });
  await openChat(p, "proj-pop");
  const none = await menuItems(p, layout);
  check(layout, !none.some((t) => /Ghostty/.test(t)), "a machine without Ghostty: not offered");
  if (layout === "wide") {
    await p.keyboard.press("Escape").catch(() => {});
    await p.keyboard.press("Control+Alt+KeyO");
    await p.waitForTimeout(400);
    check(layout, !p.posts.length, "and Ctrl+Alt+O asks nothing");
  }
  await p.context().close();

  // Another machine's chat: not offered (its window would open over there).
  const theirs = { ...MINE, id: "box:proj-far", machine: "box", task: "Far: on the server" };
  p = await page(browser, layout, port, { chats: [theirs] });
  await openChat(p, "box:proj-far");
  const far = await menuItems(p, layout);
  check(layout, !far.some((t) => /Ghostty/.test(t)), "another machine's chat: not offered");
  await p.context().close();
}

(async () => {
  const pw = loadPlaywright();
  fs.mkdirSync(SHOTS, { recursive: true });
  const home = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "ghostty-home-"));
  fs.mkdirSync(path.join(home, "Work"));
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of Object.keys(LAYOUTS)) await run(browser, port, layout).catch((e) => check(layout, false, `crashed: ${e.stack}`));
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(`\nscreenshots: ${SHOTS}`);
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : "\nAll passed.");
  process.exit(failures.length ? 1 : 0);
})();
