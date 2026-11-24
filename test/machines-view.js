// Two machines' chats on one board, in a real browser (docs/plan-omarchy-
// and-machines.md, track A): two real amarchy app servers on this machine
// (alpha and beta, each with a home, state, port, name and tmux of its own;
// a fake claude that speaks the chat engine's protocol), paired with
// `amarchy machines add`, and Chromium on alpha's app (the local key).
//
//   - the board: beta's chats beside alpha's, each card with its machine;
//   - beta's chat opened from alpha: its stream through alpha
//     (/api/m/beta/…), a message sent there, its terminal's WebSocket;
//   - Settings → Machines: each one and how it stands;
//   - a new chat's Where: beta picked, the chat started there;
//   - beta off: its cards dimmed, "beta is off", no buttons; its chat says
//     so in place of the box; beta back: as it was;
//   - alpha's board and beta's, each drawn by its own server (the web app
//     on one, the desktop app on the other): the same cards in the same
//     order, an agent on each.
//
// Phone and wide, with screenshots.
//
//   node test/machines-view.js          both layouts
//   node test/machines-view.js phone    one layout (phone | wide)
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
const homes = require("./homes");      // (test/homes.js: its home gone with it, however it ends)

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "machines-view-"));
const ONLY = process.argv[2];
const BASE = homes.home("machines-view");
const USER = "tester@example.com";

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

// A claude that answers the control protocol and ends each turn, keeping what it got.
const FAKE = path.join(BASE, "bin");
fs.mkdirSync(FAKE);
fs.writeFileSync(path.join(FAKE, "claude"), `#!/usr/bin/env python3
import json, sys
def say(o):
    sys.stdout.write(json.dumps(o) + "\\n"); sys.stdout.flush()
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
        say({"type": "result", "subtype": "success", "is_error": False, "duration_ms": 10,
             "session_id": "c0ffee00-0000-4000-8000-000000000001", "result": "ok"})
`, { mode: 0o755 });

class Machine {
  constructor(name, port) {
    this.name = name;
    this.port = port;
    this.home = path.join(BASE, name);
    this.url = `http://127.0.0.1:${port}`;
    this.socket = `amarchy-test-${process.pid}-${name}`;
    homes.whenDone(() => { try { execFileSync("tmux", ["-L", this.socket, "kill-server"], { stdio: "ignore" }); } catch (e) { /* none */ } });      // stopped before its finally
    this.env = {
      HOME: this.home, XDG_STATE_HOME: `${this.home}/state`, XDG_CONFIG_HOME: `${this.home}/config`, AMARCHY_WORK: `${this.home}/Work`,
      AMARCHY_TMUX: this.socket, AMARCHY_HOST_NAME: name, AMARCHY_HOST_APP_PORT: String(port), AMARCHY_HOST_URL: this.url,
      AMARCHY_HOST_APP_LINKS: "off", AMARCHY_HOST_APP_USERS: USER, AMARCHY_PEER_SILENT: "6", AMARCHY_PEER_OFF_AFTER: "8",
      PATH: `${FAKE}:/usr/local/bin:/usr/bin:/bin`, LANG: "C.UTF-8", SHELL: "/bin/bash", TERM: "xterm-256color",
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || "", DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || "",
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
    };
    for (const repo of name === "alpha" ? ["proj", "site"] : ["proj"]) {
      const dir = path.join(this.home, "Work", repo);
      fs.mkdirSync(dir, { recursive: true });
      const git = (...a) => execFileSync("git", a, { cwd: dir, env: this.env, stdio: "ignore" });
      git("init", "-q", "-b", "main");
      fs.writeFileSync(path.join(dir, "README.md"), `# ${repo} on ${name}\n`);
      git("add", ".");
      git("commit", "-q", "-m", "first");
    }
  }

  amarchy(...args) {
    try { return execFileSync("python3", [BIN, ...args], { env: this.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 }).trim(); }
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

  // Its /api/state, as its own desktop app (the local key's cookie) would ask.
  state() {
    return new Promise((ok, no) => {
      const get = (p, cookie, done) => http.get({ host: "127.0.0.1", port: this.port, path: p, headers: cookie ? { Cookie: cookie } : {} }, done).on("error", no);
      get(`/local?key=${this.key}`, null, (r) => {
        r.resume();
        const cookie = String((r.headers["set-cookie"] || [""])[0]).split(";")[0];
        get("/api/state", cookie, (s) => { let d = ""; s.on("data", (c) => { d += c; }); s.on("end", () => { try { ok(JSON.parse(d)); } catch (e) { no(e); } }); });
      });
    });
  }

  got(chatPath) { try { return fs.readFileSync(path.join(chatPath, "got.txt"), "utf8"); } catch (e) { return ""; } }
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
    alpha.amarchy("terminals", "on");
    const mine = alpha.amarchy("new", "proj", "mine");
    const theirs = beta.amarchy("new", "proj", "one");
    check("setup", mine === "proj-mine" && theirs === "proj-one", `a chat on each (${mine}, ${theirs})`);
    const ready = await until(async () => {
      const v = await alpha.state();
      const b = v.sessions.find((s) => s.machine === "beta" && s.id === "proj-one");
      return b && !b.setup && v.sessions.some((s) => s.id === "proj-mine" && !s.setup) ? b : null;
    }, 40000);
    check("setup", !!ready, "both set up, beta's on alpha's board");
    const betaPath = ready ? ready.path : "";
    browser = await chromium.launch({ executablePath: findChrome() });

    for (const layout of Object.keys(LAYOUTS)) {
      if (ONLY && ONLY !== layout) continue;
      const where = layout;
      const ctx = await browser.newContext({ ...LAYOUTS[layout] });
      const p = await ctx.newPage();
      const errors = [], sockets = [];
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("websocket", (ws) => { const s = { url: ws.url(), frames: 0 }; sockets.push(s); ws.on("framereceived", () => { s.frames++; }); });
      await p.addInitScript(() => { try { localStorage.setItem("amarchy-push", "no"); localStorage.setItem("tour", "done"); } catch (e) { /* none */ } });
      await p.goto(`${alpha.url}/local?key=${alpha.key}`);
      const has = (sel) => p.evaluate((sel) => !!document.querySelector(sel), sel);
      const card = (id) => `.tcard[data-id="${id}"]`;
      const seen = await until(() => has(card("beta:proj-one")), 15000);
      check(where, !!seen, "beta's chat is on alpha's board, keyed beta:proj-one");
      check(where, await has(card("proj-mine")), "alpha's own beside it, keyed as before");
      const marks = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".tcard[data-id]")].map((c) => {
        const m = c.querySelector(".ui-machine");
        return [c.dataset.id, m ? `${m.getAttribute("aria-label")}${m.querySelector(".glyph svg") ? " (icon)" : ""}` : ""];
      })));
      check(where, marks["beta:proj-one"] === "On beta (icon)" && marks["proj-mine"] === "On alpha (icon)", `each card shows its machine's icon, named (${JSON.stringify(marks)})`);
      await sleep(600);
      await p.screenshot({ path: path.join(SHOTS, `${where}-board.png`) });

      // Beta's chat, from alpha.
      await p.evaluate(() => { document.querySelector('.tcard[data-id="beta:proj-one"] .tcard-head').click(); });
      const open = await until(() => p.evaluate(() => { const c = (app.session && app.session.chat) || desk.chat; return c && c.id === "beta:proj-one" && c.es && c.row && c.row.machine === "beta" ? c.es.url : null; }));
      check(where, !!open && open.includes("/api/m/beta/api/session/proj-one/stream"), `opened: its stream through alpha (${open})`);
      const head = await p.evaluate(() => { const h = document.querySelector(".chat-head .ui-machine, .desk-head .ui-machine"); return h ? h.getAttribute("aria-label") : ""; });
      check(where, head === "On beta", `its head says beta (${head})`);
      const text = `hello from ${where}`;
      await p.evaluate((text) => { const c = (app.session && app.session.chat) || desk.chat; c.input.value = text; c.send(); }, text);
      check(where, !!(await until(() => beta.got(betaPath).includes(text), 15000)), "a message sent from the chat reaches beta's Claude");
      await sleep(500);
      await p.screenshot({ path: path.join(SHOTS, `${where}-chat.png`) });
      // Its terminal: a WebSocket through alpha, both ways. (Sent from a
      // chat opened from the board, the phone is back on the board: open it again.)
      await p.evaluate(() => { if (!app.session && !desk.current) go2("beta:proj-one"); });
      await until(() => p.evaluate(() => (app.session && app.session.id === "beta:proj-one") || desk.current === "beta:proj-one"));
      if (layout === "phone") await p.evaluate(() => app.session.setMode("terminal"));
      else await p.evaluate(() => sideToggle("term", true));
      const ws = await until(() => sockets.find((s) => s.url.includes("/api/m/beta/api/session/proj-one/tty/") && s.frames > 2), 15000);
      check(where, !!ws, `its terminal: a WebSocket through alpha, drawing (${ws ? ws.url.replace(alpha.url.replace("http", "ws"), "") : sockets.map((s) => s.url).join(", ")})`);
      await sleep(800);
      await p.screenshot({ path: path.join(SHOTS, `${where}-terminal.png`) });
      if (layout === "phone") await p.evaluate(() => app.session.setMode("chat"));
      else await p.evaluate(() => sideToggle(null));
      await p.evaluate(() => go("#/"));
      await until(() => p.evaluate(() => !(app.session) && !desk.current));

      // Settings → Machines.
      await p.evaluate(() => openSettings());
      const rows = await until(() => p.evaluate(() => [...document.querySelectorAll(".sheet .machine-row")].map((b) => b.innerText.replace(/\s+/g, " ").trim())).then((r) => (r.length >= 2 ? r : null)));
      check(where, !!rows && /alpha.*This machine/.test(rows[0]) && /beta.*On/.test(rows[1]), `Settings → Machines: ${JSON.stringify(rows)}`);
      await p.evaluate(() => { const r = [...document.querySelectorAll(".sheet .machine-row")][0]; r.scrollIntoView({ block: "center" }); });
      await sleep(300);
      await p.screenshot({ path: path.join(SHOTS, `${where}-settings.png`) });
      await p.evaluate(() => closeSheets());

      // A new chat, on beta: Where.
      await p.evaluate(() => boardCompose());
      const pick = await until(() => p.evaluate(() => { const b = document.querySelector(".start-chat .pick.where"); return b && !b.hidden ? b.innerText.trim() : null; }));
      check(where, pick === "alpha", `the new chat says where it runs: ${pick}`);
      await p.evaluate(() => desk.newChat.use("site"));
      await p.evaluate(() => document.querySelector(".start-chat .pick.where").click());
      await sleep(400);
      const picked = await p.evaluate(() => {
        const items = [...document.querySelectorAll(".picker-row, .sheet .menu-item")];
        const b = items.find((x) => /^beta/.test(x.innerText.trim()));
        const said = b ? b.innerText.replace(/\s+/g, " ") : "";
        if (b) b.click();
        return said;
      });
      check(where, /cloned there first/.test(picked), `beta, for a project it hasn't: "${picked}"`);
      const note = await until(() => p.evaluate(() => { const n = document.querySelector(".start-chat .where-note"); return n && !n.hidden ? n.textContent : null; }));
      check(where, note === "cloned on beta first", `said under the box: ${note}`);
      await p.screenshot({ path: path.join(SHOTS, `${where}-where.png`) });
      await p.evaluate(() => desk.newChat.use("proj"));
      const back = await p.evaluate(() => { const n = document.querySelector(".start-chat .where-note"); return { label: document.querySelector(".start-chat .pick.where").innerText.trim(), note: n.hidden }; });
      check(where, back.label === "beta" && back.note, `proj: beta kept, and it has it (${JSON.stringify(back)})`);
      const before = (await beta.state()).sessions.length;
      await p.evaluate((w) => { desk.newChat.field.value = `a chat on beta from the ${w} layout`; desk.newChat.field.dispatchEvent(new Event("input")); }, where);
      await p.evaluate(() => document.querySelector(".start-chat .send, .start-chat .cta.go").click());
      const made = await until(async () => { const v = await beta.state(); return v.sessions.length > before ? v.sessions.find((s) => !s.setup && fs) : null; }, 40000);
      check(where, !!made, "started on beta");
      const keyed = await until(() => p.evaluate(() => app.view.sessions.filter((s) => s.machine === "beta").map((s) => s.id)), 15000);
      check(where, !!keyed && keyed.length >= 2, `on alpha's board as beta's (${keyed})`);
      check(where, await p.evaluate(() => localStorage.getItem("where:proj")) === "beta", "the next chat in proj starts on beta too");

      // Beta goes away: its chats as last seen, dimmed, read only.
      await beta.stop();
      const dim = await until(() => p.evaluate((sel) => {
        const c = document.querySelector(sel);
        const m = c && c.querySelector(".ui-machine.off");
        return c && c.classList.contains("machine-off") && m ? `${m.getAttribute("aria-label")} · ${c.querySelector(".tpill").textContent}` : null;
      }, card("beta:proj-one")), 20000);
      await p.evaluate(() => { for (const d of document.querySelectorAll("details.today-working")) d.open = true; });     // (it's at work: under At work, folded)
      check(where, !!dim && /^beta is off · Off$/.test(dim), `beta off: its card dimmed, its icon "beta is off", its badge Off (${dim})`);
      check(where, await p.evaluate((sel) => !document.querySelector(`${sel} .tcard-actions`) || !!document.querySelector(`${sel} .tcard-actions button`), card("beta:proj-one")),
            "its buttons stay (what you answer waits for it)");
      check(where, await p.evaluate((sel) => !document.querySelector(sel).classList.contains("machine-off"), card("proj-mine")), "alpha's own card as it was");
      await sleep(500);
      await p.screenshot({ path: path.join(SHOTS, `${where}-off.png`) });
      await p.evaluate(() => { document.querySelector('.tcard[data-id="beta:proj-one"] .tcard-head').click(); });
      const offNote = await until(() => p.evaluate(() => { const n = document.querySelector(".chat-dock .dock-note.machine-off"); return n ? n.textContent : null; }));
      check(where, !!offNote && /beta is off/.test(offNote), `its chat: "${offNote}"`);
      check(where, await p.evaluate(() => { const c = (app.session && app.session.chat) || desk.chat; return c.dock.contains(c.box); }), "the box stays: you can still write");
      // Sent while beta's off: it waits on alpha, says so, and goes once beta's back.
      const waitText = `sent while beta is off (${where})`;
      await p.evaluate((text) => { const c = (app.session && app.session.chat) || desk.chat; c.input.value = text; c.send(); }, waitText);
      // (Sent from a chat opened from the board: back on the board. Open it again.)
      await until(() => p.evaluate(() => !(app.session && app.session.id === "beta:proj-one") && desk.current !== "beta:proj-one"), 5000);
      await p.evaluate(() => go2("beta:proj-one"));
      const waits = await until(() => p.evaluate(() => { const n = document.querySelector(".chat-outbox .msg.waiting .msg-waits"); return n ? n.textContent : null; }), 10000);
      check(where, !!waits && /Sends when beta is back/.test(waits) && /Cancel/.test(waits), `it waits, saying so, with Cancel (${waits})`);
      await sleep(400);
      await p.screenshot({ path: path.join(SHOTS, `${where}-off-chat.png`) });
      await beta.start();
      const on = await until(() => p.evaluate(() => { const c = (app.session && app.session.chat) || desk.chat; return c && c.dock.contains(c.box) && !document.querySelector(".chat-dock .dock-note.machine-off"); }), 30000);
      check(where, !!on, "beta back: the chat as it was");
      check(where, !!(await until(() => beta.got(betaPath).includes(waitText), 30000)), "what waited arrived at beta's Claude");
      check(where, !!(await until(() => p.evaluate(() => !document.querySelector(".chat-outbox .msg.waiting")), 15000)), "no longer waiting");
      await p.evaluate(() => go("#/"));
      check(where, !!(await until(() => p.evaluate((sel) => { const c = document.querySelector(sel); return c && !c.classList.contains("machine-off"); }, card("beta:proj-one")))), "its card as it was");
      check(where, errors.length === 0, `no errors on the page (${errors.join("; ").slice(0, 300)})`);
      await ctx.close();
    }

    // Every machine's board in the same order, whichever machine draws it (the
    // web app on one, the desktop app on the other): an agent on each, which
    // its own machine's list puts first.
    alpha.amarchy("new", "proj", "zed");
    beta.amarchy("new", "proj", "abe");
    const both = await until(async () => {
      const [a, b] = [await alpha.state(), await beta.state()];
      const up = (v, id, m) => v.sessions.some((s) => s.id === id && (s.machine || v.machine) === m && !s.setup);
      return up(a, "proj-zed", "alpha") && up(a, "proj-abe", "beta") && up(b, "proj-zed", "alpha") && up(b, "proj-abe", "beta");
    }, 40000);
    alpha.amarchy("agents", "proj-zed", "--name", "Zed");
    beta.amarchy("agents", "proj-abe", "--name", "Abe");
    check("order", !!both, "an agent on each machine, on both boards");
    for (const layout of Object.keys(LAYOUTS)) {
      if (ONLY && ONLY !== layout) continue;
      const orders = {};
      for (const m of [alpha, beta]) {
        const ctx = await browser.newContext({ ...LAYOUTS[layout] });
        const p = await ctx.newPage();
        await p.addInitScript(() => { try { localStorage.setItem("amarchy-push", "no"); localStorage.setItem("tour", "done"); } catch (e) { /* none */ } });
        await p.goto(`${m.url}/local?key=${m.key}`);
        await until(() => p.evaluate(() => document.querySelectorAll(".tcard[data-id]").length >= 5 && [...document.querySelectorAll(".tcard[data-id]")].some((c) => /Zed/.test(c.innerText))
          && [...document.querySelectorAll(".tcard[data-id]")].some((c) => /Abe/.test(c.innerText))), 20000);
        orders[m.name] = await p.evaluate((me) => [...document.querySelectorAll(".tcard[data-id]")].map((c) => (c.dataset.id.includes(":") ? c.dataset.id : `${me}:${c.dataset.id}`)), m.name);
        await p.screenshot({ path: path.join(SHOTS, `${layout}-order-${m.name}.png`) });
        await ctx.close();
      }
      check(layout, orders.alpha.length >= 5 && JSON.stringify(orders.alpha) === JSON.stringify(orders.beta),
            `alpha's board and beta's: the same cards in the same order (${orders.alpha.join(", ")} | ${orders.beta.join(", ")})`);
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
  }
  console.log(`\nscreenshots: ${SHOTS}`);
  console.log(failures.length ? `${failures.length} failed` : "all passed");
  process.exit(failures.length ? 1 : 0);
})();
