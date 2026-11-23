// What amarchy's own commands let you change, from the app, on the phone and
// in a computer's browser alike: a session's name (amarchy rename), its saved
// commands (amarchy run --set/--save/--forget), your assistant and your
// agents (amarchy assistant, amarchy agents: which sessions, their names,
// pictures and chimes), the chimes (amarchy sound), a new project (amarchy add), an image pasted into
// Claude from the phone (the web clipboard: amarchy paste), and what needs
// you, on the tab and the app's icon. Each is a sheet. Loaded before app.js,
// whose helpers it uses.
"use strict";

function rowOf(id) { return (app.view && app.view.sessions.find((x) => x.id === id)) || null; }
function mainAssistant() { return (app.view && app.view.sessions.find((x) => x.assistant === "main")) || null; }
// Your assistant and your agents, as the list orders them (your assistant first).
function agentsOf(v) {
  const team = ((v && v.sessions) || []).filter(isAgent);
  return [...team.filter((s) => s.assistant === "main"), ...team.filter((s) => s.assistant !== "main")];
}
// One of their chimes (its row's, else for your assistant the view's).
function agentChime(s) { return s.chime || (s.assistant === "main" ? (app.view || {}).assistant_sound : "") || "herald"; }
// Its line in a chat's menu.
function agentMenuLabel(s) {
  return s.assistant === "main" ? `${s.assistant_name || "Assistant"}: who it is, picture, chime…`
    : s.assistant === "agent" ? `${s.assistant_name || "Agent"}, an agent: who it is, picture, chime…` : "Make it an agent…";
}

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

// ---- moving it to another machine (amarchy move; docs/plan-omarchy-and-
// machines.md, "Moving a chat"): only when you say so, never on its own.
// Its menu has "Move to <label>…" for each other machine on the board that
// answers; the sheet says what goes with it, asks before copying a secret,
// and offers to move it once it's free when it's at work.

// The machines a chat can move to: the others on the board that answer.
// Not your assistant or an agent (they live on their machine), not one being
// set up, moving already, or on a machine that's off.
function moveTargets(s) {
  if (!s || isAgent(s) || s.setup || s.moved_from || uiMachineOff(s) || uiMoving(s) || typeof machinesShown !== "function") return [];
  const here = machineOf(s).name;
  return machinesShown().filter((m) => m.name !== here && m.on && !m.update);
}

// Its lines in a chat's menu: the wide layout's (uiMenu items) and the phone's sheet (buttons).
function moveItems(s) {
  return moveTargets(s).map((m) => ({ label: `Move to ${m.label}…`, icon: "machine", detail: "its branch and its conversation go too",
                                      act: () => moveSheet(s, m) }));
}
function moveButtons(s) {
  return moveTargets(s).map((m) => h("button", { class: "control wide", onclick: () => moveSheet(s, m) }, `Move to ${m.label}…`));
}

const moveCap = (t) => String(t || "").replace(/^./, (c) => c.toUpperCase());

async function moveSheet(s, m) {
  const label = m.label;
  const cancel = () => h("button", { class: "control wide", onclick: closeSheet }, "Cancel");
  const wait = h("p", { class: "hint" }, "Looking at what goes with it…");
  const back = sheet({ key: "move" }, sheetHead(`Move to ${label}?`, where(s)), wait, cancel());
  let c;
  try {
    const res = await fetch(chatPath(s, `/move?to=${encodeURIComponent(m.name)}`));
    c = await res.json();
    if (!res.ok) throw new Error(c.error || "Amarchy didn't answer");
  } catch (e) {
    wait.textContent = e instanceof TypeError ? "Can't reach Amarchy" : e.message;
    return;
  }
  if (!back.isConnected) return;      // closed meanwhile
  if (c.refused) {
    sheet({ key: "move" }, sheetHead(`It can't move to ${label}`, where(s)), h("p", { class: "hint" }, `${moveCap(c.refused)}.`.replace(/([.…!?])\.$/, "$1")), cancel());
    return;
  }
  const n = c.changes || 0;
  const busy = (c.busy || [])[0] || "";
  const secrets = c.secrets || [];
  const them = secrets.length === 1 ? "it" : "them";
  const rows = [
    { label: "Its work", value: `Its branch${n ? `, with ${n} file${n === 1 ? "" : "s"} not committed as one WIP commit` : ""}, pushed to ${c.origin || "GitHub"}` },
    { label: "Its chat", value: `The conversation (its Claude picks it up there), its name, priority and place on the board` },
    ...(c.previews.length ? [{ label: c.previews.length > 1 ? "Its previews" : "Its preview", value: `Stopped here, ready there` }] : []),
    ...(c.left.length ? [{ label: "Not carried", value: `${c.left.slice(0, 3).join(", ")}${c.left.length > 3 ? "…" : ""}: made again there`, tone: "none" }] : []),
    ...(secrets.length ? [{ label: "Secrets", value: `It asked you for ${secrets.join(", ")}. Copy ${them} to ${label} too?`, tone: "you" }] : []),
    ...(busy ? [{ label: "Not now", value: `${moveCap(busy)}: it moves once it's free`, tone: "you" }] : []),
  ];
  const go = (withSecrets) => async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    const when = busy ? "free" : "now";
    const moving = { to: m.name, label, step: busy ? `Waiting: ${busy}` : "Getting ready", when, since: Date.now() / 1000 };
    try {
      await aheadOf(s.id, { moving, move_error: null }, (r) => !!r.moving,
                    api(chatPath(s, "/move"), { to: m.name, secrets: withSecrets, when }), { quiet: true });
      closeSheets();
      toast(busy ? `It moves to ${label} once it's free` : `Moving to ${label}…`);
    } catch (x) {
      b.disabled = false;
      if (x.status === 409 && x.data && x.data.busy) return moveSheet(s, m);      // at work since: asked again
      toast(x.message);
    }
  };
  const act = busy ? "Move when it's free" : `Move to ${label}`;
  const buttons = secrets.length
    ? [h("button", { class: "control wide accent", onclick: go(true) }, `${act}, with ${secrets.length === 1 ? secrets[0] : "its secrets"}`),
       h("button", { class: "control wide", onclick: go(false) }, `${act}, without ${them}`)]
    : [h("button", { class: "control wide accent", onclick: go(false) }, act)];
  sheet({ key: "move" }, sheetHead(`Move to ${label}?`, where(s)), uiBrief(rows), ...buttons, cancel());
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
    const r = await fetch(chatPath(s, "/commands"));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Amarchy didn't answer");
    cmds = d.commands || [];
  } catch (e) { return toast(e instanceof TypeError ? "Can't reach Amarchy" : e.message); }
  const runIt = async (name) => {
    closeSheets();
    try {
      await api(chatPath(s, "/run"), name === "run" ? {} : { name });
      if (opened) opened(name);
      else toast(`Running ${name === "run" ? "the project" : name} in its terminal`);
    } catch (e) {
      if (/No run command/.test(e.message)) return commandForm(s, "run", "", opened);
      toast(e.message);
    }
  };
  const forget = async (name) => {
    try {
      await api(chatPath(s, "/commands"), { name, forget: true });
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
      await api(chatPath(s, "/commands"), { name: n, command: c });
      if (!andRun) return commandsSheet(s, opened);
      closeSheets();
      await api(chatPath(s, "/run"), n === "run" ? {} : { name: n });
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

// ---- the chimes (amarchy sound, --assistant, and amarchy agents <id> --sound)
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

// whose: null for the chats', else the id of your assistant or an agent.
async function soundSheet(whose) {
  let d;
  try {
    const r = await fetch("/api/sounds");
    d = await r.json();
    if (!r.ok) throw new Error(d.error || "Amarchy didn't answer");
  } catch (e) { return toast(e instanceof TypeError ? "Can't reach Amarchy" : e.message); }
  const body = h("div", {});
  const team = agentsOf(app.view);
  if (!team.some((x) => x.id === whose)) whose = null;
  const of = (id) => team.find((x) => x.id === id) || null;
  const nameOf = (x) => x.assistant_name || (x.assistant === "main" ? "Your assistant" : "Agent");
  const chimeOf = (id) => { const x = of(id); return !x ? d.sound : x.assistant === "main" ? d.assistant_sound : (d.agent_sounds || {})[id] || agentChime(x); };
  const pick = async (name) => {
    previewSound(name);
    const x = of(whose);
    try {
      d = await api("/api/sound", { name, ...(x && x.assistant === "main" ? { assistant: true } : x ? { agent: x.id } : {}) });
      if (app.view) {
        Object.assign(app.view, { sound: d.sound, assistant_sound: d.assistant_sound });
        for (const r of agentsOf(app.view)) r.chime = r.assistant === "main" ? d.assistant_sound : (d.agent_sounds || {})[r.id] || r.chime;
      }
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
    const now = chimeOf(whose);
    const x = of(whose);
    const row = (name, label, detail) => h("button", {
      class: `menu-item${now === name ? " on" : ""}`, "data-sound": name,
      onclick: () => pick(name), onfocus: () => { if (lastInput.keys) previewSound(name); } },
      h("span", { class: "label" }, h("span", { class: "text" }, label, detail ? h("small", {}, detail) : null)),
      now === name ? glyph("check", "val") : null);
    keepFocus(body.parentNode || body, () => body.replaceChildren(
      h("div", { class: "seg" },
        h("button", { class: `control${x ? "" : " on"}`, onclick: () => { whose = null; draw(); } }, "Chats"),
        ...team.map((t) => h("button", { class: `control${whose === t.id ? " on" : ""}`, onclick: () => { whose = t.id; draw(); } }, nameOf(t)))),
      h("p", {}, x ? `${nameOf(x)} rings with its own, whatever the chats do.`
                   : "When a chat needs you or is done (as Settings → Tell me says)."),
      h("div", { class: "menu" }, ...d.sounds.map((x) => row(x.name, x.label, x.mine ? "yours" : "")), row("off", "Off", "silent")),
      h("button", { class: "control wide", onclick: add }, "Add your own…")));
  };
  sheet(sheetHead("Sound", "Each plays as you pick it"), body);
  draw();
  menuFocus(body.parentNode);
}

// ---- your assistant and your agents (amarchy assistant, amarchy agents)
//
// A chat that's neither: make it an agent (or your assistant, in place of the
// one you have). One of them: who it is (its name, and the emoji and tone
// it chats with: its Claude is handed them at every start), its picture,
// its chime, and back to a chat like the others.

function agentSheet(s) {
  const helper = mainAssistant();
  const role = s.assistant === "main" || s.assistant === "agent" ? s.assistant : "";
  if (!role) {
    const name = field({ placeholder: projectName(s.repo), maxlength: "40" }, () => make(false));
    const make = async (main) => {
      const called = name.value.trim();
      try {
        await api(chatPath(s, `/${main ? "assistant" : "agent"}`), called ? { name: called } : {});
        closeSheets();
        toast(main ? `${called || "It"} is your assistant now` : `${called || projectName(s.repo)} is an agent now`);
      } catch (e) { toast(e.message); }
    };
    sheet(sheetHead("Make it an agent?", where(s)),
      h("p", {}, "An agent lives on rather than finishing: on top of the list next to your assistant, with its own picture "
                 + "and chime. It always tells you when it needs you or is done, and is never a mission to complete."),
      h("div", { class: "section" }, "Its name"), name,
      h("button", { class: "control wide accent", onclick: () => make(false) }, "Make it an agent"),
      h("div", { class: "section" }, "Or your assistant"),
      h("p", {}, "Your assistant is the agent that keeps your day: your tasks go to it, and the other chats of its project sit under it."
                 + (helper ? ` It takes the place of ${helper.assistant_name || "the one you have"}.` : "")),
      h("button", { class: "control wide", onclick: () => make(true) }, "Make it my assistant"));
    return;
  }
  const main = role === "main";
  const who = s.assistant_name || (main ? "Assistant" : "Agent");
  const save = () => keep();
  const name = field({ value: who, maxlength: "40" }, save);
  const emoji = field({ value: s.emoji || "", maxlength: "16", placeholder: "🔥", class: "input emoji-field", "aria-label": "Its emoji" }, save);
  const tone = field({ value: s.tone || "", maxlength: "120", placeholder: "For example: proud, grumpy fire demon under contract", "aria-label": "Its tone" }, save);
  const keep = async () => {
    if (!name.value.trim()) return toast("What should it be called?");
    try {
      await api(chatPath(s, "/agent"), { name: name.value.trim(), emoji: emoji.value.trim(), tone: tone.value.trim() });
      closeSheets();
    } catch (e) { toast(e.message); }
  };
  const own = /^[0-9a-f]{12}$/.test(s.picture || "");
  sheet(sheetHead(who, `${main ? "Your assistant" : "An agent"} · ${where(s)}`),
    h("div", { class: "section" }, "Name"), name,
    h("div", { class: "section" }, "Who it is"),
    h("div", { class: "identity-line" }, emoji, tone),
    h("p", {}, s.emoji && s.tone ? `${who} chats in that tone and uses its emoji in its messages: its Claude is handed both at every start.`
               : `None yet: the next time you write ${who}, it offers you three to pick from. Or set them here.`),
    h("button", { class: "control wide accent", onclick: save }, "Save"),
    h("div", { class: "section" }, "Picture"),
    h("div", { class: "picture-line" }, avatar(s, "big"),
      h("div", { class: "row-btns" },
        h("button", { class: "control", onclick: () => pictureSheet(s) }, own ? "Change…" : "Choose…"),
        own ? h("button", { class: "control", onclick: async () => {
          try { await api(pictureApi(s), { off: true }); closeSheets(); } catch (e) { toast(e.message); }
        } }, main ? "Amarchy's own" : "Its initial") : null)),
    h("div", { class: "section" }, "Chime"),
    h("button", { class: "control wide", onclick: () => soundSheet(s.id) }, "Its chime…"),
    h("button", { class: "control wide danger", onclick: async () => {
      try {
        await api(chatPath(s, `/${main ? "assistant" : "agent"}`), { off: true });
        closeSheets();
        toast(main ? "No assistant: it's a chat like the others again" : `${who} is a chat like the others again`);
      } catch (e) { toast(e.message); }
    } }, main ? "Not my assistant any more" : "Not an agent any more"));
}

// ---- a new agent (amarchy new --agent)
//
// A chat that lives on from its start: what it's called, its job (its first
// message: what it keeps doing for you; none, and it waits for you to text
// it) and where it lives: a folder of its own (a new, empty project named
// after it, the usual home of one) or one of your projects. Made, its chat
// opens, on top of your chats. The same sheet on the phone and a computer:
// from the Amarchy menu, Settings' Agents and the tour.
function newAgentSheet() {
  const ps = () => ((app.view && app.view.projects) || []).map((p) => p.name);
  // Its own folder's name: its name, as a project's (letters, numbers, - and .).
  const folder = () => name.value.trim().toLowerCase().replace(/[^\w.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60) || "agent";
  let home = null;      // null: a folder of its own; else one of your projects
  const list = h("div", { class: "menu" });
  const name = field({ placeholder: "For example: Scout", maxlength: "40", oninput: () => draw() }, () => make());
  const job = field({ rows: 3, maxlength: "4000", placeholder: "For example: every morning, go through my X mentions and put the ones worth a reply on Tasks" });
  const draw = () => {
    const own = folder(), have = ps();
    const item = (key, label, detail) => h("button", { class: `menu-item${home === key ? " on" : ""}`, onclick: () => { home = key; draw(); } },
      h("span", { class: "label" }, h("span", { class: "text" }, label, detail ? h("small", {}, detail) : null)),
      home === key ? glyph("check", "val") : null);
    keepFocus(list, () => list.replaceChildren(
      item(null, "A folder of its own", have.includes(own) ? `${own}, one of your projects already` : `a new project: ${own}`),
      ...have.map((p) => item(p, projectName(p), "one of your projects"))));
  };
  let busy = false;
  const make = async () => {
    const called = name.value.trim();
    if (!called) { name.focus(); return toast("What should it be called?"); }
    if (busy) return;
    busy = true;
    btn.classList.add("busy");
    let repo = home;
    try {
      if (repo === null) {
        repo = folder();
        if (!ps().includes(repo)) {
          toast(`Making its folder, ${repo}…`);
          await api("/api/add", { new: repo });
        }
      }
      const text = job.value.trim();
      const d = await api("/api/new", { repo, agent: called, ...(text ? { prompt: text } : {}) });
      closeSheets();
      toast(`${called} is one of your agents: on top of your chats`);
      // Its chat, once the list has it.
      if (d.id && row(d.id)) boardOpen(d.id);
      else if (d.id) board.waitFor = d.id;
    } catch (e) { toast(e.message); }
    busy = false;
    btn.classList.remove("busy");
  };
  const btn = h("button", { class: "control wide accent", onclick: () => make() }, "Make the agent");
  sheet({ key: "new-agent" }, sheetHead("New agent", "A chat that lives on"),
    h("p", {}, "A chat in a project does one job and is done. An agent never is: it keeps a job going (your inbox, your X account, "
               + "Monday's report), texts you like a coworker, and puts what needs you on Tasks. It sits on top of your chats."),
    h("p", {}, "Who it is, it picks with you: the first time you write it, it offers you three, each a tone and the emoji it chats with, and becomes the one you tap."),
    h("div", { class: "section" }, "Its name"), name,
    h("div", { class: "section" }, "Its job"), job,
    h("div", { class: "section" }, "Where it lives"), list,
    h("p", {}, "Its notes and scripts go there. A folder of its own is the usual."),
    btn);
  draw();
  setTimeout(() => name.focus(), 50);
}

// Where its picture goes: your assistant's, or an agent's.
function pictureApi(s) { return s.assistant === "main" ? "/api/assistant/picture" : chatPath(s, "/agent/picture"); }

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
      await api(pictureApi(s), { data: await base64Of(png) });
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
    await api(machinePath(s, "/api/clip"), { type: kind, data: await base64Of(img), session: chatIdOf(s), paste: true });
    toast("Pasted into Claude's prompt: it goes with what you send next");
  } catch (e) { toast(e.message); }
}

async function pickImageInto(s) {
  const f = await chooseFile("image/*");
  if (f) pasteImageInto(s, f);
}

// What you paste or copy as text in a terminal here becomes the web clipboard
// too: wl-paste in a session reads it. On the machine of the chat it's for
// (chat: one, or its key; else the chat open, else this machine).
function clipText(text, chat) {
  const on = chat || (app.session && app.session.id) || (typeof desk !== "undefined" && desk.current) || "";
  if (typeof text === "string" && text && text.length <= 1e6) api(machinePath(on, "/api/clip"), { text }).catch(() => {});
}

// ---- what needs you: on the tab and the app's icon, as the Ⓐ in your bar
//
// The number that need you, in the tab's title and on the icon (the
// home-screen app's badge, a Mac's Dock): the home's own ("3 need you",
// Chats' count: today.js todayCount), as you act there too (todayRedraw),
// and the messages from your assistant and your agents you haven't read,
// as a messaging app counts them (the server's app_badge, for the phones'
// notifications); a dot when only finished ones you haven't opened are
// waiting for you.

let titleWas = "", badgeWas = null;
function markWaiting() {
  const v = app.view;
  if (!v) return;
  const unread = v.sessions.reduce((n, s) => n + (isAgent(s) ? s.unread || 0 : 0), 0);
  const waiting = unread + (typeof todayCount === "function" ? todayCount(v, "chats")
    : typeof v.needs === "number" ? v.needs : v.sessions.filter((s) => s.status === "waiting").length);
  const done = v.sessions.filter((s) => s.status === "idle" && s.unseen).length;
  phoneStatus(v, waiting);
  const t = waiting ? `(${waiting}) Amarchy` : done ? "• Amarchy" : "Amarchy";
  if (t !== titleWas) { document.title = titleWas = t; markIcon(waiting ? "waiting" : done ? "done" : ""); }
  if (waiting === badgeWas) return;
  badgeWas = waiting;
  if (navigator.setAppBadge) (waiting ? navigator.setAppBadge(waiting) : navigator.clearAppBadge()).catch(() => {});
}

// The phone app's widget and badge ("2 need you", phone/): what needs you, the
// first chats by name, told each time it changes.
let phoneWas = null;
function phoneStatus(v, needs) {
  if (!window.amarchyPhone || typeof todayParts !== "function") return;
  const p = todayParts(v);
  const why = (s) => p.asks.includes(s) ? "Asks you" : p.blocked.includes(s) ? "Blocked" : s.interrupted === true ? "Interrupted" : "Done";
  const chats = [...p.asks, ...p.blocked, ...p.fresh].filter((s) => !uiMachineOff(s)).slice(0, 4)
    .map((s) => ({ key: chatKeyOf(s.machine, s.id), name: title(s), why: why(s) }));
  const said = JSON.stringify({ needs, chats });
  if (said === phoneWas) return;
  phoneWas = said;
  window.amarchyPhone.call("status", { needs, chats }).catch(() => { phoneWas = null; });
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
