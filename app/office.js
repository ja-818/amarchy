// ---- the Office: your chats as people at their desks
//
// The board's third tab (Chats | Tasks | Office), on the phone as on a
// computer: the same chats as Chats, drawn as an office. Each project is a
// room in its color (its people wear it), your assistant at the front desk.
// Each chat sits at its own desk (uiDesk in ui.js), and how it sits says
// where it stands: typing while it works, up and waving when it asks you,
// arms up when it's done, its head on the desk asleep. A click (Enter) on
// someone opens their chat; held down (a right click), its menu; x
// completes a done one, as on the Chats tab. A free desk at the end of each
// room starts a new chat there.
//
// Everyone keeps their desk (officeSeats, kept in this browser): one who
// leaves frees theirs, the next to come takes it. The windows show the sky
// as it is outside now; the clock on the wall, the time.

const OFFICE_SEATS = "office-seats";
const OFFICE_HOLES = 2;
const OFFICE_CHEER = 2500;          // ms a chat that just got done cheers             // free desks a room keeps between people before it closes up
const office = {
  poses: new Map(),   // a chat's pose when last drawn: id -> pose (one just done cheers)
  cheer: new Map(),   // a chat that just got done: id -> until when its confetti shows
};

// Each room's desks in order, the same from one time to the next: repo ->
// [chat id, or null for a free desk]. New chats take the first free one.
function officeSeats(rooms) {
  let kept = {};
  try { kept = JSON.parse(store.get(OFFICE_SEATS) || "{}") || {}; } catch (e) { kept = {}; }
  const out = {};
  for (const [repo, ids] of rooms) {
    const here = new Set(ids);
    let seats = (kept[repo] || []).map((id) => (here.has(id) ? id : null));
    const seated = new Set(seats.filter(Boolean));
    for (const id of ids) {
      if (seated.has(id)) continue;
      const free = seats.indexOf(null);
      if (free >= 0) seats[free] = id; else seats.push(id);
    }
    while (seats.length && seats[seats.length - 1] === null) seats.pop();
    if (seats.filter((x) => x === null).length > OFFICE_HOLES) seats = seats.filter(Boolean);
    out[repo] = seats;
  }
  const json = JSON.stringify(out);
  if (json !== store.get(OFFICE_SEATS)) store.set(OFFICE_SEATS, json);
  return out;
}

// Where a chat stands, as a pose: what Today's parts say of it (today.js).
function officePose(s, p) {
  if (s.setup) return "arrive";
  if (p.asks.includes(s)) return "ask";
  if (p.blocked.includes(s)) return "blocked";
  if (s.status === "working") return "work";
  if (s.status === "running") return "run";
  if (p.fresh.includes(s)) return "fresh";
  if (p.done.includes(s)) return "done";
  if (sleepOf(s)) return "sleep";
  if (p.stale.includes(s)) return "stale";
  return "idle";
}

const OFFICE_MARKS = { ask: "?", blocked: "!", fresh: "★", done: "✓", run: "⚙", sleep: "z z", stale: "…", arrive: "…" };

// What it says, in its bubble.
function officeSay(s, pose) {
  const t = s.today || {};
  const q = ((t.asks || [])[0] || {}).question;
  if (pose === "ask") return (s.secret_asks || []).length ? "Asks you for a secret" : s.asks || q || "Needs your answer";
  if (pose === "run") return s.running ? `Running · ${s.running}` : "Running";
  if (pose === "done") return t.goal ? `Done: ${t.goal}` : "Done";
  if (pose === "sleep") return "Asleep";
  if (pose === "arrive") return "Setting up…";
  return s.said || t.goal || "";
}

// Who just got done (seen otherwise last time, done now): they cheer a
// moment. Before the office is drawn (officeKey), so what it shows says so.
function officeTrack() {
  const v = app.view;
  if (!v) return;
  const p = todayParts(v), now = Date.now();
  for (const s of v.sessions || []) {
    const pose = officePose(s, p), was = office.poses.get(s.id);
    if (was && was !== pose && pose === "done") office.cheer.set(s.id, now + OFFICE_CHEER);
    office.poses.set(s.id, pose);
  }
  for (const id of office.poses.keys()) if (!(v.sessions || []).some((s) => s.id === id)) { office.poses.delete(id); office.cheer.delete(id); }
  for (const [id, t] of office.cheer) if (t <= now) office.cheer.delete(id);
}

function officeDesk(s, p, main = false) {
  const pose = officePose(s, p);
  const cheer = office.cheer.has(s.id);
  const actions = [];
  if (pose === "ask" && s.permission) actions.push(uiButton("Allow", () => todayPermit(s, "allow"), false, "today-opt"), uiButton("Deny", () => todayPermit(s, "deny"), false, "today-opt"));
  if (pose === "done" && !main) actions.push(uiButton("Complete", () => todayComplete(s), false, "complete"));
  const title = main ? s.assistant_name || "Assistant" : s.task || "New chat";
  const n = uiDesk({ id: s.id, hue: todayHue(s.repo), look: uiLook(s.id), pose, mark: OFFICE_MARKS[pose] || "", say: officeSay(s, pose),
                     title, pill: todayStatePill(s), lead: main ? avatar(s, "small") : null, headset: main, cheer, actions,
                     open: () => todayOpen(s), label: `${title}: ${statusWords(s) || pose}` });
  n.todayData = JSON.stringify([todayRowKey(s), pose, cheer]);
  return n;
}

// A room's wall: its name on a sign, windows on the sky as it is now, the clock.
function officeWall(repo, n, hue) {
  const now = new Date(), hr = now.getHours();
  const sky = hr >= 7 && hr < 17 ? "day" : hr >= 17 && hr < 20 ? "dusk" : hr >= 5 && hr < 7 ? "dawn" : "night";
  const win = () => h("span", { class: `oroom-window ${sky}`, "aria-hidden": "true" }, h("i", {}), h("i", {}), h("i", {}));
  const clock = `${String(hr).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return h("div", { class: `oroom-wall ph-${hue}` },
    h("span", { class: "oroom-sign" }, repo === null ? "Front desk" : projectName(repo), h("span", { class: "oroom-count" }, String(n))),
    h("span", { class: "oroom-windows" }, win(), win(), win()),
    h("span", { class: "oroom-clock", "aria-hidden": "true" }, clock));
}

function officeRoom(repo, people, hue, { add = true } = {}) {
  const free = add && repo ? uiDesk({ hue, look: uiLook(repo), pose: "empty", mark: "+", title: h("div", { class: "task muted" }, "New chat"),
                                      open: () => newChatIn(repo), label: `New chat in ${projectName(repo)}` }) : null;
  if (free) free.todayData = `free|${repo}`;
  const count = people.filter(Boolean).length;
  const room = h("section", { class: `oroom ph-${hue}`, "data-room": repo || "", style: `--seats:${people.length + (free ? 1 : 0)}` },
    officeWall(repo, count, hue),
    h("div", { class: "oroom-floor" }, ...people.map((d) => d || uiDesk({ vacant: true, hue, look: uiLook(""), pose: "empty" })), free));
  return room;
}

// The office, for the board's box (today.js todayFill, its Office tab).
function officeNodes() {
  const v = app.view;
  if (!v) return [h("div", { class: "empty" }, app.failed || "Connecting…")];
  const p = todayParts(v);
  const all = (v.sessions || []).filter((s) => !todayUI.closing.has(s.id));
  const main = all.find((s) => s.assistant === "main") || null;
  const rest = all.filter((s) => s !== main);
  // The rooms: your projects' order, then any other.
  const order = (v.projects || []).map((x) => x.name);
  for (const s of rest) if (!order.includes(s.repo)) order.push(s.repo);
  const rooms = order.map((repo) => [repo, rest.filter((s) => s.repo === repo).map((s) => s.id)]).filter(([, ids]) => ids.length);
  const seats = officeSeats(rooms);
  const byId = new Map(rest.map((s) => [s.id, s]));
  const nodes = [h("div", { class: "today-summary" }, h("span", { class: "today-summary-text" }, todaySummary(v, "chats")), missionScore())];
  const floor = [];
  if (main) floor.push(officeRoom(null, [officeDesk(main, p, true)], todayHue(main.repo), { add: false }));
  for (const [repo] of rooms) floor.push(officeRoom(repo, seats[repo].map((id) => (id ? officeDesk(byId.get(id), p) : null)), todayHue(repo)));
  if (!floor.length) floor.push(h("p", { class: "today-clear" }, "Nobody's in yet: start a chat and they'll take a desk."));
  nodes.push(h("div", { class: "office-floor" }, ...floor));
  return nodes;
}

// What the office shows besides the chats: the minute (the clock, the
// sky), who cheers.
function officeKey() {
  officeTrack();
  return `${Math.floor(Date.now() / 60000)}|${[...office.cheer.keys()].join()}`;
}

// The minute turned, a cheer ended: drawn again, while it shows.
setInterval(() => {
  if (typeof board === "undefined" || board.tab !== "office" || !board.box || !board.box.dataset.key) return;
  const now = Date.now();
  if ([...office.cheer.values()].some((t) => t <= now) || !board.box.dataset.key.startsWith(`office|office:${Math.floor(now / 60000)}|`)) todayFill(board.box);
}, 1000);
