// The first tap on the mic dictates, on an iPhone too.
// An iPhone's home-screen app starts the audio only once a touch has ended,
// and before micOpen asked for the microphone in the touch itself it waited
// for the audio first: the first taps said the microphone didn't start, and
// iOS asked about the microphone only on a later one. Checked here with the
// audio held back the iPhone's way (iphone() below), Chromium's stand-in
// microphone and a stand-in for the host's dictation: one tap asks for the
// microphone at once, in the touch, listens once the finger lifts, and the
// words come into the box; the next dictation isn't asked about again.
//
//   node test/mic-first-tap.js
//
// Needs what test/brief-view.js needs (Chromium, playwright-core). It starts
// its own app server from this checkout's bin/amarchy, with a home and state
// of its own. Takes a few seconds. Exits 0 when every check passed.

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");

// The app server brief-view.js starts: the app's handler on 127.0.0.1, with
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


// The phone's audio as an iPhone's home-screen app has it: an AudioContext
// starts suspended, and resume() does nothing (its promise never settles)
// until a touch has ended (pointerup is a gesture for the audio, pointerdown
// isn't). Each getUserMedia says whether it was asked for in the touch
// itself, and the WebSocket to the host's dictation is a stand-in that
// writes "hello" down.
function iphone() {
  window.__gum = [];
  window.__inDown = false;
  window.__unlocked = false;
  window.addEventListener("pointerdown", () => { window.__inDown = true; }, true);
  window.addEventListener("pointerdown", () => { window.__inDown = false; });
  window.addEventListener("pointerup", () => { window.__unlocked = true; }, true);
  const Real = window.AudioContext;
  window.AudioContext = class extends Real {
    constructor(...a) { super(...a); Real.prototype.suspend.call(this); }
    resume() { return window.__unlocked ? Real.prototype.resume.call(this) : new Promise(() => {}); }
  };
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) => { window.__gum.push(window.__inDown); return gum(c); };
  window.__sent = 0;
  window.WebSocket = class {
    static OPEN = 1;
    constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 20); }
    send(d) {
      if (d !== "end") { window.__sent++; return; }
      setTimeout(() => { if (this.onmessage) this.onmessage({ data: JSON.stringify({ text: "hello" }) }); }, 20);
    }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  };
}

async function run(browser, port) {
  const where = "first tap";
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
                                         baseURL: `http://127.0.0.1:${port}`, permissions: ["microphone"] });
  const page = await ctx.newPage();
  const errors = [], toasts = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(iphone);
  await page.goto("/");
  await page.waitForFunction(() => typeof Dictate === "function" && document.readyState === "complete");
  await page.evaluate(() => {
    window.dictationHost = () => true;      // the host writes it down (the stand-in WebSocket)
    const field = document.createElement("textarea");
    const button = document.createElement("button");
    button.id = "test-mic";
    button.textContent = "mic";
    button.style.cssText = "position:fixed;left:20px;top:20px;width:80px;height:80px;z-index:99999";
    document.body.append(field, button);
    window.__field = field;
    window.__said = [];
    window.__dictate = new Dictate({ field, button, state: (t) => { if (t) window.__said.push(t); } });
    const t = window.toast;
    window.toast = (x) => { window.__toasts = (window.__toasts || []).concat(x); t(x); };
  });
  const box = await page.locator("#test-mic").boundingBox();
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.touchscreen.tap(at.x, at.y);      // the first tap of the app's life
  await page.waitForFunction(() => mic.take && window.__sent > 5, null, { timeout: 8000 }).catch(() => {});
  let s = await page.evaluate(() => ({ gum: window.__gum, ctx: mic.ctx && mic.ctx.state, take: !!mic.take, sent: window.__sent,
                                       said: window.__said, toasts: window.__toasts || [] }));
  check(where, s.gum.length === 1 && s.gum[0] === true, `the microphone is asked for in the touch itself (${JSON.stringify(s.gum)})`);
  check(where, s.ctx === "running" && s.take, `the audio starts once the finger lifts, and it listens (${JSON.stringify(s)})`);
  check(where, s.sent > 5, `what it hears goes to the host (${s.sent} pieces)`);
  check(where, !s.toasts.length, `nothing went wrong on the way (${JSON.stringify(s.toasts)})`);
  await page.touchscreen.tap(at.x, at.y);      // tapped again: done
  await page.waitForFunction(() => window.__field.value === "hello", null, { timeout: 5000 }).catch(() => {});
  s = await page.evaluate(() => ({ value: window.__field.value, on: window.__dictate.on() }));
  check(where, s.value === "hello" && !s.on, `the words are in the box, on the first try (${JSON.stringify(s)})`);

  // The next one, the microphone kept: not asked for again.
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForFunction(() => mic.take, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForFunction(() => !window.__dictate.on(), null, { timeout: 5000 }).catch(() => {});
  s = await page.evaluate(() => ({ gum: window.__gum.length, value: window.__field.value }));
  check(where, s.gum === 1 && s.value === "hello hello", `the next dictation takes the microphone kept, unasked (${JSON.stringify(s)})`);
  check(where, !errors.length, `no page errors (${errors.join("; ")})`);
}

(async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mic-first-tap-home-"));
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome(),
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  try {
    await run(browser, port).catch((e) => check("first tap", false, `crashed: ${e.stack}`));
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : "\nAll passed.");
  process.exit(failures.length ? 1 : 0);
})();
