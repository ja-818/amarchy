// What the app opens on, in a browser. Checked: on a phone's home-screen
// app, back after AWAY in the background, the list and its new chat rather
// than the chat you left; back sooner, the same chat; a notification tapped
// on the way back, its chat. On a computer, launched: Today, not the last
// chat; New chat: "What do you want to do?", and Esc back to the chat you
// were in; reloaded: the chat it was on; a link to a chat: that chat. With
// screenshots.
//
//   node test/open-new-chat.js          both layouts
//   node test/open-new-chat.js phone    one layout (phone | wide)
//
// Needs what test/brief-view.js needs (Chromium, playwright-core). It starts
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
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "open-new-chat-"));
const ONLY = process.argv[2];

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

const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};

const CHATS = [
  { id: "proj-a", repo: "proj", name: "a", task: "Fix: the login page", status: "idle", engine: "chat", path: "/tmp/a" },
  { id: "proj-b", repo: "proj", name: "b", task: "Docs: the guide", status: "working", engine: "chat", path: "/tmp/b" },
];

const MIN = 60 * 1000;

// A page as the home-screen app has it (standalone: optional), with the
// list's chats, a clock that can be moved on (__skew) and a visibility the
// test sets (__hidden).
async function page(browser, layout, port, standalone) {
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}` });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.route("**/api/session/*/stream", (r) => r.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" }));
  await p.route("**/api/session/*/composer", (r) => r.fulfill({ json: { engine: "chat", commands: [], models: [], model: "opus", mode: "default" } }));
  await p.addInitScript(({ chats, standalone }) => {
    if (standalone) Object.defineProperty(Navigator.prototype, "standalone", { get: () => true });
    window.__hidden = false;
    window.__skew = 0;
    Object.defineProperty(document, "visibilityState", { get: () => (window.__hidden ? "hidden" : "visible") });
    const now = Date.now;
    Date.now = () => now() + window.__skew;
    const parse = JSON.parse;
    JSON.parse = function (text, ...rest) {
      const v = parse.call(this, text, ...rest);
      if (v && typeof v === "object" && Array.isArray(v.sessions) && "share" in v) {
        v.sessions = chats.map((c) => ({ ...c }));
        v.projects = [{ name: "proj", sessions: 2 }];
      }
      return v;
    };
  }, { chats: CHATS, standalone });
  return p;
}

const ready = (p) => until(p, () => window.app && app.view && app.view.sessions && app.view.sessions.length);

// Out of sight for ms, then back; tell(): what happens while it comes back.
async function away(p, ms, tell = null, arg = null) {
  await p.evaluate(() => { window.__hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  await p.evaluate((ms) => { window.__skew += ms; }, ms);
  if (tell) await p.evaluate(tell, arg);
  await p.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  await sleep(300);
}

const tapped = (url) => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { go: url } }));

async function phone(browser, port) {
  const where = "phone";
  const p = await page(browser, "phone", port, true);
  await p.goto("/");
  await ready(p);
  check(where, await p.evaluate(() => !app.session && !!document.querySelector(".list-view .start-chat")), "launched: the list and its new chat");

  await p.evaluate(() => go("#/s/proj-a"));
  check(where, await until(p, () => app.session && app.session.id === "proj-a"), "a chat opened");
  await away(p, 2 * MIN);
  check(where, await p.evaluate(() => !!app.session && app.session.id === "proj-a" && !app.session.closed), "back after 2 minutes: the same chat, open again");

  await away(p, 11 * MIN);
  check(where, await p.evaluate(() => !app.session && !!document.querySelector(".list-view .start-chat textarea")), "back after 11 minutes: the list and its new chat");
  await p.screenshot({ path: path.join(SHOTS, "phone-back-after-away.png") });

  // A notification tapped: the service worker says where before the page is back.
  await p.evaluate(() => go("#/s/proj-a"));
  await until(p, () => app.session && app.session.id === "proj-a");
  await away(p, 30 * MIN, tapped, "/#/s/proj-b");
  check(where, await p.evaluate(() => !!app.session && app.session.id === "proj-b"), "a notification tapped on the way back: its chat");
  // ...and when it says so after the page is back.
  await away(p, 30 * MIN);
  await p.evaluate(tapped, "/#/s/proj-a");
  check(where, await until(p, () => app.session && app.session.id === "proj-a"), "a notification tapped once back: its chat");

  check(where, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

async function wide(browser, port) {
  const where = "wide";
  // The home-screen app (Safari's Add to Dock): no address to keep the view in.
  let p = await page(browser, "wide", port, true);
  await p.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("desk-last", "proj-b"); localStorage.setItem("desk-mode", "chats"); sessionStorage.setItem("seeded", "1"); } });
  await p.goto("/");
  await ready(p);
  check(where, await until(p, () => desk.today && !desk.current && !!document.querySelector(".desk-empty:not([hidden]) .today")),
        "launched: Today, not the last chat");
  await sleep(300);
  await p.screenshot({ path: path.join(SHOTS, "wide-launched.png") });
  await p.evaluate(() => document.querySelector(".panel-buttons .new-chat").click());
  check(where, await until(p, () => desk.fresh && !!document.querySelector(".desk-empty:not([hidden]) .start-chat.wide")), "New chat: What do you want to do?");
  await sleep(300);
  check(where, await p.evaluate(() => document.activeElement && document.activeElement.matches(".start-chat textarea")), "its box has the keyboard");
  await p.keyboard.press("Escape");
  check(where, await until(p, () => desk.current === "proj-b"), "Escape: back to the last chat");
  await p.reload();
  await ready(p);
  check(where, await until(p, () => desk.current === "proj-b"), "reloaded: the chat it was on");
  check(where, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();

  // In a browser tab: a link to a chat opens that chat; the bare address, the new chat.
  p = await page(browser, "wide", port, false);
  await p.addInitScript(() => { try { localStorage.setItem("desk-mode", "chats"); } catch (e) { /* about:blank */ } });
  await p.goto("/#/s/proj-a");
  await ready(p);
  check(where, await until(p, () => desk.current === "proj-a"), "a link to a chat: that chat");
  await p.goto("about:blank");
  await p.goto("/");
  await ready(p);
  check(where, await until(p, () => desk.today && !desk.current && location.hash === "#/today"), "the bare address in a tab: Today, #/today");
  check(where, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

(async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "open-new-chat-home-"));
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const [layout, run] of [["phone", phone], ["wide", wide]]) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      await run(browser, port).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(home, { recursive: true, force: true });      // its own home: 70 MB in /tmp each run otherwise
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
