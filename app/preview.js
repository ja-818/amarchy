// ---- the page a chat's Preview button opens when its preview isn't running
//
// preview.html?id=<chat>: it starts the chat's preview (amarchy runs its
// command: bin/amarchy's "a chat's preview"), says so while it comes up,
// with what it writes, and turns into it the moment it answers. Should it
// stop with an error, or not answer in PREVIEW_PAGE_WAIT, it says so, with
// what it wrote, Try again, and Ask Claude to fix it. A page of its own, not
// the app's (it opens in a tab, or the phone's browser, and goes), drawn
// with the app's card (ui.css) in your theme.

const PREVIEW_PAGE_WAIT = 120000;      // ms it waits for it to answer
const pv = { id: new URLSearchParams(location.search).get("id") || "", since: Date.now(), kicked: false };
const $ = (sel) => document.querySelector(sel);

async function pvPost(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `It didn't work (${r.status})`);
  return d;
}

function pvButton(label, act, primary) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `tbtn${primary ? " primary" : ""}`;
  b.textContent = label;
  b.onclick = act;
  return b;
}

function pvSay(title, text, log, buttons) {
  $(".preview-title").textContent = title;
  document.title = title;
  $(".preview-say").textContent = text;
  const pre = $(".preview-log");
  pre.hidden = !log;
  pre.textContent = log || "";
  pre.scrollTop = pre.scrollHeight;
  const bar = $(".tcard-actions");
  bar.replaceChildren(...(buttons || []));
  bar.hidden = !(buttons || []).length;
}

async function pvStart(restart) {
  pv.since = Date.now();
  pv.kicked = true;
  pvSay("Starting the preview…", "Starting it. It opens here as soon as it answers.", "", []);
  try {
    await pvPost(`/api/session/${encodeURIComponent(pv.id)}/preview`, { action: restart ? "restart" : "start" });
  } catch (e) {
    return pvFailed(e.message, "");
  }
  pvWatch();
}

function pvFailed(why, log, p) {
  const fix = async () => {
    try {
      await pvPost(`/api/session/${encodeURIComponent(pv.id)}/send`, {
        text: `The preview${p && p.run ? ` (${p.run})` : ""} didn't start: ${why}.${log ? ` Its log ends:\n\n${log.split("\n").slice(-15).join("\n")}\n\n` : " "}Fix it and start it again (amarchy preview restart).` });
      pvSay("Asked Claude to fix it", "Its chat has your message. Its Preview button opens it once it's running.", log, []);
    } catch (e) {
      pvSay("The preview didn't start", e.message, log, []);
    }
  };
  pvSay("The preview didn't start", `${why[0].toUpperCase()}${why.slice(1)}.`, log, [pvButton("Try again", () => pvStart(true), true), pvButton("Ask Claude to fix it", fix)]);
}

// It answers: this page turns into it. In a Mac's Dock app this page is a
// window of the app, and the preview belongs in the default browser: macOS
// gives it a link followed in place, by the machine's number address (one by
// its name stays in the app: app.js's "links out"). So there it goes by that
// address, and the page left behind says so, with a link to open it again.
const pvMacApp = /Macintosh/.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1)
  && (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true);

function pvOpen(p) {
  if (!pvMacApp) return location.replace(p.url);
  const url = p.direct || p.url;
  const a = document.createElement("a");
  a.className = "tbtn primary";
  a.href = url;
  a.textContent = "Open it";
  pvSay(`${p.task ? `${p.task}'s preview` : "The preview"} is running`, `${p.url} is open in your browser. You can close this window.`, "", [a]);
  location.href = url;
}

async function pvWatch() {
  let p;
  try {
    const r = await fetch(`/api/session/${encodeURIComponent(pv.id)}/preview`);
    p = await r.json();
    if (!r.ok) throw new Error(p.error || "Couldn't read it");
  } catch (e) {
    return pvSay("No preview here", e instanceof TypeError ? "Can't reach Amarchy." : e.message, "", []);
  }
  document.title = `Starting ${p.task}'s preview…`;
  if (p.state === "up") return pvOpen(p);
  if (!p.run) return pvSay("Nothing answers", `${p.url} isn't answering, and amarchy has no command to start it with: ask its chat to.`, "", []);
  // Not running: started (a failed one only by Try again, once you've seen why).
  if (p.state === "stopped" && !pv.kicked) return pvStart(false);
  if (p.state === "failed" || p.state === "stopped") return pvFailed("it stopped on its own", p.log, p);
  if (Date.now() - pv.since > PREVIEW_PAGE_WAIT)
    return pvFailed(`nothing answers at ${p.url} after ${Math.round(PREVIEW_PAGE_WAIT / 1000)} s`, p.log, p);
  pvSay(`Starting ${p.task}'s preview…`, `It opens here as soon as ${p.url} answers.`, p.log, []);
  setTimeout(pvWatch, 700);
}

pvWatch();
