// ---- the tour: amarchy in 100 seconds
//
// What amarchy is, how to set it up, how it works and how to get the most
// out of it, as slides (ui.js uiSlides) with pixel art in the theme's own
// colors (uiPixels): one theme changes every picture with the rest. The same
// slides and words on the phone and on a computer; only the layout fits.
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

// A terminal, its cursor blinking after the command.
function tourTerminal() {
  const m = uiPixmap(24, 15);
  m.box(0, 0, 24, 15, "k").frame(0, 0, 24, 15, "t").box(1, 1, 22, 2, "m");
  m.set(2, 1, "r").set(4, 1, "y").set(6, 1, "g").set(2, 2, "r").set(4, 2, "y").set(6, 2, "g");
  m.line(2, 5, 3, 5, "g").box(5, 5, 12, 1, "t");
  m.line(2, 7, 3, 7, "g").box(5, 7, 15, 1, "t");
  m.box(2, 9, 9, 1, "m");
  m.line(2, 11, 3, 11, "g").box(5, 11, 7, 1, "t").box(13, 11, 2, 2, "A");
  return m;
}

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

// A reply with its buttons (Allow lit), and the pointer about to press it.
function tourBubble() {
  const m = uiPixmap(26, 20);
  m.box(1, 1, 24, 15, "k").frame(0, 0, 26, 17, "t").set(0, 0, ".").set(25, 0, ".").set(0, 16, ".").set(25, 16, ".");
  m.box(2, 2, 17, 1, "t").box(2, 4, 12, 1, "m");
  m.frame(2, 7, 10, 4, "m").box(14, 7, 10, 4, "a");
  m.put(3, 16, ["tkkt", "tkt.", "tt..", "t..."]);
  m.put(18, 9, ["t....", "tt...", "tkt..", "tkkt.", "tkkkt", "tktt.", "t..t."]);
  return m;
}

// The board: three columns of cards, one at work (it blinks), one asking.
function tourBoard() {
  const m = uiPixmap(29, 17);
  [0, 10, 20].forEach((x, i) => {
    m.box(x, 0, [5, 4, 6][i], 1, ["a", "m", "m"][i]);
    for (let j = 0; j < [3, 2, 1][i]; j++) {
      const y = 2 + j * 5;
      m.box(x, y, 9, 4, "k").frame(x, y, 9, 4, "m");
      m.box(x + 2, y + 1, 5, 1, "t");
      m.box(x + 2, y + 2, 3, 1, i === 0 && j === 0 ? "R" : i === 0 && j === 1 ? "G" : "m");
    }
  });
  return m;
}

// The streak's flame, and the trophy: what a merge earns.
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
const TOUR_TROPHY = [
  "...yyyyyyyy...",
  "yyyyyyyyyyyyyy",
  "y..yyyyyyTy..y",
  "y..yyyyyyyy..y",
  ".y.yyyyyyyy.y.",
  "..yyyyyyyyyy..",
  "....yyyyyy....",
  ".....yyyy.....",
  "......yy......",
  "......yy......",
  "....yyyyyy....",
  "...mmmmmmmm...",
  "...mmmmmmmm...",
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

function tourSlides() {
  const art = (rows, opts) => uiPixels(rows, opts);
  return [
    {
      kicker: "amarchy in 100 seconds",
      title: "One Claude is a coworker. Twelve is a company.",
      art: () => [art(tourBot("A"), { scale: 7, cls: "bob" }), art(tourBot("G"), { scale: 9, cls: "bob d1" }), art(tourBot("P"), { scale: 7, cls: "bob d2" })],
      body: [
        "amarchy runs a dozen **Claude Codes** at once, each in a chat of its own, on a machine that never sleeps.",
        "You talk to them from your phone or your browser. They write the code. You take the credit. Like a real senior engineer.",
        h("p", { class: "ui-slide-aside" }, "Next: swipe, →, or the button. Esc or ✕ to bail. We won't be offended. (We will.)"),
      ],
    },
    {
      kicker: "What it is",
      title: "A server that stays up, so you don't have to.",
      art: () => [art(TOUR_SERVER, { scale: 7 }), art(TOUR_MOON, { scale: 6, cls: "bob" }), art(TOUR_ZZZ, { scale: 4, cls: "bob d2" })],
      body: [
        "Claude Code lives on a **Linux box that's always on**: a server, or that PC in the corner collecting dust and guilt.",
        "Shut the laptop. Pocket the phone. Your chats keep working. They don't need sleep, coffee or a standup.",
        "You reach it over **Tailscale**: private to your own devices, no ports open to the internet. Hackers will need a new hobby.",
      ],
    },
    {
      kicker: "Set it up",
      title: "The setup, any% speedrun.",
      art: () => art(tourTerminal(), { scale: 7 }),
      body: () => [
        "You need a Linux machine that stays on, **Claude Code** logged in, `git`, `tmux` 3.5+ and `python3`. Plus **Tailscale** on it and on your devices, with HTTPS certificates on. Then:",
        tourCode("git clone https://github.com/ja-818/amarchy ~/.local/share/amarchy\n~/.local/share/amarchy/install.sh\namarchy app on"),
        "`amarchy app on` prints your app's address. If you're reading this, you already did all that. You're DevOps now. Update your LinkedIn.",
      ],
    },
    {
      kicker: "Make it an app",
      title: "It's a website. Make it an app. Trust us.",
      art: () => [art(TOUR_PHONE, { scale: 6 }), art(tourMac(), { scale: 6 })],
      body: [
        "**iPhone**: open it in **Safari**, tap Share → **Add to Home Screen**, then open amarchy from there. Only then can it notify you. Apple's rules, not ours.",
        "**Mac**: open it in **Safari**, then File → **Add to Dock**. Its own window, its own icon, no tabs, ⌘Tab to it like a real app.",
        "Chrome works too. We see you. We don't judge. (We judge a little.)",
      ],
      extra: () => h("div", { class: "ui-slide-status" }, tourInstalled()),
    },
    {
      kicker: "How it works",
      title: "Every chat gets its own copy of the code.",
      art: () => art(tourBranches(), { scale: 7 }),
      body: [
        "Each chat works in its own **worktree**, on its own branch, fresh off the latest main. Ten chats change ten things, and nobody steps on anybody.",
        "Merge conflicts are still possible. We're not wizards.",
        "When the work is good, say **ship it**: it's merged into main. That's a mission complete. Confetti is involved.",
      ],
    },
    {
      kicker: "The chat",
      title: "You type. Claude does. You press buttons.",
      art: () => art(tourBubble(), { scale: 7 }),
      body: [
        "Say what you want. Claude reads the project, writes the code, runs it, and tells you how it went: the answer first, the details folded.",
        "When it needs you, it's a card with buttons: a question, a permission, a plan. Allow. Allow. Always allow. Congratulations: you've invented management.",
        "Tap the **mic** to talk instead of type. Paste a screenshot: Claude sees it.",
      ],
    },
    {
      kicker: "The board",
      title: "Inbox zero, but for robots.",
      art: () => art(tourBoard(), { scale: 7 }),
      body: [
        "**Chats | Tasks.** Every chat is a card: what it's doing, what it asks you, and its buttons right there. Answer without even opening it.",
        "**At work** on top. **Now** is what you're on: pin what matters. **For later** is the guilt pile.",
        "**Needs you** shows only what waits on you. A chime rings, your phone buzzes. You can run, but you can't hide.",
      ],
    },
    {
      kicker: "Pro moves",
      title: "Start everything. Then go touch grass.",
      art: () => [art(TOUR_FLAME, { scale: 7, cls: "flicker" }), art(TOUR_TROPHY, { scale: 7 })],
      body: [
        "Fire off five chats before your coffee's cold, then answer the cards as they come. That's the whole job now.",
        "Keys and passwords never go in the chat: Claude asks for them in a card, and they stay on your machine.",
        "Idle chats nap to free memory and wake up where they were when you text them. Like a cat. A chat's dev server is its **Preview**, a tap from its card.",
        "Every merge counts: streaks, combos, 40 badges, confetti. It's dopamine, but it ships.",
      ],
    },
    {
      kicker: "Themes",
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
      kicker: "Keys",
      title: "Vim users: welcome home.",
      art: () => h("div", { class: "ui-keycaps" }, ...["h", "j", "k", "l"].map((k) => h("kbd", { class: "ui-keycap" }, k))),
      body: [
        "On a computer, everything has a key. **j** / **k** go card to card, **Enter** opens, **Esc** goes back, **n** is a new chat, **/** searches, and **?** shows them all.",
        "**Ctrl+Alt+M** opens the Amarchy menu from anywhere. This tour lives there too.",
        "On the phone, hold a card for its menu and swipe a sheet down to close it. Thumbs are keys too.",
      ],
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

// A command to copy, as a chat's code block (its Copy).
function tourCode(text) {
  const box = h("div", { html: codeBlock(text, "sh") });
  const code = box.firstChild;
  code.querySelector(".copy").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    copyText(text).then(() => { btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy"; }, 1500); });
  });
  return code;
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
    if (boardEmpty() && !document.querySelector(".sheet-back, .picker-back, .mission")) tourShow();
  }, 500);
}
