/* Generated sw.js uses this template. Only the interface is cached, never CSV or data JSON. */
"use strict";
const CONFIG = {"version":"b17efca44d64b2d45e87","assets":[["index.html","e3d3634e73489513e8a94f9323cea498ee961cf43c90944b24661d3904438496"],["css/search.css","652dff1d2f08fdc969caf13aee6df331d61061678ee059babd36e44b2f8c8e0d"],["manifest.webmanifest","108b02c4bc47865799b8cdd91865a4efd118a7a49996c8f33c84672c5ff6e8bd"],["icons/icon-192.png","9db8c5c2b4ee0b82b20943d98b1f4f52cf77eabe7d81bd2495e294c27678c3ae"],["icons/icon-512.png","a2d80be9974d002e6f8a8a7598f00292c27dff1090209eee35b232dc0214b0e4"],["icons/maskable-512.png","a2d80be9974d002e6f8a8a7598f00292c27dff1090209eee35b232dc0214b0e4"],["icons/apple-touch-icon.png","05bf63cf1b981996212ce37c2169ec05f73c6ea098eba9aa273d975e9eec31ea"],["js/vendor/papaparse.min.js","3553fb8bdf5b8004ce5531e6827e81c8b34e7b3992677967754544064e97b016"],["js/route-files.js","8f217df33ea563d4fc3bfc467899c5c73cc2ba7ccbcf4c7b98986371791ed630"],["js/data-core.js","03907c90afcc79a71b9c9610037f2994854ce793a752ab36e6dc0afdbc80fd03"],["js/search-tools.js","8ee7ce696adffbd772b17573658e652a25db191e29007ccd844c54177562ec42"],["js/search-loader.js","a58c4903c9983cdc138236a47ce7994761113d0f5505df89dd0ea9b9939fc439"],["js/site-data.js","4cdc7fe18101d4a8193fcf68326832e6a67dc6de0e4ee9e384205482b3337112"],["js/location-quality.js","ff607d9bb770e684eac61b025bdf8370c11f2d2757ed7e688a32ccf80cd41f6d"],["js/convenience-core.js","def0cabd6e8776dc6e4f7d9f65ffc9b4de8976451d49e133f257dcaa7f4ba059"],["js/convenience-ui.js","e84da4daf6977b28a51ef27d303c0b0335d3573b0b4d7656e6d11b2cfc1e2949"],["js/stop-qr.js","28c5cc7eb8f1c69296c8d73c45f04fcdc7c6b9473dd14b47631c7d1a746cacef"],["js/qr-ui.js","03d218e7eaff20e34b9a4b806bcc109c4ac6207d7726e5dee0a8374387931323"],["js/vendor/qrcode-generator-2.0.4.js","79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c"],["js/journey-core.js","8a79846749388e78d3d254f43219cb52cfa0a4bc39fdf40f06f86ef3dcd4b730"],["js/nearby-session.js","5db617da3b1aa3b3e51e613735a9c4dfe308561e29a86cbde9f58bbe9561fd65"],["js/search-app.js","5f5b10190440a727ce2083c2d43e4823a0ee62b3a65b9ae36d1d0a6035b75ad6"],["js/pwa.js","3a8733238b2c7b8b9ee5e085838cbf829288b249a8feedb3ef100bf5e2fe69a0"],["js/version-ui.js","942574e4cf91ceb37239122e64161c17b742c483970ef3099b7c422de2ac3c15"],["js/site-version.js","2f1969125f1658fe1a800804a98c10015621d070886af0df4886c916366bac90"]]};
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
