const { test, expect } = require("@playwright/test"),
  fs = require("node:fs"),
  Papa = require("papaparse");
const { parse } = require("../scripts/data-tool.cjs");
const legacy = () => ({
  ...require("./fixtures/review-v3-four-marks.json"),
  officialRows: parse("data/official/sanmin-west.csv"),
  evidenceRows: [],
  decisions: {},
});
test.beforeEach(async ({ page }) => {
  await page.route(
    "https://cdn.jsdelivr.net/npm/papaparse@5.5.3/papaparse.min.js",
    (r) =>
      r.fulfill({
        path: require.resolve("papaparse/papaparse.min.js"),
        contentType: "text/javascript",
      }),
  );
});
async function restore(page) {
  await page.goto("/official-day-matcher.html");
  await page.setInputFiles("#session", {
    name: "official-review-progress.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacy())),
  });
  await expect(page.locator("#status")).toContainText("已恢復備份");
}
async function exportText(page, id) {
  const p = page.waitForEvent("download");
  await page.click(id);
  return fs.readFileSync(await (await p).path(), "utf8");
}
async function apply(page) {
  await page.click("#batch-select");
  await page.fill(
    "#batch-reason",
    "地點與到點一致，僅接受建議，仍缺官方車次與完整時段，日期繼續待查",
  );
  await page.click("#batch-preview-button");
  await expect(page.locator("#batch-preview-summary")).toContainText(
    "新增日期 0 筆",
  );
  await expect(page.locator("#batch-apply")).toBeDisabled();
  await page.check("#batch-attest");
  await page.click("#batch-apply");
}
test("imports real v3 shape, preserves four, shows full route and batch review adds no dates; backup undo survives restore", async ({
  page,
}) => {
  await restore(page);
  await expect(page.locator("#review-counts")).toContainText("已接受 4");
  await expect(page.locator("#review-counts")).toContainText("待處理 175");
  await page.locator("#route-batch-panel").evaluate((e) => (e.open = true));
  await expect(page.locator("#group-rows tr")).toHaveCount(69);
  await expect(page.locator("#group-rows")).toContainText("#102");
  await expect(
    page.locator('#group-rows input[data-sequence="99"]'),
  ).toBeDisabled();
  await expect(page.locator("#group-summary")).toContainText(
    "可批次選取 13 筆",
  );
  await apply(page);
  await expect(page.locator("#batch-status")).toContainText("已接受 13 筆");
  await expect(page.locator("#review-counts")).toContainText("已接受 17");
  const after = JSON.parse(await exportText(page, "#backup"));
  expect(after.batchHistory).toHaveLength(1);
  expect(after.decisions).toEqual({});
  expect(after.evidenceRows).toEqual([]);
  for (const [k, v] of Object.entries(legacy().marks))
    expect(after.marks[k]).toEqual(v);
  const old = parse("garbage-days.csv");
  expect(
    Papa.parse(await exportText(page, "#proposed"), {
      header: true,
      skipEmptyLines: "greedy",
    }).data,
  ).toEqual(old);
  await page.reload();
  await page.click("#restore");
  await expect(page.locator("#status")).toContainText("已恢復備份");
  await page.locator("#route-batch-panel").evaluate((e) => (e.open = true));
  await expect(page.locator("#batch-history option")).toHaveCount(1);
  await page.click("#batch-undo");
  await expect(page.locator("#batch-status")).toContainText("已撤銷 13 筆");
  await expect(page.locator("#review-counts")).toContainText("已接受 4");
  const undone = JSON.parse(await exportText(page, "#backup"));
  expect(undone.marks).toEqual(legacy().marks);
  expect(undone.batchHistory[0].undone).toBe(true);
});
test("single rejection after a batch survives batch undo and remains individually editable", async ({
  page,
}) => {
  await restore(page);
  await page.locator("#route-batch-panel").evaluate((e) => (e.open = true));
  await apply(page);
  const state = JSON.parse(await exportText(page, "#backup")),
    change = state.batchHistory[0].changes[0];
  const seq =
    state.officialRows.findIndex(
      (x) =>
        JSON.stringify(Object.fromEntries(Object.entries(x).sort())) ===
        change.after.recordFingerprint,
    ) + 1;
  expect(seq).toBeGreaterThan(0);
  await page.selectOption("#record", String(seq));
  await page.fill(
    "#reason",
    "批次後逐筆查證仍有疑慮，先拒絕此候選並保留官方證據缺口",
  );
  await page.click("#reject");
  await page.click("#batch-undo");
  await expect(page.locator("#batch-status")).toContainText(
    "1 筆因後續逐筆修改",
  );
  await page.selectOption("#record", String(seq));
  await expect(page.locator("#candidate-state")).toContainText("已拒絕");
  await expect(page.locator("#review-counts")).toContainText(
    "候選組數：接受 4、拒絕 1",
  );
  await expect(page.locator("#review-counts")).toContainText("已接受 4");
});
test("stale route rows cannot be batch selected, changing preview selection requires preview again, mobile fits", async ({
  page,
}) => {
  await restore(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#route-batch-panel").evaluate((e) => (e.open = true));
  const route6 = await page
    .locator("#route-group option")
    .evaluateAll(
      (xs) => xs.find((x) => x.textContent.includes("三民西區6")).value,
    );
  await page.selectOption("#route-group", route6);
  await expect(page.locator("#group-rows tr")).toHaveCount(62);
  await expect(
    page.locator('#group-rows input[data-sequence="168"]'),
  ).toBeDisabled();
  await page.click("#batch-select");
  await page.fill(
    "#batch-reason",
    "本次僅選同地點同到點候選，保留舊證據待重新核對，不新增日期",
  );
  await page.click("#batch-preview-button");
  await expect(page.locator("#batch-preview-rows li")).toHaveCount(49);
  await page.locator("#group-rows input:enabled").first().uncheck();
  await expect(page.locator("#batch-preview")).toBeHidden();
  await expect(page.locator("#batch-apply")).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
