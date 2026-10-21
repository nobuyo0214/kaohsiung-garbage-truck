const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const Papa = require("papaparse");
const D = require("../js/data-core");
const { load, parse } = require("../scripts/data-tool.cjs");
const rows = load();
test.beforeEach(async ({ page }) => {
  // Use the same pinned Papa Parse offline; tests need no live government/CDN access.
  await page.route(
    "https://cdn.jsdelivr.net/npm/papaparse@5.5.3/papaparse.min.js",
    (route) =>
      route.fulfill({
        path: require.resolve("papaparse/papaparse.min.js"),
        contentType: "text/javascript",
      }),
  );
});
test("real homepage loads all files and searches all 38 districts with pagination", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#searchButton")).toBeEnabled({ timeout: 15000 });
  await expect(page.locator("#dataStatus")).toContainText("39 / 39");
  await expect(page.locator("#dataStatus")).toContainText("資料版本檢查完成");
  await expect(page.locator("#dayType")).toHaveCount(0);
  const districts = await page
    .locator("#district option")
    .evaluateAll((options) => options.map((o) => o.value));
  expect(districts).toHaveLength(38);
  for (const district of districts) {
    await page.selectOption("#district", district);
    await page.click("#searchButton");
    // Three existing duplicate identities have identical displayed content. Raw CSVs stay unchanged.
    const count =
      rows.filter((r) => r.searchDistrict === district).length -
      ({ 鳳山區: 1, 彌陀區: 1, 小港區: 1 }[district] || 0);
    await expect(page.locator("#resultStatus")).toContainText(
      `找到 ${count.toLocaleString("zh-TW")} 筆`,
    );
    await expect(page.locator(".card")).toHaveCount(Math.min(30, count));
  }
  await page.selectOption("#district", "三民區");
  await page.fill("#keyword", "河北二路102號");
  await page.click("#searchButton");
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(page.locator(".day-detail dd")).toHaveText("一、四");
  await page.selectOption("#village", "建東里");
  await page.selectOption("#weekday", "三");
  await page.click("#searchButton");
  await expect(page.locator(".card")).toHaveCount(0);
  await page.selectOption("#weekday", "一");
  await page.selectOption("#period", "night");
  await page.click("#searchButton");
  await expect(page.locator(".card")).toHaveCount(0);
  await page.selectOption("#period", "afternoon");
  await page.click("#searchButton");
  await expect(page.locator(".card")).toHaveCount(1);
  await page.click("#resetButton");
  await page.click("#searchButton");
  await page.click("#moreButton");
  await expect(page.locator(".card")).toHaveCount(60);
  expect(errors).toEqual([]);
});
test("missing date map and one failed route preserve other districts and usable search", async ({
  page,
}) => {
  await page.route("**/garbage-days.csv", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await page.route("**/maolin.csv", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await page.goto("/");
  await expect(page.locator("#searchButton")).toBeEnabled({ timeout: 15000 });
  await expect(page.locator("#dataStatus")).toContainText("38 / 39");
  await page.selectOption("#district", "大寮區");
  await page.click("#searchButton");
  await expect(page.locator("#resultStatus")).toContainText("212 筆");
});
test("official batch UI exports review for real arrival-only snapshot and preserves every old rule", async ({
  page,
}) => {
  await page.goto("/official-day-matcher.html");
  await page.getByText("改用其他官方資料 CSV", { exact: true }).click();
  await page.setInputFiles("#official", "data/official/sanmin-west.csv");
  await page.click("#run");
  await expect(page.locator("#status")).toContainText("比對完成");
  await expect(page.locator("#summary")).toContainText('"新增候選": 0');
  await expect(page.locator("#summary")).toContainText('"待審核": 179');
  const downloadPromise = page.waitForEvent("download");
  await page.click("#proposed");
  const download = await downloadPromise;
  const exported = Papa.parse(fs.readFileSync(await download.path(), "utf8"), {
    header: true,
    skipEmptyLines: "greedy",
  }).data;
  expect(exported).toEqual(parse("garbage-days.csv"));
});
test("organizer fails closed on missing old rules, succeeds when every file is available", async ({
  page,
}) => {
  await page.goto("/route-organizer.html");
  await page.click("#start");
  await expect(page.locator("#downloadMap")).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await page.click("#downloadMap");
  const exported = Papa.parse(
    fs.readFileSync(await (await downloadPromise).path(), "utf8"),
    { header: true, skipEmptyLines: "greedy" },
  ).data;
  const keys = new Map(exported.map((r) => [D.key(r), r["一般垃圾日"]]));
  for (const rule of parse("garbage-days.csv"))
    expect(keys.get(D.key(rule))).toBe(rule["一般垃圾日"]);
  await page.route("**/garbage-days.csv", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await page.click("#start");
  await expect(page.locator("#message")).toContainText("整理失敗");
  await expect(page.locator("#downloadMap")).toBeDisabled();
});
test("manual review rejects partial times and confirms unique raw five-field identity", async ({
  page,
}) => {
  await page.goto("/garbage-day-review.html");
  await page.setInputFiles("#inventoryFile", "reports/route-inventory.csv");
  await page.click("#loadBtn");
  await expect(page.locator("#loadStatus")).toContainText("保留 243");
  await expect(page.locator('#district option[value="大寮區"]')).toHaveCount(1);
  await page.selectOption("#district", "三民區");
  await page.fill("#search", "河北二路102號");
  await page.locator("#routeRows tr").first().click();
  await page.fill("#stopPlace", "河北二路102號");
  await page.fill("#stopTime", "16:19");
  await page.fill("#days", "一、二、四、五、六");
  await page.fill("#source", "https://data.kcg.gov.tw/");
  await page.check("#verified");
  await page.click("#addBtn");
  await expect(page.locator("#validation")).toContainText("唯一、完整五欄");
  await page.fill("#stopTime", "16:19-16:22");
  await page.click("#addBtn");
  await expect(page.locator("#validation")).toContainText("此規則已存在");
});

test("organizer refuses a conflicting old date map instead of deleting the rule", async ({
  page,
}) => {
  const old = parse("garbage-days.csv");
  await page.route("**/garbage-days.csv", (route) =>
    route.fulfill({
      contentType: "text/csv",
      body: Papa.unparse([...old, { ...old[0], 一般垃圾日: "三" }]),
    }),
  );
  await page.goto("/route-organizer.html");
  await page.click("#start");
  await expect(page.locator("#message")).toContainText("衝突");
  await expect(page.locator("#downloadMap")).toBeDisabled();
});
