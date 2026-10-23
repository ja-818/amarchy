// The microphone is let go when you're not dictating, in a browser.
// Checked, with Chromium's stand-in microphone: a dictation's microphone is
// kept, off, right after it (the next one starts at once, unasked), and let
// go entirely (every track it got stopped, the audio closed) MIC_KEEP
// later, or at once when the page is out of sight; one let go comes back on
// the next dictation; and a dictation under way isn't cut off by either.
//
//   node test/mic-release.js
//
// Needs what test/brief-view.js needs (Chromium, playwright-core). It starts
// its own app server from this checkout's bin/amarchy, with a home and state
// of its own. Takes about a minute (it waits MIC_KEEP out). Exits 0 when
// every check passed.

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

// Every track the page got, live or not; the audio's state.
const state = (page) => page.evaluate(() => ({
  live: window.__tracks.filter((t) => t.readyState === "live").length,
  got: window.__tracks.length,
  enabled: window.__tracks.filter((t) => t.readyState === "live" && t.enabled).length,
  ctx: mic.ctx ? mic.ctx.state : null,
  kept: !!mic.stream,
}));

// A dictation as dictate.js runs one: opened, taken, let go.
const dictate = (page, ms) => page.evaluate(async (ms) => {
  await micOpen();
  mic.take = () => {};
  await new Promise((r) => setTimeout(r, ms));
  micRelease();
}, ms);

async function run(browser, port) {
  const where = "mic";
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
                                         baseURL: `http://127.0.0.1:${port}`, permissions: ["microphone"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Every track the page is given, and the page's visibility as the test says.
  await page.addInitScript(() => {
    window.__tracks = [];
    window.__hidden = false;
    Object.defineProperty(document, "visibilityState", { get: () => (window.__hidden ? "hidden" : "visible") });
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await gum(c);
      window.__tracks.push(...s.getTracks());
      return s;
    };
  });
  await page.goto("/");
  await page.waitForFunction(() => typeof micOpen === "function" && document.readyState === "complete");
  const keep = await page.evaluate(() => MIC_KEEP);

  await dictate(page, 300);
  let s = await state(page);
  check(where, s.live === 1 && s.enabled === 0 && s.ctx === "suspended", `kept, off, right after a dictation (${JSON.stringify(s)})`);
  await dictate(page, 300);
  s = await state(page);
  check(where, s.got === 1, `the next dictation soon after takes the one kept, unasked (${s.got} asked for)`);
  await sleep(keep - 3000);
  s = await state(page);
  check(where, s.live === 1, `still kept just before MIC_KEEP (${keep} ms) is up`);
  await sleep(4000);
  s = await state(page);
  check(where, s.live === 0 && s.ctx === null && !s.kept, `let go entirely MIC_KEEP after the last dictation (${JSON.stringify(s)})`);

  await dictate(page, 300);
  s = await state(page);
  check(where, s.live === 1 && s.got === 2, `opened anew by the next dictation (${JSON.stringify(s)})`);
  await page.evaluate(() => { window.__hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  s = await state(page);
  check(where, s.live === 0 && s.ctx === null, `let go at once when the page is out of sight (${JSON.stringify(s)})`);
  await page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event("visibilitychange")); });

  // Out of sight while dictating, and MIC_KEEP since an earlier one: it goes on.
  await page.evaluate(async () => { await micOpen(); mic.take = () => {}; });
  await page.evaluate(() => { window.__hidden = true; document.dispatchEvent(new Event("visibilitychange")); window.__hidden = false; });
  s = await state(page);
  check(where, s.live === 1 && s.enabled === 1, `a dictation under way isn't cut off by the page going out of sight (${JSON.stringify(s)})`);
  await page.evaluate(() => { micRelease(); micLetGo(); });
  s = await state(page);
  check(where, s.live === 0, `every track the page got is stopped in the end (${s.got} got, ${s.live} live)`);
  check(where, !errors.length, `no page errors (${errors.join("; ")})`);
}

(async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mic-release-home-"));
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome(),
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  try {
    await run(browser, port).catch((e) => check("mic", false, `crashed: ${e.stack}`));
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : "\nAll passed.");
  process.exit(failures.length ? 1 : 0);
})();
