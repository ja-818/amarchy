// Moving a chat to another machine, in a real browser (docs/plan-omarchy-
// and-machines.md, "Moving a chat", track E): two real amarchy app servers
// on this machine (alpha and beta, a home, state, port, name and tmux each;
// one origin for their project; a fake claude that keeps its transcript where
// Claude Code does and picks it up again), paired, and Chromium on alpha's
// app (the local key). In each layout, a chat of alpha's:
//
//   - its menu has "Move to beta…"; the sheet says what goes with it;
//   - at work: the sheet says so and offers "Move when it's free"; then its
//     box says it moves once it's free, and Cancel calls it off;
//   - beta's Claude doesn't come up: its box and its card say it didn't move,
//     and why; OK takes that away;
//   - moved: the chat open is beta's now (its head says beta, the address
//     beta:<id>), what was typed in its box went with it, its card on the board
//     keeps its place, beta's; its old link opens it on beta.
//
// Phone and wide, with screenshots.
//
//   node test/move-view.js          both layouts
//   node test/move-view.js phone    one layout (phone | wide)
//
// Needs Chromium and playwright-core (PLAYWRIGHT_CORE). Exits 0 when every
// check passed.

"use strict";

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "move-view-"));
const ONLY = process.argv[2];
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "move-view-home-"));
const USER = "tester@example.com";
const GIT_ID = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

const failures = [];
function check(where, ok, what) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${where}: ${what}`);
  if (!ok) failures.push(`${where}: ${what}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((ok, no) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
    s.on("error", no);
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

async function until(fn, ms = 15000, step = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* again */ }
    await sleep(step);
  }
  return null;
}

// A claude that keeps its conversation where Claude Code does and picks it up
// again (--resume; none there, or fail-resume in its home: it fails as Claude
// Code does), and takes its time on "slower".
const FAKE = path.join(BASE, "bin");
fs.mkdirSync(FAKE);
fs.writeFileSync(path.join(FAKE, "claude"), `#!/usr/bin/env python3
import json, os, re, sys, time, uuid
args = sys.argv[1:]
home = os.path.expanduser("~")
folder = os.path.join(home, ".claude", "projects", re.sub(r"[^A-Za-z0-9]", "-", os.getcwd()))
os.makedirs(folder, exist_ok=True)
sid = args[args.index("--resume") + 1] if "--resume" in args else str(uuid.uuid4())
log = os.path.join(folder, sid + ".jsonl")
if "--resume" in args and (not os.path.exists(log) or os.path.exists(os.path.join(home, "fail-resume"))):
    sys.stderr.write("No conversation found with session ID: " + sid + "\\n")
    sys.exit(1)
def say(o):
    sys.stdout.write(json.dumps(o) + "\\n"); sys.stdout.flush()
def record(role, text):
    with open(log, "a") as f:
        f.write(json.dumps({"type": role, "sessionId": sid, "cwd": os.getcwd(), "uuid": str(uuid.uuid4()),
                            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                            "message": {"role": role, "content": text if role == "user" else [{"type": "text", "text": text}]}}) + "\\n")
started = False
for line in sys.stdin:
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if o.get("type") == "control_request":
        say({"type": "control_response", "response": {"subtype": "success", "request_id": o["request_id"], "response": {}}})
    elif o.get("type") == "user":
        c = o["message"]["content"]
        text = c if isinstance(c, str) else " ".join(b.get("text", "") for b in c if isinstance(b, dict))
        open("got.txt", "a").write(text + "\\n")
        if not started:
            say({"type": "system", "subtype": "init", "session_id": sid, "model": "fake"})
            started = True
        record("user", text)
        if "slower" in text:
            time.sleep(20)
        answer = "Done: the door is blue." if "door" in text else "ok"
        record("assistant", answer)
        say({"type": "result", "subtype": "success", "is_error": False, "duration_ms": 10, "session_id": sid, "result": answer})
`, { mode: 0o755 });
// Never this machine's own tailscale (its tailscaled is the live host's).
fs.writeFileSync(path.join(FAKE, "tailscale"), "#!/bin/sh\n[ \"$1\" = status ] && { echo '{}'; exit 0; }\nexit 1\n", { mode: 0o755 });

// One origin for both machines' project.
const ORIGIN = path.join(BASE, "origin.git");
{
  const seed = path.join(BASE, "seed");
  fs.mkdirSync(seed);
  const git = (...a) => execFileSync("git", a, { cwd: seed, env: { ...process.env, ...GIT_ID }, stdio: "ignore" });
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", ORIGIN], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(seed, "README.md"), "# proj\n");
  fs.writeFileSync(path.join(seed, ".gitignore"), "got.txt\n");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  git("remote", "add", "origin", ORIGIN);
  git("push", "-q", "origin", "main");
}

class Machine {
  constructor(name, port) {
    this.name = name;
    this.port = port;
    this.home = path.join(BASE, name);
    this.url = `http://127.0.0.1:${port}`;
    this.socket = `amarchy-test-${process.pid}-${name}`;
    this.env = {
      HOME: this.home, XDG_STATE_HOME: `${this.home}/state`, XDG_CONFIG_HOME: `${this.home}/config`, AMARCHY_WORK: `${this.home}/Work`,
      AMARCHY_TMUX: this.socket, AMARCHY_HOST_NAME: name, AMARCHY_HOST_APP_PORT: String(port), AMARCHY_HOST_URL: this.url,
      AMARCHY_HOST_APP_LINKS: "off", AMARCHY_HOST_APP_USERS: USER, AMARCHY_HOST_BIND: "127.0.0.1", AUTO_UPDATE: "off",
      PATH: `${FAKE}:/usr/local/bin:/usr/bin:/bin`, LANG: "C.UTF-8", SHELL: "/bin/bash", TERM: "xterm-256color",
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || "", DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || "",
    };
    fs.mkdirSync(path.join(this.home, "Work"), { recursive: true });
    execFileSync("git", ["clone", "-q", ORIGIN, "proj"], { cwd: path.join(this.home, "Work"), env: { ...process.env, ...this.env }, stdio: "ignore" });
  }

  amarchy(...args) {
    try { return execFileSync("python3", [BIN, ...args], { env: this.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 }).trim(); }
    catch (e) { return `ERROR ${e.stderr || e.message}`; }
  }

  async start() {
    this.log = fs.openSync(path.join(this.home, "server.log"), "a");
    this.proc = spawn("python3", [BIN, "app", "serve"], { env: this.env, stdio: ["ignore", this.log, this.log], detached: true });
    await until(() => new Promise((ok) => { const s = net.connect(this.port, "127.0.0.1", () => { s.end(); ok(true); }); s.on("error", () => ok(false)); }), 15000, 100);
    this.key = fs.readFileSync(path.join(this.home, "state/amarchy/app/local.key"), "utf8").trim();
  }

  stop() {
    if (this.proc && this.proc.exitCode === null) { try { process.kill(-this.proc.pid, "SIGTERM"); } catch (e) { /* gone */ } }
    return until(() => this.proc.exitCode !== null || this.proc.signalCode !== null, 10000, 100);
  }

  own(id) {
    try { return JSON.parse(this.amarchy("list", "--compact")).find((s) => s.id === id) || null; } catch (e) { return null; }
  }
}

const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};

(async () => {
  const { chromium } = loadPlaywright();
  const alpha = new Machine("alpha", await freePort());
  const beta = new Machine("beta", await freePort());
  let browser;
  try {
    await alpha.start();
    await beta.start();
    const paired = alpha.amarchy("machines", "add", beta.url);
    check("setup", /paired with beta/.test(paired), `alpha pairs with beta (${paired.slice(0, 120)})`);
    // A chat of beta's too, so the board has both machines from the start.
    beta.amarchy("new", "proj", "there", "--prompt", "a chat that stays on beta");
    browser = await chromium.launch({ executablePath: findChrome() });

    for (const layout of Object.keys(LAYOUTS)) {
      if (ONLY && ONLY !== layout) continue;
      const where = layout;
      const name = `door-${layout}`, sid = `proj-${name}`, key = `beta:${sid}`;
      alpha.amarchy("new", "proj", name, "--prompt", "paint the door blue");
      alpha.amarchy("new", "proj", `other-${layout}`, "--prompt", "another chat, written to later");
      const up = await until(() => {
        const a = alpha.own(sid), b = alpha.own(`proj-other-${layout}`);
        return a && b && !a.setup && !b.setup && a.status === "idle" && b.status === "idle" ? a : null;
      }, 90000);
      check(where, !!up, `two chats on alpha, their first turns done (${sid}: ${JSON.stringify([sid, `proj-other-${layout}`].map((x) => { const r = alpha.own(x); return r && [r.setup, r.status]; }))})`);
      alpha.amarchy("priority", "high", "--id", sid);

      const ctx = await browser.newContext({ ...LAYOUTS[layout] });
      const p = await ctx.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.addInitScript(() => { try { localStorage.setItem("amarchy-push", "no"); localStorage.setItem("tour", "done"); } catch (e) { /* none */ } });
      await p.goto(`${alpha.url}/local?key=${alpha.key}`);
      const card = (id) => `.tcard[data-id="${id}"]`;
      check(where, !!(await until(() => p.evaluate((sel) => !!document.querySelector(sel), card(sid)), 20000)), "its card on alpha's board");
      const order = () => p.evaluate(() => [...document.querySelectorAll(".tcard[data-id]")].map((c) => c.dataset.id));

      // Its menu, on the phone the chat's sheet, on a computer its ⋯.
      const openChat = async (id) => {
        await p.evaluate((id) => go(`#/s/${encodeURIComponent(id)}`), id);
        return until(() => p.evaluate((id) => { const c = (app.session && app.session.chat) || desk.chat; return c && c.id === id && c.row ? true : null; }, id));
      };
      const openMenu = () => p.evaluate(() => { if (app.desk) sessionMenu(row(desk.current)); else app.session.menu(); });
      const menuMove = () => p.evaluate(() => {
        const items = [...document.querySelectorAll(".sheet button, .picker-row, .menu-item")];
        const b = items.find((x) => /^Move to beta…/.test(x.innerText.trim()));
        if (b) b.click();
        return !!b;
      });
      const sheetText = () => p.evaluate(() => { const s = [...document.querySelectorAll(".sheet")].pop(); return s ? s.innerText.replace(/\s+/g, " ") : ""; });
      const press = (label) => p.evaluate((label) => {
        const s = [...document.querySelectorAll(".sheet")].pop();
        const b = s && [...s.querySelectorAll("button")].find((x) => x.innerText.trim().startsWith(label));
        if (b) b.click();
        return !!b;
      }, label);
      const dock = (cls) => p.evaluate((cls) => { const n = document.querySelector(`.chat-dock .ui-move.${cls}`); return n ? n.innerText.replace(/\s+/g, " ") : null; }, cls);

      check(where, !!(await openChat(sid)), "the chat open");
      await openMenu();
      check(where, await menuMove(), "its menu: Move to beta…");
      const said = await until(async () => { const t = await sheetText(); return /Its work/.test(t) ? t : null; });
      check(where, !!said && /Its branch, pushed to origin/.test(said) && /conversation/.test(said) && /place on the board/.test(said),
            `the sheet says what goes with it (${(said || "").slice(0, 160)})`);
      await sleep(300);
      await p.screenshot({ path: path.join(SHOTS, `${where}-move-sheet.png`) });
      await p.evaluate(() => closeSheets());

      // At work: it waits until it's free, saying so; Cancel calls it off.
      await p.evaluate(() => { const c = (app.session && app.session.chat) || desk.chat; c.input.value = "this one is slower"; c.send(); });
      await until(() => alpha.own(sid) && alpha.own(sid).status === "working", 10000);
      await openChat(sid);        // (sent, both layouts are back on the board)
      await openMenu();
      await menuMove();
      const busy = await until(async () => { const t = await sheetText(); return /Not now/.test(t) ? t : null; });
      check(where, !!busy && /it's working: it moves once it's free/i.test(busy), `busy: the sheet says so (${(busy || "").slice(0, 200)})`);
      check(where, await press("Move when it's free"), "Move when it's free");
      const waiting = await until(() => dock("waiting"), 10000);
      check(where, !!waiting && /Moves to beta once it's free/.test(waiting), `its box: ${waiting}`);
      await sleep(300);
      await p.screenshot({ path: path.join(SHOTS, `${where}-move-waiting.png`) });
      await p.evaluate(() => { const b = document.querySelector(".chat-dock .ui-move.waiting .text-btn"); if (b) b.click(); });
      check(where, !!(await until(async () => !(await dock("waiting")), 10000)), "Cancel: it stays");
      check(where, !!(await until(() => alpha.own(sid) && alpha.own(sid).status === "idle", 30000)), "its turn ends, on alpha still");
      await sleep(1500);
      check(where, !!alpha.own(sid) && !beta.own(sid), "called off: never moved");

      // Beta's Claude doesn't come up: it didn't move, and says why.
      fs.writeFileSync(path.join(beta.home, "fail-resume"), "");
      await openMenu();
      await menuMove();
      await until(async () => /Its work/.test(await sheetText()));
      check(where, await press("Move to beta"), `Move to beta (${(await sheetText()).slice(-160)})`);
      const moving = await until(() => p.evaluate(() => { const n = document.querySelector(".chat-head .tpill, .desk-head .tpill"); return n && /Moving to beta/.test(n.textContent) ? n.textContent : null; }), 8000, 100);
      check(where, !!moving, `its head says it's moving (${moving})`);
      const failed = await until(() => dock("failed"), 40000);
      check(where, !!failed && /Didn't move to beta: its Claude didn't start on beta/.test(failed), `its box says why: ${failed}`);
      await sleep(300);
      await p.screenshot({ path: path.join(SHOTS, `${where}-move-failed.png`) });
      await p.evaluate(() => go("#/"));
      const cardSays = await until(() => p.evaluate((sel) => { const n = document.querySelector(`${sel} .ui-move.failed`); return n ? n.innerText : null; }, card(sid)));
      check(where, !!cardSays, `its card says so too (${cardSays})`);
      await sleep(300);
      await p.screenshot({ path: path.join(SHOTS, `${where}-move-failed-board.png`) });
      await p.evaluate((sel) => { const b = document.querySelector(`${sel} .ui-move.failed .text-btn`); if (b) b.click(); }, card(sid));
      check(where, !!(await until(() => p.evaluate((sel) => !document.querySelector(`${sel} .ui-move`), card(sid)), 10000)),
            "OK: gone");
      fs.unlinkSync(path.join(beta.home, "fail-resume"));

      // Moved, with what was typed in its box; its card where it was.
      await sleep(1500);
      const before = await order();
      await openChat(sid);
      await p.evaluate(() => { const c = (app.session && app.session.chat) || desk.chat; c.input.value = "half a thought"; c.input.dispatchEvent(new Event("input")); });
      await openMenu();
      await menuMove();
      await until(async () => /Its work/.test(await sheetText()));
      await press("Move to beta");
      const there = await until(() => p.evaluate((key) => { const c = (app.session && app.session.chat) || desk.chat; return c && c.id === key && c.row && c.row.machine === "beta" ? location.hash : null; }, key), 60000);
      check(where, !!there && decodeURIComponent(there) === `#/s/${key}`, `the chat open is beta's now (${there && decodeURIComponent(there)})`);
      const head = await p.evaluate(() => { const h = document.querySelector(".chat-head .ui-machine, .desk-head .ui-machine"); return h ? h.dataset.machine : ""; });
      check(where, head === "beta", `its head says beta (${head})`);
      const draft = await p.evaluate(() => { const c = (app.session && app.session.chat) || desk.chat; return c.input.value; });
      check(where, draft === "half a thought", `what was typed in its box went with it (${draft})`);
      check(where, !!beta.own(sid) && !alpha.own(sid), "on beta, off alpha");
      await sleep(800);
      await p.screenshot({ path: path.join(SHOTS, `${where}-moved-chat.png`) });
      await p.evaluate(() => go("#/"));
      const after = await until(async () => { const o = await order(); return o.includes(key) && !o.includes(sid) ? o : null; });
      const mapped = before.map((id) => (id === sid ? key : id));
      check(where, !!after && JSON.stringify(after.filter((id) => mapped.includes(id))) === JSON.stringify(mapped.filter((id) => after.includes(id))),
            `its card keeps its place, beta's now (${JSON.stringify(before)} → ${JSON.stringify(after)})`);
      const mark = await p.evaluate((sel) => { const c = document.querySelector(sel); return c ? ((c.querySelector(".ui-machine") || {}).dataset || {}).machine : null; }, card(key));
      check(where, mark === "beta", `its card says beta (${mark})`);
      await sleep(400);
      await p.screenshot({ path: path.join(SHOTS, `${where}-moved-board.png`) });
      // Its old link: where it is now.
      await p.evaluate((sid) => go(`#/s/${sid}`), sid);
      const led = await until(() => p.evaluate((key) => { const c = (app.session && app.session.chat) || desk.chat; return c && c.id === key ? decodeURIComponent(location.hash) : null; }, key));
      check(where, led === `#/s/${key}`, `its old link opens it on beta (${led})`);
      await p.evaluate(() => go("#/"));
      check(where, errors.length === 0, `no errors on the page (${errors.join("; ").slice(0, 300)})`);
      await ctx.close();
    }
  } catch (e) {
    console.error(e);
    failures.push(String(e));
  } finally {
    if (browser) await browser.close();
    for (const m of [alpha, beta]) {
      await m.stop();
      try { execFileSync("tmux", ["-L", m.socket, "kill-server"], { stdio: "ignore" }); } catch (e) { /* none */ }
    }
    if (failures.length) for (const m of [alpha, beta]) {
      try { console.log(`--- ${m.name}'s log\n${fs.readFileSync(path.join(m.home, "server.log"), "utf8").slice(-2000)}`); } catch (e) { /* none */ }
    }
    fs.rmSync(BASE, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  console.log(`\nscreenshots: ${SHOTS}`);
  console.log(failures.length ? `${failures.length} failed` : "all passed");
  process.exit(failures.length ? 1 : 0);
})();
