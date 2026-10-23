// Secrets: a key or a password a project needs, given here, never in the
// chat (the transcript keeps everything said there, and Claude reads it).
// bin/amarchy's "secrets" keeps them on the host, 0600 and outside every
// repo, and gives them to the session's commands by name ($OPENAI_API_KEY).
//
// - Claude asks for one (`amarchy secret ask NAME --why ...`): the session's
//   row has it in secret_asks, and the chat's dock shows it as a card with a
//   password field (secretDock, secretCard: chat.js asks for them).
// - You add one: Settings → Secrets, or a session's menu → Add a secret
//   (secretsSheet, addSecretSheet).
// Only names ever come back from the host, never a value.
//
// Uses app.js's helpers (h, api, toast, sheet...) and manage.js's field, at
// run time; loaded after chat.js, whose card styles it wears.
"use strict";

// What a name is, in words, for the ones people mostly have.
const SECRET_WORDS = {
  OPENAI_API_KEY: "OpenAI API key", GEMINI_API_KEY: "Gemini API key", GOOGLE_API_KEY: "Google API key",
  STRIPE_SECRET_KEY: "Stripe secret key", STRIPE_API_KEY: "Stripe API key", GITHUB_TOKEN: "GitHub token",
  GH_TOKEN: "GitHub token", DATABASE_URL: "database address (DATABASE_URL)", AWS_ACCESS_KEY_ID: "AWS access key ID",
  AWS_SECRET_ACCESS_KEY: "AWS secret access key", SUPABASE_SERVICE_ROLE_KEY: "Supabase service role key",
  RESEND_API_KEY: "Resend API key", HF_TOKEN: "Hugging Face token", SENTRY_AUTH_TOKEN: "Sentry auth token",
  CLOUDFLARE_API_TOKEN: "Cloudflare API token", OPENROUTER_API_KEY: "OpenRouter API key",
  MISTRAL_API_KEY: "Mistral API key", GROQ_API_KEY: "Groq API key", ELEVENLABS_API_KEY: "ElevenLabs API key",
};
const KEY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/></svg>';

function secretWords(name) { return SECRET_WORDS[name] || name; }

function keyIcon() { return h("span", { class: "ic", "aria-hidden": "true", html: KEY_ICON }); }

// A password field with Show, for a secret's value.
function secretField(placeholder, onEnter) {
  const input = h("input", { type: "password", class: "input secret-value", placeholder, autocomplete: "off",
                             autocorrect: "off", autocapitalize: "off", spellcheck: "false", "data-1p-ignore": "",
                             "data-lpignore": "true", "aria-label": placeholder,
                             onkeydown: (e) => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } } });
  const show = h("button", { class: "text-btn", type: "button", "aria-pressed": "false", onclick: () => {
    const on = input.type === "password";
    input.type = on ? "text" : "password";
    show.textContent = on ? "Hide" : "Show";
    show.setAttribute("aria-pressed", String(on));
  } }, "Show");
  return { input, el: h("div", { class: "secret-input" }, input, show) };
}

// This project or all of them, as a two-way switch.
function scopeSeg(repo, start, changed) {
  let scope = start;
  const seg = h("div", { class: "seg secret-scope", role: "radiogroup", "aria-label": "For which projects" });
  const draw = () => seg.replaceChildren(...[["project", repo ? `Only ${repo}` : "This project"], ["all", "All projects"]].map(([v, label]) =>
    h("button", { class: `control${scope === v ? " on" : ""}`, type: "button", role: "radio", "aria-checked": String(scope === v),
                  onclick: () => { scope = v; draw(); if (changed) changed(v); } }, label)));
  draw();
  return { el: seg, get: () => scope };
}

// ---- Claude asks: the card in the chat's dock

// The card that's up for the chat (chat.js's current()), or null: the oldest
// secret its Claude asks for.
function secretDock(chat) {
  const asks = chat.row && Array.isArray(chat.row.secret_asks) ? chat.row.secret_asks : [];
  const ask = asks[0];
  if (!ask) return null;
  return { card: { kind: "secret", ask, more: asks.length - 1 }, key: `secret:${ask.id}` };
}

function secretCard(chat, m) {
  const a = m.ask;
  const what = secretWords(a.name);
  const card = h("div", { class: "card secret", role: "group", tabindex: "-1", "aria-label": `Claude needs your ${what}` });
  card.append(h("div", { class: "card-head" }, keyIcon(), h("span", { class: "title" }, `Claude needs your ${what}`),
                m.more ? h("span", { class: "count" }, `and ${m.more} more`) : null));
  card.append(h("div", { class: "card-text" }, a.why ? `${a.why.replace(/[.\s]+$/, "")}.` : "For this project's commands."),
              h("div", { class: "card-note" }, `It's kept on your server, never shown in the chat, and the session's commands get it as $${a.name}.` +
                (a.again ? " It replaces the one kept now." : "")));
  if (!a.waiting) card.append(h("div", { class: "card-note warn" }, "Claude stopped waiting for it. Save it anyway and Claude is told."));
  const send = () => {
    const value = value_.input.value;
    if (!value.trim()) { value_.input.focus(); return toast("Paste or type it first"); }
    chat.act(card, () => chat.post("secret", { ask: a.id, value, scope: scope.get() }).then(() => {
      value_.input.value = "";
      toast(`${what} saved`);
    }), save);
  };
  const value_ = secretField(what, send);
  const scope = scopeSeg(a.repo, a.scope === "all" ? "all" : "project");
  const save = h("button", { class: "cta primary", type: "button", onclick: send }, "Save");
  // Not given: with why, or with nothing said.
  const decline = (why) => chat.post("secret", { ask: a.id, decline: true, message: why });
  decline.empty = true;
  const no = chat.writeField(card, "Tell Claude why, or what to do instead (optional)", "Don't give it", decline);
  no.box.querySelector(".cta").classList.replace("primary", "danger");
  const actions = h("div", { class: "card-actions" }, save,
    h("button", { class: "cta", type: "button", onclick: () => { actions.hidden = true; no.open(); } }, "Don't give it…"));
  card.append(value_.el, scope.el, actions, no.box);
  // The field has the keyboard as the card comes up, on a computer.
  if (app.desk) setTimeout(() => { if (card.isConnected && !card.contains(document.activeElement)) value_.input.focus({ preventScroll: true }); }, 50);
  return card;
}

// ---- Settings → Secrets

async function secretsGet() {
  const r = await fetch("/api/secrets");
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Can't read the secrets");
  return d;
}

// The Settings section: what it is, and the way in.
function secretsSettings() {
  return [h("div", { class: "section" }, "Secrets"),
    h("p", {}, "API keys and passwords your projects need, kept on your server, never in a chat. Claude asks for one with a card; its commands get it by name."),
    h("button", { class: "control wide", onclick: () => secretsSheet() }, "Secrets…")];
}

// Every secret by name (never a value), for every project and per project;
// each one can be forgotten, or a new one added.
async function secretsSheet() {
  const body = h("div", {}, h("p", {}, "…"));
  const back = sheet({ key: "secrets" }, sheetHead("Secrets", "Kept on your server, outside every project"), body);
  back.redraw = () => draw();
  const draw = async () => {
    let d;
    try { d = await secretsGet(); } catch (e) { body.replaceChildren(h("p", {}, e.message)); return; }
    const row = (s, project) => h("div", { class: "secret-row" },
      h("div", { class: "text" }, h("b", {}, s.name), h("small", {}, `${secretWords(s.name) !== s.name ? `${secretWords(s.name)} · ` : ""}set ${new Date(s.at * 1000).toLocaleDateString()}`)),
      h("button", { class: "text-btn danger", type: "button", "aria-label": `Forget ${s.name}`, onclick: async () => {
        try { await api("/api/secrets", { name: s.name, project, forget: true }); toast(`${s.name} forgotten`); draw(); }
        catch (e) { toast(e.message); }
      } }, "Forget"));
    const kids = [];
    const groups = [[null, "All projects", d.all], ...Object.entries(d.projects).map(([p, list]) => [p, p, list])];
    if (!groups.some(([, , list]) => list.length)) kids.push(h("p", {}, "None yet. When Claude needs one, it asks you here, with a card in its chat."));
    for (const [project, label, list] of groups) {
      if (!list.length) continue;
      kids.push(h("div", { class: "section" }, label), h("div", { class: "secret-list" }, ...list.map((s) => row(s, project))));
    }
    kids.push(h("button", { class: "control wide accent", onclick: () => addSecretSheet({}) }, "Add a secret…"),
      h("p", { class: "hint" }, "A project's own wins over one for all projects. A dev server already running gets a new one when it starts again (Run)."));
    keepFocus(body.parentNode || body, () => body.replaceChildren(...kids));
  };
  draw();
}

// Add one: its name (suggestions to tap), the value, and for which project.
// opts.project: the session's project, picked to start with.
async function addSecretSheet(opts) {
  let d = { suggestions: [], projects_known: [] };
  try { d = await secretsGet(); } catch (e) { /* still: a name of your own */ }
  const projects = d.projects_known || [];
  let project = opts.project && projects.includes(opts.project) ? opts.project : null;
  const name = field({ placeholder: "Its name, like OPENAI_API_KEY", maxlength: "100", autocapitalize: "characters" }, () => value.input.focus());
  name.addEventListener("input", () => {
    const up = name.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    if (up !== name.value) name.value = up;
  });
  const chips = h("div", { class: "secret-chips" }, ...(d.suggestions || []).slice(0, 6).map((n) =>
    h("button", { class: "control", type: "button", onclick: () => { name.value = n; value.input.focus(); } }, n)));
  const save = async () => {
    const n = name.value.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) { name.focus(); return toast("A name of letters, digits and _, like OPENAI_API_KEY"); }
    if (!value.input.value.trim()) { value.input.focus(); return toast("And its value"); }
    try {
      await api("/api/secrets", { name: n, value: value.input.value, project });
      value.input.value = "";
      toast(`${n} saved for ${project || "all projects"}`);
      closeSheet();
    } catch (e) { toast(e.message); }
  };
  const value = secretField("Its value", save);
  const where = h("div", { class: "menu" });
  const drawWhere = () => where.replaceChildren(...[[null, "All projects"], ...projects.map((p) => [p, p])].map(([p, label]) =>
    h("button", { class: `menu-item${project === p ? " on" : ""}`, type: "button", onclick: () => { project = p; drawWhere(); } },
      h("span", { class: "label" }, label), project === p ? glyph("check", "val") : null)));
  drawWhere();
  sheet({ key: "add-secret" }, sheetHead("Add a secret", "Never shown in a chat"),
    h("div", { class: "section" }, "Name"), name, chips,
    h("div", { class: "section" }, "Value"), value.el,
    h("div", { class: "section" }, "For"), where,
    h("button", { class: "control wide accent", onclick: save }, "Save"));
  name.focus();
}
