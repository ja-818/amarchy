// Notifications that stopped reaching this device, said on the home, on the
// phone and on a computer alike: off (never decided, or on before and
// dropped since), a card above your chats with Turn on and Not now; turned
// on, it goes and the server has the device; a subscription its push service
// ended is made again by itself when the app opens; one the browser dropped
// brings the card back; Not now keeps it away. And the server's log says
// when a device is added, turned off or dropped. With screenshots.
//
//   node test/push-notice.js          both layouts
//   node test/push-notice.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs. Exits 0 when every check passed.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPlaywright, freePort, startServer, findChrome, page, ready, until, sleep, check, failures } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "push-notice-"));
const ONLY = process.argv[2];
const NOTICE = ".tcard.k-notice";

// The browser's push, as a device that has it: a subscription per subscribe()
// (its endpoint numbered), kept across reloads, dropped when the test says so.
function fakePush() {
  const KEY = "test-push";
  const b64u = (n) => btoa(String.fromCharCode(...new Uint8Array(n).fill(7))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sub = (n, key) => ({
    endpoint: `https://push.example/${n}`,
    options: { applicationServerKey: key },
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: b64u(65), auth: b64u(16) } }; },
    async unsubscribe() { localStorage.removeItem(KEY); return true; },
  });
  const made = () => JSON.parse(localStorage.getItem(KEY) || "null");
  const pm = {
    async getSubscription() { const m = made(); return m ? sub(m.n, Uint8Array.from(m.key).buffer) : null; },
    async subscribe(o) {
      const n = Number(localStorage.getItem(`${KEY}-n`) || 0) + 1;
      localStorage.setItem(`${KEY}-n`, String(n));
      localStorage.setItem(KEY, JSON.stringify({ n, key: [...new Uint8Array(o.applicationServerKey)] }));
      return sub(n, o.applicationServerKey);
    },
  };
  Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", { get: () => pm });
  Object.defineProperty(Notification, "permission", { get: () => window.__pushDenied || localStorage.getItem("test-denied") ? "denied" : "granted" });
  Notification.requestPermission = async () => Notification.permission;
}

const notice = (p) => p.evaluate((sel) => { const el = document.querySelector(sel); return el && !el.closest("[hidden]") ? el.innerText : ""; }, NOTICE);
const press = (p, label) => p.evaluate(({ sel, label }) => {
  const b = [...document.querySelectorAll(`${sel} button.tbtn`)].find((x) => x.innerText.trim() === label);
  if (b) b.click();
  return !!b;
}, { sel: NOTICE, label });

async function run(browser, port, home, layout, log) {
  const app = path.join(home, "state", "amarchy", "app");
  const subs = () => { try { return JSON.parse(fs.readFileSync(path.join(app, "push.json"), "utf8")).map((s) => s.endpoint); } catch (e) { return []; } };
  fs.rmSync(path.join(app, "push.json"), { force: true });
  fs.rmSync(path.join(app, "push-gone.json"), { force: true });
  const p = await page(browser, layout, port, { notices: true });
  await p.addInitScript(fakePush);
  const open = async () => { await p.goto("/"); await ready(p); await until(p, () => push.state !== null); await sleep(300); };
  await open();

  // Never decided, off: said on the home, above the chats.
  check(layout, await until(p, (sel) => !!document.querySelector(sel), NOTICE), "notifications off here: the home says so");
  const said = await notice(p);
  check(layout, /Notifications are off/.test(said) && /Off/.test(said) && /Turn on/.test(said) && /Not now/.test(said), `with Turn on and Not now (${JSON.stringify(said)})`);
  check(layout, await p.evaluate((sel) => { const c = document.querySelector(sel), first = document.querySelector(".today .tcard"); return c === first; }, NOTICE), "above every chat");
  await p.screenshot({ path: path.join(SHOTS, `${layout}-off.png`) });

  // One tap: on, the card goes, the server has this device and says so in its log.
  check(layout, await press(p, "Turn on"), "Turn on: tapped");
  check(layout, await until(p, (sel) => !document.querySelector(sel), NOTICE), "on: the card goes");
  check(layout, await until(p, () => /Notifications on/.test((document.querySelector(".toast") || {}).innerText || "")), "and it says so");
  check(layout, subs().join() === "https://push.example/1", `the server has this device (${subs()})`);
  check(layout, /notifications on: .*push\.example/.test(log()), "and its log says it was added");
  await p.screenshot({ path: path.join(SHOTS, `${layout}-on.png`) });
  await open();
  check(layout, !(await notice(p)) && subs().length === 1, "opened again: still on, nothing said");

  // Its push service ended the subscription (the server dropped it): opened
  // again, the device makes a new one by itself.
  fs.writeFileSync(path.join(app, "push.json"), "[]");
  fs.writeFileSync(path.join(app, "push-gone.json"), JSON.stringify(["https://push.example/1"]));
  await open();
  check(layout, await until(p, () => true) && subs().join() === "https://push.example/2", `a subscription that ended: a new one, by itself (${subs()})`);
  check(layout, !(await notice(p)), "and nothing to do for you");

  // The server lost it (not ended): told again when you come back.
  fs.writeFileSync(path.join(app, "push.json"), "[]");
  await p.evaluate(() => pushRefresh(true));
  await sleep(400);
  check(layout, subs().join() === "https://push.example/2", "the server forgot it: told again");

  // The browser dropped it (they were on here): the card is back.
  await p.evaluate(() => localStorage.removeItem("test-push"));
  await open();
  check(layout, /Notifications are off/.test(await notice(p)), "the browser dropped it: the home says so again");

  // Blocked in the system's settings, after being on: where to allow them, no Turn on.
  await p.evaluate(() => localStorage.setItem("test-denied", "1"));
  await open();
  const blocked = await notice(p);
  check(layout, /Blocked/.test(blocked) && /allow them in/.test(blocked) && !/Turn on/.test(blocked), `blocked: where to allow them (${JSON.stringify(blocked)})`);
  await p.screenshot({ path: path.join(SHOTS, `${layout}-blocked.png`) });
  await p.evaluate(() => localStorage.removeItem("test-denied"));
  await open();

  // Not now: gone, and it stays gone.
  check(layout, await press(p, "Not now"), "Not now: tapped");
  check(layout, await until(p, (sel) => !document.querySelector(sel), NOTICE), "the card goes");
  await open();
  check(layout, !(await notice(p)), "and stays away");

  // Turned on then off in Settings: off is what you chose, nothing said.
  await p.evaluate(async () => { await pushOn(); await pushOff(); });
  await sleep(300);
  // (The one the browser dropped is still the server's until its push service says it ended.)
  check(layout, !subs().includes("https://push.example/3") && !(await notice(p)), `turned off in Settings: taken off the server, nothing said (${subs()})`);
  check(layout, /notifications off: .*turned off on that device/.test(log()), "and the log says it was turned off there");
  check(layout, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

(async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "push-notice-home-"));
  const port = await freePort();
  const server = await startServer(port, home);
  let out = "";
  server.stderr.on("data", (d) => { out += d; });
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of ["phone", "wide"]) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      await run(browser, port, home, layout, () => out).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
