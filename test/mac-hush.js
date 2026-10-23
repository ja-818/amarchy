// Quiet your Mac while you dictate: the helper mac/hush-install.sh puts on a
// Mac, against this checkout's app server, with stand-ins for the Mac's
// osascript, system_profiler, scutil, launchctl and uname (it runs here, on
// Linux). Checked: the installer the app serves (this host's address in it,
// the helper and its LaunchAgent written, uninstall takes them away); the
// helper mutes the speakers while a dictation listens and turns them back on
// after; not on headphones, nor when the Mac was muted already (and then it
// isn't turned on after); turned back on when amarchy goes away mid
// dictation; and the app lists the Mac while its helper is on.
//
//   node test/mac-hush.js
//
// Needs Node 18 or later (its fetch), bash and curl. Exits 0 when every
// check passed.

"use strict";

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");

const SHIM = `
import importlib.machinery, importlib.util, os, sys, threading, http.server
bin, port, home = sys.argv[1], int(sys.argv[2]), sys.argv[3]
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", bin)
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
am.app_key(); am.migrate()
st = am.AppState(); st.transcriber = None
Handler = am.app_handler(st, ["tester@test"], "127.0.0.1")
class Local(Handler):
    def parse_request(self):
        ok = super().parse_request()
        if ok and not self.headers.get("Tailscale-User-Login"):
            self.headers["Tailscale-User-Login"] = "tester@test"
        if ok and self.headers.get("Origin"):
            self.headers.replace_header("Origin", "https://" + self.headers.get("Host", ""))
        return ok
server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Local)
server.daemon_threads = True
threading.Thread(target=am.app_watch, args=(st,), daemon=True).start()
def ctl():
    for line in sys.stdin:
        st.dictating(1 if line.strip() == "+" else -1)
threading.Thread(target=ctl, daemon=True).start()
print("listening", flush=True)
server.serve_forever()
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



const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(port, home) {
  return new Promise((ok, no) => {
    const py = spawn("python3", ["-c", SHIM, BIN, String(port), home], { stdio: ["pipe", "pipe", "pipe"] });
    let err = "";
    py.stderr.on("data", (d) => { err += d; });
    py.stdout.once("data", () => ok(py));
    py.on("exit", (code) => no(new Error(`the app server stopped (${code}): ${err.slice(-400)}`)));
  });
}

// The Mac's commands, as stand-ins: the sound's state in a file.
function fakeMac(dir) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const put = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  put("osascript", `case "$*" in
  *"output muted of"*) cat "${dir}/muted" ;;
  *"with output muted"*) echo true > "${dir}/muted" ;;
  *"without output muted"*) echo false > "${dir}/muted" ;;
esac`);
  put("system_profiler", `cat "${dir}/audio"`);
  put("scutil", "echo Test Mac");
  put("uname", "echo Darwin");
  put("launchctl", `echo "$*" >> "${dir}/launchctl"`);
  return bin;
}

const SPEAKERS = `Audio:

    Devices:

        MacBook Pro Microphone:

          Default Input Device: Yes
          Transport: Built-in
          Input Source: MacBook Pro Microphone

        MacBook Pro Speakers:

          Default Output Device: Yes
          Default System Output Device: Yes
          Transport: Built-in
          Output Source: MacBook Pro Speakers
`;
const AIRPODS = `Audio:

    Devices:

        MacBook Pro Speakers:

          Default System Output Device: Yes
          Transport: Built-in
          Output Source: MacBook Pro Speakers

        Julian’s AirPods Pro:

          Default Output Device: Yes
          Transport: Bluetooth
`;

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mac-hush-home-"));
  const mac = fs.mkdtempSync(path.join(os.tmpdir(), "mac-hush-mac-"));
  const bin = fakeMac(mac);
  const port = await freePort();
  const server = await startServer(port, home);
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, HOME: mac, PATH: `${bin}:${process.env.PATH}` };
  const muted = () => fs.readFileSync(path.join(mac, "muted"), "utf8").trim();
  const dictate = (on) => server.stdin.write(on ? "+\n" : "-\n");
  let helper;
  try {
    // ---- the installer, as the app serves it
    const res = await fetch(`${base}/api/hush/mac.sh`);
    const script = await res.text();
    check("install", res.ok && script.includes(`URL="https://127.0.0.1:${port}"`) && !script.includes("{{url}}"),
          "served with this host's address in it");
    const local = script.replace(`URL="https://127.0.0.1:${port}"`, `URL="${base}"`);
    const out = execFileSync("sh", ["-s"], { input: local, env }).toString();
    const helperPath = path.join(mac, "Library", "Application Support", "amarchy", "hush");
    const plist = path.join(mac, "Library", "LaunchAgents", "com.amarchy.hush.plist");
    check("install", fs.existsSync(helperPath) && fs.existsSync(plist) && /bootstrap gui\/\d+ /.test(fs.readFileSync(path.join(mac, "launchctl"), "utf8")),
          `the helper and its LaunchAgent, started (${out.split("\n")[0]})`);
    check("install", fs.readFileSync(plist, "utf8").includes(base), "the LaunchAgent runs it with amarchy's address");

    // ---- the helper, as launchd runs it
    fs.writeFileSync(path.join(mac, "muted"), "false\n");
    fs.writeFileSync(path.join(mac, "audio"), SPEAKERS);
    let log = "";
    const start = () => {
      helper = spawn("/bin/bash", [helperPath, base], { env, stdio: ["ignore", "pipe", "pipe"] });
      helper.stdout.on("data", (d) => { log += d; });
      helper.stderr.on("data", (d) => { log += d; });
    };
    start();
    await sleep(1500);
    const listed = await (await fetch(`${base}/api/state`)).json();
    check("helper", JSON.stringify(listed.hushers) === '["Test Mac"]', `the app lists it while it's on (${JSON.stringify(listed.hushers)})`);
    dictate(true);
    await sleep(1000);
    check("helper", muted() === "true", "muted while a dictation listens, on the speakers");
    dictate(true);
    dictate(false);
    await sleep(700);
    check("helper", muted() === "true", "still muted while another dictation listens");
    dictate(false);
    await sleep(700);
    check("helper", muted() === "false", "back on when none does");

    fs.writeFileSync(path.join(mac, "audio"), AIRPODS);
    dictate(true);
    await sleep(1000);
    check("helper", muted() === "false", "left alone on AirPods");
    dictate(false);
    await sleep(500);

    fs.writeFileSync(path.join(mac, "audio"), SPEAKERS);
    fs.writeFileSync(path.join(mac, "muted"), "true\n");
    dictate(true);
    await sleep(1000);
    dictate(false);
    await sleep(700);
    check("helper", muted() === "true", "muted already: left muted after");

    fs.writeFileSync(path.join(mac, "muted"), "false\n");
    dictate(true);
    await sleep(1000);
    check("helper", muted() === "true", "muted again for the next dictation");
    server.kill();
    await sleep(1500);
    check("helper", muted() === "false", "amarchy gone mid dictation: the sound comes back");
    helper.kill("SIGTERM");
    await sleep(300);
    console.log(log.replace(/^/gm, "    | "));

    const gone = execFileSync("sh", ["-s", "uninstall"], { input: local, env }).toString();
    check("uninstall", !fs.existsSync(helperPath) && !fs.existsSync(plist), `the helper and its LaunchAgent gone (${gone.trim()})`);
  } catch (e) {
    check("mac-hush", false, `crashed: ${e.stack}`);
  } finally {
    if (helper) helper.kill("SIGKILL");
    server.kill();
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : "\nAll passed.");
  process.exit(failures.length ? 1 : 0);
})();
