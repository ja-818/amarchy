// ---- the tour: amarchy in 100 seconds
//
// Why amarchy (stop babysitting your agents, manage them: a dozen Claude
// Codes on a computer that never sleeps, from your pocket), how it works (a website that box serves, private over
// Tailscale) and making it an app; then its features, a few to a slide, each
// a joke and what it does; then making it yours (a theme; agents and
// projects, and a new one of either). As slides (ui.js uiSlides) with pixel
// art in the theme's own colors (uiPixels): one theme changes every picture
// with the rest. The same slides and words on the phone and on a computer;
// only the layout fits.
//
// It opens by itself the first time an empty amarchy (no project, no chat
// yet) is opened on a device, over the welcome; and from the Amarchy menu
// (Tour), the welcome's Take the tour and Settings, whenever you like. Its
// themes slide wears a theme the moment you tap it, on every device, as the
// Look sheet does.

"use strict";

const tour = { auto: false, look: null, looking: null };

// ---- the pictures

// A little worker, its eyes in the hue given (a capital letter: they blink).
function tourBot(eye = "A") {
  return [
    ".....aa.....",
    "......t.....",
    "..tttttttt..",
    ".tkkkkkkkkt.",
    ".tkEEkkEEkt.",
    ".tkEEkkEEkt.",
    ".tkkkkkkkkt.",
    ".tkkmmmmkkt.",
    "..tttttttt..",
    "....tttt....",
    ".tttttttttt.",
    "t.tttttttt.t",
    "..tt....tt..",
  ].map((r) => r.replace(/E/g, eye));
}

// A server rack, its lights blinking, and the moon: it works while you sleep.
const TOUR_SERVER = [
  ".tttttttttttt.",
  "tkkkkkkkkkkkkt",
  "tkGkYkkkmmmmkt",
  "tkkkkkkkkkkkkt",
  "tttttttttttttt",
  "tkkkkkkkkkkkkt",
  "tkAkGkkkmmmmkt",
  "tkkkkkkkkkkkkt",
  "tttttttttttttt",
  "tkkkkkkkkkkkkt",
  "tkRkGkkkmmmmkt",
  "tkkkkkkkkkkkkt",
  ".tttttttttttt.",
  ".tt........tt.",
];
const TOUR_MOON = [
  "........Y..",
  "...yyyy....",
  ".yyyy......",
  ".yyy.......",
  "yyy........",
  "yyy......Y.",
  "yyy........",
  ".yyy.......",
  ".yyyy......",
  "...yyyy....",
];
const TOUR_ZZZ = [
  "........mmmm",
  "..........m.",
  ".........m..",
  "........mmmm",
  "............",
  "mmmmm.......",
  "...m........",
  "..m.........",
  ".m..........",
  "mmmmm.......",
];

// Branches: two chats' copies of the code, off main and back into it.
function tourBranches() {
  const m = uiPixmap(31, 15);
  m.line(0, 7, 30, 7, "t");
  m.line(3, 7, 8, 2, "a").line(8, 2, 16, 2, "a").line(16, 2, 21, 7, "a");
  m.line(10, 7, 14, 11, "g").line(14, 11, 22, 11, "g").line(22, 11, 26, 7, "g");
  m.box(0, 6, 3, 3, "t").box(27, 6, 3, 3, "t").box(13, 6, 3, 3, "t");
  m.box(9, 1, 3, 3, "A").box(13, 1, 3, 3, "a");
  m.box(16, 10, 3, 3, "g").box(19, 10, 3, 3, "G");
  return m;
}

// The streak's flame: what a merge earns.
const TOUR_FLAME = [
  ".....o......",
  ".....oo.....",
  "....ooo.....",
  "....oooo....",
  "...ooyoo....",
  "...ooyooo...",
  "..oooyyoo...",
  "..ooyyyooo..",
  ".oooyyyyoo..",
  ".ooyyyyyooo.",
  ".ooyyYYyyoo.",
  ".ooyyYYyyoo.",
  "..oyyYYyyo..",
  "...oyyyyo...",
  "....oooo....",
];

// The theme's hues in a row, each its own beat.
const TOUR_HUES = ["R", "O", "Y", "G", "C", "B", "P", "A"];
function tourSwatches() {
  const m = uiPixmap(TOUR_HUES.length * 5 - 1, 9);
  TOUR_HUES.forEach((c, i) => m.box(i * 5, i % 2 ? 2 : 0, 4, 7, c));
  return m;
}

// A phone with amarchy on its home screen, and a Mac with it in the Dock.
const TOUR_PHONE = [
  ".ttttttttt.",
  "tkkkkkkkkkt",
  "tkkkkkkkkkt",
  "tkrrrkgggkt",
  "tkrrrkgggkt",
  "tkrrrkgggkt",
  "tkkkkkkkkkt",
  "tkbbbkAAAkt",
  "tkbbbkAAAkt",
  "tkbbbkAAAkt",
  "tkkkkkkkkkt",
  "tkkkkkkkkkt",
  "tkkkkkkkkkt",
  "tkkkkkkkkkt",
  "tkkkkkkkkkt",
  "tkkkmmmkkkt",
  ".ttttttttt.",
];
function tourMac() {
  const m = uiPixmap(30, 18);
  m.box(2, 0, 26, 15, "k").frame(2, 0, 26, 15, "t");
  m.box(6, 2, 18, 7, "s").box(6, 2, 18, 1, "m");
  m.box(8, 11, 14, 3, "m");
  ["r", "g", "b", "y"].forEach((c, i) => m.box(9 + i * 3, 12, 2, 1, c));
  m.box(21, 12, 2, 1, "A").set(21, 11, "A").set(22, 11, "A");
  m.line(0, 15, 29, 15, "t").line(1, 16, 28, 16, "t").box(12, 15, 6, 1, "m");
  return m;
}

// The rocket: off you go.
const TOUR_ROCKET = [
  ".....aa.....",
  "....aaaa....",
  "....tttt....",
  "...tttttt...",
  "...ttkktt...",
  "...tkbbkt...",
  "...ttkktt...",
  "...tttttt...",
  "...tttttt...",
  "..rttttttr..",
  ".rrttttttrr.",
  ".rr.tttt.rr.",
  ".r...oo...r.",
  ".....YY.....",
  "....O..O....",
  ".....Y......",
];

// ---- the features' pictures: small, each in a square of one size

// Grass, and the sun over it: go touch it.
const TOUR_GRASS = [
  ".yy.........",
  "yYYy........",
  "yYYy........",
  ".yy.........",
  "............",
  "..g.....g...",
  "g.g..g..g.g.",
  "g.gg.g.gg.g.",
  "gggggggggggg",
  "gggggggggggg",
];

// A mic, recording.
const TOUR_MIC = [
  "....tttt....",
  "...taaaat...",
  "...taAAat...",
  "...taAAat...",
  "...taaaat...",
  ".t.taaaat.t.",
  ".t..tttt..t.",
  "..t......t..",
  "...tttttt...",
  "......t.....",
  "....tttt....",
];

// A bell, ringing.
const TOUR_BELL = [
  ".....yy...R.",
  "....yyyy....",
  "...yyyyyy...",
  "...yyyyyy...",
  "...yyyyyy...",
  "..yyyyyyyy..",
  ".yyyyyyyyyy.",
  ".yyyyyyyyyy.",
  "............",
  ".....yy.....",
];

// A ship, its sail up: ship it.
const TOUR_SHIP = [
  "......t.......",
  "......taa.....",
  "......taaa....",
  "......taaaa...",
  "......tAAAAa..",
  "......t.......",
  ".tttttttttttt.",
  "..tttttttttt..",
  "...tttttttt...",
  "bbbbbbbbbbbbbb",
  ".b..bb..bb..b.",
];

// A browser's window, playing: the preview.
const TOUR_PREVIEW = [
  "tttttttttttttt",
  "trtytgttttttmt",
  "tttttttttttttt",
  "t............t",
  "t....G.......t",
  "t....GG......t",
  "t....GGG.....t",
  "t....GG......t",
  "t....G.......t",
  "t............t",
  "tttttttttttttt",
];

// A list, two of it ticked off.
const TOUR_TASKS = [
  "ggg.........",
  "ggg.tttttttt",
  "ggg.........",
  "............",
  "ggg.........",
  "ggg.tttttt..",
  "ggg.........",
  "............",
  "mmm.........",
  "m.m.mmmmmmmm",
  "mmm.........",
];

// A padlock: your keys and passwords.
const TOUR_LOCK = [
  "...tttttt...",
  "..t......t..",
  "..t......t..",
  "..t......t..",
  ".yyyyyyyyyy.",
  ".yyyyyyyyyy.",
  ".yyyykkyyyy.",
  ".yyyykkyyyy.",
  ".yyyyykyyyy.",
  ".yyyyyyyyyy.",
];

// A keyboard, h j k l lit.
const TOUR_KEYBOARD = [
  "tttttttttttttttt",
  "t..............t",
  "t.m.m.m.m.m.m..t",
  "t..............t",
  "t.m.m.A.A.A.A..t",
  "t..............t",
  "t...mmmmmmmm...t",
  "t..............t",
  "tttttttttttttttt",
];

// Two branches off main and back into it: a chat's own copy of the code.
const TOUR_BRANCH = [
  "...AA....aa...",
  "...AA....aa...",
  "..a........a..",
  ".a..........a.",
  "tttttttttttttt",
  ".g..........g.",
  "..g........g..",
  "...GG....gg...",
  "...GG....gg...",
];

// Three columns of cards, the first one's at work: Now, At work, For later.
const TOUR_COLUMNS = [
  "aaa.mmm.mmm",
  "...........",
  "ttt.ttt.ttt",
  "tRt.tmt.tmt",
  "ttt.ttt.ttt",
  "...........",
  "ttt.ttt....",
  "tGt.tmt....",
  "ttt.ttt....",
  "...........",
  "ttt........",
  "tmt........",
  "ttt........",
];

// A terminal's window, its prompt and cursor.
const TOUR_PROMPT = [
  "tttttttttttttt",
  "trtytgtttttttt",
  "t............t",
  "t.g..........t",
  "t..g.........t",
  "t...g........t",
  "t..g.........t",
  "t.g...AAAA...t",
  "t............t",
  "tttttttttttttt",
];

// Lines, the first one lit: the reply's answer first, its details folded.
const TOUR_BRIEF = [
  "tttttttttttttt",
  "t............t",
  "t.aaaaaaaaa..t",
  "t.mmmmmm.....t",
  "t............t",
  "t.AAAA.mmmm..t",
  "t............t",
  "tttttttttttttt",
  "..tt..........",
  "..t...........",
];

// ---- the slides

// What you'd tap to start: a project (with none yet), else a chat.
function tourStart() {
  const none = boardEmpty();
  const after = (fn) => () => { closeSheets(); fn(); };
  if (none) {
    const add = (how) => after(() => (app.desk ? (how === "github" ? newProject() : emptyProject("")) : newProjectSheet((p) => newChatIn(p), how)));
    return [uiButton("Add a project from GitHub", add("github"), true), uiButton("Start an empty project", add("empty"))];
  }
  return [uiButton("Start a chat", after(() => boardNew()), true)];
}

// The themes and the one worn (/api/look), fetched once a tour opens: there
// by the time you get to them.
function tourLook() {
  if (!tour.looking) tour.looking = fetch("/api/look").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((info) => { tour.look = info; }).catch(() => { tour.looking = null; });
  return tour.looking;
}

// How many themes there are, in words (until they've come: a pile of them).
function tourThemesCount() {
  return `${(tour.look && tour.look.themes.length) || "A pile of"} themes`;
}

// The themes, a card each in its own colors: a tap wears it, here and on
// every phone and browser of yours (as the Look sheet: the last one tapped
// is the one kept). All of it: Theme, font and wallpaper….
function tourThemes() {
  const row = h("div", { class: "ui-slide-row row-btns", role: "group", "aria-label": "Themes" });
  let picks = Promise.resolve(), want = null;
  const draw = () => {
    const info = tour.look;
    if (!info) return row.replaceChildren(h("p", { class: "ui-slide-aside" }, "Fetching the themes…"));
    const worn = want || (app.view && app.view.look && app.view.look.theme) || info.theme;
    // (Patched, not redrawn: a card the keys or a finger are on stays that card.)
    const first = !row.querySelector(".theme-card");
    const count = row.closest(".ui-slide") && row.closest(".ui-slide").querySelector(".tour-themes-count");
    if (count) count.textContent = tourThemesCount();      // (come since the slide was drawn)
    uiPatch(row, info.themes.map((t) => themeCard(t, t.key === worn, (e) => pick(t.key, e.currentTarget))));
    // The one worn in sight, in the middle, as the row first comes.
    if (first) requestAnimationFrame(() => {
      const on = row.querySelector(".theme-card.on");
      if (on) row.scrollLeft = on.offsetLeft - row.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
    });
  };
  const pick = (key, el) => {
    if (key === (want || (app.view && app.view.look && app.view.look.theme) || (tour.look && tour.look.theme))) return;
    want = key;
    draw();
    if (el) el.classList.add("busy");
    picks = picks.then(async () => {
      try { tour.look = await api("/api/look", { theme: key }); lookWorn(tour.look); }
      catch (err) { toast(err.message); }
      if (want === key) want = null;
      draw();
    });
  };
  if (!tour.look) tourLook().then(() => { if (!tour.look) row.replaceChildren(h("p", { class: "ui-slide-aside" }, "The themes didn't come: Theme, font and wallpaper… has them all.")); else draw(); });
  draw();
  row.redraw = draw;
  return uiScrollRow(row, { label: "themes" });
}

// Where you are now: in the app, or in a browser's tab.
function tourInstalled() {
  return standalone
    ? uiPill("You're in the app already. Look at you.", "done")
    : uiPill("You're in a browser tab right now. Fix that.", "warn");
}

// A new project: as the Amarchy menu's (its first chat's box after).
function tourNewProject() {
  closeSheets();
  if (app.desk) newProject(); else newProjectSheet((p) => newChatIn(p));
}

// A feature: its picture, small (scale: a pixel's size), what it is, what it does.
function tourFeature(rows, scale, title, text) {
  return { art: () => uiPixels(rows, { scale }), title, text };
}

function tourSlides() {
  const art = (rows, opts) => uiPixels(rows, opts);
  const feat = tourFeature;
  return [
    {
      kicker: "amarchy in 100 seconds",
      title: "Stop babysitting your agents. Manage them.",
      art: () => [art(tourBot("A"), { scale: 7, cls: "bob" }), art(tourBot("G"), { scale: 9, cls: "bob d1" }), art(tourBot("P"), { scale: 7, cls: "bob d2" })],
      body: [
        "amarchy runs your **Claude Code** agents on a computer that never sleeps, and puts every one of them on your phone and your laptop.",
        "One agent, you babysit it: watch it, wait on it, read every word. A dozen, you **manage** them: the board says who needs you and what for, every reply is a briefing, and you answer with a tap.",
        "You stop writing code and start approving it. It's called a promotion.",
        h("p", { class: "ui-slide-aside" }, "Next: swipe, →, or the button. Esc or ✕ to bail. We won't be offended. (We will.)"),
      ],
    },
    {
      kicker: "How it works",
      title: "A server that stays up, so you don't have to.",
      art: () => [art(TOUR_SERVER, { scale: 7 }), art(TOUR_MOON, { scale: 6, cls: "bob" }), art(TOUR_ZZZ, { scale: 4, cls: "bob d2" })],
      body: [
        "Claude Code lives on a **Linux box that's always on**: a server, or that PC in the corner collecting dust and guilt.",
        "amarchy is the **website** that box serves. Open it from your phone or any browser and every chat is there. Shut the laptop: they keep working. No sleep, no coffee, no standup.",
        "It's private over **Tailscale**: only your own devices get in, no ports open to the internet. Hackers will need a new hobby.",
      ],
    },
    {
      kicker: "Make it an app",
      title: "It's a website. Make it an app. Trust us.",
      art: () => [art(TOUR_PHONE, { scale: 6 }), art(tourMac(), { scale: 6 })],
      body: [
        "A website, so Safari makes it a real app. No App Store, no review, no 30% cut.",
        "**iPhone**: in **Safari**, Share → **Add to Home Screen**, then open it from there. Only then can it notify you. Apple's rules, not ours.",
        "**Mac**: in **Safari**, File → **Add to Dock**. Its own window and icon, ⌘Tab to it like a real app.",
        "Chrome works too. We see you. We don't judge. (We judge a little.)",
      ],
      extra: () => h("div", { class: "ui-slide-status" }, tourInstalled()),
    },
    {
      kicker: "Features",
      title: "Parallel by default.",
      features: () => [
        feat(TOUR_GRASS, 4, "Start everything. Then go touch grass.",
             "Fire off five chats before your coffee's cold, then answer their cards as they come. That's the whole job now."),
        feat(TOUR_BRANCH, 3, "Ten chats. Zero collisions.",
             "Every chat gets its own **worktree**: a fresh copy of the code, on its own branch. Nobody steps on anybody. Merge conflicts still exist. We're not wizards."),
        feat(TOUR_MOON, 4, "Chats nap. Like cats.",
             "An idle chat sleeps to free memory, and wakes up right where it was the moment you text it."),
      ],
    },
    {
      kicker: "Features",
      title: "Less reading. More tapping.",
      features: () => [
        feat(TOUR_BRIEF, 4, "Briefings, not walls of text.",
             "Every reply opens with what happened and what's on you. Your choices are **buttons**. The details stay folded until you want them."),
        feat(TOUR_MIC, 4, "Just say it.",
             "Tap the **mic** anywhere you'd type: a chat, a new chat, a terminal. Walking the dog counts as working now."),
        feat(TOUR_BELL, 4, "Your phone buzzes. Something shipped.",
             "A real notification when a chat is done or needs you. You can run, but you can't hide."),
      ],
    },
    {
      kicker: "Features",
      title: "Ship from the couch.",
      features: () => [
        feat(TOUR_SHIP, 3, "Ship it. It's a button.",
             "When the work is good, Claude hands you a **Ship it** button. One tap: merged into main, pushed, done. Mission complete. Confetti is involved."),
        feat(TOUR_PREVIEW, 3, "See it running. No terminal.",
             "A chat's dev server is its **Preview**, a tap from its card. Not running? The tap starts it."),
        feat(TOUR_PROMPT, 3, "A terminal in your pocket.",
             "Every chat has its own, in its own copy of the code. For that one command, from the bus."),
      ],
    },
    {
      kicker: "Features",
      title: "Organized, for once.",
      features: () => [
        feat(TOUR_COLUMNS, 4, "Inbox zero, but for robots.",
             "**At work** on top. **Now** is what you're on: pin what matters. **For later** is the guilt pile."),
        feat(TOUR_TASKS, 4, "A to-do list that does itself.",
             "**Tasks** is boards: what your agents need from you (a post to approve) and what you promised people, often straight from your meeting recordings. Comment on a card, and its agent revises it."),
        feat(TOUR_LOCK, 4, "Secrets stay secret.",
             "Keys and passwords never go in the chat: Claude asks for them in a card, and they stay on your machine."),
      ],
    },
    {
      kicker: "Features",
      title: "Addictive, on purpose.",
      features: () => [
        feat(TOUR_FLAME, 3, "It's dopamine, but it ships.",
             "Every merge counts: streaks, combos, 40 badges, confetti."),
        feat(TOUR_KEYBOARD, 3, "Omarchy hands: welcome home.",
             "**Ctrl+Alt** and a key, from anywhere, as Super on Omarchy: **↵** a new chat, **← ↑ ↓ →** (or **h k j l**) back, between chats and in, **M** the menu, **/** every key. **Esc** stops Claude, as in Claude Code. **j** / **k** go card to card."),
        feat(TOUR_PHONE, 3, "Thumbs are keys too.",
             "On the phone, hold a card for its menu, and swipe a sheet down to close it."),
      ],
    },
    {
      kicker: "Make it yours",
      title: "Dark mode is a personality. Pick yours.",
      art: () => art(tourSwatches(), { scale: 7 }),
      body: () => [
        h("p", { class: "ui-slide-line" }, h("b", { class: "tour-themes-count" }, tourThemesCount()),
          ", from Tokyo Night to Gruvbox to Hackerman. Pick a font, a wallpaper, or bring your own picture."),
        "Set it once and every phone and browser of yours wears it. Even this tour. Tap one, it's live:",
      ],
      extra: () => tourThemes(),
      actions: () => [uiButton("Theme, font and wallpaper…", () => openLook())],
    },
    {
      kicker: "Make it yours",
      title: "Projects ship. Agents stick around.",
      art: () => [art(tourBranches(), { scale: 4 }), art(tourBot("A"), { scale: 6, cls: "bob" })],
      body: [
        "**A project** is a repo. Each chat in it is one job: it works on its own branch, you ship it, the chat's done. Next.",
        "**An agent** is a chat that never ends. Give it a name, a face and a job (your inbox, your X account, Monday's report). It texts you like a coworker who never logs off, and puts what needs you on Tasks.",
      ],
      actions: () => [uiButton("New project…", tourNewProject), uiButton("New agent…", () => { closeSheets(); newAgentSheet(); })],
    },
    {
      kicker: "That's it",
      title: "Congrats. You're 10x now.",
      art: () => art(TOUR_ROCKET, { scale: 8, cls: "bob" }),
      burst: true,
      body: [
        h("p", { class: "ui-slide-aside" }, "(Results not typical. Side effects include shipping too much and talking to your phone.)"),
        "This has been amarchy in 100 seconds. Watch it again any time: **Ⓐ** menu → **Tour**.",
      ],
      actions: () => tourStart(),
    },
  ];
}

// The tour, from its first slide (or at).
function tourShow(at = 0) {
  tour.look = tour.looking = null;      // (the themes as they are now)
  tourLook();
  const slides = tourSlides();
  const el = uiSlides(slides, {
    key: "tour", label: "amarchy in 100 seconds", start: at, done: "Let's go",
    closed: () => store.set("tour", "seen"),
  });
  // Back over it from the Look sheet: its themes as they're worn now.
  el.redraw = () => { const row = el.querySelector(".ui-slide-row"); if (row && row.redraw) row.redraw(); };
  return el;
}

// An empty amarchy (no project, no chat yet), opened on a device that hasn't
// had the tour: it opens by itself, over the welcome, once.
function tourAuto() {
  if (tour.auto || store.get("tour")) return;
  tour.auto = true;
  setTimeout(() => {
    if (boardEmpty() && !document.querySelector(".sheet-back, .picker-back, .ui-dropdown, .mission")) tourShow();
  }, 500);
}
