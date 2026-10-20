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
  await expect(page.locator("#searchButton")).toBeEnabled();
  await expect(page.locator("#dataStatus")).toContainText("39 / 39");
  await expect(page.locator("#dataStatus")).toContainText("243 條規則");
  const districts = await page
    .locator("#district option")
    .evaluateAll((options) => options.map((o) => o.value));
  expect(districts).toHaveLength(38);
  for (const district of districts) {
    await page.selectOption("#district", district);
    await page.click("#searchButton");
    const count = rows.filter((r) => r.searchDistrict === district).length;
    await expect(page.locator("#resultStatus")).toContainText(
      `找到 ${count.toLocaleString("zh-TW")} 筆`,
    );
    await expect(page.locator(".card")).toHaveCount(Math.min(30, count));
  }
  await page.selectOption("#district", "三民區");
  await page.fill("#keyword", "河北二路102號");
  await page.click("#searchButton");
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(page.locator(".card")).toContainText("一、二、四、五、六");
  await page.selectOption("#village", "建東里");
  await page.selectOption("#dayType", "garbage");
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
  await expect(page.locator("#searchButton")).toBeEnabled();
  await expect(page.locator("#dataStatus")).toContainText("38 / 39");
  await page.selectOption("#district", "大寮區");
  await page.click("#searchButton");
  await expect(page.locator("#resultStatus")).toContainText("212 筆");
});
test("official batch UI exports review for real arrival-only snapshot and preserves every old rule", async ({
  page,
}) => {
  await page.goto("/official-day-matcher.html");
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

// Synthetic official assertions below are browser fixtures, never production additions.
const reviewRow = rows.find(
  (r) =>
    D.validRule({
      ...r,
      來源檔案: r.sourceFile,
      一般垃圾日: "一、四",
      官方來源: "https://data.kcg.gov.tw/",
    }) &&
    !r.garbageDay &&
    !parse("garbage-days.csv").some((o) => D.key(o) === D.key(r)) &&
    rows.filter((o) => D.key(o) === D.key(r)).length === 1,
);
function fixtureOfficial(extra = {}) {
  return Object.fromEntries(
    [...D.HEADERS, "來源紀錄ID", "官方路線名稱", "行政區"]
      .map((h) => [
        h,
        h === "來源檔案"
          ? reviewRow.sourceFile
          : h === "一般垃圾日"
            ? "一、四"
            : h === "官方來源"
              ? "https://data.kcg.gov.tw/"
              : h === "來源紀錄ID"
                ? "browser-fixture-record"
                : h === "官方路線名稱"
                  ? "測試路線"
                  : h === "行政區"
                    ? reviewRow.searchDistrict
                    : reviewRow[h] || "",
      ])
      .map(([k, v]) => [k, Object.hasOwn(extra, k) ? extra[k] : v]),
  );
}
async function uploadOfficial(page, records) {
  await page.setInputFiles("#official", {
    name: "synthetic-official.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(Papa.unparse(records)),
  });
  await page.click("#run");
  await expect(page.locator("#status")).toContainText("比對完成");
}
async function downloadedRows(page, id) {
  const p = page.waitForEvent("download");
  await page.click(id);
  return Papa.parse(fs.readFileSync(await (await p).path(), "utf8"), {
    header: true,
    skipEmptyLines: "greedy",
  }).data;
}

test("review workbench confirms exact evidence only after review and restores it from JSON", async ({
  page,
}) => {
  await page.goto("/official-day-matcher.html");
  await uploadOfficial(page, [fixtureOfficial()]);
  expect((await downloadedRows(page, "#proposed")).length).toBe(243);
  await page.fill("#reason", "官方五欄完整一致並核實一般垃圾日的測試依據");
  await page.check("#verified");
  await expect(page.locator("#confirm")).toBeEnabled();
  await page.click("#confirm");
  await expect(page.locator("#summary")).toContainText('"已確認": 1');
  const proposed = await downloadedRows(page, "#proposed");
  expect(proposed).toHaveLength(244);
  expect(proposed.slice(0, 243)).toEqual(parse("garbage-days.csv"));
  const sessionPromise = page.waitForEvent("download");
  await page.click("#exportSession");
  const sessionData = fs.readFileSync(await (await sessionPromise).path());
  await page.reload();
  await page.click("#restoreLocal");
  await expect(page.locator("#summary")).toContainText('"已確認": 1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.setInputFiles("#sessionFile", {
    name: "progress.json",
    mimeType: "application/json",
    buffer: sessionData,
  });
  await page.click("#importSession");
  await expect(page.locator("#summary")).toContainText('"已確認": 1');
  expect((await downloadedRows(page, "#proposed")).length).toBe(244);
});

test("mismatched arrival-only candidate needs linked supplementary proof and keeps rejection history", async ({
  page,
}) => {
  await page.goto("/official-day-matcher.html");
  const official = fixtureOfficial({
    車次: "",
    停留時間: D.normalizeTime(reviewRow["停留時間"]).split("-")[0],
  });
  await uploadOfficial(page, [official]);
  await page.fill("#reason", "目前只有到點時間且無車次證據所以先拒絕");
  await page.check("#verified");
  await expect(page.locator("#confirm")).toBeDisabled();
  await page.click("#reject");
  await expect(page.locator("#summary")).toContainText('"已拒絕": 1');
  await page.reload();
  await page.click("#restoreLocal");
  await expect(page.locator("#reason")).toHaveValue(
    "目前只有到點時間且無車次證據所以先拒絕",
  );
  await page.click("#reopen");
  await page.setInputFiles("#supportFile", {
    name: "synthetic-support.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      Papa.unparse([
        {
          ...fixtureOfficial({ 來源紀錄ID: "browser-support-record" }),
          對應來源紀錄ID: "browser-fixture-record",
        },
      ]),
    ),
  });
  await page.click("#loadSupport");
  await page.fill("#reason", "補充的官方時段及班次完整支持五欄對應的測試依據");
  await page.check("#verified");
  await expect(page.locator("#confirm")).toBeEnabled();
  await page.click("#confirm");
  expect((await downloadedRows(page, "#proposed")).length).toBe(244);
});

test("pilot filters by district/route with pagination and keeps cached evidence pending", async ({
  page,
}) => {
  await page.goto("/official-day-matcher.html");
  await page.click("#loadPilot");
  await expect(page.locator("#status")).toContainText("比對完成", {
    timeout: 15000,
  });
  await expect(page.locator("#summary")).toContainText('"官方筆數": 503');
  await page.selectOption("#reviewDistrict", "岡山區");
  await expect(page.locator("#listStatus")).toContainText("符合 66 筆");
  await expect(page.locator("#rows tr")).toHaveCount(40);
  await page.click("#next");
  await expect(page.locator("#rows tr")).toHaveCount(26);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const route = await page
    .locator("#reviewRoute option")
    .nth(1)
    .getAttribute("value");
  await page.selectOption("#reviewRoute", route);
  await expect(page.locator("#rows tr")).toHaveCount(40);
  await page.locator("#rows button").first().click();
  await page.check("#verified");
  await expect(page.locator("#confirm")).toBeDisabled();
  expect((await downloadedRows(page, "#proposed")).length).toBe(243);
});

test("restored approval is blocked when the current raw stop changes", async ({
  page,
}) => {
  await page.goto("/official-day-matcher.html");
  await uploadOfficial(page, [fixtureOfficial()]);
  await page.fill("#reason", "官方五欄完整一致並核實一般垃圾日的測試依據");
  await page.check("#verified");
  await page.click("#confirm");
  await page.route("**/" + reviewRow.sourceFile, (route) => {
    const csv = parse(reviewRow.sourceFile);
    const changed = csv.map((r) =>
      D.key({ ...r, 來源檔案: reviewRow.sourceFile }) === D.key(reviewRow)
        ? { ...r, 停留時間: "00:01-00:02" }
        : r,
    );
    return route.fulfill({
      contentType: "text/csv",
      body: Papa.unparse(changed),
    });
  });
  await page.reload();
  await page.click("#restoreLocal");
  await expect(page.locator("#proposed")).toBeDisabled();
  await expect(page.locator("#validation")).toContainText("已變更");
});

test("proposal export reloads current confirmed rules and fails closed on a read error", async ({
  page,
}) => {
  await page.goto("/official-day-matcher.html");
  await uploadOfficial(page, [fixtureOfficial()]);
  await page.fill("#reason", "官方五欄完整一致並核實一般垃圾日的測試依據");
  await page.check("#verified");
  await page.click("#confirm");
  const another = rows.find(
    (r) =>
      D.key(r) !== D.key(reviewRow) &&
      r["責任區"] &&
      r["車次"] &&
      D.normalizeTime(r["停留時間"]) &&
      !parse("garbage-days.csv").some((e) => D.key(e) === D.key(r)),
  );
  const extra = Object.fromEntries(
    D.HEADERS.map((h) => [
      h,
      h === "來源檔案"
        ? another.sourceFile
        : h === "一般垃圾日"
          ? "一、四"
          : h === "官方來源"
            ? "https://data.kcg.gov.tw/"
            : another[h],
    ]),
  );
  await page.route("**/garbage-days.csv", (route) =>
    route.fulfill({
      contentType: "text/csv",
      body: Papa.unparse([...parse("garbage-days.csv"), extra]),
    }),
  );
  const proposal = await downloadedRows(page, "#proposed");
  expect(proposal).toHaveLength(245);
  expect(proposal.slice(0, 244)).toEqual([...parse("garbage-days.csv"), extra]);
  await page.route("**/garbage-days.csv", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page.click("#proposed");
  await expect(page.locator("#validation")).toContainText("停止匯出");
  await expect(page.locator("#proposed")).toBeDisabled();
});
