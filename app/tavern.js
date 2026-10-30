// ---- the Tavern: your chats as pirates, each project a crew
//
// The board's third tab (Chats | Tasks | Tavern), on the phone as on a
// computer: the same chats as Chats, drawn as a pirates' tavern. Your
// assistant keeps the bar. Each project is a crew at its own long table,
// under its flag (the Jolly Roger in the project's color, its name on it).
// Each chat is a pirate on their own stool (uiPirate in ui.js), and how
// they sit says where it stands: plotting on a map while it works, a swig
// while the hourglass runs, up with a hand raised when it asks you, the
// grog raised over a chest of gold when it's done, head on the table
// asleep. A click (Enter) on one opens their chat; held down (a right
// click), its menu; x completes a done one, as on the Chats tab. The free
// stool at the end of each table recruits: a new chat in that project.
//
// Everyone keeps their stool (tavernSeats, kept in this browser): one who
// leaves frees theirs, the next to come takes it. The portholes show the sea
// under the sky as it is outside now.

const TAVERN_SEATS = "tavern-seats";
const TAVERN_HOLES = 2;             // free stools a table keeps between pirates before it closes up
const TAVERN_CHEER = 2500;          // ms a chat that just got done cheers
const tavern = {
  poses: new Map(),   // a chat's pose when last drawn: id -> pose (one just done cheers)
  cheer: new Map(),   // a chat that just got done: id -> until when its gold flies
};

// Each table's stools in order, the same from one time to the next: repo ->
// [chat id, or null for a free stool]. New chats take the first free one.
function tavernSeats(crews) {
  let kept = {};
  try { kept = JSON.parse(store.get(TAVERN_SEATS) || store.get("office-seats") || "{}") || {}; } catch (e) { kept = {}; }
  const out = {};
  for (const [repo, ids] of crews) {
    const here = new Set(ids);
    let seats = (kept[repo] || []).map((id) => (here.has(id) ? id : null));
    const seated = new Set(seats.filter(Boolean));
    for (const id of ids) {
      if (seated.has(id)) continue;
      const free = seats.indexOf(null);
      if (free >= 0) seats[free] = id; else seats.push(id);
    }
    while (seats.length && seats[seats.length - 1] === null) seats.pop();
    if (seats.filter((x) => x === null).length > TAVERN_HOLES) seats = seats.filter(Boolean);
    out[repo] = seats;
  }
  const json = JSON.stringify(out);
  if (json !== store.get(TAVERN_SEATS)) store.set(TAVERN_SEATS, json);
  if (store.get("office-seats")) store.set("office-seats", "");      // (what the Office kept, before the Tavern)
  return out;
}

// Where a chat stands, as a pose: what Today's parts say of it (today.js).
function tavernPose(s, p) {
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

const TAVERN_MARKS = { ask: "?", blocked: "!", fresh: "★", done: "✓", run: "⧗", sleep: "z z", stale: "…", arrive: "…" };

// What they say, in their bubble.
function tavernSay(s, pose) {
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
// moment. Before the tavern is drawn (tavernKey), so what it shows says so.
function tavernTrack() {
  const v = app.view;
  if (!v) return;
  const p = todayParts(v), now = Date.now();
  for (const s of v.sessions || []) {
    const pose = tavernPose(s, p), was = tavern.poses.get(s.id);
    if (was && was !== pose && pose === "done") tavern.cheer.set(s.id, now + TAVERN_CHEER);
    tavern.poses.set(s.id, pose);
  }
  for (const id of tavern.poses.keys()) if (!(v.sessions || []).some((s) => s.id === id)) { tavern.poses.delete(id); tavern.cheer.delete(id); }
  for (const [id, t] of tavern.cheer) if (t <= now) tavern.cheer.delete(id);
}

function tavernPirate(s, p, barkeep = false) {
  const pose = tavernPose(s, p);
  const cheer = tavern.cheer.has(s.id);
  const actions = [];
  if (pose === "ask" && s.permission) actions.push(uiButton("Allow", () => todayPermit(s, "allow"), false, "today-opt"), uiButton("Deny", () => todayPermit(s, "deny"), false, "today-opt"));
  if (pose === "done" && !barkeep) actions.push(uiButton("Complete", () => todayComplete(s), false, "complete"));
  const title = barkeep ? s.assistant_name || "Assistant" : s.task || "New chat";
  const n = uiPirate({ id: s.id, hue: todayHue(s.repo), look: uiLook(s.id), pose, mark: TAVERN_MARKS[pose] || "", say: tavernSay(s, pose),
                       title, pill: todayStatePill(s), lead: barkeep ? avatar(s, "small") : null, barkeep, cheer, actions,
                       open: () => todayOpen(s), label: `${title}: ${statusWords(s) || pose}` });
  n.todayData = JSON.stringify([todayRowKey(s), pose, cheer]);
  return n;
}

// The sky outside, now: day, dusk, dawn or night.
function tavernSky() {
  const hr = new Date().getHours();
  return hr >= 7 && hr < 17 ? "day" : hr >= 17 && hr < 20 ? "dusk" : hr >= 5 && hr < 7 ? "dawn" : "night";
}

// A porthole: the sea under the sky as it is now (a moon and stars at night).
function tavernPorthole(sky) {
  return h("span", { class: `tv-porthole ${sky}`, "aria-hidden": "true" }, h("i", { class: "tv-sun" }), h("i", { class: "tv-wave" }), h("i", { class: "tv-wave two" }));
}

function tavernLantern() {
  return h("span", { class: "tv-lantern", "aria-hidden": "true" }, h("i", {}));
}

// A crew: its wall (its flag, portholes, a lantern), its table, its pirates
// on their stools, a free one at the end.
function tavernCrew(repo, pirates, hue, sky) {
  const free = uiPirate({ hue, look: uiLook(repo), pose: "empty", mark: "+", title: h("div", { class: "task muted" }, "Recruit"),
                          open: () => newChatIn(repo), label: `New chat in ${projectName(repo)}` });
  free.todayData = `free|${repo}`;
  const count = pirates.filter(Boolean).length;
  return h("section", { class: `tv-crew ph-${hue}`, "data-crew": repo, style: `--seats:${pirates.length + 1}` },
    h("div", { class: "tv-wall" }, uiFlag(projectName(repo), hue, { count }),
      h("span", { class: "tv-portholes" }, tavernPorthole(sky), tavernPorthole(sky)), tavernLantern()),
    h("div", { class: "tv-table" }, ...pirates.map((d) => d || uiPirate({ vacant: true, hue, look: uiLook(""), pose: "empty" })), free));
}

// The bar: your assistant behind it, the bottles on the shelf.
function tavernBar(main, p, sky) {
  const bottles = h("span", { class: "tv-shelf", "aria-hidden": "true" }, ...Array.from({ length: 9 }, (_, i) => h("i", { class: `b${i % 5}` })));
  return h("section", { class: `tv-crew tv-bar ph-${todayHue(main.repo)}`, "data-crew": "", style: "--seats:1" },
    h("div", { class: "tv-wall" }, h("span", { class: "tv-sign" }, "The Bar"), bottles, tavernLantern()),
    h("div", { class: "tv-table" }, tavernPirate(main, p, true)));
}

// The tavern, for the board's box (today.js todayFill, its Tavern tab).
function tavernNodes() {
  const v = app.view;
  if (!v) return [h("div", { class: "empty" }, app.failed || "Connecting…")];
  const p = todayParts(v);
  const all = (v.sessions || []).filter((s) => !todayUI.closing.has(s.id));
  const main = all.find((s) => s.assistant === "main") || null;
  const rest = all.filter((s) => s !== main);
  // The crews: your projects' order, then any other.
  const order = (v.projects || []).map((x) => x.name);
  for (const s of rest) if (!order.includes(s.repo)) order.push(s.repo);
  const crews = order.map((repo) => [repo, rest.filter((s) => s.repo === repo).map((s) => s.id)]).filter(([, ids]) => ids.length);
  const seats = tavernSeats(crews);
  const byId = new Map(rest.map((s) => [s.id, s]));
  const sky = tavernSky();
  const nodes = [h("div", { class: "today-summary" }, h("span", { class: "today-summary-text" }, todaySummary(v, "chats")), missionScore())];
  const hall = [];
  if (main) hall.push(tavernBar(main, p, sky));
  for (const [repo] of crews) hall.push(tavernCrew(repo, seats[repo].map((id) => (id ? tavernPirate(byId.get(id), p) : null)), todayHue(repo), sky));
  if (!hall.length) hall.push(h("p", { class: "today-clear" }, "The tavern's empty: start a chat and a pirate takes a stool."));
  nodes.push(h("div", { class: `tavern-hall ${sky}` }, ...hall));
  return nodes;
}

// What the tavern shows besides the chats: the sky's part of the day, who cheers.
function tavernKey() {
  tavernTrack();
  return `${tavernSky()}|${[...tavern.cheer.keys()].join()}`;
}

// A cheer ended, the sky turned: drawn again, while it shows.
setInterval(() => {
  if (typeof board === "undefined" || board.tab !== "tavern" || !board.box || !board.box.dataset.key) return;
  const now = Date.now();
  if ([...tavern.cheer.values()].some((t) => t <= now) || !board.box.dataset.key.startsWith(`tavern|tavern:${tavernSky()}|`)) todayFill(board.box);
}, 1000);
