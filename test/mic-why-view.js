// The mic before the host has its speech model, on the phone and on a
// computer: always there; the first tap has the host fetch it, a ring on
// the mic fills as it comes, and it says when it's ready; where it can't
// work, dimmed, and a tap says why in a line, with what to do. As on a
// laptop not set up yet (an Apple Silicon Mac on Omarchy) whose desktop app
// has no speech recognition of its own (WebKitGTK): no Web Speech here.
//
//   - no model, the engine to fetch (auto): the chat's mic and the new
//     chat's are lit; the first tap starts the setup on the host and says
//     so (770 MB, once), the ring fills as the board says how far, a tap
//     meanwhile says how far, and "Dictation is ready" once it's there;
//     Ctrl+Alt+D does the same on a computer; Settings offers it too;
//   - a processor amarchy has no engine for: dimmed; a tap says the host
//     needs a speech model, Set it up opens Settings at Dictation, which
//     says what would do;
//   - a setup under way: the ring, the tap says how far, Settings too;
//   - another machine has the model (via): the mic is lit, the tap
//     dictates through it and has the host fetch its own meanwhile, and
//     Settings says that machine writes it down for this one;
//   - the desktop app without GStreamer's microphone: dimmed even so, and a
//     tap names the package, with Copy the command.
//
//   node test/mic-why-view.js          both layouts
//   node test/mic-why-view.js phone    one layout (phone | wide)
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
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "mic-why-view-"));
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

const NOW = Date.now() / 1000;
const T = (o) => ({ goal: "", state: "", goal_at: 0, asks: [], at: NOW - 600, ...o });
const CHATS = [
  { id: "proj-fresh", repo: "proj", name: "fresh", task: "Fix: login loop", status: "idle", engine: "chat", path: "/tmp/f", today: T({ goal: "Fix the login loop" }) },
  { id: "proj-work", repo: "proj", name: "work", task: "Build: Today", status: "working", engine: "chat", path: "/tmp/w", today: T({ goal: "Make Today the home" }) },
];
const MACHINES = [
  { name: "ja", label: "ja", me: true, on: true, seen: true, icon: "laptop", projects: [{ name: "proj" }] },
  { name: "amarchy", label: "amarchy", me: false, on: true, seen: true, icon: "server", projects: [{ name: "proj" }] },
];

// This machine's dictation, as the board says it, per step.
const SIZE = 22562331 + 739508576;      // the engine and the model, both to fetch
const BASE = { ready: false, lib: false, model: false, engine: "Parakeet TDT 0.6B v3", size: SIZE, setup: null, arch: "aarch64", via: null,
               auto: true, buildable: false, how: "amarchy dictation setup (fetches transcribe.cpp 0.4.2 and Parakeet TDT 0.6B v3, 770 MB)", fix: "amarchy dictation setup" };
const STATES = {
  auto: { ...BASE },
  none: { ...BASE, arch: "riscv64", auto: false, fix: null,
          how: "amarchy has no speech engine for riscv64: build transcribe.cpp 0.4.2 (github.com/handy-computer/transcribe.cpp), set AMARCHY_DICTATE_ENGINE to the folder with its libtranscribe.so, then amarchy dictation setup; or pair a machine of yours that has it" },
  fetching: { ...BASE, setup: { pid: 1, size: SIZE, done: 300e6 } },
  via: { ...BASE, via: { name: "amarchy", label: "amarchy", engine: "Parakeet TDT 0.6B v3" } },
};

async function page(browser, layout, port) {
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}` });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.route("**/api/session/*/stream", (r) => r.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" }));
  await p.route("**/api/session/*/composer", (r) => r.fulfill({ json: { engine: "chat", commands: [], models: [], model: "opus", mode: "default" } }));
  await p.addInitScript(({ chats, states, machines }) => {
    // The desktop app on Linux: no speech recognition of its own.
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
    try { if (!localStorage.getItem("amarchy-push")) localStorage.setItem("amarchy-push", "no"); } catch (e) { /* no storage yet */ }
    const step = sessionStorage.getItem("mic-step") || "auto";
    if (sessionStorage.getItem("mic-lacks")) {
      window.amarchyDesktopMedia = Object.freeze({ sounds: true, native: false, dictation: false, packages: "gst-plugin-pipewire",
                                                  fix: "sudo pacman -S --needed gst-plugin-pipewire", play: () => () => {} });
    }
    window.__copied = [];
    const parse = JSON.parse;
    JSON.parse = function (text, ...rest) {
      const v = parse.call(this, text, ...rest);
      if (v && typeof v === "object" && Array.isArray(v.sessions) && "share" in v) {
        v.sessions = chats;
        v.projects = [{ name: "proj", sessions: 2 }];
        v.dictation = window.__dict || states[step];        // (window.__dict: the host's board after a step)
        if (step === "via") { v.machine = "ja"; v.machines = machines; }
      }
      return v;
    };
  }, { chats: CHATS, states: STATES, machines: MACHINES });
  return p;
}

async function at(p, step, { lacks = false } = {}) {
  await p.evaluate(({ step, lacks }) => { sessionStorage.setItem("mic-step", step); lacks ? sessionStorage.setItem("mic-lacks", "1") : sessionStorage.removeItem("mic-lacks"); },
                   { step, lacks });
  await p.goto("/#/s/proj-fresh");
  await p.reload();
  await until(p, () => window.app && app.view && app.view.dictation && [...document.querySelectorAll(".cbtn.mic")].some((b) => b.offsetParent), null, 10000);
  await p.evaluate(() => {
    window.__copied = [];
    window.copyText = (t) => { window.__copied.push(t); return Promise.resolve(); };
  });
  await sleep(300);
}

const mic = (p) => p.evaluate(() => {
  const b = [...document.querySelectorAll(".cbtn.mic")].find((x) => x.offsetParent);
  return b ? { shown: !b.hidden, cant: b.classList.contains("cant"), getting: b.classList.contains("getting"), got: b.style.getPropertyValue("--got"),
               opacity: getComputedStyle(b).opacity, title: b.title } : null;
});
const toastText = (p) => p.evaluate(() => { const t = document.querySelector(".toast"); return t ? t.innerText.replace(/\s+/g, " ").trim() : ""; });
const settingsText = (p) => p.evaluate(() => {
  const s = document.querySelector('.sheet-back.settings [data-section="dictation"]');
  if (!s) return "";
  const out = [];
  for (let el = s; el; el = el.nextElementSibling) {
    if (el !== s && el.classList.contains("section")) break;
    out.push(el.innerText);
  }
  return out.join("\n");
});

async function tapMic(p, layout) {
  const b = p.locator(".cbtn.mic:visible").first();
  if (layout === "phone") await b.tap();
  else await b.click();
  await sleep(250);
}

async function run(browser, layout, port) {
  const where = layout;
  const p = await page(browser, layout, port);
  await p.goto("/");

  // No model yet, the engine to fetch: the first tap fetches it.
  await at(p, "auto");
  let m = await mic(p);
  check(where, m && m.shown && !m.cant && !m.getting, `the chat's mic is there, lit (${JSON.stringify(m)})`);
  let posted = 0;
  await p.route("**/api/dictate/setup", (r) => { posted++; r.fulfill({ json: {} }); });
  await tapMic(p, layout);
  let t = await toastText(p);
  check(where, posted === 1 && /Getting dictation ready on your host: 770 MB, once\. The mic works as soon as it's here\./.test(t),
        `the first tap: the host fetches it, and says so (${posted}, "${t}")`);
  check(where, await p.evaluate(() => !document.body.classList.contains("dictating") && !document.querySelector(".cbtn.mic.on")),
        "nothing listens meanwhile");
  m = await mic(p);
  check(where, m && m.getting && !m.cant && Number(m.got) === 0, `a ring on the mic, empty (${JSON.stringify(m)})`);
  // The host's board: 300 MB of 770 there.
  await p.evaluate((st) => { window.__dict = st; app.view.dictation = st; dictationViewed(); }, STATES.fetching);
  m = await mic(p);
  check(where, m && m.getting && Math.abs(Number(m.got) - 300e6 / SIZE) < 0.01, `the ring fills as it comes (${m && m.got})`);
  await p.screenshot({ path: path.join(SHOTS, `mic-why-${where}-ring.png`) });
  await tapMic(p, layout);
  t = await toastText(p);
  check(where, posted === 1 && /Getting dictation ready on your host: 300 of 770 MB/.test(t) && /See how far/.test(t),
        `a tap meanwhile: how far, not asked again ("${t}")`);
  await p.screenshot({ path: path.join(SHOTS, `mic-why-${where}-ring-toast.png`) });
  // There: said so, and the mic is the mic.
  await p.evaluate(() => { document.querySelectorAll(".toast").forEach((x) => x.remove());
                           const st = { ...app.view.dictation, ready: true, lib: true, model: true, setup: null };
                           window.__dict = st; app.view.dictation = st; dictationViewed(); });
  t = await toastText(p);
  m = await mic(p);
  check(where, /Dictation is ready: hold the mic and speak/.test(t) && m && !m.getting && !m.cant, `once it's there: "${t}", the mic as ever (${JSON.stringify(m)})`);
  await p.screenshot({ path: path.join(SHOTS, `mic-why-${where}-ready.png`) });
  await p.evaluate(() => { window.__dict = null; });

  // Settings offers it too.
  await at(p, "auto");
  await p.evaluate(() => openSettings({ at: "dictation" }));
  await until(p, () => !!document.querySelector('.sheet-back.settings [data-section="dictation"]'));
  let s = await settingsText(p);
  check(where, /Your host can write down what you say, in Spanish, English and 23 more languages, told apart by themselves, once it has the speech model \(770 MB\)/.test(s)
        && /Set up dictation on your host/.test(s), `Settings offers it, with its button (${JSON.stringify(s.slice(0, 260))})`);
  check(where, !/whisper|pacman|build/i.test(s), "nothing to install or build");
  await p.screenshot({ path: path.join(SHOTS, `mic-why-${where}-settings-setup.png`) });
  posted = 0;
  await p.evaluate(() => [...document.querySelectorAll(".sheet-back.settings button")].find((b) => /Set up dictation/.test(b.innerText)).click());
  check(where, await until(p, () => /Fetching the speech model: 0 of 770 MB/.test(document.querySelector(".sheet-back.settings").innerText)) && posted === 1,
        "its button: setup starts, and Settings says so");
  await p.keyboard.press("Escape");

  // The new chat's mic: the same.
  await at(p, "auto");
  if (layout === "wide") {
    await p.evaluate(() => { if (desk.current) boardBack(true); });
    await until(p, () => !desk.current);
    await p.evaluate(() => { const b = document.querySelector(".board-new-btn, .new-chat-btn"); if (b) b.click(); });
    await sleep(400);
  } else {
    await p.evaluate(() => go("#/today"));
    await sleep(300);
    await p.evaluate(() => document.querySelector(".board-new-btn").click());
    // (Which project first, when there are several.)
    if (await until(p, () => !!document.querySelector(".sheet .ui-menu .menu-item.on"), null, 1500)) await p.click(".sheet .ui-menu .menu-item.on");
  }
  await until(p, () => [...document.querySelectorAll(".start-chat .mic:not(.pic)")].some((b) => b.offsetParent));
  const nm = await p.evaluate(() => {
    const b = [...document.querySelectorAll(".start-chat .mic:not(.pic)")].find((x) => x.offsetParent);
    return b ? { shown: !b.hidden, cant: b.classList.contains("cant") } : null;
  });
  check(where, nm && nm.shown && !nm.cant, `the new chat's mic: there, lit (${JSON.stringify(nm)})`);

  // Ctrl+Alt+D on a computer: the same first tap.
  if (layout === "wide") {
    await at(p, "auto");
    posted = 0;
    await p.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove()));
    await p.keyboard.down("Control"); await p.keyboard.down("Alt"); await p.keyboard.press("KeyD");
    await p.keyboard.up("Alt"); await p.keyboard.up("Control");
    await sleep(250);
    t = await toastText(p);
    check(where, posted === 1 && /Getting dictation ready/.test(t), `Ctrl+Alt+D: the same (${posted}, "${t}")`);
  }

  // A processor amarchy has no engine for: dimmed, and what would do.
  await at(p, "none");
  m = await mic(p);
  check(where, m && m.shown && m.cant && Number(m.opacity) < 0.6, `no engine for it: the mic is there, dimmed (${JSON.stringify(m)})`);
  posted = 0;
  await tapMic(p, layout);
  t = await toastText(p);
  check(where, /Dictation needs a speech model on your host/.test(t) && /Set it up/.test(t) && !posted, `a tap: why, and Set it up ("${t}")`);
  await p.screenshot({ path: path.join(SHOTS, `mic-why-${where}-dimmed.png`) });
  await p.evaluate(() => document.querySelector(".toast.act").click());
  check(where, await until(p, () => !!document.querySelector('.sheet-back.settings [data-section="dictation"]')), "Set it up: Settings opens");
  const seen = await p.evaluate(() => {
    const s = document.querySelector('.sheet-back.settings [data-section="dictation"]').getBoundingClientRect();
    const head = document.querySelector(".sheet-back.settings .sheet .head").getBoundingClientRect();
    return s.top >= head.bottom - 1 && s.top < innerHeight / 2;
  });
  check(where, seen, "at Dictation, its title just under the sheet's head");
  s = await settingsText(p);
  check(where, /amarchy has no speech engine for riscv64: build transcribe\.cpp 0\.4\.2/.test(s) && /AMARCHY_DICTATE_ENGINE/.test(s),
        `no engine for it: what would do (${JSON.stringify(s.slice(0, 200))})`);
  check(where, await p.evaluate(() => ![...document.querySelectorAll(".sheet-back.settings button")].some((b) => /Set up dictation|Copy the command/.test(b.innerText))),
        "no Set up button, nothing to copy");
  await p.screenshot({ path: path.join(SHOTS, `mic-why-${where}-settings-none.png`) });
  await p.keyboard.press("Escape");

  // A setup under way.
  await at(p, "fetching");
  m = await mic(p);
  check(where, m && m.getting && !m.cant, `under way: the ring (${JSON.stringify(m)})`);
  posted = 0;
  await tapMic(p, layout);
  t = await toastText(p);
  check(where, /Getting dictation ready on your host: 300 of 770 MB/.test(t) && !posted, `the tap says how far ("${t}")`);
  await p.evaluate(() => openSettings({ at: "dictation" }));
  await until(p, () => !!document.querySelector('.sheet-back.settings [data-section="dictation"]'));
  s = await settingsText(p);
  check(where, /Fetching the speech model: 300 of 770 MB/.test(s), `Settings: how far (${JSON.stringify(s.slice(0, 160))})`);
  await p.keyboard.press("Escape");
  // One that ends without the model (an install's: the engine alone): the tap asked for it, so it comes next.
  await p.evaluate(() => { const st = { ...app.view.dictation, lib: true, setup: null, size: 739508576 }; window.__dict = st; app.view.dictation = st; dictationViewed(); });
  await sleep(200);
  m = await mic(p);
  check(where, posted === 1 && m && m.getting, `an install's setup ended without the model: the model comes next, by itself (${posted}, ${JSON.stringify(m)})`);
  await p.evaluate(() => { window.__dict = null; });

  // Another machine has the model: lit, and Settings says who writes it down.
  await at(p, "via");
  m = await mic(p);
  check(where, m && m.shown && !m.cant && !m.getting, `amarchy writes it down: the mic is lit (${JSON.stringify(m)})`);
  await p.evaluate(() => openSettings({ at: "dictation" }));
  await until(p, () => !!document.querySelector('.sheet-back.settings [data-section="dictation"]'));
  s = await settingsText(p);
  check(where, /ja has no speech model, so it sends what you say to amarchy, another machine of yours, which writes it down/.test(s),
        `Settings: amarchy writes it down for ja (${JSON.stringify(s.slice(0, 200))})`);
  check(where, /Set up dictation on ja/.test(s) && /itself/.test(s), "and how to have ja do it itself");
  await p.screenshot({ path: path.join(SHOTS, `mic-why-${where}-settings-via.png`) });
  await p.keyboard.press("Escape");
  posted = 0;
  await tapMic(p, layout);
  t = await toastText(p);
  check(where, posted === 1 && !/Getting dictation ready/.test(t), `a tap dictates through amarchy, and has this host fetch its own quietly (${posted}, "${t}")`);
  await p.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove()));

  // The desktop app without GStreamer's microphone: dimmed even so.
  await at(p, "via", { lacks: true });
  m = await mic(p);
  check(where, m && m.shown && m.cant, `no microphone in the desktop app: dimmed (${JSON.stringify(m)})`);
  await tapMic(p, layout);
  t = await toastText(p);
  check(where, /Dictation here needs gst-plugin-pipewire/.test(t) && /Copy the command/.test(t), `a tap: the package, to copy ("${t}")`);
  await p.evaluate(() => document.querySelector(".toast.act").click());
  await sleep(100);
  check(where, (await p.evaluate(() => window.__copied))[0] === "sudo pacman -S --needed gst-plugin-pipewire", "Copy the command: pacman's line");
  await p.screenshot({ path: path.join(SHOTS, `mic-why-${where}-lacks.png`) });

  check(where, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

(async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mic-why-home-"));
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of Object.keys(LAYOUTS)) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      await run(browser, layout, port).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\nscreenshots: ${SHOTS}`);
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : "\nAll passed.");
  process.exit(failures.length ? 1 : 0);
})();
