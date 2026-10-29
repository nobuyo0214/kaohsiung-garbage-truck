const { test, expect } = require("@playwright/test"),
  decode = require("jsqr"),
  fs = require("node:fs"),
  C = require("../js/convenience-core"),
  T = require("../js/search-tools"),
  { load } = require("../scripts/data-tool.cjs");
const rows = load(),
  row = rows.find(
    (r) =>
      r.searchDistrict === "三民區" &&
      r.責任區 &&
      r.車次 &&
      r.startMinute !== null,
  ),
  id = T.stopId(row),
  link = C.shareURL(id, "http://127.0.0.1:4173/"),
  official = C.shareURL(
    id,
    "https://nobuyo0214.github.io/kaohsiung-garbage-truck/",
  );
test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on("pageerror", (error) => page.errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});
async function ready(page, url = link) {
  await page.goto(url);
  await expect(page.locator("#searchButton")).toBeEnabled({ timeout: 15000 });
}
async function openQR(page) {
  await page.locator(".qr-button").first().click();
  await expect(page.locator("#qrCanvas")).toBeVisible();
}
test("history is lazy, distinguishes build/source/load/official dates and matches current route hashes", async ({
  page,
}) => {
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/data/history/index.json")) requests++;
  });
  await ready(page);
  expect(requests).toBe(0);
  await page.locator("#versionInfo>summary").click();
  await expect(page.locator("#historyStatus")).toContainText(
    "已與本次路線檔案雜湊核對",
  );
  expect(requests).toBe(1);
  await expect(page.locator("#versionSummary")).toContainText(
    "官方資料發布日期未確認",
  );
  await expect(page.locator("#versionSummary")).toContainText("13,871");
  await expect(page.locator("#versionSummary")).toContainText("38 / 38");
  await expect(page.locator("#versionSummary")).toContainText("不是部署時間");
  await expect(page.locator("#dataHistoryNote")).toContainText(
    "與追蹤基準相同",
  );
  await page.locator("#versionInfo details>summary").click();
  await expect(page.locator("#dataHistoryEntries")).toContainText(
    "開始追蹤的基準",
  );
  await expect(page.locator("#dataHistoryEntries")).toContainText(
    "未補造更新紀錄",
  );
  await page.reload();
  await expect(page.locator("#searchButton")).toBeEnabled();
  expect(await page.locator(".shared-stop").count()).toBe(1);
});
test("missing or mismatched history never breaks stop search or claims an official date", async ({
  page,
}) => {
  await page.route("**/data/history/index.json", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await ready(page);
  await page.locator("#versionInfo>summary").click();
  await expect(page.locator("#historyStatus")).toContainText("無法取得相符");
  await expect(page.locator(".shared-stop")).toBeVisible();
  await page.unroute("**/data/history/index.json");
  const history = require("../data/history/index.json");
  await page.route("**/data/history/index.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...history,
        entries: history.entries.map((e) => ({
          ...e,
          byteRevision: "0".repeat(64),
        })),
      }),
    }),
  );
  await page.locator("#versionInfo>summary").click();
  await page.locator("#versionInfo>summary").click();
  await expect(page.locator("#historyStatus")).toContainText("無法取得相符");
  await expect(page.locator("#versionSummary")).toContainText(
    "官方資料發布日期未確認",
  );
});
test("QR uses the exact public v1 link, independent decoding works, PNG download decodes identically and private state stays out", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: 120.32406, latitude: 22.66913 });
  await page.addInitScript(
    ({ id }) => {
      localStorage.setItem(
        "garbage-search-v1",
        JSON.stringify({
          version: 1,
          favorites: [id],
          recent: [],
          favoriteDetails: {
            version: 1,
            entries: { [id]: { name: "PRIVATE-DO-NOT-SHARE", pinned: true } },
          },
        }),
      );
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (value) => (window.copied = value) },
      });
    },
    { id },
  );
  const external = [];
  page.on("request", (r) => {
    if (new URL(r.url()).hostname !== "127.0.0.1") external.push(r.url());
  });
  await ready(page);
  await page.click("#nearbyButton");
  await expect(page.locator(".stop-distance").first()).toBeVisible();
  await page.click("#viewSavedButton");
  await openQR(page);
  await expect(page.locator("#qrURL")).toHaveValue(official);
  const pixels = await page
    .locator("#qrCanvas")
    .evaluate((canvas) => ({
      data: [
        ...canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data,
      ],
      size: canvas.width,
    }));
  expect(
    decode(Uint8ClampedArray.from(pixels.data), pixels.size, pixels.size).data,
  ).toBe(official);
  expect(official).not.toContain("PRIVATE");
  expect(new URL(official).search).toBe("");
  expect(C.sharedId(official)).toBe(id);
  expect(external).toEqual([]);
  await page.click("#copyQRLink");
  expect(await page.evaluate(() => window.copied)).toBe(official);
  const downloadEvent = page.waitForEvent("download");
  await page.click("#downloadQR");
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(
    /^kaohsiung-stop-[a-f0-9]{8}\.png$/,
  );
  const png = fs.readFileSync(await download.path());
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const downloaded = await page.evaluate(async (base64) => {
    const img = await createImageBitmap(
        await (await fetch("data:image/png;base64," + base64)).blob(),
      ),
      canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return {
      size: canvas.width,
      data: [...ctx.getImageData(0, 0, canvas.width, canvas.height).data],
    };
  }, png.toString("base64"));
  expect(
    decode(
      Uint8ClampedArray.from(downloaded.data),
      downloaded.size,
      downloaded.size,
    ).data,
  ).toBe(official);
  await page.keyboard.press("Escape");
  await expect(page.locator("#qrDialog")).not.toBeVisible();
  await expect(page.locator(".qr-button").first()).toBeFocused();
  await page.goto(C.shareURL(C.sharedId(official), "http://127.0.0.1:4173/"));
  await expect(page.locator("#searchButton")).toBeEnabled();
  await expect(page.locator(".shared-stop")).toHaveCount(1);
});
test("failed QR encoder and clipboard retain selectable URL with no broken preview; Escape returns focus", async ({
  page,
}) => {
  await page.route("**/js/vendor/qrcode-generator-2.0.4.js", (r) => r.abort());
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw Error("denied");
        },
      },
    }),
  );
  await ready(page);
  await page.locator(".qr-button").click();
  await expect(page.locator("#qrStatus")).toContainText("仍可複製");
  await expect(page.locator("#qrCanvas")).not.toBeVisible();
  await expect(page.locator("#downloadQR")).toBeDisabled();
  await page.click("#copyQRLink");
  await expect(page.locator("#qrURL")).toBeFocused();
  expect(await page.locator("#qrURL").inputValue()).toBe(official);
  await page.keyboard.press("Escape");
  await expect(page.locator(".qr-button")).toBeFocused();
});
for (const width of [320, 390, 768, 1280])
  test(`version information and QR keyboard controls fit normal/large text at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    for (const large of [false, true]) {
      if (large) await page.click("#largeTextButton");
      await page.locator("#versionInfo>summary").click();
      await expect(page.locator("#historyStatus")).toContainText("核對");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.locator("#versionInfo>summary").click();
      await openQR(page);
      expect(
        await page
          .locator("#qrDialog")
          .evaluate((e) => e.scrollWidth <= e.clientWidth),
      ).toBe(true);
      for (const selector of ["#copyQRLink", "#downloadQR", "#closeQR"]) {
        const box = await page.locator(selector).boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      }
      await page.keyboard.press("Tab");
      expect(
        await page
          .locator("#qrDialog")
          .evaluate((e) => e.contains(document.activeElement)),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(page.locator(".qr-button").first()).toBeFocused();
    }
  });
