const { test, expect } = require("@playwright/test");
const Papa = require("papaparse"),
  { load } = require("../scripts/data-tool.cjs"),
  C = require("../js/convenience-core"), T = require("../js/search-tools"),
  { mockSnapshot } = require("./snapshot-fixture.cjs");
const rows = load(),
  known = rows.find(r => r.停留地點 === "河北二路102號"),
  missing = rows.find(r => !r.recycleDay && C.shareable(T.stopId(r), C.identityIndex(rows)));
const deepLink = row => C.shareURL(T.stopId(row), "http://127.0.0.1:4173/");
async function ready(page, url = "/") {
  await page.goto(url);
  await expect(page.locator("#searchButton")).toBeEnabled({ timeout: 15000 });
}
async function recyclingOnlyCard(page, expectedDay) {
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(page.locator(".day-detail dt")).toHaveText("資源回收日");
  await expect(page.locator(".day-detail dd")).toHaveText(expectedDay);
  await expect(page.locator(".route-meta")).toHaveCount(0);
  expect(await page.locator(".card").textContent()).not.toMatch(/一般垃圾(?:日|清運日)/);
}

test("search, saved and old share links show only recycling, including explicit missing labels and copy fallback", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", {
    configurable: true, value: { writeText: async text => { window.copyValue = text; } },
  }));
  const url = deepLink(known);
  await ready(page, url);
  await expect(page.locator("#dayType")).toHaveCount(0);
  expect(await page.locator("label[for=weekday]").textContent()).toBe("資源回收星期");
  expect(await page.locator("#weekday option").count()).toBe(8);
  await recyclingOnlyCard(page, known.recycleDay);
  await page.locator(".save-button").click();
  await page.click("#quickSavedButton");
  await recyclingOnlyCard(page, known.recycleDay);
  await page.locator(".copy-button").click();
  const copied = await page.evaluate(() => window.copyValue);
  expect(copied).toContain("資源回收日：" + known.recycleDay);
  expect(copied).toContain("表定停留時間：" + known.停留時間);
  expect(copied).not.toContain("一般垃圾");
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw Error("denied"); }; });
  await page.locator(".copy-button").click();
  await expect(page.locator("#copyText")).toHaveValue(copied);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await ready(page, url);
  await recyclingOnlyCard(page, known.recycleDay);
  await expect(page.locator("#favoriteCount")).toHaveText("1");
  await ready(page, deepLink(missing));
  await recyclingOnlyCard(page, "資源回收日尚未提供");
  await page.locator("#sourceInfo summary").click();
  await expect(page.locator("#sourceInfo")).toContainText("資源回收日不代表一般垃圾清運星期");
  expect(await page.locator("body").textContent()).not.toMatch(/一般垃圾日期尚未提供|一般垃圾清運日|一般垃圾日：/);
});

test("legacy garbage weekdays are disclosed and cleared without conversion, history mutation or lost favorites", async ({ page }) => {
  const old = { district: "三民區", village: known.villageName, keyword: known.停留地點,
    dayType: "garbage", weekday: "五", period: "afternoon", sortOrder: "desc" };
  const preferences = { version: 1, favorites: [T.stopId(known)], recent: [old] },
    serialized = JSON.stringify(preferences);
  await page.addInitScript(value => {
    if (!localStorage.getItem("garbage-search-v1")) localStorage.setItem("garbage-search-v1", value);
  }, serialized);
  await ready(page);
  await expect(page.locator("#recentSearches button")).toContainText("舊星期條件已停用");
  await page.locator("#recentSearches button").click();
  for (const id of ["district", "village", "keyword", "period", "sortOrder"])
    await expect(page.locator("#" + id)).toHaveValue(old[id]);
  await expect(page.locator("#weekday")).toHaveValue("");
  await expect(page.locator("#filterNotice")).toContainText("未套用原星期");
  await expect(page.locator("#filterNotice")).toContainText("請重新選擇資源回收星期");
  await expect(page.locator("#weekday")).toBeFocused();
  await recyclingOnlyCard(page, known.recycleDay);
  expect(await page.evaluate(() => localStorage.getItem("garbage-search-v1"))).toBe(serialized);
  await page.selectOption("#weekday", "四");
  await page.click("#searchButton");
  await expect(page.locator("#filterNotice")).not.toContainText("舊搜尋");
  const current = await page.evaluate(() => JSON.parse(localStorage.getItem("garbage-search-v1")));
  expect(current.favorites).toEqual(preferences.favorites);
  expect(current.recent[0]).toMatchObject({ dayType: "recycle", weekday: "四" });
  expect(current.recent).toContainEqual(old);
  await page.reload();
  await expect(page.locator("#searchButton")).toBeEnabled({ timeout: 15000 });
  await page.locator("#recentSearches button").first().click();
  await expect(page.locator("#weekday")).toHaveValue("四");
  await recyclingOnlyCard(page, known.recycleDay);
  await page.click("#clearRecentButton");
  await expect(page.locator("#favoriteCount")).toHaveText("1");
});

test("today uses Taiwan recycling data even when retained general-garbage dates disagree or recycling is missing", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-18T16:05:00Z"));
  const fields = ["責任區", "車次", "停留地點", "停留時間", "行政區", "村里", "回收日", "一般垃圾日", "經度", "緯度"];
  const fixture = [
    { ...known, 停留地點: "PR9回收站", 回收日: "一", 一般垃圾日: "四" },
    { ...known, 停留地點: "PR9其他星期站", 回收日: "四", 一般垃圾日: "一" },
    { ...known, 停留地點: "PR9缺少回收站", 回收日: "", 一般垃圾日: "一" },
  ];
  await mockSnapshot(page, {
    "sanmin-east.csv": Papa.unparse({ fields, data: fixture.map(row => fields.map(key => row[key] || "")) }),
    "sanmin-west.csv": fields.join(",") + "\n",
  });
  await ready(page);
  await page.selectOption("#district", "三民區");
  await expect(page.locator(".card")).toHaveCount(3);
  await expect(page.locator(".day-detail dd.unknown")).toHaveText("資源回收日尚未提供");
  await page.click("#todayButton");
  await expect(page.locator("#weekday")).toHaveValue("一");
  await expect(page.locator("#todayLabel")).toContainText("資源回收日");
  await expect(page.locator(".card h3")).toHaveText("PR9回收站");
  await recyclingOnlyCard(page, "一");
  await page.selectOption("#weekday", "四");
  await page.click("#searchButton");
  await expect(page.locator(".card h3")).toHaveText("PR9其他星期站");
  await page.selectOption("#weekday", "日");
  await page.click("#searchButton");
  await expect(page.locator(".card")).toHaveCount(0);
  await expect(page.locator(".empty-state h3")).toHaveText("沒有符合的資源回收站點");
  await expect(page.locator(".empty-state")).toContainText("不表示沒有垃圾車");
});
