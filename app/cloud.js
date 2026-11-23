// A cloud machine in one click (docs/plan-omarchy-and-machines.md, track F):
// a machine that never sleeps, made in your own cloud account (Hetzner
// Cloud, DigitalOcean, Hostinger VPS), set up by cloud-init (Tailscale,
// Claude Code, amarchy), and paired with this one once it's up. bin/amarchy's
// "a cloud machine" makes it (/api/cloud) and follows it; the board's
// machines carry each one (making: still coming up, with its steps).
//
// - Settings → Machines → Add a cloud machine (cloudAddSheet): the provider,
//   its API token (its own password field, kept on this machine), where,
//   which size (the provider's own monthly price; 8 GB and up recommended),
//   a name, the one-off Tailscale key, then Create with its price on it.
// - Its sheet (cloudSheet): each step as it comes (created, starting up,
//   installing, on your tailnet, paired), what fails in words and its log,
//   its price; then Sign in to Claude and to GitHub there.
// - Remove (cloudRemoveSheet): it says what goes with it (its chats), and
//   offers to move them here first; then it's deleted at the provider.
// - Signing in on any machine (signinSheet): Claude's link and the code it
//   gives back, or GitHub's code to type on its page (/api/signin/...).
//
// Uses app.js's helpers (h, api, toast, sheet, glyph...), manage.js's field,
// secrets.js's secretField and tailscale.js's tailscaleLink, at run time.
"use strict";

// A path on machine m (this one's own, or through this server: the pass-through).
function cloudAt(m, path) { return !m || m.me ? path : `/api/m/${encodeURIComponent(m.name)}${path}`; }

async function cloudGet(path) {
  const r = await fetch(path, { headers: { Accept: "application/json" } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `It didn't answer (${r.status})`);
  return d;
}

// A cloud machine's price: "€5.99 a month".
function cloudPrice(c) { return c && c.monthly ? `${uiMoney(c.monthly, c.currency)} a month` : ""; }

// How it's billed, in words.
function cloudBilling(c) {
  if (!c) return "";
  const who = c.provider_label || "the provider";
  return c.billing === "subscription"
    ? `Paid ahead each month to ${who}, until you remove it (then it isn't renewed).`
    : `Billed by ${who} by the hour, up to that, until you remove it.`;
}

// Its size and where, in a line: "CX33 · 4 vCPU, 8 GB · Falkenstein, Germany".
function cloudWhat(c) {
  const size = [c.size_label || c.size, c.cores ? `${c.cores} vCPU, ${c.memory_gb} GB` : ""].filter(Boolean).join(" · ");
  return [size, c.region_label || c.region].filter(Boolean).join(" · ");
}

// Where a cloud machine stands, as its row's pill.
function cloudState(m) {
  const c = m.cloud || {};
  if (c.remove) return { words: "Removing…", tone: "working" };
  if (c.step === "removed") return { words: "Removed", tone: "quiet" };
  if (c.step === "failed") return { words: "Failed", tone: "late" };
  const words = { creating: "Creating…", booting: "Starting up…", installing: "Installing…", tailnet: "Installing…", pairing: "Pairing…" }[c.step];
  return words ? { words, tone: "working" } : null;
}

// What a machine still needs of you there: its Claude or GitHub signed in.
function machineNeeds(m) {
  if (!(m.me || m.on) || m.making) return null;
  if (m.claude === "out") return { words: "Sign in to Claude", tone: "ask" };
  if (m.github === "out" && m.cloud) return { words: "Sign in to GitHub", tone: "ask" };
  return null;
}

// ---- Settings → Machines: what a machine's sheet has of this

// A machine's sheet's own part for this: its cloud (made here: its size,
// region and price), and its sign-ins.
function machineCloudParts(m) {
  const kids = [];
  const c = m.cloud;
  if (c) {
    kids.push(h("div", { class: "section" }, "Cloud"),
      h("p", {}, [c.provider_label, c.made_here ? cloudWhat(c) : ""].filter(Boolean).join(" · ") || "A cloud machine"),
      c.made_here && c.monthly ? h("p", { class: "hint" }, `${cloudPrice(c)}. ${cloudBilling(c)}`)
        : c.by ? h("p", { class: "hint" }, `Made from ${c.by}: its price and Remove are there.`) : null);
    if (c.made_here) kids.push(h("p", { class: "hint" }, "Keep it on your tailnet for good: on Tailscale's Machines page, its ⋯ → Disable key expiry (else it drops off in 180 days)."),
      tailscaleLink("Tailscale's Machines page", "https://login.tailscale.com/admin/machines"));
  }
  const can = m.me || m.on;
  const rows = [["claude", "Claude", m.claude], ["github", "GitHub", m.github]].filter(([, , v]) => v === "in" || v === "out");
  if (can && rows.length) {
    kids.push(h("div", { class: "section" }, "Signed in"));
    for (const [what, label, v] of rows) {
      kids.push(v === "in"
        ? h("div", { class: "control wide machine-row signin-row" }, h("span", { class: "machine-row-name" }, label), uiPill("Signed in", "done"))
        : h("button", { class: "control wide machine-row signin-row", onclick: () => signinSheet(m, what) },
          h("span", { class: "machine-row-name" }, `Sign in to ${label}…`), uiPill("Not yet", "ask")));
    }
  }
  return kids;
}

// ---- Add a cloud machine

async function cloudAddSheet() {
  const s = { provider: null, region: null, size: null, d: null, regions: {}, sizes: {}, busy: false, err: {} };
  const body = h("div", { class: "cloud-add" }, h("p", {}, "…"));
  const back = sheet({ key: "cloud-add" }, sheetHead("Add a cloud machine", "In your own cloud account"), body);
  // Fields kept across redraws (what you typed stays).
  const name = field({ placeholder: "cloud", maxlength: "40", "aria-label": "Its name", autocapitalize: "none" }, () => create());
  name.addEventListener("input", () => {
    const v = name.value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (v !== name.value) name.value = v;
    draw();
  });
  const token = secretField("Its API token", () => connect());
  const tsKey = secretField("tskey-auth-…", () => saveKey());
  const provider = () => (s.d && s.d.providers.find((p) => p.key === s.provider)) || null;
  const size = () => ((s.sizes[`${s.provider}:${s.region}`] || {}).sizes || []).find((x) => x.id === s.size) || null;

  const load = async () => {
    try { s.d = await cloudGet("/api/cloud"); } catch (e) { s.err.load = e.message; }
    if (s.d && !name.value) name.value = s.d.name || "cloud";
    if (s.d && !s.provider) s.provider = (s.d.providers.find((p) => p.connected) || {}).key || null;
    draw();
    if (s.provider) loadRegions();
  };
  const loadRegions = async () => {
    const p = provider();
    if (!p || !p.connected || s.regions[p.key]) return draw();
    s.regions[p.key] = { loading: true };
    draw();
    try { s.regions[p.key] = await cloudGet(`/api/cloud/options?provider=${encodeURIComponent(p.key)}`); }
    catch (e) { s.regions[p.key] = { error: e.message }; }
    const list = s.regions[p.key].regions || [];
    if (!s.region || !list.some((r) => r.id === s.region)) s.region = list.length ? list[0].id : null;
    draw();
    if (s.region) loadSizes();
  };
  const loadSizes = async () => {
    const k = `${s.provider}:${s.region}`;
    if (!s.sizes[k]) {
      s.sizes[k] = { loading: true };
      draw();
      try { s.sizes[k] = await cloudGet(`/api/cloud/options?provider=${encodeURIComponent(s.provider)}&region=${encodeURIComponent(s.region)}`); }
      catch (e) { s.sizes[k] = { error: e.message }; }
    }
    const list = s.sizes[k].sizes || [];
    if (!list.some((x) => x.id === s.size)) s.size = (list.find((x) => x.recommended) || list[0] || {}).id || null;
    draw();
  };
  const connect = async () => {
    const p = provider();
    if (!p || s.busy) return;
    if (!token.input.value.trim()) { token.input.focus(); return toast("Paste its token first"); }
    s.busy = "token";
    draw();
    try {
      const r = await api("/api/cloud", { action: "token", provider: p.key, value: token.input.value });
      token.input.value = "";
      toast(r.said || `${p.label} connected`);
      s.busy = false;
      await load();
    } catch (e) { s.busy = false; toast(e.message); draw(); }
  };
  const saveKey = async () => {
    if (s.busy) return;
    if (!tsKey.input.value.trim()) { tsKey.input.focus(); return toast("Paste the key first"); }
    s.busy = "key";
    draw();
    try {
      await api("/api/cloud", { action: "tailscale-key", value: tsKey.input.value });
      tsKey.input.value = "";
      toast("Tailscale key kept");
      s.d.tailscale_key = true;
    } catch (e) { toast(e.message); }
    s.busy = false;
    draw();
  };
  const create = async () => {
    const p = provider(), z = size();
    if (!p || !z || !s.d.tailscale_key || s.busy || !s.d.ready) return;
    s.busy = "create";
    draw();
    try {
      const r = await api("/api/cloud", { action: "create", provider: p.key, region: s.region, size: z.id, name: name.value.trim() || s.d.name });
      toast(`${r.machine.name}: on its way at ${p.label}`);
      closeSheet();
      cloudSheet(r.machine.name);
    } catch (e) { s.busy = false; toast(e.message); draw(); }
  };

  const draw = () => {
    if (!s.d) return body.replaceChildren(h("p", {}, s.err.load || "…"));
    const kids = [h("p", {}, `A machine that never sleeps, in your own account: the provider bills you, amarchy never does. ${s.d.min_gb} GB runs a dozen chats.`)];
    if (!s.d.ready) kids.push(h("p", { class: "note" }, s.d.why));
    kids.push(h("div", { class: "section" }, "Provider"),
      uiPick(s.d.providers.map((p) => ({ key: p.key, label: p.label, detail: p.notes, aside: p.connected ? uiPill("Connected", "done") : null })),
        { on: s.provider, label: "Provider", pick: (k) => { s.provider = k; s.region = null; s.size = null; draw(); loadRegions(); } }));
    const p = provider();
    if (p && !p.connected) {
      kids.push(h("div", { class: "section" }, `Connect ${p.label}`),
        h("p", {}, `${p.token_how}. It's kept on ${machineOf("").label || "this machine"}, never in a chat.`),
        tailscaleLink(`Make a token at ${p.label}`, p.token_url),
        token.el,
        h("button", { class: "control wide accent", disabled: s.busy === "token", onclick: connect }, s.busy === "token" ? "Checking it…" : "Connect"));
    }
    if (p && p.connected) {
      const rs = s.regions[p.key] || {};
      kids.push(h("div", { class: "section" }, "Where"));
      if (rs.loading) kids.push(h("p", { class: "hint" }, `Asking ${p.label}…`));
      else if (rs.error) kids.push(h("p", { class: "note" }, rs.error));
      else if (rs.regions) kids.push(uiPick(rs.regions.map((r) => ({ key: r.id, label: r.label, detail: r.id }))
        , { on: s.region, label: "Region", pick: (k) => { s.region = k; s.size = null; draw(); loadSizes(); } }));
      const zs = s.region ? s.sizes[`${p.key}:${s.region}`] || {} : null;
      if (zs) {
        kids.push(h("div", { class: "section" }, "Size"));
        if (zs.loading) kids.push(h("p", { class: "hint" }, "Its sizes and prices…"));
        else if (zs.error) kids.push(h("p", { class: "note" }, zs.error));
        else if (zs.sizes) kids.push(uiPick(zs.sizes.map((z) => ({
          key: z.id, label: z.label, badge: z.recommended ? "Recommended" : null, dim: !z.enough,
          detail: [`${z.cores} vCPU · ${z.memory_gb} GB · ${z.disk_gb} GB disk`, z.enough ? z.note : `under ${s.d.min_gb} GB: fewer chats`].filter(Boolean).join(" · "),
          aside: `${uiMoney(z.monthly, z.currency)}/mo` })), { on: s.size, label: "Size", pick: (k) => { s.size = k; draw(); } }));
      }
      kids.push(h("div", { class: "section" }, "Name"), name,
        h("p", { class: "hint" }, "Its name on your tailnet, the board and at the provider."));
      kids.push(h("div", { class: "section" }, "Tailscale"));
      if (s.d.tailscale_key) kids.push(h("p", {}, "A one-off key is ready: the new machine joins your tailnet with it, once, and it's forgotten."));
      else kids.push(h("p", {}, s.d.key_how), tailscaleLink("Make a one-off key at Tailscale", s.d.keys_url), tsKey.el,
        h("button", { class: "control wide", disabled: s.busy === "key", onclick: saveKey }, "Keep the key"));
      const z = size();
      const ok = z && s.d.tailscale_key && s.d.ready && /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(name.value.trim() || s.d.name);
      kids.push(h("button", { class: "control wide accent cloud-create", disabled: !ok || s.busy === "create", onclick: create },
        s.busy === "create" ? `Creating it at ${p.label}…` : z ? `Create ${name.value.trim() || s.d.name} · ${uiMoney(z.monthly, z.currency)} a month` : "Create"),
      z ? h("p", { class: "hint" }, p.billing === "subscription"
        ? `Charged now by ${p.label}, ${z.first ? `${uiMoney(z.first, z.currency)} the first month, then ` : ""}${uiMoney(z.monthly, z.currency)} a month, from your default payment method. Hostinger can't delete one at once: removing it stops it and its renewal.`
        : `${p.label} bills your account by the hour, up to ${uiMoney(z.monthly, z.currency)} a month, until you remove it. It's up in about 10 minutes.`) : null);
    }
    uiPatch(body, kids);
  };
  back.redraw = () => draw();
  load();
}

// ---- a cloud machine coming up, or made: its sheet

// The steps it goes through, each as it stands.
function cloudSteps(m) {
  const c = m.cloud || {};
  const order = ["creating", "booting", "installing", "tailnet", "paired"];
  const at = c.steps || {};
  const failedAt = c.step === "failed" ? order.slice().reverse().find((k) => at[k]) || "creating" : null;
  const now = c.step === "pairing" ? "tailnet" : c.step;
  const done = (k) => c.step === "removed" || order.indexOf(k) < order.indexOf(failedAt || now) || (c.step === "paired" && k === "paired");
  const time = (k) => (at[k] ? new Date(at[k] * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
  const label = { creating: `Created at ${c.provider_label || "the provider"}`, booting: "Started up", installing: "Installing",
                  tailnet: "On your tailnet", paired: `Paired with ${machineOf("").label || "this machine"}` };
  const items = order.map((k) => {
    const state = failedAt === k ? "failed" : done(k) ? "done" : (now === k || (k === "tailnet" && c.step === "pairing")) && !failedAt ? "now" : "next";
    const note = state === "failed" ? c.error : state === "now" ? c.detail : k === "creating" && state === "done" ? cloudWhat(c) : "";
    return { label: label[k], state, note, at: state === "done" || state === "failed" ? time(k === "tailnet" && !at.tailnet ? "pairing" : k) : "" };
  });
  if (c.step === "paired" && !m.making) {
    items.push({ label: "Claude signed in there", state: m.claude === "in" ? "done" : "next", note: m.claude === "in" ? "" : "Sign in below" });
  }
  return items;
}

function cloudSheet(name) {
  const box = h("div", {});
  const head = sheetHead(name, "Cloud machine");
  const back = sheet({ key: "cloud" }, head, box);
  const find = () => machinesAll().find((x) => x.cloud && x.cloud.made_here && (x.cloud.name === name || x.name === name)) || null;
  const draw = () => {
    const m = find();
    if (!m) return uiPatch(box, [h("p", {}, "It's gone from the list.")]);
    const c = m.cloud;
    const kids = [h("p", { class: "cloud-cost" }, [c.provider_label, cloudPrice(c)].filter(Boolean).join(" · "))];
    if (c.step !== "removed") kids.push(h("p", { class: "hint" }, cloudBilling(c)));
    kids.push(uiSteps(cloudSteps(m)));
    if (c.remove) {
      kids.push(h("p", {}, c.detail || "Removing it…"));
    } else if (c.step === "removed") {
      kids.push(h("p", {}, c.detail || "Removed."),
        h("button", { class: "control wide", onclick: async () => {
          try { await api("/api/cloud", { action: "dismiss", name: c.name }); } catch (e) { /* gone already */ }
          closeSheet();
        } }, "OK"));
    } else if (c.step === "failed") {
      if (c.log) kids.push(uiFolds(uiFold("What it said", {}, h("pre", { class: "cloud-log" }, c.log))));
      kids.push(c.never_made && !c.id
        ? h("button", { class: "control wide", onclick: async () => {
            try { await api("/api/cloud", { action: "dismiss", name: c.name }); closeSheet(); } catch (e) { toast(e.message); }
          } }, "Forget it (nothing was made)")
        : h("button", { class: "control wide danger", onclick: () => cloudRemoveSheet(m) }, `Remove it (deletes it at ${c.provider_label})…`));
    } else if (c.step === "paired" && !m.making) {
      if (m.claude === "out") kids.push(h("button", { class: "control wide accent", onclick: () => signinSheet(m, "claude") }, `Sign in to Claude on ${m.label}`));
      if (m.github === "out") kids.push(h("button", { class: "control wide", onclick: () => signinSheet(m, "github") }, `Sign in to GitHub on ${m.label}`));
      if (m.claude === "in") kids.push(h("p", {}, "Ready: a new chat's Where can be this machine."));
      kids.push(h("button", { class: "control wide", onclick: () => { closeSheet(); machineSheet(m.name); } }, "Its settings…"));
    } else {
      kids.push(h("p", { class: "hint" }, "About 10 minutes in all. You can close this: Settings → Machines says where it stands."),
        h("button", { class: "control wide danger", onclick: () => cloudRemoveSheet(m) }, "Stop and remove it…"));
    }
    head.querySelector("h2").textContent = m.label || name;
    uiPatch(box, kids);
  };
  back.live = draw;
  back.redraw = draw;
  draw();
}

// Every open sheet of these drawn again as the board changes (refresh: app.js).
function cloudLive() {
  for (const b of document.querySelectorAll(".sheet-back")) {
    if (b.live && !b.hidden) uiWhenStill(`cloud-live-${b.key || ""}`, () => { if (b.isConnected && !b.hidden) b.live(); });
  }
}

// ---- Remove: it says what goes with it, and offers to move its chats first

function cloudRemoveSheet(m) {
  const c = m.cloud || {};
  const chats = ((app.view && app.view.sessions) || []).filter((s) => machineOf(s).name === m.name);
  const movable = chats.filter((s) => !isAgent(s));
  const stays = chats.length - movable.length;
  const named = chats.slice(0, 4).map((s) => s.title || s.task || s.name).join(", ") + (chats.length > 4 ? "…" : "");
  const billing = c.billing === "subscription"
    ? `${c.provider_label} stops it, and its subscription isn't renewed: it ends with the month paid for.`
    : `It's deleted at ${c.provider_label}, with everything on it${c.monthly ? `, and its ${uiMoney(c.monthly, c.currency)} a month stops` : ""}.`;
  const go = async (how) => {
    try {
      await api("/api/cloud", { action: "remove", name: c.name, move_chats: how === "move", lose_chats: how === "lose" });
      toast(how === "move" ? `Moving ${m.label}'s chats here first, then removing it` : `Removing ${m.label}…`);
      closeSheets();
      cloudSheet(c.name);
    } catch (e) { toast(e.message); }
  };
  const kids = [h("p", {}, billing)];
  if (chats.length) {
    kids.push(h("p", {}, `Its ${chats.length} chat${chats.length === 1 ? "" : "s"} (${named}) go${chats.length === 1 ? "es" : ""} with it: their worktrees, what isn't pushed, their conversations.`));
    if (stays) kids.push(h("p", { class: "hint" }, `${stays === 1 ? "Your assistant or an agent lives" : `${stays} of them are your assistant or agents: they live`} on that machine and can't move.`));
    if (movable.length) kids.push(h("button", { class: "control wide accent", onclick: () => go("move") },
      `Move ${movable.length === 1 ? "its chat" : `its ${movable.length} chats`} to ${machineOf("").label || "this machine"} first`),
      h("p", { class: "hint" }, "Each moves once it's free (its secrets with it), then the machine is removed."));
    kids.push(h("button", { class: "control wide danger", onclick: () => go("lose") }, `Remove it, and lose ${chats.length === 1 ? "its chat" : "its chats"}`));
  } else {
    kids.push(h("button", { class: "control wide danger", onclick: () => go("none") }, `Remove ${m.label}`));
  }
  kids.push(h("button", { class: "control wide", onclick: () => closeSheet() }, "Cancel"));
  sheet({ key: "cloud-remove" }, sheetHead(`Remove ${m.label}?`, c.provider_label || "Cloud machine"), ...kids);
}

// ---- signing in on a machine: Claude, GitHub

async function signinSheet(m, what) {
  const label = what === "claude" ? "Claude" : "GitHub";
  const path = cloudAt(m, `/api/signin/${what}`);
  const box = h("div", {}, h("p", {}, `Starting ${label}'s sign-in on ${m.label}…`));
  const back = sheet({ key: `signin-${what}` }, sheetHead(`Sign in to ${label}`, `On ${m.label}`), box);
  let done = false, poll = null;
  const code = field({ placeholder: "The code the page gave you", "aria-label": "The code", autocapitalize: "none" }, () => send());
  const finish = (d) => {
    done = true;
    clearInterval(poll);
    toast(`${label} is signed in on ${m.label}${d && d.who ? ` as ${d.who}` : ""}`);
    closeSheet();
  };
  const send = async (btn) => {
    if (!code.value.trim()) { code.focus(); return toast("Paste the code first"); }
    if (btn) btn.disabled = true;
    try { finish(await api(path, { do: "code", code: code.value.trim() })); }
    catch (e) { toast(e.message); if (btn) btn.disabled = false; if (/start again|ended/.test(e.message)) start(); }
  };
  const start = async () => {
    let d;
    try { d = await api(path, { do: "login" }); }
    catch (e) { return box.replaceChildren(h("p", { class: "note" }, e.message), h("button", { class: "control wide", onclick: () => start() }, "Try again")); }
    if (what === "claude") {
      box.replaceChildren(
        h("p", {}, "1. Open Anthropic's sign-in page and sign in with your Claude account."),
        tailscaleLink("Open the sign-in page", d.url, true),
        h("p", {}, "2. It gives you a code: copy it, and paste it here."),
        code,
        h("button", { class: "control wide accent", onclick: (e) => send(e.currentTarget) }, "Sign in"),
        h("p", { class: "hint" }, `It signs in ${m.label}'s own Claude: each machine signs in on its own.`));
      if (app.desk) code.focus();
    } else {
      box.replaceChildren(
        h("p", {}, "1. Copy this code:"),
        h("button", { class: "control wide signin-code", onclick: () => copyText(d.code).then(() => toast(`Copied: ${d.code}`)) }, d.code || "…"),
        h("p", {}, "2. Open GitHub's page, paste it there and authorize. This finishes by itself."),
        tailscaleLink("Open github.com/login/device", d.url, true),
        h("p", { class: "hint" }, `Git on ${m.label} then pushes as you (gh auth setup-git).`));
      poll = setInterval(async () => {
        if (done || !back.isConnected) return clearInterval(poll);
        try { const s = await cloudGet(path); if (s.signed_in) finish(s); else if (s.login && s.login.error) { clearInterval(poll); toast(s.login.error); } }
        catch (e) { /* again in a moment */ }
      }, 2000);
    }
  };
  const was = back.remove.bind(back);
  back.remove = () => { clearInterval(poll); if (!done) api(path, { do: "cancel" }).catch(() => {}); was(); };
  start();
}
