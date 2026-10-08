// Background helper: shows chat notifications when the app is closed.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let d = {};
  try{ d = e.data ? e.data.json() : {}; }catch(err){ d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some(w => w.visibilityState === "visible" && w.focused)) return;
    await self.registration.showNotification(d.title || "Cat Command Chat", {
      body: d.body || "New message",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: d.tag || "kat-chat",
      renotify: true,
      data: { url: d.url || "/" }
    });
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins){ if ("focus" in w) return w.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
