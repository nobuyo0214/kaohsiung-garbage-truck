#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  Papa = require("papaparse");
const { load, parse } = require("./data-tool.cjs"),
  D = require("../js/data-core"),
  T = require("../js/review-triage");
const root = path.resolve(__dirname, "..");
function generate(input, out) {
  input = path.resolve(input);
  out = path.resolve(out);
  if (out === root) throw Error("報告必須放在獨立目錄，不能覆蓋正式 CSV");
  const official = parse(input, D.HEADERS),
    old = parse(path.join(root, "garbage-days.csv"), D.HEADERS);
  const entries = T.build(load(), old, official),
    rows = T.report(entries),
    outcomes = D.reconcile(load(), old, official).outcomes;
  for (const row of rows)
    row.原始安全比對狀態 = outcomes[row.審核序號 - 1]["狀態"];
  fs.mkdirSync(out, { recursive: true });
  function csv(name, rows, fields) {
    fields ||= [...new Set(rows.flatMap(Object.keys))];
    fs.writeFileSync(
      path.join(out, name),
      "\uFEFF" +
        Papa.unparse(
          { fields, data: rows.map((r) => fields.map((h) => r[h] ?? "")) },
          { newline: "\r\n" },
        ) +
        "\r\n",
    );
  }
  csv("review-all.csv", rows);
  csv(
    "priority-first.csv",
    rows.filter((r) => r.優先順序 === 1),
  );
  const pairs = entries.flatMap((e) =>
    e.suggestions.map((s, i) => ({
      審核序號: e.sequence,
      建議次序: i + 1,
      優先順序: e.priority,
      建議分類: e.group,
      官方路線: e.official["官方路線名稱"],
      官方責任區: e.official["責任區"],
      官方車次: e.official["車次"],
      官方地點: e.official["停留地點"],
      官方時間: e.official["停留時間"],
      官方一般垃圾日: e.official["一般垃圾日"],
      官方來源: e.official["官方來源"],
      來源檔案: s.row.sourceFile,
      候選行政區: s.row.searchDistrict,
      候選責任區: s.row["責任區"],
      候選車次: s.row["車次"],
      候選地點: s.row["停留地點"],
      候選時間: s.row["停留時間"],
      地點完全相同: s.samePlace ? "是" : "否",
      官方到點減CSV起點分鐘: s.delta,
      時間差異: s.time,
      原始五欄唯一: s.unique ? "是" : "否",
      既有日期: s.existing.map((r) => r["一般垃圾日"]).join("；"),
      性質: "系統建議，非官方確認配對",
      下一步: e.reasons.join("；"),
    })),
  );
  csv("candidate-comparison.csv", pairs);
  // This task has no new full official proof: the only safe proposal is the existing table.
  csv("garbage-days-proposed.csv", D.mergeRules(old, []), D.HEADERS);
  const hash = (p) =>
    crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  const snapshot = path.join(root, "data/official/sanmin-west.csv");
  const summary = {
    officialRows: official.length,
    existingRules: old.length,
    strictStatusCounts: outcomes.reduce(
      (a, r) => ((a[r["狀態"]] = (a[r["狀態"]] || 0) + 1), a),
      {},
    ),
    groups: entries.reduce(
      (a, e) => ((a[e.group] = (a[e.group] || 0) + 1), a),
      {},
    ),
    systemSuggestedPairs: pairs.length,
    rowsWithSuggestions: entries.filter((e) => e.suggestions.length).length,
    rowsWithoutSuggestions: entries.filter((e) => !e.suggestions.length).length,
    automaticConfirmedMatches: 0,
    newEvidenceConfirmedRules: 0,
    pendingDateReview: official.length,
    inputSHA256: hash(input),
    matchesRepositoryOfficialSnapshot: hash(input) === hash(snapshot),
    routeSHA256: hash(path.join(root, "sanmin-west.csv")),
    existingRulesSHA256: hash(path.join(root, "garbage-days.csv")),
    note: "到點相同、文字相似及既有規則僅協助排序；均非本次新增日期證據。查閱日期不是官方更新日期。",
  };
  fs.writeFileSync(
    path.join(out, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2),
      opts = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!["--input", "--out"].includes(args[i]) || !args[i + 1])
        throw Error("用法：--input 官方或審核 CSV --out 報告目錄");
      opts[args[i]] = args[i + 1];
    }
    generate(
      opts["--input"] || path.join(root, "data/official/sanmin-west.csv"),
      opts["--out"] || path.join(root, "reports/sanmin-west-ranked"),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
module.exports = { generate };
