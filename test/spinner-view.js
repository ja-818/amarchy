// The spinner, in a browser: every frame of it whole, wherever the app draws
// one and in every font, on the phone and on a computer. Its dots are measured
// in pixels against the same glyph with room around it: a frame that loses or
// flattens a row of dots here is what you'd see turning. With screenshots.
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
const { loadPlaywright, freePort, startServer, findChrome, until, check, failures } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "spinner-view-"));
const ONLY = process.argv[2];
const SCALE = 4;
const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: SCALE },
  wide: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: SCALE },
};

// Every place the app turns one, as the app marks it up.
const SPIN = '<span class="spinner spin"></span>';
const PLACES = {
  "a card's pill": `<span class="tpill t-working">${SPIN}<span class="tpill-text">Working</span></span>`,
  "a chat's working line": `<div class="chat"><div class="working">${SPIN}</div></div>`,
  "a step": `<div class="chat"><div class="fold-head">${SPIN}</div></div>`,
  "the activity": `<div class="chat"><div class="act-node">${SPIN}</div></div>`,
  "a row": '<div class="row"><span class="state working spin"></span></div>',
  "an avatar": '<div class="avatar-wrap"><span class="state working spin"></span></div>',
};

// One cell a place, its twin beside it: the same glyph, same font, room around it.
async function sandbox(p) {
  await p.evaluate((places) => {
    const box = document.createElement("div");
    box.id = "spin-test";
    box.innerHTML = `<style>
      #spin-test { position: fixed; inset: 0; z-index: 2147483647; background: #000; display: grid; grid-template-columns: repeat(2, 76px); grid-auto-rows: 76px; }
      #spin-test .cell { position: relative; display: grid; place-items: center; overflow: hidden; }
      #spin-test .cell * { color: #fff !important; background: none !important; border-color: transparent !important; box-shadow: none !important; }
      #spin-test .tpill-text { visibility: hidden; width: 0; overflow: hidden; }
      #spin-test .twin { line-height: 3; }
    </style>`;
    for (const html of Object.values(places)) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.innerHTML = html;
      const twin = document.createElement("div");
      twin.className = "cell";
      twin.innerHTML = '<span class="twin"></span>';
      box.append(cell, twin);
    }
    document.body.append(box);
    for (const cell of box.querySelectorAll(".cell")) {
      const spin = cell.querySelector(".spin");
      if (!spin) continue;
      spin.textContent = SPINNER[0];
      const css = getComputedStyle(spin);
      const twin = cell.nextElementSibling.firstChild;
      twin.style.fontFamily = css.fontFamily;
      twin.style.fontSize = css.fontSize;
      twin.style.fontWeight = css.fontWeight;
    }
  }, PLACES);
}

// The ink in each cell of a screenshot: how many pixels, and how tall and wide.
function measure(decoder, png, cells) {
  return decoder.evaluate(async ({ b64, cells, scale }) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d", { willReadFrequently: true });
    c.drawImage(bmp, 0, 0);
    return cells.map((r) => {
      const w = r.w * scale, h = r.h * scale;
      const d = c.getImageData(r.x * scale, r.y * scale, w, h).data;
      let ink = 0, top = h, bottom = -1, left = w, right = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4] < 128) continue;
        ink++;
        top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x);
      }
      return { ink, height: bottom - top + 1, width: right - left + 1 };
    });
  }, { b64: png.toString("base64"), cells, scale: SCALE });
}

async function run(browser, layout, port) {
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}`, bypassCSP: true });      // the test's own <style>
  const p = await ctx.newPage();
  const decoder = await (await browser.newContext()).newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  // The frames are set by hand here, not by the app's clock.
  await p.addInitScript(() => {
    const every = window.setInterval;
    window.setInterval = (fn, ms, ...rest) => (ms === 90 ? 0 : every(fn, ms, ...rest));
  });
  await p.goto("/");
  const { fonts } = await (await ctx.request.get("/api/look")).json();
  const keys = Array.isArray(fonts) ? fonts.map((f) => f.key) : Object.keys(fonts);

  for (const key of keys) {
    await ctx.request.post("/api/look", { data: { font: key } });
    await p.goto("/");
    await until(p, () => typeof SPINNER !== "undefined" && document.body);
    await sandbox(p);
    await p.evaluate(async () => {
      const size = getComputedStyle(document.querySelector("#spin-test .spin")).fontSize;
      await document.fonts.load(`${size} ${getComputedStyle(document.documentElement).getPropertyValue("--font")}`, SPINNER.join(""));
      await document.fonts.ready;
    });
    const cells = await p.evaluate(() => [...document.querySelectorAll("#spin-test .cell")].map((c) => {
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }));
    const frames = await p.evaluate(() => SPINNER.length);
    const worst = {};
    for (let f = 0; f < frames; f++) {
      await p.evaluate((f) => {
        for (const el of document.querySelectorAll("#spin-test .spin, #spin-test .twin")) el.textContent = SPINNER[f];
      }, f);
      const shot = await p.screenshot({ path: f === 1 ? path.join(SHOTS, `${layout}-${key}.png`) : undefined });
      const ink = await measure(decoder, shot, cells);
      Object.keys(PLACES).forEach((place, i) => {
        const [got, want] = [ink[i * 2], ink[i * 2 + 1]];
        const lost = want.ink ? 1 - got.ink / want.ink : 1;
        if (!worst[place] || lost > worst[place].lost) worst[place] = { lost, frame: f, got, want };
      });
    }
    for (const [place, w] of Object.entries(worst)) {
      check(`${layout} ${key}`, w.want.ink > 0 && w.lost < 0.03 && w.got.height >= w.want.height - 1,
            `${place}: whole in every frame (worst, frame ${w.frame}: ${Math.round(w.lost * 100)}% of its ink lost, ${w.got.height} of ${w.want.height} tall)`);
    }
  }
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
