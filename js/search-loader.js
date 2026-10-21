/* In-memory file cache: a retry only downloads failed files; no stale CSV in localStorage. */
"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else
    root.createSearchLoader = (options) =>
      factory({ ...options, parse: root.Papa?.parse });
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function ({
    parse,
    fetcher = globalThis.fetch,
    timeout = 12000,
    concurrency = 6,
  } = {}) {
    const cache = new Map(),
      inFlight = new Map();
    const controllers = new Set();
    let generation = 0;
    async function read(name, required, expectedHash) {
      const cacheKey = name + ":" + (expectedHash || "");
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
      const epoch = generation;
      const promise = (async () => {
        if (typeof parse !== "function")
          throw Error("CSV 讀取程式無法載入，請重新整理頁面。");
        const controller = new AbortController();
        controllers.add(controller);
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await fetcher(name, {
            signal: controller.signal,
            cache: "no-store",
          });
          if (!response.ok) throw Error("HTTP " + response.status);
          const bytes = expectedHash
            ? new Uint8Array(await response.arrayBuffer())
            : null;
          const content = bytes
            ? new TextDecoder().decode(bytes)
            : await response.text();
          if (expectedHash) {
            const digest = await crypto.subtle.digest("SHA-256", bytes);
            const actual = Array.from(new Uint8Array(digest), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join("");
            if (actual !== expectedHash)
              throw Error("資料版本不一致，請重試更新");
          }
          const result = parse(content, {
            header: true,
            skipEmptyLines: "greedy",
            transformHeader: (h) => h.trim().replace(/^\uFEFF/, ""),
          });
          if (
            result.errors.length ||
            !required.every((h) => (result.meta.fields || []).includes(h))
          )
            throw Error("CSV 格式或欄位不完整");
          if (epoch !== generation) throw Error("載入已取消，請重試");
          cache.set(cacheKey, result.data);
          return result.data;
        } finally {
          clearTimeout(timer);
          controllers.delete(controller);
        }
      })();
      inFlight.set(cacheKey, promise);
      try {
        return await promise;
      } finally {
        if (inFlight.get(cacheKey) === promise) inFlight.delete(cacheKey);
      }
    }
    async function load(
      files,
      ruleHeaders,
      onProgress = () => {},
      hashes = {},
    ) {
      // Rules run within the same pool, rather than adding another concurrent request.
      const jobs = [
        ...files.map((file) => ({
          name: file.name,
          required: ["責任區", "車次", "停留地點", "停留時間"],
        })),
        { name: "garbage-days.csv", required: ruleHeaders },
      ];
      const results = new Array(jobs.length);
      let next = 0,
        completed = 0;
      async function worker() {
        while (next < jobs.length) {
          const i = next++,
            job = jobs[i];
          try {
            results[i] = {
              status: "fulfilled",
              value: await read(job.name, job.required, hashes[job.name]),
            };
          } catch (reason) {
            results[i] = { status: "rejected", reason };
          }
          completed++;
          onProgress(completed, jobs.length);
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(concurrency, jobs.length) }, worker),
      );
      return {
        routes: results.slice(0, files.length),
        rules: results[files.length],
      };
    }
    function reset() {
      generation++;
      controllers.forEach((c) => c.abort());
      cache.clear();
      inFlight.clear();
    }
    return { load, reset };
  },
);
