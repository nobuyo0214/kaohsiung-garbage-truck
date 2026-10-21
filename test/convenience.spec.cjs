const { test, expect } = require("@playwright/test");
const fs = require("node:fs"),
  Papa = require("papaparse");
const { load } = require("../scripts/data-tool.cjs"),
  C = require("../js/convenience-core"),
  T = require("../js/search-tools"),
  L = require("../js/location-quality");
const { mockSnapshot } = require("./snapshot-fixture.cjs");
const raw = load(),
  topology = require("../data/geo/kaohsiung.topo.json"),
  audit = L.analyze(raw, topology);
const sample = audit.records.find(
  (r) => r.eligible && r.row.searchDistrict === "三民區",
).row;
const deepLink = (row) => C.shareURL(T.stopId(row), "http://127.0.0.1:4173/");
async function ready(page, url = "/") {
  await page.goto(url);
  await expect(page.locator("#searchButton")).toBeEnabled({ timeout: 15000 });
}
const jsonFile = (data, name = "favorites.json") => ({
  name,
  mimeType: "application/json",
  buffer: Buffer.from(typeof data === "string" ? data : JSON.stringify(data)),
});

test("navigation uses the exact original coordinate while missing/conflicting positions have no map link", async ({
  page,
}) => {
  await ready(page, deepLink(sample));
  await expect(page.locator(".shared-stop")).toHaveCount(1);
  const destination = new URL(
    await page.locator(".map-link").getAttribute("href"),
  );
  expect(destination.searchParams.get("destination")).toBe(
    sample.緯度 + "," + sample.經度,
  );
  await expect(page.locator(".map-link")).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  const missing = raw.find((r) => r.sourceFile === "shanlin.csv");
  await page.goto(deepLink(missing));
  await expect(page.locator("#searchButton")).toBeEnabled();
  await expect(page.locator(".map-link")).toHaveCount(0);
  await expect(page.locator(".location-unknown")).toContainText("位置尚待確認");
  const conflict = audit.records.find(
    (r) =>
      r.reasons.includes("identity_conflict") &&
      r.row.searchDistrict === "彌陀區",
  ).row;
  await page.selectOption("#district", conflict.searchDistrict);
  await page.fill("#keyword", conflict.停留地點);
  await page.click("#searchButton");
  await expect(page.locator(".card").first()).toBeVisible();
  await expect(page.locator(".map-link")).toHaveCount(0);
});

test("share link opens the same unique stop in another browser context and survives reload", async ({
  page,
  browser,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.sharedURL = value;
        },
      },
    }),
  );
  await ready(page, deepLink(sample));
  await page.locator(".share-button").click();
  const url = await page.evaluate(() => window.sharedURL);
  expect(C.sharedId(url)).toBe(T.stopId(sample));
  const context = await browser.newContext({ serviceWorkers: "block" });
  const other = await context.newPage();
  await ready(other, url);
  await expect(other.locator(".card")).toHaveCount(1);
  await expect(other.locator(".shared-stop h3")).toHaveText(sample.停留地點);
  await expect(other.locator("#district")).toHaveValue(sample.searchDistrict);
  await other.reload();
  await expect(other.locator("#searchButton")).toBeEnabled();
  await expect(other.locator(".shared-stop")).toHaveCount(1);
  await context.close();
});

test("native share, user cancellation and clipboard denial have safe fallbacks", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (payload) => {
        window.nativePayload = payload;
      },
    }),
  );
  await ready(page, deepLink(sample));
  await page.locator(".share-button").click();
  expect(
    C.sharedId((await page.evaluate(() => window.nativePayload)).url),
  ).toBe(T.stopId(sample));
  await page.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new DOMException("cancel", "AbortError");
      },
    }),
  );
  await page.locator(".share-button").click();
  await expect(page.locator("#copyDialog")).toBeHidden();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw Error("denied");
        },
      },
    });
  });
  await page.locator(".share-button").click();
  await expect(page.locator("#copyHeading")).toHaveText("複製站點連結");
  expect(C.sharedId(await page.locator("#copyText").inputValue())).toBe(
    T.stopId(sample),
  );
});

test("missing, malformed and ambiguous share targets explicitly refuse similar replacements", async ({
  page,
}) => {
  const duplicate = [...C.identityIndex(raw).values()].find(
    (group) => group.length > 1,
  )[0];
  const changed = { ...sample, 停留時間: "01:01-01:02" };
  for (const url of [
    deepLink(changed),
    deepLink(duplicate),
    "/#stop=2.notvalid",
  ]) {
    await ready(page, url);
    await expect(page.locator(".card")).toHaveCount(0);
    await expect(page.locator(".empty-state h3")).toHaveText(
      "站點資料可能已變更",
    );
  }
  await page.locator(".empty-state button").click();
  await expect(page.locator(".card").first()).toBeVisible();
  expect(page.url()).not.toContain("#stop");
});

test("favorites export/import restores, merges, deduplicates and preserves recent searches", async ({
  page,
}) => {
  await ready(page, deepLink(sample));
  await page.click("#searchButton");
  await page.locator(".save-button").first().click();
  await page.click("#quickSavedButton");
  const recent = await page.evaluate(
    () => JSON.parse(localStorage.getItem("garbage-search-v1")).recent,
  );
  const download = page.waitForEvent("download");
  await page.click("#exportFavorites");
  const file = await (await download).path(),
    backup = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(backup.version).toBe(1);
  expect(backup.favorites).toHaveLength(1);
  expect(backup.favorites[0]).not.toHaveProperty("garbageDay");
  await page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem("garbage-search-v1"));
    value.favorites = [];
    localStorage.setItem("garbage-search-v1", JSON.stringify(value));
  });
  await page.reload();
  await expect(page.locator("#searchButton")).toBeEnabled();
  await page.click("#quickSavedButton");
  await expect(page.locator("#favoriteCount")).toHaveText("0");
  for (const expectedNew of ["新增 1", "新增 0"]) {
    await page.setInputFiles("#favoritesFile", file);
    await expect(page.locator("#favoritesPreviewText")).toContainText(
      expectedNew,
    );
    await page.click("#confirmFavoritesImport");
    await expect(page.locator("#favoriteCount")).toHaveText("1");
  }
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("garbage-search-v1")).recent,
    ),
  ).toEqual(recent);
  const unknown = T.stopId({ ...sample, 停留地點: "不存在的測試站點" });
  await page.setInputFiles(
    "#favoritesFile",
    jsonFile(C.exportFavorites([unknown])),
  );
  await expect(page.locator("#favoritesPreviewText")).toContainText(
    "1 個目前無法唯一確認",
  );
  await page.click("#confirmFavoritesImport");
  await expect(page.locator("#favoriteCount")).toHaveText("2");
  await expect(page.locator("#resultStatus")).toContainText(
    "1 個收藏目前未載入",
  );
});

test("invalid backup files and cancelled previews never erase existing favorites", async ({
  page,
}) => {
  await ready(page, deepLink(sample));
  await page.locator(".save-button").click();
  await page.click("#quickSavedButton");
  const before = await page.evaluate(() =>
    localStorage.getItem("garbage-search-v1"),
  );
  const valid = C.exportFavorites([T.stopId(sample)]);
  for (const file of [
    jsonFile("{invalid"),
    jsonFile({ ...valid, version: 99 }),
    jsonFile(" ".repeat(C.MAX_BYTES + 1)),
    jsonFile({
      ...valid,
      favorites: [{ ...valid.favorites[0], sourceFile: "../private.csv" }],
    }),
  ]) {
    await page.setInputFiles("#favoritesFile", file);
    await expect(page.locator("#favoritesImportStatus")).not.toBeEmpty();
    await expect(page.locator("#favoritesPreview")).toBeHidden();
    expect(
      await page.evaluate(() => localStorage.getItem("garbage-search-v1")),
    ).toBe(before);
  }
  await page.setInputFiles("#favoritesFile", jsonFile(valid));
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("garbage-search-v1")),
  ).toBe(before);
});

test("navigation stays hidden when geometry fails or a CSV fails its version check", async ({
  page,
}) => {
  await page.route("**/data/geo/kaohsiung.topo.json", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await ready(page, deepLink(sample));
  await expect(page.locator(".map-link")).toHaveCount(0);
  await expect(page.locator("#retryButton")).toBeVisible();
  await page.unroute("**/data/geo/kaohsiung.topo.json");
  await page.click("#retryButton");
  await expect(page.locator(".map-link")).toHaveCount(1);
  await page.route("**/sanmin-east.csv", (route) =>
    route.fulfill({
      contentType: "text/csv",
      body: fs.readFileSync("sanmin-east.csv", "utf8") + "\n",
    }),
  );
  await page.reload();
  await expect(page.locator("#searchButton")).toBeEnabled();
  await expect(page.locator("#dataStatus")).toContainText("38 / 39");
  await expect(page.locator(".shared-stop")).toHaveCount(0);
  await expect(page.locator(".empty-state h3")).toHaveText(
    "站點資料可能已變更",
  );
});

test("data information keeps official/import dates unknown and load/version timestamps separate", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#sourceInfo summary").click();
  await expect(page.locator("#sourceInfo")).toContainText("官方更新日期未提供");
  await expect(page.locator("#sourceInfo")).toContainText(
    "歷史紀錄未完整保存，無法確認",
  );
  await expect(page.locator("#siteSnapshot")).toContainText("非官方更新日");
  await expect(page.locator("#currentLoadedAt")).toContainText("台灣時間");
  await expect(page.locator("#sourceInfo")).toContainText("非即時車輛定位");
});

for (const width of [320, 390, 768])
  test.describe("convenience touch " + width, () => {
    test.use({
      viewport: { width, height: 844 },
      isMobile: width < 600,
      hasTouch: true,
    });
    test("share, navigation and backup controls fit and remain keyboard/touch accessible", async ({
      page,
    }) => {
      await ready(page, deepLink(sample));
      for (const selector of [".share-button", ".map-link", ".save-button"]) {
        const box = await page.locator(selector).boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.locator(".save-button").click();
      await page.click("#quickSavedButton");
      await expect(page.locator("#favoritesManager")).toBeVisible();
      await page.setInputFiles(
        "#favoritesFile",
        jsonFile(C.exportFavorites([T.stopId(sample)])),
      );
      await expect(page.locator("#favoritesPreview")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.locator("#confirmFavoritesImport").press("Enter");
      await expect(page.locator("#favoritesPreview")).toBeHidden();
    });
  });
