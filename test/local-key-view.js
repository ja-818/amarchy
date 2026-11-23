// The desktop app's way in, in a real browser (Chromium; WebKitGTK is the
// desktop app's own test, desktop/): http://127.0.0.1:<port>/local?key=<the
// local key> and the app is there, its list streaming, a change from it
// done, its service worker up; the key gone from the address. A page on
// another port of 127.0.0.1 gets nowhere with it (the cookie stays the
// app's, and no answer lets it read). Phone and wide, with screenshots.
//
//   node test/local-key-view.js          both layouts
//   node test/local-key-view.js phone    one layout (phone | wide)
//
// Needs Chromium and playwright-core (PLAYWRIGHT_CORE). It starts its own
// app server from this checkout's bin/amarchy, with a home of its own, not
// told it's a test: nothing changes who it lets in. Exits 0 when every
// check passed.

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "local-key-view-"));
const ONLY = process.argv[2];

const SHIM = `
import importlib.machinery, importlib.util, json, os, sys, threading, time
bin, home = sys.argv[1], sys.argv[2]
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config", AMARCHY_WORK=home + "/work")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", bin)
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
import sys as _sys; _sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(bin)), "..", "test")); import isolate; isolate.timers(am)      # (test/isolate.py: none of this machine's automations)
am.app_key(); am.migrate()
am.SESSIONS.mkdir(parents=True, exist_ok=True)
(am.SESSIONS / "proj-local.json").write_text(json.dumps({"id": "proj-local", "repo": "proj", "name": "local", "path": home,
    "engine": "chat", "title": "Desktop: the local key", "created": int(time.time())}))
st = am.AppState(); st.transcriber = None
server = am.app_server_class()(("127.0.0.1", 0), am.app_handler(st, {"me@example.com"}, "box.example.ts.net"))
threading.Thread(target=am.app_watch, args=(st,), daemon=True).start()
print(server.server_address[1], am.local_key(), flush=True)
server.serve_forever()
`;

const failures = [];
function check(where, ok, what) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${where}: ${what}`);
  if (!ok) failures.push(`${where}: ${what}`);
}

function startServer(home) {
  return new Promise((ok, no) => {
    const py = spawn("python3", ["-c", SHIM, BIN, home], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    py.stderr.on("data", (d) => { err += d; });
    py.stdout.once("data", (d) => { const [port, key] = String(d).trim().split(" "); ok({ py, port: Number(port), key }); });
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

async function until(page, fn, arg, ms = 8000) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; }
}

const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};

(async () => {
  const { chromium } = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "local-key-view-home-"));
  const { py, port, key } = await startServer(home);
  // Another page on this machine, on another port: what it can do with the app.
  const evil = http.createServer((req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<p>elsewhere</p>"); });
  await new Promise((r) => evil.listen(0, "127.0.0.1", r));
  const evilPort = evil.address().port;
  const browser = await chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of Object.keys(LAYOUTS)) {
      if (ONLY && ONLY !== layout) continue;
      const where = layout;
      const ctx = await browser.newContext({ ...LAYOUTS[layout] });
      const p = await ctx.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.addInitScript(() => { try { localStorage.setItem("amarchy-push", "no"); localStorage.setItem("amarchy-toured", "1"); } catch (e) { /* none yet */ } });
      const before = await ctx.newPage();
      const r = await before.goto(`http://127.0.0.1:${port}/`);
      check(where, r.status() === 403, `without the key: refused (${r.status()})`);
      await before.close();
      await p.goto(`http://127.0.0.1:${port}/local?key=${key}`);
      check(where, new URL(p.url()).pathname === "/" && !p.url().includes(key), `in, the key out of the address (${p.url()})`);
      check(where, await until(p, () => typeof app !== "undefined" && app.view && (app.view.sessions || []).some((s) => s.id === "proj-local")), "the list streams in");
      check(where, await until(p, () => !!document.querySelector(".tcard[data-id=proj-local], [data-id=proj-local]")), "its chat's card is drawn");
      const cookies = await ctx.cookies(`http://127.0.0.1:${port}`);
      const c = cookies.find((x) => x.name === `amarchy_local_${port}`);
      check(where, !!c && c.httpOnly && c.sameSite === "Strict", `its cookie: HttpOnly, SameSite=Strict (${c && c.sameSite})`);
      check(where, await p.evaluate(() => document.cookie === ""), "the page can't read it");
      const goal = await p.evaluate(async () => { try { return (await api("/api/missions/goal", { goal: 2 })).goal; } catch (e) { return e.message; } });
      check(where, goal === 2, `a change from the app: done (${goal})`);
      check(where, await until(p, () => navigator.serviceWorker && navigator.serviceWorker.getRegistration().then((r) => !!(r && r.active))), "its service worker is up");
      await p.reload();
      check(where, await until(p, () => typeof app !== "undefined" && app.view && (app.view.sessions || []).length), "reloaded: still in (the cookie stays)");
      await p.waitForTimeout(800);
      await p.screenshot({ path: path.join(SHOTS, `${where}-local.png`) });
      // A page elsewhere on 127.0.0.1: no cookie goes with its requests (another
      // port is another site's page to the app), and what comes back it can't read.
      const other = await ctx.newPage();
      await other.goto(`http://127.0.0.1:${evilPort}/`);
      const read = await other.evaluate(async (port) => {
        try { const r = await fetch(`http://127.0.0.1:${port}/api/state`, { credentials: "include" }); return `read ${r.status}`; } catch (e) { return "blocked"; }
      }, port);
      check(where, read === "blocked", `a page on another port can't read the list (${read})`);
      const wrote = await other.evaluate(async (port) => {
        try { await fetch(`http://127.0.0.1:${port}/api/missions/goal`, { method: "POST", credentials: "include", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: '{"goal": 9}' }); return "sent"; } catch (e) { return "blocked"; }
      }, port);
      const after = await p.evaluate(async () => (await (await fetch("/api/state")).json()).missions.goal);
      check(where, after === 2, `nor change anything (a form-like post ${wrote}; the goal is still ${after})`);
      check(where, errors.length === 0, `no errors on the page (${errors.join("; ").slice(0, 200)})`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    evil.close();
    py.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(`\nscreenshots: ${SHOTS}`);
  console.log(failures.length ? `${failures.length} failed` : "all passed");
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
