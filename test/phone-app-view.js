// The app inside the phone apps (phone/, the contract's "The phone apps and
// the push relay"), on the phone and on a tablet's wide screen alike: the
// page knows it's in the app (window.amarchyPhone) and is its home-screen
// app; notifications turned on through the app (its keys, the relay's
// endpoint), the server keeping the phone with what it is; turned off, taken
// off; the widget told what needs you, by name; a notification tapped opens
// its chat, at its card; a chat opened takes its notifications off the
// screen; Settings in the app's own words (answer from the notification, the
// share sheet is the phone's); a build with no relay says so. And on a
// phone's browser, Settings offers the app. With screenshots.
//
//   node test/phone-app-view.js          both layouts
//   node test/phone-app-view.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs. Exits 0 when every check passed.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPlaywright, freePort, startServer, findChrome, page, ready, until, sleep, check, failures } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "phone-app-view-"));
const ONLY = process.argv[2];

// The phone app's bridge, as phone/README.md has it: what the page asks is
// kept (window.__calls), push.state from what it was told, a subscription
// per push.subscribe (the relay's endpoint, numbered), kept across reloads.
function fakePhone() {
  const KEY = "test-phone";
  const kept = () => JSON.parse(localStorage.getItem(KEY) || "{}");
  const keep = (o) => localStorage.setItem(KEY, JSON.stringify({ ...kept(), ...o }));
  const b64u = (n) => btoa(String.fromCharCode(...new Uint8Array(n).fill(9))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  window.__calls = [];
  window.amarchyPhone = {
    version: "1.0 (1)", platform: "ios", relay: "https://relay.example",
    async call(command, args) {
      window.__calls.push({ command, args: args || null });
      const k = kept();
      if (command === "push.state") return k.unsupported ? "unsupported" : k.endpoint ? "on" : "off";
      if (command === "push.subscribe") {
        if (!args || typeof args.key !== "string" || args.key.length < 80) throw new Error("no machine key");
        const n = (k.n || 0) + 1;
        keep({ n, endpoint: `https://relay.example/v1/push/handle${n}` });
        return { endpoint: `https://relay.example/v1/push/handle${n}`, keys: { p256dh: b64u(65), auth: b64u(16) },
                 app: { platform: "ios", version: "1.0 (1)", device: "iPhone" } };
      }
      if (command === "push.unsubscribe") {
        const was = k.endpoint || null;
        keep({ endpoint: null });
        return was ? { endpoint: was } : null;
      }
      if (command === "notes.clear" || command === "status") return null;
      throw new Error(`unknown command ${command}`);
    },
  };
}

const calls = (p, command) => p.evaluate((c) => window.__calls.filter((x) => x.command === c), command);
const settingsText = (p) => p.evaluate(() => { const s = document.querySelector(".sheet-back.settings"); return s ? s.innerText : ""; });

async function inApp(browser, port, home, layout) {
  const appDir = path.join(home, "state", "amarchy", "app");
  const subs = () => { try { return JSON.parse(fs.readFileSync(path.join(appDir, "push.json"), "utf8")); } catch (e) { return []; } };
  fs.rmSync(path.join(appDir, "push.json"), { force: true });
  const p = await page(browser, layout, port, { notices: true });
  await p.addInitScript(fakePhone);
  await p.goto("/");
  await ready(p);
  await until(p, () => push.state !== null);
  await sleep(400);

  check(layout, await p.evaluate(() => standalone === true && phoneApp === window.amarchyPhone), "the page knows it's in the phone app, its home-screen app");
  check(layout, await until(p, () => /Notifications are off/.test((document.querySelector(".tcard.k-notice") || {}).innerText || "")),
        "notifications off: the home says so, as on the home screen");

  // The widget: what needs you, by name.
  const said = await until(p, () => window.__calls.some((c) => c.command === "status"));
  const status = (await calls(p, "status")).pop() || {};
  const names = ((status.args || {}).chats || []).map((c) => c.name);
  const count = await p.evaluate(() => todayCount(app.view, "chats") + app.view.sessions.reduce((n, s) => n + (isAgent(s) ? s.unread || 0 : 0), 0));
  check(layout, said && status.args.needs === count && count > 0, `the widget is told how many need you (${status.args && status.args.needs}, the board's ${count})`);
  check(layout, names.includes("Meta: verification") && names.length <= 4, `and the first of them by name (${names.join(", ")})`);
  const perm = ((status.args || {}).chats || []).find((c) => c.name === "Meta: verification") || {};
  check(layout, perm.key === "proj-perm" && perm.why === "Asks you", `each with its key and why (${JSON.stringify(perm)})`);
  const told = (await calls(p, "status")).length;
  await sleep(2500);
  check(layout, (await calls(p, "status")).length === told, "told again only when it changes, not each list");
  await p.screenshot({ path: path.join(SHOTS, `${layout}-home.png`) });

  // Turned on: through the app, the server keeps the phone with what it is.
  check(layout, await p.evaluate(() => {
    const b = [...document.querySelectorAll(".tcard.k-notice button.tbtn")].find((x) => x.innerText.trim() === "Turn on");
    if (b) b.click();
    return !!b;
  }), "Turn on: tapped");
  check(layout, await until(p, () => !document.querySelector(".tcard.k-notice")), "on: the card goes");
  const sub = await calls(p, "push.subscribe");
  check(layout, sub.length === 1 && sub[0].args.key === (await p.evaluate(() => app.key)), "the app made it, for this machine's key");
  const kept = subs().find((s) => s.endpoint === "https://relay.example/v1/push/handle1") || {};
  check(layout, kept.app && kept.app.platform === "ios" && kept.server === `https://127.0.0.1:${port}`,
        `the server keeps the phone, what it is and where its buttons go (${JSON.stringify(kept.app)}, ${kept.server})`);

  // Settings, in the app's words.
  await p.evaluate(() => openSettings());
  await until(p, () => /Notifications/.test((document.querySelector(".sheet-back.settings") || {}).innerText || ""));
  await sleep(500);
  let t = await settingsText(p);
  check(layout, /Answer from the notification itself/.test(t), "Settings: on, answered from the notification itself");
  check(layout, !/Home Screen/.test(t) && !/Shortcut/.test(t) && /in your phone's share sheet/.test(t),
        "never \"add it to your Home Screen\", no Shortcut to set up: the share sheet is the phone's");
  check(layout, !/The phone app/.test(t), "and no offer of the app, inside the app");
  await p.screenshot({ path: path.join(SHOTS, `${layout}-settings.png`) });

  // Off, from Settings: the app drops it, the server too.
  check(layout, await p.evaluate(() => {
    const b = [...document.querySelectorAll(".sheet-back.settings button")].find((x) => x.innerText.trim() === "Turn off");
    if (b) b.click();
    return !!b;
  }), "Turn off: tapped");
  check(layout, await until(p, () => window.__calls.some((c) => c.command === "push.unsubscribe")), "the app drops its subscription");
  await sleep(500);
  check(layout, !subs().some((s) => s.endpoint === "https://relay.example/v1/push/handle1"), "and the server forgets the phone");
  await p.evaluate(() => closeSheet());
  await sleep(300);

  // A notification tapped: its chat, at its card.
  await p.evaluate(() => {
    window.__asked = [];
    window.addEventListener("amarchy-ask", (e) => window.__asked.push(e.detail.id));
    window.dispatchEvent(new CustomEvent("amarchy-open", { detail: { go: "/#/s/proj-perm", ask: "proj-perm" } }));
  });
  check(layout, await until(p, () => here() === "#/s/proj-perm"), "a notification tapped: its chat opens");
  check(layout, await p.evaluate(() => window.__asked.includes("proj-perm")), "at its card");
  check(layout, await until(p, () => window.__calls.some((c) => c.command === "notes.clear" && c.args.tags.includes("proj-perm"))),
        "and its notifications go off the lock screen");
  await sleep(600);
  await p.screenshot({ path: path.join(SHOTS, `${layout}-opened.png`) });
  const shared = await p.evaluate(() => { window.dispatchEvent(new CustomEvent("amarchy-open", { detail: { share: true } })); return true; });
  check(layout, shared && !(await p.evaluate(() => document.querySelector(".sheet-back.share"))), "shared, nothing waiting on the server: no sheet");

  // A build with no relay: it says so.
  await p.evaluate(() => localStorage.setItem("test-phone", JSON.stringify({ unsupported: true })));
  await p.goto("/");
  await ready(p);
  await p.evaluate(() => openSettings());
  await until(p, () => /no way to send notifications/.test((document.querySelector(".sheet-back.settings") || {}).innerText || ""));
  t = await settingsText(p);
  check(layout, /no way to send notifications/.test(t) && !/Turn on notifications/.test(t), "a build with no relay: says it can't notify, no Turn on");
  check(layout, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

// A phone's browser (no app): Settings offers the app, on this machine.
async function inBrowser(browser, port, layout) {
  const p = await page(browser, layout, port);
  await p.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1" });
  });
  await p.goto("/");
  await ready(p);
  await p.evaluate(() => openSettings());
  await until(p, () => /Notifications/.test((document.querySelector(".sheet-back.settings") || {}).innerText || ""));
  await sleep(300);
  const t = await settingsText(p);
  if (layout === "phone") {
    check(layout, /The phone app/.test(t) && /Open in the app/.test(t), "a phone's browser: Settings offers the app");
    const href = await p.evaluate(() => {
      let got = null;
      const was = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { got = this.href; };
      [...document.querySelectorAll(".sheet-back.settings button")].find((x) => x.innerText.trim() === "Open in the app").click();
      HTMLAnchorElement.prototype.click = was;
      return got;
    });
    check(layout, href === `amarchy://open?server=${encodeURIComponent(`http://127.0.0.1:${port}`)}`, `on this machine (${href})`);
    await p.evaluate(() => { const s = [...document.querySelectorAll(".sheet-back.settings .section")].find((x) => /The phone app/.test(x.innerText)); if (s) s.scrollIntoView(); });
    await p.screenshot({ path: path.join(SHOTS, `${layout}-browser-settings.png`) });
  } else {
    check(layout, !/The phone app/.test(t), "a computer's wide layout: no offer of the phone app");
  }
  check(layout, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

(async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "phone-app-view-home-"));
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of ["phone", "wide"]) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      await inApp(browser, port, home, layout).catch((e) => check(layout, false, `crashed: ${e.stack}`));
      await inBrowser(browser, port, layout).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
