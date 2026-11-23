// A cloud machine in one click, in a real browser (docs/plan-omarchy-and-
// machines.md, track F): alpha's real app server with fake clouds
// (test/cloud_fakes.py: Hetzner's real shapes; a fake VM that starts, joins a
// fake tailnet and reports its setup) and, for each layout, a real amarchy
// playing the new machine (started once it says its app is on, as a real one
// answers then). In Chromium, phone and wide, from Settings → Machines:
//
//   - Add a cloud machine: Hetzner picked, its token given in the sheet's own
//     field (a wrong one refused there, in Hetzner's words), its locations and
//     sizes with their prices (8 GB recommended, picked), the name, the
//     one-off Tailscale key, Create with its price on it;
//   - its sheet as it comes up: each step, live (created, started, installing,
//     on your tailnet, paired), its price and how it's billed;
//   - then Sign in to Claude there (the link, the code pasted) and to GitHub
//     (its code to type, it ends by itself), the board's row saying so;
//   - its machine sheet: its cloud, its price, signed in; Remove: it says
//     what goes, then it's deleted at Hetzner and the list says so.
//
// The phone's and the wide's sheets are compared: the same sections,
// steps, buttons and words (but for the machine's name). Screenshots of each.
//
//   node test/cloud-view.js          both layouts
//   node test/cloud-view.js phone    one layout (phone | wide)
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
const TMP = process.env.TMPDIR || path.join(os.homedir(), ".cache");
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(TMP, "cloud-view-"));
const ONLY = process.argv[2];
const BASE = fs.mkdtempSync(path.join(TMP, "cloud-view-home-"));
const USER = "tester@example.com";
const TAILNET = path.join(BASE, "tailnet.json");

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

const FAKE = path.join(BASE, "bin");
execFileSync("python3", [path.join(ROOT, "test", "cloud_fakes.py"), "--bins", FAKE]);
fs.writeFileSync(TAILNET, JSON.stringify({ BackendState: "Running", Peer: {} }));
const REACH = {};

class Machine {
  constructor(name, port, fakes) {
    this.name = name;
    this.port = port;
    this.home = path.join(BASE, name);
    this.url = `http://127.0.0.1:${port}`;
    this.socket = `amarchy-cloudview-${process.pid}-${name}`;
    this.env = {
      HOME: this.home, XDG_STATE_HOME: `${this.home}/state`, XDG_CONFIG_HOME: `${this.home}/config`, AMARCHY_WORK: `${this.home}/Work`,
      AMARCHY_TMUX: this.socket, AMARCHY_HOST_NAME: name, AMARCHY_HOST_APP_PORT: String(port), AMARCHY_HOST_URL: this.url,
      AMARCHY_HOST_APP_LINKS: "off", AMARCHY_HOST_APP_USERS: USER, AMARCHY_PEER_SILENT: "6", AUTO_UPDATE: "off",
      PATH: `${FAKE}:/usr/local/bin:/usr/bin:/bin`, LANG: "C.UTF-8", SHELL: "/bin/bash", TERM: "xterm-256color",
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || "", DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || "",
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      FAKE_TAILNET: TAILNET, AMARCHY_CLOUD_NO_UNITS: "1", AMARCHY_CLOUD_POLL: "0.5",
      AMARCHY_CLOUD_API_HETZNER: `${fakes}/hetzner/v1`, AMARCHY_CLOUD_API_DIGITALOCEAN: `${fakes}/digitalocean/v2`,
      AMARCHY_CLOUD_API_HOSTINGER: `${fakes}/hostinger`,
    };
    const dir = path.join(this.home, "Work", "proj");
    fs.mkdirSync(dir, { recursive: true });
    const git = (...a) => execFileSync("git", a, { cwd: dir, env: this.env, stdio: "ignore" });
    git("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(dir, "README.md"), `# proj on ${name}\n`);
    git("add", ".");
    git("commit", "-q", "-m", "first");
  }

  amarchy(...args) {
    try { return execFileSync("python3", [BIN, ...args], { env: { ...this.env, AMARCHY_CLOUD_REACH: JSON.stringify(REACH) }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 }).trim(); }
    catch (e) { return `ERROR ${e.stderr || e.message}`; }
  }

  async start() {
    this.log = fs.openSync(path.join(this.home, "server.log"), "a");
    this.proc = spawn("python3", [BIN, "app", "serve"], { env: { ...this.env, AMARCHY_CLOUD_REACH: JSON.stringify(REACH) }, stdio: ["ignore", this.log, this.log], detached: true });
    await until(() => new Promise((ok) => { const s = net.connect(this.port, "127.0.0.1", () => { s.end(); ok(true); }); s.on("error", () => ok(false)); }), 15000, 100);
    this.key = await until(() => fs.readFileSync(path.join(this.home, "state/amarchy/app/local.key"), "utf8").trim(), 10000);
    return true;
  }

  stop() {
    if (this.proc && this.proc.exitCode === null) { try { process.kill(-this.proc.pid, "SIGTERM"); } catch (e) { /* gone */ } }
    for (const s of [this.socket, `${this.socket}-signin`]) { try { execFileSync("tmux", ["-L", s, "kill-server"], { stdio: "ignore" }); } catch (e) { /* none */ } }
    return this.proc ? until(() => this.proc.exitCode !== null || this.proc.signalCode !== null, 10000, 100) : null;
  }

  cloud() {
    try { return Object.fromEntries(JSON.parse(fs.readFileSync(path.join(this.home, "config/amarchy/cloud.json"), "utf8")).map((r) => [r.name, r])); }
    catch (e) { return {}; }
  }
}

function vmFor(name, port, fakes) {
  const m = new Machine(name, port, fakes);
  fs.mkdirSync(path.join(m.home, "config/amarchy"), { recursive: true });
  fs.writeFileSync(path.join(m.home, "config/amarchy/cloud-self.json"), JSON.stringify({ provider: "hetzner", by: "alpha", made: Math.floor(Date.now() / 1000) }));
  fs.writeFileSync(path.join(m.home, "config/amarchy/icon"), "cloud\n");
  REACH[name] = m.url;
  return m;
}

const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};

// What a sheet says, to compare the phone's with the wide's: its head, its
// sections, its steps, its buttons, its words (the machine's name made X).
async function sheetSays(p, name) {
  return p.evaluate((name) => {
    const s = [...document.querySelectorAll(".sheet-back:not([hidden]) .sheet")].pop();
    if (!s) return null;
    const t = (el) => el.innerText.replace(/\s+/g, " ").trim().split(name).join("X").replace(/\d{1,2}:\d\d( [AP]M)?/g, "T");
    return {
      head: t(s.querySelector("h2")), sections: [...s.querySelectorAll(".section")].map(t),
      steps: [...s.querySelectorAll(".ui-step")].map((x) => `${x.className.replace("ui-step ", "")}: ${t(x.querySelector(".ui-step-label"))}`),
      picks: [...s.querySelectorAll(".ui-pick-row")].map(t), buttons: [...s.querySelectorAll("button:not(.sheet-close), a.control")].map(t).filter(Boolean),
    };
  }, name);
}

async function tap(p, text, sel = "button, a.control") {
  const ok = await p.evaluate(({ text, sel }) => {
    const s = [...document.querySelectorAll(".sheet-back:not([hidden]) .sheet")].pop();
    const b = s && [...s.querySelectorAll(sel)].find((x) => x.innerText.replace(/\s+/g, " ").trim().startsWith(text) && !x.disabled);
    if (!b) return false;
    b.scrollIntoView({ block: "center" });
    if (b.tagName === "A") return true;
    b.click();
    return true;
  }, { text, sel });
  await sleep(150);
  return ok;
}

async function shot(p, where, what) {
  await sleep(250);
  await p.screenshot({ path: path.join(SHOTS, `${where}-${what}.png`) });
}

(async () => {
  const { chromium } = loadPlaywright();
  const fakesPort = await freePort();
  const fakesLog = fs.openSync(path.join(BASE, "fakes.log"), "a");
  const fakes = spawn("python3", [path.join(ROOT, "test/cloud_fakes.py"), "--port", String(fakesPort), "--tailnet", TAILNET, "--slow", "2"],
                      { stdio: ["ignore", fakesLog, fakesLog] });
  const FAKES = `http://127.0.0.1:${fakesPort}`;
  await until(() => new Promise((ok) => { const s = net.connect(fakesPort, "127.0.0.1", () => { s.end(); ok(true); }); s.on("error", () => ok(false)); }), 10000, 100);
  const alpha = new Machine("alpha", await freePort(), FAKES);
  const vms = { phone: vmFor("cloud-phone", await freePort(), FAKES), wide: vmFor("cloud-wide", await freePort(), FAKES) };
  const said = {};
  let browser;
  try {
    await alpha.start();
    browser = await chromium.launch({ executablePath: findChrome() });
    for (const layout of Object.keys(LAYOUTS)) {
      if (ONLY && ONLY !== layout) continue;
      const where = layout, vm = vms[layout], name = vm.name;
      said[where] = {};
      // Each layout gives the token and the key itself.
      alpha.amarchy("machines", "cloud", "token", "hetzner", "--forget");
      const ctx = await browser.newContext({ ...LAYOUTS[layout] });
      const p = await ctx.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.addInitScript(() => { try { localStorage.setItem("amarchy-push", "no"); localStorage.setItem("tour", "done"); } catch (e) { /* none */ } });
      await p.goto(`${alpha.url}/local?key=${alpha.key}`);
      await until(() => p.evaluate(() => !!(app.view && app.view.machines)));

      // Settings → Machines → Add a cloud machine.
      await p.evaluate(() => openSettings());
      const rows = await until(() => p.evaluate(() => [...document.querySelectorAll(".sheet .machine-row")].map((b) => b.innerText.replace(/\s+/g, " ").trim())).then((r) => (r.length ? r : null)));
      check(where, !!rows && /alpha.*Sign in to Claude/.test(rows[0]), `Settings → Machines: this machine, its Claude not signed in (${JSON.stringify(rows)})`);
      check(where, await tap(p, "Add a cloud machine"), "Add a cloud machine…");
      await until(() => sheetSays(p, name).then((s) => s && s.head === "Add a cloud machine" && s.picks.length === 3 ? s : null));
      check(where, await p.evaluate(() => !document.querySelector(".ui-pick-row.on")), "no provider connected yet: none picked");
      check(where, await tap(p, "Hetzner Cloud", ".ui-pick-row"), "Hetzner picked");
      let s = await until(() => sheetSays(p, name).then((x) => (x && x.sections.includes("Connect Hetzner Cloud") ? x : null)));
      check(where, !!s && s.buttons.some((b) => b === "Make a token at Hetzner Cloud") && s.buttons.includes("Connect"),
            `its token asked for: the link to make one, Connect (${s && s.buttons.join(" | ")})`);
      said[where].connect = s;
      await shot(p, where, "connect");
      await p.fill(".sheet .secret-value", "wrong-token");
      await tap(p, "Connect");
      const refused = await until(() => p.evaluate(() => { const t = document.querySelector(".toast"); return t && /didn't take the token/.test(t.innerText) ? t.innerText : null; }), 8000);
      check(where, !!refused, `a wrong token: refused in Hetzner's words (${refused})`);
      await p.fill(".sheet .secret-value", "good-hetzner");
      await tap(p, "Connect");
      s = await until(() => sheetSays(p, name).then((x) => (x && x.picks.some((r) => /Recommended/.test(r)) ? x : null)), 15000);
      check(where, !!s && s.sections.join(",") === "Provider,Where,Size,Name,Tailscale", `connected: where, size, name, Tailscale (${s && s.sections})`);
      check(where, !!s && s.picks.some((r) => /^Hetzner Cloud.*Connected/.test(r)), "Hetzner says Connected");
      const picked = await p.evaluate(() => [...document.querySelectorAll(".ui-pick-row.on")].map((b) => b.innerText.replace(/\s+/g, " ").trim()));
      check(where, picked.length === 3 && /Falkenstein/.test(picked[1]) && /^CX33 Recommended/.test(picked[2]) && /€5\.99\/mo/.test(picked[2]),
            `Falkenstein and CX33 (recommended, €5.99/mo) picked for you (${JSON.stringify(picked)})`);
      check(where, s.picks.some((r) => /^CX23.*under 8 GB: fewer chats.*€3\.99\/mo/.test(r)), "a smaller size says it runs fewer chats");
      await p.fill(".sheet input[aria-label='Its name']", name);
      s = await sheetSays(p, name);
      check(where, s.buttons.includes("Make a one-off key at Tailscale") && s.buttons.some((b) => b.startsWith("Create")), "the Tailscale key asked for, with the link to make one");
      const createOff = await p.evaluate(() => document.querySelector(".cloud-create").disabled);
      check(where, createOff, "Create waits for the key");
      await p.evaluate(() => { const i = [...document.querySelectorAll(".sheet .secret-value")].pop(); i.scrollIntoView({ block: "center" }); });
      await p.fill(".sheet .secret-value >> nth=-1", "tskey-auth-kVIEW-0123");
      await tap(p, "Keep the key");
      const create = await until(() => p.evaluate(() => { const b = document.querySelector(".cloud-create"); return b && !b.disabled ? b.innerText.trim() : null; }), 8000);
      check(where, create === `Create ${name} · €5.99 a month`, `Create says its price: ${create}`);
      said[where].add = await sheetSays(p, name);
      await p.evaluate(() => document.querySelector(".cloud-create").scrollIntoView({ block: "center" }));
      await shot(p, where, "add");

      // It comes up: its steps, live. Its amarchy answers once it says its app is on.
      const up = until(() => (alpha.cloud()[name] && (alpha.cloud()[name].steps || {})["report:app"]) ? vm.start() : null, 60000, 300);
      await tap(p, "Create");
      s = await until(() => sheetSays(p, name).then((x) => (x && x.head === "X" && x.steps.length ? x : null)), 10000);
      check(where, !!s && s.steps[0] === "done: Created at Hetzner Cloud", `its sheet: created (${s && s.steps.join(" / ")})`);
      const mid = await until(() => sheetSays(p, name).then((x) => (x && x.steps.some((t) => /^now: (Installing|On your tailnet)/.test(t)) ? x : null)), 20000);
      check(where, !!mid, `under way: one step spins (${mid && mid.steps.join(" / ")})`);
      await shot(p, where, "coming-up");
      check(where, !!(await up), "its amarchy came up");
      s = await until(() => sheetSays(p, name).then((x) => (x && x.steps.includes(`done: Paired with alpha`) && x.steps.length === 6 ? x : null)), 45000);
      check(where, !!s && s.steps.slice(0, 5).every((t) => t.startsWith("done:")) && s.steps[5] === "next: Claude signed in there",
            `paired: every step done, Claude next (${s && s.steps.join(" / ")})`);
      check(where, !!s && s.buttons.includes(`Sign in to Claude on X`) && s.buttons.includes(`Sign in to GitHub on X`), "Sign in to Claude, and to GitHub, there");
      said[where].paired = s;
      const cost = await p.evaluate(() => document.querySelector(".sheet .cloud-cost").innerText);
      check(where, cost === "Hetzner Cloud · €5.99 a month", `its price where it's made: ${cost}`);
      await shot(p, where, "paired");

      // Sign in to Claude there: the link, the code.
      await tap(p, "Sign in to Claude on");
      s = await until(() => sheetSays(p, name).then((x) => (x && x.head === "Sign in to Claude" && x.buttons.includes("Open the sign-in page") ? x : null)), 15000);
      check(where, !!s, "Claude's sign-in: the page to open, a box for its code");
      const href = await p.evaluate(() => [...document.querySelectorAll(".sheet a.control")].pop().href);
      check(where, href.startsWith("https://claude.com/cai/oauth/authorize"), "its link is Anthropic's sign-in page");
      said[where].claude = s;
      await shot(p, where, "signin-claude");
      await p.fill(".sheet input[aria-label='The code']", "good-code#state");
      await tap(p, "Sign in");
      const claudeIn = await until(() => p.evaluate(() => { const t = document.querySelector(".toast"); return t && /Claude is signed in/.test(t.innerText) ? t.innerText : null; }), 20000);
      check(where, !!claudeIn, `signed in (${claudeIn})`);
      // GitHub: its code to type there; it ends by itself.
      await until(() => sheetSays(p, name).then((x) => x && x.head === "X"));
      await tap(p, "Sign in to GitHub on");
      s = await until(() => sheetSays(p, name).then((x) => (x && x.head === "Sign in to GitHub" && x.buttons.includes("ABCD-1234") ? x : null)), 15000);
      check(where, !!s && s.buttons.includes("Open github.com/login/device"), "GitHub's code to copy, and its page");
      said[where].github = s;
      await shot(p, where, "signin-github");
      const ghIn = await until(() => p.evaluate(() => { const t = document.querySelector(".toast"); return t && /GitHub is signed in/.test(t.innerText) ? t.innerText : null; }), 20000);
      check(where, !!ghIn, "GitHub signed in by itself");
      const doneSteps = await until(() => sheetSays(p, name).then((x) => (x && x.steps.includes("done: Claude signed in there") ? x : null)), 75000);
      check(where, !!doneSteps, "its sheet: Claude signed in there, done");

      // Its row and its machine sheet.
      await p.evaluate(() => { closeSheets(); openSettings(); });
      const row = await until(() => p.evaluate((name) => { const b = [...document.querySelectorAll(".sheet .machine-row")].find((x) => x.innerText.includes(name)); const t = b ? b.innerText.replace(/\s+/g, " ").trim() : ""; return / On$/.test(t) ? t : null; }, name), 15000);
      check(where, !!row && /€5\.99\/mo/.test(row) && /On/.test(row), `its row: its price, On (${row})`);
      await p.evaluate((name) => { const b = [...document.querySelectorAll(".sheet .machine-row")].find((x) => x.innerText.includes(name)); b.scrollIntoView({ block: "center" }); }, name);
      await shot(p, where, "settings-row");
      await p.evaluate((name) => machineSheet(name), name);
      s = await until(() => sheetSays(p, name).then((x) => (x && x.sections.includes("Cloud") ? x : null)), 10000);
      check(where, !!s && s.sections.includes("Signed in") && s.buttons.some((b) => b.startsWith("Remove (deletes it at Hetzner Cloud)")),
            `its sheet: its cloud, signed in, Remove deletes it at Hetzner (${s && s.sections.join(",")})`);
      said[where].machine = s;
      await p.evaluate(() => { const x = [...document.querySelectorAll(".sheet .section")].find((e) => e.innerText === "Cloud"); x.scrollIntoView({ block: "start" }); });
      await shot(p, where, "machine");

      // Remove: what goes with it, then deleted at Hetzner.
      await tap(p, "Remove (deletes it at Hetzner Cloud)");
      s = await until(() => sheetSays(p, name).then((x) => (x && /^Remove X\?/.test(x.head) ? x : null)), 8000);
      const words = await p.evaluate(() => [...document.querySelectorAll(".sheet-back:not([hidden]) .sheet p")].map((e) => e.innerText).join(" "));
      check(where, !!s && /deleted at Hetzner Cloud, with everything on it, and its €5\.99 a month stops/.test(words) && s.buttons.includes("Remove X"),
            `it says what's lost and what stops (${words})`);
      said[where].remove = s;
      await shot(p, where, "remove");
      await tap(p, "Remove X".replace("X", name));
      s = await until(() => sheetSays(p, name).then((x) => (x && x.buttons.includes("OK") ? x : null)), 30000);
      const gone = await p.evaluate(() => [...document.querySelectorAll(".sheet-back:not([hidden]) .sheet p")].map((e) => e.innerText).join(" "));
      check(where, !!s && /Deleted at Hetzner: its billing stops now/.test(gone), `removed: deleted at Hetzner, its billing stopped (${gone.slice(0, 160)})`);
      said[where].removed = s;
      await shot(p, where, "removed");
      await tap(p, "OK");
      check(where, !!(await until(() => !alpha.cloud()[name], 8000)), "OK: it's off the list");
      check(where, errors.length === 0, `no errors on the page (${errors.join("; ").slice(0, 300)})`);
      await ctx.close();
      await vm.stop();
    }
    // The phone and the wide say the same things.
    if (!ONLY) for (const k of Object.keys(said.phone || {})) {
      const a = JSON.stringify(said.phone[k]), b = JSON.stringify(said.wide[k]);
      check("both", a === b, `${k}: the phone's sheet and the wide's say the same${a === b ? "" : ` (${a} vs ${b})`}`);
    }
  } catch (e) {
    console.error(e);
    failures.push(String(e));
  } finally {
    if (browser) await browser.close();
    for (const m of [alpha, ...Object.values(vms)]) await m.stop();
    fakes.kill();
    if (failures.length) for (const m of [alpha, ...Object.values(vms)]) {
      try { console.log(`--- ${m.name}'s log\n${fs.readFileSync(path.join(m.home, "server.log"), "utf8").slice(-2000)}`); } catch (e) { /* none */ }
    }
    fs.rmSync(BASE, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  console.log(`\nscreenshots: ${SHOTS}`);
  console.log(failures.length ? `${failures.length} failed` : "all passed");
  process.exit(failures.length ? 1 : 0);
})();
