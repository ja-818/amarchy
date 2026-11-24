// Suggestions as you type (Settings → Suggestions), in a browser: the gray
// text after what you write in a chat's box. It shows once you pause, laid
// exactly over the box's words; Tab takes it all and the next one shows at
// once (fetched while the first showed: Tab, Tab, Tab); → takes a word;
// typing what it says eats it without asking again; typing something else
// drops it; Enter sends only what you wrote; Esc never touches it (Esc is
// Claude's); a tap on it takes it (a phone has no Tab); with nothing written
// it suggests an answer to Claude's reply; off, nothing is asked. What
// became of each is told to the server. On a phone and on a wide screen,
// with screenshots.
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

// What the test's "model" says after each text (else nothing).
const SAYS = {
  "": "Yes, ship it",
  "Run the view tests in both layouts and": " then ship it",
  "Run the view tests in both layouts and then ship it": ", and tell me when it's live",
  "Fix the scroll ju": "mp when a turn ends while I write",
  "A long one, to wrap past the end of the box on a phone: the composer is narrow there, so this": " suggestion goes on well past its first line and into a second one",
};

async function run(browser, layout, port) {
  const ctx = await browser.newContext({ ...LAYOUTS[layout], extraHTTPHeaders: { "Tailscale-User-Login": "tester@test" } });
  await ctx.addInitScript(() => { localStorage.setItem("tour", "1"); localStorage.setItem("suggest", "on"); });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const asked = [], outcomes = [], sent = [];
  let n = 0, slow = 0;
  await page.route("**/api/session/fake-suggest/**", async (route) => {
    const url = route.request().url(), body = JSON.parse(route.request().postData() || "{}");
    if (url.endsWith("/suggest") && body.outcome) {
      outcomes.push(body);
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (url.endsWith("/suggest")) {
      asked.push(body.text);
      if (slow) await sleep(slow);
      const text = SAYS[body.text] || "";
      n += 1;
      return route.fulfill({ status: 200, contentType: "application/json",
                             body: JSON.stringify({ text, id: `a${String(n).padStart(11, "0")}`, via: "api", ms: 5 }) });
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

  // With nothing written: an answer to Claude's reply, as the box gets the focus.
  await box().click();
  await sleep(250);
  check(layout, (await ghost()) === "Yes, ship it", `an empty box suggests an answer to the reply ("${await ghost()}")`);
  check(layout, asked[0] === "", "asked with nothing written");
  await shot("empty-box");
  await clear();

  // Typing, then a pause: gray text after the words, laid exactly over the box.
  await box().click();
  await page.keyboard.type("Run the view tests in both layouts and", { delay: 5 });
  await sleep(350);
  check(layout, (await ghost()) === " then ship it", `after a pause, the suggestion shows ("${await ghost()}")`);
  const lined = await page.evaluate(() => {
    const t = window.__chat.input, g = document.querySelector(".ui-ghost"), typed = g.querySelector(".ui-ghost-typed");
    const range = document.createRange();
    range.selectNodeContents(typed);
    const r = range.getClientRects(), last = r[r.length - 1];
    // Where the box's own last character is: measured with a mirror the way a caret position is.
    const m = document.createElement("div"), cs = getComputedStyle(t);
    for (const p of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingLeft", "paddingRight", "whiteSpace", "overflowWrap"]) m.style[p] = cs[p];
    m.style.whiteSpace = "pre-wrap";
    m.style.position = "absolute";
    m.style.width = `${t.clientWidth}px`;
    const end = document.createElement("span");
    m.append(document.createTextNode(t.value), end);
    document.body.append(m);
    const tr = t.getBoundingClientRect(), mr = m.getBoundingClientRect(), er = end.getBoundingClientRect();
    const want = { x: tr.left + (er.left - mr.left), y: tr.top + (er.top - mr.top) - t.scrollTop };
    m.remove();
    return { dx: Math.abs(last.right - want.x), dy: Math.abs(last.top - want.y), ghostColor: getComputedStyle(g.querySelector(".ui-ghost-text")).color,
             typedColor: getComputedStyle(typed).color };
  });
  check(layout, lined.dx <= 2 && lined.dy <= 3, `the gray text starts where the box's words end (off by ${lined.dx.toFixed(1)}, ${lined.dy.toFixed(1)} px)`);
  check(layout, lined.typedColor === "rgba(0, 0, 0, 0)", `the copy of the box's words is invisible (${lined.typedColor})`);
  await shot("suggestion");

  // Esc: Claude's, never the suggestion's.
  await page.keyboard.press("Escape");
  await sleep(50);
  check(layout, (await ghost()) === " then ship it", "Esc leaves it be (Esc only stops Claude)");

  // Typing what it says: it shrinks as you go, nothing asked again.
  const before = asked.length;
  await page.keyboard.type(" then", { delay: 20 });
  await sleep(250);
  check(layout, (await ghost()) === " ship it", `typing what it says eats it ("${await ghost()}")`);
  check(layout, asked.length === before, `and asks nothing again (${asked.length - before} asked)`);

  // Tab: the rest taken, and the next one there at once (fetched meanwhile).
  await page.keyboard.press("Tab");
  await sleep(120);
  check(layout, (await value()) === "Run the view tests in both layouts and then ship it", `Tab takes it ("${await value()}")`);
  check(layout, await page.evaluate(() => document.activeElement === window.__chat.input), "and the box keeps the focus");
  check(layout, (await ghost()) === ", and tell me when it's live", `the next one shows right after (Tab, Tab, Tab: "${await ghost()}")`);
  check(layout, outcomes.some((o) => o.outcome === "tab" && o.took === " ship it".length + 0 || o.outcome === "tab"),
    `the server is told it was taken (${JSON.stringify(outcomes.slice(-1))})`);
  // → takes one word (with the punctuation before it).
  await page.keyboard.press("ArrowRight");
  await sleep(60);
  check(layout, (await value()).endsWith("ship it, and"), `→ takes a word ("…${(await value()).slice(-12)}")`);
  check(layout, (await ghost()) === " tell me when it's live", `the rest stays ("${await ghost()}")`);
  // Typing something else: gone.
  await page.keyboard.type(" X");
  await sleep(60);
  check(layout, (await ghost()) === "", "typing something else drops it");
  await sleep(250);
  check(layout, outcomes.some((o) => o.outcome === "word"), `told as taken a word at a time (${JSON.stringify(outcomes.slice(-1))})`);
  // Ctrl+Z takes back what Tab put in (it went in as typed).
  await clear();

  // Mid-word: the rest of the word, then the words after it.
  await box().click();
  await page.keyboard.type("Fix the scroll ju", { delay: 5 });
  await sleep(350);
  check(layout, (await ghost()) === "mp when a turn ends while I write", `mid-word, the rest of it ("${await ghost()}")`);
  // The cursor moved off the end: gone.
  await page.keyboard.press("ArrowLeft");
  await sleep(60);
  check(layout, (await ghost()) === "", "the cursor moved back: dropped");
  await page.keyboard.press("End");
  await sleep(350);
  check(layout, (await ghost()) === "mp when a turn ends while I write", `back at the end: shown again, from what it said before (${asked.filter((t) => t === "Fix the scroll ju").length} asked)`);

  // Enter sends what you wrote, not the gray text.
  if (layout === "wide") {
    await page.keyboard.press("Enter");
    await sleep(200);
    check(layout, sent.at(-1) === "Fix the scroll ju", `Enter sends only what you wrote ("${sent.at(-1)}")`);
    check(layout, (await ghost()) === "", "and the gray text goes with it");
  }
  await clear();

  // A long one, wrapping onto another line: the box grows for it, and back.
  await box().click();
  await box().fill("A long one, to wrap past the end of the box on a phone: the composer is narrow there, so this");
  await page.evaluate(() => window.__chat.typed());
  const h0 = await page.evaluate(() => window.__chat.input.offsetHeight);
  await sleep(350);
  const fit = await page.evaluate(() => {
    const t = window.__chat.input, g = document.querySelector(".ui-ghost");
    return { box: t.offsetHeight, ghost: g.scrollHeight, shown: !g.hidden };
  });
  check(layout, fit.shown && fit.ghost <= fit.box + 1, `a long one fits: the box ${h0} → ${fit.box}px for ${fit.ghost}px of it`);
  await shot("long");
  await page.evaluate(() => document.activeElement.blur());
  await sleep(80);
  const h1 = await page.evaluate(() => window.__chat.input.offsetHeight);
  check(layout, h1 === h0, `leaving the box: gone, and the box back to its height (${h1}px, was ${h0})`);
  await clear();

  // A tap on it takes it (the phone's way; a click on a computer).
  await box().click();
  await page.keyboard.type("Run the view tests in both layouts and", { delay: 5 });
  await sleep(350);
  if (layout === "phone") await page.locator(".ui-ghost-text").tap(); else await page.locator(".ui-ghost-text").click();
  await sleep(100);
  check(layout, (await value()) === "Run the view tests in both layouts and then ship it", `a tap on it takes it ("${await value()}")`);
  check(layout, await page.evaluate(() => document.activeElement === window.__chat.input), "the box keeps the focus (the keyboard stays up)");
  await shot("tapped");
  await clear();

  // A slow answer, typed past as it said meanwhile: what's left of it shows.
  slow = 400;
  await box().click();
  await page.keyboard.type("Fix the scroll ju");
  await page.evaluate(() => { window.__chat.ghost.clear(); });
  await box().fill("");
  await page.evaluate(() => window.__chat.typed());
  // (Its own fresh ask, for text not asked before.)
  SAYS["Make it snappy"] = " on the phone too";
  await page.keyboard.type("Make it snappy", { delay: 5 });
  await sleep(250);
  await page.keyboard.type(" on");
  await sleep(500);
  check(layout, (await ghost()) === " the phone too", `typed on as it said while it came: the rest of it ("${await ghost()}")`);
  slow = 0;
  await clear();

  // A command (/...): nothing suggested.
  await box().click();
  await page.keyboard.type("/mod");
  await sleep(300);
  check(layout, !asked.some((t) => t.startsWith("/")), "a / command asks nothing");
  await clear();

  // Off: nothing asked, nothing shown.
  await page.evaluate(() => localStorage.setItem("suggest", ""));
  const m = asked.length;
  await box().click();
  await page.keyboard.type("Run the view tests in both layouts and", { delay: 5 });
  await sleep(350);
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
