// amarchy's pictures for GitHub, drawn by the app itself, with demo chats
// only (never a real one: real chats name clients):
//
//   docs/images/social-preview.png  1280×640, the link's card ("Stop babysitting
//                                   your agents. Manage them."): what X, Slack
//                                   and iMessage show for github.com/ja-818/amarchy
//                                   (uploaded by hand: repo Settings → General →
//                                   Social preview; GitHub has no API for it)
//   docs/images/hero.png            the README's top: the board on a computer,
//                                   and on a phone with a chat open
//
// Both are made of shots of the real app (the board on a phone and on a
// computer, a chat's reply on the phone), set over the theme's wallpaper
// with its pixel art. SHOTS=<folder> keeps those shots (else a temporary one).
//
//   node docs/images/make.js
//
// Needs what test/today-view.js needs (Chromium, playwright-core:
// PLAYWRIGHT_CORE=<its folder>). It starts its own app server from this
// checkout's bin/amarchy, with a home of its own, in Tokyo Night (the
// default theme) on the wallpaper it comes with. Run it again after the board or the
// chat changes their look.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPlaywright, freePort, startServer, findChrome, until, sleep, T, NOW } = require("../../test/today-view.js");

const OUT = path.resolve(__dirname);
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "amarchy-shots-"));
const THEME = "tokyo-night";

// ---- the demo: a dozen chats across five made-up projects

const C = (o) => ({ engine: "chat", path: `/tmp/${o.name}`, status: "idle", ...o, today: T(o.today || {}) });
const CHATS = [
  // At work
  C({ id: "shop-pay", repo: "shop", name: "pay", task: "Checkout: Apple Pay", status: "working", priority: "high",
      today: { goal: "Add Apple Pay to checkout" } }),
  C({ id: "backend-search", repo: "backend", name: "search", task: "Perf: search under 100 ms", status: "working",
      today: { goal: "Get search under 100 ms" } }),
  C({ id: "mobile-push", repo: "mobile", name: "push", task: "Push: order updates", status: "working",
      today: { goal: "Notify buyers when an order ships" } }),
  C({ id: "site-e2e", repo: "site", name: "e2e", task: "Test: signup flow", status: "running", running: "the e2e suite, 214 tests", background: 1,
      today: { goal: "Cover signup end to end" } }),
  // Now
  C({ id: "backend-login", repo: "backend", name: "login", task: "Fix: flaky login test", unseen: true,
      today: { goal: "Make the login test pass every time", state: "waiting",
               asks: [{ question: "Ship it to main?", options: [{ label: "Ship it", send: "Ship it" }, { label: "Not yet", send: "Not yet" }] }] } }),
  C({ id: "shop-dark", repo: "shop", name: "dark", task: "Bug: dark mode flash", status: "waiting", asks: "Claude asks to run npm install",
      permission: { request_id: "req-1", tool: "Bash" }, today: { goal: "No white flash on load" } }),
  C({ id: "docs-quick", repo: "docs", name: "quick", task: "Guide: quickstart", today: { goal: "A five-minute quickstart", state: "done",
      links: [{ label: "Open the PR", url: "https://github.com/example/docs/pull/42" }] } }),
  C({ id: "site-price", repo: "site", name: "price", task: "Landing: pricing page", unseen: true,
      said: "Three plans, a monthly/yearly toggle, live on the preview.", today: { goal: "Ship the new pricing page" } }),
  C({ id: "mobile-crash", repo: "mobile", name: "crash", task: "Crash: photo picker", today: { goal: "Stop the crash on iOS 18", at: NOW - 3600 } }),
  // For later
  C({ id: "backend-limits", repo: "backend", name: "limits", task: "API: rate limits", priority: "low", today: { goal: "Rate-limit the public API" } }),
  C({ id: "docs-i18n", repo: "docs", name: "i18n", task: "Translate: Spanish", priority: "low", today: { goal: "The docs in Spanish" } }),
  C({ id: "shop-ab", repo: "shop", name: "ab", task: "Test: new hero copy", priority: "low", today: { goal: "A/B the homepage hero" } }),
];
const PROJECTS = ["shop", "backend", "site", "mobile", "docs"].map((name) => ({ name, sessions: CHATS.filter((c) => c.repo === name).length }));

// The chat the phone shows: you asked, Claude did it, and its reply is a
// briefing and a button.
const CHAT = CHATS.find((c) => c.id === "backend-login");
const CONVERSATION = [
  { kind: "user", text: "The login test fails one run in ten. Find out why and fix it.", turn: true, key: "u1:0", rec: "u1", at: "" },
  { kind: "tool", id: "t1", name: "Bash", input: { command: "npm test -- login --repeat 50" }, key: "t1:0", at: "" },
  { kind: "result", tool: "t1", error: false, text: "", key: "t1r:0", at: "" },
  { kind: "tool", id: "t2", name: "Edit", input: { file_path: "test/login.test.ts" }, key: "t2:0", at: "" },
  { kind: "result", tool: "t2", error: false, text: "", key: "t2r:0", at: "" },
  { kind: "claude", key: "c1:0", at: "", text: [
    "The login test is fixed: it raced the session cookie, and now waits for it.",
    "",
    "```brief",
    "Checked: 50 runs in a row, all green, on CI too",
    "Open: Nothing",
    "You: Say whether to ship it",
    "```",
    "",
    "```choices question=\"Ship it to main?\"",
    "- Ship it | Ship it: merge to main and push",
    "- Not yet",
    "```",
    "",
    "## The test raced the cookie",
    "It logged in, then read the session before the server had set it.",
    "",
    "## It waits for the cookie now",
    "One line in `test/login.test.ts`.",
    "",
    "```goal state=\"waiting\"",
    "Make the login test pass every time",
    "```",
  ].join("\n") },
];

// ---- the shots, from the real app

const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  wide: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
};

async function page(browser, layout, port) {
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}` });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  const ev = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  await p.route("**/api/session/*/stream", (r) => {
    const id = decodeURIComponent(r.request().url().split("/api/session/")[1].split("/")[0]);
    const c = CHATS.find((x) => x.id === id) || CHAT;
    r.fulfill({ status: 200, contentType: "text/event-stream",
      body: `retry: 600000\n\n${ev("session", c)}${ev("live", { state: "idle", pending: [], queue: [] })}`
        + `${ev("conversation", { reset: true, items: id === CHAT.id ? CONVERSATION : [], start: 0 })}${ev("screen", { live: true })}` });
  });
  await p.route("**/api/session/*/composer", (r) => r.fulfill({ json: { engine: "chat", commands: [], models: [], model: "opus", mode: "default" } }));
  await p.route("**/api/session/*/agent", (r) => r.fulfill({ json: { agent: {}, live: {} } }));
  for (const what of ["seen", "send", "answer", "keys"]) await p.route(`**/api/session/*/${what}`, (r) => r.fulfill({ json: { ok: true } }));
  await p.addInitScript(({ chats, projects }) => {
    Object.defineProperty(Navigator.prototype, "standalone", { get: () => true });
    try { localStorage.setItem("tour", "seen"); localStorage.setItem("amarchy-push", "no"); } catch (e) { /* no storage yet */ }
    const parse = JSON.parse;
    JSON.parse = function (text, ...rest) {
      const v = parse.call(this, text, ...rest);
      if (v && typeof v === "object" && Array.isArray(v.sessions) && "share" in v) {
        v.sessions = chats.map((c) => ({ ...c, today: { ...c.today } }));
        v.projects = projects;
        v.today = { loops: [], source: "", error: "", sent: {}, assistant: null };
        v.needs = 2;
        v.missions = { today: [{ at: Date.now() / 1000 - 3600 }, { at: Date.now() / 1000 - 600 }, { at: Date.now() / 1000 - 60 }], streak: 6, best: 9,
                       week: [2, 4, 3, 5, 6, 4, 3], total: 87, combo: 900, goal: 5, fast: 120, replies: { n: 12, fast: 8, streak: 6, best: 9 }, badges: [] };
      }
      return v;
    };
  }, { chats: CHATS, projects: PROJECTS });
  return p;
}

// The app as it settles: fonts in, no toast, nothing moving.
async function settle(p) {
  await p.evaluate(() => document.fonts.ready);
  await p.addStyleTag({ content: ".toast, .toasts { display: none !important; } *, *::before, *::after { animation-play-state: paused !important; caret-color: transparent !important; }" });
  await sleep(400);
}

async function boardShot(browser, layout, port) {
  const p = await page(browser, layout, port);
  await p.goto("/");
  if (!(await until(p, () => typeof app !== "undefined" && app.view && document.querySelector(".tcard .today-go"), null, 10000))) throw new Error(`${layout}: no board`);
  await p.evaluate(() => { const w = document.querySelector(".today-working"); if (w) w.open = true; if (typeof uiState !== "undefined") uiState.open.set("working", true); });
  await settle(p);
  const file = path.join(SHOTS, `${layout}-board.png`);
  await p.screenshot({ path: file });
  if (p.errors.length) throw new Error(`${layout}: page errors: ${p.errors.join("; ")}`);
  await p.context().close();
  return file;
}

async function chatShot(browser, port) {
  const p = await page(browser, "phone", port);
  await p.goto("/");
  await until(p, () => typeof app !== "undefined" && app.view && document.querySelector(".tcard .today-go"), null, 10000);
  await p.evaluate((id) => {
    const head = document.querySelector(`.tcard[data-id="${id}"] .today-go`);
    head.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    head.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
    head.click();
  }, CHAT.id);
  if (!(await until(p, () => !!document.querySelector(".chat .msg.claude .brief"), null, 10000))) throw new Error("phone: the chat's reply didn't come");
  await settle(p);
  // From the top of the conversation: what you asked, then Claude's reply.
  await p.evaluate(() => { const c = app.session && app.session.chat; if (c) c.scroller.scrollTop = 0; });
  await sleep(300);
  const file = path.join(SHOTS, "phone-chat.png");
  await p.screenshot({ path: file });
  if (p.errors.length) throw new Error(`phone chat: page errors: ${p.errors.join("; ")}`);
  await p.context().close();
  return file;
}

// ---- the pictures: drawn in the app's own page (its theme, its font, its
// pixel art, its wallpaper as the app wears it)

const png = (file) => `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;

const CSS = `
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  body::before { display: none !important; }
  .gh { position: fixed; inset: 0; overflow: hidden; background-color: var(--surface);
    background-image: var(--gh-wall); background-size: cover; background-position: center;
    font-family: var(--font); color: var(--text); }
  .gh-shade { position: absolute; inset: 0; z-index: 1;
    background: linear-gradient(90deg, color-mix(in srgb, var(--surface) 94%, transparent) 0%, color-mix(in srgb, var(--surface) 80%, transparent) 42%, color-mix(in srgb, var(--surface) 35%, transparent) 70%, color-mix(in srgb, var(--surface) 20%, transparent) 100%); }
  .gh-hero .gh-shade { background: color-mix(in srgb, var(--surface) 45%, transparent); }
  .gh-words { position: absolute; z-index: 4; left: 68px; top: 0; bottom: 0; width: 590px; display: flex; flex-direction: column; justify-content: center; gap: 24px; }
  .gh-mark { display: flex; align-items: center; gap: 16px; font-size: 32px; font-weight: 700; color: var(--text-strong, #c0caf5); }
  .gh-mark img { width: 52px; height: 52px; display: block; }
  .gh-bots { display: flex; align-items: flex-end; gap: 16px; }
  .gh h1 { margin: 0; font-size: 58px; line-height: 1.06; font-weight: 800; letter-spacing: -0.04em; color: #c0caf5; }
  .gh h1 em { font-style: normal; color: var(--accent); }
  .gh-sub { margin: 0; max-width: 540px; font-size: 24px; line-height: 1.4; color: var(--text); letter-spacing: -0.01em; }
  .gh-chips { display: flex; gap: 10px; }
  .gh-chip { font-size: 17px; font-weight: 600; padding: 8px 13px; border: 1px solid var(--border); color: var(--text); background: color-mix(in srgb, var(--surface) 80%, transparent); }
  .gh-chip b { color: var(--accent); }
  .gh-win { position: absolute; z-index: 2; overflow: hidden; border-radius: 12px; background: var(--surface);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--text) 24%, transparent), 0 30px 80px rgba(0, 0, 0, .6); }
  .gh-bar { height: 32px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #101119; }
  .gh-bar i { width: 12px; height: 12px; border-radius: 50%; background: #2a2d40; }
  .gh-bar span { margin: 0 auto; transform: translateX(-30px); font-size: 13px; color: var(--text-muted); padding: 3px 60px; border-radius: 6px; background: #1a1b26; }
  .gh-win img { display: block; width: 100%; }
  .gh-phone { position: absolute; z-index: 3; padding: 10px; border-radius: 52px; background: #08080c;
    box-shadow: 0 0 0 2px #2c2f44, 0 40px 90px rgba(0, 0, 0, .7); }
  .gh-screen { position: relative; overflow: hidden; border-radius: 42px; background: var(--surface); }
  .gh-screen img { display: block; width: 100%; }
  .gh-screen::before { content: ""; position: absolute; z-index: 1; top: 11px; left: 50%; transform: translateX(-50%); width: 32%; height: 28px; border-radius: 16px; background: #08080c; }
  .gh-notch { height: 46px; background: var(--surface); }
`;

async function compose(browser, port, { file, width, height, scale, shots, kind }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, baseURL: `http://127.0.0.1:${port}` });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem("tour", "seen"); localStorage.setItem("amarchy-push", "no"); } catch (e) { /* no storage */ } });
  await p.goto("/");
  await until(p, () => typeof uiPixels === "function" && typeof tourBot === "function" && typeof app !== "undefined" && app.view, null, 10000);
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(({ shots, kind, css }) => {
    const wall = getComputedStyle(document.documentElement).getPropertyValue("--wallpaper-wide").trim()
      || getComputedStyle(document.documentElement).getPropertyValue("--wallpaper").trim();
    for (const n of [...document.body.children]) n.remove();
    document.body.className = "";
    document.head.append(h("style", {}, css));
    const win = (src, style) => h("div", { class: "gh-win", style },
      h("div", { class: "gh-bar" }, h("i"), h("i"), h("i"), h("span", {}, "amarchy")), h("img", { src }));
    const phone = (src, style) => h("div", { class: "gh-phone", style }, h("div", { class: "gh-screen" }, h("div", { class: "gh-notch" }), h("img", { src })));
    const card = h("div", { class: `gh gh-${kind}`, style: `--gh-wall: ${wall || "none"}` }, h("div", { class: "gh-shade" }));
    if (kind === "social") {
      card.append(
        h("div", { class: "gh-words" },
          h("div", { class: "gh-mark" }, h("img", { src: "icon.svg", alt: "" }), "amarchy"),
          h("h1", {}, "Stop babysitting", h("br"), "your agents.", h("br"), h("em", {}, "Manage"), " them."),
          h("p", { class: "gh-sub" }, "One board says who needs you and what for. Every reply is a briefing. Shipping is a button."),
          h("div", { class: "gh-bots" }, uiPixels(tourBot("a"), { scale: 5 }), uiPixels(tourBot("g"), { scale: 5 }), uiPixels(tourBot("p"), { scale: 5 }),
            uiPixels(tourBot("y"), { scale: 5 }), uiPixels(tourBot("r"), { scale: 5 }), uiPixels(tourBot("c"), { scale: 5 }))),
        win(shots.wide, "left: 640px; top: 60px; width: 820px;"),
        phone(shots.chat, "left: 912px; top: 128px; width: 290px;"));
    } else {
      card.append(
        win(shots.wide, "left: 56px; top: 56px; width: 980px;"),
        phone(shots.board, "left: 826px; top: 120px; width: 280px;"),
        phone(shots.chat, "left: 1120px; top: 76px; width: 280px;"));
    }
    document.body.append(card);
  }, { shots, kind, css: CSS });
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  await sleep(300);
  await p.screenshot({ path: file });
  if (errors.length) throw new Error(`${kind}: page errors: ${errors.join("; ")}`);
  await ctx.close();
  return file;
}

(async () => {
  const pw = loadPlaywright();
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "amarchy-images-"));
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    // The default theme and the wallpaper it comes with, as a new amarchy wears them.
    const look = await fetch(`http://127.0.0.1:${port}/api/look`, { method: "POST", headers: { "Content-Type": "application/json", "Tailscale-User-Login": "tester@test", Origin: `http://127.0.0.1:${port}` },
                                                                body: JSON.stringify({ theme: THEME, wallpaper: "theme" }) });
    if (!look.ok) throw new Error(`the look: ${look.status} ${await look.text()}`);
    const board = await boardShot(browser, "phone", port);
    const wide = await boardShot(browser, "wide", port);
    const chat = await chatShot(browser, port);
    const shots = { board: png(board), wide: png(wide), chat: png(chat) };
    const out = [
      await compose(browser, port, { file: path.join(OUT, "social-preview.png"), width: 1280, height: 640, scale: 1, shots, kind: "social" }),
      await compose(browser, port, { file: path.join(OUT, "hero.png"), width: 1440, height: 720, scale: 1.5, shots, kind: "hero" }),
    ];
    for (const f of out) console.log(`${path.relative(process.cwd(), f)}  ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(home, { recursive: true, force: true });
    if (!process.env.SHOTS) fs.rmSync(SHOTS, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
