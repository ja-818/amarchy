// Your agents' tasks on Tasks, in a browser, against a real app server and
// the real CLI (amarchy task add | done): each a card first in Now, the one
// going soonest first, with its agent's picture (an agent's initial, your
// assistant's own) and name, its title, its note, how long it has left (red
// the last ten minutes), its links and its buttons; counted on the Tasks tab.
// A link opens its page in a new tab and the task stays. A button: the card
// ticks with its words, goes, Undo brings it back and nothing is sent;
// after Undo's moment its message reaches the agent (the server's amarchy
// send) and the task is done for good. Leaving the app sends it at once.
// The keys press its buttons (1, 2…). One its agent took down meanwhile:
// nothing sent, said so, not back. Past its time it's gone. Its head opens
// the agent's chat; the search finds it; #/tasks (its notification) opens
// Tasks. On the phone and wide, dark and light, the same cards; with
// screenshots.
//
//   node test/agent-tasks-view.js          both layouts
//   node test/agent-tasks-view.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs (Chromium, playwright-core: PLAYWRIGHT_CORE=<its folder>).
// It starts its own app server from this checkout's bin/amarchy, with a
// home and state of its own; what the server would send an agent is written
// down instead (sent.jsonl there). Exits 0 when every check passed.

"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "agent-tasks-view-"));
const ONLY = process.argv[2];

const SHIM = `
import importlib.machinery, importlib.util, json, os, sys, threading, time, http.server
bin, port, home = sys.argv[1], int(sys.argv[2]), sys.argv[3]
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config", AMARCHY_WORK=home + "/Work")
os.environ.pop("AMARCHY_SESSION", None)
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", bin)
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
import sys as _sys; _sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(bin)), "..", "test")); import isolate; isolate.timers(am)      # (test/isolate.py: none of this machine's automations)
am.app_key(); am.migrate()
for sid, repo in [("jaken-jaken", "jaken"), ("fireship-fireship", "fireship"), ("proj-a", "proj")]:
    os.makedirs(home + "/Work/" + repo, exist_ok=True)
    am.save_session({"id": sid, "repo": repo, "name": sid.split("-", 1)[1], "branch": "b", "base": "main", "path": home + "/wt/" + sid,
                     "created": int(time.time()) - 3600})
am.main(["assistant", "jaken-jaken"])
am.main(["agents", "fireship-fireship"])
real = am.run_amarchy
def run_amarchy(*args, **kw):
    if args and args[0] == "send":      # to an agent: written down, not delivered
        with open(home + "/sent.jsonl", "a") as f:
            f.write(json.dumps(list(args)) + "\\n")
        return am.subprocess.CompletedProcess(args, 0, "", "")
    return real(*args, **kw)
am.run_amarchy = run_amarchy
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
async function until(page, fn, arg, ms = 8000) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; }
}

const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};

let HOME = "";
// The real CLI, as an agent runs it.
function cli(...args) {
  const r = spawnSync("python3", [BIN, ...args], { encoding: "utf8",
    env: { ...process.env, HOME, XDG_STATE_HOME: `${HOME}/state`, XDG_CONFIG_HOME: `${HOME}/config`, AMARCHY_WORK: `${HOME}/Work`, AMARCHY_SESSION: "" } });
  return { rc: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
const sentNow = () => { try { return fs.readFileSync(path.join(HOME, "sent.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; } };
const openIds = () => JSON.parse(cli("task", "list", "--json").out || "[]").map((t) => t.id);
// Sent n by now (within ms): the host may be slow (other chats run their tests).
async function sentBy(n, ms = 12000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (sentNow().length >= n) return true;
  return sentNow().length >= n;
}

const POST = "https://x.com/levelsio/status/123";
// Three tasks, fresh: Fireship's two (8 and 45 minutes left), your assistant's one with no time.
function freshTasks() {
  cli("task", "done", "--agent", "fireship-fireship");
  cli("task", "done", "--agent", "jaken-jaken");
  const a = cli("task", "add", "--agent", "fireship-fireship", "--title", "Reply: @levelsio's AI-reply spam list",
    "--note", "45 min old, 46 replies; **worth it** until 10:12", "--link", `Open post=${POST}`,
    "--button", `Replied=Replied to ${POST}`, "--button", `Skipped=Skipped ${POST}`, "--until", "45m", "--key", POST).out;
  const b = cli("task", "add", "--agent", "fireship-fireship", "--title", "Reply: @dhh on Omarchy 3's tiling",
    "--note", "2 h old, 300 replies: late but big", "--link", "Open post=https://x.com/dhh/status/456",
    "--button", "Replied=Replied to https://x.com/dhh/status/456", "--button", "Skipped=Skipped https://x.com/dhh/status/456", "--until", "8m").out;
  const c = cli("task", "add", "--agent", "jaken-jaken", "--title", "Sign: the lease renewal", "--note", "Due Friday; the PDF is in your inbox",
    "--link", "Open the PDF=https://example.com/lease.pdf", "--button", "Signed=I signed the lease").out;
  return { a, b, c };
}

// What a task's cards show, for the phone and wide to be compared.
const SHAPE = () => [...document.querySelectorAll(".today:not([hidden]) .today-yours .tcard.k-task")].map((c) => ({
  chip: (c.querySelector(".tcard-chip") || {}).textContent, title: (c.querySelector(".tcard-title") || {}).textContent,
  pic: c.querySelector(".tcard-head .avatar") ? c.querySelector(".tcard-head .avatar").tagName.toLowerCase() : "",
  tone: ([...(c.querySelector(".tpill") || { classList: [] }).classList].find((x) => x.startsWith("t-")) || ""),
  note: (c.querySelector(".tcard-text") || {}).textContent,
  links: [...c.querySelectorAll("a.tbtn")].map((a) => [a.textContent.trim(), a.getAttribute("href")]),
  buttons: [...c.querySelectorAll(".tbtn.task-btn")].map((b) => b.textContent.trim()),
}));

const lum = (rgb) => {
  const [r, g, b] = (rgb.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map((x) => { const c = Number(x) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

async function look(page, base, theme) {
  await page.goto(base);
  await until(page, () => window.app && app.view && app.view.sessions);
  const r = await page.evaluate((theme) => fetch("/api/look", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme }) }).then((r) => r.status), theme);
  await page.goto(base);
  await until(page, () => window.app && app.view && app.view.sessions && app.view.sessions.length && boardOn());
  await page.evaluate(() => document.fonts.ready);
  return r;
}

const shapes = {};

async function run(browser, base, layout) {
  console.log(`\n${layout}`);
  const ctx = await browser.newContext({ ...LAYOUTS[layout], extraHTTPHeaders: { "Tailscale-User-Login": "tester@test" } });
  await ctx.addInitScript(() => { try { localStorage.setItem("tour", "1"); localStorage.setItem("amarchy-push", "no"); } catch (e) { /* no storage yet */ } });
  await ctx.route("https://x.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>X</title>a post" }));
  await ctx.route("https://example.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "a pdf" }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // What the presses got back, and the toasts said (for a failure's message).
  const presses = [];
  page.on("response", async (r) => { if (r.url().includes("/api/tasks/press")) presses.push(`${r.status()} ${await r.text().catch(() => "")}`); });
  page.on("requestfailed", (r) => { if (r.url().includes("/api/tasks/press")) presses.push(`failed ${r.failure() && r.failure().errorText}`); });
  await page.route("**/api/session/*/stream", (r) => r.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" }));
  const tasksTab = () => page.evaluate(() => boardTab("tasks"));
  const cards = () => page.evaluate(() => [...document.querySelectorAll(".today:not([hidden]) .today-yours .tcard.k-task")].map((c) => c.dataset.task));
  const card = (id) => `.today:not([hidden]) .tcard.k-task[data-task="${id}"]`;
  const tap = (id, label) => page.evaluate(({ sel, label }) => {
    const b = [...document.querySelectorAll(`${sel} .tbtn`)].find((x) => x.textContent.trim() === label);
    if (b) b.click();
    return !!b;
  }, { sel: card(id), label });

  for (const theme of ["tokyo-night", "catppuccin-latte"]) {
    const dark = theme === "tokyo-night";
    const where = `${layout} ${dark ? "dark" : "light"}`;
    fs.writeFileSync(path.join(HOME, "sent.jsonl"), "");
    const ids = freshTasks();
    check(where, [ids.a, ids.b, ids.c].every((x) => /^[0-9a-f]{6}$/.test(x)), `the CLI added three, each its id (${JSON.stringify(ids)})`);
    check(where, (await look(page, base, theme)) === 200, `the app wears ${theme}`);
    await tasksTab();
    check(where, await until(page, () => document.querySelectorAll(".today:not([hidden]) .today-yours .tcard.k-task").length === 3), "three task cards in Tasks' Now");
    const order = await cards();
    check(where, JSON.stringify(order) === JSON.stringify([ids.b, ids.a, ids.c]), `the one going soonest first, the one with no time last (${order})`);
    check(where, /Tasks\s*3/.test(await page.evaluate(() => document.querySelector(".board-switch").textContent)), "the Tasks tab counts them");
    check(where, /^Now\s*3/.test(await page.evaluate(() => document.querySelector(".today-yours .tsec-head").textContent.trim())), "Now's head too");
    const shape = await page.evaluate(SHAPE);
    const [b, a, c] = shape;
    check(where, a.chip === "Fireship" && a.pic === "svg" && /^Reply: @levelsio's AI-reply spam list$/.test(a.title), `its agent's initial and name, its title (${JSON.stringify(a)})`);
    check(where, a.note === "45 min old, 46 replies; worth it until 10:12" && await page.evaluate((s) => !!document.querySelector(`${s} .tcard-text strong`), card(ids.a)), "its note, its **bold** drawn");
    check(where, JSON.stringify(a.links) === JSON.stringify([["Open post", POST]]) && JSON.stringify(a.buttons) === JSON.stringify(["Replied", "Skipped"]), "its link, then its buttons");
    const pills = await page.evaluate((ids) => ids.map((id) => document.querySelector(`.tcard.k-task[data-task="${id}"] .tpill`).textContent), [ids.b, ids.a, ids.c]);
    check(where, /^[78] min left$/.test(pills[0]) && b.tone === "t-late", `8 minutes left: said, in red (${pills[0]} ${b.tone})`);
    check(where, /^4[45] min left$/.test(pills[1]) && a.tone === "t-quiet", `45 left: said, quiet (${pills[1]})`);
    check(where, c.chip === "Jaken" && c.pic === "img" && /just now|min ago/.test(pills[2]), `your assistant's: its picture and name; no time, how old (${pills[2]})`);
    check(where, await page.evaluate((s) => document.querySelector(`${s} a.tbtn`).classList.contains("primary"), card(ids.a)), "its link the one thing to do first");
    const fit = await page.evaluate(() => {
      const over = document.documentElement.scrollWidth > innerWidth;
      const out = [...document.querySelectorAll(".tcard.k-task")].some((c) => { const r = c.getBoundingClientRect();
        return [...c.querySelectorAll(".tbtn, .tpill, .tcard-chip")].some((x) => { const q = x.getBoundingClientRect(); return q.right > r.right + 0.5 || q.left < r.left - 0.5; }); });
      const tall = [...document.querySelectorAll(".tcard.k-task .tbtn")].some((x) => x.getBoundingClientRect().height > 60);
      return { over, out, tall };
    });
    check(where, !fit.over && !fit.out && !fit.tall, `everything in the card and the screen, no button a word a line (${JSON.stringify(fit)})`);
    const colors = await page.evaluate((s) => ({ title: getComputedStyle(document.querySelector(`${s} .tcard-title`)).color, note: getComputedStyle(document.querySelector(`${s} .tcard-text`)).color }), card(ids.a));
    check(where, dark ? lum(colors.title) > 0.4 && lum(colors.note) > 0.3 : lum(colors.title) < 0.15 && lum(colors.note) < 0.2,
          `its words in the theme's own (${colors.title}, ${colors.note})`);
    await page.screenshot({ path: path.join(SHOTS, `${layout}-${dark ? "dark" : "light"}-tasks.png`) });
    shapes[where] = shape.map((x) => ({ ...x, title: x.title }));
    if (!dark) continue;

    // A link: its page in a new tab, the task stays.
    const [tab] = await Promise.all([ctx.waitForEvent("page", { timeout: 5000 }).catch(() => null),
      page.evaluate((s) => document.querySelector(`${s} a.tbtn`).click(), card(ids.a))]);
    check(where, !!tab && tab.url() === POST, `Open post: the post in a new tab (${tab && tab.url()})`);
    if (tab) await tab.close();
    check(where, (await cards()).includes(ids.a), "and the task stays");

    // A button: its tick and words, gone, Undo; nothing sent.
    check(where, await tap(ids.a, "Replied"), "Replied tapped");
    check(where, await until(page, (s) => { const x = document.querySelector(`${s} .tcard-complete`); return !!x && /Replied/.test(x.textContent); }, card(ids.a), 2000),
          "its card ticks, Replied");
    check(where, await until(page, (s) => !document.querySelector(s), card(ids.a)), "then it's off Tasks");
    // (For the eye: the tick, held on the card left, as todayTaskPress draws it.)
    await page.evaluate((s) => { window.__fill = todayFill; todayFill = () => {}; const c = document.querySelector(s); c.classList.add("completing");
      c.append(h("div", { class: "tcard-complete" }, h("span", { class: "tick" }, glyph("check")), h("b", {}, "Skipped"))); }, card(ids.b));
    await page.screenshot({ path: path.join(SHOTS, `${layout}-pressed.png`), animations: "disabled" });
    await page.evaluate(() => { todayFill = window.__fill; todayRedraw(); });
    check(where, /Replied: sent to Fireship/.test(await page.evaluate(() => (document.querySelector(".undo-toast") || {}).textContent || "")), "Undo, saying what goes where");
    check(where, /Tasks\s*2/.test(await page.evaluate(() => document.querySelector(".board-switch").textContent)), "the tab counts one less");
    await page.screenshot({ path: path.join(SHOTS, `${layout}-undo.png`), animations: "disabled" });
    await page.evaluate(() => document.querySelector(".undo-toast .text-btn").click());
    check(where, await until(page, (s) => !!document.querySelector(s) && !document.querySelector(`${s} .tcard-complete`), card(ids.a)), "Undo: back, as it was");
    await sleep(4200);
    check(where, sentNow().length === 0 && openIds().includes(ids.a), "and nothing was sent");

    // Again, for good: after Undo's moment, its message to the agent; the task done.
    await tap(ids.a, "Replied");
    await until(page, (s) => !document.querySelector(s), card(ids.a));
    await sentBy(1);
    const s1 = sentNow();
    check(where, s1.length === 1 && JSON.stringify(s1[0]) === JSON.stringify(["send", "fireship-fireship", `Replied to ${POST}`, "--no-wait"]),
          `its message to Fireship, as amarchy send (${JSON.stringify(s1)}; presses: ${presses.join(", ")}; toasts: ${await page.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "))})`);
    check(where, !openIds().includes(ids.a), "the task done on the host");
    await sleep(1500);
    check(where, !(await cards()).includes(ids.a), "and it stays off Tasks");

    // The keys: on its card, 2 presses its second button. Leaving the app sends it at once.
    await page.evaluate((s) => boardFocus(document.querySelector(`${s} > .today-go`)), card(ids.b));
    await page.keyboard.press("2");
    check(where, await until(page, () => /Skipped: sent to Fireship/.test((document.querySelector(".undo-toast") || {}).textContent || "")), "2: its second button, Skipped");
    check(where, await page.evaluate((c) => { const a = document.activeElement; return a.matches(".tcard > .today-go") && a.parentElement.dataset.task === c; }, ids.c),
          "the keys on the card in its place, not on one of its buttons (Enter again would press it)");
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
    check(where, await sentBy(2, 2000), "the app left: sent at once, not after Undo's moment");
    check(where, sentNow()[1] && sentNow()[1][2] === "Skipped https://x.com/dhh/status/456", "its message: the agent's own");
    await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange")); });

    // Taken down by its agent while Undo was up: nothing sent, said so, not back.
    const d = cli("task", "add", "--agent", "fireship-fireship", "--title", "Reply: gone soon", "--button", "Replied=Replied to d").out;
    check(where, await until(page, (s) => !!document.querySelector(s), card(d)), "a new one from the CLI: on Tasks in a moment");
    await tap(d, "Replied");
    await sleep(800);
    check(where, cli("task", "done", d).rc === 0, "its agent takes it down meanwhile");
    check(where, await until(page, () => /gone/.test([...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" "))), "the press: said it's gone");
    await sleep(800);
    check(where, !(await cards()).includes(d) && sentNow().length === 2, "not back, nothing sent");

    // Past its time: gone; the last minute in red.
    await page.evaluate((id) => { const t = app.view.today.tasks.find((x) => x.id === id); t.until = Date.now() / 1000 + 30; todayRedraw(); }, ids.c);
    check(where, await until(page, (s) => { const p = document.querySelector(`${s} .tpill`); return !!p && p.textContent === "Under a minute" && p.classList.contains("t-late"); }, card(ids.c)),
          "under a minute left: said, in red");
    await page.evaluate((id) => { const t = app.view.today.tasks.find((x) => x.id === id); t.until = Date.now() / 1000 - 1; todayRedraw(); }, ids.c);
    check(where, await until(page, (s) => !document.querySelector(s), card(ids.c)), "past its time: gone");
    check(where, await until(page, () => !document.querySelector(".today-yours") && /Nothing needs you/.test(document.querySelector(".board-today").textContent)), "nothing left: Nothing needs you");
    await page.reload();
    await until(page, () => window.app && app.view && boardOn());
    await tasksTab();
    await until(page, (s) => !!document.querySelector(s), card(ids.c));

    // Its head opens its agent's chat.
    await page.evaluate((s) => document.querySelector(`${s} > .today-go`).click(), card(ids.c));
    check(where, await until(page, () => (app.desk ? desk.current : app.session && app.session.id) === "jaken-jaken"), "its head: its agent's chat");
    await page.evaluate(() => { if (app.desk) boardBack(true); else go("#/"); });
    await until(page, () => !(app.desk ? desk.current : app.session));

    // The search finds it.
    await page.evaluate(() => { board.search.value = "lease"; boardSearch("lease"); });
    check(where, await until(page, (s) => !!document.querySelector(`.today-found-tasks .tcard.k-task[data-task="${s}"]`), ids.c), "the search finds it, in Tasks");
    await tap(ids.c, "Signed");
    check(where, await until(page, (s) => !document.querySelector(s) && !!document.querySelector(".undo-toast"), card(ids.c)), "pressed there: off what it found");
    await page.evaluate(() => { const u = document.querySelector(".undo-toast .text-btn"); if (u) u.click(); });
    check(where, await until(page, () => !!board.query && /“lease”/.test(document.querySelector(".board-today .today-summary").textContent)), "the search still up, not Today over it");
    check(where, await until(page, (s) => !!document.querySelector(`.today-found-tasks ${s}`), card(ids.c).replace(".today:not([hidden]) ", "")), "Undo: back in what it found");
    await page.evaluate(() => { board.search.value = ""; boardSearch(""); });

    // #/tasks (a task's notification, tapped): Tasks, from wherever.
    await page.evaluate(() => boardTab("chats"));
    await page.evaluate(() => go("#/tasks"));
    check(where, await until(page, () => board.tab === "tasks" && here() === "#/today" && !!document.querySelector(".today-yours .tcard.k-task")), "#/tasks: the board on Tasks");
    await page.evaluate(() => todayOpen(row("fireship-fireship")));
    await until(page, () => (app.desk ? desk.current : app.session && app.session.id) === "fireship-fireship");
    await page.evaluate(() => boardTab("chats"));
    await page.evaluate(() => go("#/tasks"));
    check(where, await until(page, () => board.tab === "tasks" && !(app.desk ? desk.current : app.session)), "from an open chat too");

    // A new amarchy comes while Undo is up: the page waits for it (the press
    // goes), then loads the new one.
    const e = cli("task", "add", "--agent", "fireship-fireship", "--title", "Reply: over an update", "--button", "Replied=Replied to e").out;
    await until(page, (s) => !!document.querySelector(s), card(e));
    const was = sentNow().length;
    await tap(e, "Replied");
    await until(page, () => !!document.querySelector(".undo-toast"));
    const loaded = page.waitForEvent("load", { timeout: 20000 }).then(() => true).catch(() => false);
    await page.evaluate(() => { window.__old = true; lastUse.at = 0; app.updateSince = Date.now() - 200000; updated(); });
    await sleep(600);
    check(where, await page.evaluate(() => window.__old === true && !!document.querySelector(".undo-toast")), "an update: the page waits while Undo is up");
    check(where, await sentBy(was + 1) && sentNow()[was][2] === "Replied to e", "the press goes");
    check(where, await loaded, "then the new page loads");
    await until(page, () => window.app && app.view && boardOn());
    check(where, !(await page.evaluate(() => window.__old)) && !openIds().includes(e), "the new one, and the task done");
  }
  check(layout, !errors.length, `no page errors (${errors.join("; ")})`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  HOME = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tasks-home-"));
  const port = await freePort();
  const server = await startServer(port, HOME);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of ONLY ? [ONLY] : ["phone", "wide"]) await run(browser, `http://127.0.0.1:${port}/`, layout);
    if (!ONLY) for (const tone of ["dark", "light"]) {
      const p = shapes[`phone ${tone}`], w = shapes[`wide ${tone}`];
      const strip = (list) => JSON.stringify((list || []).map((x) => ({ ...x })));
      check(`phone = wide (${tone})`, strip(p) === strip(w), `the same cards, words and buttons (${strip(p) === strip(w) ? "" : `${strip(p)} vs ${strip(w)}`})`);
    }
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(HOME, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
