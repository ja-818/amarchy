// The tour (app/tour.js: amarchy in 100 seconds), in a browser, on a phone
// and on a wide screen. An empty amarchy (no project, no chat) opened on a
// new device: the tour opens by itself over the welcome, once; Next, Back,
// the keys, a swipe and the bar's segments go along it; every slide has its
// pixel art, its words and fits the screen. It says why (a dozen Claude
// Codes), how (a website the box serves, over Tailscale), how to make it an
// app, and every feature (a few to a slide, each its picture, its joke and
// what it does), never how to install it; its themes slide wears a theme
// when tapped; its agents slide tells agents from projects and makes either
// (New agent…: its sheet); its last slide bursts and offers the way to start
// (a project with none, a chat with some); closed, it's seen: a reload
// doesn't bring it back, the welcome's Take the tour, Settings and the
// Amarchy menu's Tour do. The phone and the wide layouts have the same
// slides, word for word. With a screenshot of every slide in both layouts.
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
const homes = require("./homes");      // (test/homes.js: its home gone with it, however it ends)
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
    words: [...s.querySelectorAll(".ui-slide-line, .ui-slide-aside, .ui-slide-feat-title, .ui-slide-feat-text, .code code, .tpill, .tbtn")].map((x) => x.innerText.trim()).filter(Boolean),
    art: s.querySelectorAll(".ui-slide-art .ui-px svg rect, .ui-slide-art .ui-keycap").length,
    feats: [...s.querySelectorAll(".ui-slide-feat")].map((f) => ({ art: f.querySelectorAll(".ui-slide-feat-art .ui-px svg rect").length,
      title: f.querySelector(".ui-slide-feat-title").innerText.trim(), text: (f.querySelector(".ui-slide-feat-text") || {}).innerText || "",
      lined: Math.abs(f.querySelector(".ui-slide-feat-title").getBoundingClientRect().left - s.querySelector(".ui-slide-title").getBoundingClientRect().left) > 40 })),
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
  check(where, first.kicker.toLowerCase() === "amarchy in 100 seconds" && /Stop babysitting your agents\. Manage them\./.test(first.title), `its first, why: ${first.title}`);
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
    if (s.feats.length) {
      check(where, s.feats.length >= 2 && s.feats.length <= 3, `  ${s.feats.length} features`);
      check(where, s.feats.every((f) => f.art > 0 && f.title && f.text.length > 20), `  each its picture, its joke and what it does (${s.feats.map((f) => f.title).join(" / ")})`);
      check(where, s.feats.every((f) => f.lined), "  the words beside the pictures, in a column of their own");
    } else check(where, s.art > 0, `  its pixel art (${s.art} pixels)`);
    check(where, s.fits, "  it fits the screen, nothing to scroll");
    await p.screenshot({ path: path.join(SHOTS, `${where}-tour-${String(i + 1).padStart(2, "0")}.png`) });
  }
  // What it says: why, how (a website, over Tailscale), the Safari apps,
  // every feature, themes, agents and projects; not how to install it.
  const all = seen.map((s) => [s.title, ...s.words].join("\n")).join("\n");
  check(where, /website/.test(seen[1].words.join(" ")) && /Tailscale/.test(seen[1].words.join(" ")), "how it works: a website the box serves, over Tailscale");
  check(where, /Add to Home Screen/.test(all) && /Add to Dock/.test(all) && (all.match(/Safari/g) || []).length >= 2, "making it an app from Safari, on iPhone and Mac");
  check(where, !/install\.sh|amarchy app on|git clone/.test(all), "nothing on installing it");
  const features = { "touch grass": /touch grass/, worktree: /worktree/, "chats nap": /sleeps to free memory/, briefings: /Briefings/,
    dictation: /\bmic\b/, notifications: /notification/, "Ship it": /Ship it/, Preview: /Preview/, terminal: /terminal in your pocket/i,
    "Now · At work · For later": /At work[\s\S]*Now[\s\S]*For later/, Tasks: /Tasks[\s\S]*meeting recordings/, secrets: /Keys and passwords/,
    dopamine: /dopamine[\s\S]*40 badges/, keys: /Ctrl\+Alt[\s\S]*Esc[\s\S]*stops Claude/ };
  const missing = Object.entries(features).filter(([, re]) => !re.test(all)).map(([k]) => k);
  check(where, !missing.length, `every feature${missing.length ? `: missing ${missing.join(", ")}` : ""}`);
  check(where, /themes/i.test(all) && /Tokyo Night/.test(all), "the themes");
  const agents = seen[SLIDES - 2];
  check(where, agents.kicker.toLowerCase() === "make it yours" && /A project/.test(agents.words.join(" ")) && /An agent/.test(agents.words.join(" "))
        && agents.words.includes("New project…") && agents.words.includes("New agent…"), "agents and projects told apart, and New project…, New agent…");
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
    return { left: r.scrollLeft, max: r.scrollWidth - r.clientWidth, prev: !box.querySelector(".ui-scroll-go.prev").classList.contains("off"), next: !box.querySelector(".ui-scroll-go.next").classList.contains("off") };
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
  const placed = await p.evaluate(() => {
    const row = document.querySelector(".ui-slide-row").getBoundingClientRect();
    const [prev, next] = [".prev", ".next"].map((k) => document.querySelector(`.ui-scroll-go${k}`).getBoundingClientRect());
    const title = document.querySelector(".ui-slide-title").getBoundingClientRect();
    return { outside: prev.right <= row.left + 1 && next.left >= row.right - 1, square: [prev, next].every((b) => Math.abs(b.width - b.height) < 1 && b.width >= 30),
             column: Math.abs(row.left + 3 - title.left) <= 2 };
  });
  check(where, placed.outside, "  ‹ › outside the row, either side");
  check(where, placed.square, "  square buttons");
  if (layout === "wide") check(where, placed.column, "  the row as wide as the words, the arrows out in the margins");
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

  // Opened straight on the themes (before they've come): their count once they have.
  await p.evaluate(() => { closeSheets(); tourShow(8); });
  check(where, await until(p, () => /^\d+ themes$/.test((document.querySelector(".tour-themes-count") || {}).textContent || "")),
        "opened on the themes: how many, once they've come");
  await p.evaluate(() => closeSheets());
  await p.evaluate(() => tourShow(0));
  await open(p);

  // Agents and projects: New agent… — the tour goes, its sheet comes: what
  // it's called, its job, where it lives (a folder of its own, picked, named
  // after it), Make the agent.
  await p.click(`.ui-slides-seg:nth-child(${SLIDES - 1})`);
  await until(p, (n) => document.querySelector(".sheet-back.slides").at() === n - 2, SLIDES);
  await p.evaluate(() => [...document.querySelectorAll(".ui-slide-actions .tbtn")].find((b) => b.innerText === "New agent…").click());
  const sheetSel = ".sheet[aria-label='New agent']";
  check(where, await until(p, (q) => !document.querySelector(".sheet-back.slides") && !!document.querySelector(q), sheetSel), "New agent…: the tour goes, its sheet comes");
  const made = await p.evaluate((q) => {
    const s = document.querySelector(q);
    return { fields: s.querySelectorAll("input, textarea").length, own: (s.querySelector(".menu-item.on") || {}).innerText || "",
             make: [...s.querySelectorAll("button")].some((b) => b.innerText === "Make the agent") };
  }, sheetSel);
  check(where, made.fields === 2 && /A folder of its own/.test(made.own) && made.make,
        `  its name, its job, where it lives (a folder of its own, picked), Make the agent (${JSON.stringify(made)})`);
  await p.fill(`${sheetSel} input`, "Scout Bot");
  check(where, await until(p, (q) => /scout-bot/.test(document.querySelector(`${q} .menu-item.on`).innerText), sheetSel), "  its folder named after it");
  await sleep(400);
  await p.screenshot({ path: path.join(SHOTS, `${where}-new-agent.png`) });
  await p.evaluate(() => closeSheets());
  check(where, await until(p, (q) => !document.querySelector(q), sheetSel), "  closed");
  await p.evaluate(() => { newAgentSheet(); });
  await until(p, (q) => !!document.querySelector(q), sheetSel);
  await p.evaluate((q) => [...document.querySelectorAll(`${q} button`)].find((b) => b.innerText === "Make the agent").click(), sheetSel);
  check(where, await until(p, (q) => !!document.querySelector(q) && /called/.test((document.querySelector(".toast") || {}).innerText || ""), sheetSel),
        "  Make the agent with no name: asks what it's called, the sheet stays");
  await p.evaluate(() => closeSheets());
  await p.evaluate(() => tourShow(0));
  await open(p);

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
  const home = homes.home("tour-view");
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
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
