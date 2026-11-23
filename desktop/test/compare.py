# The desktop app's window next to a browser's (Chromium), in phone and wide
# sizes: the same app, laid out the same. The board and a chat in each: the
# places of the bar, the cards, the chat's head, its box and its view, read
# in both and held to a few pixels (only the text inside may wrap a word
# differently, as Safari's does); their screenshots side by side, to look at.
#
#   python3 desktop/test/compare.py          exits 0 when every check passed
#
# Needs what shell-test.py needs, and Chromium with playwright-core
# (PLAYWRIGHT_CORE), as the app's view tests (test/today-view.js).

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("shell_test", HERE / "shell-test.py")
st = importlib.util.module_from_spec(spec)
spec.loader.exec_module(st)       # its Server, its homes under ~/.cache, check()

SIZES = {"phone": (390, 844), "wide": (1280, 800)}
PAGES = {"board": "#/today", "chat": "#/s/desk-long"}
# What's laid out, read the same way in both: each selector's boxes.
READ = """(() => {
  const sels = ['.board-head-in', '.tcard', '.chat-head', '.composer-wrap', '.chat-scroll'];
  const out = {};
  for (const s of sels) out[s] = [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null).slice(0, 6)
    .map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; });
  return out;
})()"""
SLACK = 3       # pixels a box may differ by (sub-pixel rounding, a font's metrics)

CHROME = r"""
const { loadPlaywright, findChrome } = require(process.argv[2]);
const [url, out, sizes, pages, read] = [process.argv[3], process.argv[4], JSON.parse(process.argv[5]), JSON.parse(process.argv[6]), process.argv[7]];
(async () => {
  const pw = loadPlaywright();
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  const got = {};
  for (const [name, [w, h]] of Object.entries(sizes)) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    // A browser's own notifications set aside ("Not now"), as the desktop
    // app's are its own: no "Notifications are off" card on its board.
    await ctx.addInitScript(() => localStorage.setItem("amarchy-push", "no"));
    const p = await ctx.newPage();
    for (const [page, hash] of Object.entries(pages)) {
      await p.goto(url + hash);
      await p.waitForFunction(() => typeof app !== "undefined" && app.view && document.fonts.status === "loaded");
      await p.waitForTimeout(2500);
      got[`${name}-${page}`] = await p.evaluate(read);
      await p.screenshot({ path: `${out}/chrome-${name}-${page}.png` });
    }
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(got));
})().catch((e) => { console.error(e); process.exit(1); });
"""


def main():
    st.need("Xvfb", "xdotool", "dbus-daemon", "import", "node")
    shots = st.SHOTS
    server = st.Server()
    try:
        # The browser's.
        script = Path(tempfile.mkdtemp(prefix="compare-")) / "chrome.js"
        script.write_text(CHROME)
        r = subprocess.run(["node", str(script), str(st.ROOT / "test/today-view.js"), server.url.rstrip("/") + "/", str(shots),
                            json.dumps(SIZES), json.dumps(PAGES), READ], capture_output=True, text=True, timeout=300)
        if r.returncode:
            raise SystemExit(f"Chromium didn't run: {r.stderr[-800:]}")
        chrome = json.loads(r.stdout.strip().splitlines()[-1])
        # The desktop app's.
        for name, size in SIZES.items():
            home = tempfile.mkdtemp(prefix="compare-home-")
            with st.Shell(server.url, home=home, env=st.env_for(st.fake_cli(home)), size=size) as w:
                for page, hash in PAGES.items():
                    w.js(f"location.hash = {json.dumps(hash)}; 1")
                    w.wait("typeof app !== 'undefined' && !!app.view && document.fonts.status === 'loaded'", timeout=40)
                    time.sleep(2.5)
                    mine = w.js(READ)
                    w.shot(shots / f"shell-{name}-{page}.png")
                    theirs = chrome[f"{name}-{page}"]
                    where = f"{name} {page}"
                    for sel, boxes in theirs.items():
                        got = mine.get(sel) or []
                        if not boxes and not got:
                            continue
                        same = len(got) == len(boxes) and all(
                            all(abs(a - b) <= SLACK for a, b in zip(g[:3], c[:3])) and abs(g[3] - c[3]) <= SLACK * 2
                            for g, c in zip(got, boxes))
                        st.check(same, f"{where}: {sel} laid out as in the browser ({got} / {boxes})")
                    side = shots / f"side-{name}-{page}.png"
                    tool = ["magick"] if shutil.which("magick") else ["convert"]
                    subprocess.run([*tool, str(shots / f"shell-{name}-{page}.png"), str(shots / f"chrome-{name}-{page}.png"),
                                    "+append", str(side)], check=True)
    finally:
        server.stop()
    print(f"side by side (the desktop app, then Chromium): {shots}/side-*.png")
    if st.failed:
        print(f"{len(st.failed)} failed")
        sys.exit(1)
    print("all passed")


if __name__ == "__main__":
    main()
