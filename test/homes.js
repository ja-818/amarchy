// A test's made-up home (and any scratch folder it makes), gone with the
// test: when it ends, passes or fails, throws, or is stopped (Ctrl-C, kill,
// a timeout). A server's /tmp is its RAM, shared by every chat: on
// 2026-11-24 the homes the tests had left there (551 of them, 16 GB) had
// filled it and the swap. test/homes.py is the same for the Python tests.
//
//   const homes = require("./homes");
//   const home = homes.home("reply-view");     // $TMPDIR/reply-view-home-XXXXXX
//   const work = homes.tempDir("reply-view-work-");
//   homes.whenDone(() => ...);                  // something of its own to stop first (a tmux server)
//   homes.keep(home);                           // a failed run's, to look at (the sweep takes it a day on)
//
// Required, a kill or Ctrl-C ends the test as an exit does. At the end, what
// the test started that's still running (its app server, a browser, what
// they started) is stopped, then its folders go. Each run also sweeps what a
// test left over a day ago (killed with -9, or homes from before this).
// KEEP_TEST_HOMES=1 keeps them, and says where they are. Screenshots
// (SHOTS) aren't its: they're kept, to look at.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const MARK = ".amarchy-test-home";      // in each folder made here: the sweep's to take, a day on
const STALE = 24 * 3600 * 1000;
const made = [];
const kept = [];      // kept to look at (keep()): what runs from them is stopped all the same
const done = [];
let hooked = false;

// The tests' homes as they were named before this, without the mark: the
// sweep takes them too (only these, and only a day old: never another
// chat's file in /tmp).
const LEGACY = new Set([
  "agent-chat-view", "agent-tasks", "agents-view", "automations", "boards-view", "chat-keys", "chat-open",
  "chat-scroll", "cloud-view", "compare", "desktop", "ghostty", "image-names", "links-out", "local-key-view",
  "machines-look", "machines-view", "mic-first-tap", "mic-release", "mic-why", "move-view", "new-chat-project",
  "new-chat-share", "open-new-chat", "phone-app-view", "preview-view", "push-notice", "reply-view", "snappy",
  "spinner-view", "still-view", "suggest-view", "tailscale", "terminal-view", "today-view", "tour-view",
  "whole-view", "xpost-view",
]);
const MADE_NAME = /^[a-z0-9][a-z0-9.-]*-[A-Za-z0-9_]{6,8}$/;      // mkdtemp's (node's and Python's)
const HOME_NAME = /^([a-z0-9][a-z0-9.-]*?)-home-[A-Za-z0-9_]{6,8}$/;

// The caches of what a test builds or fetches with are the account's, not
// a new one in each home: uv's (33 MB a home, a font cut) and Go's (104 MB,
// test/push-phone.py's relay built again from nothing each run).
const ACCOUNT = (() => { try { return os.userInfo().homedir; } catch (e) { return os.homedir(); } })();
const CACHE = process.env.XDG_CACHE_HOME || path.join(ACCOUNT, ".cache");
for (const [k, v] of [["UV_CACHE_DIR", path.join(CACHE, "uv")], ["GOCACHE", path.join(CACHE, "go-build")],
                      ["GOMODCACHE", path.join((process.env.GOPATH || path.join(ACCOUNT, "go")).split(path.delimiter)[0], "pkg", "mod")]]) {
  if (!process.env[k]) process.env[k] = v;
}

// Playwright's own folders (a browser's profile, its downloads' folder),
// when it didn't get to remove them (a busy machine, a test that exits right
// after browser.close(), a kill): the ones this test's Playwright made, gone
// with it. It makes them with fs.promises.mkdtemp, here in this process.
const playwrights = [];
const mkdtemp = fs.promises.mkdtemp;
fs.promises.mkdtemp = async function (prefix, ...rest) {
  const dir = await mkdtemp.call(this, prefix, ...rest);
  if (/^playwright[-_]/.test(path.basename(String(prefix)))) playwrights.push(dir);
  return dir;
};

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// The processes under this one, all the way down: [pid].
function descendants(pid = process.pid) {
  const out = [];
  const seen = new Set([pid]);
  const todo = [pid];
  while (todo.length) {
    const p = todo.shift();
    let kids = [];
    try {
      for (const t of fs.readdirSync(`/proc/${p}/task`)) {
        kids.push(...fs.readFileSync(`/proc/${p}/task/${t}/children`, "utf8").split(/\s+/).filter(Boolean).map(Number));
      }
    } catch (e) {
      if (p !== process.pid) continue;
      try {     // no /proc (a Mac): pgrep says
        kids = execFileSync("pgrep", ["-P", String(p)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
          .split(/\s+/).filter(Boolean).map(Number);
      } catch (e2) { kids = []; }
    }
    for (const k of kids) if (!seen.has(k)) { seen.add(k); out.push(k); todo.push(k); }
  }
  return out;
}

function alive(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch (e) {
    try { process.kill(pid, 0); return true; } catch (e2) { return false; }
  }
}

function ancestors() {
  const out = new Set([process.pid]);
  let p = process.pid;
  for (let i = 0; i < 64; i++) {
    try {
      const stat = fs.readFileSync(`/proc/${p}/stat`, "utf8");
      p = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    } catch (e) { break; }
    if (!(p > 1) || out.has(p)) break;
    out.add(p);
  }
  return out;
}

// Processes of yours still running from one of dirs, though not under the
// test: their folder in it, or its path in their command (a tmux server and
// its chats' shells, a job started apart). Only where there's /proc.
function runningIn(dirs) {
  if (!dirs.length || !fs.existsSync("/proc")) return [];
  const skip = ancestors();
  const uid = process.getuid ? process.getuid() : -1;
  const out = [];
  for (const p of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(p) || skip.has(Number(p))) continue;
    let cmd, cwd = "";
    try {
      if (fs.statSync(`/proc/${p}`).uid !== uid) continue;
      cmd = fs.readFileSync(`/proc/${p}/cmdline`, "utf8").replace(/\0/g, " ");
    } catch (e) { continue; }
    try { cwd = fs.readlinkSync(`/proc/${p}/cwd`); } catch (e) { /* gone, or not ours to read */ }
    if (dirs.some((d) => cmd.includes(d) || cwd === d || cwd.startsWith(`${d}/`) || cwd.startsWith(`${d} `))) out.push(Number(p));
  }
  return out;
}

// Stop what the test started and left running, and whatever still runs from
// its folders: asked first, then made to.
function stopAll(dirs = []) {
  let left = [...new Set([...descendants(), ...runningIn(dirs)])];
  if (!left.length) return;
  for (const p of left) { try { process.kill(p, "SIGTERM"); } catch (e) { /* gone */ } }
  for (let i = 0; i < 30 && (left = left.filter(alive)).length; i++) sleep(100);
  for (const p of left) { try { process.kill(p, "SIGKILL"); } catch (e) { /* gone */ } }
  for (let i = 0; i < 10 && (left = left.filter(alive)).length; i++) sleep(50);
}

// Its folders writable again, all the way down (Go's module cache is read-only).
function writable(dir) {
  try { fs.chmodSync(dir, 0o700); } catch (e) { return; }
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const d of names) if (d.isDirectory()) writable(path.join(dir, d.name));
}

function remove(dir) {
  for (let i = 0; i < 2; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      return;
    } catch (e) {
      if (i) console.error(`couldn't remove the test's ${dir}: ${e.message}`);
      else writable(dir);
    }
  }
}

function cleanUp() {
  for (const fn of done.splice(0).reverse()) {
    try { fn(); } catch (e) { console.error(`a test's clean-up failed: ${e.message}`); }
  }
  stopAll([...made, ...kept]);       // kept or not: nothing of the test runs on
  for (const d of playwrights.splice(0)) if (fs.existsSync(d)) remove(d);
  if (process.env.KEEP_TEST_HOMES) {
    for (const d of made) if (fs.existsSync(d)) console.error(`kept (KEEP_TEST_HOMES): ${d}`);
    return;
  }
  for (const d of made.splice(0)) remove(d);
}

// Folders a test left over a day ago (its mark in them, or a home named as
// the tests named theirs before), where the tests make them.
function sweep() {
  const places = new Set([os.tmpdir(), "/tmp", path.join(CACHE, "amarchy-tests")]);
  const me = process.getuid ? process.getuid() : -1;
  for (const place of places) {
    let names;
    try { names = fs.readdirSync(place); } catch (e) { continue; }
    for (const name of names) {
      if (!MADE_NAME.test(name)) continue;
      const m = HOME_NAME.exec(name);
      const dir = path.join(place, name);
      try {
        const st = fs.lstatSync(dir);
        if (!st.isDirectory() || (me >= 0 && st.uid !== me) || Date.now() - st.mtimeMs < STALE) continue;
        if (!(m && LEGACY.has(m[1])) && !fs.existsSync(path.join(dir, MARK))) continue;
      } catch (e) { continue; }
      remove(dir);
    }
  }
}

function hook() {
  if (hooked) return;
  hooked = true;
  process.on("exit", cleanUp);
  // Stopped: as an exit (the exit's clean-up runs), with the code a shell gives.
  for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
    process.on(sig, () => {
      console.error(`\n${sig}: stopping the test and removing its home`);
      process.exit(code);
    });
  }
  if (!process.env.KEEP_TEST_HOMES) sweep();
}

// A folder of the test's own in $TMPDIR: mkdtemp's, gone at the end.
function tempDir(prefix, where = os.tmpdir()) {
  hook();
  fs.mkdirSync(where, { recursive: true });
  const dir = fs.mkdtempSync(path.join(where, prefix));
  made.push(dir);
  fs.writeFileSync(path.join(dir, MARK), `${process.pid} ${process.argv.slice(1).join(" ")}\n`);
  return dir;
}

// A test's home: $TMPDIR/<name>-home-XXXXXX, gone at the end.
function home(name, where) {
  return tempDir(`${name}-home-`, where);
}

// The folder stays, with what's in it (a failed run's, to look at): only
// the sweep takes it, a day on. What the test started is stopped all the same.
function keep(dir) {
  const i = made.indexOf(dir);
  if (i >= 0) { made.splice(i, 1); kept.push(dir); console.error(`kept: ${dir}`); }
}

// Something to do at the end before the processes are stopped and the
// homes go (stopping a tmux server: it isn't under the test). Synchronous.
function whenDone(fn) {
  hook();
  done.push(fn);
}

hook();     // required: a kill ends the test as an exit does, from now on

module.exports = { home, tempDir, whenDone, keep, descendants, runningIn, MARK };
