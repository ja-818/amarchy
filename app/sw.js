// amarchy's service worker: the notifications (Web Push, sent by `amarchy
// app` when a session needs you or is done), and the app's own files kept for
// when the server can't be reached (it then says so, rather than Safari's
// error page). Everything else always comes from the server.

const SHELL = "amarchy-shell-v1";
const FILES = ["/", "/app.css", "/app.js", "/manifest.webmanifest", "/icon.svg", "/icon-180.png", "/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

// The app's files: from the server when it answers (and kept), else as kept.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  const path = url.pathname === "/index.html" ? "/" : url.pathname;
  if (!FILES.includes(path)) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(path, copy));
      }
      return res;
    } catch (err) {
      return (await caches.match(path)) || Response.error();
    }
  })());
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  const shown = self.registration.showNotification(d.title || "amarchy", {
    body: d.body || "",
    tag: d.tag || "amarchy",
    renotify: true,
    icon: "/icon-192.png",
    data: { url: d.url || "/" },
  });
  const badge = typeof d.waiting === "number" && navigator.setAppBadge
    ? (d.waiting ? navigator.setAppBadge(d.waiting) : navigator.clearAppBadge()).catch(() => {})
    : null;
  e.waitUntil(Promise.all([shown, badge]));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of open) {
      await c.focus();
      c.postMessage({ go: url });
      return;
    }
    await self.clients.openWindow(url);
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
