// The desktop app's own page: it asks the app (status) what's going on and
// shows that; a machine picked, an address typed or Try again go back to it.
// The phone apps show this same page (phone/: they set window.amarchyShell,
// whose invoke takes the same commands).
"use strict";

const invoke = (cmd, args) => (window.amarchyShell || window.__TAURI_INTERNALS__).invoke(cmd, args || {});
const $ = (id) => document.getElementById(id);
let shown = "";

function render(s) {
  const key = JSON.stringify(s);
  if (key === shown) return;
  shown = key;
  const title = { opening: "Opening Amarchy…", choose: "Which amarchy?", nothing: "Can't find your amarchy",
                  failed: `Can't reach ${s.label || "amarchy"}`, signin: "Sign in to Tailscale" }[s.kind] || "Amarchy";
  $("title").textContent = title;
  document.title = s.kind === "opening" ? "Amarchy" : `Amarchy · ${title}`;
  const why = s.kind === "choose" ? "Several of yours answer on your tailnet. This computer opens the one you pick from now on."
    : s.kind === "signin" ? (s.waiting ? "Waiting for you to sign in, in your browser…"
      : s.why || "This computer reaches your amarchy through Tailscale, with amarchy's own node (nothing else to install). Sign in with the Tailscale account your other machines use.")
    : s.why || "";
  $("why").textContent = why;
  $("why").hidden = !why;
  const list = $("machines");
  list.replaceChildren(...(s.machines || []).map((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "machine";
    const name = document.createElement("span");
    name.textContent = m.label || m.name;
    const where = document.createElement("small");
    where.textContent = m.url || m.name;
    b.append(name, where);
    b.addEventListener("click", () => act(() => invoke("choose", { name: m.name })));
    return b;
  }));
  list.hidden = s.kind !== "choose";
  $("signin").hidden = s.kind !== "signin";
  $("signin-go").textContent = s.waiting ? "Open the sign-in page again" : "Sign in to Tailscale";
  $("address").hidden = !["nothing", "failed"].includes(s.kind);
  $("actions").hidden = !["nothing", "failed"].includes(s.kind);
  $("error").hidden = true;
}

async function act(fn) {
  $("error").hidden = true;
  try {
    await fn();
    shown = "";
    render({ kind: "opening" });
  } catch (e) {
    $("error").textContent = String(e);
    $("error").hidden = false;
  }
}

$("address").addEventListener("submit", (e) => {
  e.preventDefault();
  const address = $("addr").value.trim();
  if (address) act(() => invoke("use_address", { address }));
});
$("retry").addEventListener("click", () => act(() => invoke("retry")));
$("signin-go").addEventListener("click", async () => {
  $("error").hidden = true;
  try { await invoke("sign_in"); } catch (e) { $("error").textContent = String(e); $("error").hidden = false; }
});

async function poll() {
  try { render(await invoke("status")); } catch (e) { /* the app is busy: next time */ }
  setTimeout(poll, 500);
}
poll();
