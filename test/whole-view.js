// The desktop app's see-through window drawn whole after a big change, on
// the phone layout and the wide one alike (app/ui.js uiWhole). WebKit draws
// only what changed into buffers it takes turns with; in the desktop app's
// see-through window on Omarchy with no GPU, back from a chat, one of them
// kept the chat's head under the board's bar, and the two took turns on
// screen. So there, after a chat opens or closes, the other tab, a board, a
// sheet or a toast, its whole window changes for a few frames (a veil of
// black at 1 or 2 of 255: a color, which WebKit counts as drawn, where an
// opacity isn't), then it's gone. You can't see it: a screenshot mid-veil is
// the one after it. In a browser or the phones (no amarchyDesktop.omarchy)
// nothing of it, ever. With screenshots.
//
//   node test/whole-view.js          both layouts
//   node test/whole-view.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs. Exits 0 when every check passed.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const homes = require("./homes");      // (test/homes.js: its home gone with it, however it ends)
const { loadPlaywright, freePort, startServer, findChrome, page, ready, until, sleep, check, failures } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "whole-view-"));
const ONLY = process.argv[2];

// Every veil the page puts up and takes down, with the colors it wore.
const WATCH = () => {
  window.__veils = [];
  const watch = new MutationObserver((ms) => ms.forEach((m) => {
    m.addedNodes.forEach((n) => {
      if (!n.classList || !n.classList.contains("ui-whole")) return;
      const v = { in: performance.now(), out: null, colors: new Set() };
      window.__veils.push(v);
      const look = () => { if (v.out !== null) return; v.colors.add(n.style.backgroundColor); requestAnimationFrame(look); };
      look();
    });
    m.removedNodes.forEach((n) => {
      if (!n.classList || !n.classList.contains("ui-whole")) return;
      const v = window.__veils[window.__veils.length - 1];
      if (v && v.out === null) v.out = performance.now();
    });
  }));
  // (Before the page's first element: once there is one.)
  const start = () => (document.documentElement ? watch.observe(document.documentElement, { childList: true }) : setTimeout(start, 0));
  start();
};
const veils = (p) => p.evaluate(() => window.__veils.map((v) => ({ ms: v.out === null ? null : Math.round(v.out - v.in), colors: [...v.colors].filter(Boolean) })));
const settle = (p) => until(p, () => !document.querySelector(".ui-whole") && window.__veils.every((v) => v.out !== null), undefined, 4000);

async function run(browser, port, layout, desktop) {
  const where = `${layout}${desktop ? " (desktop app, Omarchy)" : " (browser)"}`;
  const p = await page(browser, layout, port);
  if (desktop) await p.addInitScript(() => { window.amarchyDesktop = Object.freeze({ version: "test", platform: "linux", omarchy: true, gpu: false }); });
  await p.addInitScript(WATCH);
  await p.goto("/");
  await ready(p);
  await until(p, () => !!document.querySelector(".board-today .tcard[data-id='proj-fresh']"));
  await sleep(600);
  await settle(p);
  const at = async () => (await veils(p)).length;

  // A chat opened, then back to the board.
  let n = await at();
  await p.evaluate(() => boardOpen("proj-fresh"));
  await until(p, () => !!(app.desk ? desk.current : app.session));
  await settle(p);
  const opened = (await veils(p)).slice(n);
  n = await at();
  await p.evaluate(() => (app.desk ? boardBack() : go("#/")));
  await until(p, () => !(app.desk ? desk.current : app.session));
  await settle(p);
  const back = (await veils(p)).slice(n);
  // A veil held up (it's gone in a tenth of a second), and the board without it.
  let mid = null, midVeil = false, after = null;
  if (desktop) {
    // (What moves on its own, the spinners and a card's glow, out of both pictures.)
    await p.addStyleTag({ content: ".spin, .beat, .spinner { visibility: hidden !important; } *, *::before, *::after { animation: none !important; transition: none !important; }" });
    await sleep(300);
    await p.evaluate(() => { uiWhole(); uiWholeState.left = 1e6; });
    await sleep(300);
    midVeil = await p.evaluate(() => !!document.querySelector(".ui-whole") && getComputedStyle(document.querySelector(".ui-whole")).backgroundColor !== "rgba(0, 0, 0, 0)");
    mid = await p.screenshot({ path: path.join(SHOTS, `${where}-mid.png`) });
    await p.evaluate(() => { uiWholeState.left = 0; });
    await settle(p);
    after = await p.screenshot({ path: path.join(SHOTS, `${where}-after.png`) });
  }

  // The other tab, a sheet come and gone.
  n = await at();
  await p.evaluate(() => boardTab("tasks"));
  await settle(p);
  const tab = (await veils(p)).slice(n);
  await p.evaluate(() => boardTab("chats"));
  await settle(p);
  n = await at();
  await p.evaluate(() => sheet(sheetHead("A sheet"), h("p", {}, "Over the board")));
  await settle(p);
  await p.evaluate(() => closeSheets());
  await settle(p);
  const sheets = (await veils(p)).slice(n);

  if (!desktop) {
    const all = await veils(p);
    check(where, all.length === 0 && !(await p.evaluate(() => uiWholeHere())), `no veil, ever: a browser draws as it does (${all.length})`);
  } else {
    const ok = (vs) => vs.length >= 1 && vs.every((v) => v.ms !== null && v.ms < 2000 && v.colors.length === 2);
    check(where, ok(opened), `a chat opened: its window drawn whole a few frames, then the veil's gone (${JSON.stringify(opened)})`);
    check(where, ok(back), `back to the board: drawn whole again (${JSON.stringify(back)})`);
    check(where, ok(tab), `the other tab: drawn whole (${JSON.stringify(tab)})`);
    check(where, sheets.length >= 2 && ok(sheets), `a sheet, come and gone: drawn whole each time (${sheets.length})`);
    const colors = new Set([...opened, ...back, ...tab, ...sheets].flatMap((v) => v.colors));
    check(where, [...colors].every((c) => /^rgba\(0, 0, 0, 0\.00[48]\)$/.test(c)),
          `its colors: black at 1 and 2 of 255, a color each frame (${[...colors].join(", ")})`);
    // Not to be seen: the screen mid-veil is the screen after it.
    const same = Buffer.compare(mid, after) === 0 || await p.evaluate(async ([a, b]) => {
      const load = (b64) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = `data:image/png;base64,${b64}`; });
      const [x, y] = await Promise.all([load(a), load(b)]);
      const c = document.createElement("canvas"); c.width = x.width; c.height = x.height;
      const g = c.getContext("2d");
      g.drawImage(x, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data;
      g.clearRect(0, 0, c.width, c.height); g.drawImage(y, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
      let off = 0;
      for (let i = 0; i < da.length; i++) off = Math.max(off, Math.abs(da[i] - db[i]));
      return off <= 2;
    }, [mid.toString("base64"), after.toString("base64")]);
    check(where, midVeil && same, `you can't see it: mid-veil, the screen is the one after it, a step of 2 at most (veil up: ${midVeil})`);
  }
  check(where, p.errors.length === 0, `no page errors (${p.errors.join(" | ").slice(0, 300)})`);
  await p.context().close();
}

if (require.main === module) (async () => {
  const pw = loadPlaywright();
  const home = homes.home("whole-view");
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of ["phone", "wide"]) {
      if (ONLY && ONLY !== layout) continue;
      for (const desktop of [true, false]) {
        console.log(`${layout}${desktop ? ", the desktop app on Omarchy" : ", a browser"}`);
        await run(browser, port, layout, desktop).catch((e) => check(layout, false, `crashed: ${e.stack}`));
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
