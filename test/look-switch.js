// The Look sheet, in a browser: switch themes (in a row, and in quick taps),
// fonts and wallpapers, and check the page wears each one at once: its
// colours (the page's, the status bar's), its font and its wallpaper, with no
// unstyled flash in between, and the one last tapped kept on the host.
//
//   node test/look-switch.js            every scenario, a phone's and a wide screen's layout
//   node test/look-switch.js --themes 8  more themes in a row
//
// Needs a Chromium and Playwright's `playwright-core` (PLAYWRIGHT_CORE=<its folder>
// or on NODE_PATH; CHROME=<the chrome binary>, else the one Playwright installed,
// found under ~/.cache/ms-playwright). It starts its own app server from this
// checkout's bin/amarchy, with a home and state of its own: your look is not touched.
// Exits 0 when every check passed.

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");
const THEMES = Number(process.argv[process.argv.indexOf("--themes") + 1]) || 5;

// The app server as app_serve runs it, minus Tailscale: the same handler, on
// 127.0.0.1. Its Origin check wants https://<host> (tailscale serve's), so the
// shim makes the page's own Origin that; the user is the test's own.
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
  return undefined;     // Playwright's own, if it has one
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

// Waits (a few seconds at most) for `read()` to give `want`; returns what it read last.
async function settle(page, read, want, ms = 6000) {
  const t0 = Date.now();
  let got = await read();
  while (got !== want && Date.now() - t0 < ms) { await page.waitForTimeout(50); got = await read(); }
  return { got, took: Date.now() - t0 };
}

const failures = [];
function check(where, ok, what) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${where}: ${what}`);
  if (!ok) failures.push(`${where}: ${what}`);
}

// What the page shows: the page's own colours, the status bar, the font and
// the wallpaper, each as the browser computes it (a probe turns a var into rgb).
const WORN = () => {
  const root = getComputedStyle(document.documentElement);
  const probe = document.createElement("i");
  probe.style.display = "none";
  document.body.append(probe);
  const resolved = (expr) => { probe.style.color = expr; const c = getComputedStyle(probe).color; return c; };
  const out = {
    surface: resolved("var(--surface)"),
    pageBg: getComputedStyle(document.documentElement).backgroundColor,         // html: --surface
    wallBg: getComputedStyle(document.body, "::before").backgroundColor,       // the wallpaper's layer: --surface too
    bar: document.querySelector('meta[name="theme-color"]').getAttribute("content").toLowerCase(),
    font: root.getPropertyValue("--font").trim(),
    wallpaper: root.getPropertyValue("--wallpaper").trim(),
    sheets: document.querySelectorAll("link[rel=stylesheet][href^='theme.css']").length,
    looks: [...document.querySelectorAll("link[href^='theme.css']")].map((l) => l.getAttribute("href")),
  };
  probe.remove();
  return out;
};

async function openPage(browser, base, layout) {
  const ctx = await browser.newContext({ ...LAYOUTS[layout], extraHTTPHeaders: { "Tailscale-User-Login": "tester@test" } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForSelector("#look", { state: "attached" });
  // The service worker takes the page over, as on a phone that has used the app before.
  await page.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((ok) => setTimeout(ok, 5000))]));
  await page.reload();
  await page.waitForSelector("#look", { state: "attached" });
  await page.waitForTimeout(500);
  await page.evaluate(() => openLook());
  await page.waitForSelector(".theme-card", { state: "attached" });
  return { ctx, page, errors };
}

// Samples the page's surface colour every frame, from now until stopped.
async function watchFlashes(page) {
  await page.evaluate(() => {
    window.__seen = [];
    const probe = document.createElement("i");
    probe.style.display = "none";
    document.body.append(probe);
    const tick = () => {
      probe.style.color = "var(--surface)";
      const c = getComputedStyle(probe).color;
      if (window.__seen.at(-1) !== c) window.__seen.push(c);
      if (window.__stopWatch) return probe.remove();
      requestAnimationFrame(tick);
    };
    tick();
  });
}
async function stopWatch(page) {
  return page.evaluate(() => { window.__stopWatch = true; return window.__seen; });
}

// A colour as the browser computes it (rgb), whatever the page says it is.
const RGB = (expr) => {
  const probe = document.createElement("i");
  probe.style.display = "none";
  probe.style.color = expr;
  document.body.append(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  return rgb;
};
const SURFACE = () => {          // (as the page runs it: no closures from here)
  const probe = document.createElement("i");
  probe.style.display = "none";
  probe.style.color = "var(--surface)";
  document.body.append(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  return rgb;
};
const KEPT = async () => (await (await fetch("/api/look")).json()).look;

// Each theme in turn, the page wearing it before the next one is tapped.
async function themeRun(page, tag, names) {
  for (const name of names) {
    const card = page.locator(`.theme-card[aria-label="${name}"]`);
    const hex = (await card.evaluate((el) => el.style.getPropertyValue("--card-bg").trim())).toLowerCase();
    const want = await page.evaluate(RGB, hex);
    const before = await page.evaluate(SURFACE);
    await watchFlashes(page);
    await card.click();
    const { got, took } = await settle(page, () => page.evaluate(SURFACE), want);
    const seen = await stopWatch(page);
    const worn = await page.evaluate(WORN);
    const kept = await page.evaluate(KEPT);
    const where = `${tag} ${name}`;
    check(where, got === want, `surface ${got} (want ${want}) after ${took} ms`);
    check(where, worn.bar === hex, `status bar ${worn.bar} (want ${hex})`);
    check(where, worn.pageBg === worn.surface && worn.wallBg === worn.surface,
      `page ${worn.pageBg}, wallpaper layer ${worn.wallBg}: both --surface ${worn.surface}`);
    check(where, worn.sheets === 1, `one look in the page: ${worn.looks.join(" ")}`);
    check(where, kept.name === name, `kept on the host: ${kept.name}`);
    check(where, await page.evaluate(() => !!document.querySelector(".sheet-back.look")), "the picker is still open");
    const stray = seen.filter((c) => c !== before && c !== worn.surface);
    check(where, stray.length === 0, `no unstyled flash (colours seen: ${seen.join(", ")})`);
  }
}

async function scenario(browser, layout, base, names) {
  const tag = `[${layout}]`;
  console.log(`${tag} ${names.length} themes in a row`);
  const { ctx, page, errors } = await openPage(browser, base, layout);
  await themeRun(page, tag, names);

  // Taps in quick succession, no waiting for each to apply: the last one tapped is worn and kept.
  console.log(`${tag} quick taps`);
  const quick = names.slice(0, 4).reverse();
  for (const name of quick) await page.locator(`.theme-card[aria-label="${name}"]`).click({ force: true });
  const last = quick[quick.length - 1];
  const want = await page.evaluate(RGB, (await page.locator(`.theme-card[aria-label="${last}"]`).evaluate((el) => el.style.getPropertyValue("--card-bg").trim())).toLowerCase());
  const settled = await settle(page, () => page.evaluate(SURFACE), want, 8000);
  await page.waitForTimeout(1000);
  const worn = await page.evaluate(WORN);
  const kept = await page.evaluate(KEPT);
  check(`${tag} quick`, settled.got === want, `the last tapped (${last}) is worn: ${settled.got} (want ${want})`);
  check(`${tag} quick`, kept.name === last, `kept on the host: ${kept.name}`);
  check(`${tag} quick`, worn.sheets === 1, `one look in the page: ${worn.looks.join(" ")}`);

  // A slow connection (each look takes a while to come): the next one is tapped
  // before the one before it has come, and the last tapped is the one worn.
  console.log(`${tag} slow taps`);
  await ctx.route(/theme\.css/, async (route) => { await new Promise((ok) => setTimeout(ok, 900)); await route.continue(); });
  const slow = names.slice(names.length - 3);
  for (const name of slow) {
    await page.locator(`.theme-card[aria-label="${name}"]`).click({ force: true });
    await page.waitForTimeout(300);
  }
  const slowLast = slow[slow.length - 1];
  const slowWant = await page.evaluate(RGB, (await page.locator(`.theme-card[aria-label="${slowLast}"]`).evaluate((el) => el.style.getPropertyValue("--card-bg").trim())).toLowerCase());
  const slowSettled = await settle(page, () => page.evaluate(SURFACE), slowWant, 8000);
  await page.waitForTimeout(1500);
  const slowWorn = await page.evaluate(WORN);
  check(`${tag} slow`, slowSettled.got === slowWant, `the last tapped (${slowLast}) is worn: ${slowSettled.got} (want ${slowWant})`);
  check(`${tag} slow`, (await page.evaluate(KEPT)).name === slowLast, "kept on the host");
  check(`${tag} slow`, slowWorn.sheets === 1, `one look in the page: ${slowWorn.looks.join(" ")}`);
  await ctx.unrouteAll({ behavior: "wait" });

  // Fonts: another of the sheet's, then the first again.
  console.log(`${tag} fonts`);
  const fontButtons = page.locator(".sheet-back.look button.control:not(.wide)");
  if (await fontButtons.count() >= 2) {
    const beforeFont = (await page.evaluate(WORN)).font;
    const other = fontButtons.nth(1);
    const keptFont = (await page.evaluate(KEPT)).font;
    const name = (await other.textContent()).trim();
    await other.click();
    const t0 = Date.now();
    let font = beforeFont;
    while (font === beforeFont && Date.now() - t0 < 8000) { await page.waitForTimeout(100); font = (await page.evaluate(WORN)).font; }
    check(`${tag} font`, font !== beforeFont, `--font is now ${font} (${name})`);
    const keptNow = (await page.evaluate(KEPT)).font;
    check(`${tag} font`, keptNow !== keptFont, `kept on the host: ${keptNow}`);
    await fontButtons.nth(0).click();
    await page.waitForTimeout(1000);
  } else {
    console.log("  skip: fewer than two fonts to choose from");
  }

  // Wallpapers: another of the theme's (not your own picture, which opens a file dialog).
  console.log(`${tag} wallpapers`);
  const wall = page.locator('.sheet-back.look .wall-card:not(.on):not([aria-label^="Your own"])').first();
  if (await wall.count()) {
    const beforeWall = (await page.evaluate(WORN)).wallpaper;
    await wall.click();
    const t0 = Date.now();
    let now = beforeWall;
    while (now === beforeWall && Date.now() - t0 < 8000) { await page.waitForTimeout(100); now = (await page.evaluate(WORN)).wallpaper; }
    check(`${tag} wallpaper`, now !== beforeWall, `--wallpaper changed`);
  } else {
    console.log("  skip: no other wallpaper to choose from");
  }

  check(`${tag} errors`, errors.length === 0, errors.length ? errors.join(" | ") : "no page errors");
  await ctx.close();
}

(async () => {
  const chromium = loadPlaywright().chromium;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "amarchy-look-test-"));
  const port = await freePort();
  const server = await startServer(port, home);
  const base = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
  try {
    // The themes as the sheet lists them; the look worn at the start is the first one kept.
    const info = await (await fetch(base + "api/look", { headers: { "Tailscale-User-Login": "tester@test" } })).json();
    const start = info.theme;
    const pool = info.themes.filter((t) => t.key !== start).map((t) => t.name);
    const picks = pool.slice(0, THEMES);
    for (const layout of Object.keys(LAYOUTS)) await scenario(browser, layout, base, picks);
  } catch (err) {
    failures.push(err.stack || String(err));
    console.error(err);
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
  process.exit(0);
})();
