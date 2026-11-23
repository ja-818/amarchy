// Settings → Tailscale, in a browser, phone and wide: where Tailscale stands
// on the host and the next step, through each state a machine goes through:
// ready; not signed in (Get the sign-in link, then the link itself);
// MagicDNS and HTTPS off (the admin page for each); amarchy not allowed to
// drive it (the command, with Copy); off (Turn Tailscale on); two accounts,
// shown from a phone (switch on the host itself) and switched from the host's
// own desktop app (the local key). Screenshots of each go to SHOTS.
//
//   node test/tailscale-view.js
//
// Needs what test/reply-view.js needs (Chromium, playwright-core). Its app
// server is this checkout's, with a home of its own and a fake tailscale on
// its PATH that says what a scenario file says and logs what it's asked: the
// real Tailscale of this machine is never asked anything.

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");

// The app server: a phone (a Tailscale login, its Origin) unless the request
// carries the local key's cookie (this machine's desktop app).
const SHIM = `
import importlib.machinery, importlib.util, os, sys, threading, http.server
bin, port, home = sys.argv[1], int(sys.argv[2]), sys.argv[3]
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", bin)
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
am.app_key(); am.migrate(); am.local_key()
st = am.AppState(); st.transcriber = None
Handler = am.app_handler(st, ["tester@test"], "127.0.0.1")
class Local(Handler):
    def parse_request(self):
        ok = super().parse_request()
        local = "amarchy_local" in (self.headers.get("Cookie") or "") or self.path.startswith("/local")
        if ok and not local and not self.headers.get("Tailscale-User-Login"):
            self.headers["Tailscale-User-Login"] = "tester@test"
        if ok and not local and self.headers.get("Origin"):
            self.headers.replace_header("Origin", "https://" + self.headers.get("Host", ""))
        return ok
server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Local)
server.daemon_threads = True
threading.Thread(target=am.app_watch, args=(st,), daemon=True).start()
print("listening", flush=True)
server.serve_forever()
`;

// tailscale, as the scenario ($HOME/ts.json) has it; what it's asked goes to $HOME/ts-calls.
const FAKE = `#!/usr/bin/env python3
import json, os, sys
home = os.environ["HOME"]
f = os.path.join(home, "ts.json")
sc = json.load(open(f))
args = sys.argv[1:]
open(os.path.join(home, "ts-calls"), "a").write(" ".join(args) + "\\n")
def save(): json.dump(sc, open(f, "w"))
if args[:2] == ["status", "--json"]:
    if not sc.get("running", True): print("failed to connect to local tailscaled"); sys.exit(1)
    acct = next(a for a in sc["accounts"] if a["selected"])
    print(json.dumps({"BackendState": sc["state"], "AuthURL": sc.get("auth_url", ""),
        "CertDomains": [sc["name"]] if sc.get("https") else None, "MagicDNSSuffix": sc["name"].split(".", 1)[1],
        "CurrentTailnet": {"Name": acct["tailnet"], "MagicDNSSuffix": sc["name"].split(".", 1)[1], "MagicDNSEnabled": sc.get("magicdns", True)},
        "Self": {"DNSName": sc["name"] + ".", "UserID": 1}, "User": {"1": {"LoginName": acct["account"]}}}))
elif args[:2] == ["debug", "prefs"]:
    import pwd
    print(json.dumps({"OperatorUser": sc.get("operator", pwd.getpwuid(os.getuid()).pw_name)}))
elif args[:3] == ["switch", "--list", "--json"]:
    print(json.dumps(sc["accounts"]))
elif args[:1] == ["switch"]:
    for a in sc["accounts"]: a["selected"] = a["id"] == args[1]
    save()
elif args[:1] == ["up"]:
    if sc["state"] == "NeedsLogin": sc["auth_url"] = "https://login.tailscale.com/a/view-test-0000"
    else: sc["state"] = "Running"
    save()
`;

const failures = [];
function check(where, ok, what) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${where}: ${what}`);
  if (!ok) failures.push(`${where}: ${what}`);
}

function freePort() {
  return new Promise((ok, no) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
    s.on("error", no);
  });
}

function startServer(port, home, fakes) {
  return new Promise((ok, no) => {
    const py = spawn("python3", ["-c", SHIM, BIN, String(port), home], { stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${fakes}:${process.env.PATH}`, AMARCHY_HOST_NAME: "desk",
             AMARCHY_WORK: path.join(home, "Work") } });
    let err = "";
    py.stderr.on("data", (d) => { err += d; });
    py.stdout.once("data", () => ok(py));
    py.on("exit", (code) => no(new Error(`the app server stopped (${code}): ${err.slice(-400)}`)));
  });
}

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), ".cache", "ms-playwright");
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith("chromium-")).sort().reverse() : [];
  for (const d of dirs) for (const sub of ["chrome-linux64", "chrome-linux"]) {
    const bin = path.join(base, d, sub, "chrome");
    if (fs.existsSync(bin)) return bin;
  }
  return undefined;
}

function loadPlaywright() {
  for (const id of [process.env.PLAYWRIGHT_CORE, "playwright-core", "playwright"]) {
    if (!id) continue;
    try { return require(id); } catch (err) { /* the next one */ }
  }
  console.error("playwright-core not found: set PLAYWRIGHT_CORE to its folder");
  process.exit(2);
}

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), "tailscale-shots");
const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};
const ONE = [{ id: "a1", account: "julian@example.com", tailnet: "julian@example.com", selected: true }];
const TWO = [...ONE, { id: "b2", account: "julian@work.example", tailnet: "work.example", selected: false }];
const READY = { running: true, state: "Running", name: "desk.tail1234.ts.net", magicdns: true, https: true, accounts: ONE };

async function run(browser, port, layout, home, local) {
  const scenario = (sc) => fs.writeFileSync(path.join(home, "ts.json"), JSON.stringify({ ...READY, ...sc }));
  const calls = () => (fs.existsSync(path.join(home, "ts-calls")) ? fs.readFileSync(path.join(home, "ts-calls"), "utf8") : "");
  const ctx = await browser.newContext({ ...LAYOUTS[layout], baseURL: `http://127.0.0.1:${port}` });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = async (name) => { await page.waitForTimeout(300); return page.screenshot({ path: path.join(SHOTS, `${layout}-${name}.png`) }); };
  const where = `${layout}${local ? " (on the host)" : ""}`;
  scenario({});
  if (local) {
    const key = fs.readFileSync(path.join(home, "state", "amarchy", "app", "local.key"), "utf8").trim();
    await page.goto(`/local?key=${key}`);
  } else {
    await page.goto("/");
  }
  await page.waitForFunction(() => typeof tailscaleSheet === "function" && typeof openSettings === "function" && document.readyState === "complete");
  await page.waitForTimeout(800);
  const sheetText = () => page.locator(".sheet-back").last().innerText();
  const open = async () => {
    await page.evaluate(() => { document.querySelectorAll(".sheet-back").forEach((s) => s.remove()); tailscaleSheet(); });
    await page.locator(".sheet-back .meta", { hasText: "On desk" }).first().waitFor({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(200);
  };

  if (!local) {
    // Settings has it, under Host.
    await page.evaluate(() => openSettings());
    const entry = page.locator(".sheet-back.settings .control", { hasText: "Tailscale…" });
    await entry.waitFor({ timeout: 8000 }).catch(() => {});
    check(where, await entry.isVisible().catch(() => false), "Settings has Tailscale…");
    await entry.scrollIntoViewIfNeeded().catch(() => {});
    await shot("settings");
    await entry.click();
    await page.locator(".sheet-back").last().getByText("Ready").waitFor({ timeout: 8000 }).catch(() => {});
    const t = await sheetText();
    check(where, /On: desk\.tail1234\.ts\.net, as julian@example\.com\. MagicDNS on, HTTPS on\./.test(t) && /On desk/i.test(t)
      && t.includes("Ready: your phone and your other machines reach it"), `ready, in words (${t.replace(/\n/g, " | ").slice(0, 160)})`);
    await shot("ready");

    scenario({ state: "NeedsLogin" });
    await open();
    const get = page.locator(".sheet-back .control", { hasText: "Get the sign-in link" });
    check(where, await get.isVisible().catch(() => false), "not signed in: Get the sign-in link");
    await shot("login");
    await get.click();
    const link = page.locator(".sheet-back a.control", { hasText: "Open the sign-in page" });
    await link.waitFor({ timeout: 15000 }).catch(() => {});
    check(where, (await link.getAttribute("href").catch(() => "")) === "https://login.tailscale.com/a/view-test-0000"
      && (await link.getAttribute("target").catch(() => "")) === "_blank", "then the sign-in link itself, opening in the browser");
    check(where, /^up --timeout=/m.test(calls()), "signing in ran tailscale up");
    await shot("login-link");

    scenario({ magicdns: false, https: false });
    await open();
    const dns = await page.locator(".sheet-back a.control").evaluateAll((as) => as.map((a) => [a.textContent, a.href]));
    check(where, dns.length === 2 && dns.every(([, href]) => href === "https://login.tailscale.com/admin/dns")
      && dns.map(([t]) => t).join("|") === "Turn on MagicDNS|Turn on HTTPS certificates", `MagicDNS and HTTPS off: their admin page (${JSON.stringify(dns)})`);
    await shot("dns");

    scenario({ operator: "root" });
    await open();
    check(where, !(await page.locator(".sheet-back code").count()), "not allowed to drive it, but nothing to do: not asked");
    scenario({ operator: "root", state: "NeedsLogin" });
    await open();
    const code = await page.locator(".sheet-back code").first().textContent().catch(() => "");
    const want = `sudo tailscale set --operator=${os.userInfo().username}`;
    check(where, code === want, `not allowed to drive it, to sign in: the command (${code})`);
    await page.locator(".sheet-back .control", { hasText: "Copy the command" }).click();
    await page.waitForTimeout(300);
    const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    check(where, copied === null || copied === want, `Copy copies it (${copied})`);
    await shot("operator");

    scenario({ state: "Stopped" });
    await open();
    await page.locator(".sheet-back .control", { hasText: "Turn Tailscale on" }).click();
    await page.locator(".sheet-back").last().getByText("Ready").waitFor({ timeout: 15000 }).catch(() => {});
    check(where, (await sheetText()).includes("Ready"), "off: Turn Tailscale on, and it's on");

    scenario({ accounts: TWO });
    await open();
    const t2 = await sheetText();
    check(where, t2.includes("julian@example.com (in use), julian@work.example") && t2.includes("Switch on desk itself")
      && !(await page.locator(".sheet-back .seg .control").count()), "two accounts, from a phone: which, and switch on the host itself");
    await shot("accounts-phone");
    const r = await page.evaluate(() => api("/api/tailscale", { do: "switch", account: "b2" }).then(() => "switched", (e) => e.message));
    check(where, /cut this device off/.test(r), `a phone can't switch it (${r})`);
  } else {
    scenario({ accounts: TWO });
    await open();
    const seg = page.locator(".sheet-back .seg .control");
    check(where, (await seg.count()) === 2 && (await seg.first().getAttribute("class")).includes(" on"),
      "two accounts, on the host itself: each a button, the one in use lit");
    await shot("accounts-host");
    await seg.nth(1).click();
    await page.waitForFunction(() => { const b = document.querySelectorAll(".sheet-back .seg .control"); return b[1] && b[1].classList.contains("on"); }, null, { timeout: 15000 }).catch(() => {});
    check(where, (await seg.nth(1).getAttribute("class")).includes(" on") && /^switch b2$/m.test(calls()),
      "switched to the other one");
    await shot("switched");
  }
  check(where, !errors.length, `no page errors (${errors.join("; ")})`);
  await ctx.close();
}

(async () => {
  const pw = loadPlaywright();
  fs.mkdirSync(SHOTS, { recursive: true });
  const home = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "tailscale-home-"));
  fs.mkdirSync(path.join(home, "Work"));
  const fakes = path.join(home, "bin");
  fs.mkdirSync(fakes);
  fs.writeFileSync(path.join(fakes, "tailscale"), FAKE, { mode: 0o755 });
  const port = await freePort();
  const server = await startServer(port, home, fakes);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of Object.keys(LAYOUTS)) {
      for (const local of [false, true]) await run(browser, port, layout, home, local).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(`\nscreenshots: ${SHOTS}`);
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : "\nAll passed.");
  process.exit(failures.length ? 1 : 0);
})();
