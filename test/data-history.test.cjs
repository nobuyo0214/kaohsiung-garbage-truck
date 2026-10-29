const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const H = require("../scripts/data-history.cjs");
const headers = [
    "責任區",
    "車次",
    "停留地點",
    "停留時間",
    "回收日",
    "經度",
    "緯度",
  ],
  record = [
    "1",
    "2",
    "中山路100號",
    "17:00-17:02",
    "一、四",
    "120.3000",
    "22.6000",
  ];
function input(rows = [record], fields = headers) {
  return [
    {
      name: "fixture.csv",
      district: "三民區",
      content: require("papaparse").unparse({ fields, data: rows }),
    },
  ];
}
test("route revisions repeat exactly, filename order is fixed; row/header/newline order only changes bytes", () => {
  const a = H.snapshot(
    input([record, [...record.slice(0, 2), "建工路2號", ...record.slice(3)]]),
  );
  assert.deepEqual(
    a,
    H.snapshot(
      input([record, [...record.slice(0, 2), "建工路2號", ...record.slice(3)]]),
    ),
  );
  const original = input([
      record,
      [...record.slice(0, 2), "建工路2號", ...record.slice(3)],
    ]),
    rowChange = H.snapshot([
      {
        ...original[0],
        content: original[0].content
          .split("\r\n")
          .reverse()
          .reverse()
          .join("\n"),
      },
    ]);
  assert.equal(a.contentRevision, rowChange.contentRevision);
  assert.notEqual(a.byteRevision, rowChange.byteRevision);
  const ordered = H.snapshot(
    input([[...record].reverse()], [...headers].reverse()),
  );
  assert.equal(ordered.contentRevision, H.snapshot(input()).contentRevision);
  const second = { ...original[0], name: "b.csv" };
  assert.deepEqual(
    H.snapshot([second, ...original]),
    H.snapshot([...original, second]),
  );
  const reversed = H.snapshot(
    input([[...record.slice(0, 2), "建工路2號", ...record.slice(3)], record]),
  );
  assert.equal(a.contentRevision, reversed.contentRevision);
  assert.equal(H.differences(a, reversed).stationContentChanged, false);
});
test("unique same identity modified value, added, removed and changed identity have explicit counts", () => {
  const a = H.snapshot(input()),
    changed = [...record];
  changed[4] = "二";
  const modified = H.differences(a, H.snapshot(input([changed])));
  assert.deepEqual(modified.totals, {
    added: 0,
    removed: 0,
    modified: 1,
    uncertainBefore: 0,
    uncertainAfter: 0,
  });
  const extra = [...record];
  extra[2] = "建工路10號";
  assert.equal(
    H.differences(a, H.snapshot(input([record, extra]))).totals.added,
    1,
  );
  assert.equal(H.differences(a, H.snapshot(input([]))).totals.removed, 1);
  const time = [...record];
  time[3] = "18:00-18:02";
  const diff = H.differences(a, H.snapshot(input([time])));
  assert.equal(diff.totals.added, 1);
  assert.equal(diff.totals.removed, 1);
  assert.equal(diff.totals.modified, 0);
});
test("ambiguous duplicate identities and unidentified blank records do not invent precise modifications", () => {
  const changed = [...record];
  changed[4] = "二";
  const diff = H.differences(
    H.snapshot(input([record, record])),
    H.snapshot(input([record, changed])),
  );
  assert.deepEqual(diff.totals, {
    added: 0,
    removed: 0,
    modified: 0,
    uncertainBefore: 1,
    uncertainAfter: 1,
  });
  const blank = [...record];
  blank[2] = "";
  const blankChanged = [...blank];
  blankChanged[4] = "五";
  assert.equal(
    H.differences(H.snapshot(input([blank])), H.snapshot(input([blankChanged])))
      .totals.uncertainAfter,
    1,
  );
});
test("current baseline is preserved across program builds, official date remains null and no source file is changed", () => {
  const paths = require("../js/route-files")
      .map((f) => f.name)
      .concat("garbage-days.csv"),
    before = paths.map((p) => fs.readFileSync(p)),
    historyText = fs.readFileSync("data/history/index.json", "utf8");
  const one = H.generate({ check: true }),
    two = H.generate({ check: true });
  assert.deepEqual(one, two);
  assert.equal(one.current.counts.validRecords, 13871);
  assert.equal(one.current.counts.districts, 38);
  assert.equal(one.current.counts.files, 39);
  assert.equal(one.history.entries[0].kind, "baseline");
  assert.equal(one.history.entries.at(-1).officialPublishedAt, null);
  assert.equal(fs.readFileSync("data/history/index.json", "utf8"), historyText);
  paths.forEach((p, i) => assert.deepEqual(fs.readFileSync(p), before[i]));
});
test("isolated build bootstraps missing history once, rejects stale artifacts and appends only real file changes", () => {
  const os = require("node:os"),
    path = require("node:path"),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kh-history-")),
    fixtures = [{ name: "fixture.csv", district: "三民區" }],
    options = {
      directory: dir,
      inputFiles: fixtures,
      now: () => "2026-10-29T16:00:00Z",
    };
  try {
    fs.writeFileSync(path.join(dir, "fixture.csv"), input()[0].content);
    assert.throws(() => H.generate({ ...options, check: true }), /過期/);
    const baseline = H.generate(options);
    assert.equal(baseline.history.entries.length, 1);
    assert.deepEqual(H.generate(options), baseline);
    const modified = [...record];
    modified[4] = "五";
    fs.writeFileSync(
      path.join(dir, "fixture.csv"),
      input([modified])[0].content,
    );
    assert.throws(() => H.generate({ ...options, check: true }), /過期/);
    const next = H.generate(options);
    assert.equal(next.history.entries.length, 2);
    assert.equal(next.history.entries[1].difference.totals.modified, 1);
    assert.equal(next.history.entries[1].officialPublishedAt, null);
    assert.equal(
      H.generate({ ...options, check: true }).history.entries.length,
      2,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
