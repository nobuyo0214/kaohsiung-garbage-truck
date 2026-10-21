/* Generated sw.js uses this template. Only the interface is cached, never CSV or data JSON. */
"use strict";
const CONFIG = __SHELL_CONFIG__;
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
