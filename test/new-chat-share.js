// The new chat's model and what you share into amarchy, in a browser.
// Checked: the new chat's model pill (Opus until you pick another, the
// models Claude said there are, the pick kept on the host for every new chat
// and sent with the chat it starts); POST /api/share as an iPhone's Shortcut
// sends it (the key in its address, no Origin), refused without the key and
// from a page elsewhere; the share sheet on every screen ("Send" sends the
// pictures and words to that chat, a chat tapped opens with them in its box),
// let go when it's closed, gone when another screen took it. On a phone and
// on a wide screen, with screenshots.
//
//   node test/new-chat-share.js          both layouts
//   node test/new-chat-share.js phone    one layout (phone | wide)
//
// Needs what test/brief-view.js needs (Chromium, playwright-core). It starts
// its own app server from this checkout's bin/amarchy, with a home and state
// of its own. Exits 0 when every check passed.

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "new-chat-share-"));
const ONLY = process.argv[2];

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

// A request as a Shortcut sends it: no Origin, no Sec-Fetch-*.
function post(port, url, body, headers = {}) {
  return new Promise((ok, no) => {
    const req = http.request({ host: "127.0.0.1", port, path: url, method: "POST",
                               headers: { "Content-Length": body.length, ...headers } }, (res) => {
      let data = "";
      res.on("data", (d) => { data += d; });
      res.on("end", () => ok({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", no);
    req.end(body);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(page, fn, arg, ms = 6000) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; }
}

async function run(browser, layout, port, home) {
  const where = layout;
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}` });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // What the page sends a chat and starts (no real Claude here).
  const sent = [], started = [];
  await page.route("**/api/session/*/send", (r) => { sent.push({ url: r.request().url(), body: r.request().postDataJSON() }); r.fulfill({ json: { ok: true } }); });
  // A stream that ends and comes back later (a 404 would close the chat).
  await page.route("**/api/session/*/stream", (r) => r.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" }));
  await page.route("**/api/session/*/composer", (r) => r.fulfill({ json: { engine: "chat", commands: [], models: MODELS, model: "opus", mode: "default" } }));
  await page.route("**/api/new", (r) => { started.push(r.request().postDataJSON()); r.fulfill({ status: 500, json: { error: "not here" } }); });
  // Chats in the list (the server under test has none).
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
  await page.goto(layout === "wide" ? "/#/new" : "/");
  await until(page, () => window.app && app.view && app.view.sessions && app.view.sessions.length);
  // The phone opens on the board: its + is the new chat's box.
  if (layout === "phone") await page.evaluate(() => document.querySelector(".board-new-btn").click());

  // ---- the new chat's model
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, `${layout}-new-chat.png`) });
  const pill = () => page.evaluate(() => (document.querySelector(".start-chat .pick.model .name") || {}).textContent);
  check(where, await until(page, () => (document.querySelector(".start-chat .pick.model .name") || {}).textContent === "Opus 5.5"),
        `the new chat starts on Opus 5.5 (${await pill()})`);
  await page.click(".start-chat .pick.model");
  const menu = layout === "wide" ? ".picker-row" : ".sheet .menu-item";
  await page.waitForSelector(menu);
  const offered = await page.$$eval(menu, (xs) => xs.filter((x) => x.offsetParent !== null).map((x) => x.textContent));
  check(where, offered.some((t) => t.startsWith("Sonnet 5.5")) && !offered.some((t) => t.startsWith("Opus 4.8")),
        `the main models, the dated ones under Other versions (${offered.length} shown)`);
  await sleep(700);
  await page.screenshot({ path: path.join(SHOTS, `${layout}-model-menu.png`) });
  await page.locator(menu, { hasText: "Sonnet 5.5" }).first().click();
  check(where, await until(page, () => (document.querySelector(".start-chat .pick.model .name") || {}).textContent === "Sonnet 5.5"),
        "picked: Sonnet 5.5 on the pill");
  await sleep(300);
  const kept = fs.readFileSync(path.join(home, "state", "amarchy", "new-model"), "utf8").trim();
  check(where, kept === "sonnet", `kept on the host for every new chat (${kept})`);
  check(where, await until(page, () => app.view.new_model === "sonnet", null, 4000), "and the list says so on every screen");
  await page.fill(".start-chat textarea", "Look into the search page");
  await page.click(layout === "wide" ? ".start-chat .cta.go" : ".start-chat .send");
  await sleep(300);
  check(where, started.length === 1 && started[0].model === "sonnet" && started[0].repo === "proj",
        `the chat it starts is on it (${JSON.stringify(started[0] || {})})`);
  await page.click(".start-chat .pick.model");
  await page.waitForSelector(menu);
  await page.locator(menu, { hasText: "Opus 5.5" }).first().click();
  check(where, await until(page, () => app.view.new_model === "opus"), "back on Opus 5.5");
  await page.fill(".start-chat textarea", "");

  // ---- sharing: refused from a page elsewhere, and without the key
  // Settings: the Shortcut's address, with the key (made the first time it's asked for).
  const url = await page.evaluate(async () => (await (await fetch("/api/share/key")).json()).url);
  const key = fs.readFileSync(path.join(home, "state", "amarchy", "app", "share-key"), "utf8").trim();
  check(where, url === `https://127.0.0.1:${port}/api/share?key=${key}`, `Settings has the Shortcut's address (${url.replace(key, "<key>")})`);
  const bad = await post(port, "/api/share", PNG, { "Content-Type": "image/png" });
  check(where, bad.status === 403, `no key: refused (${bad.status})`);
  const site = await post(port, `/api/share?key=${key}`, PNG, { "Content-Type": "image/png", "Sec-Fetch-Site": "cross-site" });
  check(where, site.status === 403, `a page elsewhere, even with the key: refused (${site.status})`);
  const pdf = await post(port, `/api/share?key=${key}`, Buffer.from("%PDF-1.4 hello"), { "Content-Type": "application/pdf" });
  check(where, pdf.status === 400, `not a picture: said so (${pdf.status} ${pdf.body})`);

  // ---- the Shortcut shares a screenshot (and Android's form, some words with it)
  const got = await post(port, `/api/share?key=${encodeURIComponent(key)}`, PNG, { "Content-Type": "image/png" });
  check(where, got.status === 200 && JSON.parse(got.body).pictures === 1, `the Shortcut's picture came (${got.status} ${got.body})`);
  const form = Buffer.concat([Buffer.from('--B\r\nContent-Disposition: form-data; name="text"\r\n\r\nThis button is broken\r\n--B\r\n' +
    'Content-Disposition: form-data; name="images"; filename="s.png"\r\nContent-Type: image/png\r\n\r\n'), PNG, Buffer.from("\r\n--B--\r\n")]);
  const android = await post(port, "/api/share", form, { "Content-Type": "multipart/form-data; boundary=B", "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "navigate" });
  check(where, android.status === 303 && android.headers.location === "/", `Android's share sheet: back to the app (${android.status} ${android.headers.location})`);
  check(where, await until(page, () => document.querySelector(".sheet-back.share")), "the share sheet shows");
  const sheet = await page.evaluate(() => ({
    title: document.querySelector(".sheet-back.share h2").textContent,
    pics: document.querySelectorAll(".share-preview img").length,
    loaded: [...document.querySelectorAll(".share-preview img")].every((i) => i.complete && i.naturalWidth > 0),
    text: (document.querySelector(".share-text") || {}).textContent,
    rows: [...document.querySelectorAll(".share-row .share-open")].map((x) => x.textContent),
  }));
  check(where, sheet.title === "Send these 2 pictures to a chat" && sheet.pics === 2, `both pictures, as one share (${sheet.title}, ${sheet.pics})`);
  await until(page, () => [...document.querySelectorAll(".share-preview img")].every((i) => i.complete && i.naturalWidth > 0));
  check(where, await page.evaluate(() => [...document.querySelectorAll(".share-preview img")].every((i) => i.naturalWidth > 0)), "the pictures show");
  check(where, sheet.text === "This button is broken", `the words with them (${sheet.text})`);
  check(where, sheet.rows.length === 2 && sheet.rows[0].includes("the login page"), `every chat to send it to (${sheet.rows.join(" | ")})`);
  await sleep(700);
  await page.screenshot({ path: path.join(SHOTS, `${layout}-share-sheet.png`) });

  // Send: to that chat as it is, then the chat opens.
  await page.click(".share-row:nth-child(1) .share-send");
  check(where, await until(page, () => !document.querySelector(".sheet-back.share")), "sent: the sheet goes");
  check(where, sent.length === 1 && sent[0].url.includes("/api/session/proj-a/send") && sent[0].body.images.length === 2
        && sent[0].body.images.every((i) => /^image\//.test(i.type) && i.data.length > 20) && sent[0].body.text === "This button is broken",
        `to that chat, the pictures and the words (${sent.length ? `${sent[0].body.images.length} images, "${sent[0].body.text}"` : "nothing"})`);
  await sleep(1500);
  const after = await page.evaluate(() => app.view.share);
  check(where, after === null, "and the host let it go");
  check(where, await page.evaluate(() => /#\/s\/proj-a$/.test(here())), `the chat opens (${await page.evaluate(() => here())})`);

  // Tapping a chat: it opens with the picture in its box, to say more.
  await page.evaluate(() => go(document.body.classList.contains("desk") ? "#/new" : "#/"));
  await post(port, `/api/share?key=${key}`, PNG, { "Content-Type": "image/png" });
  check(where, await until(page, () => document.querySelector(".sheet-back.share")), "another share: the sheet again");
  await page.click(".share-row:nth-child(2) .share-open");
  check(where, await until(page, () => !document.querySelector(".sheet-back.share") && shareInbox === null
        && (app.desk ? desk.chat : app.session && app.session.chat)), "the chat opens and takes it");
  const box = await page.evaluate(async () => {
    const chat = app.desk ? desk.chat : app.session.chat;
    for (let i = 0; i < 50 && !chat.tray.every((a) => a.state === "ready"); i++) await new Promise((r) => setTimeout(r, 100));
    return { id: chat.id, tray: chat.tray.map((a) => `${a.kind}:${a.state}`), text: chat.input.value };
  });
  check(where, box.id === "proj-b" && box.tray.length === 1 && box.tray[0] === "image:ready", `the picture in its box (${box.id}: ${box.tray})`);
  await page.screenshot({ path: path.join(SHOTS, `${layout}-in-the-box.png`) });
  check(where, sent.length === 1, "and nothing sent until you send it");

  // Closed without a chat: let go.
  await page.evaluate(() => go(document.body.classList.contains("desk") ? "#/new" : "#/"));
  await post(port, `/api/share?key=${key}`, PNG, { "Content-Type": "image/png" });
  check(where, await until(page, () => document.querySelector(".sheet-back.share")), "a third share");
  await page.click(".sheet-back.share .sheet-close");
  await sleep(1500);
  check(where, await page.evaluate(() => app.view.share) === null, "closed: let go on the host");

  // Taken on another screen: the sheet goes here too.
  await post(port, `/api/share?key=${key}`, PNG, { "Content-Type": "image/png" });
  check(where, await until(page, () => document.querySelector(".sheet-back.share")), "a fourth share");
  const id = await page.evaluate(() => app.view.share.id);
  await page.evaluate((sid) => fetch("/api/share/clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sid }) }), id);
  check(where, await until(page, () => !document.querySelector(".sheet-back.share")), "taken elsewhere: gone here too");

  check(where, !errors.length, `no page errors (${errors.join("; ")})`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "new-chat-share-home-"));
  fs.mkdirSync(path.join(home, "state", "amarchy", "claude", "x-y"), { recursive: true });
  fs.writeFileSync(path.join(home, "state", "amarchy", "claude", "x-y", "agent.json"), JSON.stringify({ models: MODELS }));
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of Object.keys(LAYOUTS)) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      if (layout === "wide") await new Promise((r) => setTimeout(r, 100));
      await run(browser, layout, port, home).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
