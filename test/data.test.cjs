"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const D = require("../js/data-core");
const files = require("../js/route-files");
const { parse, load } = require("../scripts/data-tool.cjs");
// Synthetic identities and reserved .invalid URL are not production data.
const source = "https://data.kcg.gov.tw/";
const rule = (overrides = {}) => ({
  來源檔案: "sanmin-west.csv",
  責任區: "測試",
  車次: "1",
  停留地點: "測試站",
  停留時間: "16:19-16:22",
  一般垃圾日: "一、四",
  官方來源: source,
  ...overrides,
});
const raw = (overrides = {}) => ({
  ...rule(),
  sourceFile: "sanmin-west.csv",
  garbageDay: "",
  ...overrides,
});

test("latest baseline retains all 39 route CSVs byte for byte and all 243 confirmed rules", () => {
  const baseline = require("./fixtures/baseline.json");
  assert.equal(files.length, 39);
  for (const { file, sha256 } of baseline.files)
    assert.equal(
      crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      sha256,
      file,
    );
  const rules = parse("garbage-days.csv", D.HEADERS);
  assert.equal(rules.length, 243);
  assert.equal(new Set(rules.map((r) => D.key(r))).size, 243);
  assert.ok(rules.every(D.validRule));
  assert.equal(
    crypto
      .createHash("sha256")
      .update(fs.readFileSync("garbage-days.csv"))
      .digest("hex"),
    baseline.rulesSha256,
  );
});
test("full times normalize formatting only, reject malformed substrings", () => {
  assert.equal(D.normalizeTime("１６：１９ ～ １６：２２"), "16:19-16:22");
  assert.equal(D.normalizeTime("16 : 19-16：22"), "16:19-16:22");
  for (const s of [
    "116:19",
    "16:110-16:13",
    "18:57-28:57",
    "16:19 text",
    "16:19-16:99",
    "",
  ])
    assert.equal(D.normalizeTime(s), "", s);
  assert.equal(D.timeStatus("16:19", "16:19-16:22"), "time_extent_mismatch");
  assert.equal(D.timeStatus("16:20", "16:19-16:22"), "time_mismatch");
});
test("safe source validation rejects lookalike hosts, credentials and non-HTTPS", () => {
  for (const s of [
    "https://gov.tw.evil.invalid",
    "http://data.kcg.gov.tw",
    "https://x@data.kcg.gov.tw",
    "https://example.invalid",
    "https://data.kcg.gov.tw:8443/",
  ])
    assert.equal(D.officialURL(s), false, s);
  assert.equal(D.officialURL(source), true);
});
test("runtime uses all five fields, with no start-only, place-only or route fallback", () => {
  for (const change of [
    { 來源檔案: "sanmin-east.csv" },
    { 責任區: "另一區" },
    { 車次: "2" },
    { 停留地點: "另一站" },
    { 停留時間: "16:19" },
    { 停留時間: "" },
    { 停留地點: "", 停留時間: "" },
  ]) {
    const rows = [raw()];
    D.applyRules(rows, [rule(change)]);
    assert.equal(rows[0].garbageDay, "", JSON.stringify(change));
  }
  const rows = [raw()];
  D.applyRules(rows, [rule()]);
  assert.equal(rows[0].garbageDay, "一、四");
});
test("runtime blocks conflicting rules and duplicate raw identities, keeps confirmed raw dates", () => {
  const a = [raw()];
  D.applyRules(a, [rule(), rule({ 一般垃圾日: "二" })]);
  assert.equal(a[0].garbageDay, "");
  const b = [raw(), raw()];
  D.applyRules(b, [rule()]);
  assert.ok(b.every((r) => r.garbageDay === ""));
  const c = [raw({ garbageDay: "二" })];
  assert.equal(D.applyRules(c, [rule()]).conflicts, 1);
  assert.equal(c[0].garbageDay, "二");
});
test("batch only emits unique exact candidates and never mutates input or old rules", () => {
  const old = [rule({ 停留地點: "已確認" })],
    before = JSON.stringify(old);
  const result = D.reconcile([raw()], old, [rule(), rule()]);
  assert.equal(result.candidates.length, 1);
  const union = D.mergeRules(old, result.candidates);
  assert.equal(union.length, 2);
  assert.equal(JSON.stringify(old), before);
  assert.deepEqual(union[0], old[0]);
});
test("batch reports time differences, incomplete identities and unknown files", () => {
  const rows = [raw()];
  for (const [change, status] of [
    [{ 停留時間: "16:19" }, "time_extent_mismatch"],
    [{ 停留時間: "16:20" }, "time_mismatch"],
    [{ 車次: "" }, "missing_identity"],
    [{ 責任區: "" }, "missing_identity"],
    [{ 來源檔案: "made-up.csv" }, "unknown_file"],
    [{ 車次: "2" }, "no_match"],
    [{ 一般垃圾日: "", 回收日: "一、四" }, "missing_garbage_days"],
    [{ 證據狀態: "stale" }, "stale_evidence"],
  ]) {
    const r = D.reconcile(rows, [], [rule(change)]);
    assert.equal(r.candidates.length, 0);
    assert.equal(r.review[0]["狀態"], status);
  }
});
test("batch blocks all conflicting official rows, duplicate raw matches and confirmed date conflicts", () => {
  for (const [rows, old, input, status] of [
    [[raw()], [], [rule(), rule({ 一般垃圾日: "二" })], "official_conflict"],
    [[raw(), raw()], [], [rule()], "ambiguous_raw"],
    [[raw()], [rule({ 一般垃圾日: "二" })], [rule()], "existing_conflict"],
    [[raw({ garbageDay: "二" })], [], [rule()], "raw_conflict"],
  ]) {
    const r = D.reconcile(rows, old, input);
    assert.equal(r.candidates.length, 0);
    assert.ok(r.review.every((x) => x["狀態"] === status));
  }
  assert.throws(
    () => D.mergeRules([rule()], [rule({ 一般垃圾日: "二" })]),
    /衝突/,
  );
  assert.throws(() => D.mergeRules([rule({ 官方來源: "bad" })], []), /既有/);
  assert.deepEqual(
    D.mergeRules(
      [rule()],
      [rule({ 停留時間: "16:19~16:22", 一般垃圾日: "四、一" })],
    ),
    [rule()],
  );
});
test("all 38 districts keep unfiltered search; village, keyword, days, time, sorting compose", () => {
  const rows = load(),
    districts = [...new Set(rows.map((r) => r.searchDistrict))];
  assert.equal(districts.length, 38);
  const originalDays = rows.filter((r) => r.garbageDay).length;
  const mapping = D.applyRules(rows, parse("garbage-days.csv"));
  assert.equal(mapping.matched, 243);
  assert.equal(mapping.added, 242);
  for (const district of districts) {
    const original = rows.filter((r) => r.searchDistrict === district);
    assert.ok(original.length > 0);
    assert.equal(
      D.search(rows, { district }).length,
      original.length,
      district,
    );
    const sample = original.find((r) => r.startMinute !== null),
      village = sample.villageName;
    const matches = D.search(rows, {
      district,
      village,
      keyword: sample["停留地點"],
    });
    assert.ok(matches.includes(sample), district);
    for (const dayType of ["recycle", "garbage"])
      for (const weekday of "一二三四五六日") {
        const expected = original.filter((r) =>
          (dayType === "garbage" ? r.garbageDay : r.recycleDay).includes(
            weekday,
          ),
        );
        assert.deepEqual(
          new Set(D.search(rows, { district, dayType, weekday })),
          new Set(expected),
          district + " " + dayType + weekday,
        );
      }
    for (const [period, min, max] of [
      ["dawn", 0, 360],
      ["morning", 360, 720],
      ["afternoon", 720, 1020],
      ["evening", 1020, 1200],
      ["night", 1200, 1440],
    ]) {
      const matches = D.search(rows, { district, period, sortOrder: "desc" });
      assert.ok(
        matches.every((r) => r.startMinute >= min && r.startMinute < max),
      );
      assert.ok(
        matches.every(
          (r, i) => !i || matches[i - 1].startMinute >= r.startMinute,
        ),
      );
    }
    for (const sortOrder of ["asc", "desc"]) {
      const matches = D.search(rows, { district, sortOrder }).filter(
        (r) => r.startMinute !== null,
      );
      assert.ok(
        matches.every(
          (r, i) =>
            !i ||
            (sortOrder === "asc"
              ? matches[i - 1].startMinute <= r.startMinute
              : matches[i - 1].startMinute >= r.startMinute),
        ),
      );
    }
  }
  assert.equal(
    rows.filter(
      (r) =>
        r.sourceFile === "sanmin-west.csv" && r.searchDistrict === "大寮區",
    ).length,
    212,
  );
  assert.equal(
    rows.filter(
      (r) =>
        r.sourceFile === "sanmin-west.csv" && r.searchDistrict === "三民區",
    ).length,
    550,
  );
  assert.equal(rows.filter((r) => r.garbageDay).length, originalDays + 242);
});
test("weekday ranges, formatting, empty days and period boundaries", () => {
  assert.equal(D.matchesWeekday("週二至週五", "三"), true);
  assert.equal(D.matchesWeekday("一至六", "日"), false);
  assert.equal(D.matchesWeekday("每日", "日"), true);
  assert.equal(D.matchesWeekday("", "一"), false);
  assert.equal(D.matchesWeekday("", ""), true);
  assert.equal(D.matchesPeriod(720, "morning"), false);
  assert.equal(D.matchesPeriod(720, "afternoon"), true);
  assert.equal(D.matchesPeriod(null, "night"), false);
  assert.equal(D.normalizeDays("四,一,四"), "一、四");
  const rows = [
    {
      searchDistrict: "測試區",
      villageName: "某里",
      停留地點: "ＡＢＣ 路",
      garbageDay: "",
      recycleDay: "一",
      startMinute: 600,
    },
  ];
  assert.equal(
    D.search(rows, {
      district: "測試區",
      keyword: "abc路",
      weekday: "一",
      village: "某里",
      period: "morning",
    }).length,
    1,
  );
  assert.equal(
    D.search(rows, { district: "測試區", dayType: "garbage", weekday: "一" })
      .length,
    0,
  );
});
test("real official west snapshot never infers a CSV trip or duration", () => {
  const official = parse("data/official/sanmin-west.csv", D.HEADERS);
  assert.equal(official.length, 179);
  assert.ok(official.every((r) => r["車次"] === ""));
  const result = D.reconcile(load(), parse("garbage-days.csv"), official);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.review.length, 179);
  assert.ok(result.review.some((r) => r["時間檢查"].includes("time_mismatch")));
  assert.ok(
    result.review.some((r) => r["時間檢查"].includes("time_extent_mismatch")),
  );
});

test("inventory separates the mixed-source Daliao and Sanmin districts", () => {
  const inventory = parse("reports/route-inventory.csv");
  assert.equal(new Set(inventory.map((r) => r["行政區"])).size, 38);
  assert.equal(
    inventory
      .filter((r) => r["行政區"] === "大寮區")
      .reduce((n, r) => n + Number(r["停靠紀錄數"]), 0),
    212,
  );
});

test("extra CSV metadata cannot override the source file used by the five-field key", () => {
  const spoofed = rule({
    來源檔案: "sanmin-east.csv",
    sourceFile: "sanmin-west.csv",
  });
  const result = D.reconcile([raw()], [], [spoofed]);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.review[0]["狀態"], "no_match");
  const prepared = D.prepareRows([rule({ 來源檔案: "sanmin-east.csv" })], {
    name: "sanmin-west.csv",
    district: "三民區",
  });
  assert.equal(D.key(prepared[0]), D.key(rule()));
});
