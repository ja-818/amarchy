// A chat's preview beside it, in a browser, both layouts. On a computer: the
// chat's Preview (over it) opens the side panel's Preview tab, half the
// window, the chat still readable beside it, its page loaded in a frame; lit
// while it's there, a tap again closes it; Ctrl+Alt+O the same. Its page
// stays loaded (the same page, nothing reloaded) through another tab,
// another chat and the board; Reload loads it again, Open in a tab opens
// it. Several: a picker in its bar, the one shown checked, each kept loaded.
// Not running: Start it starts it there, Starting…, then its page. Failed:
// why. Nothing answering: Ask Claude. A page that won't be shown in another's
// (as the server read it): says so, Open in a tab, Ask Claude to allow it.
// The desktop app from before (no frames): says so; one that frames only
// the tailnet's: a deploy's opens in a tab. With Show terminals off, the
// same. On the phone: Chat | Preview, as Chat | Terminal: the Preview over
// the chat opens it under the head, Back (or a tap again) the chat, and its
// page is the same page coming back to it, from the chat or the board. With
// screenshots. One at the app's own address: never in a frame.
//
//   node test/preview-pane-view.js          both layouts
//   node test/preview-pane-view.js phone    one layout (phone | wide)

"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const homes = require("./homes");      // (test/homes.js: its home gone with it, however it ends)
const { loadPlaywright, freePort, startServer, findChrome, page, ready, until, sleep, check, failures, T } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "preview-pane-view-"));
const ONLY = process.argv[2];

// The pages it frames: each says which it is, and a number made as it
// loads (the same number: it wasn't loaded again), and counts taps.
const PAGE = (name) => `<!doctype html><meta charset="utf-8"><title>${name}</title>
<style>body{font:16px system-ui;margin:24px;background:#fafafa;color:#111}</style>
<h1 id="name">${name}</h1><p>Loaded as <b id="load"></b></p><button id="tap">Tap</button> <span id="taps">0</span>
<script>document.getElementById("load").textContent = String(Math.random()).slice(2, 10);
document.getElementById("tap").onclick = () => { const t = document.getElementById("taps"); t.textContent = String(+t.textContent + 1); };</script>`;

function pages() {
  return new Promise((ok) => {
    const srv = http.createServer((req, res) => {
      const name = req.url.split("?")[0].replace(/^\//, "") || "studio";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(PAGE(name));
    });
    srv.listen(0, "127.0.0.1", () => ok(srv));
  });
}

async function run(browser, port, layout, base) {
  // (OTHER at another name than the app's: a deploy's, to a desktop app that frames only the tailnet's.)
  const STUDIO = `${base}/studio`, APP = `${base}/app`, BOOK = `${base}/storybook`, OTHER = `${base.replace("127.0.0.1", "localhost")}/other`, NOPE = `${base}/nope`;
  const chat = (id, task, previews) => ({ id, repo: "proj", name: id.split("-")[1], task, status: "idle", engine: "chat", path: "/tmp/x", today: T({}), previews });
  const one = (url, extra) => [{ key: "", label: url.replace(/^https?:\/\//, ""), url, run: "python3 serve.py", ...extra }];
  const chats = [
    chat("proj-studio", "SVG: style rounds", one(STUDIO, { state: "up" })),
    chat("proj-other", "Fix: login loop", one(OTHER, { state: "up" })),
    chat("proj-two", "Study: T3 vs amarchy", [{ key: "", name: "App", label: "App", url: APP, run: "pnpm dev", state: "up" },
                                              { key: "storybook", name: "Storybook", label: "Storybook", url: BOOK, run: "pnpm storybook", state: "up" }]),
    chat("proj-stopped", "Refund: old order", one(`${base}/stopped`, { state: "stopped" })),
    chat("proj-failed", "Eval: json-render", one(`${base}/failed`, { state: "failed" })),
    chat("proj-down", "Docs: the guide", [{ key: "", label: "amarchy:5176", url: `${base}/down`, state: "down" }]),
    chat("proj-nope", "Deploy: site", one(NOPE, { state: "up" })),
    chat("proj-none", "Plain: no preview", []),
    chat("proj-own", "Odd: the app itself", [{ key: "", label: "127.0.0.1", url: `http://127.0.0.1:${port}/`, state: "up" }]),
  ];
  const p = await page(browser, layout, port, { chats });
  const opened = [];
  // What the server reads of each page's answer (bin/amarchy preview_frame; test/preview.py has it for real).
  await p.route("**/api/session/*/preview/frame*", (r) => r.fulfill({ json: /proj-nope/.test(r.request().url())
    ? { frame: false, why: "it sends X-Frame-Options: DENY" } : { frame: true } }));
  const starts = [];
  await p.route("**/api/session/proj-stopped/preview", (r) => { starts.push(r.request().postDataJSON()); r.fulfill({ json: { preview: {} } }); });
  await p.goto("/");
  await ready(p);
  await p.evaluate(() => { window.__opened = []; openLink = (u) => window.__opened.push(u); });
  const wide = layout === "wide";
  const stands = (id, state, key = "") => p.evaluate(({ id, state, key }) => {
    ahead.clear();
    window.__rows = window.__rows || {};
    const s = rowOf(id);
    const previews = s.previews.map((x) => ((x.key || "") === key ? { ...x, state } : { ...x }));
    window.__rows[id] = { previews };
    app.view = { ...app.view, sessions: app.view.sessions.map((c) => (c.id === id ? { ...c, previews } : c)) };
    refresh();
  }, { id, state, key });
  const pane = () => (wide ? ".sidepanel .preview-pane" : "body > .preview-pane.phone");
  const frameOf = (url) => p.frameLocator(`${pane()} iframe.preview-frame[src="${url}"]`);
  const loadNo = async (url) => { try { return await frameOf(url).locator("#load").innerText({ timeout: 6000 }); } catch (e) { return ""; } };
  const headBtn = () => p.locator(".head-btns .ui-preview").filter({ visible: true });
  const open = async (id) => { await p.evaluate((id) => todayOpen(rowOf(id)), id); await until(p, (id) => (window.desk && desk.current === id) || (app.session && app.session.id === id), id); };

  // ---- one preview: the chat's Preview shows it beside (over) the chat
  await open("proj-studio");
  check(layout, await until(p, () => [...document.querySelectorAll(".head-btns .ui-preview")].some((b) => b.offsetParent && b.getAttribute("aria-label") === "Preview" && b.getAttribute("aria-pressed") === "false")),
        "over the chat: Preview, not pressed");
  await headBtn().click();
  check(layout, await until(p, (s) => { const el = document.querySelector(s); return el && !el.hidden && el.getClientRects().length > 0; }, pane()), wide ? "a tap: the side panel's Preview" : "a tap: Chat | Preview, under the head");
  const first = await loadNo(STUDIO);
  check(layout, /^\d+$/.test(first), `its page, in a frame (loaded as ${first})`);
  check(layout, await p.evaluate(() => [...document.querySelectorAll(".head-btns .ui-preview")].some((b) => b.offsetParent && b.getAttribute("aria-pressed") === "true" && b.matches(".on"))),
        "and the button is lit");
  check(layout, !opened.length && await p.evaluate(() => !window.__opened.length), "nothing opened in a tab");
  check(layout, await p.evaluate((s) => /studio$/.test(document.querySelector(`${s} .preview-where`).innerText), pane()), "its bar says where it is");
  if (wide) {
    const sizes = await p.evaluate(() => ({ side: document.querySelector(".sidepanel").getBoundingClientRect().width, chat: document.querySelector(".column").getBoundingClientRect().width,
                                            tab: [...document.querySelectorAll(".side-tab")].map((t) => `${t.innerText}${t.matches(".on") ? "*" : ""}`).join(" ") }));
    check(layout, Math.abs(sizes.side - 640) < 4 && sizes.chat >= 600, `half the window, the chat readable beside it (${Math.round(sizes.side)} | ${Math.round(sizes.chat)})`);
    check(layout, /Preview\*/.test(sizes.tab), `its tab, on (${sizes.tab})`);
  } else {
    check(layout, await p.evaluate(() => document.querySelector(".view .chat").hidden && app.session.mode === "preview"), "the chat out of the way");
    const top = await p.evaluate(() => [document.querySelector("body > .preview-pane").getBoundingClientRect().top, document.querySelector(".phone-head").getBoundingClientRect().bottom]);
    check(layout, Math.abs(top[0] - top[1]) < 2, `right under the head (${top.join(" / ")})`);
  }
  await frameOf(STUDIO).locator("#tap").click();
  await frameOf(STUDIO).locator("#tap").click();
  await sleep(600);
  await p.screenshot({ path: path.join(SHOTS, `${layout}-preview.png`) });

  // It stays loaded: another tab (the chat), another chat, the board.
  if (wide) {
    await p.evaluate(() => sideToggle("changes", true));
    check(layout, await until(p, () => document.querySelector(".sidepanel .preview-pane").hidden), "another tab: it's out of sight");
    check(layout, await p.evaluate((u) => !!document.querySelector(`.sidepanel iframe[src="${u}"]`), STUDIO), "its page still in the page");
    await p.evaluate(() => deskPreview());
  } else {
    await p.locator(".phone-head .board-back").click();
    check(layout, await until(p, () => app.session.mode === "chat" && !document.querySelector(".view .chat").hidden && document.querySelector("body > .preview-pane").hidden), "Back: the chat");
    await headBtn().click();
  }
  check(layout, await loadNo(STUDIO) === first && await frameOf(STUDIO).locator("#taps").innerText() === "2", "back on it: the same page, as you left it (not loaded again)");
  await open("proj-other");
  if (wide) check(layout, await until(p, (u) => !!document.querySelector(`.sidepanel iframe[src="${u}"]:not([hidden])`), OTHER), "another chat: the Preview stays, with its page");
  else { await headBtn().click(); }
  const other = await loadNo(OTHER);
  check(layout, /^\d+$/.test(other) && other !== first, "its own page");
  await open("proj-studio");
  if (!wide) await headBtn().click();
  check(layout, await loadNo(STUDIO) === first && await frameOf(STUDIO).locator("#taps").innerText() === "2", "back on the first chat: its page as it was");
  await p.evaluate(() => (window.desk && desk.current ? boardBack() : go("#/")));
  await until(p, () => !(window.desk && desk.current) && !app.session);
  await open("proj-studio");
  if (!wide) await headBtn().click();
  check(layout, await loadNo(STUDIO) === first, "from the board and back: the same page still");
  check(layout, await p.evaluate((s) => document.querySelectorAll(`${s} iframe`).length === 2, pane()), "each chat's page kept, one frame each");

  // Reload, Open in a tab.
  await p.locator(`${pane()} .preview-bar .ui-tool[aria-label="Reload it"]`).click();
  await sleep(300);
  const again = await loadNo(STUDIO);
  check(layout, /^\d+$/.test(again) && again !== first && await frameOf(STUDIO).locator("#taps").innerText() === "0", "Reload: loaded again");
  await p.locator(`${pane()} .preview-bar .ui-tool[aria-label="Open in a tab"]`).click();
  check(layout, await until(p, (u) => window.__opened.includes(u), STUDIO), "Open in a tab: its address, in a tab");

  // A tap again on the chat's Preview: the chat alone (Ctrl+Alt+O too, on a computer).
  await headBtn().click();
  check(layout, await until(p, (s) => document.querySelector(s).hidden, pane()), "a tap again: back to the chat alone");
  if (wide) {
    check(layout, await p.evaluate(() => !document.querySelector(".desk-root").classList.contains("side-open")), "the panel closed");
    await p.keyboard.press("Control+Alt+KeyO");
    check(layout, await until(p, () => !document.querySelector(".sidepanel .preview-pane").hidden && document.querySelector(".desk-root").classList.contains("side-open")), "Ctrl+Alt+O: the Preview");
    check(layout, await loadNo(STUDIO) === again, "its page as it was");
    await p.keyboard.press("Control+Alt+KeyO");
    check(layout, await until(p, () => !document.querySelector(".desk-root").classList.contains("side-open")), "Ctrl+Alt+O again: closed");
  }

  // ---- several: the one you pick, each kept
  await open("proj-two");
  check(layout, await until(p, () => [...document.querySelectorAll(".head-btns .ui-previews")].some((b) => b.offsetParent)), "several: Previews ▾ over the chat");
  await p.locator(".head-btns .ui-previews").filter({ visible: true }).click();
  const rows = await p.evaluate(() => [...document.querySelectorAll(".ui-dropdown .ui-drop-row")].map((r) => r.innerText.replace(/\s+/g, " ").trim()));
  check(layout, rows.length === 2 && /^App Show it/.test(rows[0]) && /^Storybook Show it/.test(rows[1]), `its dropdown: each, to show beside the chat (${rows.join(" | ")})`);
  await p.locator(".ui-dropdown .ui-drop-row").nth(1).click();
  check(layout, /^\d+$/.test(await loadNo(BOOK)), "Storybook: its page");
  const which = await p.evaluate((s) => { const b = document.querySelector(`${s} .preview-which`); return b && b.innerText.trim(); }, pane());
  check(layout, which === "Storybook", `the bar's picker names it (${which})`);
  const book = await loadNo(BOOK);
  await p.locator(`${pane()} .preview-which`).click();
  const picks = await p.evaluate(() => [...document.querySelectorAll(".ui-dropdown .ui-drop-row")].map((r) => `${r.innerText.split("\n")[0]}${r.matches(".on") ? "*" : ""}`));
  check(layout, picks.join(" ") === "App Storybook*", `its picker: the one shown checked (${picks.join(" ")})`);
  await p.locator(".ui-dropdown .ui-drop-row").first().click();
  const app1 = await loadNo(APP);
  check(layout, /^\d+$/.test(app1), "App: its page");
  await p.locator(`${pane()} .preview-which`).click();
  await p.locator(".ui-dropdown .ui-drop-row").nth(1).click();
  check(layout, await loadNo(BOOK) === book, "back on Storybook: as it was");
  await sleep(400);
  await p.screenshot({ path: path.join(SHOTS, `${layout}-previews.png`) });
  if (!wide) {
    await open("proj-studio");
    await headBtn().click();
    await until(p, (u) => !!document.querySelector(`body > .preview-pane iframe[src="${u}"]:not([hidden])`), STUDIO);
    check(layout, await p.evaluate(() => document.querySelectorAll("body > .preview-pane iframe").length <= 2), "the phone keeps two at most");
  }

  // ---- not running: Start it, there
  await open("proj-stopped");
  if (wide) await p.evaluate(() => deskPreview());
  else await p.evaluate(() => app.session.setMode("preview"));
  const card = (s) => p.evaluate((s) => { const c = document.querySelector(`${s} .preview-card`); return c && !c.hidden ? c.innerText.replace(/\s+/g, " ").trim() : ""; }, s);
  check(layout, await until(p, (s) => { const c = document.querySelector(`${s} .preview-card`); return c && !c.hidden && /Not running/.test(c.innerText) && /Start it/.test(c.innerText); }, pane()),
        `not running: says so, Start it (${await card(pane())})`);
  await p.screenshot({ path: path.join(SHOTS, `${layout}-stopped.png`) });
  await p.locator(`${pane()} .preview-card button`, { hasText: "Start it" }).click();
  check(layout, await until(p, () => true) && starts.length === 1 && starts[0].action === "start", "it starts it");
  check(layout, await until(p, (s) => /Starting…/.test(document.querySelector(`${s} .preview-card`).innerText) && !!document.querySelector(`${s} .preview-card .spinner`), pane()), "Starting…, turning");
  await stands("proj-stopped", "starting");
  await stands("proj-stopped", "up");
  check(layout, /^\d+$/.test(await loadNo(`${base}/stopped`)), "it answers: its page");
  check(layout, await p.evaluate(() => !document.querySelector(".toast.act")), "no toast: it's in sight");
  // Its server stops (unused): what it says; back up, its page loaded again.
  const was = await loadNo(`${base}/stopped`);
  await stands("proj-stopped", "stopped");
  check(layout, await until(p, (s) => /Not running/.test(document.querySelector(`${s} .preview-card`).innerText), pane()), "it stops: Not running again");
  await stands("proj-stopped", "up");
  const now = await loadNo(`${base}/stopped`);
  check(layout, /^\d+$/.test(now) && now !== was, "back up: its page loaded anew");

  // ---- failed, nothing answering, a page that says no
  await open("proj-failed");
  if (wide) await p.evaluate(() => deskPreview()); else await headBtn().click();
  check(layout, await until(p, (s) => { const c = document.querySelector(`${s} .preview-card`); return c && !c.hidden && /stopped with an error/.test(c.innerText) && /See why/.test(c.innerText) && /Try again/.test(c.innerText); }, pane()),
        "failed: says so, See why, Try again");
  await open("proj-down");
  if (wide) await p.evaluate(() => deskPreview()); else await p.evaluate(() => app.session.setMode("preview"));
  check(layout, await until(p, (s) => { const c = document.querySelector(`${s} .preview-card`); return c && !c.hidden && /Not answering/.test(c.innerText); }, pane()), "an address only, nothing answering: says so");
  await p.locator(`${pane()} .preview-card button`).click();
  await sleep(200);
  const asks = p.posts.filter((x) => /proj-down\/send/.test(x.url));
  check(layout, asks.length === 1 && /isn't answering: start it again/.test(asks[0].body.text), "Ask Claude to start it: asked, once");
  check(layout, await until(p, (s) => /Asked Claude/.test(document.querySelector(`${s} .preview-card`).innerText), pane()), "and it says so");
  await open("proj-nope");
  if (wide) await p.evaluate(() => deskPreview()); else await headBtn().click();
  check(layout, await until(p, (s) => { const c = document.querySelector(`${s} .preview-card`); return c && !c.hidden && /won't show inside amarchy/.test(c.innerText) && /X-Frame-Options: DENY/.test(c.innerText); }, pane()),
        `a page that says no: says so, and why (${await card(pane())})`);
  check(layout, await p.evaluate((u) => !document.querySelector(`iframe[src="${u}"]`), NOPE), "no frame left blank for it");
  await p.screenshot({ path: path.join(SHOTS, `${layout}-refused.png`) });
  await p.evaluate(() => { window.__opened.length = 0; });
  await p.locator(`${pane()} .preview-card button`, { hasText: "Open in a tab" }).click();
  check(layout, await until(p, (u) => window.__opened.includes(u), NOPE), "Open in a tab");
  await p.locator(`${pane()} .preview-card button`, { hasText: "Ask Claude to allow it" }).click();
  await sleep(200);
  const allow = p.posts.filter((x) => /proj-nope\/send/.test(x.url));
  check(layout, allow.length === 1 && /frame-ancestors/.test(allow[0].body.text) && allow[0].body.text.includes(await p.evaluate(() => location.origin)), "Ask Claude to allow it: for this app's address");

  // At the app's own address: never in a frame (it would be the app's own).
  await open("proj-own");
  if (wide) await p.evaluate(() => deskPreview()); else await headBtn().click();
  check(layout, await until(p, (s) => { const c = document.querySelector(`${s} .preview-card`); return c && !c.hidden && /this app's own address/.test(c.innerText); }, pane())
        && await p.evaluate((port) => ![...document.querySelectorAll("iframe")].some((f) => f.src.startsWith(`http://127.0.0.1:${port}`)), port), "at the app's own address: no frame, says why");

  // ---- the desktop app: from before (no frames), or one that frames only the tailnet's
  await open("proj-other");
  if (wide) await p.evaluate(() => deskPreview()); else await headBtn().click();
  await p.evaluate(() => { window.amarchyDesktop = { version: "0", platform: "linux" }; previewRefresh(); });
  check(layout, await until(p, (s) => /from before previews could show here/.test(document.querySelector(`${s} .preview-card`).innerText), pane()), "the desktop app from before: says so");
  await p.evaluate(() => { window.amarchyDesktop = { frames: "tailnet" }; previewRefresh(); });
  check(layout, await until(p, (s) => /only your tailnet's previews/.test(document.querySelector(`${s} .preview-card`).innerText), pane()), "one that frames the tailnet's: a deploy's, in a tab");
  await p.evaluate(() => { window.amarchyDesktop = { frames: "any" }; previewRefresh(); });
  check(layout, await until(p, (s) => document.querySelector(`${s} .preview-card`).hidden, pane()) && /^\d+$/.test(await loadNo(OTHER)), "one that frames any: its page");
  await p.evaluate(() => { delete window.amarchyDesktop; });

  // ---- Show terminals off: the same
  await p.evaluate(() => { app.view = { ...app.view, show_terminals: false }; refresh(); });
  await open("proj-studio");
  if (wide) {
    check(layout, await until(p, () => [...document.querySelectorAll(".side-tab")].map((t) => t.innerText).join(" ") === "Preview Changes Details"), "terminals off: Preview, Changes, Details");
  }
  if (wide) await p.evaluate(() => sideToggle(null));
  else await p.evaluate(() => app.session.setMode("chat"));
  await headBtn().click();
  check(layout, /^\d+$/.test(await loadNo(STUDIO)), "and its Preview shows it all the same");
  if (wide) {
    // A chat with none: no Preview tab; the panel left on Preview closes for it.
    await open("proj-none");
    check(layout, await until(p, () => ![...document.querySelectorAll(".side-tab")].some((t) => /Preview/.test(t.innerText)) && !document.querySelector(".desk-root").classList.contains("side-open")),
          "a chat with none: no Preview tab, the panel closed");
    await open("proj-studio");
    check(layout, await until(p, () => !document.querySelector(".sidepanel .preview-pane").hidden), "back on one with: its Preview again");
  }
  await p.evaluate(() => { app.view = { ...app.view, show_terminals: true }; refresh(); });
  check(layout, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

(async () => {
  const pw = loadPlaywright();
  const home = homes.home("preview-pane-view");
  const port = await freePort();
  const server = await startServer(port, home);
  const srv = await pages();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of ["phone", "wide"]) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      await run(browser, port, layout, base).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    server.kill();
    srv.close();
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
