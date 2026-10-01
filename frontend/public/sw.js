// CLEAN-AM service worker. It does two things only:
//  1. shows /offline when a page cannot load for lack of a connection;
//  2. keeps static files (build output, images, icons) so the app opens fast.
// Pages and /api responses are never cached: they carry personal data and
// must always be current. Bump VERSION to drop everything cached before.
const VERSION = "v1";
const PAGES = `clean-am-pages-${VERSION}`;
const STATIC = `clean-am-static-${VERSION}`;
const OFFLINE = "/offline";
const MAX_STATIC = 120;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES);
      // Fetched without cookies, so the saved page holds no one's session.
      await cache.put(OFFLINE, await fetch(new Request(OFFLINE, { credentials: "omit", cache: "reload" })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [PAGES, STATIC];
      for (const key of await caches.keys()) if (!keep.includes(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_STATIC))) await cache.delete(key);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE)) ?? Response.error()));
    return;
  }

  // Build files never change under the same name: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) {
          await cache.put(request, response.clone());
          trim(cache);
        }
        return response;
      })(),
    );
    return;
  }

  // Images and icons can be replaced: show the saved copy, refresh it behind.
  if (url.pathname.startsWith("/images/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC);
        const hit = await cache.match(request);
        const refresh = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => hit ?? Response.error());
        if (hit) event.waitUntil(refresh);
        return hit ?? refresh;
      })(),
    );
  }
});
