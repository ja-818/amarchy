// A chat's Preview, in a browser, both layouts: on its card and over the open
// chat, one tap opens it; registered and not running, Start preview opens the
// page that starts it and turns into it once it answers (no message to
// Claude); failed, Preview failed opens its sheet (what it wrote, Try again,
// Ask Claude to fix it); an address only, nothing answering, Restart preview
// asks its Claude (once); none set, no button. Complete with its preview
// still holding a port: the chat stays, and its Claude can be asked to stop
// it. Automations lists the previews running. The Run shortcuts are gone
// from the menus, the terminal keeps Run and its saved commands. With
// screenshots.
//
//   node test/preview-view.js          both layouts
//   node test/preview-view.js phone    one layout (phone | wide)

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPlaywright, freePort, startServer, findChrome, page, ready, until, sleep, check, failures, CHATS } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "preview-view-"));
const ONLY = process.argv[2];
const URL_UP = "http://amarchy:5173/";

const URL_STOPPED = "http://amarchy:5174/";
for (const c of CHATS) {
  if (c.id === "proj-fresh") Object.assign(c, { preview: { url: URL_UP, run: "pnpm dev" }, preview_up: true, preview_state: "up" });
  if (c.id === "proj-quiet") Object.assign(c, { preview: { url: URL_STOPPED, run: "pnpm dev --port 5174" }, preview_up: false, preview_state: "stopped" });
  if (c.id === "proj-later") Object.assign(c, { preview: { url: "http://amarchy:5175/", run: "pnpm dev --port 5175" }, preview_up: false, preview_state: "failed" });
  if (c.id === "proj-done2") Object.assign(c, { preview: { url: "http://amarchy:5176/" }, preview_up: false, preview_state: "down" });
}
const FAILED = { url: "http://amarchy:5175/", run: "pnpm dev --port 5175", stop: "", ports: [5175, 24678], memory_max: "2G", idle: 10800,
                 state: "failed", log: "Error: Cannot find module 'vite'\n    at boom (x.js:1:1)", task: "Refund: old order", id: "proj-later" };

const card = (id) => `.today:not([hidden]) .tcard[data-id=${id}]`;

async function run(browser, port, layout) {
  const p = await page(browser, layout, port);
  await p.goto("/");
  await ready(p);
  await until(p, () => !!document.querySelector(".tcard"));
  await p.evaluate(() => { window.__opened = []; openLink = (u) => window.__opened.push(u); });
  await p.evaluate(() => document.querySelectorAll("details.tsec, details").forEach((d) => { d.open = true; }));

  check(layout, await until(p, (s) => { const b = document.querySelector(`${s} a.ui-preview`); return b && b.innerText.includes("Preview"); }, card("proj-fresh")), "a card with one: Preview");
  await p.locator(`${card("proj-fresh")} a.ui-preview`).click();
  check(layout, await until(p, (u) => window.__opened.includes(u), URL_UP), "a tap opens it");
  check(layout, await p.evaluate(() => !location.hash.includes("/s/") && !desk.current), "and doesn't open the chat");
  check(layout, await p.evaluate((s) => !document.querySelector(`${s} .ui-preview`), card("proj-done")), "a card without one: no button");

  // Registered, not running: Start preview opens the page that starts it, and nothing goes to Claude.
  const stopped = `${card("proj-quiet")} button.ui-preview`;
  check(layout, (await p.locator(stopped).innerText()).includes("Start preview"), "registered, not running: Start preview");
  await p.screenshot({ path: path.join(SHOTS, `${layout}-board.png`) });
  await p.evaluate(() => { window.__opened.length = 0; });
  await p.locator(stopped).click();
  check(layout, await until(p, () => window.__opened.some((u) => /\/preview\.html\?id=proj-quiet$/.test(u))), "a tap opens the page that starts it");
  await sleep(150);
  check(layout, !p.posts.some((x) => /proj-quiet\/send/.test(x.url)), "and doesn't message its Claude");

  // Failed: its sheet, what it wrote, and its Claude asked to fix it.
  await p.route("**/api/session/proj-later/preview", (r) => r.fulfill({ json: FAILED }));
  const failed = `${card("proj-later")} button.ui-preview`;
  check(layout, (await p.locator(failed).innerText()).includes("Preview failed"), "failed: Preview failed");
  await p.locator(failed).click();
  check(layout, await until(p, () => { const s = [...document.querySelectorAll(".sheet")].pop(); return s && /Stopped with an error/.test(s.innerText) && /Cannot find module/.test(s.innerText); }),
        "its sheet: it failed, and what it wrote");
  const sheetText = await p.evaluate(() => [...document.querySelectorAll(".sheet")].pop().innerText);
  check(layout, /Try again/.test(sheetText) && /Ask Claude to fix it/.test(sheetText) && /pnpm dev --port 5175/.test(sheetText) && /5175, 24678/.test(sheetText),
        "Try again, Ask Claude to fix it, its command and ports");
  await sleep(500);
  await p.screenshot({ path: path.join(SHOTS, `${layout}-preview-sheet.png`) });
  await p.evaluate(() => [...[...document.querySelectorAll(".sheet")].pop().querySelectorAll("button")].find((b) => /Ask Claude to fix it/.test(b.innerText)).click());
  await sleep(200);
  const fixes = p.posts.filter((x) => /proj-later\/send/.test(x.url));
  check(layout, fixes.length === 1 && /Cannot find module/.test(fixes[0].body.text) && /amarchy preview restart/.test(fixes[0].body.text), "Ask Claude to fix it: its log goes with it");
  await p.evaluate(() => closeSheets());

  // An address only, nothing answering: its Claude is asked, once.
  const down = `${card("proj-done2")} button.ui-preview`;
  check(layout, (await p.locator(down).innerText()).includes("Restart preview"), "an address only, nothing answering: Restart preview");
  await p.locator(down).click();
  check(layout, await until(p, () => document.querySelector(".tcard[data-id=proj-done2] .ui-preview").disabled), "asked: it waits");
  await sleep(150);
  const sent = p.posts.filter((x) => /proj-done2\/send/.test(x.url));
  check(layout, sent.length === 1 && /isn't answering: start it again/.test(sent[0].body.text) && /amarchy preview --run/.test(sent[0].body.text),
        "its Claude is asked, once, and to register it");

  // Complete, its preview still holding a port: the chat stays, its Claude can be asked to stop it.
  await p.route("**/api/session/proj-done/close", (r) => { p.posts.push({ url: r.request().url(), body: r.request().postDataJSON() });
    r.fulfill({ status: 409, json: { error: "Its preview is still running", preview_left: ["port 5173: node vite (pid 4242)"], changes: 0 } }); });
  await p.evaluate(() => confirmClose(rowOf("proj-done"), { changes: 0, running: [], preview: "http://amarchy:5173/" }));
  check(layout, await until(p, () => /Stops its preview, http:\/\/amarchy:5173\//.test([...document.querySelectorAll(".sheet")].pop().innerText)), "Complete says it stops its preview");
  await p.evaluate(() => [...[...document.querySelectorAll(".sheet")].pop().querySelectorAll("button")].find((b) => /Complete/.test(b.innerText)).click());
  check(layout, await until(p, () => { const s = [...document.querySelectorAll(".sheet")].pop(); return s && /Its preview is still running/.test(s.innerText) && /pid 4242/.test(s.innerText); }),
        "still running after the stop: says what, and the chat stays");
  await sleep(500);
  await p.screenshot({ path: path.join(SHOTS, `${layout}-preview-left.png`) });
  await p.evaluate(() => [...[...document.querySelectorAll(".sheet")].pop().querySelectorAll("button")].find((b) => /Ask Claude to stop it/.test(b.innerText)).click());
  await sleep(200);
  const stops = p.posts.filter((x) => /proj-done\/send/.test(x.url));
  check(layout, stops.length === 1 && /pid 4242/.test(stops[0].body.text) && /complete the chat/.test(stops[0].body.text), "Ask Claude to stop it: what's left goes with it");
  check(layout, await p.evaluate(() => !!rowOf("proj-done")), "the chat is still there");

  // Automations: the previews running, with their memory.
  await p.route("**/api/automations", (r) => r.fulfill({ json: { automations: [], at: Date.now() / 1000,
    previews: [{ id: "proj-fresh", task: "Fix: login loop", url: URL_UP, run: "pnpm dev", state: "up", memory: 412e6, memory_max: "2G", since: Date.now() / 1000 - 600 }] } }));
  await p.evaluate(() => { autoState.list = null; automationsSheet(); });
  check(layout, await until(p, () => { const s = [...document.querySelectorAll(".sheet")].pop(); return s && /Previews running · 412 MB/.test(s.innerText) && /Fix: login loop/.test(s.innerText) && /412 MB of 2G/.test(s.innerText); }),
        "Automations: the previews running, and their memory");
  await sleep(500);
  await p.screenshot({ path: path.join(SHOTS, `${layout}-automations.png`) });
  await p.evaluate(() => closeSheets());

  await p.evaluate(() => todayOpen(rowOf("proj-fresh")));
  check(layout, await until(p, () => [...document.querySelectorAll(".head-btns .ui-preview")].some((b) => b.offsetParent)), "over the open chat too");
  await p.evaluate(() => { window.__opened.length = 0; });
  await p.evaluate(() => [...document.querySelectorAll(".head-btns .ui-preview")].find((b) => b.offsetParent).click());
  check(layout, await until(p, (u) => window.__opened.includes(u), URL_UP), "a tap there opens it");
  const crowded = await p.evaluate(() => {
    const bar = [...document.querySelectorAll(".head-btns")].find((b) => b.offsetParent);
    return bar.getBoundingClientRect().right > innerWidth + 1 || document.documentElement.scrollWidth > innerWidth;
  });
  const head = await p.evaluate(() => {
    const bar = [...document.querySelectorAll(".head-btns")].find((b) => b.offsetParent);
    const [more, prev, done] = [".more", ".ui-preview", ".complete"].map((c) => bar.querySelector(c));
    const look = (el) => { const c = getComputedStyle(el); return [c.color, c.backgroundColor, c.borderColor, c.height].join(); };
    return { order: [...bar.children].map((c) => (c.matches(".more") ? "more" : c.matches(".ui-preview") ? "preview" : c.matches(".complete") ? "complete" : "state")).join(" "),
             same: look(prev) === look(done), left: more.getBoundingClientRect().right <= prev.getBoundingClientRect().left };
  });
  check(layout, head.order === "state more preview complete" && head.left, `its place: ... Preview Complete (${head.order})`);
  check(layout, head.same, "it looks as Complete does");
  check(layout, !crowded, "the head still fits");
  const name = await p.evaluate(() => [...document.querySelectorAll(".head-title")].find((b) => b.offsetParent).getBoundingClientRect().width);
  check(layout, name >= 100, `its name keeps its room (${Math.round(name)}px)`);
  await p.screenshot({ path: path.join(SHOTS, `${layout}-chat.png`) });

  if (layout === "wide") {
    await p.evaluate(() => { window.__opened.length = 0; });
    await p.keyboard.press("Control+Alt+KeyR");
    check(layout, await until(p, (u) => window.__opened.includes(u), URL_UP), "Ctrl+Alt+R opens it");
    await p.evaluate(() => deskMenu());
    await until(p, () => !!document.querySelector(".picker"));
    const items = await p.evaluate(() => document.querySelector(".picker").innerText);
    check(layout, /Open the preview/.test(items) && !/(^|\n)Run(\n|$)/.test(items), "the Amarchy menu: the preview, no Run");
    await p.keyboard.press("Escape");
    await p.evaluate(() => sessionMenu(rowOf("proj-fresh")));
    await until(p, () => !!document.querySelector(".picker"));
    check(layout, /Preview…/.test(await p.evaluate(() => document.querySelector(".picker").innerText)), "the chat's menu: Preview…");
    await p.keyboard.press("Escape");
  } else {
    await p.locator(".head-btns .more").filter({ visible: true }).click();
    await until(p, () => !!document.querySelector(".sheet"));
    const items = await p.evaluate(() => [...document.querySelectorAll(".sheet")].pop().innerText);
    check(layout, !/Run…/.test(items), "the chat's menu: no Run…");
    check(layout, /Preview…/.test(items), "the chat's menu: Preview…");
  }
  check(layout, !p.errors.length, `no page errors (${p.errors.join("; ")})`);

  // The page Start preview opens: it starts it, says so, and becomes it once it answers.
  const w = await p.context().newPage();
  const asked = { start: 0, reads: 0 };
  await w.route("**/api/session/proj-quiet/preview", (r) => {
    if (r.request().method() === "POST") { asked.start++; asked.body = r.request().postDataJSON(); return r.fulfill({ json: { preview: {} } }); }
    asked.reads++;
    const state = !asked.start ? "stopped" : asked.reads < 4 ? "starting" : "up";
    r.fulfill({ json: { url: URL_STOPPED, run: "pnpm dev --port 5174", state, log: "VITE ready in 312 ms", task: "Eval: json-render", id: "proj-quiet", ports: [5174], memory_max: "2G", idle: 10800 } });
  });
  await w.route(URL_STOPPED, (r) => r.fulfill({ contentType: "text/html", body: "<title>the app itself</title>" }));
  await w.goto("/preview.html?id=proj-quiet");
  check(layout, await until(w, () => /Starting Eval: json-render's preview/.test(document.body.innerText)), "the page: starting, which chat's");
  await w.screenshot({ path: path.join(SHOTS, `${layout}-preview-page.png`) });
  check(layout, asked.start === 1 && asked.body.action === "start", "it starts it, once");
  check(layout, await until(w, (u) => location.href === u, URL_STOPPED, 10000), "and turns into it once it answers");
  await w.close();
  const f = await p.context().newPage();
  await f.route("**/api/session/proj-later/preview", (r) => r.fulfill({ json: FAILED }));
  await f.goto("/preview.html?id=proj-later");
  check(layout, await until(f, () => /didn't start/.test(document.body.innerText) && /Cannot find module/.test(document.body.innerText) && /Try again/.test(document.body.innerText)),
        "failed: the page says so, with what it wrote, and Try again");
  await f.screenshot({ path: path.join(SHOTS, `${layout}-preview-page-failed.png`) });
  await f.close();
  await p.context().close();
}

(async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "preview-view-home-"));
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
