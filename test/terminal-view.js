// A chat's terminal in a browser, as a messaging app is: on the phone and on
// a computer alike. Under it a message line (the chat's own box, uiComposer):
// what's written goes to the terminal as one paste (bracketed, so a new line
// in it runs nothing), then Enter, the terminal taken out of tmux's copy mode
// first; sent empty, it's Enter alone (⏎); Enter sends, Shift+Enter is a new
// line; its draft is kept. A picture or a file pasted into it, or added with
// +, is saved in the project and its path typed (quoted); in Claude's classic
// terminal a picture goes into Claude's prompt (the clipboard, then Ctrl+V)
// and the line writes as you write to Claude. A finger held on the terminal
// (a right click on a computer) opens Paste and Select text there, and sends
// tmux no click; + has them too. Paste puts what you copied into the terminal
// (no Enter), or says how when the browser won't let it be read. Select text
// shows what the terminal printed as text to select (its addresses links),
// at its end; Copy all, Done, Esc. On the phone a swipe scrolls the terminal
// back (tmux's wheel), a flick goes on, a tap still focuses it (the
// keyboard); a key typed after scrolling back brings it back to its prompt
// first (on a computer, after the wheel). With screenshots of both layouts.
//
//   node test/terminal-view.js          both layouts
//   node test/terminal-view.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs (Chromium, playwright-core:
// PLAYWRIGHT_CORE=<its folder>).

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const homes = require("./homes");      // (test/homes.js: its home gone with it, however it ends)
const { loadPlaywright, freePort, startServer, findChrome, page, ready, until, sleep, check, failures } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "terminal-view-"));
const ONLY = process.argv[2];
const URL_LONG = "https://example.com/a/very/long/path/that/a/terminal/wraps?code=xyz";
const TEXT = [...Array.from({ length: 80 }, (_, i) => `line ${i}`), `Open ${URL_LONG} to sign in`, "Paste code here if prompted >"].join("\n");
const START = "\x1b[?1049h\x1b[?2004h\x1b[?1000h\x1b[?1002h\x1b[?1006h" + Array.from({ length: 40 }, (_, i) => `line ${i}\r\n`).join("") + "$ ";


async function run(browser, port, layout) {
  const p = await page(browser, layout, port);
  const got = [];         // what the page sent the terminal: {which, data}
  const uploads = [];
  const clips = [];
  await p.routeWebSocket(/\/tty\/(term|claude)/, (ws) => {
    const which = /tty\/claude/.test(ws.url()) ? "claude" : "term";
    ws.onMessage((m) => got.push({ which, data: typeof m === "string" ? m : Buffer.from(m).toString() }));
    // tmux's screen as it attaches: the mouse and bracketed pastes asked for.
    setTimeout(() => ws.send(Buffer.from(START)), 100);
  });
  await p.route("**/api/session/*/tty/*/text", (r) => r.fulfill({ json: { text: TEXT } }));
  await p.route("**/api/session/*/upload", (r) => {
    const b = r.request().postDataJSON();
    uploads.push(b);
    r.fulfill({ json: { path: `.amarchy/uploads/${b.name}`, full: `/tmp/f/.amarchy/uploads/${b.name}`, size: 4 } });
  });
  await p.route("**/api/clip", (r) => { clips.push(r.request().postDataJSON()); r.fulfill({ json: {} }); });
  for (const what of ["engine", "classic"]) await p.route(`**/api/session/*/${what}`, (r) => r.fulfill({ json: {} }));
  // The clipboard as the test says it is (window.__clip: text, or null when the browser won't let it be read).
  await p.addInitScript(() => {
    // The chat's terminals (terminal.js): the phone's view's, or the side panel's.
    window.__term = () => (typeof app !== "undefined" && app.session && app.session._terminal) || (typeof desk !== "undefined" && desk.terminal) || null;
    window.__clip = "";
    window.__copied = [];
    const no = () => Promise.reject(new DOMException("not allowed", "NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      read: () => (window.__clip === null ? no() : Promise.resolve(window.__clip === "" ? [] : window.__clip instanceof Blob ?
        [{ types: [window.__clip.type], getType: () => Promise.resolve(window.__clip) }] :
        [{ types: ["text/plain"], getType: () => Promise.resolve(new Blob([window.__clip], { type: "text/plain" })) }])),
      readText: () => (window.__clip === null ? no() : Promise.resolve(window.__clip)),
      writeText: (t) => { window.__copied.push(t); return Promise.resolve(); },
      write: () => Promise.resolve(),
    } });
  });
  // What went to a terminal, its resizes left out (the box growing a line resizes it).
  const sent = (which = "term") => got.filter((g) => g.which === which && !/^\{"resize"/.test(g.data)).map((g) => g.data);
  const clear = () => { got.length = 0; };
  const ev = (fn, arg) => p.evaluate(fn, arg);

  await p.goto("/");
  await ready(p);
  await ev(() => go("#/s/proj-fresh"));
  await until(p, () => (window.app && app.session) || (window.desk && desk.current === "proj-fresh"));
  if (layout === "phone") await ev(() => app.session.setMode("terminal", "term"));
  else await ev(() => sideToggle("term", true));
  // Connected, its screen drawn (and what the program asked for: the mouse, bracketed pastes).
  const drawn = () => { const t = __term(), a = t.active, b = a && a.term && a.term.buffer.active;
    if (!a || !a.live() || !a.term.modes.bracketedPasteMode) return false;
    for (let i = 0; i < b.length; i++) if (/line 39/.test(b.getLine(i).translateToString())) return true;
    return false; };
  check(layout, await until(p, drawn), "the terminal: connected, its screen drawn");
  await sleep(300);

  // ---- the message line
  const line = await ev(() => {
    const el = document.querySelector(".session-term:not([hidden]) .term-compose .composer.ui-composer.term-line");
    if (!el) return null;
    const f = el.querySelector("textarea"), box = document.querySelector(".session-term:not([hidden]) .term-body").getBoundingClientRect();
    return { placeholder: f.placeholder, cap: f.getAttribute("autocapitalize"), correct: f.getAttribute("autocorrect"), hint: f.getAttribute("enterkeyhint"),
             under: el.getBoundingClientRect().top >= box.bottom - 1, buttons: [...el.querySelectorAll(".cbtn")].filter((b) => !b.hidden).map((b) => b.getAttribute("aria-label")),
             inView: el.getBoundingClientRect().bottom <= innerHeight + 1 };
  });
  check(layout, !!line, "a message line under the terminal: the chat's own box (uiComposer)");
  if (!line) return;
  check(layout, line.under && line.inView, "under the terminal, in sight");
  check(layout, line.placeholder === "Type a command" && line.cap === "off" && line.correct === "off" && line.hint === "send",
        `a command's box: no capitals, no autocorrect, the keyboard's key says Send (${JSON.stringify(line)})`);
  check(layout, line.buttons[0] === "Paste, copy, a picture or a file" && line.buttons[line.buttons.length - 1] === "Enter",
        `+ on its left, ⏎ (Enter) on its right while it's empty (${line.buttons.join(", ")})`);
  await p.screenshot({ path: path.join(SHOTS, `${layout}-1-line.png`) });

  clear();
  await p.click(".session-term:not([hidden]) .term-line textarea");
  await p.keyboard.type("ls -la");
  check(layout, await ev(() => document.querySelector(".session-term:not([hidden]) .term-line .cbtn.send").getAttribute("aria-label") === "Send (and Enter)"),
        "with words: Send");
  await p.keyboard.press("Enter");
  await sleep(200);
  const one = sent();
  check(layout, one[0] === '{"bottom":true}' && one[1] === "\x1b[200~ls -la\x1b[201~" && one[2] === "\r" && one.length === 3,
        `Enter sends it: out of copy mode, then one paste (bracketed), then Enter (${JSON.stringify(one)})`);
  check(layout, await ev(() => { const f = document.querySelector(".session-term:not([hidden]) .term-line textarea"); return f.value === "" && document.activeElement === f; }),
        "the box empty after, the keyboard still in it");

  clear();
  await ev(() => document.querySelector(".session-term:not([hidden]) .term-line .cbtn.send").click());
  await sleep(150);
  check(layout, JSON.stringify(sent()) === JSON.stringify(['{"bottom":true}', "\r"]), `sent empty: Enter alone (${JSON.stringify(sent())})`);

  // Two sent at once: each its own paste, then its Enter, in order.
  clear();
  await ev(() => { const t = __term(); t.field.value = "one"; t.sendLine(); t.field.value = "two"; t.sendLine(); });
  await sleep(300);
  check(layout, JSON.stringify(sent()) === JSON.stringify(['{"bottom":true}', "\x1b[200~one\x1b[201~", "\r", '{"bottom":true}', "\x1b[200~two\x1b[201~", "\r"]),
        `two sent at once: in order, each its Enter (${JSON.stringify(sent())})`);
  clear();
  await p.keyboard.type("echo a");
  await p.keyboard.press("Shift+Enter");
  await p.keyboard.type("echo b");
  check(layout, await ev(() => document.querySelector(".session-term:not([hidden]) .term-line textarea").value === "echo a\necho b"), "Shift+Enter: a new line in the box");
  await p.keyboard.press("Enter");
  await sleep(200);
  check(layout, sent()[1] === "\x1b[200~echo a\recho b\x1b[201~" && sent()[2] === "\r", `two lines: one paste, then Enter (${JSON.stringify(sent())})`);

  // Its draft stays: away and back.
  await p.keyboard.type("half a com");
  if (layout === "phone") { await ev(() => app.session.setMode("chat")); await ev(() => app.session.setMode("terminal", "term")); }
  else { await ev(() => sideToggle("changes")); await ev(() => sideToggle("term")); }
  check(layout, await until(p, () => document.querySelector(".session-term:not([hidden]) .term-line textarea").value === "half a com"), "what you were writing stays, away and back");
  await ev(() => { const t = __term(); t.field.value = ""; t.lineTyped(); });

  // A file pasted into the box: saved in the project, its path typed, quoted.
  clear();
  await ev(() => {
    const f = document.querySelector(".session-term:not([hidden]) .term-line textarea");
    const dt = new DataTransfer();
    dt.items.add(new File(["png!"], "photo (2).png", { type: "image/png" }));
    f.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  check(layout, await until(p, () => document.querySelector(".session-term:not([hidden]) .term-line textarea").value === "'/tmp/f/.amarchy/uploads/photo (2).png'"),
        "a picture pasted into the box: saved in the project, its whole path typed, quoted");
  check(layout, uploads.length === 1 && uploads[0].name === "photo (2).png", "uploaded once, by its name");
  check(layout, !sent().length, "nothing sent to the terminal until you send it");
  await ev(() => { const t = __term(); t.field.value = ""; t.lineTyped(); });

  // ---- held (a right click on a computer): Paste and Select text, there
  const box = await ev(() => { const r = document.querySelector(".session-term:not([hidden]) .term-body").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 3 }; });
  clear();
  let cdp = null;
  if (layout === "phone") {
    cdp = await p.context().newCDPSession(p);
    await ev(() => document.activeElement && document.activeElement.blur());
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x, y: box.y }] });
    await sleep(700);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await p.mouse.click(box.x, box.y, { button: "right" });
  }
  const menu = await until(p, () => { const m = document.querySelector(".ui-dropdown"); return m && /Paste/.test(m.innerText) && /Select text/.test(m.innerText); });
  check(layout, menu, layout === "phone" ? "a finger held on the terminal: Paste and Select text" : "a right click on the terminal: Paste and Select text");
  const at = await ev(() => { const r = document.querySelector(".ui-dropdown").getBoundingClientRect(); return { top: r.top, left: r.left, bottom: r.bottom }; });
  check(layout, Math.abs(at.top - box.y) < 60 || Math.abs(at.bottom - box.y) < 60, `the menu where it was held (${JSON.stringify(at)} by ${JSON.stringify(box)})`);
  await sleep(200);
  check(layout, !sent().some((d) => /\x1b\[</.test(d)), `tmux got no click (${JSON.stringify(sent())})`);
  if (layout === "phone") check(layout, await ev(() => !document.activeElement || !document.activeElement.classList.contains("xterm-helper-textarea")), "no keyboard: the terminal wasn't focused");
  await p.screenshot({ path: path.join(SHOTS, `${layout}-2-held.png`) });

  // Paste: what you copied, into the terminal, no Enter.
  clear();
  await ev(() => { window.__clip = "secret-code-123"; });
  await ev(() => [...document.querySelectorAll(".ui-dropdown .ui-drop-row")].find((b) => /Paste/.test(b.innerText)).click());
  await sleep(250);
  check(layout, JSON.stringify(sent()) === JSON.stringify(['{"bottom":true}', "\x1b[200~secret-code-123\x1b[201~"]),
        `Paste: what you copied, into the terminal, at its bottom, no Enter (${JSON.stringify(sent())})`);
  // A picture copied: saved in the project, its path typed into the terminal.
  clear();
  await ev(() => { window.__clip = new Blob(["png!"], { type: "image/png" }); });
  await ev(() => __term().pasteClip());
  for (let i = 0; i < 30 && sent().length < 2; i++) await sleep(100);
  check(layout, uploads.length === 2 && uploads[1].name === "pasted.png" &&
        JSON.stringify(sent()) === JSON.stringify(['{"bottom":true}', "\x1b[200~/tmp/f/.amarchy/uploads/pasted.png \x1b[201~"]),
        `Paste, a picture copied: saved in the project, its path typed into the terminal (${JSON.stringify(sent())})`);
  // Nothing copied: says so.
  clear();
  await ev(() => { window.__clip = ""; });
  await ev(() => __term().pasteClip());
  check(layout, await until(p, () => /Nothing to paste/.test((document.querySelector(".toast") || {}).innerText || "")) && !sent().length, "Paste, nothing copied: it says so");
  // The browser won't let it be read: says how instead.
  clear();
  await ev(() => { window.__clip = null; });
  await ev(() => __term().pasteClip());
  check(layout, await until(p, () => /hold the box under the terminal/i.test((document.querySelector(".toast") || {}).innerText || "")),
        "a browser that won't let it be read: it says to hold the box and Paste there");
  check(layout, await ev(() => document.activeElement === document.querySelector(".session-term:not([hidden]) .term-line textarea")), "and the box is ready for it");
  check(layout, !sent().length, "nothing sent");
  await ev(() => document.activeElement.blur());

  // + has them too, and the pictures and files.
  await ev(() => document.querySelector(".session-term:not([hidden]) .term-line .cbtn.attach").click());
  const plus = await until(p, () => { const m = document.querySelector(".ui-dropdown"); return m && /Paste/.test(m.innerText) && /Select text/.test(m.innerText) && /A file/.test(m.innerText); });
  const plusItems = await ev(() => [...document.querySelectorAll(".ui-dropdown .ui-drop-row b")].map((b) => b.innerText));
  check(layout, plus && plusItems[0] === "Paste" && plusItems[1] === "Select text" && plusItems.includes(layout === "phone" ? "Photos" : "A picture"),
        `+ : Paste, Select text, then a picture or a file (${plusItems.join(", ")})`);
  await p.screenshot({ path: path.join(SHOTS, `${layout}-3-plus.png`) });

  // Select text: what it printed, as text, at its end.
  await ev(() => [...document.querySelectorAll(".ui-dropdown .ui-drop-row")].find((b) => /Select text/.test(b.innerText)).click());
  check(layout, await until(p, () => !!document.querySelector(".session-term:not([hidden]) .term-text .term-text-body")), "Select text: the terminal's text, in its place");
  const sel = await ev(() => {
    const pre = document.querySelector(".term-text-body"), css = getComputedStyle(pre);
    const a = [...pre.querySelectorAll("a")];
    return { text: pre.innerText, end: pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 2, select: css.userSelect || css.webkitUserSelect,
             link: a.length === 1 && a[0].getAttribute("href"), hidden: getComputedStyle(document.querySelector(".session-term:not([hidden]) .term-body > .term-box")).visibility };
  });
  check(layout, sel.text.trim() === TEXT, "all of it, as the host's tmux has it");
  check(layout, sel.end, "at its end, where you were");
  check(layout, sel.select === "text", `selectable, as a message (${sel.select})`);
  check(layout, sel.link === URL_LONG, `its address a link, whole (${sel.link})`);
  check(layout, sel.hidden === "hidden", "the live terminal under it hidden meanwhile");
  await p.screenshot({ path: path.join(SHOTS, `${layout}-4-select.png`) });
  await ev(() => [...document.querySelectorAll(".term-text-bar button")].find((b) => b.innerText === "Copy all").click());
  check(layout, await until(p, (TEXT) => window.__copied.includes(TEXT), TEXT), "Copy all: all of it on the clipboard");
  await ev(() => [...document.querySelectorAll(".term-text-bar button")].find((b) => b.innerText === "Done").click());
  check(layout, await until(p, () => !document.querySelector(".term-text")), "Done: the terminal again");
  if (layout === "wide") {
    await ev(() => __term().selectText());
    await until(p, () => !!document.querySelector(".term-text"));
    await p.keyboard.press("Escape");
    check(layout, await until(p, () => !document.querySelector(".term-text")), "Esc: the terminal again");
  }

  // Scrolled back, a key typed in the terminal: back at its prompt first, then
  // the key; the next key, just the key.
  const typedAfter = async () => {
    clear();
    await ev(() => __term().active.term.focus());
    await p.keyboard.type("y");
    await sleep(150);
    check(layout, JSON.stringify(sent()) === JSON.stringify(['{"bottom":true}', "y"]), `scrolled back, a key typed: back at the prompt first, then the key (${JSON.stringify(sent())})`);
    clear();
    await p.keyboard.type("z");
    await sleep(150);
    check(layout, JSON.stringify(sent()) === JSON.stringify(["z"]), `the next key: just the key (${JSON.stringify(sent())})`);
    await ev(() => document.activeElement.blur());
    clear();
  };

  // ---- a finger: a swipe scrolls it back (tmux's wheel), a tap still focuses it
  if (layout === "phone") {
    clear();
    const swipe = async (from, to) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x, y: from }] });
      const steps = 20;
      for (let i = 1; i <= steps; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x, y: from + ((to - from) * i) / steps }] });
        await sleep(30);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    const scrollY = await ev(() => document.scrollingElement.scrollTop);
    await swipe(box.y, box.y + 240);
    await sleep(100);
    const ups = sent().filter((d) => /^\x1b\[<64;/.test(d)).length;
    const cell = await ev(() => { const t = __term().active; return t.el.querySelector(".xterm-screen").clientHeight / t.term.rows; });
    check(layout, ups >= Math.floor(240 / (cell * 5)) && ups <= Math.ceil(240 / (cell * 5)) + 1, `a swipe down: tmux's wheel up, a turn per 5 lines the finger went (${ups}, cell ${cell.toFixed(1)}px)`);
    check(layout, !sent().some((d) => /^\x1b\[<65;/.test(d)), "and never down");
    check(layout, await ev((y) => document.scrollingElement.scrollTop === y, scrollY), "the page didn't move");
    await typedAfter();
    clear();
    await swipe(box.y + 240, box.y);
    await sleep(100);
    check(layout, sent().filter((d) => /^\x1b\[<65;/.test(d)).length >= 1 && !sent().some((d) => /^\x1b\[<64;/.test(d)), "a swipe up: back down");
    // A flick: it goes on after the finger's gone.
    clear();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x, y: box.y }] });
    for (let i = 1; i <= 4; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x, y: box.y + i * 40 }] }); await sleep(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const lifted = sent().filter((d) => /^\x1b\[<64;/.test(d)).length;
    await sleep(900);
    check(layout, sent().filter((d) => /^\x1b\[<64;/.test(d)).length > lifted, "a flick goes on a while after the finger lifts");
    await sleep(1500);
    // A tap: the terminal's (the keyboard comes up), as before.
    clear();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x, y: box.y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    check(layout, await until(p, () => document.activeElement && document.activeElement.classList.contains("xterm-helper-textarea")), "a tap: the terminal has the keyboard");
    check(layout, await until(p, () => !document.querySelector(".ui-dropdown")), "no menu");
  } else {
    clear();
    await p.mouse.move(box.x, box.y);
    await p.mouse.wheel(0, -200);
    await sleep(200);
    check(layout, sent().some((d) => /^\x1b\[<64;/.test(d)), "the wheel still scrolls it back (tmux's)");
    await typedAfter();
    clear();
    await p.mouse.click(box.x, box.y);
    await sleep(200);
    check(layout, sent().some((d) => /^\x1b\[<0;/.test(d)), "a left click is still tmux's");
  }

  // ---- Claude's classic terminal: the line writes to Claude; a picture into its prompt
  await ev(() => __term().classic());
  check(layout, await until(p, () => __term().which() === "claude") && await until(p, drawn), "Claude's classic terminal");
  const cl = await ev(() => { const f = document.querySelector(".session-term:not([hidden]) .term-line textarea"); return { ph: f.placeholder, cap: f.getAttribute("autocapitalize"), correct: f.getAttribute("autocorrect") }; });
  check(layout, cl.ph === "Write to Claude" && cl.cap === "sentences" && cl.correct === "on", `the line writes to Claude: capitals, autocorrect (${JSON.stringify(cl)})`);
  clear();
  await p.click(".session-term:not([hidden]) .term-line textarea");
  await p.keyboard.type("/login");
  await p.keyboard.press("Enter");
  await sleep(250);
  check(layout, JSON.stringify(sent("claude")) === JSON.stringify(['{"bottom":true}', "\x1b[200~/login\x1b[201~", "\r"]), `to Claude: /login, then Enter (${JSON.stringify(sent("claude"))})`);
  clear();
  clips.length = 0;
  await ev(() => {
    const c = document.createElement("canvas"); c.width = 4; c.height = 4;
    return new Promise((ok) => c.toBlob((b) => {
      const dt = new DataTransfer();
      dt.items.add(new File([b], "shot.png", { type: "image/png" }));
      document.querySelector(".session-term:not([hidden]) .term-line textarea").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      ok();
    }, "image/png"));
  });
  for (let i = 0; i < 30 && !sent("claude").includes("\x16"); i++) await sleep(100);
  check(layout, clips.length === 1 && /^image\//.test(clips[0].type) && sent("claude").includes("\x16"),
        `a picture pasted into the line: into Claude's prompt (the clipboard, then Ctrl+V) (${clips.length} ${JSON.stringify(sent("claude"))})`);
  check(layout, uploads.length === 2, "not uploaded as a file");
  await ev(() => document.querySelector(".session-term:not([hidden]) .term-line .cbtn.attach").click());
  check(layout, await until(p, () => { const m = document.querySelector(".ui-dropdown"); return m && /Into Claude's prompt/.test(m.innerText); }), "+ : a picture goes into Claude's prompt");
  await p.screenshot({ path: path.join(SHOTS, `${layout}-5-classic.png`) });
  await ev(() => uiDropdownClose());
  await ev(() => __term().show("term"));
  check(layout, await until(p, () => document.querySelector(".session-term:not([hidden]) .term-line textarea").placeholder === "Type a command"), "back on the project's terminal: a command's box again");

  check(layout, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

(async () => {
  const pw = loadPlaywright();
  const home = homes.home("terminal-view");
  const port = await freePort();
  const server = await startServer(port, home);
  const browser = await pw.chromium.launch({ executablePath: findChrome() });
  try {
    for (const layout of ["phone", "wide"]) {
      if (ONLY && ONLY !== layout) continue;
      console.log(layout);
      await run(browser, port, layout).catch((e) => check(layout, false, `crashed: ${e.stack}`));
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
