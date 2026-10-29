// amarchy's service worker: the notifications (Web Push, sent by `amarchy
// app` when a session needs you or is done), and the app's own files kept,
// so the app opens at once (from here, not the network) and says so when the
// server can't be reached, rather than Safari's error page; your
// assistant's picture too. Everything else always comes from the server.
//
// The app's files are kept by build: the server writes its build into this
// file (bin/amarchy's page) and sends it with each app file (X-Amarchy-Build).
// A cache keeps only files of this build, so a page never gets old and new
// files mixed: the page (index.html) asks for each as name?b=<its build>,
// given from here when that's this worker's build, from the server when it
// isn't. The page comes from here too; the list says when the server has a
// newer build (app.js updated), and the page loads again as ?fresh, from the
// server, and with it the new files. A new build is a new worker: it takes
// over at once (skipWaiting), and the old one's files go.

const BUILD = "{{build}}";
const SHELL = `amarchy-shell-${BUILD}`;
const PICTURES = "amarchy-pictures";     // not a build's: kept until a newer one of yours replaces it
// The look's files (its fonts and wallpapers): not a build's either, each
// address the one file (?v=<its hash>, or named after it). Kept, as iOS
// soon forgets what a home-screen app fetched: the last few looks worn.
const LOOKS = "amarchy-looks";
const LOOK_FILES = /^\/(fonts|cuts|wallpapers|themes|custom|own)\//;
const LOOKS_KEPT = 24;
// The page, the look and the icons aren't a build's own address (no ?b=).
const UNSTAMPED = ["/", "/theme.css", "/manifest.webmanifest", "/icon.svg", "/icon-180.png", "/icon-192.png", "/assistant.svg"];
const FILES = ["/", "/app.css", "/desk.css", "/chat.css", "/screen.css", "/terminal.css", "/secrets.css", "/automations.css", "/ui.css", "/today.css", "/theme.css", "/ui.js", "/app.js", "/desk.js", "/manage.js", "/dictate.js", "/chat.js", "/terminal.js", "/secrets.js", "/automations.js", "/today.js", "/tasks.js", "/manifest.webmanifest", "/icon.svg", "/icon-180.png", "/icon-192.png", "/assistant.svg"];

// A response that may be kept: it worked, and it's this build's (a file with
// no build, as theme.css, belongs to none).
function ofBuild(res) {
  const build = res.headers.get("X-Amarchy-Build");
  return res.ok && (build === null || build === BUILD);
}

// Each file as this build has it, kept now (the ones the server can't give
// yet, as it's still being updated, are kept when a page first loads them).
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(FILES.map(async (f) => {
      try {
        const res = await fetch(UNSTAMPED.includes(f) ? f : `${f}?b=${BUILD}`, { cache: "no-cache" });
        if (ofBuild(res)) await cache.put(f, res);
      } catch (err) { /* offline: kept the next time */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (![SHELL, PICTURES, LOOKS].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

// The app's files: from the server when it answers (and kept, if they're this
// build's), else as kept.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  const path = url.pathname === "/index.html" ? "/" : url.pathname;
  const picture = path.startsWith("/picture/");     // your assistant's picture
  // A look's file: as kept, else from the server and kept (not the picker's
  // thumbnails, which are many).
  const named = url.searchParams.has("v") || path.startsWith("/cuts/") || path.startsWith("/own/");
  if (LOOK_FILES.test(path) && named && !/\.thumb\d+\./.test(path)) {
    e.respondWith(lookFile(e.request, path + url.search));
    return;
  }
  if (!FILES.includes(path) && !picture) return;
  // The look (theme.css?v=<its stamp>) is kept as the URL it was asked for:
  // one at a time, the last look you picked.
  const look = path === "/theme.css";
  const key = look ? path + url.search : path;
  // A file of another build than this worker's: the server's, never kept here.
  const stamp = url.searchParams.get("b");
  if (stamp && stamp !== BUILD) return;
  // The page and this build's files: as kept, at once. The page again from
  // the server when it asks to be (?fresh: the list said there's a newer build).
  const first = path === "/" ? !url.searchParams.has("fresh") : stamp === BUILD;
  e.respondWith((async () => {
    // A picture's address is its hash: the one kept is the one, so it's
    // served from the kept copy (not the network), as each list row's picture
    // is asked for again every time the list is drawn.
    if (picture) {
      const kept = await (await caches.open(PICTURES)).match(path);
      if (kept) return kept;
    }
    if (first) {
      const kept = await (await caches.open(SHELL)).match(path);
      if (kept) return kept;
    }
    try {
      const res = await fetch(e.request);
      if (ofBuild(res) && (path !== "/" || res.status === 200)) {
        const copy = res.clone();
        caches.open(picture ? PICTURES : SHELL).then(async (c) => {
          await c.put(key, copy);
          // A new picture: the one before it isn't needed any more.
          if (picture) {
            const sig = path.slice(9, 21);
            for (const req of await c.keys()) {
              const p = new URL(req.url).pathname;
              if (p.startsWith("/picture/") && p.slice(9, 21) !== sig) await c.delete(req);
            }
          }
          // A new look: the one kept before it isn't needed any more.
          if (look) for (const req of await c.keys()) {
            const u = new URL(req.url);
            if (u.pathname === path && u.search !== url.search) await c.delete(req);
          }
        });
      }
      return res;
    } catch (err) {
      // Offline: the look as it was kept (the last one picked, if this one never was).
      if (look) {
        const c = await caches.open(SHELL);
        const kept = (await c.keys()).find((req) => new URL(req.url).pathname === path);
        return (await c.match(key)) || (kept && (await c.match(kept))) || Response.error();
      }
      return (await caches.match(path)) || Response.error();
    }
  })());
});

// A look's file: the kept copy, at once; else the server's, kept. A newer
// one at the same path takes the older's place, and only the last
// LOOKS_KEPT stay (the oldest go first).
async function lookFile(request, key) {
  const cache = await caches.open(LOOKS);
  const kept = await cache.match(key);
  if (kept) return kept;
  const res = await fetch(request);
  if (res.ok && res.status === 200) {
    const copy = res.clone();
    (async () => {
      await cache.put(key, copy);
      const path = new URL(key, location.origin).pathname;
      const keys = await cache.keys();
      for (const req of keys) {
        const u = new URL(req.url);
        if (u.pathname === path && u.pathname + u.search !== key) await cache.delete(req);
      }
      const left = await cache.keys();
      for (const req of left.slice(0, Math.max(0, left.length - LOOKS_KEPT))) await cache.delete(req);
    })().catch(() => {});
  }
  return res;
}

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  const shown = self.registration.showNotification(d.title || "Amarchy", {
    body: d.body || "",
    tag: d.tag || "amarchy",
    renotify: true,
    // amarchy notify --urgent: on screen until dismissed, where the browser
    // lets it (a computer's; iOS ignores it).
    requireInteraction: !!d.urgent,
    // Your assistant's picture on its own (a computer's browser shows it; iOS
    // always shows the app's icon).
    icon: d.icon || "/icon-192.png",
    // ask: the session waits on a card (a question, a permission, a plan):
    // tapped, the app opens on that card.
    data: { url: d.url || "/", ask: d.ask || null },
  });
  const badge = typeof d.waiting === "number" && navigator.setAppBadge
    ? (d.waiting ? navigator.setAppBadge(d.waiting) : navigator.clearAppBadge()).catch(() => {})
    : null;
  e.waitUntil(Promise.all([shown, badge]));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  const ask = (e.notification.data && e.notification.data.ask) || null;
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of open) {
      await c.focus();
      c.postMessage({ go: url, ask });
      return;
    }
    // Not open: the app starts there, and on the card (?ask=, app.js's start).
    await self.clients.openWindow(ask ? url.replace(/^([^#?]*)/, `$1?ask=${encodeURIComponent(ask)}`) : url);
  })());
});

// The push service renewed the subscription: tell the server about the new one.
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil((async () => {
    const state = await (await fetch("/api/state")).json();
    const key = Uint8Array.from(atob(state.key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" },
                               body: JSON.stringify(sub.toJSON()) });
  })().catch(() => {}));
});
