/* Generated sw.js uses this template. Only the interface is cached, never CSV or data JSON. */
"use strict";
const CONFIG = {"version":"bfeaee25ed6f0025fe21","assets":[["index.html","a78e7c80c9d00ab8ecc781ab6d015133a61db928b6f5d9f16d1718f8664a06a2"],["css/search.css","66b0391353eb2ecdbbe885b4ba774ca7dc196191a6ebf44e74ff12924a534c33"],["manifest.webmanifest","108b02c4bc47865799b8cdd91865a4efd118a7a49996c8f33c84672c5ff6e8bd"],["icons/icon-192.png","9db8c5c2b4ee0b82b20943d98b1f4f52cf77eabe7d81bd2495e294c27678c3ae"],["icons/icon-512.png","a2d80be9974d002e6f8a8a7598f00292c27dff1090209eee35b232dc0214b0e4"],["icons/maskable-512.png","a2d80be9974d002e6f8a8a7598f00292c27dff1090209eee35b232dc0214b0e4"],["icons/apple-touch-icon.png","05bf63cf1b981996212ce37c2169ec05f73c6ea098eba9aa273d975e9eec31ea"],["js/vendor/papaparse.min.js","3553fb8bdf5b8004ce5531e6827e81c8b34e7b3992677967754544064e97b016"],["js/route-files.js","8f217df33ea563d4fc3bfc467899c5c73cc2ba7ccbcf4c7b98986371791ed630"],["js/data-core.js","03907c90afcc79a71b9c9610037f2994854ce793a752ab36e6dc0afdbc80fd03"],["js/search-tools.js","1dbfc55867712ff939715d9e452072d69eca92c3e13e4fcbd475adbe84585fa2"],["js/search-loader.js","a58c4903c9983cdc138236a47ce7994761113d0f5505df89dd0ea9b9939fc439"],["js/site-data.js","4cdc7fe18101d4a8193fcf68326832e6a67dc6de0e4ee9e384205482b3337112"],["js/location-quality.js","ff607d9bb770e684eac61b025bdf8370c11f2d2757ed7e688a32ccf80cd41f6d"],["js/convenience-core.js","def0cabd6e8776dc6e4f7d9f65ffc9b4de8976451d49e133f257dcaa7f4ba059"],["js/convenience-ui.js","054bc14fe05fb28b5413624ca3f208dcf2ba6c3ff590bcb5a372433c905edc6c"],["js/search-app.js","a2df7463b96202534287444182851e468cbab16866f24b78be968bdac26c568a"],["js/pwa.js","3a8733238b2c7b8b9ee5e085838cbf829288b249a8feedb3ef100bf5e2fe69a0"]]};
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
