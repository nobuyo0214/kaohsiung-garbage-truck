"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  crypto = require("node:crypto"),
  Papa = require("papaparse");
const { load } = require("../scripts/data-tool.cjs"),
  L = require("../js/location-quality"),
  C = require("../js/convenience-core"),
  T = require("../js/search-tools"),
  S = require("../js/site-data"),
  createLoader = require("../js/search-loader");
const topology = require("../data/geo/kaohsiung.topo.json"),
  rows = load(),
  audit = L.analyze(rows, topology),
  sample = audit.records.find(
    (r) => r.eligible && r.row.searchDistrict === "三民區",
  ).row;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

test("location policy preserves all source rows and reproducibly excludes uncertain positions", () => {
  const before = structuredClone(rows),
    checked = L.analyze(rows, topology);
  assert.equal(checked.records.length, 13871);
  assert.equal(checked.records.filter((r) => r.eligible).length, 9022);
  assert.equal(checked.records.filter((r) => !r.eligible).length, 4849);
  const features = L.decode(topology);
  for (const r of checked.records.filter((r) => r.eligible)) {
    assert.ok(
      L.contains(
        r.point,
        features.find((f) => f.name === r.row.searchDistrict),
      ),
    );
    assert.equal(r.reasons.length, 0);
  }
  assert.deepEqual(rows, before);
});
test("coordinates reject missing, numeric coercions, swaps, low precision and outside-city values", () => {
  for (const [lon, lat, expected] of [
    ["", "22.6700", "missing"],
    ["Infinity", "22.6700", "invalid"],
    ["0x78", "22.6700", "invalid"],
    ["120.3;alert(1)", "22.6", "invalid"],
    ["22.6700", "120.3300", "swapped"],
    ["120.3", "22.6", "low_precision"],
  ])
    assert.equal(L.coordinate({ 經度: lon, 緯度: lat }).reason, expected);
  const taipei = { ...sample, 經度: "121.565400", 緯度: "25.033000" };
  const result = L.analyze([taipei], topology).records[0];
  assert.ok(result.reasons.includes("outside_city"));
  assert.equal(L.navigationURL(result), null);
  const mislabeled = { ...sample, searchDistrict: "前金區", 行政區: "前金區" };
  assert.ok(
    L.analyze([mislabeled], topology).records[0].reasons.includes(
      "district_mismatch",
    ),
  );
});
test("same-identity conflicts, missing duplicate coordinates, place conflicts and defaults block navigation", () => {
  for (const changed of [
    { ...sample, 經度: String(Number(sample.經度) + 0.0001) },
    { ...sample, 緯度: "" },
  ]) {
    const results = L.analyze([sample, changed], topology).records;
    assert.ok(
      results.every(
        (r) => r.reasons.includes("identity_conflict") && !L.navigationURL(r),
      ),
    );
  }
  const otherTrip = {
    ...sample,
    車次: "2",
    經度: String(Number(sample.經度) + 0.0001),
  };
  assert.ok(
    L.analyze([sample, otherTrip], topology).records.every((r) =>
      r.reasons.includes("place_conflict"),
    ),
  );
  const defaults = [
    sample,
    { ...sample, 停留地點: "測試位置二" },
    { ...sample, 停留地點: "測試位置三" },
  ];
  assert.ok(
    L.analyze(defaults, topology).records.every((r) =>
      r.reasons.includes("shared_coordinate"),
    ),
  );
  const uncertain = audit.records.find((r) =>
    r.reasons.includes("boundary_uncertain"),
  );
  assert.equal(L.navigationURL(uncertain), null);
  assert.ok(
    L.analyze([sample], null).records[0].reasons.includes(
      "geometry_unavailable",
    ),
  );
});
test("Google Maps URL uses only validated original latitude/longitude and a fixed safe host", () => {
  const record = L.analyze([sample], topology).records[0],
    url = new URL(L.navigationURL(record));
  assert.equal(url.origin + url.pathname, "https://www.google.com/maps/dir/");
  assert.equal(url.searchParams.get("api"), "1");
  assert.equal(
    url.searchParams.get("destination"),
    sample.緯度 + "," + sample.經度,
  );
  assert.equal([...url.searchParams].length, 2);
  assert.equal(
    L.navigationURL({ eligible: true, reasons: [], point: [Infinity, 23] }),
    null,
  );
});
test("sharing round-trips stable full identities in a Pages subdirectory without personal data", () => {
  const id = T.stopId(sample),
    url = C.shareURL(
      id,
      "https://example.github.io/project/index.html?private=history#other",
    );
  assert.equal(new URL(url).pathname, "/project/");
  assert.equal(new URL(url).search, "");
  assert.equal(C.sharedId(url), id);
  assert.ok(C.shareable(id, C.identityIndex(rows)));
  assert.ok(!url.includes("Seq"));
  assert.equal(T.stopId({ ...sample, Seq: "changed" }), id);
  assert.equal(C.shareable(id, [sample, { ...sample }]), false);
  assert.equal(C.shareable(id, []), false);
  assert.equal(
    C.shareable(T.stopId({ ...sample, 停留時間: "16:52" }), [sample]),
    false,
  );
  assert.equal(
    C.sharedId("https://example.github.io/project/#sourceInfo"),
    null,
  );
});
test("malformed, oversized, unsupported and ambiguous share identifiers fail rather than guessing", () => {
  const id = T.stopId(sample),
    good = C.shareURL(id, "https://example.github.io/project/");
  for (const fragment of [
    "stop=2.invalid",
    "stop=1.!!!!",
    "stop=1._w",
    "stop=1." + "a".repeat(7001),
    new URL(good).hash.slice(1) + "&stop=extra",
  ])
    assert.throws(() =>
      C.sharedId("https://example.github.io/project/#" + fragment),
    );
  assert.throws(() => C.shareURL(id, "javascript:alert(1)"));
  assert.equal(
    C.shareable(T.stopId({ ...sample, 車次: "" }), [{ ...sample, 車次: "" }]),
    false,
  );
});
test("favorite export/import preserves existing v1 localStorage identifiers and recent searches", () => {
  const ids = [T.stopId(sample), T.stopId({ ...sample, 車次: "2" })],
    recent = [
      {
        district: "三民區",
        village: "",
        keyword: "鼎力路",
        dayType: "recycle",
        weekday: "",
        period: "",
        sortOrder: "asc",
      },
    ];
  const preferences = T.readPreferences(
    { getItem: () => JSON.stringify({ version: 1, favorites: ids, recent }) },
    ["三民區"],
  );
  const backup = C.exportFavorites(preferences.favorites),
    text = JSON.stringify(backup);
  assert.deepEqual(C.importFavorites(text), ids);
  assert.deepEqual(preferences.recent, recent);
  assert.ok(
    !text.includes("garbageDay") &&
      !text.includes("經度") &&
      !text.includes("recent"),
  );
  assert.deepEqual(C.mergeFavorites(ids, [ids[0]]), ids);
  const missing = T.stopId({ ...sample, 停留地點: "資料已變更的測試站點" });
  assert.deepEqual(
    C.importFavorites(JSON.stringify(C.exportFavorites([missing]))),
    [missing],
  );
  assert.deepEqual(C.unresolved([missing], C.identityIndex(rows)), [missing]);
  const legacy = T.stopId({ ...sample, 車次: "", 停留時間: "原始時間待確認" });
  assert.deepEqual(
    C.importFavorites(JSON.stringify(C.exportFavorites([legacy]))),
    [legacy],
  );
  assert.deepEqual(C.unresolved([legacy], C.identityIndex(rows)), [legacy]);
});
test("invalid/large/version-mismatched backup imports and >200 merges cannot mutate originals", () => {
  const existing = [T.stopId(sample)],
    before = structuredClone(existing),
    valid = C.exportFavorites(existing);
  for (const value of [
    "{broken",
    JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, recent: [] }),
    JSON.stringify({
      ...valid,
      favorites: [{ ...valid.favorites[0], sourceFile: "../secret.csv" }],
    }),
    JSON.stringify({ ...valid, favorites: [{ place: "missing keys" }] }),
    " ".repeat(C.MAX_BYTES + 1),
  ])
    assert.throws(() => C.importFavorites(value));
  assert.deepEqual(existing, before);
  const many = Array.from({ length: 200 }, (_, i) =>
    T.stopId({ ...sample, 停留地點: "測試" + i }),
  );
  assert.equal(C.mergeFavorites(many, [many[0]]).length, 200);
  assert.throws(() => C.mergeFavorites(many, existing));
  assert.throws(() =>
    C.importFavorites(
      JSON.stringify({
        ...valid,
        favorites: Array(201).fill(valid.favorites[0]),
      }),
    ),
  );
});
test("CSV version verification hashes raw BOM bytes and rejects a mismatched date map", async () => {
  const text = "\uFEFF責任區,車次,停留地點,停留時間\n一,1,測試,12:00",
    data = Buffer.from(text);
  const loader = createLoader({
    parse: Papa.parse,
    fetcher: async () => new Response(data),
  });
  const result = await loader.load(
    [{ name: "a.csv" }],
    ["停留地點"],
    undefined,
    { "a.csv": hash(data), "garbage-days.csv": "0".repeat(64) },
  );
  assert.equal(result.routes[0].status, "fulfilled");
  assert.equal(result.rules.status, "rejected");
  assert.match(result.rules.reason.message, /版本不一致/);
});
test("metadata separates unknown official/import dates from recorded version time and verifies hashes", async () => {
  const meta = require("../data/site-metadata.json");
  assert.equal(S.validate(meta), meta);
  assert.equal(meta.officialUpdatedAt, null);
  assert.equal(meta.originalImportedAt, null);
  assert.throws(() =>
    S.validate({ ...meta, officialUpdatedAt: new Date().toISOString() }),
  );
  assert.throws(() => S.validate({ ...meta, files: {} }));
  assert.equal(
    (await S.metadata(async () => new Response(JSON.stringify(meta))))
      .dataRevision,
    meta.dataRevision,
  );
  await assert.rejects(
    S.metadata(
      async () =>
        new Response(JSON.stringify({ ...meta, dataRevision: "0".repeat(64) })),
    ),
  );
  for (const name of S.paths)
    assert.equal(hash(fs.readFileSync(name)), meta.files[name]);
});
test("reset blocks late prior-version responses from repopulating the file cache", async () => {
  const body = "責任區,車次,停留地點,停留時間\n一,1,測試,12:00";
  let release,
    old = true,
    requests = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const loader = createLoader({
    parse: Papa.parse,
    fetcher: async () => {
      requests++;
      if (old) await gate;
      return new Response(body);
    },
  });
  const pending = loader.load([{ name: "a.csv" }], ["停留地點"]);
  loader.reset();
  old = false;
  release();
  const cancelled = await pending;
  assert.ok(cancelled.routes.every((r) => r.status === "rejected"));
  const next = await loader.load([{ name: "a.csv" }], ["停留地點"]);
  assert.equal(next.routes[0].status, "fulfilled");
  assert.equal(requests, 4);
});
test("manifest, icon sizes, shell build and geometry provenance remain reproducible", () => {
  const manifest = JSON.parse(fs.readFileSync("manifest.webmanifest"));
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.lang, "zh-Hant-TW");
  for (const icon of manifest.icons) {
    const data = fs.readFileSync(icon.src);
    assert.equal(
      data.readUInt32BE(16) + "x" + data.readUInt32BE(20),
      icon.sizes,
    );
    assert.equal(icon.type, "image/png");
  }
  assert.ok(manifest.icons.some((i) => i.purpose === "maskable"));
  const build = require("../scripts/build-site.cjs").build({ check: true });
  assert.ok(
    build.assets.every(
      ([name]) => !name.endsWith(".csv") && !name.startsWith("data/"),
    ),
  );
  assert.equal(
    hash(fs.readFileSync("data/geo/kaohsiung.topo.json")),
    require("../data/geo/provenance.json").sha256,
  );
});
