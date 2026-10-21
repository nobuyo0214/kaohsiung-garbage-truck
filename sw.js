/* Generated sw.js uses this template. Only the interface is cached, never CSV or data JSON. */
"use strict";
const CONFIG = {"version":"93e024e06d3764a1b98b","assets":[["index.html","d4708fc6001fb2e237988c974f8a8bee77f82362c353bef13675c723658ec401"],["css/search.css","14347cc8c41d75e172f00ec568393a98f3943b898b103f3e9bcbee603920ccf5"],["manifest.webmanifest","108b02c4bc47865799b8cdd91865a4efd118a7a49996c8f33c84672c5ff6e8bd"],["icons/icon-192.png","9db8c5c2b4ee0b82b20943d98b1f4f52cf77eabe7d81bd2495e294c27678c3ae"],["icons/icon-512.png","a2d80be9974d002e6f8a8a7598f00292c27dff1090209eee35b232dc0214b0e4"],["icons/maskable-512.png","a2d80be9974d002e6f8a8a7598f00292c27dff1090209eee35b232dc0214b0e4"],["icons/apple-touch-icon.png","05bf63cf1b981996212ce37c2169ec05f73c6ea098eba9aa273d975e9eec31ea"],["js/vendor/papaparse.min.js","3553fb8bdf5b8004ce5531e6827e81c8b34e7b3992677967754544064e97b016"],["js/route-files.js","8f217df33ea563d4fc3bfc467899c5c73cc2ba7ccbcf4c7b98986371791ed630"],["js/data-core.js","03907c90afcc79a71b9c9610037f2994854ce793a752ab36e6dc0afdbc80fd03"],["js/search-tools.js","f47c392e19baa5853550270a0bc059124a4be0b751542c9248de6d853e27b56f"],["js/search-loader.js","a58c4903c9983cdc138236a47ce7994761113d0f5505df89dd0ea9b9939fc439"],["js/site-data.js","4cdc7fe18101d4a8193fcf68326832e6a67dc6de0e4ee9e384205482b3337112"],["js/location-quality.js","ff607d9bb770e684eac61b025bdf8370c11f2d2757ed7e688a32ccf80cd41f6d"],["js/convenience-core.js","6386ce2adddc972744ee98e228be13cab0a269ac654bd0180660723be24188b2"],["js/convenience-ui.js","ba3167c99f09cd9c7c4d3d89990ad728adf2b31162fde2d66dc3a314ba17bea6"],["js/search-app.js","dbf71970ebeff5dc3f4695be118c5cfeecbde293ab0fdec5b94ea506a3300bb8"],["js/pwa.js","3a8733238b2c7b8b9ee5e085838cbf829288b249a8feedb3ef100bf5e2fe69a0"]]};
const ROOT = new URL(self.registration.scope);
const PREFIX = "kh-trash-shell:" + ROOT.pathname + ":";
const CACHE = PREFIX + CONFIG.version;
const ASSETS = new Map(
  CONFIG.assets.map(([path, hash]) => [new URL(path, ROOT).href, hash]),
);
async function checked(url, expected) {
  const response = await fetch(new Request(url, { cache: "no-store" }));
  if (!response.ok || response.type === "opaque") throw Error("介面載入失敗");
  const bytes = await response.clone().arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== expected) throw Error("介面版本不一致");
  return response;
}
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await Promise.all(
          [...ASSETS].map(async ([url, hash]) =>
            cache.put(url, await checked(url, hash)),
          ),
        );
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== ROOT.origin) return;
  // Map only the homepage navigation to its fixed shell key. No personal URL is cached.
  const homepage =
    event.request.mode === "navigate" &&
    [ROOT.pathname, new URL("index.html", ROOT).pathname].includes(
      url.pathname,
    );
  const key = homepage
    ? new URL("index.html", ROOT).href
    : new URL(url.pathname, ROOT.origin).href;
  if (ASSETS.has(key)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE),
          cached = await cache.match(key);
        if (cached) return cached;
        try {
          const response = await checked(key, ASSETS.get(key));
          await cache.put(key, response.clone());
          return response;
        } catch {
          return new Response("目前無法載入此版本介面，請連線後重新整理。", {
            status: 503,
          });
        }
      })(),
    );
    return;
  }
  // CSVs, metadata, geometry, reports and management pages always require the network.
  event.respondWith(
    fetch(new Request(event.request, { cache: "no-store" })).catch(
      () =>
        new Response("目前無法更新清運資訊", {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        }),
    ),
  );
});
