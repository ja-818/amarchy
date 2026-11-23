// Tailscale: the network your devices and machines meet on. Settings →
// Tailscale shows where it stands on the host (bin/amarchy's "amarchy
// tailscale": GET /api/tailscale), the system's Tailscale or amarchy's own
// node (track H: offered first where there's none, started with a tap),
// and takes it a step further each time:
// sign in (the sign-in link, opened in your browser), turn it on, the
// tailnet's MagicDNS and HTTPS certificates (the admin page where each is
// turned on), and which account it uses when more than one is signed in.
// What needs the host's root (installing it, starting its service, letting
// amarchy drive it) is a command to run in a terminal there, with Copy.
// Switching accounts only from the host itself (its desktop app): from
// another device it would cut that device off.
//
// Uses app.js's helpers (h, api, toast, sheet...) at run time.
"use strict";

function tailscaleSettings() {
  return [h("div", { class: "section" }, "Tailscale"),
    h("p", {}, "Your phone and your machines reach this one over it: signed in, with MagicDNS and HTTPS on."),
    h("button", { class: "control wide", onclick: () => tailscaleSheet() }, "Tailscale…")];
}

async function tailscaleGet() {
  const r = await fetch("/api/tailscale");
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Couldn't ask the host (${r.status})`);
  return d;
}

// A link that looks like the sheet's buttons: a page in your browser.
function tailscaleLink(label, url, accent = false) {
  return h("a", { class: `control wide${accent ? " accent" : ""}`, href: url, target: "_blank", rel: "noopener noreferrer" }, label);
}

async function tailscaleSheet() {
  const body = h("div", {}, h("p", {}, "…"));
  const head = sheetHead("Tailscale", "…");
  const back = sheet({ key: "tailscale" }, head, body);
  let d = null;
  const act = async (button, what, extra = {}) => {
    button.disabled = true;
    try { d = await api("/api/tailscale", { do: what, ...extra }); }
    catch (e) { toast(e.message); button.disabled = false; return; }
    draw(d);
  };
  const draw = (known) => {
    d = known;
    const host = d.host || "this machine";
    head.querySelector(".meta").textContent = `On ${host}`;
    const kids = [h("p", {}, `${d.words || ""}.`)];
    for (const step of d.steps || []) {
      kids.push(h("div", { class: "section" }, step.words));
      if (step.do === "own-start") {
        kids.push(h("button", { class: "control wide accent", onclick: (e) => act(e.currentTarget, "own") }, "Start it"),
          h("p", {}, `amarchy's own node, a service of yours on ${host}: Tailscale without installing it.`));
      } else if (step.command) {
        const copy = h("button", { class: "control wide", onclick: async () => {
          try { await navigator.clipboard.writeText(step.command); toast("Copied: paste it in a terminal there"); }
          catch (e) { toast("Couldn't copy it: hold it to copy it"); }
        } }, "Copy the command");
        const why = step.do === "own-install" ? " (it builds the node there, with Go, and asks before installing Go)"
          : step.do === "install" && d.omarchy ? " (Omarchy's own installer, with its Tailscale panel in the bar)"
          : step.root ? " (it asks for your password)" : "";
        kids.push(h("p", {}, `In a terminal on ${host}${why}:`),
          h("code", { class: "share-url" }, step.command), copy);
      } else if (step.do === "install") {
        kids.push(h("p", {}, `Tailscale's instructions for ${host}'s system:`), tailscaleLink("How to install Tailscale", step.url));
      } else if (step.do === "login") {
        kids.push(step.url
          ? tailscaleLink("Open the sign-in page", step.url, true)
          : h("button", { class: "control wide accent", onclick: (e) => act(e.currentTarget, "login") }, "Get the sign-in link"),
        h("p", {}, "It opens in your browser; this comes back on by itself once you've signed in."));
      } else if (step.do === "up") {
        kids.push(h("button", { class: "control wide accent", onclick: (e) => act(e.currentTarget, "up") }, "Turn Tailscale on"));
      } else if (step.url) {
        kids.push(tailscaleLink(step.do === "approve" ? "Approve it" : `Turn on ${step.do === "magicdns" ? "MagicDNS" : "HTTPS certificates"}`, step.url),
          h("p", {}, step.do === "approve" ? "In Tailscale's admin, in your browser." : "On your tailnet's DNS page in Tailscale's admin, in your browser."));
      }
    }
    if ((d.accounts || []).length > 1 || (d.steps || []).some((s) => s.do === "switch")) {
      kids.push(h("div", { class: "section" }, "Accounts"));
      if (d.here) {
        kids.push(h("div", { class: "seg wrap" }, ...d.accounts.map((a) =>
          h("button", { class: `control${a.selected ? " on" : ""}`, title: a.tailnet, onclick: (e) => {
            if (!a.selected) act(e.currentTarget, "switch", { account: a.id });
          } }, a.account))),
          h("p", {}, "The one in use is lit. Another account: sign in to it with tailscale login, in a terminal."));
      } else {
        kids.push(h("p", {}, `${d.accounts.map((a) => `${a.account}${a.selected ? " (in use)" : ""}`).join(", ")}. `
          + `Switch on ${host} itself (its desktop app, or amarchy tailscale switch there): from here it would cut this device off.`));
      }
    }
    if (d.ready) kids.push(h("p", {}, "Ready: your phone and your other machines reach it by its name, over HTTPS."));
    keepFocus(body.parentNode || body, () => body.replaceChildren(...kids));
  };
  const load = async () => {
    try { draw(await tailscaleGet()); } catch (e) { body.replaceChildren(h("p", {}, e.message)); }
  };
  back.redraw = load;
  // Back from the browser (signed in, a setting turned on): as it is now.
  const seen = () => { if (document.visibilityState === "visible" && back.isConnected) load(); };
  document.addEventListener("visibilitychange", seen);
  new MutationObserver((_, obs) => {
    if (back.isConnected) return;
    obs.disconnect();
    document.removeEventListener("visibilitychange", seen);
  }).observe(document.body, { childList: true });
  load();
}
