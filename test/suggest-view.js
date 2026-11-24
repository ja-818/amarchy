// Your answer, suggested (Settings → Suggestions), in a browser: once
// Claude has replied, what you'd likely answer shows in gray in the chat's
// empty box, laid exactly over it. Tab takes it, → a word of it, a tap takes
// it (a phone has no Tab); typing what it says eats it, anything else drops
// it; Enter sends only what you wrote; Esc never touches it (Esc is
// Claude's). Nothing is asked while you write. A reply that comes while
// you're elsewhere has its answer asked for then, there at once in the box;
// one you answered isn't asked again. Off, nothing is asked. What became of
// each is told to the server. On a phone and on a wide screen, with
// screenshots.
//
//   node test/suggest-view.js          both layouts
//   node test/suggest-view.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs (Chromium, playwright-core). It starts
// its own app server from this checkout's bin/amarchy, with a home and state
// of its own; the suggestions are the test's own (no model). Exits 0 when
// every check passed.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPlaywright, freePort, startServer, findChrome, sleep, check, failures } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "suggest-view-"));
const ONLY = process.argv[2];
const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};

const ITEMS = [
  { kind: "user", text: "Make the board's cards clickable", turn: true, key: "u1:0", at: "" },
  { kind: "claude", text: "Done: the whole card opens its chat now, on the phone and wide.\n\nShip it?", key: "c1:0", at: "" },
];

// What the test's "model" answers, for an empty box.
let SAYS = "Yes, ship it";

async function run(browser, layout, port) {
  SAYS = "Yes, ship it";        // (a run changes it: each starts from the same)
  const ctx = await browser.newContext({ ...LAYOUTS[layout], extraHTTPHeaders: { "Tailscale-User-Login": "tester@test" } });
  await ctx.addInitScript(() => { localStorage.setItem("tour", "1"); localStorage.setItem("suggest", "on"); });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const asked = [], outcomes = [], sent = [];
  let warmed = 0;
  let n = 0, slow = 0;
  await page.route("**/api/session/fake-suggest/**", async (route) => {
    const url = route.request().url(), body = JSON.parse(route.request().postData() || "{}");
    if (url.endsWith("/suggest") && body.warm) {
      warmed += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (url.endsWith("/suggest") && body.outcome) {
      outcomes.push(body);
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (url.endsWith("/suggest")) {
      asked.push(body.text);
      if (slow) await sleep(slow);
      const text = body.text ? "" : SAYS;
      n += 1;
      return route.fulfill({ status: 200, contentType: "application/json",
                             body: JSON.stringify({ text, id: `a${String(n).padStart(11, "0")}`, via: "claude", ms: 5 }) });
    }
    if (url.endsWith("/send")) sent.push(body.text);
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector("#look", { state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${layout}-${name}.png`) });

  await page.evaluate((items) => {
    document.body.innerHTML = "";
    const box = document.createElement("div");
    box.id = "box";
    box.style.cssText = "height:100vh;height:100dvh;display:flex;flex-direction:column;background:var(--surface)";
    document.body.append(box);
    window.__chat = new Chat({ id: "fake-suggest",
      row: { id: "fake-suggest", engine: "chat", status: "idle", sleeping: false, awake: true, repo: "amarchy", name: "n", path: "/tmp" },
      onSession() {}, onScreen() {}, onGone() {} });
    window.__chat.live = { state: "idle" };
    box.append(window.__chat.el);
    window.__chat.conversation({ reset: true, start: 0, items });
  }, ITEMS);
  await sleep(300);
  const box = () => page.locator(".chat-dock textarea");
  const ghost = () => page.evaluate(() => {
    const g = document.querySelector(".ui-ghost");
    return g && !g.hidden ? g.querySelector(".ui-ghost-text").textContent : "";
  });
  const value = () => page.evaluate(() => window.__chat.input.value);
  const clear = async () => { await box().fill(""); await page.evaluate(() => document.activeElement && document.activeElement.blur()); await sleep(50); };

  const lastAsk = () => asked.at(-1);
  const newReply = (key, text) => page.evaluate(({ key, text }) => {
    const c = window.__chat;
    c.live = { state: "working" }; c.renderTail(); c.suggestAgain();
    c.conversation({ reset: false, start: 0, items: [...c.items, { kind: "user", text: "Go on", turn: true, key: `u${key}:0`, at: "" },
      { kind: "claude", text, key: `c${key}:0`, at: "" }] });
    c.live = { state: "idle" }; c.renderTail(); c.suggestAgain();
  }, { key, text });

  // The empty box, Claude's reply there: your answer in gray as you get to it,
  // laid exactly where you'd write.
  await box().click();
  await sleep(250);
  check(layout, (await ghost()) === "Yes, ship it", `the empty box suggests your answer to the reply ("${await ghost()}")`);
  check(layout, lastAsk() === "", "asked with nothing written");
  check(layout, warmed === 1, `the box's focus has Haiku made ready first (${warmed} asked)`);
  const lined = await page.evaluate(() => {
    const t = window.__chat.input, g = document.querySelector(".ui-ghost");
    const range = document.createRange();
    range.selectNodeContents(g.querySelector(".ui-ghost-text"));
    const first = range.getClientRects()[0], tr = t.getBoundingClientRect(), cs = getComputedStyle(t);
    return { dx: Math.abs(first.left - (tr.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth))),
             dy: Math.abs(first.top - (tr.top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth))),
             placeholder: getComputedStyle(t, "::placeholder").color };
  });
  check(layout, lined.dx <= 2 && lined.dy <= 4, `the gray text starts where you'd write (off by ${lined.dx.toFixed(1)}, ${lined.dy.toFixed(1)} px)`);
  check(layout, lined.placeholder === "rgba(0, 0, 0, 0)", `the box's placeholder is hidden under it (${lined.placeholder})`);
  await shot("empty-box");

  // Esc: Claude's, never the suggestion's.
  await page.keyboard.press("Escape");
  await sleep(50);
  check(layout, (await ghost()) === "Yes, ship it", "Esc leaves it be (Esc only stops Claude)");

  // Typing what it says: it shrinks as you go, nothing asked again.
  const before = asked.length;
  await page.keyboard.type("Yes, ", { delay: 20 });
  await sleep(300);
  check(layout, (await ghost()) === "ship it", `typing what it says eats it ("${await ghost()}")`);
  check(layout, asked.length === before, `and asks nothing again (${asked.length - before} asked)`);
  // → takes a word.
  await page.keyboard.press("ArrowRight");
  await sleep(60);
  check(layout, (await value()) === "Yes, ship", `→ takes a word ("${await value()}")`);
  // Tab: the rest taken; nothing asked after it (nothing while you write).
  await page.keyboard.press("Tab");
  await sleep(300);
  check(layout, (await value()) === "Yes, ship it", `Tab takes the rest ("${await value()}")`);
  check(layout, await page.evaluate(() => document.activeElement === window.__chat.input), "and the box keeps the focus");
  check(layout, (await ghost()) === "" && asked.length === before, `and nothing more is suggested (${asked.length - before} asked)`);
  check(layout, outcomes.some((o) => o.outcome === "word" && o.took === "Yes, ship it".length && typeof o.waited === "number"),
    `the server is told it was taken, and how long you waited for it (${JSON.stringify(outcomes.at(-1))})`);
  await clear();

  // Writing your own: nothing asked, at a pause or at the end of a word.
  await box().click();
  await sleep(250);
  const mine = asked.length;
  await page.keyboard.type("Run the view tests ", { delay: 10 });
  await sleep(150);
  check(layout, (await ghost()) === "", "typing something else drops it");
  await page.keyboard.type("in both layouts and", { delay: 10 });
  await sleep(500);
  check(layout, asked.length === mine && (await ghost()) === "", `writing your own asks nothing (${asked.length - mine} asked)`);
  // Back to an empty box: there again, from what it said before (nothing asked).
  await box().fill("");
  await page.evaluate(() => window.__chat.typed());
  await sleep(150);
  check(layout, (await ghost()) === "Yes, ship it" && asked.length === mine, `emptied again: there again, nothing asked (${asked.length - mine})`);
  // The cursor can't leave an empty box's end; a selection of nothing: still there.
  await shot("again");

  // Enter sends what you wrote, not the gray text.
  if (layout === "wide") {
    await page.keyboard.type("Ye");
    await page.keyboard.press("Enter");
    await sleep(200);
    check(layout, sent.at(-1) === "Ye", `Enter sends only what you wrote ("${sent.at(-1)}")`);
    check(layout, (await ghost()) === "", "and the gray text goes with it");
    // The reply you just answered isn't answered again.
    await sleep(300);
    check(layout, (await ghost()) === "", "the box emptied by sending: no answer to the reply you just answered");
  }
  await clear();

  // A tap on it takes it (the phone's way; a click on a computer).
  await newReply(5, "Done. Fix the phone layout too?");
  SAYS = "Yes, fix the phone layout too";
  await box().click();
  await sleep(250);
  if (layout === "phone") await page.locator(".ui-ghost-text").tap(); else await page.locator(".ui-ghost-text").click();
  await sleep(100);
  check(layout, (await value()) === "Yes, fix the phone layout too", `a tap on it takes it ("${await value()}")`);
  check(layout, await page.evaluate(() => document.activeElement === window.__chat.input), "the box keeps the focus (the keyboard stays up)");
  await shot("tapped");
  await clear();

  // A long one, wrapping onto another line: the box grows for it, and back.
  await newReply(6, "Shipped. Anything else?");
  SAYS = "Yes: check the board on the phone and the wide layout, then close this chat and the one before it";
  const h0 = await page.evaluate(() => window.__chat.input.offsetHeight);       // (before: it's there at once)
  await box().click();
  await sleep(250);
  const fit = await page.evaluate(() => {
    const t = window.__chat.input, g = document.querySelector(".ui-ghost");
    return { box: t.offsetHeight, ghost: g.scrollHeight, shown: !g.hidden };
  });
  check(layout, fit.shown && fit.ghost <= fit.box + 1 && fit.box > h0,
    `a long one fits: the box ${h0} → ${fit.box}px for ${fit.ghost}px of it`);
  await shot("long");
  await page.evaluate(() => document.activeElement.blur());
  await sleep(80);
  const h1 = await page.evaluate(() => window.__chat.input.offsetHeight);
  check(layout, h1 === h0, `leaving the box: gone, and the box back to its height (${h1}px, was ${h0})`);
  await clear();

  // Claude's reply comes while you're elsewhere: its answer asked for then,
  // and there at once when you get to the box.
  const before2 = asked.length;
  SAYS = "Yes, and the phone too";
  await newReply(9, "Shipped. Check it on the phone too?");
  await sleep(250);
  check(layout, asked.length === before2 + 1 && lastAsk() === "", "a new reply: its answer asked for, the box not even in focus");
  await box().click();
  await sleep(40);
  check(layout, (await ghost()) === "Yes, and the phone too", `and there at once in the box ("${await ghost()}")`);
  await clear();

  // While Claude works: nothing.
  await page.evaluate(() => { const c = window.__chat; c.live = { state: "working" }; c.renderTail(); });
  const w = asked.length;
  await box().click();
  await sleep(250);
  check(layout, (await ghost()) === "" && asked.length === w, "while Claude works: nothing suggested");
  await page.evaluate(() => { const c = window.__chat; c.live = { state: "idle" }; c.renderTail(); });
  await clear();

  // A command (/...): nothing suggested.
  await box().click();
  await page.keyboard.type("/mod");
  await sleep(300);
  check(layout, !asked.some((t) => t.startsWith("/")), "a / command asks nothing");
  await clear();

  // Off: nothing asked, nothing shown.
  await page.evaluate(() => localStorage.setItem("suggest", ""));
  await newReply(10, "Done. Ship it?");
  const m = asked.length;
  await box().click();
  await sleep(300);
  check(layout, asked.length === m && (await ghost()) === "", "turned off: nothing asked, nothing shown");
  // Tab, then, is the browser's again.
  await page.keyboard.press("Tab");
  check(layout, await page.evaluate(() => document.activeElement !== window.__chat.input), "and Tab moves on, as before");

  check(layout, !errors.length, `no page errors ${errors.join(" | ")}`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "suggest-view-home-"));
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
  try {
    for (const layout of Object.keys(LAYOUTS)) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      await run(browser, layout, port).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
