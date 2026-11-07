// What Claude said, in a browser: the conversation is the only view. A
// reply shows as Claude wrote it, every word in its order, rendered as
// markdown: its "## " sections, lists, tables (a card per row on a phone),
// code. In their place, the blocks it made for you to use (a draft, a link,
// a command, an event, to-dos, a contact, a chat), open, each with its
// buttons; its questions (choices) as buttons, a tap sending the answer;
// asked before something newer, no longer to tap. The goal block isn't
// shown (it's the chat's). An old reply written with update_brief shows as
// the text it held (bin/amarchy brief_text). Nothing runs as markup, only
// safe links open, no Brief | Chat switch anywhere. On a phone and on a wide
// screen, with screenshots.
//
//   node test/reply-view.js            both layouts
//   node test/reply-view.js phone      one layout (phone | wide)
//
// Needs a Chromium and Playwright's `playwright-core` (PLAYWRIGHT_CORE=<its folder>
// or on NODE_PATH; CHROME=<the chrome binary>, else the one Playwright installed,
// found under ~/.cache/ms-playwright). It starts its own app server from this
// checkout's bin/amarchy, with a home and state of its own. Screenshots go to
// SHOTS (default: a folder under the system's temp dir). Exits 0 when every check passed.

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "reply-view-"));
const ONLY = process.argv[2];

// The same app server look-switch.js starts: the app's handler on 127.0.0.1,
// with the Tailscale login and Origin the app expects from its own host.
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

const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};


// An old reply written with update_brief, as the server shows it now (bin/amarchy brief_text).
function briefText(b) {
  const py = `
import importlib.machinery, importlib.util, json, sys
loader = importlib.machinery.SourceFileLoader("am", sys.argv[1])
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
print(json.dumps(am.brief_text(json.loads(sys.argv[2]))))
`;
  const r = require("child_process").spawnSync("python3", ["-I", "-c", py, BIN, JSON.stringify(b)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

const OLD_BRIEF = {
  title: "A plan for the search page", status: "done", goal: "Plan the search page",
  answer: [{ point: "Three steps", detail: "build, test, ship" }],
  artifacts: [{ type: "link", title: "The mockup", url: "https://example.com/mock" }],
  waiting: [{ question: "Start now?", options: [{ label: "Start", send: "Start building" }, { label: "Later" }] }],
};

const REPLY = [
  "The search page works: it filters as you type, <img src=x onerror=\"window.__pwned = 1\">.",
  "",
  "It reads **120 items** and answers in under 50 ms. Draft for the group:",
  "",
  "```whatsapp to=\"C21 group\" phone=\"+57 300 123 4567\"",
  "Hola equipo, les comparto el resumen:",
  "1. Piloto PQR",
  "2. Datos por Excel",
  "```",
  "",
  "## How it compares",
  "",
  "| Option | Speed | Cost |",
  "|---|---|---|",
  "| Local index | 50 ms | free |",
  "| Algolia | 20 ms | $29/mo |",
  "",
  "To run it:",
  "",
  "```command cwd=\"~/Work/search\"",
  "npm run dev -- --host 100.89.29.4",
  "```",
  "",
  "```js",
  "const x = search(\"a\");",
  "```",
  "",
  "```event title=\"ECOS panel\" when=\"2026-10-29T15:40:00-05:00\" end=\"2026-10-29T17:00:00-05:00\" where=\"Teatro Panorama, Bogotá\"",
  "Bring the deck",
  "```",
  "",
  "```link label=\"Bad\"",
  "javascript:window.__pwned=3",
  "```",
  "",
  "```todos title=\"Still open\"",
  "- [ ] Send the C21 summary (today)",
  "- [x] Twilio top-up",
  "```",
  "",
  "## Sources",
  "",
  "- [Search UX guide](https://www.nngroup.com/articles/search/)",
  "",
  "```choices question=\"Ship it to main?\"",
  "- Ship it | Ship it: merge to main and push",
  "- Not yet",
  "```",
  "",
  "```goal state=\"waiting\"",
  "Ship the search page",
  "```",
].join("\n");

const OLD = "11111111-aaaa-4aaa-8aaa-000000000001";
const MID = "44444444-dddd-4ddd-8ddd-000000000004";
const NEW = "22222222-bbbb-4bbb-8bbb-000000000002";
const items = () => [
  { kind: "user", text: "Plan it", turn: true, key: `${OLD}:0`, at: "" },
  { kind: "claude", text: briefText(OLD_BRIEF), key: "b1:0", at: "" },
  { kind: "claude", text: "The plan is in.", aside: true, key: "b2:0", at: "" },
  { kind: "user", text: "Build the search page", turn: true, key: `${MID}:0`, at: "" },
  { kind: "claude", text: "On it.", key: "c2:0", at: "" },
  { kind: "tool", id: "r1", name: "Read", input: { file_path: "/x/app.js" }, key: "c3:0", at: "" },
  { kind: "result", tool: "r1", error: false, text: "", key: "c4:0", at: "" },
  { kind: "claude", text: REPLY, key: "c5:0", at: "" },
];

const failures = [];
function check(where, ok, what) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${where}: ${what}`);
  if (!ok) failures.push(`${where}: ${what}`);
}

async function mount(page, list) {
  await page.evaluate(({ list }) => {
    document.body.innerHTML = "";
    const box = document.createElement("div");
    box.style.cssText = "height:100vh;height:100dvh;display:flex;flex-direction:column;background:var(--surface)";
    document.body.append(box);
    window.__chat = new Chat({ id: "fake-reply",
      row: { id: "fake-reply", engine: "chat", status: "idle", sleeping: false, awake: true, repo: "r", name: "n", path: "/tmp" },
      onSession() {}, onScreen() {}, onGone() {} });
    box.append(window.__chat.el);
    window.__chat.conversation({ reset: true, start: 0, items: list });
  }, { list });
}

async function run(browser, base, layout) {
  console.log(`\n${layout}`);
  const ctx = await browser.newContext({ ...LAYOUTS[layout], extraHTTPHeaders: { "Tailscale-User-Login": "tester@test" } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const posts = [];
  await page.route("**/api/session/fake-reply/*", async (route) => {
    posts.push({ url: route.request().url(), body: route.request().postData() });
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(base);
  await page.waitForSelector("#look", { state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  const list = items();
  await mount(page, list);
  await page.waitForTimeout(300);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${layout}-${name}.png`), fullPage: false });

  const s = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll(".chat-conv > .msg.claude")];
    const last = msgs.at(-1);
    return {
      switch: !!document.querySelector(".view-switch, .vs-btn, .reply, .screen-stage"),
      msgs: msgs.length,
      said: msgs.map((m) => m.textContent.slice(0, 40)),
      order: [...last.children].map((x) => x.matches(".md") ? `md:${(x.querySelector("h2") || x.firstElementChild || x).textContent.slice(0, 18)}`
        : x.matches(".artifacts") ? `block:${x.querySelector(".art").className.split(" ")[1]}` : x.matches(".choices") ? "choices" : x.className),
      text: last.textContent,
      open: [...last.querySelectorAll(".art")].map((a) => a.classList.contains("open")),
      wa: last.querySelector(".art-message .art-actions a")?.getAttribute("href"),
      pre: last.querySelector(".art-message .art-pre")?.textContent,
      gcal: last.querySelector(".art-event .art-actions a")?.getAttribute("href"),
      unsafe: [...last.querySelectorAll("a")].some((a) => /^javascript/i.test(a.getAttribute("href") || "")),
      code: last.querySelector(".md .code code")?.textContent,
      table: [...last.querySelectorAll("table.rtable tbody tr")].map((tr) => [...tr.children].map((td) => `${td.dataset.label || ""}=${td.textContent}`).join(",")),
      todos: [...last.querySelectorAll(".art-todos li")].map((li) => `${li.className}|${li.querySelector(".t").textContent}`),
      qs: [...last.querySelectorAll(".choices .bq-opt")].map((b) => `${b.textContent}${b.disabled ? "(off)" : ""}`),
      oldQs: [...msgs[0].querySelectorAll(".choices .bq-opt")].map((b) => `${b.textContent}${b.disabled ? "(off)" : ""}`),
      old: msgs[0].textContent,
      oldLink: msgs[0].querySelector(".art-link .art-head > a")?.getAttribute("href"),
      goal: window.__chat.goal, goalShown: /Ship the search page|goal state/.test(last.textContent),
      pwned: window.__pwned,
      overflow: window.__chat.scroller.scrollWidth - window.__chat.scroller.clientWidth,
    };
  });
  check(layout, !s.switch, "one view: no Brief | Chat switch, no reply cards");
  check(layout, s.msgs === 3, `every message Claude wrote, but the one it said again after an old brief (${JSON.stringify(s.said)})`);
  check(layout, JSON.stringify(s.order) === JSON.stringify(["md:The search page wo", "block:art-message", "md:How it compares", "block:art-command", "md:jsCopyconst x = se", "block:art-event",
    "block:art-link", "block:art-todos", "md:Sources", "choices"]), `in Claude's order, each block where it wrote it (${JSON.stringify(s.order)})`);
  check(layout, s.text.includes("<img src=x onerror") && s.pwned === undefined && s.text.includes("120 items") && s.text.includes("Search UX guide"),
    "every word, as text: nothing runs as markup");
  check(layout, s.open.every(Boolean) && s.pre.startsWith("Hola equipo") &&
    s.wa === "https://wa.me/573001234567?text=Hola%20equipo%2C%20les%20comparto%20el%20resumen%3A%0A1.%20Piloto%20PQR%0A2.%20Datos%20por%20Excel",
    `the blocks open: the whole draft and Open in WhatsApp (${s.wa})`);
  check(layout, /dates=20261029T204000Z\/20261029T220000Z/.test(s.gcal || "") && !s.unsafe, `an event's Add to Google Calendar; a javascript: link isn't made (${s.gcal})`);
  check(layout, s.code === "const x = search(\"a\");", "a code block stays code");
  check(layout, JSON.stringify(s.table) === JSON.stringify(["=Local index,Speed=50 ms,Cost=free", "=Algolia,Speed=20 ms,Cost=$29/mo"]), `a table, its cells named for the phone's cards (${JSON.stringify(s.table)})`);
  check(layout, JSON.stringify(s.todos) === JSON.stringify(["|Send the C21 summary", "done|Twilio top-up"]), `to-dos (${JSON.stringify(s.todos)})`);
  check(layout, !s.goalShown && s.goal === "Ship the search page", `the goal block isn't shown, it's the chat's (${s.goal})`);
  check(layout, JSON.stringify(s.qs) === JSON.stringify(["Ship it", "Not yet"]) && JSON.stringify(s.oldQs) === JSON.stringify(["Start(off)", "Later(off)"]),
    `the newest questions to tap, an older one's not (${JSON.stringify([s.qs, s.oldQs])})`);
  check(layout, s.old.includes("A plan for the search page") && s.old.includes("Three steps build, test, ship") && s.oldLink === "https://example.com/mock",
    "an old update_brief reply: the text it held, its link a block");
  check(layout, s.overflow <= 1, `no sideways scroll (${s.overflow}px)`);
  await page.evaluate(() => { const m = [...document.querySelectorAll(".chat-conv > .msg.claude")].at(-1); m.scrollIntoView(); });
  await shot("reply-top");
  await page.evaluate(() => { const sc = window.__chat.scroller; sc.scrollTop = sc.scrollHeight; });
  await shot("reply-end");

  // Copy, folding a block, and answering with a tap.
  await page.evaluate(() => { window.copyText = async (t) => { window.__copied = t; }; });
  await page.evaluate(() => [...document.querySelectorAll(".msg.claude")].at(-1).querySelector(".art-command .art-head > .art-btn").click());
  await page.waitForTimeout(100);
  const copied = await page.evaluate(() => window.__copied);
  check(layout, copied === "npm run dev -- --host 100.89.29.4", `Copy copies the command (${copied})`);
  await page.evaluate(() => [...document.querySelectorAll(".msg.claude")].at(-1).querySelector(".art-message .art-toggle").click());
  const folded = await page.evaluate(() => { const a = [...document.querySelectorAll(".msg.claude")].at(-1).querySelector(".art-message");
    return { open: a.classList.contains("open"), quick: a.querySelector(".art-head > .art-btn")?.textContent }; });
  check(layout, !folded.open && folded.quick === "Copy", "a block folds to its row, its Copy at hand");
  const before = posts.filter((p) => p.url.endsWith("/send")).length;
  await page.evaluate(() => [...document.querySelectorAll(".msg.claude")].at(-1).querySelector(".choices .bq-opt").click());
  await page.waitForTimeout(300);
  const sent = posts.filter((p) => p.url.endsWith("/send")).slice(before)[0];
  check(layout, !!sent && sent.body === JSON.stringify({ text: "Ship it: merge to main and push" }), `a tap sends the option's message (${sent && sent.body})`);
  // Your answer comes in: the question's past.
  await page.evaluate(() => window.__chat.conversation({ items: [{ kind: "user", text: "Ship it: merge to main and push", turn: true, key: "33333333-cccc-4ccc-8ccc-000000000003:0", at: "" }] }));
  const past = await page.evaluate(() => { const c = [...document.querySelectorAll(".msg.claude")].at(-1).querySelector(".choices");
    return { past: c.classList.contains("past"), off: [...c.querySelectorAll(".bq-opt")].every((b) => b.disabled), chosen: c.querySelector(".bq-opt.chosen")?.textContent }; });
  check(layout, past.past && past.off && past.chosen === "Ship it", `answered, the question stays as it was, your pick lit (${JSON.stringify(past)})`);

  // Settings: no Replies choice any more.
  await page.evaluate(() => openSettings());
  await page.waitForSelector(".sheet-back.settings");
  const settings = await page.evaluate(() => [...document.querySelectorAll(".sheet-back.settings .section")].map((x) => x.textContent));
  check(layout, !settings.includes("Replies") && !settings.includes("Show replies as"), `Settings: no Brief | Chat (${settings.join(", ")})`);
  await page.evaluate(() => closeSheets());
  check(layout, errors.length === 0, `no page errors (${errors.join("; ") || "none"})`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "reply-view-home-"));
  const server = await startServer(port, home);
  const base = `http://127.0.0.1:${port}/`;
  const browser = await pw.chromium.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
  try {
    for (const layout of Object.keys(LAYOUTS)) {
      if (ONLY && ONLY !== layout) continue;
      await run(browser, base, layout);
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\nscreenshots: ${SHOTS}`);
  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nall checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
