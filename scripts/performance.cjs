#!/usr/bin/env node
/* Opt-in measurement, not a CI millisecond assertion. Temporary server instrumentation only. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  zlib = require("node:zlib"),
  os = require("node:os"),
  { execFileSync } = require("node:child_process");
const { chromium } = require("@playwright/test"),
  root = path.resolve(__dirname, "..");
const instrumentation = `
window.__bench={parse:0,index:0,quality:0,prepare:0};
for(const [object,key,metric] of [[Papa,'parse','parse'],[SearchTools,'createIndex','index'],[LocationQuality,'analyze','quality'],[GarbageData,'prepareRows','prepare']]){
 const original=object[key];object[key]=function(...args){const start=performance.now(),result=original.apply(this,args);__bench[metric]+=performance.now()-start;if(metric==='index'&&args[0].length){__bench.rows=args[0];__bench.searchIndex=result;}return result;};
}
const originalNearby=Journey.nearbyIndex;Journey.nearbyIndex=(...args)=>{const result=originalNearby(...args);if(result.size)__bench.nearby=result;return result;};
const originalLoader=createSearchLoader;window.createSearchLoader=(...args)=>{const result=originalLoader(...args),load=result.load;result.load=async(...parameters)=>{const start=performance.now();const value=await load(...parameters);__bench.csvLoad=performance.now()-start;return value;};return result;};
new MutationObserver(()=>{if(!__bench.interactive&&!document.getElementById('searchButton').disabled){__bench.interactive=performance.now();}}).observe(document,{subtree:true,attributes:true,attributeFilter:['disabled']});
`;
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".csv": "text/csv",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
async function main() {
  const output = process.argv[2] || "reports/performance/latest.json",
    runs = Number(process.env.PERF_RUNS || 5);
  const server = http.createServer((req, res) => {
    let name;
    try {
      name = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (name === "/") name = "/index.html";
    const file = path.resolve(root, "." + name);
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, bytes) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      if (name === "/js/search-app.js")
        bytes = Buffer.concat([Buffer.from(instrumentation), bytes]);
      res.setHeader(
        "Content-Type",
        (types[path.extname(file)] || "text/plain") + "; charset=utf-8",
      );
      res.setHeader(
        "Cache-Control",
        /\.csv$|\/data\//.test(name) ? "no-store" : "public,max-age=3600",
      );
      res.setHeader("Content-Encoding", "gzip");
      res.end(zlib.gzipSync(bytes));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  const samples = [];
  try {
    for (let n = 0; n < runs; n++) {
      const context = await browser.newContext({
          serviceWorkers: "block",
          viewport: { width: 390, height: 844 },
          timezoneId: "Asia/Taipei",
        }),
        page = await context.newPage(),
        cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 40,
        downloadThroughput: 625000,
        uploadThroughput: 250000,
      });
      for (const cache of ["cold", "warm"]) {
        await page.goto("http://127.0.0.1:" + server.address().port + "/");
        await page.waitForFunction(
          () => window.__bench?.interactive && __bench.nearby,
        );
        await page.evaluate(
          () =>
            new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            ),
        );
        const metrics = await page.evaluate(() => {
          const b = __bench,
            median = (a) => a.sort((a, b) => a - b)[Math.floor(a.length / 2)],
            measure = (fn) => {
              const values = [];
              for (let i = 0; i < 15; i++) {
                const start = performance.now();
                fn();
                values.push(performance.now() - start);
              }
              return median(values);
            };
          const city = {
              district: "all",
              keyword: "路",
              weekday: "一",
              period: "evening",
            },
            single = { ...city, district: "三民區" };
          const result = {
            interactiveMs: b.interactive,
            csvLoadMs: b.csvLoad,
            csvParseMs: b.parse,
            indexMs: b.index,
            qualityMs: b.quality,
            prepareMs: b.prepare,
            citySearchMs: measure(() => b.searchIndex.search(city)),
            districtSearchMs: measure(() => b.searchIndex.search(single)),
            nearbyMs: measure(() =>
              b.nearby.search([120.32406, 22.66913], 1000),
            ),
            timelineMs: measure(() =>
              Journey.todayRows(b.searchIndex.search({ district: "all" }), {
                now: new Date("2026-10-29T08:00:00Z"),
              }),
            ),
            heapBytes: performance.memory?.usedJSHeapSize ?? null,
            transferBytes:
              performance
                .getEntriesByType("resource")
                .reduce((n, r) => n + r.transferSize, 0) +
              (performance.getEntriesByType("navigation")[0]?.transferSize ||
                0),
            csvRequests: performance
              .getEntriesByType("resource")
              .filter((r) => r.name.endsWith(".csv")).length,
          };
          const resources = performance
            .getEntriesByType("resource")
            .filter((r) => r.name.endsWith(".csv"));
          result.csvNetworkSpanMs =
            Math.max(...resources.map((r) => r.responseEnd)) -
            Math.min(...resources.map((r) => r.startTime));
          return result;
        });
        const render = await page.evaluate(async () => {
          document.getElementById("district").value = "all";
          document.getElementById("keyword").value = "";
          const start = performance.now();
          document.getElementById("searchForm").requestSubmit();
          const dom = performance.now() - start;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          return {
            firstResultsDOMMs: dom,
            firstResultsPaintMs: performance.now() - start,
            cards: document.querySelectorAll("#results .card").length,
          };
        });
        samples.push({ run: n + 1, cache, ...metrics, ...render });
      }
      await context.close();
    }
    const summary = {};
    for (const cache of ["cold", "warm"]) {
      summary[cache] = {};
      const subset = samples.filter((s) => s.cache === cache);
      for (const key of Object.keys(subset[0]).filter(
        (k) => !["run", "cache"].includes(k),
      )) {
        const a = subset
          .map((s) => s[key])
          .filter(Number.isFinite)
          .sort((a, b) => a - b);
        summary[cache][key] = a.length
          ? { median: a[Math.floor(a.length / 2)], min: a[0], max: a.at(-1) }
          : null;
      }
    }
    const value = {
      schema: 1,
      measuredAt: new Date().toISOString(),
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      workingTree: execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      }).trim()
        ? "modified"
        : "clean",
      environment: {
        browser: browser.version(),
        node: process.version,
        platform: os.platform(),
        cpu: os.cpus()[0]?.model,
        cpuRate: 4,
        latencyMs: 40,
        downloadBytesPerSecond: 625000,
        uploadBytesPerSecond: 250000,
        viewport: "390x844",
        runs,
        cache:
          "cold=new context; warm=same context reload; gzip; HTTP interface cache; CSV no-store; Service Worker blocked",
        note: "Local controlled server, not production RUM. Instrumentation wraps existing functions. Heap is Chromium approximate and includes benchmark references; no privacy/location telemetry.",
      },
      summary,
      samples,
    };
    fs.mkdirSync(path.dirname(path.resolve(root, output)), { recursive: true });
    fs.writeFileSync(
      path.resolve(root, output),
      JSON.stringify(value, null, 2) + "\n",
    );
    console.log(JSON.stringify({ output, summary }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
