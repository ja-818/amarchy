// The project filter beside your streak, in a browser: on Chats and on
// Tasks, left of the score and on its row, in the width. A tap opens your
// projects (All projects first and checked, then each in your order with
// its chats and how many need you; on Tasks, its boards and what's yours).
// One picked: Chats shows only its chats (your assistant too only in its
// own), Tasks only the boards its agents lead (your commitments with your
// assistant's project), and every count (the tabs', Needs you's, Tasks'
// line) is what it shows; the app's title still counts every project's.
// It stays picked on both tabs and after a reload; a project with nothing
// there says so, Show all projects a tap away; a new chat starts in it; the
// Amarchy menu picks it too. On the phone and wide, the same; with
// screenshots.
//
//   node test/project-filter-view.js          both layouts
//   node test/project-filter-view.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs (Chromium, playwright-core:
// PLAYWRIGHT_CORE=<its folder>). Exits 0 when every check passed.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const tv = require("./today-view.js");
const { check, failures, until, sleep, ready, CHATS, T } = tv;

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "project-filter-view-"));
const ONLY = process.argv[2];

// An agent in proj (its board of posts, one for you), and your assistant's
// own board (in me): one board each.
const AGENT = { id: "proj-poster", repo: "proj", name: "poster", task: "Poster", status: "idle", engine: "chat", path: "/tmp/pp",
                assistant: "agent", assistant_name: "Poster", today: T({}) };
// A project with a long name: the filter's button cuts it short, on its row.
const LONG = { id: "houston-os-crm", repo: "houston-os-platform", name: "crm", task: "CRM: the import", status: "idle", engine: "chat", path: "/tmp/h", today: T({ goal: "Import the leads" }) };
const CHATS_HERE = [...CHATS, AGENT, LONG];
const BOARDS = [
  { id: "posts", title: "Posts", lead: "proj-poster", lead_name: "Poster", role: "agent", task: false, rev: 1,
    columns: [{ name: "For review", yours: true, count: 1 }, { name: "Posted", done: true, count: 0 }], yours: 1,
    cards: [{ id: "c1", title: "Review: the launch post", column: "For review", thread: [], buttons: [] }] },
  { id: "me-jaken", title: "Jaken", lead: "me-jaken", lead_name: "Jaken", role: "main", task: true, rev: 1,
    columns: [{ name: "To do", yours: true, count: 1 }, { name: "Done", done: true, count: 0 }], yours: 1,
    cards: [{ id: "c2", title: "Renew the domain", column: "To do", thread: [], buttons: [] }] },
];

async function open(browser, layout, port) {
  const p = await tv.page(browser, layout, port, { chats: CHATS_HERE });
  // The boards, on whatever the host says of Today (after today-view's own).
  await p.addInitScript((boards) => {
    const parse = JSON.parse;
    JSON.parse = function (text, ...rest) {
      const v = parse.call(this, text, ...rest);
      if (v && typeof v === "object" && Array.isArray(v.sessions) && "share" in v && v.today) {
        v.today.boards = boards;
        v.projects = [{ name: "proj", sessions: 9 }, { name: "me", sessions: 1 }, { name: "other", sessions: 1 }];
      }
      return v;
    };
  }, BOARDS);
  await p.route("**/api/boards/*", (r) => {
    const id = decodeURIComponent(r.request().url().split("/").pop().split("?")[0]);
    const b = BOARDS.find((x) => x.id === id);
    r.fulfill(b ? { json: b } : { status: 404, json: { error: "no such board" } });
  });
  await p.goto("/");
  await ready(p);
  return p;
}

const tab = (p, which) => p.evaluate((which) => { if (board.tab !== which) boardTab(which); }, which);
const ids = (p) => p.evaluate(() => [...board.box.querySelectorAll(".tcard[data-id]")].map((c) => c.dataset.id).sort());
const boardsShown = (p) => p.evaluate(() => [...board.box.querySelectorAll(".tsec[data-board]")].map((s) => s.dataset.board).sort());
const pickText = (p) => p.evaluate(() => { const b = document.querySelector(".today-summary .ui-filter-pick"); return b ? b.innerText.trim() : ""; });
const tabCounts = (p) => p.evaluate(() => [...document.querySelectorAll(".board-switch .control")].map((c) => (c.querySelector(".tab-count") || {}).textContent || "0"));

// The filter's row: it and the score on one line, it left of the score, in the width.
async function row(p, where, what) {
  const box = await p.evaluate(() => {
    const r = document.querySelector(".today-summary"), f = r && r.querySelector(".ui-filter-pick"), s = r && r.querySelector(".ui-score");
    if (!f || !s) return { missing: true };
    const a = f.getBoundingClientRect(), b = s.getBoundingClientRect(), first = r.firstElementChild.getBoundingClientRect();
    return { row: Math.abs((a.top + a.bottom) - (b.top + b.bottom)) < 4, left: a.right <= b.left, after: first.right <= a.left + 1,
             inside: b.right <= r.getBoundingClientRect().right + 1, over: document.documentElement.scrollWidth <= innerWidth };
  });
  check(where, box.row && box.left && box.after && box.inside && box.over, `${what}: the filter left of the streak, on its row, in the width (${JSON.stringify(box)})`);
}

async function pick(p, label) {
  await p.click(".today-summary .ui-filter-pick");
  await until(p, () => !!document.querySelector(".ui-dropdown"));
  const ok = await p.evaluate((label) => {
    const r = [...document.querySelectorAll(".ui-dropdown .ui-drop-row")].find((x) => x.querySelector("b").textContent === label);
    if (r) r.click();
    return !!r;
  }, label);
  await sleep(150);
  return ok;
}

async function run(browser, port, layout) {
  const where = layout;
  const p = await open(browser, layout, port);
  await p.evaluate(() => localStorage.removeItem("board-project"));
  await tab(p, "chats");
  await until(p, () => !!document.querySelector(".today-summary .ui-filter-pick"));
  await row(p, where, "Chats");
  check(where, (await pickText(p)) === (layout === "phone" ? "All" : "All projects"), `it says ${layout === "phone" ? "All (a phone's room)" : "All projects"} (${await pickText(p)})`);
  const allIds = await ids(p);
  const allCounts = await tabCounts(p);

  // Its dropdown: All projects checked, then your projects in your order, each with what it holds.
  await p.click(".today-summary .ui-filter-pick");
  check(where, await until(p, () => !!document.querySelector(".ui-dropdown")), "a tap: the projects under it");
  const rows = await p.evaluate(() => [...document.querySelectorAll(".ui-dropdown .ui-drop-row")].map((r) => ({
    label: r.querySelector("b").textContent, detail: (r.querySelector("small") || {}).textContent || "", on: r.classList.contains("on"), checked: r.getAttribute("aria-checked") })));
  check(where, rows.map((r) => r.label).join(",") === "All projects,Proj,Me,Other,Houston Os Platform", `All first, then your order, then the rest (${rows.map((r) => r.label).join(", ")})`);
  check(where, /^12 chats · \d need/.test(rows[0].detail), `All projects: every chat (${rows[0].detail})`);
  check(where, rows[0].on && rows[0].checked === "true" && rows.slice(1).every((r) => !r.on && r.checked === "false"), "All projects checked");
  check(where, /^9 chats · \d need/.test(rows[1].detail) && /^1 chat$/.test(rows[2].detail), `each with its chats and what needs you (${rows.map((r) => r.detail).join(" | ")})`);
  check(where, await p.evaluate(() => document.querySelector(".today-summary .ui-filter-pick").getAttribute("aria-expanded") === "true"), "its button says it's open");
  await sleep(250);
  await p.screenshot({ path: path.join(SHOTS, `${where}-projects.png`) });
  await p.click(".today-summary .ui-filter-pick");
  check(where, await until(p, () => !document.querySelector(".ui-dropdown")), "a tap again: closed");

  // Proj: only its chats (your assistant, in me, not), lit, counts its own.
  check(where, await pick(p, "Proj"), "Proj picked");
  check(where, await until(p, () => document.querySelector(".today-summary .ui-filter-pick.on") && document.querySelector(".today-summary .ui-filter-pick").innerText.trim() === "Proj"), "the button: Proj, lit");
  const projIds = await ids(p);
  check(where, projIds.length && projIds.every((id) => id.startsWith("proj-")), `only Proj's chats (${projIds.join(", ")})`);
  check(where, !projIds.includes("me-jaken") && !projIds.includes("proj-done2"), "not your assistant (Me), not Other's");
  check(where, allIds.includes("proj-done2") && allIds.includes("me-jaken"), "(they were there before)");
  await row(p, where, "Chats, Proj picked");
  const counts = await tabCounts(p);
  const needProj = await p.evaluate(() => todayCount(app.view, "chats", true)), needAll = await p.evaluate(() => todayCount(app.view, "chats"));
  check(where, Number(counts[0]) === needProj && Number(await p.evaluate(() => (document.querySelector(".today-summary .ui-filter .tab-count") || {}).textContent || 0)) === needProj,
        `Chats' tab and Needs you count Proj's (${counts[0]}, ${needProj})`);
  check(where, await p.evaluate(() => { const n = todayCount(app.view, "chats"); return !n || document.title.startsWith(`(${n})`) || document.title.startsWith("("); }), "the app's title still counts every project's");
  check(where, needAll >= needProj, `(every project's: ${needAll})`);
  await p.screenshot({ path: path.join(SHOTS, `${where}-chats-proj.png`), fullPage: true });

  // Needs you on top of it: only Proj's that need you.
  await p.click(".today-summary .ui-filter");
  await until(p, () => todayUI.needsOnly);
  const needIds = await ids(p);
  check(where, needIds.every((id) => id.startsWith("proj-")), `Needs you and Proj: only Proj's (${needIds.join(", ")})`);
  await p.click(".today-summary .ui-filter");
  await until(p, () => !todayUI.needsOnly);

  // Tasks: Proj's boards only (Poster's), its count and its line Proj's.
  await tab(p, "tasks");
  check(where, await until(p, () => !!document.querySelector(".tsec[data-board]")), "Tasks: its boards");
  check(where, (await pickText(p)) === "Proj", "Tasks: still Proj");
  await row(p, where, "Tasks");
  const shown = await boardsShown(p);
  check(where, JSON.stringify(shown) === JSON.stringify(["posts"]), `Tasks: Proj's board alone, no commitments, not Jaken's (${shown.join(", ")})`);
  const tc = await tabCounts(p);
  check(where, tc[1] === "1" && /^1 task for now/.test(await p.evaluate(() => document.querySelector(".today-summary-text").textContent)), `Tasks counts Proj's (${tc[1]})`);
  check(where, Number(allCounts[1]) > 1, `(every project's was ${allCounts[1]})`);
  await p.click(".today-summary .ui-filter-pick");
  await until(p, () => !!document.querySelector(".ui-dropdown"));
  const trows = await p.evaluate(() => [...document.querySelectorAll(".ui-dropdown .ui-drop-row")].map((r) => [r.querySelector("b").textContent, (r.querySelector("small") || {}).textContent || ""]));
  check(where, /^3 boards · \d+ for you$/.test(trows[0][1]) && trows[1][1] === "1 board · 1 for you" && /^2 boards · \d+ for you$/.test(trows[2][1]) && trows[3][1] === "No boards",
        `on Tasks, each with its boards (${trows.map((r) => r.join(": ")).join(" | ")})`);
  check(where, await p.evaluate(() => document.querySelector(".ui-dropdown .ui-drop-row.on b").textContent === "Proj"), "Proj checked");
  await sleep(250);
  await p.screenshot({ path: path.join(SHOTS, `${where}-tasks-projects.png`) });
  await p.keyboard.press("Escape");
  await until(p, () => !document.querySelector(".ui-dropdown"));
  await p.screenshot({ path: path.join(SHOTS, `${where}-tasks-proj.png`), fullPage: true });

  // Me: your commitments and your assistant's board.
  check(where, await pick(p, "Me"), "Me picked");
  await until(p, () => !!document.querySelector(".tsec[data-board=commitments]"));
  const meBoards = await boardsShown(p);
  check(where, JSON.stringify(meBoards) === JSON.stringify(["commitments", "me-jaken"]), `Me: your commitments and Jaken's board (${meBoards.join(", ")})`);

  // Other: no boards there, said, and every project's a tap away.
  check(where, await pick(p, "Other"), "Other picked");
  check(where, await until(p, () => /No boards in Other/.test((document.querySelector(".today-project-none") || {}).textContent || "")), "Other on Tasks: No boards in Other");
  await p.screenshot({ path: path.join(SHOTS, `${where}-tasks-none.png`), fullPage: true });
  await tab(p, "chats");
  check(where, JSON.stringify(await until(p, () => [...board.box.querySelectorAll(".tcard[data-id]")].length === 1) && await ids(p)) === JSON.stringify(["proj-done2"]), "Other on Chats: its one chat");

  // A long name: cut short, the button and the streak still on one row, in the width.
  check(where, await pick(p, "Houston Os Platform"), "Houston Os Platform picked");
  await until(p, () => todayProject() === "houston-os-platform");
  await row(p, where, "Chats, a long name");
  check(where, await p.evaluate(() => { const l = document.querySelector(".ui-filter-pick-label"); return l.scrollWidth > l.clientWidth || innerWidth > 600; }), "cut short with … where there's no room");
  await tab(p, "tasks");
  await row(p, where, "Tasks, a long name");
  await p.screenshot({ path: path.join(SHOTS, `${where}-tasks-long.png`) });
  await tab(p, "chats");
  await p.screenshot({ path: path.join(SHOTS, `${where}-chats-long.png`) });
  check(where, await pick(p, "Other"), "Other again");
  await until(p, () => todayProject() === "other");

  // Kept: reloaded, still Other.
  await p.reload();
  await ready(p);
  check(where, await until(p, () => !!document.querySelector(".today-summary .ui-filter-pick.on")) && (await pickText(p)) === "Other", "reloaded: still Other");
  check(where, JSON.stringify(await ids(p)) === JSON.stringify(["proj-done2"]), "and only its chat");

  // A project with no chat left: said, Show all projects.
  await p.evaluate(() => { app.view = { ...app.view, sessions: app.view.sessions.filter((s) => s.repo !== "other") }; refresh(); });
  check(where, await until(p, () => /No chats in Other now/.test((document.querySelector(".today-project-none") || {}).textContent || "")), "no chat left in Other: said so");
  check(where, (await pickText(p)) === "Other", "the filter still says Other");
  await p.screenshot({ path: path.join(SHOTS, `${where}-chats-none.png`), fullPage: true });
  await p.evaluate(() => { [...document.querySelectorAll(".today-project-none .tbtn")].find((b) => /Show all projects/.test(b.textContent)).click(); });
  check(where, await until(p, () => !todayProject() && !document.querySelector(".today-summary .ui-filter-pick.on")), "Show all projects: every project's again");
  check(where, await p.evaluate(() => !localStorage.getItem("board-project")), "and forgotten on this device");
  await p.evaluate(() => { app.view = null; }).catch(() => {});
  await p.reload();
  await ready(p);
  await until(p, () => !!document.querySelector(".tasks-board .tcard"));
  check(where, JSON.stringify(await ids(p)) === JSON.stringify(allIds), "all the chats again");

  // A new chat starts in the project picked.
  check(where, await pick(p, "Me"), "Me picked again");
  await p.evaluate(() => boardNew());
  const lit = await p.evaluate(async () => {
    for (let i = 0; i < 20 && !document.querySelector(".picker-row.on, .menu-item.on"); i++) await new Promise((r) => setTimeout(r, 50));
    const on = document.querySelector(".picker-row.on, .menu-item.on");
    return on ? on.innerText.trim() : "";
  });
  check(where, /^Me(?![a-z])/.test(lit), `New chat: Me lit (${lit})`);
  await p.keyboard.press("Escape");
  await p.evaluate(() => closeSheets());
  await until(p, () => !document.querySelector(".picker, .sheet-back"));

  // The Amarchy menu: the same projects.
  await p.evaluate(() => deskMenu());
  await until(p, () => !!document.querySelector(".picker, .sheet"));
  const item = await p.evaluate(() => [...document.querySelectorAll(".picker-row, .menu-item")].map((r) => r.innerText.trim()).find((t) => /^Only (Me|one project)/.test(t)) || "");
  check(where, /^Only Me/.test(item), `the menu: Only Me (${item.split("\n")[0]})`);
  await p.evaluate(() => closeSheets());
  await p.keyboard.press("Escape");
  await until(p, () => !document.querySelector(".picker, .sheet-back"));
  await p.evaluate(() => todaySetProject(""));

  check(where, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

(async () => {
  const pw = tv.loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "project-filter-home-"));
  const port = await tv.freePort();
  const server = await tv.startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: tv.findChrome() });
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
