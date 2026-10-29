// The Office, the board's third tab, in a browser: on the phone and on a
// computer, the same rooms (a project each, your assistant's front desk
// first), the same people at the same desks, each posed as its chat stands
// (working, asking, done, asleep...) with the same pill as its card on
// Chats. A click on someone opens their chat; the free desk starts a new
// chat in its room; Tab gets there and j / k go from desk to desk; one
// that gets done cheers; one that leaves frees their desk and nobody else
// moves. With screenshots of both layouts.
//
//   node test/office-view.js          both layouts
//   node test/office-view.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs (Chromium, playwright-core). It starts
// its own app server from this checkout's bin/amarchy, with a home and state
// of its own. Exits 0 when every check passed.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPlaywright, freePort, startServer, findChrome, until, sleep, check, failures } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "office-view-"));
const ONLY = process.argv[2];
const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1440, height: 900 } },
};

const NOW = Date.now() / 1000;
const T = (o) => ({ goal: "", state: "", goal_at: 0, asks: [], at: NOW - 600, ...o });
const C = (id, repo, task, o = {}) => ({ id, repo, name: id.split("-").pop(), task, status: "idle", engine: "chat", path: `/tmp/${id}`, today: T({}), ...o });

const CHATS = [
  C("me-jaken", "me", "Jaken", { assistant: "main", assistant_name: "Jaken" }),
  C("web-work", "web", "Build: the Office", { status: "working", said: "Drawing the desks in pixels", priority: "high" }),
  C("web-ask", "web", "Fellowship: application", { today: T({ goal: "Submit it", state: "waiting", asks: [{ question: "Submit it now?", options: [{ label: "Submit", send: "Submit" }] }] }) }),
  C("web-done", "web", "Docs: the guide", { today: T({ goal: "Write the guide", state: "done" }) }),
  C("web-sleep", "web", "Eval: json-render", { sleeping: true }),
  C("api-perm", "api", "Meta: verification", { status: "waiting", asks: "Claude asks to run gcloud", permission: { request_id: "req-1", tool: "Bash" } }),
  C("api-run", "api", "Check: e2e chain", { status: "running", running: "the e2e chain", background: 1 }),
  C("api-fresh", "api", "Fix: login loop", { unseen: true, said: "Fixed: a stale cookie." }),
  C("api-stale", "api", "Study: T3", { today: T({ goal: "Compare T3", at: NOW - 5 * 86400 }) }),
  C("api-block", "api", "Deploy: prod", { today: T({ goal: "Ship to prod", state: "blocked" }) }),
  C("ops-idle", "ops", "Infra: backups", {}),
];
const POSES = { "me-jaken": "idle", "web-work": "work", "web-ask": "ask", "web-done": "done", "web-sleep": "sleep", "api-perm": "ask", "api-run": "run",
                "api-fresh": "fresh", "api-stale": "stale", "api-block": "blocked", "ops-idle": "idle" };

async function page(browser, layout, port) {
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}` });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.route("**/api/session/*/stream", (r) => r.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" }));
  await p.route("**/api/session/*/composer", (r) => r.fulfill({ json: { engine: "chat", commands: [], models: [], model: "opus", mode: "default" } }));
  await p.addInitScript(({ chats }) => {
    Object.defineProperty(Navigator.prototype, "standalone", { get: () => true });
    const parse = JSON.parse;
    JSON.parse = function (text, ...rest) {
      const v = parse.call(this, text, ...rest);
      if (v && typeof v === "object" && Array.isArray(v.sessions) && "share" in v) {
        v.sessions = (window.__chats || chats).map((c) => ({ ...c }));
        v.projects = [{ name: "web", sessions: 4 }, { name: "api", sessions: 5 }, { name: "ops", sessions: 1 }, { name: "me", sessions: 1 }];
        v.today = { loops: [], source: "", error: "", sent: {}, assistant: { id: "me-jaken", name: "Jaken" } };
      }
      return v;
    };
  }, { chats: CHATS });
  return p;
}

// The chats, as the server would say them now (kept over its next list).
const setChats = (p, chats) => p.evaluate((chats) => { window.__chats = chats; app.view = { ...app.view, sessions: chats.map((c) => ({ ...c })) }; refresh(); }, chats);

// What the office shows, layout aside: its rooms, in order, each its people
// in their seats (id, pose, name, pill), its free desk.
const SHAPE = () => [...document.querySelectorAll(".office-floor .oroom")].map((r) => ({
  room: r.querySelector(".oroom-sign").textContent.replace(/\s+/g, " ").trim(),
  desks: [...r.querySelectorAll(".oroom-floor > .ui-desk")].map((d) => d.matches(".vacant") ? "vacant" : d.matches(".p-empty") ? "free"
    : [d.dataset.id, [...d.classList].find((c) => c.startsWith("p-")), d.querySelector(".ui-desk-name").innerText.trim(), ((d.querySelector(".tpill") || {}).innerText || "").replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/, ""),
       [...d.querySelectorAll(".ui-desk-actions button")].map((b) => b.innerText).join("/")].join("|")),
}));

const shapes = {};

async function run(browser, port, layout) {
  const where = layout;
  const p = await page(browser, layout, port);
  await p.goto("/");
  await until(p, () => window.app && app.view && app.view.sessions && app.view.sessions.length);
  check(where, await until(p, () => !!document.querySelector(".board-switch [data-tab=office]")), "the board's tabs: Chats | Tasks | Office");
  check(where, /^Chats\s*\d*\s*Tasks\s*\d*\s*Office$/.test((await p.evaluate(() => document.querySelector(".board-switch").innerText)).trim()), "Office last, no count of its own (it's your chats)");
  if (layout === "wide") {
    // Tab, Tab: the Office, from Chats.
    await p.evaluate(() => { document.activeElement && document.activeElement.blur(); });
    await p.keyboard.press("Tab");
    await p.keyboard.press("Tab");
  } else {
    await p.evaluate(() => document.querySelector(".board-switch [data-tab=office]").click());
  }
  check(where, await until(p, () => board.tab === "office" && !!document.querySelector(".board-today.office .office-floor .oroom")), layout === "wide" ? "Tab, Tab: the Office" : "a tap on Office: the Office");
  await sleep(300);
  shapes[layout] = await p.evaluate(SHAPE);
  const rooms = shapes[layout].map((r) => r.room);
  check(where, JSON.stringify(rooms) === JSON.stringify(["Front desk1", "Web4", "Api5", "Ops1"]), `a room a project, in your order, your assistant's front desk first (${JSON.stringify(rooms)})`);
  const poses = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".ui-desk[data-id]")].map((d) => [d.dataset.id, [...d.classList].find((c) => c.startsWith("p-")).slice(2)])));
  check(where, Object.entries(POSES).every(([id, pose]) => poses[id] === pose), `each one posed as their chat stands (${JSON.stringify(poses)})`);
  check(where, await p.evaluate(() => [...document.querySelectorAll(".ui-desk[data-id]")].every((d) => d.querySelector("svg.ui-sprite rect"))), "each one drawn: a person at a desk");
  check(where, await p.evaluate(() => {
    const pill = (id) => (document.querySelector(`.ui-desk[data-id="${id}"] .tpill`) || {}).innerText;
    return pill("web-ask") === "Asks you" && pill("api-perm") === "Permission" && pill("web-done") === "Done" && pill("api-block") === "Blocked";
  }), "their pills: the same words as their cards on Chats");
  check(where, await p.evaluate(() => /Submit it now\?/.test(document.querySelector('.ui-desk[data-id="web-ask"] .ui-desk-say.pinned').innerText)
                                   && /gcloud/.test(document.querySelector('.ui-desk[data-id="api-perm"] .ui-desk-say.pinned').innerText)),
        "what one asks you, in a bubble over them, always");
  check(where, await p.evaluate(() => [...document.querySelectorAll('.ui-desk[data-id="api-perm"] .ui-desk-actions button')].map((b) => b.innerText).join() === "Allow,Deny"
                                   && document.querySelector('.ui-desk[data-id="web-done"] .ui-desk-actions button').innerText === "Complete"),
        "a permission's Allow and Deny on its desk; Complete on a done one's");
  check(where, await p.evaluate(() => [...document.querySelectorAll(".oroom")].slice(1).every((r) => r.querySelector(".oroom-floor > .ui-desk.p-empty:last-child"))
                                   && !document.querySelector(".oroom:first-child .p-empty")),
        "a free desk at the end of each project's room");
  check(where, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll(".oroom")].every((r) => r.getBoundingClientRect().right <= innerWidth + 1)),
        "it fits the screen: nothing wider");
  const sizes = await p.evaluate(() => [...document.querySelectorAll(".ui-desk[data-id] .ui-desk-scene")].map((s) => Math.round(s.getBoundingClientRect().width)));
  check(where, sizes.every((w) => w >= 100), `each person big enough to read (${sizes.join(",")})`);
  await p.screenshot({ path: path.join(SHOTS, `${where}-office.png`), fullPage: true });

  // The keys: j / k from desk to desk, the one lit; Enter opens it.
  if (layout === "wide") {
    await p.evaluate(() => boardRefocus());
    await p.keyboard.press("j");
    const lit = await p.evaluate(() => (document.querySelector(".ui-desk.ui-sel") || {}).dataset?.id || "");
    check(where, lit && lit !== "me-jaken", `j: the next desk lit (${lit})`);
    await p.screenshot({ path: path.join(SHOTS, `${where}-office-keys.png`) });
    await p.keyboard.press("Enter");
    check(where, await until(p, () => desk.current === document.querySelector(".ui-desk.ui-sel")?.dataset.id || (desk.current && desk.current !== "")), "Enter: their chat");
    await p.keyboard.press("Escape");
    check(where, await until(p, () => !desk.current && board.tab === "office" && !!document.querySelector(".office-floor")), "Esc: the Office again");
  }

  // A click on someone: their chat; back, the Office.
  await p.evaluate(() => document.querySelector('.ui-desk[data-id="web-work"] .ui-desk-go').click());
  check(where, await until(p, () => (app.desk ? desk.current : app.session && app.session.id) === "web-work"), "a click on someone: their chat");
  await p.evaluate(() => (app.desk ? boardBack() : go("#/")));
  check(where, await until(p, () => board.tab === "office" && !!document.querySelector(".office-floor") && getComputedStyle(document.querySelector(".tasks-board")).display !== "none"), "back: the Office");

  // The free desk: a new chat, in that room's project.
  await p.evaluate(() => document.querySelector('.oroom[data-room="ops"] .ui-desk.p-empty .ui-desk-go').click());
  check(where, await until(p, () => !document.querySelector(".board-new").hidden && /Ops/.test(document.querySelector(".board-new").innerText)), "the free desk: a new chat in its project");
  await p.evaluate(() => document.querySelector(".board-new-close") && document.querySelector(".board-new-close").click());

  // Done now: a cheer, confetti over them.
  const next = CHATS.map((c) => (c.id === "web-work" ? { ...c, status: "idle", today: T({ goal: "Build the Office", state: "done" }) } : c));
  await setChats(p, next);
  check(where, await until(p, () => !!document.querySelector('.ui-desk.cheer[data-id="web-work"] .ui-confetti') && document.querySelector('.ui-desk[data-id="web-work"]').matches(".p-done")),
        "done just now: they cheer, confetti");
  await sleep(500);
  await p.screenshot({ path: path.join(SHOTS, `${where}-office-cheer.png`) });
  check(where, await until(p, () => !document.querySelector(".ui-desk.cheer"), null, 5000), `the cheer ends (${await p.evaluate(() => JSON.stringify([[...office.cheer], Date.now(), board.box.dataset.key.slice(0, 60), board.tab]))})`);

  // One leaves: their desk is free, everyone else where they were; the next to come takes it.
  const seatsOf = () => p.evaluate(() => [...document.querySelectorAll('.oroom[data-room="api"] .oroom-floor > .ui-desk')].map((d) => d.dataset.id || (d.matches(".vacant") ? "_" : "+")));
  const before = await seatsOf();
  await setChats(p, next.filter((c) => c.id !== "api-run"));
  await until(p, () => !document.querySelector('.ui-desk[data-id="api-run"]'));
  const after = await seatsOf();
  check(where, after.length === before.length && before.every((id, i) => (id === "api-run" ? after[i] === "_" : after[i] === id)), `one leaves: a free desk, the rest in their seats (${before} → ${after})`);
  await setChats(p, [...next.filter((c) => c.id !== "api-run"), C("api-new", "api", "New: the cache")]);
  await until(p, () => !!document.querySelector('.ui-desk[data-id="api-new"]'));
  const again = await seatsOf();
  check(where, again[before.indexOf("api-run")] === "api-new", `the next one takes it (${again})`);
  await setChats(p, CHATS);
  // Kept: the Office again after a reload.
  await p.reload();
  check(where, await until(p, () => board.tab === "office" && !!document.querySelector(".office-floor .ui-desk[data-id]")), "reloaded: still the Office");
  check(where, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

module.exports = { page, CHATS };

if (require.main === module) (async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "office-view-home-"));
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of ["phone", "wide"]) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      await run(browser, port, layout).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
    if (shapes.phone && shapes.wide) {
      const same = JSON.stringify(shapes.phone) === JSON.stringify(shapes.wide);
      check("both", same, same ? "the phone's office and the computer's: the same rooms, people, poses, pills and buttons"
                                : `they differ:\n  phone ${JSON.stringify(shapes.phone)}\n  wide  ${JSON.stringify(shapes.wide)}`);
    }
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
