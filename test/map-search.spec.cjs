const { test, expect } = require("@playwright/test");
const fs = require("node:fs"), Papa = require("papaparse"),
  C = require("../js/convenience-core"), T = require("../js/search-tools"),
  L = require("../js/location-quality"), { load } = require("../scripts/data-tool.cjs"),
  { mockSnapshot } = require("./snapshot-fixture.cjs");
const raw = load(), identities = C.identityIndex(raw),
  audit = L.analyze(raw, require("../data/geo/kaohsiung.topo.json"));
const uncertain = audit.records.find(r => !r.eligible &&
  C.mapSearchURL(r.row.searchDistrict, r.row.停留地點) && C.shareable(r.id, identities)).row;
const reliable = audit.records.find(r => r.eligible && C.shareable(r.id, identities)).row;
const link = row => C.shareURL(T.stopId(row), "http://127.0.0.1:4173/");
async function ready(page, row) {
  await page.goto(link(row));
  await expect(page.locator("#searchButton")).toBeEnabled({ timeout: 15000 });
  await expect(page.locator(".shared-stop")).toHaveCount(1);
}

test("unverified places open only an encoded text search, while reliable cards keep coordinate navigation", async ({ page }) => {
  await ready(page, uncertain);
  await expect(page.locator(".map-link")).toHaveCount(0);
  const search = page.locator(".place-search-link");
  await expect(search).toHaveText("在 Google Maps 搜尋地點 ↗");
  await expect(search).toHaveAttribute("rel", "noopener noreferrer");
  await expect(search).toHaveAttribute("target", "_blank");
  await expect(search).toHaveAttribute("aria-label", /搜尋結果不代表已核實的停靠位置/);
  await expect(page.locator(".map-search-note")).toHaveText(
    "位置尚待確認；搜尋結果不代表已核實的停靠位置。",
  );
  const target = await search.getAttribute("href"), url = new URL(target);
  expect(url.pathname).toBe("/maps/search/");
  expect([...url.searchParams]).toEqual([
    ["api", "1"], ["query", "高雄市 " + uncertain.searchDistrict + " " + uncertain.停留地點],
  ]);
  // Test the actual new-tab click without contacting Google or relying on map results.
  await page.context().route("https://www.google.com/maps/search/**", route =>
    route.fulfill({ contentType: "text/html", body: "<title>Map text search fixture</title>" }));
  const opened = page.waitForEvent("popup");
  await search.click();
  const popup = await opened;
  await expect(popup).toHaveURL(target);
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await popup.close();
  await expect(page.locator(".map-search-note")).toBeVisible();
  await page.reload();
  await expect(search).toHaveAttribute("href", target);

  await ready(page, reliable);
  await expect(page.locator(".place-search-link")).toHaveCount(0);
  await expect(page.locator(".map-search-note")).toHaveCount(0);
  const navigation = new URL(await page.locator(".map-link").getAttribute("href"));
  expect(navigation.pathname).toBe("/maps/dir/");
  expect(navigation.searchParams.get("destination")).toBe(reliable.緯度 + "," + reliable.經度);
});

test("vague place text stays unavailable without a search or navigation button", async ({ page }) => {
  const row = { ...reliable, sourceFile: "sanmin-east.csv", searchDistrict: "三民區",
    行政區: "三民東區", 停留地點: "市場前", 經度: "", 緯度: "" };
  const fields = Papa.parse(fs.readFileSync("sanmin-east.csv", "utf8"), { header: true }).meta.fields;
  await mockSnapshot(page, { "sanmin-east.csv": Papa.unparse({
    fields, data: [fields.map(key => row[key] || "")],
  }) });
  await ready(page, row);
  await expect(page.locator(".map-link, .place-search-link")).toHaveCount(0);
  await expect(page.locator(".location-unknown")).toHaveText("位置尚待確認");
  await expect(page.locator(".share-button")).toBeEnabled();
});

for (const width of [320, 390, 768])
  test.describe("map search touch " + width, () => {
    test.use({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: true });
    test("compact fallback has a visible notice, accessible link and no overflow", async ({ page }) => {
      await ready(page, uncertain);
      const search = page.locator(".place-search-link"), box = await search.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await expect(page.locator(".map-search-note")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator(".share-button").focus();
      await page.keyboard.press("Tab");
      await expect(search).toBeFocused();
      const outline = await search.evaluate(el => getComputedStyle(el).outlineStyle);
      expect(outline).toBe("solid");
      await expect(page.locator(".stop-actions > button, .stop-actions > a")).toHaveCount(2);
    });
  });
