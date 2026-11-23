// The page holds still, on the phone and on a computer alike: nothing on it
// moves every frame for long. A CSS animation that never ends draws every
// frame the screen shows (120 a second at 120 Hz): without a GPU (a desktop
// whose driver isn't there yet) that was a core, and the keys you held came
// out after you let go. So what moves for as long as it's on screen (the
// spinners, three dots while an agent types, the dot beating in New, what
// runs in the background, a streak at risk) moves with the spinners' tick, a
// step at a time (app.js, the beat); a card lit unseen breathes a few times
// as it turns so, then holds its glow; Claude's words as they come are drawn
// thirty times a second at most. With screenshots.
//
//   node test/still-view.js          both layouts
//   node test/still-view.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs. Exits 0 when every check passed.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPlaywright, freePort, startServer, findChrome, page, ready, until, sleep, check, failures, CHATS, T, NOW } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "still-view-"));
const ONLY = process.argv[2];

// An agent (bubbles: three dots while it types) beside today-view's chats
// (two lit unseen, one working, one running).
const SCOUT = { id: "scout-scout", repo: "scout", name: "scout", task: "Scout", status: "idle", engine: "chat", path: "/tmp/sc",
                assistant: "agent", assistant_name: "Scout", picture: "", chime: "fairy", today: T({}),
                said: "Two posts worth a reply tonight.", said_at: Math.floor(NOW - 120), unread: 0 };
const ROWS = [...CHATS, SCOUT];
const ITEMS = [
  { kind: "user", text: "Find me two posts to reply to tonight", turn: true, key: "u1:0", at: new Date((NOW - 600) * 1000).toISOString() },
  { kind: "claude", text: "On it.", key: "c1:0", at: new Date((NOW - 590) * 1000).toISOString() },
];
const sse = (events) => `retry: 600000\n\n${events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join("")}`;

// The CSS animations running now that never end (each a frame every frame), by name.
const forever = (p) => p.evaluate(() => document.getAnimations()
  .filter((a) => a.playState === "running" && a.effect && a.effect.getComputedTiming().iterations === Infinity)
  .map((a) => `${a.animationName || "?"}@${a.effect.target && (a.effect.target.className || a.effect.target.tagName)}`));

async function run(browser, port, where) {
  const p = await page(browser, where, port, { chats: ROWS });
  await p.route("**/api/session/scout-scout/stream", (r) => r.fulfill({ status: 200, contentType: "text/event-stream",
    body: sse([["session", SCOUT], ["conversation", { reset: true, start: 0, items: ITEMS }], ["live", { state: "idle", pending: [], queue: [] }]]) }));
  await p.goto("/");
  await ready(p);
  await until(p, () => !!document.querySelector(".tcard.unseen[data-id=proj-fresh]"));

  // ---- the board: lit unseen cards breathe a few times, then hold their glow.
  const lit = await p.evaluate(() => [...document.querySelectorAll(".tcard.unseen")].map((c) => ({ id: c.dataset.id, breathe: c.classList.contains("breathe") })));
  check(where, lit.length >= 2 && lit.every((c) => c.breathe), `lit unseen as the page opens: they breathe (${JSON.stringify(lit)})`);
  check(where, (await forever(p)).some((a) => a.startsWith("tcard-unseen")), "(the breath, a CSS animation while it lasts)");
  // Redrawn meanwhile (the server's list again): not started over, nor made to breathe longer.
  await p.evaluate(() => refresh());
  await p.screenshot({ path: path.join(SHOTS, `${where}-board-breathing.png`) });
  check(where, await until(p, () => !document.querySelector(".tcard.breathe"), null, 12000), "three breaths on, they hold still");
  await sleep(300);
  const still = await forever(p);
  check(where, still.length === 0, `the board: nothing animating every frame for good (${still.join(", ") || "none"})`);
  const glow = await p.evaluate(() => { const c = document.querySelector(".tcard.unseen[data-id=proj-fresh]"); return c ? getComputedStyle(c).boxShadow : ""; });
  check(where, /rgb/.test(glow), `and still lit: its glow, held (${glow.slice(0, 60)})`);
  await p.evaluate(() => refresh());
  await sleep(300);
  check(where, !(await p.evaluate(() => !!document.querySelector(".tcard.breathe"))), "a redraw later doesn't make them breathe again");
  // What moves for good moves with the spinners' tick, a step at a time.
  const steps = async (sel, attr) => {
    const seen = new Set();
    for (let i = 0; i < 14; i++) {
      seen.add(await p.evaluate(([sel, attr]) => { const e = [...document.querySelectorAll(sel)].find((x) => x.offsetParent || x.getClientRects().length); return e ? e.getAttribute(attr) : null; }, [sel, attr]));
      await sleep(90);
    }
    seen.delete(null);
    return seen.size;
  };
  check(where, (await steps(".spin", "data-f")) >= 5, "the spinners turn (a frame a tick)");
  check(where, (await steps(".tpill-beat", "data-b")) >= 3, "New's dot beats with them, a step at a time");
  await p.screenshot({ path: path.join(SHOTS, `${where}-board-still.png`) });

  // Hidden (another tab, the window in the tray): nothing ticks.
  const hiddenTicks = await p.evaluate(async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    const a = spin.ticks;
    await new Promise((r) => setTimeout(r, 500));
    const b = spin.ticks;
    delete document.visibilityState;
    return b - a;
  });
  check(where, hiddenTicks === 0, `hidden, the tick draws nothing (${hiddenTicks} ticks)`);

  // ---- an agent's chat while it types: three dots, a step at a time.
  await p.evaluate(() => todayOpen(row("scout-scout")));
  check(where, await until(p, () => !!document.querySelector(".chat.bubbles .msg.claude .stamp")), "an agent's chat: bubbles");
  await p.evaluate(() => {
    const ch = chatsOpen.get("scout-scout");
    ch.live = { state: "working", pending: [], queue: [], working_since: Date.now() / 1000 };
    ch.row = { ...ch.row, status: "working" };
    ch.renderTail();
  });
  check(where, await until(p, () => { const t = [...document.querySelectorAll(".chat.bubbles .msg.claude.typing")].find((x) => x.offsetParent); return !!t && t.querySelectorAll(".dots i").length === 3; }),
        "working: three dots");
  check(where, (await steps(".chat.bubbles .typing .dots", "data-b")) >= 4, "they go up one at a time, with the tick");
  const up = await p.evaluate(async () => {
    const tops = new Set();
    for (let i = 0; i < 12; i++) {
      const d = [...document.querySelectorAll(".chat.bubbles .typing .dots")].find((x) => x.offsetParent);
      tops.add([...d.children].findIndex((i) => getComputedStyle(i).opacity === "1"));
      await new Promise((r) => setTimeout(r, 180));
    }
    return [...tops].sort();
  });
  check(where, up.includes(0) && up.includes(1) && up.includes(2), `each dot has its turn up (${up.join(",")})`);
  const typing = await forever(p);
  check(where, typing.length === 0, `typing: nothing animating every frame (${typing.join(", ") || "none"})`);
  await p.screenshot({ path: path.join(SHOTS, `${where}-typing.png`) });

  // ---- its words as they come: drawn thirty times a second at most, however fast the screen.
  const rate = await p.evaluate(async () => {
    const ch = chatsOpen.get("scout-scout");
    const draws = [];
    const draw = ch.drawStream;
    ch.drawStream = function (...a) { draws.push(performance.now()); return draw.apply(this, a); };
    ch.live = { ...ch.live, partial: "Found three posts worth a reply. ".repeat(60) };
    ch.renderTail();
    await new Promise((r) => setTimeout(r, 1500));
    ch.drawStream = draw;
    const gaps = draws.slice(1).map((t, i) => t - draws[i]);
    return { n: draws.length, min: gaps.length ? Math.min(...gaps) : null, done: ch.stream && ch.stream.shown === ch.stream.text.length };
  });
  check(where, rate.n >= 3 && rate.min >= 28 && rate.done, `its words: drawn a step every 33 ms, not every frame, and all of them (${JSON.stringify(rate)})`);
  await p.screenshot({ path: path.join(SHOTS, `${where}-writing.png`) });
  await p.evaluate(() => { const ch = chatsOpen.get("scout-scout"); ch.live = { state: "idle", pending: [], queue: [], partial: "" }; ch.endStream(); ch.renderTail(); });

  check(where, p.errors.length === 0, `no page errors (${p.errors.join(" | ").slice(0, 300)})`);
  await p.context().close();
}

if (require.main === module) (async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "still-view-home-"));
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of ["phone", "wide"]) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      await run(browser, port, layout).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
