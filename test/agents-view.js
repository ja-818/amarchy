// Your agents in a browser, on the phone and on a computer alike: besides
// your assistant, chats that live on (amarchy agents). On top of Chats, right
// after your assistant, in the host's order; each with its name and its
// picture (yours, else its initial on its project's color); never a mission:
// no Complete on its card, its head, its menu or its keys, no Stalled, no Done
// to complete, not new for Needs you, no priority. Asking you something, it's
// your move like any chat's, on top still (its row has the question). Its chat: its name and picture on the bar, "Message
// Fireship" in the box, no Done strip. Its sheet (name, picture, chime, Not an
// agent any more), the sheet that makes one, Settings' Agents and Tell me, the
// chimes' sheet with a tab each, and its own chime when it rings. With
// screenshots.
//
//   node test/agents-view.js          both layouts
//   node test/agents-view.js phone    one layout (phone | wide)
//
// Needs what test/today-view.js needs. Exits 0 when every check passed.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPlaywright, freePort, startServer, findChrome, page, ready, until, sleep, check, failures, CHATS, T, NOW } = require("./today-view.js");

const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "agents-view-"));
const ONLY = process.argv[2];

// Your agents among the chats, out of order (the board puts them on top):
// Fireship (no picture of yours: its initial), done and merged, quiet for
// days and unseen, which would make any other chat Done, Stalled and New;
// Scout, with a picture of yours; and another chat of Fireship's project.
const FIRESHIP = { id: "fireship-fireship", repo: "fireship", name: "fireship", task: "", status: "idle", engine: "chat", path: "/tmp/fs",
                   assistant: "agent", assistant_name: "Fireship", picture: "", chime: "elementary", unseen: true,
                   merged: { at: NOW - 3600, n: 1, since: 0 }, today: T({ goal: "Post every day", state: "done", at: NOW - 5 * 86400 }) };
const SCOUT = { id: "scout-scout", repo: "scout", name: "scout", task: "Scout", status: "idle", engine: "chat", path: "/tmp/sc", priority: "high",
                assistant: "agent", assistant_name: "Scout", picture: "0123456789ab", chime: "fairy", today: T({}) };
const NEAR = { id: "fireship-ideas", repo: "fireship", name: "ideas", task: "Ideas: next week", status: "idle", engine: "chat", path: "/tmp/fi",
               assistant: "near", assistant_name: "Fireship", today: T({ goal: "List next week's posts" }) };
const AGENTS = [SCOUT, ...CHATS.slice(1, 4), FIRESHIP, NEAR, ...CHATS.slice(4), CHATS[0]];

const kids = (p) => p.evaluate(() => [...board.box.children].filter((n) => !n.matches(".today-summary, .tcard.k-notice"))
  .map((n) => (n.matches("details") ? `section:${[...n.classList].find((c) => c.startsWith("today-"))}` : (n.querySelector(".tcard[data-id]") || n).dataset.id)));
const set = (p, id, o) => p.evaluate(([id, o]) => {
  app.view = { ...app.view, sessions: app.view.sessions.map((x) => (x.id === id ? { ...x, ...o, today: { ...x.today, ...(o.today || {}) } } : x)) };
  refresh();
}, [id, o]);
const back = (p) => p.evaluate((chats) => { app.view = { ...app.view, sessions: chats.map((c) => ({ ...c })) }; refresh(); }, AGENTS);
const sheetText = (p) => p.evaluate(() => { const s = [...document.querySelectorAll(".sheet")].pop(); return s ? s.innerText : ""; });

async function run(browser, port, layout) {
  const where = layout;
  const p = await page(browser, layout, port, { chats: AGENTS });
  for (const what of ["agent", "assistant", "priority"]) {
    await p.route(`**/api/session/*/${what}`, (r) => { p.posts.push({ url: r.request().url(), body: r.request().postDataJSON() }); r.fulfill({ json: {} }); });
  }
  await p.route("**/api/sound", (r) => {
    const b = r.request().postDataJSON();
    p.posts.push({ url: r.request().url(), body: b });
    r.fulfill({ json: { sounds: [{ name: "kalimba", label: "Kalimba" }, { name: "tine", label: "Tine" }], sound: "kalimba", assistant_sound: "herald",
                        agent_sounds: { "fireship-fireship": b.agent === "fireship-fireship" ? b.name : "elementary", "scout-scout": "fairy" } } });
  });
  await p.goto("/");
  await ready(p);
  await until(p, () => !!document.querySelector(".board-today .tcard[data-id=fireship-fireship]"));

  // On top: your assistant, then your agents in the host's order, then At work.
  const order = await kids(p);
  check(where, JSON.stringify(order.slice(0, 4)) === JSON.stringify(["me-jaken", "scout-scout", "fireship-fireship", "section:today-working"]),
        `your assistant, your agents, then At work (${order.slice(0, 5).join(", ")})`);
  const card = await p.evaluate(() => {
    const c = document.querySelector(".board-today .tcard[data-id=fireship-fireship]"), s = document.querySelector(".board-today .tcard[data-id=scout-scout]");
    const letter = c.querySelector(".tcard-head svg.avatar.letter");
    return { assistant: c.classList.contains("k-assistant"), title: c.querySelector(".tcard-head").innerText.includes("Fireship"),
             letter: letter ? letter.textContent : "", hue: letter ? /ph-\d/.test(letter.getAttribute("class")) : false,
             size: letter ? Math.round(letter.getBoundingClientRect().width) : 0,
             chip: !!c.querySelector(".tcard-chip"), flag: !!s.querySelector(".prio"), complete: [...c.querySelectorAll(".tbtn")].some((b) => /Complete/.test(b.innerText)),
             pill: (c.querySelector(".tpill") || {}).innerText || "", sub: (c.querySelector(".tcard-sub") || {}).innerText || "",
             pic: (s.querySelector(".tcard-head img.avatar") || {}).getAttribute ? s.querySelector(".tcard-head img.avatar").getAttribute("src") : "" };
  });
  check(where, card.assistant && card.title && !card.chip, `an agent's card: its name, as your assistant's is (${JSON.stringify(card)})`);
  check(where, card.letter === "F" && card.hue && card.size === 46, `no picture of yours: its initial, on its project's color, as big as a picture (${card.size})`);
  check(where, card.pic === "/picture/0123456789ab-192.png", `a picture of yours: that one (${card.pic})`);
  check(where, !card.flag, "pinned before it was an agent: no flag (it's on top whatever its priority)");
  check(where, !card.complete && !card.pill && !/Stalled|New|Merged|Done/.test(card.sub), `done, merged, quiet for days, unseen: still never to complete, no state pill, a conversation's row (${card.sub})`);
  const parts = await p.evaluate(() => { const q = todayParts(app.view); const ids = (l) => l.map((s) => s.id);
    return { fresh: ids(q.fresh), done: ids(q.done), stale: ids(q.stale), ready: ids(q.ready), agents: ids(q.agents), stalled: missionIsStalled(row("fireship-fireship")) }; });
  check(where, JSON.stringify(parts.agents) === JSON.stringify(["scout-scout", "fireship-fireship"]) && ![...parts.fresh, ...parts.done, ...parts.stale, ...parts.ready].some((id) => /scout|fireship-fireship/.test(id)) && !parts.stalled,
        `not new, done, stalled or in Now (${JSON.stringify(parts)})`);
  check(where, /Complete all 2/.test(await p.evaluate(() => document.querySelector(".today-now .tsec-head").innerText)), "Complete all counts the chats, not the agent");
  check(where, await p.evaluate(() => [...document.querySelectorAll(".today-now .tcard[data-id=fireship-ideas] .tcard-chip")].some((c) => c.innerText === "Fireship")),
        "another chat of its project: in Now, under its name");
  await p.screenshot({ path: path.join(SHOTS, `${where}-agents.png`), fullPage: true });

  // At work: still on top, typing…. Asking you something: your move, on top still, its question and its picture.
  await set(p, "fireship-fireship", { status: "working" });
  check(where, await until(p, () => /typing…/.test((document.querySelector(".board-today > .tcard[data-id=fireship-fireship] .tcard-sub, .board-today > * > .tcard[data-id=fireship-fireship] .tcard-sub") || {}).innerText || "")),
        "at work: on top still, typing…");
  check(where, await p.evaluate(() => !document.querySelector(".today-working .tcard[data-id=fireship-fireship]")), "not under At work");
  await set(p, "fireship-fireship", { status: "waiting", asks: "Claude asks to post on X" });
  check(where, await until(p, () => { const c = document.querySelector(".board-today .tcard.k-assistant[data-id=fireship-fireship]"); return !!c && !c.closest(".today-now") && !!c.querySelector(".tcard-head .avatar") && /post on X/.test(c.innerText) && /asks you/.test(c.querySelector(".tcard-sub").innerText); }),
        "asking you: on top still, its question, its picture");
  check(where, await p.evaluate(() => todayCount(app.view, "chats") >= 1 && todayParts(app.view).asks.some((s) => s.id === "fireship-fireship")), "and counted as your move");
  await back(p);
  await until(p, () => !/asks you/.test((document.querySelector(".board-today .tcard[data-id=fireship-fireship] .tcard-sub") || {}).innerText || ""));

  // Its keys on the board: x and p do nothing to it.
  await p.evaluate(() => { const c = document.querySelector(".board-today .tcard[data-id=fireship-fireship] .tcard-head"); c.focus(); });
  const before = p.posts.length;
  await p.keyboard.press("x");
  await p.keyboard.press("p");
  await sleep(400);
  check(where, !(await p.$(".mission")) && !p.posts.slice(before).some((x) => /close|priority/.test(x.url)), "x and p on it: no Complete, no priority");
  await p.evaluate(() => todayComplete(row("fireship-fireship")));
  await sleep(300);
  check(where, !(await p.$(".mission")) && !p.posts.some((x) => /fireship-fireship\/close/.test(x.url)), "Complete asked anyway: it stays");

  // Its menu: no priority, no Complete; its line instead.
  await p.evaluate(() => rowMenu(row("fireship-fireship")));
  let t = await sheetText(p);
  check(where, /Fireship, an agent: name, picture, chime/.test(t) && !/Complete/.test(t) && !/Pinned|For later/.test(t), `its menu: its line, no priority or Complete (${t.replace(/\n/g, " | ")})`);
  await p.evaluate(() => closeSheets());
  const items = await p.evaluate(() => sessionItems(row("fireship-fireship")).map((i) => i.label));
  check(where, items.includes("Fireship, an agent…") && !items.some((l) => /Complete|Pinned|For later/.test(l)), `a computer's menu too (${items.join(", ")})`);
  const plain = await p.evaluate(() => sessionItems(row("proj-done")).map((i) => i.label));
  check(where, plain.includes("Make it an agent…") && plain.includes("Complete mission"), "a chat's: Make it an agent…, Complete");

  // Its sheet: name, picture (its initial), chime; not an agent any more.
  await p.evaluate(() => agentSheet(row("fireship-fireship")));
  t = await sheetText(p);
  check(where, /An agent/i.test(t) && /Its chime/.test(t) && /Not an agent any more/.test(t) && !!(await p.$(".sheet svg.avatar.letter.big")), "its sheet: name, its initial big, chime, Not an agent any more");
  await sleep(500);
  await p.screenshot({ path: path.join(SHOTS, `${where}-agent-sheet.png`) });
  await p.evaluate(() => [...document.querySelectorAll(".sheet button")].find((b) => b.innerText === "Not an agent any more").click());
  check(where, await until(p, () => !document.querySelector(".sheet")) && p.posts.some((x) => /fireship-fireship\/agent$/.test(x.url) && x.body.off === true), "Not an agent any more: told to the host");
  // A chat made one, by the name you give it.
  await p.evaluate(() => agentSheet(row("proj-done")));
  t = await sheetText(p);
  check(where, /Make it an agent\?/.test(t) && /Make it my assistant/.test(t) && /takes the place of Jaken/.test(t), "a chat's sheet: an agent, or your assistant in Jaken's place");
  await sleep(500);
  await p.screenshot({ path: path.join(SHOTS, `${where}-make-agent.png`) });
  await p.evaluate(() => { const s = [...document.querySelectorAll(".sheet")].pop(); s.querySelector("input").value = "Studier"; [...s.querySelectorAll("button")].find((b) => b.innerText === "Make it an agent").click(); });
  check(where, await until(p, () => !document.querySelector(".sheet")) && p.posts.some((x) => /proj-done\/agent$/.test(x.url) && x.body.name === "Studier"), "Make it an agent: told to the host, its name");

  // The chimes: a tab each; one picked for Fireship goes as its own.
  await p.evaluate(() => soundSheet(null));
  check(where, await until(p, () => !!document.querySelector(".sheet .seg")), "the chimes' sheet");
  const tabs = await p.evaluate(() => [...document.querySelectorAll(".sheet .seg .control")].map((b) => b.innerText));
  check(where, JSON.stringify(tabs) === JSON.stringify(["Chats", "Jaken", "Scout", "Fireship"]), `a tab for the chats, your assistant and each agent (${tabs.join(", ")})`);
  await p.evaluate(() => [...document.querySelectorAll(".sheet .seg .control")].find((b) => b.innerText === "Fireship").click());
  check(where, await until(p, () => !!document.querySelector('.sheet .menu-item.on[data-sound="elementary"], .sheet .menu-item.on')), "Fireship's tab: its chime lit");
  await p.evaluate(() => document.querySelector('.sheet .menu-item[data-sound="tine"]').click());
  check(where, await until(p, () => true) && p.posts.some((x) => /\/api\/sound$/.test(x.url) && x.body.agent === "fireship-fireship" && x.body.name === "tine"), "picked: Fireship's own, told to the host");
  check(where, await until(p, () => row("fireship-fireship").chime === "tine"), "its row rings with it now");
  await p.evaluate(() => closeSheets());

  // It rings with its own chime, whatever the chats' alerts.
  const rang = await p.evaluate(() => {
    const played = [];
    const real = window.playSound;
    window.playSound = (src) => { played.push(src); return () => {}; };
    const v = { ...app.view, alerts: "assistant", sound: "kalimba", sessions: app.view.sessions.map((s) => ({ ...s, status: "working" })) };
    desk.statuses = null;
    chime(v);
    chime({ ...v, sessions: v.sessions.map((s) => (s.id === "scout-scout" || s.id === "proj-done2" ? { ...s, status: "waiting" } : s)) });
    window.playSound = real;
    return played;
  });
  check(where, JSON.stringify(rang) === JSON.stringify(["/sound/fairy"]), `an agent that needs you rings with its own chime, the chats' alerts off (${rang.join(", ")})`);

  // Settings: Agents, and Tell me.
  await p.evaluate(() => openSettings());
  check(where, await until(p, () => /Agents only/.test((document.querySelector(".sheet") || {}).innerText || "")), "Tell me: Agents only");
  t = await sheetText(p);
  check(where, /Jaken, Scout and Fireship, your agents, always tell you/.test(t), "and who always tells you");
  check(where, /Jaken: name, picture, chime/.test(t) && /Jaken is your assistant/.test(t) && /Scout: name, picture, chime/.test(t) && /Fireship: name, picture, chime/.test(t), "Agents: each, your assistant first");
  check(where, /Fireship's: Tine|Fireship's: Elementary/.test(t), "the chimes' line names each agent's");
  await p.evaluate(() => { const s = [...document.querySelectorAll(".sheet .section")].find((x) => x.innerText === "Agents"); if (s) s.scrollIntoView(); });
  await sleep(500);
  await p.screenshot({ path: path.join(SHOTS, `${where}-settings.png`) });
  await p.evaluate(() => closeSheets());

  // Its chat: its name and picture on the bar, no Complete, the box calls it by name, no Done strip.
  await p.evaluate(() => todayOpen(row("fireship-fireship")));
  check(where, await until(p, () => [...document.querySelectorAll(".head-title")].some((x) => x.offsetParent && x.querySelector("svg.avatar.letter") && /Fireship/.test(x.innerText))),
        "its chat: its picture and name on the bar");
  check(where, await p.evaluate(() => ![...document.querySelectorAll(".ui-action.complete")].some((b) => b.offsetParent)), "no Complete on the bar");
  check(where, await until(p, () => [...document.querySelectorAll("textarea")].some((x) => x.offsetParent && x.placeholder === "Message Fireship")), "the box: Message Fireship");
  check(where, await p.evaluate(() => ![...document.querySelectorAll(".chat-done, .done-strip")].some((x) => x.offsetParent)), "no Done strip, merged and done as it is");
  await sleep(300);
  await p.screenshot({ path: path.join(SHOTS, `${where}-agent-chat.png`) });
  check(where, !p.errors.length, `no page errors (${p.errors.join("; ")})`);
  await p.context().close();
}

if (require.main === module) (async () => {
  const pw = loadPlaywright();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agents-view-home-"));
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
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
})();
