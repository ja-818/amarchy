// How a card shows its machine: the same board (your assistant, an agent,
// chats that ask you, chats on ja, one on a machine that's off) on the phone
// and on a computer, the machine's icon on the right by where the card
// stands (or its name: Show machines as names), over the open chat too.
// Screenshots to compare; checks that each card shows its own machine's
// icon there, named, the title cut short gracefully, an off machine's card
// "Off", and nothing on a board of one machine.
//
//   node test/machines-look.js            phone and wide
//   node test/machines-look.js phone      one layout
//
// Needs what test/today-view.js needs (Chromium, playwright-core).

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const homes = require("./homes");      // (test/homes.js: its home gone with it, however it ends)
const { loadPlaywright, freePort, startServer, findChrome, page, until, sleep, check, failures, T, NOW } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "machines-look-"));
const ONLY = process.argv[2];

const MACHINES = [
  { name: "amarchy", label: "amarchy", icon: "cloud", me: true, on: true, seen: true, projects: [] },
  { name: "ja", label: "ja", icon: "laptop", me: false, on: true, seen: true, projects: [] },
  { name: "studio", label: "studio", icon: "tower", me: false, on: false, seen: true, since: NOW - 3600, projects: [] },
];

const CHATS = [
  { id: "me-jaken", machine: "amarchy", repo: "me", name: "jaken", task: "Jaken", status: "idle", engine: "chat", path: "/tmp/j", assistant: "main", assistant_name: "Jaken",
    said: "Jaken's verdict: if you want your Mac and iPhone bookmarks and passwords in Omarchy, use a password manager.", said_at: NOW - 300, unread: 5, today: T({}) },
  { id: "fire-ship", machine: "amarchy", repo: "fireship", name: "ship", task: "Fireship", status: "idle", engine: "chat", path: "/tmp/f", assistant: "agent", assistant_name: "Fireship",
    said: "Heads-up: your /tmp quota is full, and it just broke one of my commands.", said_at: NOW - 3900, unread: 9, today: T({}) },
  { id: "amarchy-plan", machine: "amarchy", repo: "amarchy", name: "plan", task: "Plan: remote and local", status: "idle", engine: "chat", path: "/tmp/p",
    today: T({ goal: "Plan the remote", state: "waiting", asks: [{ question: "Publish amarchy for other Omarchy users?", options: [{ label: "Yes, publish", send: "Yes" }, { label: "Not yet", send: "Not yet" }] }] }) },
  { id: "amarchy-greet", machine: "ja", repo: "amarchy", name: "greet", task: "Greeting: phone session", status: "idle", unseen: true, engine: "chat", path: "/tmp/g",
    today: T({ state: "waiting", asks: [{ question: "What should this chat work on?", options: [{ label: "Recent changes", send: "a" }, { label: "Other chats", send: "b" }, { label: "Just testing", send: "c" }] }] }) },
  { id: "omarchy-j716s", machine: "amarchy", repo: "omarchy-j716s", name: "j716s", task: "Omarchy: J716s test setup", status: "idle", unseen: true, engine: "chat", path: "/tmp/o",
    said: "Audio step 1 is ready: headphone jack, microphones and the light sensor.", today: T({ goal: "Get Omarchy running natively on the J716s" }) },
  { id: "amarchy-webkit", machine: "amarchy", repo: "amarchy", name: "webkit", task: "WebKit: WebKitGTK spike", status: "idle", engine: "chat", path: "/tmp/w",
    merged: { n: 9, at: NOW - 600 }, today: T({ goal: "Decide on WebKitGTK", state: "done" }) },
  { id: "docs-guide", machine: "studio", machine_off: true, repo: "docs", name: "guide", task: "Docs: the guide", status: "idle", engine: "chat", path: "/tmp/d",
    today: T({ goal: "Write the guide" }) },
  { id: "amarchy-work", machine: "ja", repo: "amarchy", name: "work", task: "Build: the board", status: "working", engine: "chat", path: "/tmp/b", today: T({ goal: "Make the board" }) },
];

const LAYOUTS = { phone: { viewport: { width: 390, height: 844 } }, wide: { viewport: { width: 1280, height: 900 } } };

(async () => {
  const pw = loadPlaywright();
  const port = await freePort();
  const home = homes.home("machines-look");
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const at of ["side"]) {
      for (const layout of Object.keys(LAYOUTS)) {
        if (ONLY && ONLY !== layout) continue;
        for (const as of ["icon", "name"]) {
          const where = `${layout}${as === "name" ? " by name" : ""}`;
          const p = await page(browser, layout, port, { chats: CHATS });
          await p.addInitScript(({ machines, at, as }) => {
            const parse = JSON.parse;
            JSON.parse = function (text, ...rest) {
              const v = parse.call(this, text, ...rest);
              if (v && typeof v === "object" && Array.isArray(v.sessions) && "share" in v) {
                v.machine = "amarchy";
                v.machines = machines;
                v.machines_as = as;
                v.projects = [{ name: "amarchy", sessions: 3 }, { name: "me", sessions: 1 }];
              }
              return v;
            };
          }, { machines: MACHINES, at, as });
          await p.goto("/");
          await until(p, () => document.querySelectorAll(".tcard[data-id]").length >= 6, null, 10000);
          await p.evaluate(() => { for (const d of document.querySelectorAll("details.today-working, details.today-forlater")) d.open = true; });
          await sleep(500);
          const marks = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".tcard[data-id]")].map((c) => {
            const m = c.querySelector(".ui-machine");
            return [c.dataset.id, m ? { label: m.getAttribute("aria-label"), icon: (m.querySelector(".glyph svg") ? "svg" : ""), text: m.textContent.trim(),
                                         in: m.closest(".tcard-side-one, .tcard-side-top") ? "side" : "elsewhere" } : null];
          })));
          const want = "side";
          check(where, marks["ja:amarchy-greet"] && marks["ja:amarchy-greet"].label === "On ja", `ja's chat says it's on ja (${JSON.stringify(marks["ja:amarchy-greet"])})`);
          check(where, Object.entries(marks).every(([k, m]) => m && m.in === want), `every card's machine is ${want} (${JSON.stringify(Object.fromEntries(Object.entries(marks).map(([k, m]) => [k, m && m.in])))})`);
          check(where, as === "name" ? marks["ja:amarchy-greet"].text === "ja" && !marks["ja:amarchy-greet"].icon : marks["ja:amarchy-greet"].icon === "svg" && !marks["ja:amarchy-greet"].text,
                as === "name" ? "by name: its name, no icon" : "by icon: its icon, its name only as its label");
          check(where, /studio is off/.test(marks["studio:docs-guide"] && marks["studio:docs-guide"].label), "the one on studio: studio is off");
          const icons = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".tcard[data-id] .ui-machine")].map((m) => [m.closest(".tcard").dataset.id, m.dataset.icon])));
          check(where, icons["omarchy-j716s"] === "cloud" && icons["amarchy-plan"] === "cloud" && icons["ja:amarchy-greet"] === "laptop" && icons["studio:docs-guide"] === "tower",
                `each its own machine's icon: the server's chats the cloud, ja's the laptop (${JSON.stringify(icons)})`);
          const fit = await p.evaluate(() => [...document.querySelectorAll(".tcard[data-id]")].every((c) => c.scrollWidth <= c.clientWidth + 1
            && (!c.querySelector(".tcard-title .task") || getComputedStyle(c.querySelector(".tcard-title .task")).textOverflow === "ellipsis")));
          check(where, fit, "every card in its width, a long title cut short with …");
          const shot = `${layout}${as === "name" ? "-name" : ""}`;
          await p.screenshot({ path: path.join(SHOTS, `${shot}.png`) });
          // Then lower: the chats on ja, and the one on studio (off).
          await p.evaluate(() => { const c = document.querySelector('.tcard[data-id="ja:amarchy-greet"]'); if (c) c.scrollIntoView({ block: "start" }); });
          await sleep(300);
          await p.screenshot({ path: path.join(SHOTS, `${shot}-lower.png`) });
          // Over the chat: its machine by where it stands, as on its card.
          await p.evaluate(() => go2("ja:amarchy-greet"));
          const head = await until(p, () => { const m = document.querySelector(".chat-head .head-btns .ui-machine"); return m && m.dataset.icon === "laptop"; }, null, 8000);
          check(where, head, "the open chat's head: ja's laptop, by its state");
          await sleep(400);
          await p.screenshot({ path: path.join(SHOTS, `${shot}-chat.png`) });
          await p.context().close();
        }
      }
    }
    // One machine: nothing of it, anywhere.
    const p = await page(browser, "wide", port, { chats: CHATS.filter((c) => c.machine === "amarchy") });
    await p.addInitScript(({ machines }) => {
      const parse = JSON.parse;
      JSON.parse = function (text, ...rest) { const v = parse.call(this, text, ...rest); if (v && Array.isArray(v.sessions) && "share" in v) { v.machine = "amarchy"; v.machines = machines; } return v; };
    }, { machines: MACHINES.slice(0, 1) });
    await p.goto("/");
    await until(p, () => document.querySelectorAll(".tcard[data-id]").length >= 3, null, 10000);
    check("one machine", await p.evaluate(() => !document.querySelector(".ui-machine")), "no machine on any card");
    await p.context().close();
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\nscreenshots: ${SHOTS}`);
  console.log(failures.length ? `${failures.length} failed` : "all passed");
  process.exit(failures.length ? 1 : 0);
})();
