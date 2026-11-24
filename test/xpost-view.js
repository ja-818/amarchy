// A post to publish on X (the xpost block), in a browser: drawn as X shows
// it in the timeline, in X's own look (dark with a dark theme, light with a
// light one), not the theme's: the avatar, the name and @handle · now, the
// text exactly as written (its newlines kept), its links, @mentions, #tags
// and $cashtags in X's blue (a link shortened as X does), its pictures from
// this machine in X's grid (one at its shape, two side by side, three with
// the first tall, four in a square), a video that plays, a picture that
// can't be shown said so, "Replying to @user", a quoted post's frame, the
// action row (only drawn). Under it the count X keeps (red past 280), the
// draft's id, Copy text, which copies the exact text, and Copy image (with
// several pictures, "Copy image" and a number for each, its place in the
// grid: none for a video, nor for one that can't be shown), which puts the
// picture itself on the clipboard as a PNG
// (read back off the real clipboard: a PNG as it is, a JPEG or a WebP drawn
// to one, one too big made 4096 on its long side), asked for in the tap
// itself; a GIF, or a browser that won't, says so and shows it full screen,
// to hold and save. A tap on a picture shows it full screen. A file block's
// picture shows too. The server serves only pictures and videos, from your
// home or /tmp. On a phone and on a wide screen, with screenshots; then the
// copies again in WebKit (Safari's engine), on a phone, when it's there.
//
//   node test/xpost-view.js            both layouts
//   node test/xpost-view.js phone      one layout (phone | wide), or webkit (its copies)
//
// Needs a Chromium and Playwright's `playwright-core` (PLAYWRIGHT_CORE=<its folder>
// or on NODE_PATH; CHROME=<the chrome binary>, else the one Playwright installed,
// found under ~/.cache/ms-playwright), and ffmpeg for the video (skipped
// without it); WebKit's checks need Playwright's WebKit (WEBKIT=<its MiniBrowser,
// or a script that starts it>, else the one Playwright installed; skipped
// when it doesn't start). It starts its own app server from this checkout's
// bin/amarchy, with a home and state of its own. Screenshots go to SHOTS
// (default: a folder under the system's temp dir). Exits 0 when every check passed.

"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const homes = require("./homes");      // (test/homes.js: its home gone with it, however it ends)
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "amarchy");
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "xpost-view-"));
const ONLY = process.argv[2];
const SID = "fireship-test";

// The app's handler on 127.0.0.1, with the Tailscale login and Origin the app expects from its own host.
const SHIM = `
import importlib.machinery, importlib.util, os, sys, threading, http.server
bin, port, home = sys.argv[1], int(sys.argv[2]), sys.argv[3]
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", bin)
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)
import sys as _sys; _sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(bin)), "..", "test")); import isolate; isolate.timers(am); isolate.downloads(am)      # (test/isolate.py: none of this machine's automations, nor its big downloads)
am.app_key(); am.migrate()
am.save_session({"id": "${SID}", "repo": "fireship", "name": "test", "branch": "test", "base": "main", "path": home + "/work"})
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
print("listening", flush=True)
server.serve_forever()
`;

function freePort() {
  return new Promise((ok, no) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
    s.on("error", no);
  });
}

function startServer(port, home) {
  return new Promise((ok, no) => {
    const py = spawn("python3", ["-c", SHIM, BIN, String(port), home], { stdio: ["ignore", "pipe", "pipe"] });
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

// A PNG of w×h, a gradient from one color to another (top left to bottom right).
function png(file, w, ht, [r0, g0, b0], [r1, g1, b1]) {
  const rows = [];
  for (let y = 0; y < ht; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / ht) / 2;
      row[1 + x * 3] = r0 + (r1 - r0) * t; row[2 + x * 3] = g0 + (g1 - g0) * t; row[3 + x * 3] = b0 + (b1 - b0) * t;
    }
    rows.push(row);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(ht, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]));
}

const LAYOUTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 1280, height: 800 } },
};

const failures = [];
function check(where, ok, what) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${where}: ${what}`);
  if (!ok) failures.push(`${where}: ${what}`);
}

// Fireship's draft, as it will show it: 278 of X's 280.
const POST = "The hardest problem in AI agents? Waiting.\n\nSend our WhatsApp agent 4 photos:\n→ message 1 arrives empty\n→ agent: \"I didn't get any image\"\n→ photos read at different speeds: 2 answers\n→ 30 s of silence\n\nNow a burst waits for its slowest photo, answers once, and shows typing.";
const LINKS = "Shipped: drafts for X preview like X in amarchy, by @ja818_ #buildinpublic $TSLA\n\nhttps://github.com/ja-818/amarchy/pull/123 and gethouston.ai 🚀";

function reply(m, video) {
  return [
    "Two drafts for X: the WhatsApp burst fix, and the amarchy preview.",
    "",
    "```brief",
    "Checked: both drafts pass x-draft's check",
    "You: Say whether to post each",
    "```",
    "",
    `\`\`\`xpost handle="ja818_" name="Julian Arango" avatar="${m}/avatar.png" media="${m}/tall.png" id="fs-007"`,
    POST,
    "```",
    "",
    `\`\`\`xpost handle="@ja818_" name="Julian Arango" avatar="${m}/avatar.png" media="${m}/wide.png, ${m}/b.png" reply_to="https://x.com/vercel/status/1628832338187636740" id="fs-008"`,
    LINKS,
    "```",
    "",
    `\`\`\`xpost handle="ja818_" name="Julian Arango With A Very Long Display Name Indeed" media="${m}/a.png, ${m}/b.png, ${m}/c.png" quote="https://x.com/rauchg/status/1817981617478787443" id="fs-009"`,
    "Quote with three pictures. " + "Long words go on and on. ".repeat(11) + "日本語",
    "```",
    "",
    `\`\`\`xpost handle="ja818_" media="${m}/a.png, ${video ? `${m}/clip.mp4` : `${m}/c.png`}, ${m}/missing.png, ${m}/d.png" id="fs-010"`,
    "Four in a square, one gone.",
    "```",
    "",
    `\`\`\`file path="${m}/wide.png"`,
    "The screenshot for fs-007",
    "```",
    "",
    "```choices question=\"Post fs-007?\"",
    "- Post it | Post fs-007 exactly as drafted",
    "- Edit | Edit fs-007: ",
    "- Skip | Skip fs-007",
    "```",
    "",
    "## Why these two",
    "",
    "- The burst fix is a story devs know.",
    "",
    "```goal state=\"waiting\"",
    "Post Julian's merges on X",
    "```",
  ].join("\n");
}

async function mount(page, text) {
  await page.evaluate(({ text, sid }) => {
    document.body.innerHTML = "";
    const box = document.createElement("div");
    box.style.cssText = "height:100vh;height:100dvh;display:flex;flex-direction:column;background:var(--surface)";
    document.body.append(box);
    window.__chat = new Chat({ id: sid,
      row: { id: sid, engine: "chat", status: "idle", sleeping: false, awake: true, repo: "fireship", name: "test", path: "/tmp" },
      onSession() {}, onScreen() {}, onGone() {} });
    box.append(window.__chat.el);
    window.__chat.conversation({ reset: true, start: 0, items: [
      { kind: "user", text: "Drafts?", turn: true, key: "11111111-aaaa-4aaa-8aaa-000000000001:0", at: "" },
      { kind: "claude", text, key: "c1:0", at: "" }] });
  }, { text, sid: SID });
}

// What the posts are, drawn.
const READ = () => {
  const cards = [...document.querySelectorAll(".msg.claude .art-xpost")];
  const css = (el, p) => el && getComputedStyle(el)[p];
  return cards.map((art) => {
    const x = art.querySelector(".xpost"), r = x.getBoundingClientRect();
    const media = x.querySelector(".xpost-media");
    const tiles = media ? [...media.children].map((t) => { const b = t.getBoundingClientRect(); return { x: Math.round(b.left - media.getBoundingClientRect().left), y: Math.round(b.top - media.getBoundingClientRect().top), w: Math.round(b.width), h: Math.round(b.height), missing: t.classList.contains("missing"), video: !!t.querySelector("video"), img: !!t.querySelector("img") && t.querySelector("img").naturalWidth > 0 }; }) : [];
    const av = x.querySelector(".xpost-avatar"), avr = av.getBoundingClientRect();
    return {
      title: art.querySelector(".art-title").textContent, sub: art.querySelector(".art-sub")?.textContent || "",
      open: art.classList.contains("open"),
      name: x.querySelector(".xpost-head .xpost-name").textContent, handle: x.querySelector(".xpost-head .xpost-handle").textContent,
      time: x.querySelector(".xpost-time").textContent,
      text: x.querySelector(".xpost-text")?.innerText, textRaw: x.querySelector(".xpost-text")?.textContent,
      links: [...x.querySelectorAll(".xpost-text a")].map((a) => `${a.textContent}>${a.getAttribute("href")}`),
      linkColor: css(x.querySelector(".xpost-text a"), "color"), textColor: css(x.querySelector(".xpost-text"), "color"),
      font: css(x.querySelector(".xpost-text"), "fontSize") + "/" + css(x.querySelector(".xpost-text"), "lineHeight"),
      family: css(x, "fontFamily"), bg: css(x, "backgroundColor"), handleColor: css(x.querySelector(".xpost-head .xpost-handle"), "color"),
      avatar: { w: Math.round(avr.width), h: Math.round(avr.height), round: css(av, "borderRadius"), img: !!av.querySelector("img") && av.querySelector("img").naturalWidth > 0, initial: av.querySelector(".xpost-initial")?.textContent || "" },
      replying: x.querySelector(".xpost-replying")?.textContent || "",
      quote: x.querySelector(".xpost-quote") ? { text: x.querySelector(".xpost-quote").textContent, href: x.querySelector(".xpost-quote").getAttribute("href") } : null,
      media: media ? { cls: media.className, w: Math.round(media.getBoundingClientRect().width), h: Math.round(media.getBoundingClientRect().height), radius: css(media, "borderRadius"), tiles } : null,
      actions: x.querySelectorAll(".xpost-actions svg").length, more: !!x.querySelector(".xpost-head .xpost-more svg"),
      past: [...x.querySelectorAll(".xpost-text .xpost-over")].map((o) => o.textContent).join(""),
      count: art.querySelector(".xpost-count").textContent, over: art.querySelector(".xpost-count").classList.contains("over"),
      countColor: css(art.querySelector(".xpost-count"), "color"),
      id: art.querySelector(".xpost-id")?.textContent || "", copies: [...art.querySelectorAll(".xpost-foot .art-btn")].map((b) => b.dataset.name || b.textContent),
      shown: [...art.querySelectorAll(".xpost-foot .xpost-copy-label, .xpost-foot .art-btn")].map((b) => b.textContent).join(" "),
      footInside: [...art.querySelectorAll(".xpost-foot .art-btn")].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 0.5; }),
      width: Math.round(r.width), inside: r.left >= 0 && r.right <= window.innerWidth + 0.5,
      headOneLine: x.querySelector(".xpost-head").getBoundingClientRect().height <= 21,
    };
  });
};

// A post whose pictures are of every kind Copy image takes: a JPEG, a WebP,
// a GIF, and a JPEG too big for a phone's canvas.
function kinds(m) {
  return [
    "Pictures of every kind.",
    "",
    `\`\`\`xpost handle="ja818_" media="${m}/photo.jpg, ${m}/art.webp, ${m}/anim.gif, ${m}/huge.jpg" id="fs-020"`,
    "Four kinds.",
    "```",
  ].join("\n");
}

// What's on the clipboard now: its picture's type, size and the color of a
// pixel ([x, y] of it), or why it can't be read.
const CLIP = async ([x, y]) => {
  try {
    const items = await navigator.clipboard.read();
    const it = items.find((i) => i.types.includes("image/png"));
    if (!it) return { types: items.map((i) => i.types.join("+")).join(",") };
    const blob = await it.getType("image/png");
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    return { type: blob.type, w: bmp.width, h: bmp.height, px: [...g.getImageData(Math.round(x * bmp.width), Math.round(y * bmp.height), 1, 1).data].slice(0, 3) };
  } catch (e) { return { error: `${e.name}: ${e.message}` }; }
};
// Where it can't be read: the picture the page gave the clipboard, the same way.
const GIVEN = async ([x, y]) => {
  try {
    const blob = await Promise.resolve(window.__given);
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    return { type: blob.type, w: bmp.width, h: bmp.height, px: [...g.getImageData(Math.round(x * bmp.width), Math.round(y * bmp.height), 1, 1).data].slice(0, 3), given: true };
  } catch (e) { return { error: `${e.name}: ${e.message}` }; }
};
const near = (a, b, by = 24) => Array.isArray(a) && a.every((v, i) => Math.abs(v - b[i]) <= by);

// Copy image, as a tap (a real one: the browser's, as a finger's) on the
// post's n-th card's button of that name; what it says once it settles
// ("Copied", or ✓ for a number; else what it said).
async function tapCopy(page, n, name) {
  const sel = `.xpost-foot .art-btn[data-name="${name}"]`;
  await page.locator(".msg.claude .art-xpost").nth(n).locator(sel).click();
  await page.waitForFunction(({ n, sel }) => !/^(…|Copying…)$/.test(document.querySelectorAll(".msg.claude .art-xpost")[n].querySelector(sel).textContent),
    { n, sel }, { timeout: 10000 }).catch(() => {});
  return page.evaluate(({ n, sel }) => document.querySelectorAll(".msg.claude .art-xpost")[n].querySelector(sel).textContent, { n, sel });
}
const copied = (t) => t === "Copied" || t === "✓";

// Copy image, every way it goes: the picture itself on the clipboard, read
// back (where reads: clip, the clipboard can be read here), asked for in
// the tap; a GIF and a browser that won't: said, and full screen.
async function copies(page, layout, m, { shot, clip = true } = {}) {
  const hold = layout === "phone" ? "hold it" : "right-click it";
  await page.evaluate(() => closeSheets());
  await mount(page, reply(m, false));
  await page.waitForFunction(() => [...document.querySelectorAll(".xpost img")].every((i) => i.complete), null, { timeout: 10000 });
  // Asked for in the tap itself, a promise of the picture (Safari's rule).
  await page.evaluate(() => {
    window.__tap = false;
    window.addEventListener("click", () => { window.__tap = true; setTimeout(() => { window.__tap = false; }, 0); }, true);
    const write = navigator.clipboard.write.bind(navigator.clipboard), Item = window.ClipboardItem;
    window.__asked = [];
    navigator.clipboard.write = (items) => { window.__asked.push({ tap: window.__tap }); return write(items); };
    window.ClipboardItem = function (o, opts) {
      window.__promised = Object.values(o).every((v) => v instanceof Promise);
      window.__given = o["image/png"];
      return new Item(o, opts);
    };
    window.ClipboardItem.supports = Item.supports;
  });
  let after = await tapCopy(page, 0, "Copy image");
  const asked = await page.evaluate(() => ({ asked: window.__asked, promised: window.__promised }));
  check(layout, asked.asked.length >= 1 && asked.asked[0].tap && asked.promised, `Copy image asks for the copy in the tap, the picture as a promise (${JSON.stringify(asked)})`);
  check(layout, after === "Copied", `Copy image: Copied (${after})`);
  {
    const got = await page.evaluate(clip ? CLIP : GIVEN, [0.02, 0.02]);
    check(layout, got.type === "image/png" && got.w === 540 && got.h === 960 && near(got.px, [255, 173, 31], 8),
      `the picture itself ${clip ? "is on the clipboard" : "is given the clipboard"}, a PNG, its size and colors (${JSON.stringify(got)})`);
  }
  await page.waitForTimeout(1600);
  check(layout, (await page.evaluate(() => document.querySelectorAll(".msg.claude .art-xpost")[0].querySelectorAll(".xpost-foot .art-btn")[1].textContent)) === "Copy image",
    "then it says Copy image again");

  // Every kind: a JPEG and a WebP drawn to a PNG, one too big made 4096 on its long side.
  await mount(page, kinds(m));
  await page.waitForFunction(() => [...document.querySelectorAll(".xpost img")].every((i) => i.complete), null, { timeout: 10000 });
  for (const [label, w, ht, px, what] of [["Copy image 1", 1200, 800, [240, 40, 40], "a JPEG, as a PNG"], ["Copy image 2", 640, 640, [40, 200, 90], "a WebP, as a PNG"],
    ["Copy image 4", 4096, 819, [30, 60, 230], "one too big, 4096 on its long side"]]) {
    after = await tapCopy(page, 0, label);
    const got = await page.evaluate(clip ? CLIP : GIVEN, [0.02, 0.5]);
    check(layout, after === "✓" && got.type === "image/png" && got.w === w && got.h === ht && near(got.px, px),
      `${label}: ${what}, ✓ on its number (${after} ${JSON.stringify(got)})`);
    await page.waitForTimeout(1600);
  }
  // A GIF: it would be a still, so it's said, and full screen to save it moving.
  after = await tapCopy(page, 0, "Copy image 3");
  await page.waitForSelector(".sheet-back.photo", { timeout: 5000 }).catch(() => {});
  let seen = await page.evaluate(() => ({ toast: document.querySelector(".toast")?.textContent || "", label: document.querySelector(".ui-photo-label")?.textContent || "",
    src: document.querySelector(".ui-photo-img")?.getAttribute("src") || "" }));
  check(layout, seen.toast === `A GIF would copy as a still: ${hold} to save it` && seen.label === "3 of 4" && /anim\.gif$/.test(seen.src) && after === "3",
    `a GIF: said, and full screen to save it moving (${JSON.stringify(seen)})`);
  if (shot) { await page.waitForTimeout(400); await shot("copy-gif"); }
  await page.evaluate(() => closeSheets());

  // A browser that won't: said, and the picture full screen to hold and save.
  await page.evaluate(() => { navigator.clipboard.write = () => Promise.reject(new DOMException("Not allowed", "NotAllowedError")); });
  after = await tapCopy(page, 0, "Copy image 2");
  await page.waitForSelector(".sheet-back.photo", { timeout: 5000 }).catch(() => {});
  seen = await page.evaluate(() => ({ toast: document.querySelector(".toast")?.textContent || "", label: document.querySelector(".ui-photo-label")?.textContent || "",
    src: document.querySelector(".ui-photo-img")?.getAttribute("src") || "" }));
  check(layout, seen.toast === `Can't copy the picture here: ${hold} to save or copy it` && seen.label === "2 of 4" && /art\.webp$/.test(seen.src) && after === "2",
    `a browser that won't copy it: said, and the picture full screen to save (${JSON.stringify(seen)})`);
  if (shot) { await page.waitForTimeout(400); await shot("copy-refused"); }
  await page.evaluate(() => closeSheets());
  // One with no clipboard for pictures at all (an old browser, a page that isn't https).
  await page.evaluate(() => { delete window.ClipboardItem; });
  await tapCopy(page, 0, "Copy image 1");
  await page.waitForSelector(".sheet-back.photo", { timeout: 5000 }).catch(() => {});
  seen = await page.evaluate(() => ({ toast: document.querySelector(".toast")?.textContent || "", label: document.querySelector(".ui-photo-label")?.textContent || "" }));
  check(layout, seen.toast === `Can't copy the picture here: ${hold} to save or copy it` && seen.label === "1 of 4", `no clipboard for pictures: the same (${JSON.stringify(seen)})`);
  await page.evaluate(() => closeSheets());
}

async function run(browser, base, layout, home, video) {
  console.log(`\n${layout}`);
  const ctx = await browser.newContext({ ...LAYOUTS[layout], extraHTTPHeaders: { "Tailscale-User-Login": "tester@test" } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base.replace(/\/$/, "") });
  await ctx.addInitScript(() => localStorage.setItem("tour", "1"));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const look = async (theme) => {
    await page.goto(base);
    await page.waitForSelector("#look", { state: "attached" });
    const r = await page.evaluate((theme) => fetch("/api/look", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme }) }).then((r) => r.status), theme);
    await page.goto(base);
    await page.waitForSelector("#look", { state: "attached" });
    await page.evaluate(() => document.fonts.ready);
    return r;
  };
  const m = path.join(home, "media");
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${layout}-${name}.png`), fullPage: false });
  const toCard = (n) => page.evaluate((n) => document.querySelectorAll(".msg.claude .art-xpost")[n].scrollIntoView({ block: "start" }), n);

  for (const theme of ["tokyo-night", "catppuccin-latte"]) {
    const dark = theme === "tokyo-night";
    const status = await look(theme);
    check(layout, status === 200, `the app wears ${theme} (${status})`);
    await mount(page, reply(m, video));
    // Its pictures come: wait for every one that can.
    await page.waitForFunction(() => [...document.querySelectorAll(".xpost img")].every((i) => i.complete), null, { timeout: 10000 });
    await page.waitForTimeout(400);
    const p = await page.evaluate(READ);
    const [a, b, c, d] = p;
    const want = dark ? { bg: "rgb(0, 0, 0)", text: "rgb(231, 233, 234)", muted: "rgb(113, 118, 123)" } : { bg: "rgb(255, 255, 255)", text: "rgb(15, 20, 25)", muted: "rgb(83, 100, 113)" };
    const where = `${layout} ${dark ? "dark" : "light"}`;
    check(where, p.length === 4 && p.every((x) => x.open), `four posts, each open (${p.length})`);
    check(where, a.bg === want.bg && a.textColor === want.text && a.handleColor === want.muted && !a.linkColor,
      `X's ${dark ? "dark" : "light"} look, not the theme's (${a.bg} ${a.textColor} ${a.handleColor})`);
    check(where, b.linkColor === "rgb(29, 155, 240)", `links in X's blue (${b.linkColor})`);
    check(where, a.font === "15px/20px" && /TwitterChirp|apple-system|Segoe|Roboto|Helvetica|Arial|sans-serif/.test(a.family) && !/mono/i.test(a.family),
      `X's type: 15px on 20px, a sans font (${a.font} ${a.family})`);
    check(where, a.avatar.w === 40 && a.avatar.h === 40 && a.avatar.round === "50%" && a.avatar.img, `a 40px round avatar, its picture (${JSON.stringify(a.avatar)})`);
    check(where, !d.avatar.img && d.avatar.initial === "J", `no avatar: the name's first letter (${JSON.stringify(d.avatar)})`);
    check(where, a.name === "Julian Arango" && a.handle === "@ja818_" && a.time === "now" && b.handle === "@ja818_" && d.name === "ja818_",
      `the name, @handle · now ("@" or not; no name: the handle) (${[a.name, a.handle, a.time, b.handle, d.name]})`);
    check(where, a.textRaw === POST && a.text === POST, "the text exactly as written, its newlines kept");
    check(where, a.count === "278/280" && !a.over, `X's count under it (${a.count})`);
    check(where, JSON.stringify(b.links) === JSON.stringify(["@ja818_>https://x.com/ja818_", "#buildinpublic>https://x.com/hashtag/buildinpublic",
      "$TSLA>https://x.com/search?q=%24TSLA", "github.com/ja-818/amarchy…>https://github.com/ja-818/amarchy/pull/123", "gethouston.ai>https://gethouston.ai"]),
      `mentions, tags, cashtags and links as X makes them, a long link shortened (${JSON.stringify(b.links)})`);
    check(where, b.textRaw.replace("github.com/ja-818/amarchy…", "https://github.com/ja-818/amarchy/pull/123") === LINKS, "every other word as written");
    check(where, b.count === "136/280", `a link counts 23, an emoji 2 (${b.count})`);
    check(where, b.replying === "Replying to @vercel" && b.title === "Reply on X" && b.sub === "@ja818_ · to @vercel", `a reply: "Replying to @vercel" (${b.replying} | ${b.title} | ${b.sub})`);
    check(where, a.title === "Post on X" && a.sub === "@ja818_" && a.id === "fs-007", `its row and its id under it (${a.title} | ${a.sub} | ${a.id})`);
    const pics = video ? ["Copy image 1", "Copy image 4"] : ["Copy image 1", "Copy image 2", "Copy image 4"];
    check(where, JSON.stringify(p.map((x) => x.copies)) === JSON.stringify([["Copy text", "Copy image"], ["Copy text", "Copy image 1", "Copy image 2"],
      ["Copy text", "Copy image 1", "Copy image 2", "Copy image 3"], ["Copy text", ...pics]]),
      `Copy text, and Copy image for each picture by its place (none for a video, nor one that can't be shown) (${JSON.stringify(p.map((x) => x.copies))})`);
    check(where, a.shown === "Copy text Copy image" && b.shown === "Copy text Copy image 1 2" && c.shown === "Copy text Copy image 1 2 3",
      `one picture: Copy image; several: Copy image and a number for each (${[a.shown, b.shown, c.shown].join(" | ")})`);
    check(where, p.every((x) => x.footInside), "the buttons under it fit the page");
    check(where, c.quote && c.quote.href === "https://x.com/rauchg/status/1817981617478787443" && /@rauchg/.test(c.quote.text) && /x\.com\/rauchg\/status\/…/.test(c.quote.text) && c.title === "Quote on X",
      `a quote: its frame, who and its address (${JSON.stringify(c.quote)})`);
    check(where, c.over && c.count === "308/280" && c.countColor !== a.countColor, `over 280: the count in red (${c.count} ${c.countColor})`);
    const fits = await page.evaluate((t) => xpostCount(t), c.textRaw.slice(0, c.textRaw.length - c.past.length));
    check(where, !a.past && c.past.length > 0 && c.textRaw.endsWith(c.past) && fits <= 280 && fits > 270,
      `what goes past 280 is marked, as X's composer marks it (${JSON.stringify(c.past)}, ${fits} before it)`);
    check(where, c.headOneLine && a.headOneLine, "a long name stays on one line, cut short");
    check(where, p.every((x) => x.actions === 6 && x.more), `the action row: reply, repost, like, views, bookmark, share; ⋯ at the top (${p.map((x) => x.actions)})`);
    // The grid.
    const ma = a.media, mb = b.media, mc = c.media, md = d.media;
    check(where, ma && ma.tiles.length === 1 && Math.abs(ma.h / ma.w - 1.25) < 0.02 && ma.tiles[0].img && ma.radius === "16px",
      `one picture: its shape, no taller than 4:5, round corners (${ma && `${ma.w}x${ma.h} ${ma.radius}`})`);
    check(where, mb && mb.tiles.length === 2 && mb.tiles[0].y === mb.tiles[1].y && mb.tiles[1].x > mb.tiles[0].x && Math.abs(mb.h / mb.w - 9 / 16) < 0.02 && mb.tiles.every((t) => t.img),
      `two side by side, 16:9 (${JSON.stringify(mb && mb.tiles)})`);
    check(where, mc && mc.tiles.length === 3 && mc.tiles[0].h > mc.tiles[1].h * 1.9 && mc.tiles[1].x === mc.tiles[2].x && mc.tiles[2].y > mc.tiles[1].y,
      `three: the first tall, two beside it (${JSON.stringify(mc && mc.tiles)})`);
    check(where, md && md.tiles.length === 4 && md.tiles[0].y === md.tiles[1].y && md.tiles[2].y === md.tiles[3].y && md.tiles[2].y > md.tiles[0].y,
      `four in a square (${JSON.stringify(md && md.tiles)})`);
    check(where, md.tiles[2].missing && !md.tiles[0].missing && (video ? md.tiles[1].video : true), `a picture that can't be shown says so; a video is a video (${JSON.stringify(md.tiles)})`);
    check(where, p.every((x) => x.inside) && (layout === "wide" ? p.every((x) => x.width <= 600) : p.every((x) => x.width >= 300)),
      `inside the page, at most X's column wide (${p.map((x) => x.width)})`);
    const overflow = await page.evaluate(() => window.__chat.scroller.scrollWidth - window.__chat.scroller.clientWidth);
    check(where, overflow <= 1, `no sideways scroll (${overflow}px)`);
    const file = await page.evaluate(() => { const i = document.querySelector(".msg.claude .art-file .art-shot img"); return i ? `${i.naturalWidth}x${i.naturalHeight}` : null; });
    check(where, file === "800x450", `a file block's picture is shown too (${file})`);
    const missing = await page.evaluate(() => document.querySelectorAll(".msg.claude .art-xpost")[3].querySelector(".xpost-missing")?.textContent);
    check(where, missing === "Can't show missing.png", `what can't be shown, by name (${missing})`);
    const toFoot = (n) => page.evaluate((n) => document.querySelectorAll(".msg.claude .art-xpost")[n].querySelector(".xpost-foot").scrollIntoView({ block: "center" }), n);
    await toFoot(0); await shot(`${dark ? "dark" : "light"}-foot`);
    await toFoot(2); await shot(`${dark ? "dark" : "light"}-foot-three`);
    await toCard(0); await shot(`${dark ? "dark" : "light"}-post`);
    await toCard(1); await shot(`${dark ? "dark" : "light"}-reply`);
    await toCard(2); await shot(`${dark ? "dark" : "light"}-quote`);
    await toCard(3); await shot(`${dark ? "dark" : "light"}-four`);
  }

  // Copy text: the exact text.
  await page.evaluate(() => { window.__copyText = window.copyText; window.copyText = async (t) => { window.__copied = t; }; });
  await page.evaluate(() => document.querySelectorAll(".msg.claude .art-xpost")[0].querySelector(".xpost-foot .art-btn").click());
  await page.waitForTimeout(100);
  check(layout, (await page.evaluate(() => window.__copied)) === POST, "Copy text copies the exact text");
  await page.evaluate(() => { window.copyText = window.__copyText; });
  // A tap on a picture: full screen, the post's pictures to go through.
  await page.evaluate(() => document.querySelectorAll(".msg.claude .art-xpost")[1].querySelectorAll(".xpost-tile")[1].click());
  await page.waitForSelector(".sheet-back.photo");
  const photo = await page.evaluate(() => ({ label: document.querySelector(".ui-photo-label").textContent, src: document.querySelector(".ui-photo-img").getAttribute("src") }));
  check(layout, photo.label === "2 of 2" && /media\?src=.*b\.png$/.test(photo.src), `a tap on a picture shows it full screen, 2 of 2 (${JSON.stringify(photo)})`);
  await shot("photo");
  await page.evaluate(() => closeSheets());
  // Folded, it's its row.
  await page.evaluate(() => document.querySelectorAll(".msg.claude .art-xpost")[0].querySelector(".art-toggle").click());
  const folded = await page.evaluate(() => { const a = document.querySelectorAll(".msg.claude .art-xpost")[0]; return { open: a.classList.contains("open"), card: !!a.querySelector(".xpost") }; });
  check(layout, !folded.open && !folded.card, "a tap on its row folds it");
  // The pictures the server gives: only pictures and videos, from your home or /tmp.
  const got = await page.evaluate(async ({ sid, m }) => {
    const get = async (src, headers = {}) => { const r = await fetch(`/api/session/${sid}/media?src=${encodeURIComponent(src)}`, { headers });
      return `${r.status} ${r.headers.get("content-type") || ""}${r.headers.get("content-range") ? ` ${r.headers.get("content-range")}` : ""}`; };
    return { png: await get(`${m}/a.png`), rel: await get("../media/a.png"), home: await get("~/media/a.png"), text: await get(`${m}/notes.txt`),
      etc: await get("/etc/hostname"), none: await get(`${m}/missing.png`), lan: await get("https://127.0.0.1/a.png"),
      range: await get(`${m}/a.png`, { Range: "bytes=0-99" }), other: (await fetch(`/api/session/nope-nope/media?src=${encodeURIComponent(`${m}/a.png`)}`)).status };
  }, { sid: SID, m });
  check(layout, got.png === "200 image/png" && got.rel === "200 image/png" && got.home === "200 image/png",
    `a picture here, by its full path, ~/ or the chat's folder (${got.png} | ${got.rel} | ${got.home})`);
  check(layout, got.text.startsWith("404") && got.etc.startsWith("404") && got.none.startsWith("404") && got.other === 404,
    `nothing that isn't a picture or a video, outside your home or /tmp, or for no chat (${got.text} | ${got.etc} | ${got.none} | ${got.other})`);
  check(layout, got.lan.startsWith("404"), `never a picture from this machine or its network (${got.lan})`);
  check(layout, /^206 image\/png bytes 0-99\/\d+$/.test(got.range), `a part of it, as Safari asks for a video's (${got.range})`);
  // Copy image (last: it draws a post of its own).
  await copies(page, layout, m, { shot });
  check(layout, errors.length === 0, `no page errors (${errors.join("; ") || "none"})`);
  await ctx.close();
}

// Copy image in WebKit (Safari's engine, as an iPhone's): the same, where
// its clipboard can be read here, else what it does about it.
async function runWebKit(pw, base, home) {
  console.log("\nwebkit phone");
  let browser;
  try { browser = await pw.webkit.launch({ executablePath: process.env.WEBKIT || undefined }); } catch (e) { console.log(`  (no WebKit here: skipped: ${String(e.message).split("\n")[0]})`); return; }
  try {
    // (WebKit takes no clipboard permissions: whether the page may read it is seen below.)
    const ctx = await browser.newContext({ ...LAYOUTS.phone, extraHTTPHeaders: { "Tailscale-User-Login": "tester@test" } });
    await ctx.addInitScript(() => localStorage.setItem("tour", "1"));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.waitForSelector("#look", { state: "attached" });
    const m = path.join(home, "media");
    await page.evaluate(() => navigator.clipboard.writeText("probe")).catch(() => {});
    const clip = await page.evaluate(async () => { try { await navigator.clipboard.read(); return true; } catch (e) { return false; } });
    if (!clip) console.log("  (WebKit's clipboard can't be read here: the copies are checked by what the page sees)");
    await copies(page, "phone", m, { clip, shot: (name) => page.screenshot({ path: path.join(SHOTS, `webkit-${name}.png`) }) });
    check("webkit", errors.length === 0, `no page errors (${errors.join("; ") || "none"})`);
    await ctx.close();
  } finally {
    await browser.close();
  }
}

(async () => {
  const pw = loadPlaywright();
  const port = await freePort();
  const home = homes.home("xpost-view");
  const m = path.join(home, "media");
  fs.mkdirSync(m, { recursive: true });
  fs.mkdirSync(path.join(home, "work"), { recursive: true });
  png(path.join(m, "avatar.png"), 200, 200, [29, 155, 240], [249, 24, 128]);
  png(path.join(m, "tall.png"), 540, 960, [255, 173, 31], [120, 86, 255]);
  png(path.join(m, "wide.png"), 800, 450, [0, 186, 124], [29, 155, 240]);
  png(path.join(m, "a.png"), 600, 600, [244, 33, 46], [255, 212, 0]);
  png(path.join(m, "b.png"), 600, 800, [120, 86, 255], [0, 186, 124]);
  png(path.join(m, "c.png"), 800, 600, [29, 155, 240], [15, 20, 25]);
  png(path.join(m, "d.png"), 700, 700, [255, 255, 255], [249, 24, 128]);
  fs.writeFileSync(path.join(m, "notes.txt"), "not a picture\n");
  const video = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", path.join(m, "clip.mp4")]).status === 0;
  if (!video) console.log("(no ffmpeg: the video's checks are skipped)");
  const server = await startServer(port, home);
  const base = `http://127.0.0.1:${port}/`;
  const browser = await pw.chromium.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
  try {
    // A JPEG, a WebP and one too big, drawn by the browser; a GIF.
    const painter = await browser.newPage();
    const made = await painter.evaluate(async () => {
      const draw = async (w, ht, [r, g, b], type) => {
        const c = document.createElement("canvas");
        c.width = w; c.height = ht;
        const x = c.getContext("2d");
        x.fillStyle = `rgb(${r}, ${g}, ${b})`; x.fillRect(0, 0, w, ht);
        x.fillStyle = "#fff"; x.fillRect(w * 0.6, ht * 0.1, w * 0.3, ht * 0.3);
        const blob = await new Promise((ok) => c.toBlob(ok, type, 0.9));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin);
      };
      return { photo: await draw(1200, 800, [240, 40, 40], "image/jpeg"), art: await draw(640, 640, [40, 200, 90], "image/webp"),
               huge: await draw(5000, 1000, [30, 60, 230], "image/jpeg") };
    });
    await painter.close();
    fs.writeFileSync(path.join(m, "photo.jpg"), Buffer.from(made.photo, "base64"));
    fs.writeFileSync(path.join(m, "art.webp"), Buffer.from(made.art, "base64"));
    fs.writeFileSync(path.join(m, "huge.jpg"), Buffer.from(made.huge, "base64"));
    fs.writeFileSync(path.join(m, "anim.gif"), Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64"));
    for (const layout of Object.keys(LAYOUTS)) {
      if (ONLY && ONLY !== layout) continue;
      await run(browser, base, layout, home, video);
    }
    if (!ONLY || ONLY === "webkit") await runWebKit(pw, base, home);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\nscreenshots: ${SHOTS}`);
  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nall checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
