"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const D = require("../js/data-core"),
  T = require("../js/search-tools"),
  createLoader = require("../js/search-loader");
const Papa = require("papaparse"),
  { load, parse } = require("../scripts/data-tool.cjs");
const raw = load();
D.applyRules(raw, parse("garbage-days.csv"));

test("indexed public search preserves all 38 districts and legacy compound filter semantics", () => {
  const before = structuredClone(raw),
    index = T.createIndex(raw);
  assert.equal(raw.length, 13871);
  assert.equal(index.districts.size, 38);
  assert.equal(index.duplicateCount, 3);
  for (const district of index.districts.keys()) {
    const base = raw.filter((r) => r.searchDistrict === district),
      example = base.find((r) => r.villageName) || base[0];
    const cases = [
      {},
      { sortOrder: "desc" },
      { village: example.villageName, keyword: example.停留地點.slice(0, 2) },
      {
        dayType: "garbage",
        weekday: "一",
        period: "afternoon",
        sortOrder: "desc",
      },
      { dayType: "recycle", weekday: "四", period: "evening" },
      { period: "night" },
    ];
    for (const filters of cases) {
      const expected = D.search(raw, { district, ...filters });
      // Compare membership/order after removing display-identical repetitions only.
      const identity = (r) =>
        JSON.stringify([
          T.stopId(r),
          r.villageName,
          r.recycleDay,
          r.garbageDay,
        ]);
      const seen = new Set(),
        unique = expected.filter((r) => {
          const key = identity(r);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      assert.deepEqual(
        index.search({ district, ...filters }),
        unique,
        district + JSON.stringify(filters),
      );
    }
  }
  assert.deepEqual(
    raw,
    before,
    "index and searches never mutate raw rows or their date values",
  );
});

test("display dedup keeps dates, villages, source, district, zone, trip and full-time differences separate", () => {
  const original = raw.find(
    (r) => r.searchDistrict === "三民區" && r.車次 === "1",
  );
  const variants = [
    original,
    { ...original, Seq: "different", 經度: "different" },
    { ...original, garbageDay: "三" },
    { ...original, recycleDay: "三" },
    { ...original, villageName: "其他里" },
    { ...original, 車次: "2" },
    { ...original, 責任區: "其他責任區" },
    { ...original, 停留時間: "16:19" },
    { ...original, sourceFile: "sanmin-west.csv" },
    { ...original, searchDistrict: "大寮區" },
  ];
  const index = T.createIndex(variants);
  assert.equal(index.duplicateCount, 1);
  assert.equal([...index.districts.values()].flat().length, 9);
  assert.equal(index.occurrences.get(original), 2);
  assert.notEqual(
    T.stopId({ ...original, 停留時間: "18:57-28:57" }),
    T.stopId({ ...original, 停留時間: "19:00-bad" }),
  );
});

test("duplicate raw identities cannot gain a date rule by being collapsed for display", () => {
  const rule = parse("garbage-days.csv")[0];
  const r = { ...raw.find((r) => D.key(r) === D.key(rule)), garbageDay: "" };
  const input = [r, { ...r, Seq: "extra" }];
  const applied = D.applyRules(input, [rule]);
  assert.equal(applied.added, 0);
  assert.equal(input[0].garbageDay, "");
  const index = T.createIndex(input);
  assert.equal(index.search({ district: r.searchDistrict }).length, 1);
  assert.equal(
    index.search({
      district: r.searchDistrict,
      dayType: "garbage",
      weekday: "一",
    }).length,
    0,
  );
});

test("today uses Taiwan date, and garbage weekday search cannot substitute recycling dates", () => {
  assert.equal(T.taipeiWeekday(new Date("2026-10-20T15:59:59Z")), "二");
  assert.equal(T.taipeiWeekday(new Date("2026-10-20T16:00:00Z")), "三");
  const base = raw[0],
    index = T.createIndex([
      { ...base, garbageDay: "", recycleDay: "一、二、三、四、五、六、日" },
    ]);
  for (const weekday of "一二三四五六日")
    assert.deepEqual(
      index.search({
        district: base.searchDistrict,
        dayType: "garbage",
        weekday,
      }),
      [],
    );
});

test("suggestions are real district/village stops, bounded and safe for literal text rendering", () => {
  const index = T.createIndex(raw),
    example = raw.find(
      (r) => r.searchDistrict === "三民區" && r.villageName === "建東里",
    );
  const suggestions = index.suggest(
    "三民區",
    "建東里",
    example.停留地點.slice(0, 1),
  );
  assert.ok(suggestions.length > 0 && suggestions.length <= 8);
  for (const name of suggestions)
    assert.ok(
      raw.some(
        (r) =>
          r.searchDistrict === "三民區" &&
          r.villageName === "建東里" &&
          r.停留地點 === name,
      ),
    );
  assert.deepEqual(index.suggest("三民區", "", ""), []);
});

test("preferences store only bounded identities and full recent filters; corrupt storage fails safely", () => {
  const districts = [...new Set(raw.map((r) => r.searchDistrict))];
  const filters = {
    district: "三民區",
    village: "建東里",
    keyword: "河北二路",
    dayType: "garbage",
    weekday: "一",
    period: "afternoon",
    sortOrder: "desc",
  };
  let history = [];
  for (let i = 0; i < 9; i++)
    history = T.remember(history, { ...filters, keyword: "地點" + i });
  assert.equal(history.length, 6);
  history = T.remember(history, history[3]);
  assert.equal(history.length, 6);
  assert.equal(history[0].keyword, "地點5");
  const id = T.stopId(raw[0]);
  const storage = {
    getItem: () =>
      JSON.stringify({
        version: 1,
        favorites: [id, id, "not-an-id"],
        recent: [
          filters,
          { ...filters, district: "無此區" },
          { ...filters, dayType: "guessed" },
        ],
      }),
  };
  assert.deepEqual(T.readPreferences(storage, districts), {
    favorites: [id],
    recent: [filters],
  });
  assert.throws(() =>
    T.readPreferences({ getItem: () => "broken{" }, districts),
  );
  assert.throws(() =>
    T.readPreferences(
      {
        getItem: () => {
          throw Error("blocked");
        },
      },
      districts,
    ),
  );
});

test("CSV pool limits concurrency, caches successes and retries failures without doubling records", async () => {
  let active = 0,
    peak = 0,
    fixed = false;
  const requests = [];
  const fetcher = async (name) => {
    active++;
    peak = Math.max(peak, active);
    requests.push(name);
    await new Promise((r) => setTimeout(r, 2));
    active--;
    return {
      ok: name !== "bad.csv" || fixed,
      status: 503,
      text: async () => "責任區,車次,停留地點,停留時間\n一,1,測試點,12:00",
    };
  };
  const files = ["a.csv", "b.csv", "bad.csv", "c.csv"].map((name) => ({
    name,
  }));
  const loader = createLoader({ parse: Papa.parse, fetcher, concurrency: 2 });
  const result = await loader.load(files, ["停留地點"]);
  assert.equal(peak, 2);
  assert.equal(result.routes[2].status, "rejected");
  fixed = true;
  const retry = await loader.load(files, ["停留地點"]);
  assert.ok(retry.routes.every((r) => r.status === "fulfilled"));
  assert.deepEqual(
    requests.filter((name) => name !== "bad.csv"),
    ["a.csv", "b.csv", "c.csv", "garbage-days.csv"],
  );
  assert.equal(requests.filter((name) => name === "bad.csv").length, 2);
});

test("timeouts, HTTP failures, malformed CSV and missing headers remain retryable errors", async () => {
  const fetcher = async (name, { signal }) => {
    if (name === "timeout.csv")
      return new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(Error("timeout"))),
      );
    return {
      ok: name !== "http.csv",
      status: 404,
      text: async () =>
        name === "broken.csv" ? '停留地點\n"unclosed' : "unexpected\nvalue",
    };
  };
  const loader = createLoader({ parse: Papa.parse, fetcher, timeout: 15 });
  const result = await loader.load(
    ["timeout.csv", "http.csv", "broken.csv", "headers.csv"].map((name) => ({
      name,
    })),
    D.HEADERS,
  );
  assert.ok(result.routes.every((r) => r.status === "rejected"));
  assert.equal(result.rules.status, "rejected");
});

test("homepage vendors the same pinned Papa Parse used by tests, with its license", () => {
  assert.deepEqual(
    fs.readFileSync("js/vendor/papaparse.min.js"),
    fs.readFileSync(require.resolve("papaparse/papaparse.min.js")),
  );
  assert.match(
    fs.readFileSync("js/vendor/PAPAPARSE-LICENSE.txt", "utf8"),
    /MIT License/,
  );
});
