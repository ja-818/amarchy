// Where the conversation is, in a browser: it never moves away from what
// you're reading by itself. A chat you open lands on the top of Claude's
// reply; then typing in the box, the box taking another line or the
// keyboard coming up, the stream coming back (the phone woke, the server
// restarted) with its window moved on or drawn all over again, and a turn
// ending while you write: you're still on the same words. A turn that ends
// while you only watch still lands on its reply's top. On a phone and on a
// wide screen, with screenshots.
//
// Each layout runs twice: as Chrome, and as Safari, which has no scroll
// anchoring to put back a view the page moved for an instant (Chrome's hid
// the box pulling the view up on each key of a long message, which Safari,
// on a Mac and an iPhone, showed).
//
//   node test/chat-scroll.js          both layouts, as both browsers
//   node test/chat-scroll.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs (Chromium, playwright-core). It starts
// its own app server from this checkout's bin/amarchy, with a home and state
// of its own. Exits 0 when every check passed.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const homes = require("./homes");      // (test/homes.js: its home gone with it, however it ends)
const { loadPlaywright, freePort, startServer, findChrome, sleep, check, failures } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "chat-scroll-"));
const ONLY = process.argv[2];
const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};

const PARAS = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}: words enough to make the reply longer than a phone or a computer's screen.`).join("\n\n");
// Its Briefing alone is taller than the screen: it lands on its top.
const REPLY = `The page works.\n\n${PARAS}\n\n\`\`\`brief\nChecked: both layouts\nYou: Nothing\n\`\`\`\n\n## More\n\nA few more words.\n\n## Sources\n\n- [A guide](https://example.com/guide)`;
const ITEMS = [
  { kind: "user", text: "Plan it", turn: true, key: "u1:0", at: "" },
  { kind: "claude", text: `The plan.\n\n${PARAS}`, key: "c1:0", at: "" },
  { kind: "user", text: "Build it", turn: true, key: "u2:0", at: "" },
  { kind: "claude", text: "On it.", key: "c2:0", at: "" },
  { kind: "tool", id: "t1", name: "Read", input: { file_path: "/x/app.js" }, key: "c3:0", at: "" },
  { kind: "result", tool: "t1", error: false, text: "", key: "c4:0", at: "" },
  { kind: "claude", text: REPLY, key: "c5:0", at: "" },
];

const ENGINES = ["chrome", "safari"];

async function run(browser, layout, engine, port) {
  const as = `${layout} as ${engine}`;
  const ctx = await browser.newContext({ ...LAYOUTS[layout], extraHTTPHeaders: { "Tailscale-User-Login": "tester@test" } });
  await ctx.addInitScript(() => localStorage.setItem("tour", "1"));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/session/fake-scroll/*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector("#look", { state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${layout}-${engine}-${name}.png`) });

  // The chat, as reply-view.js mounts it: its own column, the whole page.
  // As Safari: no scroll anchoring anywhere.
  const mount = () => page.evaluate(({ items, safari }) => {
    if (safari) document.head.append(Object.assign(document.createElement("style"), { textContent: "* { overflow-anchor: none !important; }" }));
    document.body.innerHTML = "";
    const box = document.createElement("div");
    box.id = "box";
    box.style.cssText = "height:100vh;height:100dvh;display:flex;flex-direction:column;background:var(--surface)";
    document.body.append(box);
    window.__chat = new Chat({ id: "fake-scroll",
      row: { id: "fake-scroll", engine: "chat", status: "idle", sleeping: false, awake: true, repo: "r", name: "n", path: "/tmp" },
      onSession() {}, onScreen() {}, onGone() {} });
    window.__chat.live = { state: "idle" };
    box.append(window.__chat.el);
    window.__chat.conversation({ reset: true, start: 0, items });
  }, { items: ITEMS, safari: engine === "safari" });
  // Where the view is: its scroll, how far from the bottom, the last reply's top on the screen, the words at its top and bottom edges.
  const at = () => page.evaluate(() => {
    const c = window.__chat, s = c.scroller, v = s.getBoundingClientRect();
    const reply = [...document.querySelectorAll(".chat-conv > .msg.claude")].at(-1);
    const word = (y) => { const el = document.elementFromPoint(v.left + v.width / 2, y); return el ? el.textContent.slice(0, 40) : ""; };
    return { top: Math.round(s.scrollTop), fromBottom: Math.round(s.scrollHeight - s.clientHeight - s.scrollTop),
             replyTop: Math.round(reply.getBoundingClientRect().top - v.top), sameReply: reply === window.__reply,
             edge: Math.round(s.scrollTop + s.clientHeight), first: word(v.top + 30), last: word(v.bottom - 30) };
  });
  const scrollTo = (fromBottom) => page.evaluate((n) => { const s = window.__chat.scroller; s.scrollTop = s.scrollHeight - s.clientHeight - n; }, fromBottom);
  const keep = () => page.evaluate(() => { window.__reply = [...document.querySelectorAll(".chat-conv > .msg.claude")].at(-1); });
  const box = () => page.locator(".chat-dock textarea");
  // (Then a moment, for the view to take the room the box gave back.)
  const clearBox = async () => { await box().fill(""); await page.evaluate(() => document.activeElement && document.activeElement.blur()); await sleep(100); };

  await mount();
  await sleep(300);
  let a = await at();
  check(as, a.replyTop >= 0 && a.replyTop <= 24, `a chat you open lands on the top of Claude's reply (${a.replyTop}px from the top)`);

  // Typing: the view stays on the words you read, at the end and higher up.
  for (const up of [0, 160, 700]) {
    await scrollTo(up);
    await sleep(100);
    const was = await at();
    await box().click();
    await page.keyboard.type("I read it all, and");
    await sleep(150);
    let now = await at();
    check(as, Math.abs(now.top - was.top) <= 2 && now.first === was.first,
      `${up ? "reading higher up" : "at the end"}, typing in the box doesn't move the view (${was.top} → ${now.top})`);
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("a second line");
    await sleep(150);
    now = await at();
    check(as, Math.abs(now.edge - was.edge) <= 2 && now.last === was.last,
      `${up ? "reading higher up" : "at the end"}, the box taking another line keeps the lines over it (bottom edge ${was.edge} → ${now.edge})`);
    // A long message, the box many lines tall: each key on its last line
    // measures the box again, and that doesn't pull the view up.
    for (let i = 3; i <= 9; i++) { await page.keyboard.press("Shift+Enter"); await page.keyboard.type(`line ${i}`); }
    await page.keyboard.press("Shift+Enter");
    await sleep(150);
    const tall = await at();
    for (const ch of "and more") { await page.keyboard.type(ch); await sleep(30); }
    await sleep(150);
    now = await at();
    const boxTall = await page.evaluate(() => window.__chat.input.offsetHeight);
    check(as, boxTall > 200 && Math.abs(now.edge - tall.edge) <= 2 && now.last === tall.last && (up > 0 || now.fromBottom <= 2),
      `${up ? "reading higher up" : "at the end"}, typing on the last line of a box ${boxTall}px tall doesn't move the view (bottom edge ${tall.edge} → ${now.edge}, ${now.fromBottom}px from the end)`);
    if (!up) await shot("long-message");
    await clearBox();
  }

  // The keyboard comes up (the page loses 300px under the box), and goes.
  await scrollTo(500);
  await sleep(100);
  const before = await at();
  await box().click();
  await page.evaluate(() => { document.getElementById("box").style.height = "calc(100dvh - 300px)"; });
  await sleep(200);
  const up = await at();
  check(as, Math.abs(up.edge - before.edge) <= 2 && up.last === before.last,
    `the keyboard coming up: the words over the box are still over it ("${before.last}" → "${up.last}")`);
  await page.keyboard.type("my answer");
  await shot("keyboard-writing");
  await page.evaluate(() => { document.getElementById("box").style.height = "100dvh"; });
  await sleep(200);
  const down = await at();
  check(as, Math.abs(down.edge - before.edge) <= 2, `and going: still there (bottom edge ${before.edge} → ${down.edge})`);
  await clearBox();

  // The stream comes back with its window moved on (a long conversation read
  // again from a later start): nothing drawn again, nothing moves.
  await scrollTo(900);
  await sleep(100);
  await keep();
  let was = await at();
  await page.evaluate((items) => window.__chat.conversation({ reset: true, start: 5000, items: items.slice(2) }), ITEMS);
  await sleep(200);
  let now = await at();
  check(as, now.sameReply && Math.abs(now.top - was.top) <= 2 && now.first === was.first,
    `the stream back from a later start, reading mid-reply: not drawn again, the same words in sight (${was.top} → ${now.top})`);
  check(as, await page.evaluate(() => window.__chat.start === 0 && !!document.querySelector(".chat-conv > .msg.claude")), "what was there before that stays");
  await scrollTo(0);
  await sleep(100);
  await page.evaluate((items) => window.__chat.conversation({ reset: true, start: 9000, items: items.slice(3) }), ITEMS);
  await sleep(200);
  now = await at();
  check(as, now.fromBottom <= 2, `the same at the end: still at the end (${now.fromBottom}px from it)`);

  // Drawn all over again (it reaches back further than what's here): the same message, at the same place.
  await scrollTo(900);
  await sleep(100);
  await keep();
  was = await at();
  await page.evaluate((items) => window.__chat.conversation({ reset: true, start: 0,
    items: [{ kind: "user", text: "Earlier", turn: true, key: "u0:0", at: "" }, ...items] }), ITEMS);
  await sleep(200);
  now = await at();
  check(as, !now.sameReply && Math.abs(now.replyTop - was.replyTop) <= 2 && now.first === was.first,
    `drawn all over again, reading mid-reply: the same words in sight (reply's top ${was.replyTop} → ${now.replyTop}px)`);
  await scrollTo(0);
  await sleep(100);
  await page.evaluate((items) => window.__chat.conversation({ reset: true, start: 0,
    items: [{ kind: "user", text: "Earlier still", turn: true, key: "u00:0", at: "" }, ...items] }), ITEMS);
  await sleep(200);
  now = await at();
  check(as, now.fromBottom <= 2, `drawn all over again at the end: still at the end (${now.fromBottom}px from it)`);
  // Another conversation altogether, read from mid-reply: its reply's top, as a chat you open.
  await scrollTo(900);
  await sleep(100);
  await page.evaluate((items) => window.__chat.conversation({ reset: true, start: 0,
    items: items.map((it) => ({ ...it, key: `new-${it.key}`, ...(it.text ? { text: `Another one. ${it.text}` } : {}) })) }), ITEMS);
  await sleep(300);
  now = await at();
  check(as, now.replyTop >= 0 && now.replyTop <= 24, `another conversation altogether: on its reply's top (${now.replyTop}px)`);

  // A turn ends while you write at the end: you stay on its end.
  const turn = async () => {
    await page.evaluate(() => { const c = window.__chat; c.live = { state: "working" }; c.renderTail(); });
    await sleep(150);
    await page.evaluate(() => { const c = window.__chat; c.live = { state: "idle" }; c.renderTail(); });
    await sleep(250);
    return at();
  };
  await scrollTo(0);
  await sleep(100);
  await box().click();
  await page.keyboard.type("Looks good, now");
  now = await turn();
  check(as, now.fromBottom <= 2, `a turn ending while you write: you stay at the end (${now.fromBottom}px from it, reply's top ${now.replyTop}px)`);
  await shot("turn-ended-writing");
  // While you only watch: on its reply's top, as before.
  await clearBox();
  await scrollTo(0);
  await sleep(100);
  now = await turn();
  check(as, now.replyTop >= 0 && now.replyTop <= 24, `a turn ending while you watch: on its reply's top (${now.replyTop}px)`);
  await shot("turn-ended-watching");

  check(as, !errors.length, `no page errors ${errors.join(" | ")}`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  const home = homes.home("chat-scroll");
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
  try {
    for (const layout of Object.keys(LAYOUTS)) {
      if (ONLY && ONLY !== layout) continue;
      for (const engine of ENGINES) {
        console.log(`${layout} as ${engine}`);
        await run(browser, layout, engine, port).catch((e) => check(`${layout} as ${engine}`, false, `crashed: ${e.stack}`));
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
