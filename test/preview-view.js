// A chat's Preview, in a browser, both layouts: on its card and over the open
// chat, one tap opens it; registered and not running, Start preview starts it
// where you are (nothing opens, no message to Claude): the button turns and
// says Starting…, and a toast says when it's ready (a tap on it opens it), or
// that it didn't start; failed, Preview failed opens its sheet (what it wrote, Try again,
// Ask Claude to fix it); an address only, nothing answering, Restart preview
// asks its Claude (once); none set, no button. Complete with its preview
// still holding a port: the chat stays, and its Claude can be asked to stop
// it. Automations lists the previews running. The Run shortcuts are gone
// from the menus, the terminal keeps Run and its saved commands. A chat with
// several: one button, Previews, a dropdown of them by name under it (on its
// card and over the chat), each doing what its own button would; a tap
// outside closes it and presses nothing else, Esc too (the chat stays open);
// the keys open it and move in it; the chat's menu picks one to manage;
// Complete says it stops them all. With screenshots.
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
// Served over HTTPS by amarchy (tailscale serve): the dropdown and Complete say it short, amarchy:5180.
const URL_APP = "https://amarchy.tail1234.ts.net:5180/", URL_BOOK = "https://amarchy.tail1234.ts.net:6006/";
const one = (url, extra) => [{ key: "", label: url.replace(/^http:\/\//, "").replace(/\/$/, ""), url, ...extra }];
for (const c of CHATS) {
  if (c.id === "proj-fresh") c.previews = one(URL_UP, { run: "pnpm dev", state: "up" });
  if (c.id === "proj-quiet") c.previews = one(URL_STOPPED, { run: "pnpm dev --port 5174", state: "stopped" });
  if (c.id === "proj-later") c.previews = one("http://amarchy:5175/", { run: "pnpm dev --port 5175", state: "failed" });
  if (c.id === "proj-done2") c.previews = one("http://amarchy:5176/", { state: "down" });
  if (c.id === "proj-done") c.previews = [{ key: "", name: "App", label: "App", url: URL_APP, run: "pnpm dev --port 5180", state: "up" },
                                          { key: "storybook", name: "Storybook", label: "Storybook", url: URL_BOOK, run: "pnpm storybook -p 6006", state: "stopped" }];
}
const FAILED = { url: "https://amarchy.tail1234.ts.net:5175/", run: "pnpm dev --port 5175", stop: "", ports: [5175, 24678], memory_max: "2G", idle: 10800,
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
  check(layout, await p.evaluate((s) => !document.querySelector(`${s} .ui-preview`), card("proj-work")), "a card without one: no button");

  // Registered, not running: Start preview starts it here, the button turning, and nothing opens or goes to Claude.
  const stopped = `${card("proj-quiet")} button.ui-preview`;
  const starts = [];
  await p.route("**/api/session/proj-quiet/preview", (r) => { starts.push(r.request().postDataJSON()); r.fulfill({ json: { preview: {} } }); });
  check(layout, (await p.locator(stopped).innerText()).includes("Start preview"), "registered, not running: Start preview");
  await p.screenshot({ path: path.join(SHOTS, `${layout}-board.png`) });
  await p.evaluate(() => { window.__opened.length = 0; });
  await p.locator(stopped).click();
  check(layout, await until(p, (s) => { const b = document.querySelector(s); return b && /Starting…/.test(b.innerText) && !!b.querySelector(".spinner") && b.getAttribute("aria-busy") === "true"; }, stopped),
        "a tap: the button turns and says Starting…");
  check(layout, await until(p, () => true) && starts.length === 1 && starts[0].action === "start", "it starts it, once");
  await p.screenshot({ path: path.join(SHOTS, `${layout}-starting.png`) });
  await sleep(150);
  check(layout, await p.evaluate(() => !window.__opened.length && !location.hash.includes("/s/") && !document.querySelector(".sheet")), "nothing opens: you stay where you are");
  check(layout, !p.posts.some((x) => /proj-quiet\/send/.test(x.url)), "and doesn't message its Claude");
  // It answers: the button is Preview, and a toast says so; a tap on it opens it.
  const stands = (state, id = "proj-quiet", key = "") => p.evaluate(({ chats, state, id, key }) => {
    ahead.clear();
    const now = new Map((app.view.sessions || []).map((s) => [s.id, s.previews]));
    app.view = { ...app.view, sessions: chats.map((c) => ({ ...c, previews: (now.get(c.id) || c.previews || []).map((x) => (c.id === id && (x.key || "") === key ? { ...x, state } : { ...x })) })) };
    refresh();
  }, { chats: CHATS, state, id, key });
  await stands("starting");
  check(layout, await p.evaluate((s) => /Starting…/.test(document.querySelector(s).innerText) && !document.querySelector(".toast"), stopped), "still starting: it keeps turning, no toast");
  await stands("up");
  check(layout, await until(p, () => { const t = document.querySelector(".toast.act"); return t && /Eval: json-render's preview is ready/.test(t.innerText) && /Open/.test(t.innerText); }),
        "it answers: a toast says it's ready");
  await p.screenshot({ path: path.join(SHOTS, `${layout}-ready.png`) });
  await p.locator(".toast.act").click();
  check(layout, await until(p, (u) => window.__opened.includes(u), URL_STOPPED), "a tap on it opens it");
  check(layout, await p.evaluate(() => !document.querySelector(".toast")), "and it's gone");
  // Started, and it stops with an error: the toast says so, and opens its sheet.
  await stands("stopped");
  await p.locator(stopped).click();
  await until(p, (s) => /Starting…/.test(document.querySelector(s).innerText), stopped);
  await stands("failed");
  check(layout, await until(p, () => { const t = document.querySelector(".toast.act"); return t && /preview didn't start/.test(t.innerText) && /See why/.test(t.innerText); }),
        "it fails: a toast says it didn't start");
  check(layout, (await p.locator(stopped).innerText()).includes("Preview failed"), "and the button says Preview failed");
  await p.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  await p.unroute("**/api/session/proj-quiet/preview");
  await stands("stopped");

  // Several: one button, Previews, and a dropdown of them by name under it.
  const many = `${card("proj-done")} button.ui-previews`;
  check(layout, await until(p, (s) => { const b = document.querySelector(s); return b && /Previews/.test(b.innerText) && b.getAttribute("aria-haspopup") === "menu" && !!b.querySelector(".ui-drop-mark"); }, many),
        "a card with several: one button, Previews ▾");
  check(layout, await p.evaluate((s) => document.querySelectorAll(`${s} .ui-preview`).length === 1, card("proj-done")), "and only that one");
  await p.evaluate(() => { window.__opened.length = 0; });
  await p.locator(many).click();
  const drop = () => p.evaluate((s) => {
    const m = document.querySelector(".ui-dropdown"), b = document.querySelector(s);
    if (!m) return null;
    const r = m.getBoundingClientRect(), a = b.getBoundingClientRect();
    return { rows: [...m.querySelectorAll(".ui-drop-row")].map((x) => x.innerText.replace(/\s+/g, " ").trim()), expanded: b.getAttribute("aria-expanded"),
             under: r.top >= a.bottom - 1 || r.bottom <= a.top + 1, near: Math.abs(r.right - a.right) < 2 || Math.abs(r.left - a.left) < 2 || r.left <= 9 || r.right >= innerWidth - 9,
             inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
  }, many);
  const d1 = await drop();
  check(layout, d1 && d1.rows.length === 2 && /^App Open · amarchy:5180/.test(d1.rows[0]) && /^Storybook Not running: start it · amarchy:6006/.test(d1.rows[1]),
        `a tap: the dropdown, each by name, where it stands (${d1 && d1.rows.join(" | ")})`);
  check(layout, d1 && d1.expanded === "true" && d1.under && d1.near && d1.inside, "under its button, on the screen, and the button says it's open");
  check(layout, await p.evaluate(() => !location.hash.includes("/s/") && !desk.current && !document.querySelector(".sheet")), "the chat doesn't open");
  await sleep(200);
  await p.screenshot({ path: path.join(SHOTS, `${layout}-previews-card.png`) });
  await p.locator(".ui-dropdown .ui-drop-row").first().click();
  check(layout, await until(p, (u) => window.__opened.includes(u), URL_APP), "one that answers: a tap opens it");
  check(layout, await p.evaluate(() => !document.querySelector(".ui-dropdown") && !desk.current), "and the dropdown goes, the chat still closed");
  // One not running: it starts where you are, the button turning.
  const bookStarts = [];
  await p.route("**/api/session/proj-done/preview", (r) => { bookStarts.push(r.request().postDataJSON()); r.fulfill({ json: { preview: {} } }); });
  await p.locator(many).click();
  await p.locator(".ui-dropdown .ui-drop-row").nth(1).click();
  check(layout, await until(p, () => true) && bookStarts.length === 1 && bookStarts[0].action === "start" && bookStarts[0].key === "storybook", "Storybook: started, by its key");
  check(layout, await until(p, (s) => { const b = document.querySelector(s); return b && !!b.querySelector(".spinner") && b.getAttribute("aria-busy") === "true"; }, many),
        "the button turns while it starts");
  await p.locator(many).click();
  const d2 = await drop();
  check(layout, d2 && /^Storybook Starting…/.test(d2.rows[1]), `its row says Starting… (${d2 && d2.rows[1]})`);
  await p.keyboard.press("Escape");
  check(layout, await until(p, () => !document.querySelector(".ui-dropdown")), "Esc closes it");
  await stands("starting", "proj-done", "storybook");
  await stands("up", "proj-done", "storybook");
  check(layout, await until(p, () => { const t = document.querySelector(".toast.act"); return t && /Study: T3 vs amarchy's Storybook is ready/.test(t.innerText); }),
        "it answers: a toast says which one is ready");
  await p.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  await p.unroute("**/api/session/proj-done/preview");
  await stands("stopped", "proj-done", "storybook");
  // A tap outside closes it, and presses nothing under it.
  await p.locator(many).click();
  await until(p, () => !!document.querySelector(".ui-dropdown"));
  const box = await p.locator(card("proj-quiet")).boundingBox();
  await p.mouse.click(box.x + 12, box.y + 12);
  await sleep(200);
  check(layout, await p.evaluate(() => !document.querySelector(".ui-dropdown") && !desk.current && !location.hash.includes("/s/")),
        "a tap outside: it closes, and the card under it doesn't open");
  // Keys: Enter on the button opens it, the first row lit; ↓ the next; ↵ picks.
  if (layout === "wide") {
    await p.locator(many).focus();
    await p.keyboard.press("Enter");
    check(layout, await until(p, () => document.activeElement && document.activeElement.matches(".ui-dropdown .ui-drop-row")), "from the keys: on its first row");
    await p.keyboard.press("ArrowDown");
    check(layout, await p.evaluate(() => /Storybook/.test(document.activeElement.innerText)), "↓ the next");
    await p.keyboard.press("ArrowDown");
    check(layout, await p.evaluate(() => /App/.test(document.activeElement.innerText)), "and round to the first");
    await p.evaluate(() => { window.__opened.length = 0; });
    await p.keyboard.press("Enter");
    check(layout, await until(p, (u) => window.__opened.includes(u), URL_APP) && await p.evaluate(() => !document.querySelector(".ui-dropdown")), "↵ picks it");
    // Ctrl+Alt+O on its card: its Previews.
    await p.evaluate(() => { const s = rowOf("proj-done"); s.today = { ...s.today, links: [] }; todayRedraw(); });
    await until(p, () => !document.querySelector(".tcard[data-id=proj-done] a.tbtn"));
    await p.evaluate(() => boardFocus(document.querySelector(".tcard[data-id=proj-done] .today-go")));
    await p.keyboard.press("Control+Alt+KeyO");
    check(layout, await until(p, () => document.querySelector(".ui-dropdown") && document.activeElement.matches(".ui-drop-row")), "Ctrl+Alt+O on its card: its dropdown");
    await p.keyboard.press("Escape");
    await stands("stopped", "proj-done", "storybook");
  }
  // Open, and the list comes again with nothing new: the same rows (a tap lands where it was aimed).
  await p.locator(many).click();
  await until(p, () => !!document.querySelector(".ui-dropdown .ui-drop-row"));
  const kept = await p.evaluate(async () => {
    const first = document.querySelector(".ui-dropdown .ui-drop-row");
    refresh();
    await new Promise((r) => setTimeout(r, 100));
    return document.querySelector(".ui-dropdown .ui-drop-row") === first;
  });
  check(layout, kept, "the list again, nothing new: the same rows");
  await stands("failed", "proj-done", "storybook");
  check(layout, await until(p, () => { const r = document.querySelectorAll(".ui-dropdown .ui-drop-row")[1]; return r && /Failed: see why/.test(r.innerText) && r.matches(".bad"); }),
        "one fails while it's open: its row says so");
  check(layout, await p.evaluate((s) => document.querySelector(s).matches(".bad"), many), "and the button is marked");
  await p.keyboard.press("Escape");
  await stands("stopped", "proj-done", "storybook");

  // Failed: its sheet, what it wrote, and its Claude asked to fix it.
  await p.route("**/api/session/proj-later/preview*", (r) => r.fulfill({ json: FAILED }));
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
  await p.evaluate(() => confirmClose(rowOf("proj-fresh"), { changes: 0, running: [], previews: ["http://amarchy:5173/"] }));
  check(layout, await until(p, () => /Stops its preview, amarchy:5173\./.test([...document.querySelectorAll(".sheet")].pop().innerText)), "Complete says it stops its preview");
  await p.evaluate(() => closeSheets());
  await p.evaluate(() => confirmClose(rowOf("proj-done"), { changes: 0, running: [], previews: ["https://amarchy.tail1234.ts.net:5180/", "http://amarchy:6006/"] }));
  check(layout, await until(p, () => /Stops its 2 previews, amarchy:5180 and amarchy:6006\./.test([...document.querySelectorAll(".sheet")].pop().innerText)),
        "with several, that it stops them all");
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
  // Starting: it turns there too, in the same place.
  await stands("starting", "proj-fresh");
  check(layout, await until(p, () => { const b = [...document.querySelectorAll(".head-btns .ui-preview")].find((b) => b.offsetParent); return b && !!b.querySelector(".spinner") && b.getAttribute("aria-label") === "Starting…"; }),
        "starting: its button over the chat turns");
  await p.screenshot({ path: path.join(SHOTS, `${layout}-chat-starting.png`) });
  await stands("up", "proj-fresh");
  await until(p, () => { const b = [...document.querySelectorAll(".head-btns .ui-preview")].find((b) => b.offsetParent); return b && !b.querySelector(".spinner"); });
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
    await p.keyboard.press("Control+Alt+KeyO");
    check(layout, await until(p, (u) => window.__opened.includes(u), URL_UP), "Ctrl+Alt+O opens it");
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
  // Over the open chat, with several: Previews in the same place, its dropdown under it.
  await p.evaluate(() => closeSheets());
  await p.evaluate(() => todayOpen(rowOf("proj-done")));
  check(layout, await until(p, () => [...document.querySelectorAll(".head-btns .ui-previews")].some((b) => b.offsetParent)), "over the chat: Previews");
  const head2 = await p.evaluate(() => {
    const bar = [...document.querySelectorAll(".head-btns")].find((b) => b.offsetParent);
    const name = [...document.querySelectorAll(".head-title")].find((b) => b.offsetParent).getBoundingClientRect().width;
    return { order: [...bar.children].map((c) => (c.matches(".more") ? "more" : c.matches(".ui-preview") ? "preview" : c.matches(".complete") ? "complete" : "state")).join(" "),
             fits: bar.getBoundingClientRect().right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth, name };
  });
  check(layout, head2.order === "state more preview complete" && head2.fits && head2.name >= 100, `in its place, the head fits, its name keeps its room (${head2.order}, ${Math.round(head2.name)}px)`);
  await p.evaluate(() => [...document.querySelectorAll(".head-btns .ui-previews")].find((b) => b.offsetParent).click());
  const d3 = await p.evaluate(() => {
    const m = document.querySelector(".ui-dropdown"), b = [...document.querySelectorAll(".head-btns .ui-previews")].find((x) => x.offsetParent);
    if (!m) return null;
    const r = m.getBoundingClientRect(), a = b.getBoundingClientRect();
    return { n: m.querySelectorAll(".ui-drop-row").length, under: r.top >= a.bottom - 1, inside: r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight };
  });
  check(layout, d3 && d3.n === 2 && d3.under && d3.inside, "a tap: its dropdown, under it, on the screen");
  await sleep(200);
  await p.screenshot({ path: path.join(SHOTS, `${layout}-previews-chat.png`) });
  await p.keyboard.press("Escape");
  check(layout, await until(p, () => !document.querySelector(".ui-dropdown")) && await p.evaluate(() => !!document.querySelector(".head-btns .ui-previews") && (desk.current === "proj-done" || (app.session && app.session.id === "proj-done"))),
        "Esc closes it, and the chat stays open");
  if (layout === "wide") {
    await p.keyboard.press("Control+Alt+KeyO");
    check(layout, await until(p, () => document.querySelector(".ui-dropdown") && document.activeElement.matches(".ui-drop-row")), "Ctrl+Alt+O: its dropdown, from the keys");
    await p.keyboard.press("Escape");
    await p.evaluate(() => sessionMenu(rowOf("proj-done")));
    await until(p, () => !!document.querySelector(".picker"));
    check(layout, await p.evaluate(() => [...document.querySelectorAll(".picker-row")].some((r) => /^Previews/.test(r.innerText) && r.querySelector(".chev"))), "the chat's menu: Previews ›");
    await p.keyboard.press("Escape");
  } else {
    await p.locator(".head-btns .more").filter({ visible: true }).click();
    await until(p, () => !!document.querySelector(".sheet"));
    await p.route("**/api/session/proj-done/preview?key=storybook", (r) => r.fulfill({ json: { key: "storybook", name: "Storybook", label: "Storybook", url: URL_BOOK, run: "pnpm storybook -p 6006", stop: "", ports: [6006], memory_max: "2G", idle: 10800, state: "stopped", log: "", id: "proj-done", task: "Study: T3 vs amarchy" } }));
    await p.evaluate(() => [...[...document.querySelectorAll(".sheet")].pop().querySelectorAll("button")].find((b) => /^Previews…$/.test(b.innerText)).click());
    check(layout, await until(p, () => { const s = [...document.querySelectorAll(".sheet")].pop(); return s && /App/.test(s.innerText) && /Storybook/.test(s.innerText); }), "the chat's menu: Previews…, each");
    await p.evaluate(() => [...[...document.querySelectorAll(".sheet")].pop().querySelectorAll(".menu-item")].find((b) => /Storybook/.test(b.innerText)).click());
    check(layout, await until(p, () => { const s = [...document.querySelectorAll(".sheet")].pop(); return s && /^Storybook/.test(s.querySelector("h2").innerText) && /pnpm storybook/.test(s.innerText); }),
          "one picked: its sheet, its name on it");
    await p.evaluate(() => closeSheets());
  }
  check(layout, !p.errors.length, `no page errors (${p.errors.join("; ")})`);

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
