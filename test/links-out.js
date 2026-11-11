// Links out, in a browser: in a Mac's Dock app (Safari's Add to Dock) a link
// to another site is followed in place, never as a new window, because macOS
// gives the default browser only the first (a new window is a Safari one):
// a link clicked in the chat, and one opened by the app (a terminal's URL,
// a Preview). A page of the app's own still opens beside it. Anywhere else a
// link opens as a new tab, as it did.
//
//   node test/links-out.js
//
// Needs what test/today-view.js needs.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPlaywright, freePort, startServer, findChrome, page, ready, until, sleep, check, failures } = require("./today-view.js");

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Safari/605.1.15";
const OUT = "https://elsewhere.example/";

async function run(browser, port, mac) {
  const who = mac ? "mac dock app" : "elsewhere";
  const p = await page(browser, "wide", port);
  if (mac) await (await p.context().newCDPSession(p)).send("Emulation.setUserAgentOverride", { userAgent: MAC });
  const asked = [];      // every request for the other site: its page, and whether it's the app's own window going there
  await p.context().route(`${OUT}**`, (r) => {
    let inPlace = false;
    try { inPlace = r.request().isNavigationRequest() && r.request().frame() === p.mainFrame(); } catch (e) { /* a new window's: no frame yet */ }
    asked.push({ url: r.request().url(), inPlace });
    // In place: nothing to show, so the app stays where it is, as when macOS takes the link.
    if (inPlace) r.fulfill({ status: 204 }); else r.fulfill({ contentType: "text/html", body: "elsewhere" });
  });
  const popups = [];
  p.context().on("page", (x) => popups.push(x));
  await p.goto("/");
  await ready(p);
  await until(p, () => !!document.querySelector(".tcard"));
  check(who, await p.evaluate(() => macApp) === mac, mac ? "known as the Dock app" : "not taken for the Dock app");

  // A link in what Claude says: target="_blank", as the chat writes them.
  await p.evaluate((u) => {
    const a = document.createElement("a");
    Object.assign(a, { id: "out", href: `${u}clicked`, target: "_blank", rel: "noopener noreferrer", textContent: "a link out" });
    a.style.cssText = "position:fixed;left:8px;top:8px;z-index:99999;background:#fff;color:#000;padding:8px";
    document.body.append(a);
  }, OUT);
  await p.locator("#out").click({ noWaitAfter: true });
  await sleep(500);
  const clicked = asked.find((x) => x.url.endsWith("clicked"));
  if (mac) {
    check(who, !!clicked && clicked.inPlace, "a clicked link is followed in place");
    check(who, popups.length === 0, "and no new window is asked for");
  } else {
    check(who, popups.length === 1, "a clicked link opens a new tab");
    check(who, !clicked || !clicked.inPlace, "and the app doesn't go there");
  }
  check(who, await p.evaluate(() => !!document.querySelector(".tcard")), "the app is still there");

  // One the app opens: a terminal's URL, a Preview.
  const before = popups.length;
  await p.evaluate((u) => { document.body.addEventListener("click", () => openLink(`${u}opened`), { once: true }); }, OUT);
  await p.mouse.click(5, 400);
  await sleep(500);
  const opened = asked.find((x) => x.url.endsWith("opened"));
  if (mac) {
    check(who, !!opened && opened.inPlace, "a link the app opens is followed in place");
    check(who, popups.length === before, "and no new window is asked for");
  } else {
    check(who, popups.length === before + 1, "a link the app opens is a new tab");
  }

  // A page of the app's own (the one that starts a preview): beside the app, not in its place.
  const n = popups.length;
  await p.evaluate(() => { document.body.addEventListener("click", () => openLink("/preview.html?id=x", { here: true }), { once: true }); });
  await p.mouse.click(5, 400);
  await sleep(500);
  check(who, popups.length === n + 1 && await p.evaluate(() => location.pathname === "/"), "a page of the app's own opens beside it");
  check(who, p.errors.length === 0, `no errors${p.errors.length ? `: ${p.errors.join("; ")}` : ""}`);
  await p.context().close();
}

(async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "links-out-home-"));
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const mac of [true, false]) {
      console.log(mac ? "mac dock app" : "elsewhere");
      await run(browser, port, mac).catch((e) => check(mac ? "mac dock app" : "elsewhere", false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : "\nAll passed.");
  process.exit(failures.length ? 1 : 0);
})();
