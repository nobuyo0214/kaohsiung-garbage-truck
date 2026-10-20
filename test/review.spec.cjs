const { test, expect } = require("@playwright/test");
const fs = require("node:fs"),
  Papa = require("papaparse");
const { parse } = require("../scripts/data-tool.cjs");
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
async function start(page) {
  await page.goto("/official-day-matcher.html");
  await page.click("#load-default");
  await expect(page.locator("#status")).toContainText("比對完成");
}
async function exported(page, id) {
  const pending = page.waitForEvent("download");
  await page.click(id);
  return fs.readFileSync(await (await pending).path(), "utf8");
}
test("four prioritized records compare side by side, accept/reject save and restore without adding dates", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await expect(page.locator("#record-title")).toContainText("#99");
  await page.selectOption("#priority", "1");
  await expect(page.locator("#record option")).toHaveCount(4);
  await expect(page.locator("#comparison")).toContainText("未提供");
  await expect(page.locator("#comparison")).toContainText("20:50-20:52");
  await expect(page.locator("#confirm-date")).toBeDisabled();
  const reason = "先保留候選，待官方車次與完整時段證據補齊後再確認";
  await page.fill("#reason", reason);
  await page.click("#accept");
  await expect(page.locator("#candidate-state")).toContainText(
    "已接受候選建議",
  );
  await expect(page.locator("#date-state")).toContainText("尚未確認日期");
  const backup = await exported(page, "#backup");
  await page.reload();
  await page.click("#restore");
  await expect(page.locator("#status")).toContainText("已恢復備份");
  await expect(page.locator("#candidate-state")).toContainText(
    "已接受候選建議",
  );
  await expect(page.locator("#reason")).toHaveValue(reason);
  const old = parse("garbage-days.csv");
  expect(
    Papa.parse(await exported(page, "#proposed"), {
      header: true,
      skipEmptyLines: "greedy",
    }).data,
  ).toEqual(old);
  await page.fill("#reason", "此候選缺少官方證據，暫時拒絕並保留其他查證方向");
  await page.click("#reject");
  await expect(page.locator("#candidate-state")).toContainText("已拒絕此候選");
  await page.setInputFiles("#session", {
    name: "progress.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup),
  });
  await expect(page.locator("#status")).toContainText("已恢復備份");
  await expect(page.locator("#candidate-state")).toContainText(
    "已接受候選建議",
  );
  const report = Papa.parse(await exported(page, "#review"), {
    header: true,
    skipEmptyLines: "greedy",
  }).data;
  expect(report).toHaveLength(179);
  expect(report.every((r) => r.日期確認狀態.startsWith("待查證"))).toBe(true);
  expect(errors).toEqual([]);
});
test("stale twelve and no-candidate rows remain pending, full report includes all 179", async ({
  page,
}) => {
  await start(page);
  await page.selectOption("#priority", "5");
  await expect(page.locator("#record option")).toHaveCount(12);
  await expect(page.locator("#reasons")).toContainText("舊快取");
  await page.locator("#evidence-panel").evaluate((e) => (e.open = true));
  await page.check("#attest");
  await expect(page.locator("#confirm-date")).toBeDisabled();
  await page.selectOption("#priority", "4");
  await expect(page.locator("#record option")).toHaveCount(60);
  await expect(page.locator("#accept")).toBeDisabled();
  await expect(page.locator("#date-state")).toContainText("尚未確認日期");
  await expect(page.locator("#rows tr")).toHaveCount(179);
  const report = Papa.parse(await exported(page, "#review"), {
    header: true,
    skipEmptyLines: "greedy",
  }).data;
  expect(report).toHaveLength(179);
});
test("per-candidate rejection preserves alternative suggestions and next/previous navigation", async ({
  page,
}) => {
  await start(page);
  const options = await page
    .locator("#record option")
    .evaluateAll((xs) => xs.map((x) => x.value));
  // Real snapshot record #74 has more than one candidate (located from shared analysis).
  const T = require("../js/review-triage"),
    { load } = require("../scripts/data-tool.cjs");
  const multi = T.build(
    load(),
    parse("garbage-days.csv"),
    parse("data/official/sanmin-west.csv"),
  ).find((e) => e.suggestions.length > 1);
  await page.selectOption("#record", String(multi.sequence));
  await page.fill(
    "#reason",
    "目前仍無明確官方車次，拒絕這個候選但保留其他候選",
  );
  await page.click("#reject");
  await page.selectOption("#candidate", "1");
  await expect(page.locator("#candidate-state")).toContainText("尚未處理");
  await page.selectOption("#candidate", "0");
  await expect(page.locator("#candidate-state")).toContainText("已拒絕");
  const ix = options.indexOf(String(multi.sequence));
  await page.click("#next");
  await expect(page.locator("#record")).toHaveValue(options[ix + 1]);
  await page.click("#previous");
  await expect(page.locator("#record")).toHaveValue(String(multi.sequence));
});
test("blank evidence template has no guessed identity/time; tampered backup and missing latest rules fail closed", async ({
  page,
}) => {
  await start(page);
  await page.locator("#evidence-panel").evaluate((e) => (e.open = true));
  const template = Papa.parse(await exported(page, "#proof-template"), {
    header: true,
    skipEmptyLines: "greedy",
  }).data[0];
  for (const h of [
    "車次",
    "停留時間",
    "一般垃圾日",
    "官方來源",
    "查證日期",
    "證據狀態",
  ])
    expect(template[h]).toBe("");
  expect(template["對應來源紀錄ID"]).toBeTruthy();
  await page.setInputFiles("#evidence", {
    name: "blank.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(Papa.unparse([template])),
  });
  await expect(page.locator("#evidence-status")).toContainText("未匯入");
  await page.route("**/garbage-days.csv", (r) =>
    r.fulfill({ status: 404, body: "missing" }),
  );
  await page.click("#proposed");
  await expect(page.locator("#status")).toContainText("停止匯出");
  const forged = {
    version: 3,
    officialRows: parse("data/official/sanmin-west.csv"),
    evidenceRows: [],
    marks: {},
    decisions: {
      fake: {
        recordId: "fake",
        action: "confirm",
        reason: "沒有完整官方證據的偽造進度不得匯出",
      },
    },
  };
  await page.unroute("**/garbage-days.csv");
  await page.setInputFiles("#session", {
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(forged)),
  });
  await expect(page.locator("#status")).toContainText("停止");
  await expect(page.locator("#proposed")).toBeDisabled();
});
test("review remains readable on a phone and safely renders uploaded text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const input = {
    ...parse("data/official/sanmin-west.csv")[0],
    停留地點: "<img src=x onerror=alert(1)>",
  };
  await page.getByText("改用其他官方資料 CSV", { exact: true }).click();
  await page.setInputFiles("#official", {
    name: "text.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(Papa.unparse([input])),
  });
  await page.click("#run");
  await expect(page.locator("#status")).toContainText("比對完成");
  await expect(page.locator("#comparison")).toContainText(input.停留地點);
  await expect(page.locator("#comparison img")).toHaveCount(0);
});

test("synthetic full attestation requires explicit confirmation, exports preserve all old rules, withdrawal removes addition", async ({
  page,
}) => {
  // Synthetic test data is created in memory only; it is never written into the repository's official snapshots.
  const D = require("../js/data-core"),
    R = require("../js/review-core"),
    T = require("../js/review-triage"),
    { load } = require("../scripts/data-tool.cjs");
  const old = parse("garbage-days.csv"),
    official = parse("data/official/sanmin-west.csv");
  const entry = T.build(load(), old, official)[0],
    s = entry.suggestions[0];
  const proof = {
    ...Object.fromEntries(
      D.HEADERS.map((h) => [h, s.row[h] || entry.official[h]]),
    ),
    一般垃圾日: entry.official["一般垃圾日"],
    官方來源: entry.official["官方來源"],
    對應來源紀錄ID: R.id(entry.official),
    證據狀態: "verified",
    查證日期: "2026-10-20",
    查證依據: "純測試合成資料，並非實際官方查證或日期更新",
  };
  await start(page);
  await page.locator("#evidence-panel").evaluate((e) => (e.open = true));
  await page.setInputFiles("#evidence", {
    name: "synthetic-proof.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(Papa.unparse([proof])),
  });
  await expect(page.locator("#evidence-status")).toContainText("證據 1 筆");
  await expect(page.locator("#proofs")).toContainText(proof.查證依據);
  await expect(page.locator("#confirm-date")).toBeDisabled();
  expect(
    Papa.parse(await exported(page, "#proposed"), {
      header: true,
      skipEmptyLines: "greedy",
    }).data,
  ).toEqual(old);
  await page.fill("#reason", "僅供測試的完整證據人工確認，正式日期沒有改動");
  await page.check("#attest");
  await page.click("#confirm-date");
  await expect(page.locator("#date-state")).toContainText(
    "本筆已有充分匯入證據",
  );
  const proposed = Papa.parse(await exported(page, "#proposed"), {
    header: true,
    skipEmptyLines: "greedy",
  }).data;
  expect(proposed).toHaveLength(244);
  expect(proposed.slice(0, 243)).toEqual(old);
  await page.click("#undo-date");
  expect(
    Papa.parse(await exported(page, "#proposed"), {
      header: true,
      skipEmptyLines: "greedy",
    }).data,
  ).toEqual(old);
});

test("help opens as a static Pages HTML guide with all instructions", async ({
  page,
}) => {
  await page.goto("/official-day-matcher.html");
  await page.getByText("完整操作教學", { exact: true }).click();
  await expect(page.locator("h1")).toContainText("人工審核操作教學");
  await expect(page.locator("body")).toContainText("最容易先查的 4 筆");
  await expect(page.locator("body")).toContainText("恢復本機進度");
});
