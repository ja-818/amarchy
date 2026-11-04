// A chat's Preview, in a browser, both layouts: on its card and over the open
// chat, one tap opens it; nothing answering, Restart preview asks its Claude
// (once) instead; none set, no button. The Run shortcuts are gone from the
// menus, the terminal keeps Run and its saved commands. With screenshots.
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

for (const c of CHATS) {
  if (c.id === "proj-fresh") Object.assign(c, { preview: { url: URL_UP }, preview_up: true });
  if (c.id === "proj-quiet") Object.assign(c, { preview: { url: "http://amarchy:5174/" }, preview_up: false });
}

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

  const stopped = `${card("proj-quiet")} button.ui-preview`;
  check(layout, (await p.locator(stopped).innerText()).includes("Restart preview"), "nothing answering: Restart preview");
  await p.screenshot({ path: path.join(SHOTS, `${layout}-board.png`) });
  await p.locator(stopped).click();
  check(layout, await until(p, () => document.querySelector(".tcard[data-id=proj-quiet] .ui-preview").disabled), "asked: it waits");
  await sleep(150);
  const sent = p.posts.filter((x) => /proj-quiet\/send/.test(x.url));
  check(layout, sent.length === 1 && /isn't answering: start it again/.test(sent[0].body.text), "its Claude is asked, once");

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
  } else {
    await p.locator(".head-btns .more").filter({ visible: true }).click();
    await until(p, () => !!document.querySelector(".sheet"));
    const items = await p.evaluate(() => [...document.querySelectorAll(".sheet")].pop().innerText);
    check(layout, !/Run…/.test(items), "the chat's menu: no Run…");
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
