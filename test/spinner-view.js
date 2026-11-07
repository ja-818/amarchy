// The spinner, in a browser: wherever the app draws one, on the phone and on a
// computer, every frame has all its dots, whole and crisp; across its frames
// they're in the middle of its box, and its box in the middle of what holds it.
// It's measured in pixels. It turns by itself, every spinner together, and a
// card that only turned isn't a card that changed. With screenshots.
//
//   node test/spinner-view.js          both layouts
//   node test/spinner-view.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs (Chromium, playwright-core). It starts
// its own app server from this checkout's bin/amarchy, with a home and state
// of its own. Exits 0 when every check passed.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPlaywright, freePort, startServer, findChrome, until, sleep, check, failures } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "spinner-view-"));
const ONLY = process.argv[2];
const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  wide: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};
const DOTS = [3, 3, 4, 3, 4, 3, 3, 4, 3, 4];      // how many in each frame

// Every place the app turns one, built by the app; "cell" takes it as it is.
const PLACES = {
  "a card's pill": 'uiPill("Working", "working").outerHTML',
  "a running pill": 'uiPill("Running · the tests", "running", { long: true }).outerHTML',
  "a chat's working line": '`<div class="chat"><div class="working">${spinner().outerHTML}<span class="now">Reading</span></div></div>`',
  "a step": '`<div class="chat"><div class="fold-head">${spinner().outerHTML}</div></div>`',
  "a row": '`<div class="row">${stateIcon({ status: "working" }).outerHTML}</div>`',
  "an avatar": '`<div class="avatar-wrap">${stateIcon({ status: "working" }).outerHTML}</div>`',
};

async function sandbox(p) {
  await p.evaluate((places) => {
    const box = document.createElement("div");
    box.id = "spin-test";
    box.innerHTML = `<style>
      #spin-test { position: fixed; inset: 0; z-index: 2147483647; background: #000; display: grid; grid-template-columns: repeat(2, 180px); grid-auto-rows: 90px; }
      #spin-test .cell { position: relative; display: flex; align-items: center; justify-content: center; }
      #spin-test .cell * { color: #fff !important; background-color: transparent !important; border-color: transparent !important; box-shadow: none !important; }
      #spin-test .cell :not(.spin) { -webkit-text-fill-color: transparent; }
    </style>`;
    for (const code of Object.values(places)) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.innerHTML = (0, eval)(code);
      box.append(cell);
    }
    document.body.append(box);
  }, PLACES);
}

// The ink in each box of a screenshot, where it is and how much of it.
function measure(decoder, png, boxes, scale) {
  return decoder.evaluate(async ({ b64, boxes, scale }) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d", { willReadFrequently: true });
    c.drawImage(bmp, 0, 0);
    return boxes.map((r) => {
      const X = Math.round(r.x * scale), Y = Math.round(r.y * scale), w = Math.round(r.w * scale), h = Math.round(r.h * scale);
      const d = c.getImageData(X, Y, w, h).data;
      let ink = 0, soft = 0, top = 1e9, bottom = -1, left = 1e9, right = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = d[(y * w + x) * 4];
        if (v > 8 && v < 247) soft++;
        if (v < 128) continue;
        ink++;
        top = Math.min(top, Y + y); bottom = Math.max(bottom, Y + y + 1); left = Math.min(left, X + x); right = Math.max(right, X + x + 1);
      }
      return { ink, soft, top: top / scale, bottom: bottom / scale, left: left / scale, right: right / scale };
    });
  }, { b64: png.toString("base64"), boxes, scale });
}

async function run(browser, layout, port) {
  const scale = LAYOUTS[layout].deviceScaleFactor;
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}`, bypassCSP: true });      // the test's own <style>
  const decoder = await (await browser.newContext()).newPage();
  const errors = [];

  // It turns by itself, every spinner together, and a card doesn't change for it.
  const live = await ctx.newPage();
  live.on("pageerror", (e) => errors.push(e.message));
  await live.goto("/");
  await until(live, () => typeof uiPill === "function" && document.body);
  const turned = await live.evaluate(async () => {
    const a = uiPill("Working", "working"), b = spinner();
    document.body.append(a, b);
    const seen = new Set(), together = [];
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 60));
      const f = a.querySelector(".spin").getAttribute("data-f");
      seen.add(f); together.push(f === b.getAttribute("data-f"));
    }
    const shape = todayShape(a);
    a.querySelector(".spin").setAttribute("data-f", (Number(a.querySelector(".spin").getAttribute("data-f")) + 1) % 10);
    return { frames: seen.size, together: together.every(Boolean), text: b.textContent, same: shape === todayShape(a) };
  });
  check(layout, turned.frames >= 4, `it turns by itself (${turned.frames} frames seen)`);
  check(layout, turned.together, "every spinner on the same frame");
  check(layout, turned.text === "", "no character in it: nothing a font can move");
  check(layout, turned.same, "a card that only turned hasn't changed");
  await live.close();

  // The frames by hand here, not by the app's clock.
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.addInitScript(() => {
    const every = window.setInterval;
    window.setInterval = (fn, ms, ...rest) => (ms === 90 ? 0 : every(fn, ms, ...rest));
  });
  await p.goto("/");
  await until(p, () => typeof uiPill === "function" && document.body);
  await sandbox(p);
  const boxes = await p.evaluate(() => [...document.querySelectorAll("#spin-test .cell")].map((c) => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const s = c.querySelector(".spin");
    const holder = s.parentElement === c ? null : s.parentElement;
    const dot = parseFloat(getComputedStyle(s, "::before").width) / 3;
    return { ...rect(c), spin: rect(s), holder: holder && rect(holder), dot };
  }));
  const seen = Object.keys(PLACES).map(() => ({ top: 1e9, bottom: -1, left: 1e9, right: -1, whole: true, soft: 0, bad: "" }));
  for (let f = 0; f < DOTS.length; f++) {
    await p.evaluate((f) => { for (const el of document.querySelectorAll("#spin-test .spin")) el.setAttribute("data-f", f); }, f);
    const shot = await p.screenshot({ path: f === 2 ? path.join(SHOTS, `${layout}.png`) : undefined });
    const ink = await measure(decoder, shot, boxes, scale);
    ink.forEach((m, i) => {
      const s = seen[i], want = DOTS[f] * (boxes[i].dot * scale) ** 2;
      if (m.ink !== want) { s.whole = false; s.bad += ` frame ${f}: ${m.ink} of ${want}`; }
      s.soft = Math.max(s.soft, m.soft);
      for (const k of ["top", "left"]) s[k] = Math.min(s[k], m[k]);
      for (const k of ["bottom", "right"]) s[k] = Math.max(s[k], m[k]);
    });
  }
  Object.keys(PLACES).forEach((place, i) => {
    const s = seen[i], b = boxes[i], grace = 0.5 + 1e-6;
    const x = (s.left + s.right) / 2, y = (s.top + s.bottom) / 2;
    check(layout, s.whole, `${place}: every frame has all its dots, whole${s.bad}`);
    check(layout, s.soft === 0, `${place}: crisp (${s.soft} soft pixels)`);
    check(layout, Math.abs(x - (b.spin.x + b.spin.w / 2)) <= grace && Math.abs(y - (b.spin.y + b.spin.h / 2)) <= grace,
          `${place}: in the middle of its box (off by ${(x - b.spin.x - b.spin.w / 2).toFixed(2)}, ${(y - b.spin.y - b.spin.h / 2).toFixed(2)})`);
    if (b.holder && /pill/.test(place)) {
      check(layout, Math.abs(y - (b.holder.y + b.holder.h / 2)) <= grace,
            `${place}: in the middle of what holds it, up and down (off by ${(y - b.holder.y - b.holder.h / 2).toFixed(2)})`);
    }
  });
  check(layout, !errors.length, `no page errors ${errors.join(" | ")}`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "spinner-view-home-"));
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
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
