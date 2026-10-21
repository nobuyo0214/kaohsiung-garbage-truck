const { test, expect } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path"),
  Papa = require("papaparse");
const { load, parse } = require("../scripts/data-tool.cjs"),
  D = require("../js/data-core"),
  T = require("../js/search-tools");
const raw = load();
D.applyRules(raw, parse("garbage-days.csv"));
const index = T.createIndex(raw);
const { mockSnapshot } = require("./snapshot-fixture.cjs");
test.use({ timezoneId: "America/Los_Angeles" });
async function ready(page) {
  await page.goto("/");
  await expect(page.locator("#searchButton")).toBeEnabled({ timeout: 15000 });
}
async function findStop(page, keyword = "河北二路102號") {
  await page.selectOption("#district", "三民區");
  await page.fill("#keyword", keyword);
  await page.click("#searchButton");
}

test("suggestions and recent searches restore all submitted filters after a reload", async ({
  page,
}) => {
  await ready(page);
  await page.selectOption("#district", "三民區");
  await page.selectOption("#village", "建東里");
  await page.fill("#keyword", "河北二路");
  await expect(
    page.locator("#keywordSuggestions option").first(),
  ).toBeAttached();
  const names = await page
    .locator("#keywordSuggestions option")
    .evaluateAll((options) => options.map((o) => o.value));
  expect(names.length).toBeLessThanOrEqual(8);
  for (const name of names)
    expect(
      raw.some(
        (r) =>
          r.searchDistrict === "三民區" &&
          r.villageName === "建東里" &&
          r.停留地點 === name,
      ),
    ).toBe(true);
  await page.fill("#keyword", "河北二路102號");
  await page.selectOption("#weekday", "一");
  await page.selectOption("#period", "afternoon");
  await page.selectOption("#sortOrder", "desc");
  await page.click("#searchButton");
  await expect(page.locator(".card")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("#searchButton")).toBeEnabled();
  await page.locator("#recentSearches button").first().click();
  for (const [id, value] of Object.entries({
    district: "三民區",
    village: "建東里",
    keyword: "河北二路102號",
    weekday: "一",
    period: "afternoon",
    sortOrder: "desc",
  }))
    await expect(page.locator("#" + id)).toHaveValue(value);
  await expect(page.locator(".card")).toHaveCount(1);
  await page.click("#clearRecentButton");
  await page.reload();
  await expect(page.locator("#searchButton")).toBeEnabled();
  await expect(page.locator("#recentSection")).toBeHidden();
});

test("favorites distinguish trips, persist across reload and use current CSV dates across districts", async ({
  page,
}) => {
  await ready(page);
  await findStop(page, "更新街與安東街口");
  expect(await page.locator(".card").count()).toBeGreaterThanOrEqual(2);
  await page.locator(".save-button").nth(0).click();
  await page.locator(".save-button").nth(1).click();
  await expect(page.locator("#favoriteCount")).toHaveText("2");
  const prefs = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("garbage-search-v1")),
  );
  expect(prefs.favorites[0]).not.toEqual(prefs.favorites[1]);
  expect(prefs).not.toHaveProperty("garbageDay");
  // Changed recycling dates are a browser-only CSV fixture. No production CSV is edited.
  const updatedRows = parse("sanmin-west.csv").map((row) =>
    row.停留地點 === "更新街與安東街口" ? { ...row, 回收日: "三" } : row,
  );
  await mockSnapshot(page, { "sanmin-west.csv": Papa.unparse(updatedRows) });
  await page.reload();
  // Reload verifies all 39 files again; match the initial ready() deadline.
  await expect(page.locator("#searchButton")).toBeEnabled({ timeout: 15000 });
  await page.click("#quickSavedButton");
  await expect(page.locator(".card")).toHaveCount(2);
  await expect(page.locator("#filterNotice")).toContainText("所有行政區");
  // Dates are resolved again from this request's CSV, never from the preference backup.
  const bodies = await page.locator(".card").allTextContents();
  expect(bodies.every((body) => body.includes("更新街與安東街口"))).toBe(true);
  expect(
    await page.locator(".day-detail:first-child dd").allTextContents(),
  ).toEqual(["三", "三"]);
  await page.locator(".save-button").first().click();
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(page.locator("#favoriteCount")).toHaveText("1");
});

test("Taiwan today selects only recorded recycling weekdays and excludes missing recycling dates", async ({
  page,
}) => {
  // Sunday in Los Angeles, already Monday in Taiwan.
  await page.clock.setFixedTime(new Date("2026-10-18T16:05:00Z"));
  await ready(page);
  await page.selectOption("#district", "三民區");
  await page.click("#todayButton");
  await expect(page.locator("#weekday")).toHaveValue("一");
  await expect(page.locator("#dayType")).toHaveCount(0);
  await expect(page.locator(".today-bar")).toContainText("今日資源回收站點");
  const expected = index.search({
    district: "三民區",
    dayType: "recycle",
    weekday: "一",
  });
  expect(expected.length).toBeGreaterThan(0);
  await expect(page.locator("#resultStatus")).toContainText(
    "找到 " + expected.length + " 筆",
  );
  await expect(page.locator(".day-detail:first-child dd.unknown")).toHaveCount(
    0,
  );
  await page.selectOption("#district", "前鎮區");
  await page.click("#todayButton");
  const qianzhen = index.search({ district: "前鎮區", dayType: "recycle", weekday: "一" });
  await expect(page.locator("#resultStatus")).toContainText(
    "找到 " + qianzhen.length.toLocaleString("zh-TW") + " 筆",
  );
  await expect(page.locator(".day-detail dd.unknown")).toHaveCount(0);
});

test("copy includes only recycling and scheduled stop information, with a manual fallback on denied clipboard", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.copiedStop = text;
        },
      },
    }),
  );
  await ready(page);
  await page.locator(".copy-button").first().click();
  await expect(page.locator("#toast")).toContainText("已複製");
  const copied = await page.evaluate(() => window.copiedStop);
  expect(copied).not.toContain("一般垃圾");
  expect(copied).toContain("資源回收日：");
  expect(copied).toContain("停留時間：");
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw Error("denied");
    };
  });
  await page.locator(".copy-button").first().click();
  await expect(page.locator("#copyDialog")).toBeVisible();
  await expect(page.locator("#copyText")).toHaveValue(copied);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator("#copyDialog")).toBeHidden();
});

test("partial failures retry only failed files, preserve bookmarks and keep the full raw inventory", async ({
  page,
}) => {
  let failed = true;
  const counts = new Map();
  await page.route(/\.csv$/, (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    counts.set(name, (counts.get(name) || 0) + 1);
    if (failed && ["maolin.csv", "garbage-days.csv"].includes(name))
      return route.fulfill({ status: 503, body: "unavailable" });
    return route.continue();
  });
  await ready(page);
  await expect(page.locator("#dataStatus")).toContainText("38 / 39");
  await page.selectOption("#district", "大寮區");
  await page.click("#searchButton");
  await expect(page.locator("#resultStatus")).toContainText("212 筆");
  await page.locator(".save-button").first().click();
  failed = false;
  await page.click("#retryButton");
  await expect(page.locator("#dataStatus")).toContainText("39 / 39");
  await expect(page.locator("#dataStatus")).toContainText("13,871");
  await expect(page.locator("#dataStatus")).toContainText("資料版本檢查完成");
  await expect(page.locator("#favoriteCount")).toHaveText("1");
  expect(counts.size).toBe(40);
  for (const [name, count] of counts)
    expect(count).toBe(
      ["maolin.csv", "garbage-days.csv"].includes(name) ? 2 : 1,
    );
  await expect(page.locator("#retryButton")).toBeHidden();
});

test("a complete network failure remains recoverable without a false empty-search conclusion", async ({
  page,
}) => {
  await page.route(/\.csv$/, (route) => route.abort("failed"));
  await page.goto("/");
  await expect(page.locator("#retryButton")).toBeVisible();
  await expect(page.locator("#searchButton")).toBeDisabled();
  await expect(page.locator(".empty-state")).toContainText("暫時無法載入");
  await expect(page.locator("#filterNotice")).toContainText("不表示沒有停靠站");
  await page.unroute(/\.csv$/);
  await page.click("#retryButton");
  await expect(page.locator("#searchButton")).toBeEnabled();
  await expect(page.locator("#dataStatus")).toContainText("39 / 39");
});

test("blocked browser storage preserves usable search and in-memory favorites", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw Error("blocked");
    };
    Storage.prototype.setItem = () => {
      throw Error("quota");
    };
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await findStop(page);
  await expect(page.locator(".card")).toHaveCount(1);
  await page.locator(".save-button").click();
  await expect(page.locator("#favoriteCount")).toHaveText("1");
  await expect(page.locator("#toast")).toContainText("無法保存");
  await page.click("#viewSavedButton");
  await expect(page.locator(".card")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("literal CSV content cannot inject markup into suggestions, cards or copy dialog", async ({
  page,
}) => {
  const place = '<img src=x onerror="window.injected=true">';
  await mockSnapshot(page, {
    "garbage-truck.csv": Papa.unparse([
      {
        責任區: "一",
        車次: "1",
        停留地點: place,
        停留時間: "12:00",
        行政區: "前鎮區",
        村里: "",
        回收日: "",
      },
    ]),
  });
  await ready(page);
  await expect(page.locator(".card h3")).toHaveText(place);
  await expect(page.locator("#results img")).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.fill("#keyword", "<img");
  await expect(page.locator("#keywordSuggestions option")).toHaveAttribute(
    "value",
    place,
  );
  await page.fill("#keyword", "完全不存在的地點");
  await page.click("#searchButton");
  await expect(page.locator(".card")).toHaveCount(0);
  await expect(page.locator(".empty-state")).toContainText("較短的街道名稱");
  await page.locator(".empty-state button").click();
  await expect(page.locator(".card")).toHaveCount(1);
});

test("all assets and CSVs resolve under a GitHub Pages subdirectory without CDN access", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.route("**/pages-preview/**", async (route) => {
    const relative =
      new URL(route.request().url()).pathname.replace(
        /^\/pages-preview\//,
        "",
      ) || "index.html";
    const file = path.resolve(__dirname, "..", relative),
      extension = path.extname(file);
    await route.fulfill({
      path: file,
      contentType: {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "text/javascript",
        ".csv": "text/csv",
      }[extension],
    });
  });
  await page.goto("/pages-preview/");
  await expect(page.locator("#searchButton")).toBeEnabled();
  await expect(page.locator("#dataStatus")).toContainText("39 / 39");
  expect(
    requests.every((url) =>
      url.startsWith("http://127.0.0.1:4173/pages-preview/"),
    ),
  ).toBe(true);
});

for (const width of [320, 390, 768]) {
  test.describe("responsive width " + width, () => {
    test.use({
      viewport: { width, height: 844 },
      isMobile: width < 600,
      hasTouch: true,
    });
    test("search, optional filters, favorite and copy remain readable without horizontal scrolling", async ({
      page,
    }) => {
      await ready(page);
      if (width < 600)
        await expect(page.locator("#advancedFilters")).not.toHaveAttribute(
          "open",
          "",
        );
      await page.selectOption("#district", "三民區");
      await page.fill("#keyword", "河北二路102號");
      await page.locator("#keyword").press("Enter");
      await expect(page.locator(".card")).toHaveCount(1);
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        time: parseFloat(
          getComputedStyle(document.querySelector(".stop-time")).fontSize,
        ),
      }));
      expect(layout.scroll).toBeLessThanOrEqual(layout.width);
      expect(layout.time).toBeGreaterThanOrEqual(24);
      await page.locator(".save-button").click();
      await expect(page.locator("#favoriteCount")).toHaveText("1");
      await page.click("#quickSavedButton");
      await expect(page.locator("#viewSavedButton")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.locator(".card")).toHaveCount(1);
      if (width < 600) await page.locator("#advancedFilters summary").click();
      await page.selectOption("#sortOrder", "desc");
      await page.click("#searchButton");
      await expect(page.locator(".card .stop-time")).toHaveText("16:19–16:22");
      const copy = await page.locator(".copy-button").boundingBox();
      expect(copy.height).toBeGreaterThanOrEqual(44);
      await page.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async () => {
              throw Error("denied");
            },
          },
        }),
      );
      await page.locator(".copy-button").click();
      await expect(page.locator("#copyDialog")).toBeVisible();
      expect(await page.locator("#copyText").inputValue()).toContain(
        "16:19-16:22",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole("button", { name: "完成", exact: true }).click();
    });
  });
}
