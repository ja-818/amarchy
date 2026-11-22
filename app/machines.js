// Machines: amarchy on every computer you have, every machine's chats on one
// board (docs/plan-omarchy-and-machines.md, track A). bin/amarchy pairs them
// (amarchy machines) and puts every paired machine's chats on this server's
// board, each with its machine; app.js keys them (chatPath, <machine>:<id>).
//
// - Settings → Machines: each one and how it stands (on, off, what to
//   update), Add (the machines of yours on the tailnet that answer as
//   amarchy, or one by its name or address), Rename (on that machine, so
//   every machine shows the same), Remove (both forget the other).
// - A new chat's Where (app.js newChat): the machine it runs on, the last
//   one used for that project first; a project that isn't on that machine is
//   cloned there first (from GitHub), saying so.
//
// Uses app.js's helpers (h, api, toast, sheet, sheetHead, glyph...) and
// manage.js's field, at run time.
"use strict";

// How a machine stands, in words and a pill's tone.
function machineState(m) {
  if (m.me) return { words: "This machine", tone: "accent" };
  if (m.update) return { words: "Update needed", tone: "warn" };
  if (m.on) return { words: "On", tone: "done" };
  if (!m.seen) return { words: "Not answering yet", tone: "quiet" };
  return { words: m.since ? `Off · ${autoPast(m.since)}` : "Off", tone: "quiet" };
}

function machinesSettings() {
  const ms = machinesAll();
  const many = ms.length > 1;
  return [h("div", { class: "section" }, "Machines"),
    ...ms.map((m) => {
      const st = machineState(m);
      return h("button", { class: "control wide machine-row", onclick: () => machineSheet(m.name) },
        glyph("machine", "machine"), h("span", { class: "machine-row-name" }, m.label), uiPill(st.words, st.tone));
    }),
    h("button", { class: "control wide", onclick: () => addMachineSheet() }, "Add a machine…"),
    h("p", {}, many ? "Every machine's chats are on one board, each with the machine it runs on. A chat stays on its machine."
                    : "Amarchy on your other computers (your desktop, a laptop): pair them and every machine's chats are on one board.")];
}

// One machine: how it stands, Rename, and (another one) Remove.
function machineSheet(name) {
  const m = machinesAll().find((x) => x.name === name);
  if (!m) return;
  const st = machineState(m);
  const label = field({ value: m.label, maxlength: "40", placeholder: "What the app calls it", "aria-label": "Its name in the app" }, () => rename());
  const rename = async () => {
    const want = label.value.trim();
    if (!want || want === m.label) return closeSheets();
    try {
      await api("/api/machines", { action: "rename", name: m.name, label: want });
      toast(`${m.label} is ${want} now`);
      closeSheets();
    } catch (e) { toast(e.message); }
  };
  const remove = () => confirmSheet(`Remove ${m.label}?`,
    `Its chats leave this board, and ${m.label} forgets this machine. Nothing on it is closed or deleted; pair them again to bring it back.`,
    `Remove ${m.label}`, async () => {
      try { const r = await api("/api/machines", { action: "remove", name: m.name }); toast(r.said || `${m.label} removed`); closeSheets(); }
      catch (e) { toast(e.message); }
    });
  const count = ((app.view && app.view.sessions) || []).filter((s) => machineOf(s).name === m.name).length;
  sheet({ key: "machine" }, sheetHead(m.label, m.me ? "This machine" : `${m.name}${m.version ? ` · ${m.version.slice(0, 7)}` : ""}`),
    h("p", {}, uiPill(st.words, st.tone), " ", m.update || (m.on || m.me ? `${count} chat${count === 1 ? "" : "s"} here.`
      : m.seen ? `It doesn't answer: its chats stay on the board as they last were, until it's back.`
      : "Paired, but it hasn't answered yet: is amarchy's app on there (amarchy app on)?")),
    !m.me && !m.on && m.error && !m.update ? h("p", { class: "hint" }, `Why: ${m.error}.`) : null,
    h("div", { class: "section" }, "Name"),
    label,
    h("button", { class: "control wide accent", onclick: rename, disabled: !m.me && !m.on }, "Rename"),
    !m.me && !m.on ? h("p", { class: "hint" }, `A machine keeps its own name: rename ${m.label} once it's on.`) : null,
    m.me ? null : h("button", { class: "control wide danger", onclick: remove }, "Remove…"));
}

// Asked first: yes or Cancel.
function confirmSheet(title, words, yes, act) {
  sheet({ key: "confirm" }, sheetHead(title, ""), h("p", {}, words),
    h("button", { class: "control wide danger", onclick: () => act() }, yes),
    h("button", { class: "control wide", onclick: () => closeSheet() }, "Cancel"));
}

// Add: the machines of yours on the tailnet that answer as amarchy and
// aren't paired yet (asked of each as the sheet opens), or one by its name
// or address.
function addMachineSheet() {
  const list = h("div", { class: "machine-found" }, h("p", { class: "hint" }, "Looking for your machines on the tailnet…"));
  const target = field({ placeholder: "Its name (omarchy) or address (https://…)", "aria-label": "A machine's name or address" }, () => pair(target.value));
  const pair = async (what, btn) => {
    what = String(what || "").trim();
    if (!what) return target.focus();
    if (btn) btn.disabled = true;
    toast(`Pairing with ${what}…`);
    try {
      const r = await api("/api/machines", { action: "add", target: what });
      toast(r.said || `Paired with ${what}`);
      closeSheets();
    } catch (e) {
      toast(e.message);
      if (btn) btn.disabled = false;
    }
  };
  sheet({ key: "add-machine" }, sheetHead("Add a machine", "Another computer of yours running amarchy"),
    list,
    h("div", { class: "section" }, "By its name"),
    target,
    h("button", { class: "control wide", onclick: (e) => pair(target.value, e.currentTarget) }, "Pair"),
    h("p", { class: "hint" }, "It needs Tailscale on both, signed in as you, and amarchy's app on there (amarchy app on). "
      + "Both keep the other: its chats come here, and this machine's go there."));
  fetch("/api/machines/found", { headers: { Accept: "application/json" } }).then((r) => r.json()).then((d) => {
    const found = d.found || [];
    list.replaceChildren(...(found.length ? found.map((f) => h("button", { class: "control wide machine-row", disabled: !!f.update,
      onclick: (e) => pair(f.name, e.currentTarget) }, glyph("machine", "machine"), h("span", { class: "machine-row-name" }, f.label),
      f.update ? uiPill("Update needed", "warn", { long: true, title: f.update }) : uiPill("Add", "accent")))
      : [h("p", { class: "hint" }, "None found: no other machine of yours on the tailnet answers as amarchy. Add one by its name below.")]));
  }).catch(() => list.replaceChildren(h("p", { class: "hint" }, "Couldn't look on the tailnet: add one by its name below.")));
}

// ---- Where: the machine a new chat runs on

const WHERE_KEY = (repo) => `where:${repo}`;

// The machines a new chat can run on: each that answers (this one first).
function whereMachines() { return machinesShown().filter((m) => m.me || (m.on && !m.update)); }
function whereShown() { return whereMachines().length > 1; }

// A machine has that project (its GitHub address too, for one cloned elsewhere).
function machineHas(m, repo) { return (m.projects || []).some((p) => (p.name || p) === repo); }
function projectGithub(repo) {
  for (const m of machinesAll()) {
    const p = (m.projects || []).find((x) => (x.name || x) === repo && x.github);
    if (p) return p.github;
  }
  const own = ((app.view && app.view.projects) || []).find((p) => p.name === repo);
  return (own && own.github) || null;
}

// Where a new chat in that project runs: the last machine used for it, else
// one that has it (this one first), else this one.
function whereFor(repo) {
  const ms = whereMachines();
  const last = store.get(WHERE_KEY(repo));
  return ms.find((m) => m.name === last) || ms.find((m) => machineHas(m, repo)) || ms[0] || null;
}

// Every project on any machine, this machine's first in your order (another
// machine's only: after them), for the new chat's row.
function whereProjects() {
  const own = (app.view && app.view.projects) || [];
  if (machinesAll().length < 2) return own;
  const names = new Set(own.map((p) => p.name));
  const more = [];
  for (const m of machinesAll()) {
    if (m.me || m.update) continue;
    for (const p of m.projects || []) {
      const name = p.name || p;
      if (!names.has(name)) { names.add(name); more.push({ name, sessions: 0, github: p.github || null, elsewhere: m.name }); }
    }
  }
  return [...own, ...more];
}

// A new chat on machine m (this one, or another through this server): its
// project cloned there first when it isn't there (said so, how(words)).
// Returns the started chat's key.
async function whereStart(m, body, how) {
  const mine = !m || m.me;
  const at = (path) => (mine ? path : `/api/m/${encodeURIComponent(m.name)}${path}`);
  let repo = body.repo;
  if (!mine && !machineHas(m, repo)) {
    const gh = projectGithub(repo);
    if (!gh) throw new Error(`${projectName(repo)} isn't on ${m.label}, and has no GitHub address to clone it from: add it there first`);
    if (how) how(`Cloning ${projectName(repo)} on ${m.label} first…`);
    const added = await api(at("/api/add"), { repo: gh });
    repo = added.name || repo;
  }
  const d = await api(at("/api/new"), { ...body, repo });
  return d.id ? chatKeyOf(mine ? "" : m.name, d.id) : "";
}

// Where's pick: each machine that answers, the one it runs on lit; for each,
// whether it has the project (else it's cloned there first).
function wherePick(repo, now, pick) {
  const items = whereMachines().map((m) => ({ m, has: machineHas(m, repo) }));
  const detail = ({ m, has }) => (has ? (m.me ? "This machine" : "Has it") : `${projectName(repo)} is cloned there first`);
  if (app.desk) return picker({ title: "Where does it run?", placeholder: "Machine",
    items: items.map((x) => ({ label: x.m.label, detail: detail(x), icon: now && now.name === x.m.name ? "check" : "", on: now && now.name === x.m.name,
                               act: () => pick(x.m) })) });
  sheet(sheetHead("Where", `The machine a chat in ${projectName(repo)} runs on`),
    h("div", { class: "menu" }, ...items.map((x) => h("button", { class: `menu-item${now && now.name === x.m.name ? " on" : ""}`, onclick: () => { closeSheets(); pick(x.m); } },
      h("span", { class: "label" }, x.m.label, h("small", {}, detail(x))),
      now && now.name === x.m.name ? glyph("check", "val") : null))));
}
