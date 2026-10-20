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
    async function read(name, required) {
      if (cache.has(name)) return cache.get(name);
      if (inFlight.has(name)) return inFlight.get(name);
      const promise = (async () => {
        if (typeof parse !== "function")
          throw Error("CSV 讀取程式無法載入，請重新整理頁面。");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await fetcher(name, { signal: controller.signal });
          if (!response.ok) throw Error("HTTP " + response.status);
          const content = await response.text();
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
          cache.set(name, result.data);
          return result.data;
        } finally {
          clearTimeout(timer);
        }
      })();
      inFlight.set(name, promise);
      try {
        return await promise;
      } finally {
        inFlight.delete(name);
      }
    }
    async function load(files, ruleHeaders, onProgress = () => {}) {
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
              value: await read(job.name, job.required),
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
    return { load };
  },
);
