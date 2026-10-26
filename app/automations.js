// ---- Automations: what runs for you by itself
//
// Every scheduled job on your host (its systemd user timers: your projects'
// jobs, amarchy's own), grouped by whose it is, each with what it does in
// plain words, when it runs, its next run and how the last ones went. One
// opens to its log, Run now, and Pause or Resume (asked first). The timers a
// job arms for itself (a meeting's alarms) are under it, not in the list.
// The server's side is "automations" in bin/amarchy (amarchy automations).
//
// The way in: the clock beside the gear (the phone's list), the clock in the
// list's bar and the menu (a computer), Settings. It wears a red dot while
// one's last run failed.

const AUTO_POLL = 120000;     // ms between looks for a failed one (the dot), while the app is in sight
const AUTO_LIVE = 2000;       // ms between looks while one you started runs
const AUTO_LIVE_MAX = 180000; // ms it's watched that way at most
const autoState = { list: null, at: 0, failed: 0, loading: null };

async function automationsGet() {
  if (autoState.loading) return autoState.loading;
  autoState.loading = (async () => {
    try {
      const r = await fetch("/api/automations", { headers: { Accept: "application/json" } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Can't read the automations");
      autoState.list = d.automations || [];
      autoState.at = Date.now();
      autoState.failed = autoState.list.filter(autoFailed).length;
      autoDots();
      return autoState.list;
    } catch (e) {
      throw e instanceof TypeError ? new Error("Can't reach Amarchy") : e;
    } finally {
      autoState.loading = null;
    }
  })();
  return autoState.loading;
}

// Its last run failed, and it isn't paused (a paused one's failure is old news).
function autoFailed(a) {
  return a.last && a.last.ok === false && a.state !== "paused" && !a.parent;
}

// The clock that opens them, with its dot.
function automationsButton(cls) {
  const b = h("button", { class: `${cls || "icon-btn"} auto-btn${autoState.failed ? " alert" : ""}`, type: "button",
                          "aria-label": "Automations", title: "Automations: what runs by itself",
                          onclick: () => automationsSheet() }, glyph("clock"), h("span", { class: "auto-dot", "aria-hidden": "true" }));
  return b;
}

function autoDots() {
  document.querySelectorAll(".auto-btn").forEach((b) => {
    b.classList.toggle("alert", autoState.failed > 0);
    b.title = autoState.failed ? `Automations: ${autoState.failed} failed last time` : "Automations: what runs by itself";
  });
}

setTimeout(() => automationsGet().catch(() => {}), 4000);
setInterval(() => { if (document.visibilityState === "visible") automationsGet().catch(() => {}); }, AUTO_POLL);

// ---- times, as said

function autoClock(d) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function autoDay(d) {
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((day - today) / 86400000);
}

// A time to come: in 4 min, at 20:30, tomorrow 7:30, Mon 18:00, 30 Oct 16:00.
function autoNext(t) {
  if (!t) return null;
  const s = t - Date.now() / 1000;
  if (s < 60) return "in a moment";
  if (s < 3600) return `in ${Math.round(s / 60)} min`;
  const d = new Date(t * 1000), n = autoDay(d);
  if (n === 0) return `at ${autoClock(d)}`;
  if (n === 1) return `tomorrow ${autoClock(d)}`;
  if (n < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${autoClock(d)}`;
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${autoClock(d)}`;
}

// A time gone by: 3 min ago, today 7:30, yesterday 18:00, Fri 18:00.
function autoPast(t) {
  if (!t) return null;
  const s = Date.now() / 1000 - t;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  const d = new Date(t * 1000), n = autoDay(d);
  if (n === 0) return `today ${autoClock(d)}`;
  if (n === -1) return `yesterday ${autoClock(d)}`;
  if (n > -7) return `${d.toLocaleDateString([], { weekday: "short" })} ${autoClock(d)}`;
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${autoClock(d)}`;
}

function autoTook(s) {
  if (s === null || s === undefined) return "";
  if (s < 1) return "under a second";
  if (s < 90) return `${Math.round(s)} s`;
  return `${Math.round(s / 60)} min`;
}

// How it is, in one word for its dot: running, paused, failed, ok, never.
function autoMark(a) {
  if (a.state === "running") return "running";
  if (a.state === "paused") return "paused";
  if (a.state === "stopped") return "stopped";
  if (!a.last || !a.last.at) return "never";
  return a.last.ok === false ? "failed" : "ok";
}

const AUTO_MARK_WORDS = { running: "Running now", paused: "Paused", stopped: "Stopped", never: "Hasn't run yet",
                          failed: "Last run failed", ok: "Last run went fine" };

// The last run, in words: "20:15, ok, 36 s" / "failed: exited with 3".
function autoLastWords(a, long) {
  const l = a.last || {};
  if (a.state === "running") return "running now";
  if (!l.at) return "hasn't run yet";
  const when = autoPast(l.at);
  if (l.ok === false) return `${when}, failed${l.why ? `: ${l.why}` : ""}`;
  if (l.ok === null || l.ok === undefined) return when;
  return long && l.took_s !== null && l.took_s !== undefined ? `${when}, ok, took ${autoTook(l.took_s)}` : `${when}, ok`;
}

// ---- the list

// The groups: your projects by name, then this computer's, then amarchy's own.
function autoGroups(list) {
  const top = list.filter((a) => !a.parent);
  const owners = [...new Set(top.map((a) => a.owner))].sort((x, y) => {
    const rank = (o) => (o === "Amarchy" ? 2 : o === "This computer" ? 1 : 0);
    return rank(x) - rank(y) || x.localeCompare(y);
  });
  return owners.map((o) => [o, top.filter((a) => a.owner === o).sort((x, y) => x.name.localeCompare(y.name))]);
}

function autoRow(a, byId) {
  const mark = autoMark(a);
  const next = a.state === "paused" ? "paused" : a.state === "stopped" ? "stopped" : a.next ? `next ${autoNext(a.next)}` : null;
  const meta = [a.when, next, a.state === "running" ? "running now" : `last ${autoLastWords(a)}`].filter(Boolean).join(" · ");
  const kids = (a.children || []).map((id) => byId[id]).filter(Boolean);
  const soon = kids.find((c) => c.next);
  return h("button", { class: `auto-row ${mark}`, type: "button", "data-id": a.id, onclick: () => automationSheet(a.id) },
    h("span", { class: `auto-mark ${mark}`, title: AUTO_MARK_WORDS[mark], "aria-label": AUTO_MARK_WORDS[mark] }),
    h("span", { class: "text" },
      h("b", {}, a.name),
      a.about ? h("span", { class: "about" }, a.about) : null,
      h("small", { class: mark === "failed" ? "bad" : "" }, meta),
      kids.length ? h("small", { class: "kids" }, `${kids.length} armed${soon ? ` · next ${autoNext(soon.next)}: ${soon.name}` : ""}`) : null),
    glyph("next", "go"));
}

async function automationsSheet() {
  const body = h("div", { class: "auto-body" }, autoState.list ? null : h("p", {}, "…"));
  const back = sheet({ key: "automations" }, sheetHead("Automations", "What runs for you by itself, on your host"), body);
  const draw = () => {
    const list = autoState.list;
    if (!list) return;
    const byId = Object.fromEntries(list.map((a) => [a.id, a]));
    const kids = [];
    if (!list.length) kids.push(h("p", {}, "Nothing runs by itself here yet. A project's scheduled jobs (systemd user timers) show up here once they're set up."));
    if (autoState.failed) kids.push(h("p", { class: "auto-alert" }, `${autoState.failed === 1 ? "One" : autoState.failed} failed the last time it ran: tap it for its log.`));
    for (const [owner, rows] of autoGroups(list)) {
      kids.push(h("div", { class: "section" }, owner), h("div", { class: "auto-list" }, ...rows.map((a) => autoRow(a, byId))));
    }
    kids.push(h("p", { class: "hint" }, "A job explains itself with X-Amarchy-Name= and X-Amarchy-About= lines in its timer (docs/guide.md, Automations)."));
    keepFocus(body.parentNode || body, () => body.replaceChildren(...kids));
  };
  back.redraw = () => automationsGet().then(() => draw(), () => {});
  draw();
  try { await automationsGet(); draw(); } catch (e) { if (!autoState.list) body.replaceChildren(h("p", {}, e.message)); }
  // The times stay true while it's open ("in 4 min").
  const tick = setInterval(() => {
    if (!back.isConnected) return clearInterval(tick);
    if (!back.hidden && document.visibilityState === "visible") automationsGet().then(() => { if (!back.hidden) draw(); }, () => {});
  }, 30000);
}

// ---- one of them

async function automationSheet(id) {
  const find = () => (autoState.list || []).find((a) => a.id === id);
  let a = find();
  if (!a) return toast("That automation is gone");
  const body = h("div", { class: "auto-one" });
  const head = sheetHead(a.name, a.owner === "This computer" ? "This computer's" : a.owner);
  const back = sheet({ key: "automation" }, head, body);
  const log = h("div", { class: "auto-log", role: "log", "aria-label": "Its recent log" }, h("p", { class: "hint" }, "…"));
  let logLines = null, watching = null;

  const loadLog = async () => {
    try {
      const r = await fetch(`/api/automations/log?id=${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Can't read its log");
      logLines = d.log || [];
    } catch (e) {
      logLines = null;
      log.replaceChildren(h("p", { class: "hint" }, e instanceof TypeError ? "Can't reach Amarchy" : e.message));
      return;
    }
    drawLog();
  };
  const drawLog = () => {
    if (!logLines) return;
    if (!logLines.length) {
      log.replaceChildren(h("p", { class: "hint" }, "Nothing in its log yet."));
      return;
    }
    const end = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    let day = null;
    const rows = [];
    for (const l of logLines) {
      const d = new Date(l.at * 1000);
      const ds = d.toDateString();
      if (ds !== day) {
        day = ds;
        rows.push(h("div", { class: "auto-log-day" }, autoDay(d) === 0 ? "Today" : autoDay(d) === -1 ? "Yesterday"
          : d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })));
      }
      rows.push(h("div", { class: `auto-log-line${l.error ? " error" : ""}${l.from === "systemd" ? " sys" : ""}` },
        h("span", { class: "t" }, d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })),
        h("span", { class: "m" }, l.text)));
    }
    log.replaceChildren(...rows);
    if (end || !log.dataset.seen) {
      log.scrollTop = log.scrollHeight;
      log.dataset.seen = "1";
    }
  };

  // Started here: looked at every couple of seconds until it's done.
  const watch = (since) => {
    clearInterval(watching);
    const until = Date.now() + AUTO_LIVE_MAX;
    watching = setInterval(async () => {
      if (!back.isConnected || Date.now() > until) return clearInterval(watching);
      try { await automationsGet(); } catch (e) { return; }
      a = find() || a;
      draw();
      loadLog();
      if (a.state !== "running" && a.last && a.last.at && a.last.at >= since - 2) {
        clearInterval(watching);
        if (a.last.ok === false) toast(`${a.name} failed: ${a.last.why || "see its log"}`);
        else if (a.last.ok) toast(`${a.name} ran fine`);
      }
    }, AUTO_LIVE);
  };

  const act = async (action, btn) => {
    if (btn) btn.disabled = true;
    const since = Date.now() / 1000;
    try {
      const d = await api("/api/automations", { id, action });
      if (d.automation) {
        const i = autoState.list.findIndex((x) => x.id === id);
        if (i >= 0) autoState.list[i] = d.automation;
        autoState.failed = autoState.list.filter(autoFailed).length;
        autoDots();
        a = d.automation;
      }
      toast(action === "run" ? `${a.name} started` : action === "pause" ? `${a.name} paused` : `${a.name} resumed: back on its schedule`);
      if (action === "run") watch(since);
    } catch (e) {
      toast(e.message);
    }
    if (btn) btn.disabled = false;
    draw();
    if (action === "run") setTimeout(loadLog, 800);
  };

  const confirmPause = () => {
    const kids = (a.children || []).length;
    const yes = h("button", { class: "control wide danger", onclick: async () => {
      yes.disabled = true;
      closeSheet();
      await act("pause");
    } }, "Pause it");
    sheet({ key: "automation-pause" }, sheetHead(`Pause ${a.name}?`, "Until you resume it"),
      h("p", {}, `It won't run on its schedule (${a.when.toLowerCase()}) until you tap Resume, not even after the host restarts. Nothing is deleted, and Run now still works.`),
      kids ? h("p", {}, `What it armed already (${kids}) still goes off; it just won't arm any more.`) : null,
      a.owner === "Amarchy" ? h("p", { class: "auto-alert" }, "This one is amarchy's own: amarchy works without it, but does less by itself until you resume it.") : null,
      yes, h("button", { class: "control wide", onclick: closeSheet }, "Cancel"));
  };

  const fact = (k, ...v) => h("div", { class: "auto-fact" }, h("dt", {}, k), h("dd", {}, ...v));
  const draw = () => {
    a = find() || a;
    head.querySelector("h2").textContent = a.name;
    const mark = autoMark(a);
    const byId = Object.fromEntries((autoState.list || []).map((x) => [x.id, x]));
    const kids = (a.children || []).map((c) => byId[c]).filter(Boolean);
    const runs = (a.runs || []).slice(0, 10);
    const run = h("button", { class: "control accent", type: "button", disabled: a.state === "running",
                              onclick: (e) => act("run", e.currentTarget) }, a.state === "running" ? "Running…" : "Run now");
    const pause = a.can_pause
      ? (a.state === "paused"
        ? h("button", { class: "control", type: "button", onclick: (e) => act("resume", e.currentTarget) }, "Resume")
        : h("button", { class: "control", type: "button", onclick: confirmPause }, "Pause…"))
      : null;
    const parts = [
      h("div", { class: `auto-state ${mark}` }, h("span", { class: `auto-mark ${mark}` }), AUTO_MARK_WORDS[mark],
        mark === "failed" && a.last.why ? `: ${a.last.why}` : ""),
      a.about ? h("p", { class: "auto-about" }, a.about) : a.description ? h("p", { class: "auto-about" }, a.description) : null,
      h("dl", { class: "auto-facts" },
        fact("When", a.when),
        fact("Next", a.state === "paused" ? "Paused: not until you resume it" : a.state === "stopped" ? "Stopped: nothing starts it now"
          : a.next ? `${autoNext(a.next)}${autoDay(new Date(a.next * 1000)) === 0 && a.next - Date.now() / 1000 < 3600 ? ` (${autoClock(new Date(a.next * 1000))})` : ""}` : "Not scheduled"),
        fact("Last", autoLastWords(a, true)),
        runs.length > 1 ? fact("Recent runs", h("span", { class: "auto-runs" }, ...runs.slice().reverse().map((r) =>
          h("span", { class: `auto-run ${r.ok ? "ok" : "failed"}`, title: `${autoPast(r.at)}: ${r.ok ? "ok" : "failed"}` }))),
          ` ${runs.filter((r) => !r.ok).length ? `${runs.filter((r) => !r.ok).length} of the last ${runs.length} failed` : `the last ${runs.length} went fine`}`) : null,
        fact("Unit", h("code", {}, a.service), a.parent ? "" : h("span", { class: "hint" }, ` (timer ${a.id})`))),
      h("div", { class: "auto-actions" }, a.parent ? null : run, pause),
      a.transient && !a.parent ? h("p", { class: "hint" }, "A one-off: it runs once, at its time.") : null,
      a.parent ? h("p", { class: "hint" }, `Armed by ${(byId[a.parent] || {}).name || a.parent}: it runs once, at its time.`) : null,
    ];
    if (kids.length) {
      parts.push(h("div", { class: "section" }, `Armed by it (${kids.length})`),
        h("div", { class: "auto-kids" }, ...kids.map((c) => h("div", { class: "auto-kid" },
          h("span", { class: "t" }, c.next ? autoNext(c.next) : c.state === "running" ? "now" : "done"),
          h("span", { class: "m" }, c.name)))));
    }
    parts.push(h("div", { class: "section auto-log-head" }, "Recent log",
      h("button", { class: "text-btn", type: "button", onclick: () => loadLog() }, "Refresh")), log);
    keepFocus(back.querySelector(".sheet") || body, () => body.replaceChildren(...parts.filter(Boolean)));
  };
  back.redraw = () => { draw(); loadLog(); };
  draw();
  loadLog();
  if (a.state === "running") watch(a.last && a.last.at ? a.last.at : Date.now() / 1000);
  automationsGet().then(() => { if (back.isConnected) draw(); }, () => {});
}

// Settings → Automations: what it is, and the way in.
function automationsSettings() {
  return [h("div", { class: "section" }, "Automations"),
    h("p", {}, "The jobs that run by themselves on your host (your projects' scheduled jobs, amarchy's own): what each one does, when it runs and how it went, with Run now and Pause."),
    h("button", { class: "control wide", onclick: () => automationsSheet() }, "Automations…")];
}
