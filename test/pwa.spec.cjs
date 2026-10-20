const { test, expect } = require("@playwright/test");
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
test.use({ serviceWorkers: "allow" });
const root = path.resolve(__dirname, ".."),
  prefix = "/kaohsiung-garbage-truck/",
  base = "http://127.0.0.1:4175" + prefix;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
let server, overrides, requests;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, base).pathname;
    if (!pathname.startsWith(prefix)) {
      res.writeHead(404).end();
      return;
    }
    const relative = pathname.slice(prefix.length) || "index.html",
      file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    requests.push(relative);
    const extension = path.extname(file);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".csv": "text/csv",
        ".png": "image/png",
      }[extension] || "application/octet-stream",
    );
    res.setHeader("Cache-Control", "no-store");
    const data = overrides.has(relative)
      ? overrides.get(relative)
      : fs.existsSync(file)
        ? fs.readFileSync(file)
        : null;
    if (data === null) {
      res.writeHead(404).end();
      return;
    }
    res.end(data);
  });
  await new Promise((resolve) => server.listen(4175, "127.0.0.1", resolve));
});
test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});
test.beforeEach(() => {
  overrides = new Map();
  requests = [];
});
async function ready(page) {
  await page.goto(base);
  await expect(page.locator("#searchButton")).toBeEnabled({ timeout: 15000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}
async function cachedURLs(page) {
  return page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async (key) =>
          (await (await caches.open(key)).keys()).map((r) => r.url),
        ),
      )
    ).flat(),
  );
}
function newWorker({ mismatch = false } = {}) {
  const config = require("../scripts/build-site.cjs").build({ check: true });
  const html = fs
    .readFileSync(path.join(root, "index.html"), "utf8")
    .replace("</head>", '<meta name="pwa-test-release" content="2"></head>');
  const assets = config.assets.map(([name, sha]) => [
    name,
    name === "index.html" ? hash(html) : sha,
  ]);
  const text = fs
    .readFileSync(path.join(root, "scripts/sw-template.js"), "utf8")
    .replace(
      "__SHELL_CONFIG__",
      JSON.stringify({ version: "test-next-release", assets }),
    );
  overrides.set("sw.js", text);
  if (!mismatch) overrides.set("index.html", html);
}

test("real worker and manifest use the Pages scope and cache only a verified interface", async ({
  page,
}) => {
  await ready(page);
  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).scope,
  );
  expect(scope).toBe(base);
  const manifest = await page.evaluate(async () =>
    (await fetch(document.querySelector('link[rel="manifest"]').href)).json(),
  );
  expect(new URL(manifest.scope, base).href).toBe(base);
  expect(new URL(manifest.start_url, base).href).toBe(base);
  for (const icon of manifest.icons) {
    const response = await page.request.get(new URL(icon.src, base).href);
    expect(response.ok()).toBe(true);
  }
  const urls = await cachedURLs(page);
  expect(urls.some((url) => url.endsWith("index.html"))).toBe(true);
  expect(
    urls.every((url) => !url.includes(".csv") && !url.includes("/data/")),
  ).toBe(true);
  const before = requests.filter((p) => p.endsWith(".csv")).length;
  await page.reload();
  await expect(page.locator("#searchButton")).toBeEnabled();
  expect(requests.filter((p) => p.endsWith(".csv")).length - before).toBe(40);
});

test("offline reload opens the shell without old dates and keeps favorite backup available", async ({
  page,
  context,
}) => {
  await ready(page);
  await page.locator(".save-button").first().click();
  await context.setOffline(true);
  await expect(page.locator("#dataStatus")).toContainText("離線");
  await expect(page.locator(".card")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".empty-state h3")).toHaveText(
    "目前無法更新清運資訊",
  );
  await expect(page.locator("#searchButton")).toBeDisabled();
  await expect(page.locator("#currentLoadedAt")).toHaveText(
    "目前無法更新清運資訊",
  );
  await page.click("#quickSavedButton");
  await expect(page.locator("#favoritesManager")).toBeVisible();
  await expect(page.locator("#favoriteCount")).toHaveText("1");
  const download = page.waitForEvent("download");
  await page.click("#exportFavorites");
  expect((await download).suggestedFilename()).toBe(
    "kaohsiung-garbage-favorites.json",
  );
  await context.setOffline(false);
  await expect(page.locator("#searchButton")).toBeEnabled();
  await expect(page.locator("#dataStatus")).toContainText("39 / 39");
  expect((await cachedURLs(page)).some((url) => url.includes(".csv"))).toBe(
    false,
  );
});

test("new shell waits for user reload, cleans old caches and preserves favorites", async ({
  page,
}) => {
  await ready(page);
  await page.locator(".save-button").first().click();
  const oldKeys = await page.evaluate(() => caches.keys());
  newWorker();
  await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistration()).update(),
  );
  await expect(page.locator("#appUpdate")).toBeVisible({ timeout: 15000 });
  expect(await page.locator('meta[name="pwa-test-release"]').count()).toBe(0);
  await Promise.all([page.waitForNavigation(), page.click("#applyUpdate")]);
  await expect(page.locator("#searchButton")).toBeEnabled();
  await expect(page.locator('meta[name="pwa-test-release"]')).toHaveAttribute(
    "content",
    "2",
  );
  await expect(page.locator("#favoriteCount")).toHaveText("1");
  const keys = await page.evaluate(() => caches.keys());
  expect(keys).toHaveLength(1);
  expect(keys.some((k) => oldKeys.includes(k))).toBe(false);
  expect(
    (await cachedURLs(page)).every(
      (url) => !url.includes(".csv") && !url.includes("/data/"),
    ),
  ).toBe(true);
});

test("a mismatched asset rejects an update and leaves the previous complete shell usable", async ({
  page,
  context,
}) => {
  await ready(page);
  const oldKeys = await page.evaluate(() => caches.keys());
  newWorker({ mismatch: true });
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    window.updateRejected = false;
    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      worker.addEventListener("statechange", () => {
        if (worker.state === "redundant") window.updateRejected = true;
      });
    });
    await reg.update();
  });
  await page.waitForFunction(() => window.updateRejected, { timeout: 15000 });
  expect(await page.evaluate(() => caches.keys())).toEqual(oldKeys);
  await expect(page.locator("#appUpdate")).toBeHidden();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".empty-state h3")).toHaveText(
    "目前無法更新清運資訊",
  );
  await expect(page.locator('meta[name="pwa-test-release"]')).toHaveCount(0);
});

test("a changed CSV without a matching snapshot is rejected even with an installed worker", async ({
  page,
}) => {
  await ready(page);
  overrides.set(
    "garbage-days.csv",
    fs.readFileSync(path.join(root, "garbage-days.csv"), "utf8") + "\n",
  );
  await page.reload();
  await expect(page.locator("#searchButton")).toBeEnabled();
  await expect(page.locator("#dataStatus")).toContainText("部分日期資料未載入");
  await page.selectOption("#district", "三民區");
  await page.click("#searchButton");
  await expect(page.locator("#filterNotice")).toContainText("日期對照表未載入");
  await expect(
    page.locator(".day-detail:first-child dd:not(.unknown)"),
  ).toHaveCount(0);
});

test("install guidance and supported install prompts require a deliberate click", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#installInfo summary").click();
  await expect(page.locator("#installInfo")).toContainText("iPhone Safari");
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = async () => {
      window.installWasPrompted = true;
    };
    event.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(event);
  });
  await expect(page.locator("#installButton")).toBeVisible();
  expect(await page.evaluate(() => window.installWasPrompted)).toBeUndefined();
  await page.click("#installButton");
  expect(await page.evaluate(() => window.installWasPrompted)).toBe(true);
});
