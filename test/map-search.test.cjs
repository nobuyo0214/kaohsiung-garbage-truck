"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  C = require("../js/convenience-core"),
  L = require("../js/location-quality"),
  { load } = require("../scripts/data-tool.cjs");

test("map text search has a fixed search endpoint, city/district/place query, and no navigation parameters", () => {
  for (const [district, place] of [
    ["前鎮區", "武德街與精忠街"],
    ["大寮區", "翁園路151之40號"],
    ["阿蓮區", "中路2-1號"],
    ["杉林區", "杉林國小前"],
    ["橋頭區", "高橋町大樓"],
  ]) {
    const url = new URL(C.mapSearchURL(district, place));
    assert.equal(url.origin + url.pathname, "https://www.google.com/maps/search/");
    assert.deepEqual([...url.searchParams], [
      ["api", "1"], ["query", "高雄市 " + district + " " + place],
    ]);
    assert.ok(url.href.length <= 2048);
    assert.equal(url.hash, "");
  }
});

test("map text search rejects absent, vague, placeholder, coordinate-only and unsafe place text", () => {
  for (const place of [
    null, undefined, {}, 123, "", "  ", "路口", "市場前", "公有市場",
    "活動中心", "社區活動中心附近", "產業道路", "附近", "轉彎處",
    "高雄市", "三民區", "中庄里", "尚未提供", "中山路（待補）",
    "某某路口", "22.6,120.3", "https://example.com/中山路",
    "javascript:中山路", "中山路\n1號", "中山路\u00001號",
    "<img src=x onerror=alert(1)>中山路", "中山路" + "一".repeat(121),
  ]) assert.equal(C.mapSearchURL("三民區", place), null, String(place));
  for (const district of [null, "", "高雄市", "中正區", "三民西區", "三民區&destination=1,2"])
    assert.equal(C.mapSearchURL(district, "鼎力路313號"), null);
});

test("map query text is normalized and safely encoded without gaining extra URL parameters", () => {
  const place = "  中山路１號  &destination=22,120#問號?  ",
    url = new URL(C.mapSearchURL("三民區", place));
  assert.equal(url.searchParams.get("query"), "高雄市 三民區 中山路1號 &destination=22,120#問號?");
  assert.equal([...url.searchParams].length, 2);
  assert.equal(url.searchParams.has("destination"), false);
  assert.equal(url.searchParams.has("dir_action"), false);
  assert.equal(url.hash, "");
});

test("text search leaves all coordinate decisions and original rows unchanged, including missing and swapped values", () => {
  const rows = load(), before = structuredClone(rows),
    topology = require("../data/geo/kaohsiung.topo.json"),
    audit = L.analyze(rows, topology);
  for (const record of audit.records) {
    const oldURL = L.navigationURL(record),
      search = C.mapSearchURL(record.row.searchDistrict, record.row.停留地點);
    assert.equal(L.navigationURL(record), oldURL);
    if (search) assert.equal(new URL(search).pathname, "/maps/search/");
    if (record.reasons.includes("swapped") || record.reasons.includes("missing"))
      assert.equal(L.navigationURL(record), null);
  }
  assert.equal(audit.records.filter(r => r.eligible).length, 9022);
  assert.equal(audit.records.filter(r => !r.eligible).length, 4849);
  assert.deepEqual(rows, before);
});
