// ---- the Tavern: your chats as pirates, each project a crew
//
// The board's third tab (Chats | Tasks | Tavern), on the phone as on a
// computer: the same chats as Chats, drawn as a pirates' tavern. Your
// assistant's crew comes first. Each project is a crew at its own long table,
// under its flag (the Jolly Roger in the project's color, its name on it).
// Each chat is one of the crew (uiPirate in ui.js), and how
// they sit says where it stands: plotting on a map while it works, a swig
// while the hourglass runs, up with a hand raised when it asks you, the
// grog raised over a chest of gold when it's done, head on the table
// asleep. A click (Enter) on one opens their chat; held down (a right
// click), its menu; x completes a done one, as on the Chats tab. The empty
// chair at the end of each table recruits: a new chat in that project.
//
// Everyone keeps their place at the table (tavernSeats, kept in this
// browser): one who leaves frees theirs, the next to come takes it.

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

// A mark over their head where it's your move (the drawing says the rest).
const TAVERN_MARKS = { ask: "?", blocked: "!", fresh: "★", done: "✓" };

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

// Who each one at a table is: their own pirate (uiLook), or, when someone at
// the table already is that one, the next pirate free. Ten at a table before
// one comes twice.
function tavernKinds(ids) {
  const used = new Set(), out = new Map();
  for (const id of ids) {
    if (!id) continue;
    let k = uiLook(id).kind;
    for (let i = 0; i < UI_CREW.length && used.has(k); i++) k = (k + 1) % UI_CREW.length;
    if (used.size >= UI_CREW.length) used.clear();
    used.add(k);
    out.set(id, k);
  }
  return out;
}

function tavernPirate(s, p, barkeep = false, kind = uiLook(s.id).kind) {
  const pose = tavernPose(s, p);
  const cheer = tavern.cheer.has(s.id);
  const actions = [];
  if (pose === "ask" && s.permission) actions.push(uiButton("Allow", () => todayPermit(s, "allow"), false, "today-opt"), uiButton("Deny", () => todayPermit(s, "deny"), false, "today-opt"));
  if (pose === "done" && !barkeep) actions.push(uiButton("Complete", () => todayComplete(s), false, "complete"));
  const title = barkeep ? s.assistant_name || "Assistant" : s.task || "New chat";
  const n = uiPirate({ id: s.id, hue: todayHue(s.repo), look: { kind }, pose, mark: TAVERN_MARKS[pose] || "", say: tavernSay(s, pose),
                       title, pill: todayStatePill(s), lead: barkeep ? avatar(s, "small") : null, cheer, actions,
                       open: () => todayOpen(s), label: `${title}: ${statusWords(s) || pose}` });
  n.todayData = JSON.stringify([todayRowKey(s), pose, cheer, kind]);
  return n;
}

// ---- the hall, drawn as the crew are: a noir comic's ink
//
// Behind each crew, its wall: a beam overhead, posts, a shelf of bottles
// and barrels in silhouette, lanterns hanging (their light the warm one in
// the room). The same
// wall for a crew every time (its bottles by its name). 1600 wide, shown
// from its left as far as the crew is wide.
function tavernBack(name) {
  let n = 0;
  for (const c of String(name)) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => { n = (Math.imul(n, 1103515245) + 12345) >>> 0; return n / 4294967296; };
  const out = [`<defs><linearGradient id="tvw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140c08"/><stop offset="1" stop-color="#0b0706"/></linearGradient>`
    + `<radialGradient id="tvl" r=".5"><stop offset="0" stop-color="#ffb347" stop-opacity=".55"/><stop offset=".45" stop-color="#c0602a" stop-opacity=".18"/><stop offset="1" stop-color="#c0602a" stop-opacity="0"/></radialGradient></defs>`,
    `<rect width="1600" height="110" fill="url(#tvw)"/>`];
  // Lantern light on the wall, first: everything else stands in it.
  const lamps = [230, 820, 1410];
  for (const x of lamps) out.push(`<ellipse cx="${x}" cy="46" rx="190" ry="90" fill="url(#tvl)"/>`);
  // The beam and posts.
  out.push(`<rect width="1600" height="12" fill="#1e130d"/><rect y="12" width="1600" height="2" fill="#4a2a16"/>`);
  for (let x = 400; x < 1600; x += 400) out.push(`<rect x="${x}" y="14" width="14" height="96" fill="#160e0a"/><rect x="${x + 11}" y="14" width="3" height="96" fill="#3a2214"/>`);
  // The shelves: bottles (glass catching the light), barrels.
  const shelves = [80];
  const glass = ["#3a5a2a", "#6a2a1a", "#8a5a1a", "#2a3a4a", "#4a2a3a"];
  for (const y of shelves) {
    out.push(`<rect y="${y}" width="1600" height="6" fill="#2a1810"/><rect y="${y}" width="1600" height="1.5" fill="#6a3c1c"/>`);
    for (let x = 18; x < 1600;) {
      if (rnd() < 0.12) {      // a barrel
        out.push(`<path d="M${x} ${y} Q${x - 4} ${y - 17} ${x} ${y - 34} L${x + 34} ${y - 34} Q${x + 38} ${y - 17} ${x + 34} ${y} Z" fill="#24150d"/>`
          + `<path d="M${x - 1} ${y - 9} L${x + 35} ${y - 9} M${x - 1} ${y - 25} L${x + 35} ${y - 25}" stroke="#5a3a1c" stroke-width="2"/><path d="M${x + 26} ${y - 33} Q${x + 30} ${y - 17} ${x + 27} ${y}" stroke="#4a2a16" stroke-width="3" fill="none"/>`);
        x += 50; continue;
      }
      if (rnd() < 0.22) { x += 22 + rnd() * 30; continue; }
      const hgt = 18 + rnd() * 14, w = 7 + rnd() * 4, c = glass[Math.floor(rnd() * glass.length)];
      out.push(`<path d="M${x} ${y} L${x} ${y - hgt * .62} Q${x} ${y - hgt * .78} ${x + w * .35} ${y - hgt * .82} L${x + w * .35} ${y - hgt} L${x + w * .65} ${y - hgt} L${x + w * .65} ${y - hgt * .82} Q${x + w} ${y - hgt * .78} ${x + w} ${y - hgt * .62} L${x + w} ${y} Z" fill="${c}" opacity=".85"/>`
        + `<rect x="${(x + w * .7).toFixed(1)}" y="${(y - hgt * .58).toFixed(1)}" width="1.5" height="${(hgt * .45).toFixed(1)}" fill="#ffd9a0" opacity=".45"/>`);
      x += w + 3 + rnd() * 6;
    }
  }
  // The lanterns.
  for (const x of lamps) out.push(`<g class="tv-lamp"><path d="M${x} 14 L${x} 28" stroke="#0b0706" stroke-width="2"/><path d="M${x - 9} 30 L${x + 9} 30 L${x + 7} 52 L${x - 7} 52 Z" fill="#ffcf7a"/>`
    + `<path d="M${x - 9} 30 L${x + 9} 30 L${x + 7} 52 L${x - 7} 52 Z M${x} 30 L${x} 52" fill="none" stroke="#2a1608" stroke-width="2.4"/><path d="M${x - 11} 28 L${x + 11} 28 L${x + 8} 32 L${x - 8} 32 Z M${x - 8} 52 L${x + 8} 52 L${x + 6} 56 L${x - 6} 56 Z" fill="#2a1608"/></g>`);
  return `<svg class="tv-back" viewBox="0 0 1600 110" preserveAspectRatio="xMinYMin slice" aria-hidden="true">${out.join("")}</svg>`;
}

// A crew's flag: the Jolly Roger, ragged, in the crew's color, in the
// wind; drawn as the rest.
function tavernFlag() {
  return h("span", { class: "tv-flag", "aria-hidden": "true", html: `<svg viewBox="0 0 64 44"><path d="M3 2 L5 2 L5 44 L3 44 Z" fill="#6a4a2a"/><circle cx="4" cy="2" r="2.6" fill="#e0b048"/>`
    + `<g class="tv-cloth"><path d="M5 4 Q22 0 36 5 Q50 10 62 5 L58 13 L63 19 L57 24 L62 31 Q48 36 34 31 Q20 26 5 31 Z" class="pa-crew"/>`
    + `<path d="M5 4 Q22 0 36 5 L34 31 Q20 26 5 31 Z" fill="#0b0706" opacity=".28"/><path d="M36 5 Q50 10 62 5 L58 13 L63 19 L57 24 L62 31 Q48 36 34 31 Z" fill="#0b0706" opacity=".12"/>`
    + `<path d="M27 9 Q33 8 38 10 Q41 14 39 18 L37 21 L29 21 L27 18 Q25 14 27 9 Z" fill="#f1ead8"/><path d="M29 13 L32 13 L32 16 L29 16 Z M34 13 L37 13 L36.5 16 L34 16 Z" fill="#0b0706"/>`
    + `<path d="M22 22 L44 28 M44 22 L22 28" stroke="#f1ead8" stroke-width="2.6" stroke-linecap="round"/></g></svg>` });
}

// The air in the hall: the corners in shadow.
function tavernAir() {
  return h("span", { class: "tv-air", "aria-hidden": "true" }, h("i", { class: "tv-vignette" }));
}

// What a crew is up to, in a few words: who needs you, who's done, who works.
function tavernTally(poses) {
  const n = (...ks) => poses.filter((x) => ks.includes(x)).length;
  const need = n("ask", "blocked"), done = n("done", "fresh"), work = n("work", "run");
  return [need ? uiPill(`${need} need${need === 1 ? "s" : ""} you`, "ask") : null, done ? uiPill(`${done} to see`, "done") : null, work ? uiPill(`${work} at work`, "quiet") : null].filter(Boolean);
}

// The empty chair at the end of a table: Recruit, a new chat in its project.
function tavernRecruit(repo) {
  const chair = uiPirate({ hue: todayHue(repo), look: { kind: 0 }, pose: "empty", title: h("div", { class: "task tv-recruit-word" }, "Recruit"),
                           open: () => newChatIn(repo), label: `Recruit: a new chat in ${projectName(repo)}` });
  chair.classList.add("tv-recruit");
  chair.todayData = `free|${repo}`;
  return chair;
}

// A crew: its wall behind, its flag and name and what it's up to, its
// table, its pirates in a row, and the empty chair that recruits.
function tavernCrew(repo, pirates, hue, poses, name = projectName(repo)) {
  const recruit = tavernRecruit(repo);
  return h("section", { class: `tv-crew ph-${hue}`, "data-crew": repo, style: `--seats:${pirates.length}` },
    h("span", { class: "tv-wall", html: tavernBack(repo) }), tavernAir(),
    h("header", { class: "tv-head" }, tavernFlag(), h("h3", { class: "tv-name" }, name, h("span", { class: "tv-count" }, String(pirates.length))),
      h("span", { class: "tv-tally" }, ...tavernTally(poses))),
    h("div", { class: "tv-table" }, ...pirates, recruit));
}

// Your assistant's crew: a crew as the others, under its name, your
// assistant first and the rest of its project's chats (its missions).
function tavernOwnCrew(main, mates, p) {
  const kinds = tavernKinds([main.id, ...mates.map((s) => s.id)]);
  return tavernCrew(main.repo, [tavernPirate(main, p, true, kinds.get(main.id)), ...mates.map((s) => tavernPirate(s, p, false, kinds.get(s.id)))],
                    todayHue(main.repo), [main, ...mates].map((s) => tavernPose(s, p)), main.assistant_name || projectName(main.repo));
}

// The tavern, for the board's box (today.js todayFill, its Tavern tab):
// your assistant's crew, then the others, as your projects order them.
function tavernNodes() {
  const v = app.view;
  if (!v) return [h("div", { class: "empty" }, app.failed || "Connecting…")];
  const p = todayParts(v);
  const all = (v.sessions || []).filter((s) => !todayUI.closing.has(s.id));
  const main = all.find((s) => s.assistant === "main") || null;
  const rest = all.filter((s) => s !== main);
  const order = (v.projects || []).map((x) => x.name);
  for (const s of rest) if (!order.includes(s.repo)) order.push(s.repo);
  const crews = order.map((repo) => [repo, rest.filter((s) => s.repo === repo).map((s) => s.id)]).filter(([, ids]) => ids.length);
  const seats = tavernSeats(crews);
  const byId = new Map(rest.map((s) => [s.id, s]));
  // Each crew where it always is (your projects' order): what needs you
  // is in its head and rings, not in crews trading places.
  const drawn = crews.map(([repo]) => {
    const ids = seats[repo].filter(Boolean);      // the seats' order; a free one in between takes no room
    return { repo, ids, poses: ids.map((id) => tavernPose(byId.get(id), p)) };
  });
  const nodes = [h("div", { class: "today-summary" }, h("span", { class: "today-summary-text" }, todaySummary(v, "chats")), missionScore())];
  const hall = [];
  // Your assistant's project's chats are in its crew.
  const own = main ? drawn.find((c) => c.repo === main.repo) : null;
  if (main) hall.push(tavernOwnCrew(main, own ? own.ids.map((id) => byId.get(id)) : [], p));
  for (const c of drawn) {
    if (c === own) continue;
    const kinds = tavernKinds(c.ids);
    hall.push(tavernCrew(c.repo, c.ids.map((id) => tavernPirate(byId.get(id), p, false, kinds.get(id))), todayHue(c.repo), c.poses));
  }
  if (!hall.length) hall.push(h("p", { class: "today-clear" }, "The tavern's empty: start a chat and a pirate takes a seat."));
  nodes.push(h("div", { class: "tavern-hall" }, ...hall));
  return nodes;
}

// What the tavern shows besides the chats: who cheers.
function tavernKey() {
  tavernTrack();
  return [...tavern.cheer.keys()].join();
}

// A cheer ended: drawn again, while it shows.
setInterval(() => {
  if (typeof board === "undefined" || board.tab !== "tavern" || !board.box || !board.box.dataset.key) return;
  const now = Date.now();
  if ([...tavern.cheer.values()].some((t) => t <= now)) todayFill(board.box);
}, 1000);
