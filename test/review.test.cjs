const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../js/data-core"),
  R = require("../js/review-core"),
  T = require("../js/review-triage");
const { load, parse } = require("../scripts/data-tool.cjs");
const raw = load(),
  old = parse("garbage-days.csv"),
  official = parse("data/official/sanmin-west.csv");
const entries = T.build(raw, old, official),
  entry = entries[0],
  candidate = entry.suggestions[0];
// Synthetic attestation exercises the gate. It is NOT government evidence or a proposed update.
function proof(e = entry, s = candidate) {
  return {
    ...Object.fromEntries(D.HEADERS.map((h) => [h, s.row[h] || e.official[h]])),
    官方來源: e.official["官方來源"],
    一般垃圾日: e.official["一般垃圾日"],
    對應來源紀錄ID: e.id,
    證據狀態: "verified",
    查證日期: "2026-10-20",
    查證依據: "純測試合成證據，並非真實官方查證結果",
  };
}
test("all 179 retain pending-date status with reproducible groups, no district/zone leakage", () => {
  assert.equal(entries.length, 179);
  assert.deepEqual(
    entries.reduce(
      (a, e) => ((a[e.priority] = (a[e.priority] || 0) + 1), a),
      {},
    ),
    { 1: 4, 2: 63, 3: 40, 4: 60, 5: 12 },
  );
  assert.equal(
    entries.reduce((n, e) => n + e.suggestions.length, 0),
    136,
  );
  for (const e of entries)
    for (const s of e.suggestions) {
      assert.equal(s.row.searchDistrict, "三民區");
      assert.equal(s.row.sourceFile, e.official["來源檔案"]);
      assert.equal(s.row["責任區"], e.official["責任區"]);
    }
  assert.equal(
    T.report(entries).filter((r) => r.日期確認狀態.startsWith("待查證")).length,
    179,
  );
});
test("four first suggestions are not existing rules or sufficient proof; stale twelve never prioritized", () => {
  assert.deepEqual(
    entries.filter((e) => e.priority === 1).map((e) => e.sequence),
    [99, 100, 101, 103],
  );
  for (const e of entries.filter((e) => e.priority === 1)) {
    assert.equal(e.suggestions[0].existing.length, 0);
    assert.equal(e.suggestions[0].time, "time_extent_mismatch");
    assert.equal(
      R.findEvidence(raw, old, official, [], e, e.suggestions[0].key).length,
      0,
    );
  }
  assert.equal(
    entries.filter(
      (e) => e.official["證據狀態"] === "stale" && e.priority === 5,
    ).length,
    12,
  );
});
test("accept/reject records are per-candidate, survive backup, and never authorize dates", () => {
  const marks = {},
    reason = "先保留候選供後續查證，尚缺明確官方車次證據";
  marks[T.reviewKey(entry, candidate.key)] = T.mark(
    entry,
    candidate.key,
    "accept",
    reason,
    "2026-10-20",
  );
  const restored = T.validate(
    JSON.parse(JSON.stringify(T.session(official, [], {}, marks))),
  );
  assert.equal(T.current(entry, candidate, restored.marks).action, "accept");
  assert.deepEqual(R.proposal(raw, old, official, [], restored.decisions), old);
  const multi = entries.find((e) => e.suggestions.length > 1);
  for (const [i, s] of multi.suggestions.entries())
    marks[T.reviewKey(multi, s.key)] = T.mark(
      multi,
      s.key,
      i ? "accept" : "reject",
      reason,
      "2026-10-20",
    );
  assert.equal(T.current(multi, multi.suggestions[0], marks).action, "reject");
  assert.equal(T.current(multi, multi.suggestions[1], marks).action, "accept");
  const changed = {
    ...candidate,
    row: { ...candidate.row, 停留時間: "00:01-00:02" },
  };
  assert.equal(T.current(entry, changed, marks), null);
});
test("confirmation requires fresh complete linked attestation; partial time and guessed trip fail", () => {
  const e = proof();
  for (const bad of [
    { ...e, 證據狀態: "stale" },
    { ...e, 證據狀態: "" },
    { ...e, 查證依據: "" },
    { ...e, 停留時間: entry.official["停留時間"] },
    { ...e, 車次: "" },
    { ...e, 對應來源紀錄ID: "wrong" },
  ]) {
    assert.equal(
      R.findEvidence(raw, old, official, [bad], entry, candidate.key).length,
      0,
    );
  }
  assert.throws(
    () =>
      R.decide(
        raw,
        old,
        official,
        [],
        entry,
        candidate.key,
        "confirm",
        "只接受候選並非確認日期證據",
        "2026-10-20",
      ),
    /缺少完整五欄/,
  );
  assert.equal(
    R.findEvidence(raw, old, official, [e], entry, candidate.key).length,
    1,
  );
});
test("proposal revalidates source/raw/proof and preserves existing 243 rows exactly", () => {
  const p = proof(),
    d = R.decide(
      raw,
      old,
      official,
      [p],
      entry,
      candidate.key,
      "confirm",
      "測試專用的人工確認依據，沒有真實資料新增",
      "2026-10-20",
    );
  const merged = R.proposal(raw, old, official, [p], { [entry.id]: d });
  assert.equal(merged.length, 244);
  assert.deepEqual(merged.slice(0, 243), old);
  assert.throws(
    () => R.proposal(raw, old, official, [], { [entry.id]: d }),
    /已變更/,
  );
  assert.throws(
    () =>
      R.proposal(
        raw,
        old,
        official,
        [{ ...p, 查證依據: "測試證據已被改動，必須重新核對" }],
        { [entry.id]: d },
      ),
    /已變更/,
  );
  assert.throws(
    () =>
      R.proposal(
        raw.map((r) =>
          D.key(r) === candidate.key ? { ...r, 村里: "測試變更" } : r,
        ),
        old,
        official,
        [p],
        { [entry.id]: d },
      ),
    /已變更/,
  );
  assert.deepEqual(R.proposal(raw, old, official, [], {}), old);
});
test("contradictions, duplicate raw keys, different source/zone/trip and existing dates block evidence", () => {
  const p = proof();
  assert.equal(
    R.findEvidence(
      raw,
      old,
      official,
      [p, { ...p, 車次: "99" }],
      entry,
      candidate.key,
    ).length,
    0,
  );
  assert.equal(
    R.findEvidence(
      raw,
      old,
      official,
      [p, { ...p, 一般垃圾日: "三" }],
      entry,
      candidate.key,
    ).length,
    0,
  );
  assert.equal(
    R.findEvidence(
      [...raw, candidate.row],
      old,
      official,
      [p],
      entry,
      candidate.key,
    ).length,
    0,
  );
  assert.equal(
    R.findEvidence(
      raw,
      [...old, { ...p, 一般垃圾日: "三" }],
      official,
      [p],
      entry,
      candidate.key,
    ).length,
    0,
  );
  for (const altered of [
    { 來源檔案: "sanmin-east.csv" },
    { 責任區: "十" },
    { 車次: "99" },
    { 行政區: "大寮區" },
  ]) {
    const x = { ...entry, official: { ...entry.official, ...altered } };
    assert.equal(
      R.findEvidence(raw, old, official, [p], x, candidate.key).length,
      0,
    );
  }
});
test("restore rejects corrupt structures and forged date confirmation rather than permitting exports", () => {
  const s = T.session(official, [], {}, {});
  assert.throws(() => T.validate({ ...s, marks: [] }), /候選/);
  assert.throws(
    () => T.validate({ ...s, officialRows: [official[0], official[0]] }),
    /重複/,
  );
  assert.throws(
    () =>
      T.validate({
        ...s,
        decisions: {
          fake: { recordId: "fake", action: "guess", reason: "bad" },
        },
      }),
    /無效/,
  );
  assert.throws(
    () =>
      R.proposal(raw, old, official, [], {
        [entry.id]: {
          recordId: entry.id,
          action: "confirm",
          reason: "偽造進度不能直接取得日期確認",
        },
      }),
    /已變更/,
  );
});

test("no-candidate notes survive progress and reports; invalid calendar dates are not verified", () => {
  const e = entries.find((e) => !e.suggestions.length),
    reason = "官方此站目前沒有同責任區候選，保留資料缺口供下次查證";
  const m = T.mark(e, "", "pending", reason, "2026-10-20");
  const marks = { [T.reviewKey(e, "")]: m };
  const restored = T.validate(
    JSON.parse(JSON.stringify(T.session(official, [], {}, marks))),
  );
  assert.equal(
    T.current(e, { key: "", row: null }, restored.marks).reason,
    reason,
  );
  assert.match(T.report([e], restored.marks)[0].候選審核紀錄, /資料缺口/);
  assert.throws(() => T.mark(e, "", "accept", reason, "2026-10-20"), /候選/);
  assert.equal(R.usable({ ...proof(), 查證日期: "2026-02-30" }), false);
  assert.equal(R.usable({ ...proof(), 查證日期: "2026-99-99" }), false);
});

test("new contradictory evidence withdraws proposal authority and preserves original audit record and progress", () => {
  const p = proof(),
    d = R.decide(
      raw,
      old,
      official,
      [p],
      entry,
      candidate.key,
      "confirm",
      "測試用完整證據依據，非實際官方查證",
      "2026-10-20",
    );
  const both = [p, { ...p, 一般垃圾日: "三" }];
  const next = R.suspendInvalidDecisions(
    raw,
    old,
    official,
    both,
    { [entry.id]: d },
    "2026-10-20",
  );
  assert.equal(next[entry.id].action, "reject");
  assert.equal(next[entry.id].reason, d.reason);
  assert.equal(next[entry.id].evidenceFingerprint, d.evidenceFingerprint);
  const restored = T.validate(
    JSON.parse(JSON.stringify(T.session(official, both, next, {}))),
  );
  assert.deepEqual(
    R.proposal(raw, old, official, both, restored.decisions),
    old,
  );
});
