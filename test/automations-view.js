// Automations, in a browser: the clock opens them, from the phone's list and
// a computer's bar and menu; every timer of yours is listed under whose it
// is, with its schedule, next and last run; one opens to its facts and its
// log; Run now runs it and the result shows; Pause asks first, and pauses;
// Resume brings it back. Screenshots of each layout go to SHOTS.
//
//   node test/automations-view.js
//
// Needs what test/brief-view.js needs (Chromium, playwright-core). It starts
// its own app server from this checkout's bin/amarchy, with a home and state
// of its own, but systemctl --user is this machine's: the list is your real
// timers (only read), and Run now and Pause act on a test timer of its own
// (amarchy-view-test, made and removed here), never on one of yours.

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
    const py = spawn("python3", ["-c", SHIM, BIN, String(port), home], { stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, AMARCHY_WORK: process.env.AMARCHY_WORK || path.join(os.homedir(), "Work") } });      // whose: your projects
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


const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), "automations-shots");
const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};
const UNITS = path.join(os.homedir(), ".config", "systemd", "user");
const TEST = "amarchy-view-test";
const sh = (...a) => require("child_process").execFileSync(a[0], a.slice(1), { encoding: "utf8" });

function makeTimer() {
  fs.writeFileSync(path.join(UNITS, `${TEST}.service`), `[Unit]\nDescription=amarchy's view test: say hello\n[Service]\nType=oneshot\nExecStart=/bin/sh -c 'echo hello from the view test; sleep 1'\n`);
  fs.writeFileSync(path.join(UNITS, `${TEST}.timer`), `[Unit]\nDescription=amarchy's view test\nX-Amarchy-Name=View test\nX-Amarchy-About=A timer test/automations-view.js makes, and removes.\n[Timer]\nOnCalendar=*-*-* 03:33\n`);
  sh("systemctl", "--user", "daemon-reload");
  sh("systemctl", "--user", "start", `${TEST}.timer`);
}

function dropTimer() {
  try { sh("systemctl", "--user", "stop", `${TEST}.timer`); } catch (e) { /* gone */ }
  for (const f of [`${TEST}.service`, `${TEST}.timer`]) fs.rmSync(path.join(UNITS, f), { force: true });
  sh("systemctl", "--user", "daemon-reload");
}

async function run(browser, port, layout, home) {
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}` });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = async (name) => { await page.waitForTimeout(400); return page.screenshot({ path: path.join(SHOTS, `${layout}-${name}.png`) }); };
  await page.goto("/");
  await page.waitForFunction(() => typeof automationsSheet === "function" && document.readyState === "complete");
  const clock = page.locator(layout === "wide" ? ".toolbar .auto-btn" : ".hero .auto-btn").first();
  await clock.waitFor({ state: "attached", timeout: 8000 });
  if (layout === "phone") check(layout, await clock.isVisible(), "the clock is there");
  if (layout === "wide") {
    // The bar is there once there's a chat (this server has none): shown as it would be.
    await page.evaluate(() => { desk.toolbar.hidden = false; });
    check(layout, await clock.isVisible(), "the clock is in the list's bar");
    await shot("bar");
    await page.evaluate(() => { desk.toolbar.hidden = true; });
    await page.locator(".panel-buttons .brand").click();
    const item = page.locator(".picker-row", { hasText: "Automations" }).first();
    await item.waitFor({ timeout: 3000 }).catch(() => {});
    check(layout, await item.isVisible().catch(() => false), "the menu has Automations");
    await item.click();         // no chats here, so no bar: the menu's way in
  } else {
    await clock.click();
  }
  await page.locator(".auto-row").first().waitFor({ timeout: 8000 });
  const rows = await page.locator(".auto-row").evaluateAll((els) => els.map((e) => e.dataset.id));
  const real = sh("systemctl", "--user", "list-timers", "--all", "--no-legend", "--plain").split("\n")
    .map((l) => (l.match(/(\S+\.timer)/) || [])[1]).filter(Boolean);
  const nested = await page.evaluate(() => autoState.list.filter((a) => a.parent).map((a) => a.id));
  const missing = real.filter((t) => !rows.includes(t) && !nested.includes(t) && !/^systemd-/.test(t));
  check(layout, !missing.length, `every timer is listed, or under the one that armed it (missing: ${missing.join(", ") || "none"}; ${rows.length} rows, ${nested.length} under others)`);
  check(layout, !rows.some((r) => /^meet-/.test(r)), "a meeting's alarms aren't rows of their own");
  const sections = await page.locator(".sheet .section").allTextContents();
  check(layout, sections.includes("Amarchy") && sections.indexOf("Amarchy") === sections.length - 1, `grouped by whose, amarchy's own last (${sections.join(", ")})`);
  await shot("list");

  // One of them: its facts and its log.
  const beat = page.locator('.auto-row[data-id="jaken-heartbeat.timer"]');
  if (await beat.count()) {
    await beat.click();
    await page.locator(".auto-log-line").first().waitFor({ timeout: 8000 }).catch(() => {});
    const facts = await page.locator(".auto-fact dt").allTextContents();
    check(layout, ["When", "Next", "Last"].every((f) => facts.includes(f)), `the facts (${facts.join(", ")})`);
    check(layout, (await page.locator(".auto-log-line").count()) > 0, "its log");
    await shot("one");
    await page.locator(".sheet-close").last().click();
  }
  const meet = page.locator('.auto-row[data-id="meeting-sync.timer"]');
  if (await meet.count()) {
    await meet.click();
    await page.waitForTimeout(500);
    await shot("meetings");
    await page.locator(".sheet-close").last().click();
  }

  // The test timer: Run now, Pause (asked first), Resume.
  await page.evaluate(() => automationsGet());
  await page.locator(`.auto-row[data-id="${TEST}.timer"]`).click();
  await page.locator(".auto-actions .control", { hasText: "Run now" }).click();
  await page.waitForFunction(() => { const a = autoState.list.find((x) => x.id === "amarchy-view-test.timer"); return a && a.last && a.last.ok === true && a.state !== "running"; }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const ran = await page.locator(".auto-log-line", { hasText: "hello from the view test" }).count();
  check(layout, ran > 0, "Run now runs it, and its log shows it");
  await page.locator(".auto-actions .control", { hasText: "Pause" }).click();
  const ask = page.locator(".sheet h2", { hasText: "Pause View test?" });
  check(layout, await ask.isVisible().catch(() => false), "Pause asks first");
  await shot("pause");
  await page.locator(".control.danger", { hasText: "Pause it" }).click();
  await page.locator(".auto-actions .control", { hasText: "Resume" }).waitFor({ timeout: 8000 }).catch(() => {});
  const active = sh("systemctl", "--user", "show", "-p", "ActiveState", "--value", `${TEST}.timer`).trim();
  const drop = fs.existsSync(path.join(home, "config", "systemd", "user", `${TEST}.timer.d`, "zz-amarchy-paused.conf"));
  check(layout, active === "inactive" && drop, `paused: stopped, and kept from starting (${active}, drop-in ${drop})`);
  await page.locator(".auto-actions .control", { hasText: "Resume" }).click();
  await page.locator(".auto-actions .control", { hasText: "Pause" }).waitFor({ timeout: 8000 }).catch(() => {});
  const back = sh("systemctl", "--user", "show", "-p", "ActiveState", "--value", `${TEST}.timer`).trim();
  check(layout, back === "active", `resumed (${back})`);
  await shot("resumed");
  check(layout, !errors.length, `no page errors (${errors.join("; ")})`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  fs.mkdirSync(SHOTS, { recursive: true });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "automations-home-"));
  const port = await freePort();
  makeTimer();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of Object.keys(LAYOUTS)) await run(browser, port, layout, home).catch((e) => check(layout, false, `crashed: ${e.stack}`));
  } finally {
    await browser.close();
    server.kill();
    dropTimer();
  }
  console.log(`\nscreenshots: ${SHOTS}`);
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : "\nAll passed.");
  process.exit(failures.length ? 1 : 0);
})();
