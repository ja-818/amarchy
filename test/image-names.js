// Pictures in a message, by name, and full screen, in a browser.
// Checked: a picture pasted into a chat's box (and a new chat's) is named
// where you type, [Image #1], and its thumbnail says "Image 1"; one taken off
// goes from the words and the rest are counted again; a tap on a thumbnail
// (in the box, in the conversation) opens it full screen, its ✕ at the top
// right, ← → between them, Esc / ✕ / a tap beside it closes it; what's sent
// has the names and the pictures in order, the bubble labelled the same; a
// terminal's [Image #6] labels its thumbnail Image 6. Phone and wide.
//
//   node test/image-names.js          both layouts
//   node test/image-names.js phone    one layout (phone | wide)
//
// Needs what test/reply-view.js needs (Chromium, playwright-core).

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const homes = require("./homes");      // (test/homes.js: its home gone with it, however it ends)

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "image-names-"));
const ONLY = process.argv[2];

// The app server reply-view.js starts: the app's handler on 127.0.0.1, with
// the Tailscale login it expects, and the Origin of its own host on what a
// page sends (a request without one, as a Shortcut's, stays without).
const SHIM = `
import importlib.machinery, importlib.util, os, sys, threading, http.server
bin, port, home = sys.argv[1], int(sys.argv[2]), sys.argv[3]
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", bin)
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
import sys as _sys; _sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(bin)), "..", "test")); import isolate; isolate.timers(am); isolate.downloads(am)      # (test/isolate.py: none of this machine's automations, nor its big downloads)
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

// What Claude said there are (an agent.json), as on this account.
const MODELS = [
  { value: "default", resolvedModel: "claude-haiku-5-5", displayName: "Default (recommended)", description: "Claude Code's choice" },
  { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5", description: "For complex work" },
  { value: "sonnet", resolvedModel: "claude-sonnet-5-5", displayName: "Sonnet 5.5", description: "For everyday tasks" },
  { value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku 5.5", description: "Fastest" },
  { value: "claude-opus-4-8", resolvedModel: "claude-opus-4-8", displayName: "Opus 4.8", description: "" },
];

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC", "base64");

const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};

const CHATS = [
  { id: "proj-a", repo: "proj", name: "a", task: "Fix: the login page", status: "idle", engine: "chat", path: "/tmp/a" },
  { id: "proj-b", repo: "proj", name: "b", task: "Docs: the guide", status: "working", engine: "chat", path: "/tmp/b" },
];

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

// Pictures pasted into a box, as ⌘V pastes a screenshot.
function paste(page, sel, n) {
  return page.evaluate(async ({ sel, n }) => {
    const field = document.querySelector(sel);
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    for (let i = 0; i < n; i++) {
      const c = document.createElement("canvas"); c.width = 400; c.height = 300;
      const g = c.getContext("2d"); g.fillStyle = ["#d33", "#3a3", "#33d"][i % 3]; g.fillRect(0, 0, 400, 300);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const dt = new DataTransfer(); dt.items.add(new File([blob], `shot${i}.png`, { type: "image/png" }));
      field.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }
  }, { sel, n });
}

const labels = (page, sel) => page.$$eval(`${sel} .ui-shot-label`, (xs) => xs.map((x) => x.textContent));

// The viewer: over the whole screen, the ✕ at its top right; Esc closes it.
async function viewer(page, where, what, size) {
  check(where, await until(page, () => document.querySelector(".sheet-back.photo .ui-photo-img")), `${what}: a tap opens it`);
  await sleep(300);
  const box = await page.evaluate(() => {
    const r = document.querySelector(".sheet-back.photo").getBoundingClientRect();
    const x = document.querySelector(".sheet-back.photo .sheet-close").getBoundingClientRect();
    const img = document.querySelector(".ui-photo-img").getBoundingClientRect();
    return { w: r.width, h: r.height, xr: innerWidth - x.right, xt: x.top, iw: img.width, ih: img.height, label: document.querySelector(".ui-photo-label").textContent };
  });
  check(where, box.w === size.width && box.h === size.height, `full screen (${box.w}x${box.h})`);
  check(where, box.xr < 30 && box.xt < 30, `its ✕ at the top right (${box.xr}px from the right, ${box.xt}px down)`);
  check(where, box.iw > size.width * 0.5 || box.ih > size.height * 0.7, `the picture big (${Math.round(box.iw)}px wide)`);
  return box;
}

async function run(browser, layout, port) {
  const where = layout;
  const size = LAYOUTS[layout].viewport;
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}` });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const sent = [];
  await page.route("**/api/session/*/send", (r) => { sent.push(r.request().postDataJSON()); r.fulfill({ json: { ok: true } }); });
  await page.route("**/api/session/*/stream", (r) => r.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" }));
  await page.route("**/api/session/*/composer", (r) => r.fulfill({ json: { engine: "chat", commands: [], models: MODELS, model: "opus", mode: "default" } }));
  await page.addInitScript((chats) => {
    window.__chats = chats;
    const parse = JSON.parse;
    JSON.parse = function (text, ...rest) {
      const v = parse.call(this, text, ...rest);
      if (v && typeof v === "object" && Array.isArray(v.sessions) && "share" in v) {
        v.sessions = window.__chats.map((c) => ({ ...c }));
        v.projects = [{ name: "proj", sessions: 2 }];
      }
      return v;
    };
  }, CHATS);
  await page.goto("/");
  await until(page, () => window.app && app.view && app.view.sessions && app.view.sessions.length);
  await page.evaluate(() => go("#/s/proj-a"));
  check(where, await until(page, () => (app.desk ? desk.chat : app.session && app.session.chat)), "the chat opens");
  const box = ".chat .composer textarea";
  await page.waitForSelector(box);
  await page.fill(box, "Look at");
  await paste(page, box, 1);
  await page.type(box, "and");
  await paste(page, box, 2);
  await until(page, () => { const c = app.desk ? desk.chat : app.session.chat; return c.tray.length === 3 && c.tray.every((a) => a.state === "ready"); });
  let text = await page.inputValue(box);
  check(where, text === "Look at [Image #1] and [Image #2] [Image #3] ", `each picture named where you type (${JSON.stringify(text)})`);
  check(where, JSON.stringify(await labels(page, ".chat .tray")) === '["Image 1","Image 2","Image 3"]', `and on its thumbnail (${await labels(page, ".chat .tray")})`);
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, `${layout}-tray.png`) });

  // Image 1 off: its name out of the words, the others counted again.
  await page.click(".chat .tray .att:first-child .att-x");
  text = await page.inputValue(box);
  check(where, text === "Look at and [Image #1] [Image #2] ", `one taken off: named again (${JSON.stringify(text)})`);
  check(where, JSON.stringify(await labels(page, ".chat .tray")) === '["Image 1","Image 2"]', `thumbnails too (${await labels(page, ".chat .tray")})`);

  // A tap on a thumbnail: full screen.
  await page.click(".chat .tray .att:nth-child(2) .ui-shot");
  const v = await viewer(page, where, "in the box", size);
  check(where, v.label === "Image 2 · 2 of 2", `which one it is (${v.label})`);
  await page.screenshot({ path: path.join(SHOTS, `${layout}-photo.png`) });
  await page.keyboard.press("ArrowLeft");
  check(where, await until(page, () => document.querySelector(".ui-photo-label").textContent.startsWith("Image 1")), "← goes to Image 1");
  await page.keyboard.press("Escape");
  check(where, await until(page, () => !document.querySelector(".sheet-back.photo")), "Esc closes it");
  check(where, (await page.inputValue(box)) === text && sent.length === 0, "the box as it was, nothing sent");

  // Sent: the words name them, the bubble's thumbnails say which.
  await page.click(".chat .cbtn.send");
  await sleep(500);
  check(where, sent.length === 1 && sent[0].text.trim() === "Look at and [Image #1] [Image #2]" && sent[0].images.length === 2,
        `sent: the words with the names, the pictures in order (${sent.length && JSON.stringify(sent[0].text)}, ${sent.length && sent[0].images.length})`);
  // (A computer goes back to the board once it's sent: the chat opened again.)
  if (layout === "wide") await page.evaluate(() => go("#/s/proj-a"));
  await page.waitForSelector(box);
  // In the conversation, as the chat engine writes it (its pictures, then its words).
  await page.evaluate(() => {
    const c = app.desk ? desk.chat : app.session.chat;
    const f = document.createDocumentFragment();
    c.add({ kind: "user", key: "r8:0", rec: "r8", text: "[image]", image: 0, turn: true }, f);
    c.add({ kind: "user", key: "r8:1", rec: "r8", text: "[image]", image: 1 }, f);
    c.add({ kind: "user", key: "r8:2", rec: "r8", text: "Look at and [Image #1] [Image #2]", turn: true }, f);
    c.scroller.querySelector(".msg.user, .msg") ? c.scroller.append(f) : c.scroller.prepend(f);
  });
  const bubble = '.chat .msg.user[data-rec="r8"]';
  await page.waitForSelector(bubble);
  check(where, JSON.stringify(await labels(page, bubble)) === '["Image 1","Image 2"]', `the bubble's thumbnails (${await labels(page, bubble)})`);
  const chips = await page.$$eval(`${bubble} .chip.image`, (xs) => xs.map((x) => x.textContent));
  check(where, JSON.stringify(chips) === '["Image 1","Image 2"]', `its words name them (${chips})`);
  await page.$eval(bubble, (b) => b.scrollIntoView());
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, `${layout}-sent.png`) });
  await page.click(`${bubble} .ui-shot >> nth=1`);
  const v2 = await viewer(page, where, "in the conversation", size);
  check(where, v2.label === "Image 2 · 2 of 2", `the one tapped (${v2.label})`);
  await page.click(".sheet-back.photo .sheet-close");
  check(where, await until(page, () => !document.querySelector(".sheet-back.photo")), "its ✕ closes it");

  // A conversation's message, as Claude's terminal writes it (counted over
  // the conversation): the thumbnails as its words name them.
  await page.evaluate(() => {
    const c = app.desk ? desk.chat : app.session.chat;
    const f = document.createDocumentFragment();
    c.add({ kind: "user", key: "r9:0", rec: "r9", text: "Before: [Image #6] after: [Image #7]", turn: true }, f);
    c.add({ kind: "user", key: "r9:1", rec: "r9", text: "[image]", image: 0 }, f);
    c.add({ kind: "user", key: "r9:2", rec: "r9", text: "[image]", image: 1 }, f);
    document.body.append(h("div", { id: "probe" }, f));
  });
  check(where, JSON.stringify(await labels(page, "#probe")) === '["Image 6","Image 7"]', `a terminal's [Image #6]: so labelled (${await labels(page, "#probe")})`);
  await page.evaluate(() => document.getElementById("probe").remove());

  // The new chat's box: the same.
  await page.evaluate(() => go(app.desk ? "#/new" : "#/"));
  if (layout === "phone") { await sleep(300); await page.evaluate(() => document.querySelector(".board-new-btn").click()); }
  const nbox = ".start-chat textarea";
  await page.waitForSelector(nbox);
  await page.fill(nbox, "Fix");
  await paste(page, nbox, 2);
  await until(page, () => document.querySelectorAll(".start-chat .tray .ui-shot").length === 2);
  check(where, (await page.inputValue(nbox)) === "Fix [Image #1] [Image #2] ", `a new chat's box names them too (${JSON.stringify(await page.inputValue(nbox))})`);
  check(where, JSON.stringify(await labels(page, ".start-chat .tray")) === '["Image 1","Image 2"]', "and labels them");
  await page.click(".start-chat .tray .att:first-child .att-x");
  check(where, (await page.inputValue(nbox)) === "Fix [Image #1] ", `one off, counted again (${JSON.stringify(await page.inputValue(nbox))})`);
  await page.click(".start-chat .tray .ui-shot");
  await viewer(page, where, "in a new chat's box", size);
  await page.screenshot({ path: path.join(SHOTS, `${layout}-new-photo.png`) });
  await page.mouse.click(5, size.height / 2);
  check(where, await until(page, () => !document.querySelector(".sheet-back.photo")), "a tap beside the picture closes it");

  check(where, !errors.length, `no page errors (${errors.join("; ")})`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  const home = homes.home("image-names");
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
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
