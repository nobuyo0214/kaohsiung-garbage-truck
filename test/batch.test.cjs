const test = require("node:test"),
  assert = require("node:assert/strict");
const B = require("../js/review-batch"),
  T = require("../js/review-triage"),
  R = require("../js/review-core"),
  D = require("../js/data-core"),
  { load, parse } = require("../scripts/data-tool.cjs");
const raw = load(),
  old = parse("garbage-days.csv"),
  official = parse("data/official/sanmin-west.csv"),
  entries = T.build(raw, old, official);
const fixture = require("./fixtures/review-v3-four-marks.json");
const legacy = () =>
  JSON.parse(
    JSON.stringify({
      ...fixture,
      officialRows: official,
      evidenceRows: [],
      decisions: {},
    }),
  );
const reason = "批次只保留同地點同到點候選，仍缺車次及完整官方時段，不確認日期";
const selected = (e) => ({ recordId: e.id, candidateKey: B.preferred(e).key });
function available(marks = {}) {
  return B.groups(entries)
    .find((g) => g.official.官方路線名稱 === "三民西區4")
    .entries.filter((e) => !B.unavailable(e, B.preferred(e), marks, {}));
}
test("real v3 four-mark fingerprints restore unchanged, with candidate/date counts kept separate", () => {
  const p = B.validateSession(legacy());
  assert.deepEqual(p.batchHistory, []);
  assert.deepEqual(B.counts(entries, p.marks, p.decisions), {
    total: 179,
    accepted: 4,
    rejected: 0,
    pending: 175,
    confirmed: 0,
    pendingDates: 179,
    pairAccepted: 4,
    pairRejected: 0,
    pairPending: 132,
  });
  assert.equal(available(p.marks).length, 13);
  assert.equal(
    entries
      .filter((e) => e.priority === 1)
      .every((e) =>
        e.reasons.some((r) => r.includes("官方頁面未明列CSV責任區")),
      ),
    true,
  );
  assert.deepEqual(R.proposal(raw, old, official, [], p.decisions), old);
});
test("groups preserve all 179 official positions including gaps, and keep source/zone/route separate", () => {
  const groups = B.groups(entries);
  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups.map((g) => g.entries.length).sort((a, b) => a - b),
    [48, 62, 69],
  );
  const g = groups.find((g) => g.official.官方路線名稱 === "三民西區4");
  assert.deepEqual(
    g.rows
      .filter((r) => r.officialOrder >= 51 && r.officialOrder <= 55)
      .map((r) => r.entry.sequence),
    [99, 100, 101, 102, 103],
  );
  for (const alteration of [
    { 來源檔案: "sanmin-east.csv" },
    { 責任區: "九" },
    { 官方路線序號: "different" },
    { 行政區: "大寮區" },
  ])
    assert.notEqual(
      B.routeKey({
        ...entries[0],
        official: { ...entries[0].official, ...alteration },
      }),
      B.routeKey(entries[0]),
    );
  const unknown = entries.slice(0, 2).map((e) => ({
    ...e,
    official: { ...e.official, 官方路線序號: "", 官方路線名稱: "" },
  }));
  assert.equal(B.groups(unknown).length, 2);
  const bad = {
    ...g.entries[1],
    official: {
      ...g.entries[1].official,
      官方清運序: g.entries[0].official.官方清運序,
    },
  };
  assert.equal(B.groups([g.entries[0], bad])[0].duplicateOrder, true);
});
test("batch preview and apply preserve original four, never change decisions, evidence, or old rules", () => {
  const p = legacy(),
    before = R.stable(p),
    chosen = available(p.marks).slice(0, 3);
  const plan = B.preview(
    entries,
    p.marks,
    p.decisions,
    chosen.map(selected),
    reason,
    "2026-10-21T00:00:00Z",
    "batch-one",
  );
  assert.equal(R.stable(p), before);
  const next = B.apply(entries, p.marks, p.decisions, plan);
  assert.equal(B.counts(entries, next, p.decisions).accepted, 7);
  for (const [k, m] of Object.entries(p.marks)) assert.deepEqual(next[k], m);
  assert.deepEqual(
    R.proposal(raw, old, official, p.evidenceRows, p.decisions),
    old,
  );
  assert.throws(() => B.apply(entries, next, p.decisions, plan), /已接受/);
});
test("stale, near-time, rejected, confirmed, ambiguous and mixed-route selections cannot be batch accepted", () => {
  const stale = entries.find((e) => e.priority === 5),
    diff = entries.find((e) => e.priority === 3),
    e = available()[0],
    s = B.preferred(e);
  assert.match(B.unavailable(stale, B.preferred(stale), {}, {}), /舊證據/);
  assert.match(B.unavailable(diff, diff.suggestions[0], {}, {}), /唯一/);
  const marks = {
    [T.reviewKey(e, s.key)]: T.mark(e, s.key, "reject", reason, "test"),
  };
  assert.match(B.unavailable(e, s, marks, {}), /已拒絕/);
  assert.match(
    B.unavailable(e, s, {}, { [e.id]: { action: "confirm" } }),
    /日期確認/,
  );
  assert.match(
    B.unavailable(
      { ...e, suggestions: [{ ...s, unique: false }] },
      { ...s, unique: false },
      {},
      {},
    ),
    /唯一/,
  );
  const other = entries.find(
    (x) =>
      B.preferred(x) && B.routeKey(x) !== B.routeKey(e) && x.priority !== 5,
  );
  assert.throws(
    () =>
      B.preview(
        entries,
        {},
        {},
        [selected(e), selected(other)],
        reason,
        "now",
        "x",
      ),
    /一批只能/,
  );
  assert.throws(
    () =>
      B.preview(
        entries,
        {},
        {},
        [selected(e), selected(e)],
        reason,
        "now",
        "x",
      ),
    /重複/,
  );
});
test("apply revalidates after preview and fails atomically when a manual decision or source changes", () => {
  const e = available()[0],
    s = B.preferred(e),
    plan = B.preview(entries, {}, {}, [selected(e)], reason, "now", "x");
  const marks = {
      [T.reviewKey(e, s.key)]: T.mark(
        e,
        s.key,
        "pending",
        "預覽後新增的待查筆記應保留，不能直接被批次覆蓋",
        "now",
      ),
    },
    before = R.stable(marks);
  assert.throws(() => B.apply(entries, marks, {}, plan), /已變更/);
  assert.equal(R.stable(marks), before);
  const changed = entries.map((x) =>
    x.id === e.id ? { ...x, official: { ...x.official, 備註: "新版來源" } } : x,
  );
  assert.throws(() => B.apply(changed, {}, {}, plan), /已變更/);
});
test("undo restores exact previous notes, preserves later individual edits, and survives backup/restore", () => {
  const p = legacy(),
    chosen = available(p.marks).slice(0, 2),
    e = chosen[0],
    s = B.preferred(e),
    key = T.reviewKey(e, s.key);
  p.marks[key] = T.mark(
    e,
    s.key,
    "pending",
    "批次之前已有的個別待查筆記，撤銷應完整還原",
    "before",
  );
  const original = R.stable(p.marks),
    plan = B.preview(
      entries,
      p.marks,
      {},
      chosen.map(selected),
      reason,
      "now",
      "undo-one",
    ),
    next = B.apply(entries, p.marks, {}, plan);
  const saved = B.validateSession(
    JSON.parse(JSON.stringify(B.session(official, [], {}, next, [plan]))),
  );
  const undone = B.undo(
    entries,
    saved.marks,
    saved.batchHistory,
    plan.id,
    "later",
  );
  assert.equal(R.stable(undone.marks), original);
  assert.equal(undone.restored, 2);
  assert.throws(
    () => B.undo(entries, undone.marks, undone.history, plan.id, "again"),
    /已撤銷/,
  );
  next[key] = T.mark(
    e,
    s.key,
    "reject",
    "批次之後的逐筆拒絕不可被整批撤銷覆蓋",
    "later",
  );
  const partial = B.undo(entries, next, [plan], plan.id, "later");
  assert.equal(partial.restored, 1);
  assert.equal(partial.skipped, 1);
  assert.equal(partial.marks[key].action, "reject");
  assert.deepEqual(R.proposal(raw, old, official, [], {}), old);
});
test("batch history cannot smuggle date decisions and investigation observations remain incomplete", () => {
  const p = legacy();
  assert.throws(
    () => B.validateSession({ ...p, batchHistory: [{ id: "bad" }] }),
    /歷程/,
  );
  const observations = require("../data/investigations/sanmin-west-2026-10-21.json");
  assert.equal(
    observations.sources.reduce((n, s) => n + s.rows.length, 0),
    179,
  );
  assert.equal(
    observations.sources.every(
      (s) => s.authorizesDate === false && s.officialUpdatedAt === null,
    ),
    true,
  );
  assert.equal(official.filter((r) => r.證據狀態 === "stale").length, 12);
  for (const src of observations.sources)
    for (const r of src.rows) assert.equal(R.usable(r), false);
});

test("investigation report preserves four imported decisions and 243 rules; mismatched CSV/JSON creates a review report and no proposal", (t) => {
  const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path"),
    Papa = require("papaparse"),
    { generate } = require("../scripts/evidence-report.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sanmin-investigation-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const progress = path.join(dir, "progress.json"),
    review = path.join(dir, "review.csv"),
    out = path.join(dir, "good");
  fs.writeFileSync(progress, JSON.stringify(legacy()));
  fs.writeFileSync(review, Papa.unparse(T.report(entries, legacy().marks, {})));
  const summary = generate({ progress, review, out });
  assert.equal(summary.counts.accepted, 4);
  assert.equal(summary.counts.pendingDates, 179);
  assert.equal(summary.observationsMatchingSnapshot, 179);
  assert.equal(summary.newRules, 0);
  assert.deepEqual(parse(path.join(out, "garbage-days-proposed.csv")), old);
  assert.equal(parse(path.join(out, "remaining-175-gaps.csv")).length, 175);
  const bad = T.report(entries, legacy().marks, {});
  bad[0].候選審核紀錄 = "CSV與JSON不一致的測試輸入";
  fs.writeFileSync(review, Papa.unparse(bad));
  const badOut = path.join(dir, "bad");
  assert.throws(
    () => generate({ progress, review, out: badOut }),
    /差異已保留/,
  );
  assert.equal(fs.existsSync(path.join(badOut, "input-differences.csv")), true);
  assert.equal(
    fs.existsSync(path.join(badOut, "garbage-days-proposed.csv")),
    false,
  );
});
