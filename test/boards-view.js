// Tasks as boards, in a browser, against a real app server and the real CLI
// (amarchy board set | card | comment, amarchy task add): Tasks lists each
// board with what waits on you there (Fireship's post board: its posts for
// review, drawn as X shows them) and a box to write a task for one of your
// agents; its tab counts every card of yours. A board opens in Tasks'
// place: its columns side by side wide, one at a time on the phone (tabs, a
// swipe). On a card: Comment (to its agent as your own message, "About
// “<card>” (board, card): ...", and on its thread; the agent's answer there,
// the card lit "Answered"); Approve (the card ticks, Undo, then it's in
// Ready to post, approved by you: amarchy board approved says so, of its
// exact text); the board's check refusing an approval, in its words; Edit
// in place with X's count live (past 280 a warning) and the approval gone
// once saved, the card back in review; Discard asking why first, the reason
// in the message; a task you write, on your assistant's board, it told.
// Esc and Back go back to Tasks. On the phone and wide, the same cards and
// words; with screenshots.
//
//   node test/boards-view.js          both layouts
//   node test/boards-view.js phone    one layout (phone | wide)
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
const homes = require("./homes");      // (test/homes.js: its home gone with it, however it ends)

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "boards-view-"));
const ONLY = process.argv[2];

const SHIM = `
import importlib.machinery, importlib.util, json, os, sys, threading, time, http.server
bin, port, home = sys.argv[1], int(sys.argv[2]), sys.argv[3]
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config", AMARCHY_WORK=home + "/Work")
os.environ.pop("AMARCHY_SESSION", None)
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", bin)
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
import sys as _sys; _sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(bin)), "..", "test")); import isolate; isolate.timers(am); isolate.downloads(am)      # (test/isolate.py: none of this machine's automations, nor its big downloads)
am.app_key(); am.migrate()
for sid, repo in [("jaken-jaken", "jaken"), ("fireship-fireship", "fireship"), ("proj-a", "proj")]:
    os.makedirs(home + "/Work/" + repo, exist_ok=True)
    os.makedirs(home + "/wt/" + sid, exist_ok=True)
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
  wide: { viewport: { width: 1440, height: 900 } },
};

let HOME = "";
// The real CLI, as an agent runs it (as Fireship unless said).
function cli(args, { me = "fireship-fireship", input } = {}) {
  const r = spawnSync("python3", [BIN, ...args], { encoding: "utf8", input,
    env: { ...process.env, HOME, XDG_STATE_HOME: `${HOME}/state`, XDG_CONFIG_HOME: `${HOME}/config`, AMARCHY_WORK: `${HOME}/Work`, AMARCHY_SESSION: me } });
  return { rc: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
const sentNow = () => { try { return fs.readFileSync(path.join(HOME, "sent.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; } };
async function sentBy(n, ms = 12000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (sentNow().length >= n) return true;
  return sentNow().length >= n;
}
const show = (key) => JSON.parse(cli(["board", "show", "posts", "--card", key, "--json"]).out || "{}");

// A picture for a post: 600×300, the theme's blue going to violet (a PNG made here).
function png(w, h) {
  const zlib = require("zlib");
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) { row[1 + x * 3] = 60 + Math.round(120 * x / w); row[2 + x * 3] = 90; row[3 + x * 3] = 220 - Math.round(60 * y / h); }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const PNG = png(600, 300);
const POSTS = [
  ["fs-012", "Agents: stop babysitting", "Stop babysitting your agents.\nManage them: one board says who needs you and what for.", true],
  ["fs-013", "Omarchy: amarchy blends in", "amarchy on Omarchy looks like a terminal.\nSuper+Shift+R brings it to the front.", false],
  ["fs-014", "Boards: comment on a post", "Your agents keep boards now.\nComment on a card, and the agent revises it.", false],
  ["fs-015", "Phone: review on the go", "Review thirty posts from your phone before your coffee is cold.", false],
];

// The boards, fresh: Fireship's post board (as its board is today), a task
// of its own, and Jaken's board with nothing on it yet.
function freshBoards() {
  for (const id of ["posts", "fireship-fireship", "jaken-jaken"]) cli(["board", "drop", id]);
  const set = cli(["board", "set", "posts", "--title", "Post board",
    "--column", "For review", "--yours", "--button", "Approve", "--to", "Ready to post", "--quiet",
    "--button", "Discard", "--asks", "Why discard it?", "--to", "Discarded",
    "--column", "Ready to post", "--approval", "--button", "Back to review", "--to", "For review", "--quiet",
    "--button", "Posted by hand", "--asks", "Its link?", "--to", "Posted",
    "--column", "Posted", "--done", "--column", "Discarded", "--done", "--button", "Restore", "--to", "For review",
    "--check", "if grep -q BANNED; then echo 'Lint: BANNED is a banned word'; exit 1; fi"]);
  const ids = {};
  for (const [key, title, text, pic] of POSTS) {
    const r = cli(["board", "card", "posts", "--key", key, "--title", title, "--xpost", "-", "--handle", "ja818_", "--name", "Julian Arango",
                   ...(pic ? ["--media", path.join(HOME, "shot.png")] : []), "--note", "Slot: Tue 9:00"], { input: text });
    ids[key] = r.out;
  }
  const task = cli(["task", "add", "--title", "Reply: @levelsio's AI-reply spam list", "--note", "45 min old, 46 replies",
                    "--link", "Open post=https://x.com/levelsio/status/123", "--button", "Replied=Replied to https://x.com/levelsio/status/123",
                    "--until", "45m"]);
  return { set, ids, task };
}

// What Tasks and an open board show, for the phone and wide to be compared.
const SHAPE = () => {
  const cards = (root) => [...root.querySelectorAll(".tcard.k-bcard")].map((c) => ({
    title: (c.querySelector(".tcard-title") || {}).textContent, pill: (c.querySelector(".tpill") || {}).textContent || "",
    post: !!c.querySelector(".xpost"), note: (c.querySelector(".bcard-note") || {}).textContent || "",
    buttons: [...c.querySelectorAll(".tcard-actions .tbtn")].map((b) => b.textContent.trim()),
    thread: [...c.querySelectorAll(".ui-thread-item")].map((x) => x.textContent.trim()) }));
  const box = document.querySelector(".board-today");
  return { sections: [...box.querySelectorAll(":scope > .tsec .tsec-title")].map((t) => t.textContent),
           columns: [...box.querySelectorAll(".ui-kanban-col")].map((c) => c.dataset.col), cards: cards(box) };
};

const shapes = {};

async function run(browser, base, layout) {
  console.log(`\n${layout}`);
  const where = layout;
  const ctx = await browser.newContext({ ...LAYOUTS[layout], extraHTTPHeaders: { "Tailscale-User-Login": "tester@test" } });
  await ctx.addInitScript(() => { try { localStorage.setItem("tour", "1"); localStorage.setItem("amarchy-push", "no"); } catch (e) { /* no storage yet */ } });
  await ctx.route("https://x.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>X</title>a post" }));
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const { set, ids, task } = freshBoards();
  check(where, set.rc === 0 && Object.values(ids).every((x) => /^[0-9a-f]{6}$/.test(x)) && /^[0-9a-f]{6}$/.test(task.out),
    `the post board, its four posts and a task, from the CLI (${set.err} ${task.err})`);
  const sent0 = sentNow().length;

  await p.goto(base);
  await until(p, () => window.app && app.view && app.view.sessions && app.view.sessions.length && boardOn());
  await p.evaluate(() => boardTab("tasks"));
  check(where, await until(p, () => document.querySelectorAll(".board-today > .tsec[data-board]").length >= 2),
    "Tasks lists the boards");
  check(where, await p.evaluate(() => /5/.test(document.querySelector('.board-switch [data-tab="tasks"]').textContent)),
    `its tab counts your cards: four posts and a task (${await p.evaluate(() => document.querySelector('.board-switch [data-tab="tasks"]').textContent)})`);
  const list = await p.evaluate(() => {
    const sec = document.querySelector('.board-today > .tsec[data-board="posts"]');
    return sec && { head: sec.querySelector(".tsec-head").textContent, cards: sec.querySelectorAll(".tcard.k-bcard").length,
                    posts: sec.querySelectorAll(".tcard .xpost").length, more: (sec.querySelector(".bsec-more") || {}).textContent || "",
                    pic: !!sec.querySelector(".tcard .xpost img[src*='/media?src=']") };
  });
  check(where, list && /Post board/.test(list.head) && /4/.test(list.head) && list.cards === 3 && list.posts === 3 && /1 more/.test(list.more),
    `the post board: its name, 4 for you, the first three posts drawn as X shows them, "1 more" (${JSON.stringify(list)})`);
  check(where, list && list.pic, "a post's picture, from its agent's machine");
  check(where, await p.evaluate(() => !!document.querySelector(".board-today .bwrite-wrap textarea") && /Jaken/.test(document.querySelector(".bwrite-wrap textarea").placeholder)),
    "a box to write a task, for your assistant");
  await p.screenshot({ path: path.join(SHOTS, `${where}-tasks.png`), fullPage: false });
  shapes[`${where} tasks`] = await p.evaluate(SHAPE);

  // The board, open.
  await p.click('.board-today > .tsec[data-board="posts"] .bsec-open');
  check(where, await until(p, () => !!document.querySelector(".board-today .ui-kanban") && document.querySelectorAll(".ui-kanban-col .tcard.k-bcard").length === 4),
    "Open: the board, its posts in For review");
  const cols = await p.evaluate(() => {
    const vis = [...document.querySelectorAll(".ui-kanban-col")].filter((c) => getComputedStyle(c).display !== "none").map((c) => c.dataset.col);
    return { vis, tabs: getComputedStyle(document.querySelector(".ui-kanban-tabs")).display !== "none", hash: here() };
  });
  check(where, layout === "phone" ? cols.tabs && cols.vis.join() === "For review" : !cols.tabs && cols.vis.length === 4,
    `${layout === "phone" ? "one column at a time, under its tabs" : "its four columns side by side"} (${JSON.stringify(cols)})`);
  check(where, cols.hash === "#/b/posts", `its address: #/b/posts (${cols.hash})`);
  await p.screenshot({ path: path.join(SHOTS, `${where}-board.png`), fullPage: false });

  // Comment: to Fireship as your own message, on the card's thread.
  const card = (key) => `.ui-kanban .tcard[data-card="${ids[key]}"]`;
  await p.click(`${card("fs-013")} .bcard-comment`);
  check(where, await until(p, (sel) => !!document.querySelector(`${sel} .bbox textarea`) && document.activeElement === document.querySelector(`${sel} .bbox textarea`), card("fs-013")),
    "Comment: a box under the card, the keys in it");
  await p.fill(`${card("fs-013")} .bbox textarea`, "Shorter, and lead with Super+Shift+R");
  await p.click(`${card("fs-013")} .bbox .cbtn.send`);
  check(where, await sentBy(sent0 + 1), "sent");
  const said = sentNow()[sent0] || [];
  check(where, said[1] === "fireship-fireship" && said[2] === "About “Omarchy: amarchy blends in” (board posts, card fs-013): Shorter, and lead with Super+Shift+R",
    `to Fireship, naming the card (${JSON.stringify(said)})`);
  check(where, await until(p, (sel) => /Shorter, and lead with Super\+Shift\+R/.test((document.querySelector(`${sel} .ui-thread`) || {}).textContent || ""), card("fs-013")),
    "on its thread");
  // Fireship answers: a revision and a word on the thread.
  cli(["board", "card", "posts", "--key", "fs-013", "--xpost", "-"], { input: "Super+Shift+R: amarchy, in front.\nOn Omarchy it looks like a terminal." });
  cli(["board", "comment", "posts", "fs-013", "Led with Super+Shift+R, and cut it to two lines."]);
  check(where, await until(p, (sel) => {
    const c = document.querySelector(sel);
    return c && /Super\+Shift\+R: amarchy, in front/.test(c.textContent) && /cut it to two lines/.test(c.textContent) && c.classList.contains("unseen")
      && /Answered/.test((c.querySelector(".tpill") || {}).textContent || "");
  }, card("fs-013"), 10000), "Fireship's revision and answer: on the card, lit, Answered");

  // Approve: the card ticks, Undo, then it's approved, in Ready to post.
  await p.click(`${card("fs-012")} .tcard-actions .tbtn >> text=Approve`);
  check(where, await until(p, (sel) => !document.querySelector(sel), card("fs-012")), "Approve: the card goes from For review");
  check(where, await until(p, () => /Approve/.test((document.querySelector(".toast") || {}).textContent || "")), "with an Undo");
  for (let i = 0; i < 60 && cli(["board", "approved", "posts", "fs-012"]).rc !== 0; i++) await sleep(200);
  const ok = cli(["board", "approved", "posts", "fs-012", "--json"]);
  const a = JSON.parse(ok.out || "{}");
  check(where, ok.rc === 0 && a.by === "tester@test" && a.text === POSTS[0][2], `approved by you, of its exact text (${ok.out} ${ok.err})`);
  check(where, cli(["board", "approved", "posts", "fs-012", "--text", "-"], { input: "Stop babysitting your agents." }).rc === 1,
    "a different text isn't what was approved");
  check(where, cli(["board", "move", "posts", "fs-013", "Ready to post"]).rc === 1, "an agent can't move a card into Ready to post");
  check(where, sentNow().length === sent0 + 1, "Approve sends nothing (quiet)");
  if (layout === "phone") {
    await p.click('.ui-kanban-tabs [data-tab="Ready to post"]');
    check(where, await until(p, (sel) => !!document.querySelector(sel) && getComputedStyle(document.querySelector(sel)).display !== "none", card("fs-012")), "its tab: Ready to post, the card there");
  }
  check(where, await until(p, (sel) => /Approved ✓/.test((document.querySelector(`${sel} .tpill`) || {}).textContent || "")
    && document.querySelector(sel).closest(".ui-kanban-col").dataset.col === "Ready to post", card("fs-012")), "in Ready to post, Approved ✓");

  // The board's check: a post with BANNED in it can't be approved.
  cli(["board", "card", "posts", "--key", "fs-014", "--xpost", "-"], { input: "Your agents keep boards now. BANNED words get caught." });
  if (layout === "phone") await p.click('.ui-kanban-tabs [data-tab="For review"]');
  await until(p, (sel) => /BANNED/.test((document.querySelector(sel) || {}).textContent || ""), card("fs-014"));
  await p.click(`${card("fs-014")} .tcard-actions .tbtn >> text=Approve`);
  check(where, await until(p, () => /BANNED is a banned word/.test((document.querySelector(".toast") || {}).textContent || ""), null, 12000),
    "the board's check refuses it, in its words");
  check(where, await until(p, (sel) => !!document.querySelector(sel), card("fs-014")), "and it's back in For review");
  check(where, cli(["board", "approved", "posts", "fs-014"]).rc === 1, "not approved");

  // Edit in place: X's count as you type; saved, the approval goes.
  if (layout === "phone") await p.click('.ui-kanban-tabs [data-tab="Ready to post"]');
  await p.click(`${card("fs-012")} .bcard-edit-btn`);
  check(where, await until(p, (sel) => !!document.querySelector(`${sel} .bedit-text`), card("fs-012")), "Edit: its title and its text, in place");
  check(where, await p.evaluate((sel) => /Saving it takes your approval back/.test(document.querySelector(sel).textContent), card("fs-012")), "it says saving takes the approval back");
  await p.fill(`${card("fs-012")} .bedit-text`, "x".repeat(290));
  check(where, await p.evaluate((sel) => { const c = document.querySelector(`${sel} .bedit-count`); return c.classList.contains("over") && /290\/280/.test(c.textContent) && /Premium/.test(c.textContent); }, card("fs-012")),
    "past 280: X's count, a warning (Premium takes it)");
  await p.fill(`${card("fs-012")} .bedit-text`, "Stop babysitting agents. Manage them.");
  check(where, await p.evaluate((sel) => document.querySelector(`${sel} .bedit-count`).textContent === "37/280", card("fs-012")), "X's count, live");
  await p.click(`${card("fs-012")} .bedit-save`);
  for (let i = 0; i < 50 && show("fs-012").column !== "For review"; i++) await sleep(200);
  const edited = show("fs-012");
  check(where, edited.block && edited.block.body === "Stop babysitting agents. Manage them." && edited.column === "For review" && !edited.approval,
    `saved: its text, not approved any more, back in For review (${JSON.stringify({ body: edited.block && edited.block.body, column: edited.column, approval: edited.approval })})`);
  check(where, cli(["board", "approved", "posts", "fs-012"]).rc === 1, "amarchy board approved: not any more");
  check(where, sentNow().length === sent0 + 1, "an edit sends nothing: the agent finds it on the card");
  const log = JSON.parse(cli(["board", "log", "posts", "--json"]).out || "[]");
  check(where, log.some((r) => r.action === "edit" && r.who === "you" && r.before === POSTS[0][2] && r.after === "Stop babysitting agents. Manage them."),
    "the log has the edit, with what was there before");

  // Discard: asks why first; the reason goes with the message.
  if (layout === "phone") await p.click('.ui-kanban-tabs [data-tab="For review"]');
  await until(p, (sel) => !!document.querySelector(sel), card("fs-015"));
  await p.click(`${card("fs-015")} .tcard-actions .tbtn >> text=Discard`);
  check(where, await until(p, (sel) => /Why discard it\?/.test((document.querySelector(`${sel} .bbox-ask`) || {}).textContent || ""), card("fs-015")),
    "Discard asks why first");
  await p.fill(`${card("fs-015")} .bbox-ask textarea`, "too salesy");
  await p.click(`${card("fs-015")} .bbox-ask .cbtn.send`);
  check(where, await sentBy(sent0 + 2, 15000), "sent, after Undo's moment");
  const why = sentNow()[sent0 + 1] || [];
  check(where, why[2] === "Discard: “Phone: review on the go” (board posts, card fs-015): too salesy", `with its reason (${JSON.stringify(why)})`);
  for (let i = 0; i < 50 && show("fs-015").column !== "Discarded"; i++) await sleep(200);
  check(where, show("fs-015").column === "Discarded", "in Discarded");

  // Swipe (the phone): the next column.
  if (layout === "phone") {
    await p.click('.ui-kanban-tabs [data-tab="For review"]');
    const swiped = await p.evaluate(async () => {
      const cols = document.querySelector(".ui-kanban-cols");
      const t = (x) => [new Touch({ identifier: 1, target: cols, clientX: x, clientY: 400 })];
      cols.dispatchEvent(new TouchEvent("touchstart", { touches: t(300), changedTouches: t(300), bubbles: true }));
      cols.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: t(120), bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      return document.querySelector(".ui-kanban-col.on").dataset.col;
    });
    check(where, swiped === "Ready to post", `a swipe left: the next column (${swiped})`);
    await p.click('.ui-kanban-tabs [data-tab="For review"]');
  }
  shapes[`${where} board`] = await p.evaluate(SHAPE);

  // Back: Tasks' list again (Ctrl+Alt+← on a computer, its Back). Esc isn't back: it only stops a chat.
  if (layout === "wide") {
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await p.keyboard.press("Escape");
    await sleep(200);
    check(where, !!(await p.$(".ui-kanban")), "Esc on it: nothing (it stops a chat, and only that)");
    await p.keyboard.press("Control+Alt+ArrowLeft");
  } else await p.click(".ui-page-back");
  check(where, await until(p, () => !document.querySelector(".ui-kanban") && !!document.querySelector(".board-today .bwrite-wrap")), `${layout === "wide" ? "Ctrl+Alt+←" : "Back"}: Tasks' list again`);

  // Write a task: on Jaken's board, Jaken told.
  await p.fill(".bwrite-wrap textarea", "Renew the car insurance\nIt ends Dec 1");
  await p.click(".bwrite-wrap .cbtn.send");
  check(where, await sentBy(sent0 + 3), "a task you write: sent");
  const asked = sentNow()[sent0 + 2] || [];
  check(where, asked[1] === "jaken-jaken" && /^Renew the car insurance\nIt ends Dec 1\n\n\(A task of mine on your board: board jaken-jaken, card [0-9a-f]{6}\. Help me get it done/.test(asked[2] || ""),
    `to Jaken, with where it is (${JSON.stringify(asked)})`);
  check(where, await until(p, () => /Renew the car insurance/.test((document.querySelector('.board-today > .tsec[data-board="jaken-jaken"]') || {}).textContent || "")),
    "on Jaken's board in Tasks");
  check(where, await p.evaluate(() => document.querySelector(".bwrite-wrap textarea").value === ""), "the box empty again");
  await p.screenshot({ path: path.join(SHOTS, `${where}-tasks-after.png`), fullPage: false });

  // #/b/posts (a card's notification): the board, open.
  await p.evaluate(() => go("#/b/posts"));
  check(where, await until(p, () => !!document.querySelector(".board-today .ui-kanban") && boardsUI.open === "posts"), "#/b/posts opens the board");
  await p.evaluate(() => boardsClose());
  check(where, !errors.length, `no errors on the page (${errors.join(" | ")})`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  HOME = homes.home("boards-view");
  fs.writeFileSync(path.join(HOME, "shot.png"), PNG);
  const port = await freePort();
  const server = await startServer(port, HOME);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of ONLY ? [ONLY] : ["phone", "wide"]) await run(browser, `http://127.0.0.1:${port}/`, layout);
    if (!ONLY) for (const what of ["tasks", "board"]) {
      const a = JSON.stringify(shapes[`phone ${what}`]), b = JSON.stringify(shapes[`wide ${what}`]);
      check(`phone = wide (${what})`, a === b, `the same boards, cards, words and buttons${a === b ? "" : ` (${a} vs ${b})`}`);
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
