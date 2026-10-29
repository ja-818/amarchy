// What amarchy's own commands let you change, from the app, on the phone and
// in a computer's browser alike: a session's name (amarchy rename), its saved
// commands (amarchy run --set/--save/--forget), your assistant (amarchy
// assistant: which session, its name, its picture), the chimes (amarchy
// sound, and --assistant), a new project (amarchy add), an image pasted into
// Claude from the phone (the web clipboard: amarchy paste), and what needs
// you, on the tab and the app's icon. Each is a sheet. Loaded before app.js,
// whose helpers it uses.
"use strict";

function sid(s) { return encodeURIComponent(s.id); }
function rowOf(id) { return (app.view && app.view.sessions.find((x) => x.id === id)) || null; }
function mainAssistant() { return (app.view && app.view.sessions.find((x) => x.assistant === "main")) || null; }

// A text field in a sheet, ↵ doing what its sheet's button does.
function field(attrs, onEnter) {
  return h(attrs.rows ? "textarea" : "input", {
    class: "input", autocomplete: "off", autocorrect: "off", autocapitalize: "off", spellcheck: "false", ...attrs,
    onkeydown: (e) => {
      if (e.key === "Enter" && !(attrs.rows && e.shiftKey) && onEnter) { e.preventDefault(); onEnter(); }
    } });
}

// A file, picked: in the browser's own chooser.
function chooseFile(accept) {
  return new Promise((ok) => {
    const input = h("input", { type: "file", accept, class: "hidden-file" });
    input.addEventListener("change", () => { ok(input.files[0] || null); input.remove(); });
    input.addEventListener("cancel", () => { ok(null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

function base64Of(blob) {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",", 2)[1] || "");
    r.onerror = () => fail(new Error("couldn't read it"));
    r.readAsDataURL(blob);
  });
}

// ---- its name (amarchy rename)

function renameSheet(s) {
  const input = field({ value: s.title || "", placeholder: s.claude_title || s.task || "What it's about", maxlength: "200" }, () => save());
  const save = async () => {
    const t = input.value.trim();
    closeSheets();      // named at once (app.js aheadOf)
    try { await renameNow(s, t); } catch (e) { /* said */ }
  };
  sheet(sheetHead("Rename", where(s)), input,
    h("button", { class: "control wide accent", onclick: save }, "Save"),
    s.title ? h("button", { class: "control wide", onclick: () => { input.value = ""; save(); } }, "Back to Claude's title") : null);
  input.focus();
  input.select();
}

// ---- its saved commands (amarchy run): the run command first, then the others

async function commandsSheet(s, opened) {
  let cmds = [];
  try {
    const r = await fetch(`/api/session/${sid(s)}/commands`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Amarchy didn't answer");
    cmds = d.commands || [];
  } catch (e) { return toast(e instanceof TypeError ? "Can't reach Amarchy" : e.message); }
  const runIt = async (name) => {
    closeSheets();
    try {
      await api(`/api/session/${sid(s)}/run`, name === "run" ? {} : { name });
      if (opened) opened(name);
      else toast(`Running ${name === "run" ? "the project" : name} in its terminal`);
    } catch (e) {
      if (/No run command/.test(e.message)) return commandForm(s, "run", "", opened);
      toast(e.message);
    }
  };
  const forget = async (name) => {
    try {
      await api(`/api/session/${sid(s)}/commands`, { name, forget: true });
      commandsSheet(s, opened);
    } catch (e) { toast(e.message); }
  };
  const hasRun = cmds.some((c) => c.name === "run");
  sheet({ key: "commands" }, sheetHead(`Run in ${projectName(s.repo)}`, "Saved for the project: every chat of it has them"),
    h("div", { class: "menu" }, ...cmds.map((c) => h("div", { class: "command" },
      h("button", { class: "menu-item", onclick: () => runIt(c.name) },
        h("span", { class: "label" }, h("span", { class: "text" }, c.name === "run" ? "Run the project" : c.name,
          h("small", {}, c.command)))),
      h("span", { class: "row-btns" },
        h("button", { class: "control", "aria-label": `Change ${c.name}`, onclick: () => commandForm(s, c.name, c.command, opened) }, "Edit"),
        c.name === "run" ? null
          : h("button", { class: "control danger", "aria-label": `Forget ${c.name}`, onclick: () => forget(c.name) }, "Forget"))))),
    hasRun ? null : h("button", { class: "control wide accent", onclick: () => commandForm(s, "run", "", opened) }, "Set the run command…"),
    h("button", { class: "control wide", onclick: () => commandForm(s, "", "", opened) }, "Save a new command…"));
}

// Save one: the run command ("run") or another, named.
function commandForm(s, name, command, opened) {
  const named = name === "run";
  const nameIn = field({ value: name, placeholder: "Its name: test, build…", maxlength: "40" }, () => cmdIn.focus());
  const cmdIn = field({ value: command, rows: "2", placeholder: "The command, e.g. bin/dev" }, () => save(true));
  const save = async (andRun) => {
    const n = named ? "run" : nameIn.value.trim();
    const c = cmdIn.value.trim();
    if (!/^[\w.-]{1,40}$/.test(n)) return toast("A short name: letters, numbers, - and .");
    if (!c) return toast("What should it run?");
    try {
      await api(`/api/session/${sid(s)}/commands`, { name: n, command: c });
      if (!andRun) return commandsSheet(s, opened);
      closeSheets();
      await api(`/api/session/${sid(s)}/run`, n === "run" ? {} : { name: n });
      if (opened) opened(n);
      else toast(`Running ${n === "run" ? "the project" : n} in its terminal`);
    } catch (e) { toast(e.message); }
  };
  sheet(sheetHead(named ? `Run command for ${projectName(s.repo)}` : name ? `Change ${name}` : "Save a command",
                  "It starts in this chat's folder; $AMARCHY_PATH and the rest are set"),
    named ? null : nameIn, cmdIn,
    h("button", { class: "control wide accent", onclick: () => save(true) }, "Save and run"),
    h("button", { class: "control wide", onclick: () => save(false) }, "Save"),
    h("button", { class: "control wide", onclick: () => closeSheet() }, "Back"));
  (named || name ? cmdIn : nameIn).focus();
}

// ---- the chimes (amarchy sound, and --assistant)
//
// Each plays as you pick it, and as the keys land on it. They ring in the
// browser on a computer (desk.js's chime); a
// phone's notifications ring with the phone's own sound.

let previewing = null;
function previewSound(name) {
  if (previewing) previewing();
  previewing = null;
  if (!name || name === "off") return;
  previewing = playSound(`/sound/${encodeURIComponent(name)}`);
}

async function soundSheet(forAssistant) {
  let d;
  try {
    const r = await fetch("/api/sounds");
    d = await r.json();
    if (!r.ok) throw new Error(d.error || "Amarchy didn't answer");
  } catch (e) { return toast(e instanceof TypeError ? "Can't reach Amarchy" : e.message); }
  const body = h("div", {});
  const helper = mainAssistant();
  const who = (helper && helper.assistant_name) || "Your assistant";
  const pick = async (name) => {
    previewSound(name);
    try {
      d = await api("/api/sound", { name, assistant: forAssistant });
      if (app.view) Object.assign(app.view, { sound: d.sound, assistant_sound: d.assistant_sound });
      draw();
    } catch (e) { toast(e.message); }
  };
  const add = async () => {
    const f = await chooseFile("audio/*,.wav,.ogg,.oga,.opus,.flac,.mp3");
    if (!f) return;
    if (f.size > 5e6) return toast("A sound of 5 MB at most");
    try {
      const r = await api("/api/sound/add", { name: f.name, data: await base64Of(f) });
      d = r;
      await pick(r.name);
    } catch (e) { toast(e.message); }
  };
  const draw = () => {
    const now = forAssistant ? d.assistant_sound : d.sound;
    const row = (name, label, detail) => h("button", {
      class: `menu-item${now === name ? " on" : ""}`, "data-sound": name,
      onclick: () => pick(name), onfocus: () => { if (lastInput.keys) previewSound(name); } },
      h("span", { class: "label" }, h("span", { class: "text" }, label, detail ? h("small", {}, detail) : null)),
      now === name ? glyph("check", "val") : null);
    keepFocus(body.parentNode || body, () => body.replaceChildren(
      h("div", { class: "seg" },
        h("button", { class: `control${forAssistant ? "" : " on"}`, onclick: () => { forAssistant = false; draw(); } }, "Chats"),
        h("button", { class: `control${forAssistant ? " on" : ""}`, onclick: () => { forAssistant = true; draw(); } }, who)),
      h("p", {}, forAssistant ? `${who} rings with its own, whatever the chats do.`
                              : "When a chat needs you or is done (as Settings → Tell me says)."),
      h("div", { class: "menu" }, ...d.sounds.map((x) => row(x.name, x.label, x.mine ? "yours" : "")), row("off", "Off", "silent")),
      h("button", { class: "control wide", onclick: add }, "Add your own…")));
  };
  sheet(sheetHead("Sound", "Each plays as you pick it"), body);
  draw();
  menuFocus(body.parentNode);
}

// ---- your assistant (amarchy assistant)

function assistantSheet(s) {
  const helper = mainAssistant();
  const mine = s.assistant === "main";
  if (!mine) {
    const name = field({ placeholder: projectName(s.repo), maxlength: "40" }, () => make());
    const make = async () => {
      try {
        await api(`/api/session/${sid(s)}/assistant`, name.value.trim() ? { name: name.value.trim() } : {});
        closeSheets();
        toast(`${name.value.trim() || "It"} is your assistant now`);
      } catch (e) { toast(e.message); }
    };
    sheet(sheetHead("Make it your assistant?", where(s)),
      h("p", {}, "Your assistant keeps your day rather than writing code: at the top of the list with its picture, "
                 + "the other chats of its project under it, and it always tells you when it needs you or is done."
                 + (helper ? ` It takes the place of ${helper.assistant_name || "the one you have"}.` : "")),
      h("div", { class: "section" }, "Its name"), name,
      h("button", { class: "control wide accent", onclick: make }, "Make it my assistant"));
    return;
  }
  const who = s.assistant_name || "Assistant";
  const name = field({ value: who, maxlength: "40" }, () => rename());
  const rename = async () => {
    if (!name.value.trim()) return toast("What should it be called?");
    try { await api("/api/assistant", { name: name.value.trim() }); closeSheets(); }
    catch (e) { toast(e.message); }
  };
  const own = /^[0-9a-f]{12}$/.test(s.picture || "");
  sheet(sheetHead(who, `Your assistant · ${where(s)}`),
    h("div", { class: "section" }, "Name"), name,
    h("button", { class: "control wide accent", onclick: rename }, "Save the name"),
    h("div", { class: "section" }, "Picture"),
    h("div", { class: "picture-line" }, avatar(s, "big"),
      h("div", { class: "row-btns" },
        h("button", { class: "control", onclick: () => pictureSheet(s) }, own ? "Change…" : "Choose…"),
        own ? h("button", { class: "control", onclick: async () => {
          try { await api("/api/assistant/picture", { off: true }); closeSheets(); } catch (e) { toast(e.message); }
        } }, "Amarchy's own") : null)),
    h("div", { class: "section" }, "Chime"),
    h("button", { class: "control wide", onclick: () => soundSheet(true) }, "Its chime…"),
    h("button", { class: "control wide danger", onclick: async () => {
      try { await api(`/api/session/${sid(s)}/assistant`, { off: true }); closeSheets(); toast("No assistant: it's a chat like the others again"); }
      catch (e) { toast(e.message); }
    } }, "Not my assistant any more"));
}

// A picture of yours, cut to the round square the lists show: drag it into
// place, and zoom with the slider, the wheel or two fingers. What's in the
// circle goes to the host, cut already (1024 pixels at most).
async function pictureSheet(s) {
  const f = await chooseFile("image/png,image/jpeg,image/webp,image/heic,image/*");
  if (!f) return;
  let bmp;
  try { bmp = await createImageBitmap(f); } catch (e) { return toast("That picture doesn't open here"); }
  const W = bmp.width, H = bmp.height;
  const canvas = h("canvas", { class: "crop-canvas" });
  const frame = h("div", { class: "crop-frame" }, canvas, h("div", { class: "crop-ring" }));
  const zoom = h("input", { type: "range", min: "1", max: "5", step: "0.01", value: "1", class: "crop-zoom", "aria-label": "Zoom" });
  // The view: the square of the picture shown (its middle at cx, cy; side
  // the picture's short side over z), drawn into the frame.
  let z = 1, cx = W / 2, cy = H / 2;
  const side = () => Math.min(W, H) / z;
  const clamp = () => {
    const half = side() / 2;
    cx = Math.min(Math.max(cx, half), W - half);
    cy = Math.min(Math.max(cy, half), H - half);
  };
  const draw = () => {
    clamp();
    const px = Math.round(frame.clientWidth * (window.devicePixelRatio || 1)) || 600;
    canvas.width = canvas.height = px;
    const c = canvas.getContext("2d");
    const sd = side();
    c.drawImage(bmp, cx - sd / 2, cy - sd / 2, sd, sd, 0, 0, px, px);
  };
  const setZoom = (v) => { z = Math.min(Math.max(v, 1), 5); zoom.value = String(z); draw(); };
  zoom.addEventListener("input", () => setZoom(parseFloat(zoom.value)));
  frame.addEventListener("wheel", (e) => { e.preventDefault(); setZoom(z * Math.exp(-e.deltaY / 400)); }, { passive: false });
  const pointers = new Map();
  let pinch = null;
  frame.addEventListener("pointerdown", (e) => { frame.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); pinch = null; });
  frame.addEventListener("pointermove", (e) => {
    const was = pointers.get(e.pointerId);
    if (!was) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) setZoom(pinch.z * dist / pinch.dist);
      else pinch = { dist, z };
      return;
    }
    const per = side() / frame.clientWidth;     // picture pixels per screen pixel
    cx -= (e.clientX - was[0]) * per;
    cy -= (e.clientY - was[1]) * per;
    draw();
  });
  for (const end of ["pointerup", "pointercancel"]) frame.addEventListener(end, (e) => { pointers.delete(e.pointerId); pinch = null; });
  frame.tabIndex = 0;
  frame.addEventListener("keydown", (e) => {       // the arrows move it, + and − zoom
    const step = side() / 20;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { cx += moves[e.key][0]; cy += moves[e.key][1]; draw(); }
    else if (e.key === "+" || e.key === "=") setZoom(z * 1.1);
    else if (e.key === "-") setZoom(z / 1.1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  const use = async (btn) => {
    btn.disabled = true;
    const sd = side(), out = Math.min(1024, Math.round(sd));
    const c = h("canvas", {});
    c.width = c.height = out;
    c.getContext("2d").drawImage(bmp, cx - sd / 2, cy - sd / 2, sd, sd, 0, 0, out, out);
    try {
      const png = await new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("couldn't cut it"))), "image/png"));
      await api("/api/assistant/picture", { data: await base64Of(png) });
      closeSheets();
      toast("Its new picture is on every list");
    } catch (e) {
      btn.disabled = false;
      toast(e.message);
    }
  };
  sheet(sheetHead("Its picture", "Drag it into the circle; zoom below"), frame, zoom,
    h("button", { class: "control wide accent", onclick: (e) => use(e.currentTarget) }, "Use it"),
    h("button", { class: "control wide", onclick: () => closeSheet() }, "Back"));
  requestAnimationFrame(draw);
}

// ---- a new project (amarchy add): one of your GitHub repos, a git URL, or an empty one

function newProjectSheet(added, how) {
  let repos = null;
  const list = h("div", { class: "menu" });
  const repo = field({ placeholder: "owner/repo or a git URL" }, () => add({ repo: repo.value.trim() }));
  const empty = field({ placeholder: "For example: my website", maxlength: "100" }, () => add({ new: empty.value.trim() }));
  const github = h("button", { class: "control wide", "aria-pressed": "false", hidden: true, onclick: () => {
    const on = github.getAttribute("aria-pressed") !== "true";
    github.setAttribute("aria-pressed", String(on));
    github.classList.toggle("on", on);
    github.textContent = on ? "With a private GitHub repo (on)" : "With a private GitHub repo too";
  } }, "With a private GitHub repo too");
  const add = async (body) => {
    if (body.repo === "" || body.new === "") return toast(body.repo === "" ? "Which repo?" : "What's it called?");
    if (body.new !== undefined) {
      if (!/^[\w.-]{1,100}$/.test(body.new)) return toast("A name of letters, numbers, - and .");
      if (github.getAttribute("aria-pressed") === "true") body.github = true;
    }
    closeSheets();
    toast("Adding the project…");
    try {
      const d = await api("/api/add", body);
      const name = (body.new || d.name || body.repo.split("/").pop()).replace(/\.git$/, "");
      toast(`${name} is one of your projects now`);
      if (added) added(name);
    } catch (e) { toast(e.message); }
  };
  const drawRepos = () => list.replaceChildren(...(repos === null ? [h("p", {}, "Your GitHub repos…")]
    : typeof repos === "string" ? [h("p", {}, repos)]
    : repos.filter((r) => !r.added).map((r) => h("button", { class: "menu-item", onclick: () => add({ repo: r.name }) },
      h("span", { class: "label" }, h("span", { class: "text" }, r.name, r.private ? h("small", {}, "private") : null))))));
  const fromGithub = [h("div", { class: "section" }, "From GitHub, or any git URL"), repo,
    h("button", { class: "control wide accent", onclick: () => add({ repo: repo.value.trim() }) }, "Add it"),
    h("div", { class: "section" }, "Your GitHub repos"), list];
  const fromNothing = [h("div", { class: "section" }, how === "empty" ? "What's it called?" : "Or an empty one"), empty, github,
    h("button", { class: `control wide${how === "empty" ? " accent" : ""}`, onclick: () => add({ new: empty.value.trim() }) }, "Create the project")];
  sheet(sheetHead(how === "empty" ? "An empty project" : how === "github" ? "A project from GitHub" : "New project",
                  how === "empty" ? "A new, empty folder for Claude to work in" : "Copied to your server"),
    ...(how === "empty" ? fromNothing : how === "github" ? fromGithub : [...fromGithub, ...fromNothing]));
  if (how === "empty") setTimeout(() => empty.focus(), 50);
  drawRepos();
  fetch("/api/github").then(async (r) => {
    const d = await r.json();
    repos = Array.isArray(d.repos) ? d.repos : d.error || "Your GitHub repos aren't reachable from this server";
    github.hidden = !Array.isArray(repos);      // a private repo too: only where GitHub is connected
  }).catch(() => { repos = "Can't reach Amarchy"; }).then(() => { if (list.isConnected) drawRepos(); });
}

// ---- an image into Claude, from the phone (or any page without its terminal)
//
// It becomes the web clipboard (what wl-paste in your sessions reads), and
// Claude pastes it, as Ctrl+V does: it shows in its prompt as [Image #1],
// for what you send next.

async function pasteImageInto(s, blob) {
  try {
    const kind = /^image\/(png|jpeg|gif|webp)$/.test(blob.type) ? blob.type : "image/png";
    const img = kind === blob.type ? blob : await asPNG(blob);
    if (img.size > 18e6) throw new Error("That image is too big (18 MB at most)");
    await api("/api/clip", { type: kind, data: await base64Of(img), session: s.id, paste: true });
    toast("Pasted into Claude's prompt: it goes with what you send next");
  } catch (e) { toast(e.message); }
}

async function pickImageInto(s) {
  const f = await chooseFile("image/*");
  if (f) pasteImageInto(s, f);
}

// What you paste or copy as text in a terminal here becomes the web clipboard
// too: wl-paste in a session reads it.
function clipText(text) {
  if (typeof text === "string" && text && text.length <= 1e6) api("/api/clip", { text }).catch(() => {});
}

// ---- what needs you: on the tab and the app's icon, as the Ⓐ in your bar
//
// The number that need you, in the tab's title and on the icon (the
// home-screen app's badge, a Mac's Dock); a dot when only finished ones
// you haven't opened are waiting for you.

let titleWas = "";
function markWaiting() {
  const v = app.view;
  if (!v) return;
  // What needs you (bin/amarchy needs_you): a chat asking, or one whose last reply asks you something.
  const waiting = typeof v.needs === "number" ? v.needs : v.sessions.filter((s) => s.status === "waiting").length;
  const done = v.sessions.filter((s) => s.status === "idle" && s.unseen).length;
  const t = waiting ? `(${waiting}) Amarchy` : done ? "• Amarchy" : "Amarchy";
  if (t !== titleWas) { document.title = titleWas = t; markIcon(waiting ? "waiting" : done ? "done" : ""); }
  if (navigator.setAppBadge) (waiting ? navigator.setAppBadge(waiting) : navigator.clearAppBadge()).catch(() => {});
}

// The tab's icon with a dot on it: the accent's for a finished one, red for one that needs you.
let iconBase = null;
function markIcon(state) {
  const link = document.querySelector('link[rel="icon"]');
  if (!link) return;
  if (!state) { link.href = "icon.svg"; return; }
  const draw = (img) => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0, 64, 64);
    const css = getComputedStyle(document.documentElement);
    x.fillStyle = (state === "waiting" ? css.getPropertyValue("--danger") : css.getPropertyValue("--accent")).trim() || "#f7768e";
    x.beginPath();
    x.arc(48, 16, 14, 0, 2 * Math.PI);
    x.fill();
    try { link.href = c.toDataURL("image/png"); } catch (e) { /* no data: icons here */ }
  };
  if (iconBase && iconBase.complete) return draw(iconBase);
  iconBase = new Image();
  iconBase.onload = () => draw(iconBase);
  iconBase.src = "icon.svg";
}
