"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs");
const D = require("../js/data-core"),
  R = require("../js/review-core");
const I = require("../scripts/official-import.cjs");
const { parse, load } = require("../scripts/data-tool.cjs");
// All constructed records are synthetic test data, never production dates or stations.
const source = {
  id: "fixture",
  sourceFile: "sanmin-east.csv",
  district: "三民區",
  url: "https://data.kcg.gov.tw/",
  format: "json",
};
const rule = (x = {}) => ({
  來源檔案: "sanmin-east.csv",
  責任區: "測試",
  車次: "1",
  停留地點: "測試路100號",
  停留時間: "16:00-16:02",
  一般垃圾日: "一、四",
  官方來源: source.url,
  ...x,
});
const raw = (x = {}) =>
  D.prepareRows([rule(x)], { name: "sanmin-east.csv", district: "三民區" })[0];
const blankRaw = () => ({ ...raw(), garbageDay: "" });
const metadata = {
  acquiredAt: "2026-10-20T00:00:00Z",
  acquisitionMethod: "http",
  officialUpdatedAt: "",
};
function session(rows) {
  return { version: 2, officialRows: rows, evidenceRows: [], decisions: {} };
}

test("JSON/CSV imports preserve raw fields, timestamps and explicit weekdays without recycling fallback", () => {
  const original = {
    行政區: "大寮區",
    ...rule(),
    附加欄: "原始,欄位\n另行",
    回收日: "二、五",
  };
  for (const [format, text] of [
    ["json", JSON.stringify([original])],
    ["csv", require("papaparse").unparse([original])],
  ]) {
    const [r] = I.normalize(text, source, metadata, format);
    assert.deepEqual(JSON.parse(r["原始欄位"]), original);
    assert.equal(r["資料取得時間"], metadata.acquiredAt);
    assert.equal(r["官方更新日期"], "");
    assert.equal(r["一般垃圾日"], "一、四");
    assert.equal(r["行政區"], "大寮區");
    assert.ok(r["來源紀錄ID"]);
  }
  const [r] = I.normalize(
    JSON.stringify([{ ...rule(), 一般垃圾日: "", 回收日: "一、四" }]),
    source,
    {},
    "json",
  );
  assert.equal(r["一般垃圾日"], "");
  assert.equal(r["資料取得時間"], "");
  assert.equal(r["證據狀態"], "unverified");
  const [dated] = I.normalize(
    JSON.stringify([rule({ 官方更新日期: "2026-10-01" })]),
    source,
    metadata,
    "json",
  );
  assert.equal(dated["官方更新日期"], "2026-10-01");
  assert.throws(
    () =>
      I.normalize(
        JSON.stringify([rule({ 來源檔案: "gangshan.csv" })]),
        source,
        metadata,
        "json",
      ),
    /不一致/,
  );
  assert.throws(
    () => I.normalize('{"unexpected":[]}', source, metadata, "json"),
    /JSON/,
  );
  assert.throws(
    () => I.normalize('a,b\n"broken', source, metadata, "csv"),
    /CSV/,
  );
});
test("HTML adapter chooses the general-garbage header, preserves resource-recycling separately", () => {
  const html =
    "<html><body>清運路線序號 E000TEST 清運路線名稱 測試路線 清運方式 定點<table><tr><th>清運序</th><th>清運點名稱描述</th><th>清運時間</th><th>一般垃圾</th><th>資源回收</th></tr><tr><td>1</td><td>測試路100號</td><td>16:00</td><td>一、四</td><td>二、五</td></tr></table></body></html>";
  const [r] = I.normalize(html, source, metadata, "moenv-html");
  assert.equal(r["一般垃圾日"], "一、四");
  assert.equal(r["車次"], "");
  assert.equal(r["責任區"], "");
  assert.equal(JSON.parse(r["原始欄位"])["資源回收"], "二、五");
  assert.throws(
    () => I.moenvHTML(html.replace("<th>一般垃圾</th>", "<th>未知欄位</th>")),
    /一般垃圾/,
  );
});
test("all real imported snapshots replay deterministically and do not invent trips or update dates", () => {
  const registry = require("../data/sources/registry.json");
  const records = [];
  for (const source of registry.sources.filter((s) => s.snapshot)) {
    const text = fs.readFileSync(source.snapshot, "utf8");
    const rows = I.normalize(text, source, source.snapshotMetadata);
    assert.deepEqual(rows, I.normalize(text, source, source.snapshotMetadata));
    records.push(...rows);
  }
  assert.equal(records.length, 503);
  assert.ok(records.every((r) => r["車次"] === "" && r["官方更新日期"] === ""));
  assert.ok(records.some((r) => r["證據狀態"] === "cached"));
  assert.ok(records.every((r) => r["原始欄位"] && r["官方來源"]));
});
test("suggestions distinguish few-minute differences and similar places without authorizing a rule", () => {
  const rows = [blankRaw()];
  for (const o of [
    rule({ 停留時間: "16:03-16:05" }),
    rule({ 停留地點: "測試路100號前" }),
    rule({ 車次: "", 停留時間: "16:00" }),
  ]) {
    const [e] = R.buildEntries(rows, [], [o]);
    assert.ok(e.suggestions.length);
    assert.equal(D.reconcile(rows, [], [o]).candidates.length, 0);
    assert.throws(
      () =>
        R.decide(
          rows,
          [],
          [o],
          [],
          e,
          D.key(rows[0]),
          "confirm",
          "已查閱官方頁面但仍缺完整證據",
          "now",
        ),
      /缺少完整五欄/,
    );
  }
  assert.equal(R.suggest(rows, rule({ 車次: "2" })).length, 0);
  assert.equal(R.suggest(rows, rule({ 責任區: "另一責任區" })).length, 0);
  assert.equal(
    R.suggest(rows, rule({ 來源檔案: "sanmin-west.csv" })).length,
    0,
  );
});
test("exact matches require an explicit decision and preserve every old rule", () => {
  const rows = [blankRaw()],
    official = [rule()],
    old = [rule({ 停留地點: "舊站" })];
  const [entry] = R.buildEntries(rows, old, official);
  assert.equal(entry.category, "確認吻合");
  assert.deepEqual(R.proposal(rows, old, official, [], {}), old);
  const decision = R.decide(
    rows,
    old,
    official,
    [],
    entry,
    D.key(rows[0]),
    "confirm",
    "官方五欄完整一致並且核實一般垃圾日",
    "now",
  );
  const proposal = R.proposal(rows, old, official, [], {
    [entry.id]: decision,
  });
  assert.equal(proposal.length, 2);
  assert.deepEqual(proposal[0], old[0]);
  assert.throws(
    () =>
      R.decide(
        rows,
        old,
        official,
        [],
        entry,
        D.key(rows[0]),
        "confirm",
        "太短",
        "now",
      ),
    /10 字/,
  );
});
test("manual mismatch confirmation needs linked supplementary evidence with a complete exact key", () => {
  const rows = [blankRaw()],
    official = [rule({ 車次: "", 停留時間: "16:00" })],
    [entry] = R.buildEntries(rows, [], official);
  for (const evidence of [
    [rule()],
    [rule({ 對應來源紀錄ID: entry.id, 停留時間: "16:00" })],
    [rule({ 對應來源紀錄ID: entry.id, 證據狀態: "cached" })],
  ])
    assert.equal(
      R.findEvidence(rows, [], official, evidence, entry, D.key(rows[0]))
        .length,
      0,
    );
  const evidence = [rule({ 對應來源紀錄ID: entry.id })];
  const decision = R.decide(
    rows,
    [],
    official,
    evidence,
    entry,
    D.key(rows[0]),
    "confirm",
    "補充官方班次表確認車次與完整停留時段",
    "now",
  );
  assert.equal(
    R.proposal(rows, [], official, evidence, { [entry.id]: decision }).length,
    1,
  );
  assert.throws(
    () => R.proposal(rows, [], official, [], { [entry.id]: decision }),
    /證據已變更/,
  );
  assert.throws(
    () =>
      R.proposal(
        [{ ...rows[0], 停留時間: "16:01-16:03" }],
        [],
        official,
        evidence,
        { [entry.id]: decision },
      ),
    /已變更/,
  );
});
test("cached/stale evidence, conflicting days and duplicate raw identities never authorize confirmation", () => {
  for (const evidence of [
    [rule({ 證據狀態: "cached" })],
    [rule({ 證據狀態: "stale" })],
    [rule(), rule({ 一般垃圾日: "二" })],
  ]) {
    const rows = [blankRaw()],
      [entry] = R.buildEntries(rows, [], evidence);
    assert.equal(
      R.findEvidence(rows, [], evidence, [], entry, D.key(rows[0])).length,
      0,
    );
  }
  const rows = [blankRaw(), blankRaw()],
    [entry] = R.buildEntries(rows, [], [rule()]);
  assert.equal(
    R.findEvidence(rows, [], [rule()], [], entry, D.key(rows[0])).length,
    0,
  );
  const conflictOld = [rule({ 一般垃圾日: "二" })];
  assert.equal(
    R.findEvidence(
      [blankRaw()],
      conflictOld,
      [rule()],
      [],
      entry,
      D.key(rows[0]),
    ).length,
    0,
  );
});
test("progress round trips keep unresolved/rejected entries and revalidate approvals against current dates", () => {
  const rows = [blankRaw()],
    official = [rule(), rule({ 停留地點: "尚未解決站" })],
    s = session(official),
    [e] = R.buildEntries(rows, [], official);
  s.decisions[e.id] = R.decide(
    rows,
    [],
    official,
    [],
    e,
    D.key(rows[0]),
    "reject",
    "已查閱但官方與原始站點關係仍無法證明",
    "now",
  );
  const restored = R.validateSession(JSON.parse(JSON.stringify(s)));
  assert.equal(restored.officialRows.length, 2);
  assert.equal(restored.decisions[e.id].action, "reject");
  assert.deepEqual(R.proposal(rows, [], official, [], restored.decisions), []);
  s.decisions[e.id] = R.decide(
    rows,
    [],
    official,
    [],
    e,
    D.key(rows[0]),
    "confirm",
    "官方五欄完整一致並且核實一般垃圾日",
    "now",
  );
  assert.throws(
    () =>
      R.proposal(rows, [rule({ 一般垃圾日: "二" })], official, [], s.decisions),
    /證據已變更/,
  );
  assert.throws(() => R.validateSession({ ...s, version: 1 }), /格式/);
  assert.throws(
    () => R.validateSession({ ...s, officialRows: [rule(), rule()] }),
    /重複/,
  );
});
test("real pilot has evidence in three source files; none of 503 records silently adds dates", () => {
  const official = parse("reports/expansion/official.csv"),
    rows = load(),
    old = parse("garbage-days.csv");
  assert.equal(new Set(official.map((r) => r["來源檔案"])).size, 3);
  assert.equal(official.length, 503);
  assert.deepEqual(R.proposal(rows, old, official, [], {}), old);
  const categories = R.buildEntries(rows, old, official);
  assert.equal(categories.length, 503);
  assert.ok(
    categories.some((e) =>
      e.suggestions.some((s) => s.time === "time_extent_mismatch"),
    ),
  );
});

test("legacy batch reconciler also blocks cached or unverified exact evidence", () => {
  for (const status of ["cached", "unverified", "pending"])
    assert.equal(
      D.reconcile([blankRaw()], [], [rule({ 證據狀態: status })]).candidates
        .length,
      0,
    );
});

test("download failures preserve the real status and never produce normalized evidence", () => {
  const os = require("node:os"),
    path = require("node:path");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "garbage-import-test-"));
  try {
    const result = I.collect(source, out, () => ({
      status: 56,
      stdout: "000\n" + source.url,
      stderr: "CONNECT tunnel failed, response 403",
    }));
    assert.equal(result.status, "download_failed");
    assert.equal(result.httpStatus, "000");
    assert.ok(!Object.hasOwn(result, "acquiredAt"));
    assert.equal(
      fs.readdirSync(out).filter((f) => f.endsWith(".csv")).length,
      0,
    );
    assert.ok(fs.readdirSync(out).some((f) => f.endsWith(".metadata.json")));
  } finally {
    fs.rmSync(out, { recursive: true });
  }
});

test("mixed-source districts cannot cross-match even with the same five-field identity", () => {
  const rows = [{ ...blankRaw(), searchDistrict: "大寮區" }],
    official = [rule({ 行政區: "三民區" })];
  const [entry] = R.buildEntries(rows, [], official);
  assert.equal(entry.suggestions.length, 0);
  assert.equal(
    R.findEvidence(rows, [], official, [], entry, D.key(rows[0])).length,
    0,
  );
  const aliases = [rule({ 行政區: "三民東區" })],
    [aliasEntry] = R.buildEntries([blankRaw()], [], aliases);
  assert.equal(
    R.findEvidence([blankRaw()], [], aliases, [], aliasEntry, D.key(blankRaw()))
      .length,
    1,
  );
});
