// amarchy's service worker: the notifications (Web Push, sent by `amarchy
// app` when a session needs you or is done), and the app's own files kept for
// when the server can't be reached (it then says so, rather than Safari's
// error page), your assistant's picture too. Everything else always comes
// from the server.
//
// The app's files are kept by build: the server writes its build into this
// file (bin/amarchy's page) and sends it with each app file (X-Amarchy-Build).
// A cache keeps only files of this build, so an offline page never gets old
// and new files mixed. A new build is a new worker: it takes over at once
// (skipWaiting), the old one's files go, and the page reloads (app.js).

const BUILD = "{{build}}";
const SHELL = `amarchy-shell-${BUILD}`;
const PICTURES = "amarchy-pictures";     // not a build's: kept until a newer one of yours replaces it
const FILES = ["/", "/app.css", "/desk.css", "/chat.css", "/screen.css", "/terminal.css", "/secrets.css", "/theme.css", "/app.js", "/desk.js", "/manage.js", "/dictate.js", "/chat.js", "/terminal.js", "/secrets.js", "/manifest.webmanifest", "/icon.svg", "/icon-180.png", "/icon-192.png", "/assistant.svg"];

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
        const res = await fetch(f, { cache: "no-cache" });
        if (ofBuild(res)) await cache.put(f, res);
      } catch (err) { /* offline: kept the next time */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL && key !== PICTURES) await caches.delete(key);
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
  if (!FILES.includes(path) && !picture) return;
  // The look (theme.css?v=<its stamp>) is kept as the URL it was asked for:
  // one at a time, the last look you picked.
  const look = path === "/theme.css";
  const key = look ? path + url.search : path;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (ofBuild(res)) {
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
