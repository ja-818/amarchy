// The tour (app/tour.js: amarchy in 100 seconds), in a browser, on a phone
// and on a wide screen. An empty amarchy (no project, no chat) opened on a
// new device: the tour opens by itself over the welcome, once; Next, Back,
// the keys, a swipe and the bar's segments go along it; every slide has its
// pixel art, its words and fits the screen; its themes slide wears a theme
// when tapped; its last slide bursts and offers the way to start (a project
// with none, a chat with some); closed, it's seen: a reload doesn't bring it
// back, the welcome's Take the tour, Settings and the Amarchy menu's Tour
// do. The phone and the wide layouts have the same slides, word for word.
// With a screenshot of every slide in both layouts.
//
//   node test/tour-view.js          both layouts
//   node test/tour-view.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs (Chromium, playwright-core). It starts
// its own app server from this checkout's bin/amarchy, with a home and state
// of its own (an empty amarchy). Exits 0 when every check passed.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const tv = require("./today-view.js");

const { check, until, sleep, failures } = tv;
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "tour-view-"));
const ONLY = process.argv[2];
const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};
const SLIDES = 11;

// A device that has never opened amarchy, on an empty one: its own state.
async function fresh(browser, layout, port) {
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}` });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "standalone", { get: () => true });
    try { if (!localStorage.getItem("amarchy-push")) localStorage.setItem("amarchy-push", "no"); } catch (e) { /* no storage yet */ }
  });
  await p.goto("/");
  await until(p, () => window.app && app.view && Array.isArray(app.view.sessions));
  return p;
}

const open = (p) => until(p, () => !!document.querySelector(".sheet-back.slides .ui-slide"));
const at = (p) => p.evaluate(() => { const el = document.querySelector(".sheet-back.slides"); return el ? el.at() : -1; });

// The slide shown, as you read it.
const slide = (p) => p.evaluate(() => {
  const s = document.querySelector(".sheet-back.slides .ui-slide");
  const stage = document.querySelector(".ui-slides-stage");
  return {
    kicker: s.querySelector(".ui-slide-kicker").innerText,
    title: s.querySelector(".ui-slide-title").innerText,
    words: [...s.querySelectorAll(".ui-slide-line, .ui-slide-aside, .code code, .tpill, .tbtn")].map((x) => x.innerText.trim()).filter(Boolean),
    art: s.querySelectorAll(".ui-slide-art .ui-px svg rect, .ui-slide-art .ui-keycap").length,
    fits: stage.scrollHeight <= stage.clientHeight + 1,
    count: document.querySelector(".ui-slides-count").innerText,
    next: document.querySelector(".ui-slides-next").innerText,
    back: document.querySelector(".ui-slides-back").disabled,
  };
});

// A finger's swipe across the slide: dx < 0 to the next one.
const swipe = (p, dx) => p.evaluate((dx) => {
  const stage = document.querySelector(".ui-slides-stage");
  const r = stage.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const touch = (cx) => new Touch({ identifier: 1, target: stage, clientX: cx, clientY: y });
  stage.dispatchEvent(new TouchEvent("touchstart", { touches: [touch(x)], changedTouches: [touch(x)], bubbles: true }));
  stage.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [touch(x + dx)], bubbles: true }));
}, dx);

async function run(browser, port, layout) {
  const where = layout;
  const p = await fresh(browser, layout, port);
  check(where, await p.evaluate(() => !app.view.sessions.length && !(app.view.projects || []).length), "an empty amarchy: no project, no chat");
  check(where, await until(p, () => !!document.querySelector(".welcome")), "the welcome under it");
  // First time on this device: the tour, by itself.
  check(where, await open(p), "the tour opens by itself, the first time");
  check(where, await p.evaluate((n) => document.querySelectorAll(".ui-slides-seg").length === n, SLIDES), `${SLIDES} slides, a segment each`);
  const first = await slide(p);
  check(where, first.kicker.toLowerCase() === "amarchy in 100 seconds" && /Twelve is a company/.test(first.title), `its first: ${first.title}`);
  check(where, first.back && first.count === `1 / ${SLIDES}` && first.next === "Next", "Back hidden on the first, 1 of all, Next");
  await p.screenshot({ path: path.join(SHOTS, `${where}-tour-01.png`) });

  // Every slide, one after the other: Next (and on the phone a swipe, on a
  // computer the arrow keys); each with its art and words, fitting the screen.
  const seen = [first];
  for (let i = 1; i < SLIDES; i++) {
    if (layout === "phone" && i % 2) await swipe(p, -120);
    else if (layout === "wide" && i % 2) await p.keyboard.press("ArrowRight");
    else await p.click(".ui-slides-next");
    await until(p, (i) => document.querySelector(".sheet-back.slides").at() === i, i);
    await sleep(250);
    const s = await slide(p);
    seen.push(s);
    check(where, (await at(p)) === i, `slide ${i + 1}: ${s.kicker} · ${s.title}`);
    check(where, s.art > 0, `  its pixel art (${s.art} pixels)`);
    check(where, s.fits, "  it fits the screen, nothing to scroll");
    await p.screenshot({ path: path.join(SHOTS, `${where}-tour-${String(i + 1).padStart(2, "0")}.png`) });
  }
  // What it says: the Safari apps, themes, the setup's command.
  const all = seen.map((s) => [s.title, ...s.words].join("\n")).join("\n");
  check(where, /Add to Home Screen/.test(all) && /Add to Dock/.test(all) && (all.match(/Safari/g) || []).length >= 2, "making it an app from Safari, on iPhone and Mac");
  check(where, /themes/i.test(all) && /Tokyo Night/.test(all), "the themes");
  check(where, /install\.sh/.test(all) && /amarchy app on/.test(all) && /Tailscale/.test(all), "how to set it up");
  const last = seen[SLIDES - 1];
  check(where, last.next === "Let's go" && last.words.includes("Add a project from GitHub") && last.words.includes("Start an empty project"),
        "the last: Let's go, and the way to start (no project yet: add one)");
  check(where, await p.evaluate(() => document.querySelectorAll(".ui-slides-stage .ui-burst i").length > 20), "  with confetti");

  // Back, the bar's segments, and the keys' ← go back.
  await p.click(".ui-slides-back");
  check(where, await until(p, (n) => document.querySelector(".sheet-back.slides").at() === n - 2, SLIDES), "Back: the one before");
  await p.click(`.ui-slides-seg:nth-child(9)`);
  check(where, await until(p, () => document.querySelector(".sheet-back.slides").at() === 8), "a segment of the bar: that slide (Themes)");
  if (layout === "phone") { await swipe(p, 120); check(where, await until(p, () => document.querySelector(".sheet-back.slides").at() === 7), "a swipe the other way: back"); }
  else { await p.keyboard.press("ArrowLeft"); check(where, await until(p, () => document.querySelector(".sheet-back.slides").at() === 7), "←: back"); }
  await p.click(".ui-slides-next");

  // Themes: every theme a card; a tap wears it, on the host too.
  check(where, await until(p, () => document.querySelectorAll(".ui-slide-row .theme-card").length >= 10), "the themes slide: a card per theme");
  const before = await p.evaluate(() => ({ theme: app.view.look.theme, surface: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() }));
  const other = await p.evaluate((worn) => {
    const c = [...document.querySelectorAll(".ui-slide-row .theme-card")].find((x) => !x.classList.contains("on") && /Gruvbox|Nord|Catppuccin/.test(x.getAttribute("aria-label")));
    return c ? c.getAttribute("aria-label") : "";
  }, before.theme);
  check(where, await p.evaluate(() => document.querySelectorAll(".ui-slide-row .theme-card.on").length === 1), "  the one worn lit");
  // ‹ ›: a page of them along each, shown only while there's more that way;
  // the wheel scrolls them sideways too.
  const row = () => p.evaluate(() => {
    const r = document.querySelector(".ui-slide-row"), box = r.closest(".ui-scroll");
    return { left: r.scrollLeft, max: r.scrollWidth - r.clientWidth, prev: !box.querySelector(".ui-scroll-go.prev").hidden, next: !box.querySelector(".ui-scroll-go.next").hidden };
  });
  // (As it comes, the row puts the theme worn in its middle: after that, to its start.)
  await sleep(500);
  check(where, await p.evaluate(() => {
    const r = document.querySelector(".ui-slide-row"), on = r.querySelector(".theme-card.on").getBoundingClientRect(), box = r.getBoundingClientRect();
    return on.left >= box.left - 1 && on.right <= box.right + 1;
  }), "  the one worn in sight as it comes");
  await p.evaluate(() => { document.querySelector(".ui-slide-row").scrollLeft = 0; });
  await sleep(200);
  let r = await row();
  check(where, r.max > 0 && !r.prev && r.next, `  at their start: only › (${JSON.stringify(r)})`);
  await p.click(".ui-scroll-go.next");
  await sleep(700);
  const paged = await row();
  check(where, paged.left > 100 && paged.prev, `  ›: a page along, ‹ back (${paged.left}px)`);
  check(where, await at(p) === 8, "  and still the themes slide (not the next slide)");
  for (let i = 0; i < 12 && (await row()).next; i++) { await p.click(".ui-scroll-go.next"); await sleep(500); }
  r = await row();
  check(where, Math.abs(r.left - r.max) <= 2 && !r.next && r.prev, "  at their end: only ‹");
  await p.click(".ui-scroll-go.prev");
  await sleep(700);
  check(where, (await row()).left < r.left - 100, "  ‹: back a page");
  if (layout === "wide") {
    await p.evaluate(() => { document.querySelector(".ui-slide-row").scrollLeft = 0; });
    const box = await p.evaluate(() => { const b = document.querySelector(".ui-slide-row").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await p.mouse.move(box.x, box.y);
    await p.mouse.wheel(0, 300);
    await sleep(300);
    check(where, (await row()).left > 100, "  a mouse's wheel: sideways along them");
  }
  // The keys: along the cards (not the slides).
  await p.evaluate(() => document.querySelector(".ui-slide-row .theme-card").focus());
  await p.keyboard.press("ArrowRight");
  check(where, await p.evaluate(() => document.activeElement === document.querySelectorAll(".ui-slide-row .theme-card")[1]) && await at(p) === 8,
        "  → on a card: the next card, still the themes slide");
  await p.evaluate((name) => [...document.querySelectorAll(".ui-slide-row .theme-card")].find((x) => x.getAttribute("aria-label") === name).click(), other);
  check(where, await until(p, (b) => app.view.look.theme !== b, before.theme, 8000), `  tapped (${other}): worn`);
  check(where, await until(p, (s) => getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() !== s, before.surface, 8000),
        "  the page in its colors at once");
  check(where, await p.evaluate((name) => document.querySelector(".ui-slide-row .theme-card.on").getAttribute("aria-label") === name, other), "  and lit");
  const host = await p.evaluate(() => fetch("/api/look").then((r) => r.json()));
  check(where, host.theme === (await p.evaluate(() => app.view.look.theme)), "  kept on the host: every device wears it");
  await p.screenshot({ path: path.join(SHOTS, `${where}-tour-themes-picked.png`) });
  // The Look sheet over it, and back: the tour where it was.
  await p.evaluate(() => [...document.querySelectorAll(".ui-slide-actions .tbtn")].find((b) => /Theme, font/.test(b.innerText)).click());
  check(where, await until(p, () => !!document.querySelector(".sheet-back.look")), "Theme, font and wallpaper…: the Look sheet over it");
  await p.keyboard.press("Escape");
  check(where, await until(p, () => !document.querySelector(".sheet-back.look") && !document.querySelector(".sheet-back.slides").hidden && document.querySelector(".sheet-back.slides").at() === 8),
        "closed: the tour back, on its themes");
  // Put back as it was, for the other layout.
  await p.evaluate((t) => api("/api/look", { theme: t }).then(lookWorn), before.theme);

  // Let's go: closed, and seen on this device.
  await p.click(`.ui-slides-seg:nth-child(${SLIDES})`);
  await until(p, (n) => document.querySelector(".sheet-back.slides").at() === n - 1, SLIDES);
  await p.click(".ui-slides-next");
  check(where, await until(p, () => !document.querySelector(".sheet-back.slides")), "Let's go: closed");
  check(where, await p.evaluate(() => localStorage.getItem("tour") === "seen"), "  and seen on this device");
  await p.screenshot({ path: path.join(SHOTS, `${where}-welcome.png`) });
  check(where, await p.evaluate(() => [...document.querySelectorAll(".welcome .tbtn")].some((b) => /Take the tour/.test(b.innerText))), "the welcome: Take the tour");

  // Again: not by itself; the welcome's Take the tour, Esc, Settings, the menu.
  await p.reload();
  await until(p, () => window.app && app.view && !!document.querySelector(".welcome"));
  await sleep(1200);
  check(where, await p.evaluate(() => !document.querySelector(".sheet-back.slides")), "reloaded: it doesn't open by itself again");
  await p.evaluate(() => [...document.querySelectorAll(".welcome .tbtn")].find((b) => /Take the tour/.test(b.innerText)).click());
  check(where, await open(p) && (await at(p)) === 0, "Take the tour: from its first slide");
  await p.keyboard.press("Escape");
  check(where, await until(p, () => !document.querySelector(".sheet-back.slides")), "Esc: closed");
  await p.evaluate(() => openSettings());
  await until(p, () => !!document.querySelector(".sheet-back.settings"));
  check(where, await p.evaluate(() => {
    const b = [...document.querySelectorAll(".sheet-back.settings button")].find((x) => /Take the tour/.test(x.innerText));
    if (b) b.click();
    return !!b;
  }), "Settings: Take the tour");
  check(where, await open(p), "  it opens");
  await p.keyboard.press("Escape");
  await until(p, () => !document.querySelector(".sheet-back.slides"));
  await p.evaluate(() => closeSheets());
  check(where, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
  return seen;
}

// With chats: it doesn't open by itself; the Amarchy menu's Tour does, and
// its last slide starts a chat.
async function withChats(browser, port, layout) {
  const where = `${layout} with chats`;
  const p = await tv.page(browser, layout, port);
  await p.goto("/");
  await tv.ready(p);
  await sleep(1200);
  check(where, await p.evaluate(() => !document.querySelector(".sheet-back.slides") && !document.querySelector(".welcome")), "no tour by itself, no welcome");
  await p.click(".board-head .ui-brand");
  const menu = layout === "wide" ? ".picker" : ".sheet-back .ui-menu";
  check(where, await until(p, (m) => !!document.querySelector(m), menu), "the Amarchy menu");
  check(where, await p.evaluate((m) => {
    const b = [...document.querySelectorAll(`${m} button, ${m} .item, ${m} [role=option]`)].find((x) => /^Tour/.test(x.innerText.trim().replace(/^[^A-Za-z]+/, "")));
    if (b) b.click();
    return !!b;
  }, menu), "  its Tour");
  check(where, await open(p) && (await at(p)) === 0, "  the tour, from its first slide");
  await p.click(`.ui-slides-seg:nth-child(${SLIDES})`);
  await until(p, (n) => document.querySelector(".sheet-back.slides").at() === n - 1, SLIDES);
  const last = await slide(p);
  check(where, last.words.includes("Start a chat") && !last.words.includes("Add a project from GitHub"), "its last: Start a chat");
  await p.evaluate(() => [...document.querySelectorAll(".ui-slide-actions .tbtn")].find((b) => b.innerText === "Start a chat").click());
  check(where, await until(p, () => !document.querySelector(".sheet-back.slides")
    && (!!document.querySelector(".picker, .sheet-back .ui-menu") || !!document.querySelector(".board-new:not([hidden])"))), "  Start a chat: the tour goes, a new chat's project to pick");
  await p.screenshot({ path: path.join(SHOTS, `${where.replace(/ /g, "-")}-start.png`) });
  check(where, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

(async () => {
  const pw = tv.loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tour-view-home-"));
  const port = await tv.freePort();
  const server = await tv.startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: tv.findChrome() });
  const words = {};
  try {
    for (const layout of ["phone", "wide"]) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      words[layout] = await run(browser, port, layout).catch((e) => check(layout, false, `crashed: ${e.stack}`));
      await withChats(browser, port, layout).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
    if (words.phone && words.wide) {
      console.log("phone = wide");
      const say = (seen) => seen.map((s) => [s.kicker, s.title, ...s.words.filter((w) => !/^You're in/.test(w))].join(" | "));
      const a = say(words.phone), b = say(words.wide);
      a.forEach((x, i) => check("both", x === b[i], `slide ${i + 1}: the same words${x === b[i] ? "" : `\n    phone: ${x}\n    wide:  ${b[i]}`}`));
    }
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
