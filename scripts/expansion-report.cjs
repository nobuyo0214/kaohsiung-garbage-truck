#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const D = require("../js/data-core"),
  R = require("../js/review-core");
const { load, parse } = require("./data-tool.cjs");
const { build, writeCSV } = require("./official-import.cjs");
const out = path.resolve(process.argv[2] || "reports/expansion");
fs.mkdirSync(out, { recursive: true });
const official = build(out),
  raw = load(),
  existing = parse("garbage-days.csv"),
  entries = R.buildEntries(raw, existing, official);
const automatic = D.reconcile(raw, existing, official).candidates.filter((c) =>
  official.some((o) => R.usable(o) && D.key(o) === D.key(c)),
);
const reports = entries.map((e) => ({
  ...e.official,
  分類: e.categories.join("；"),
  問題: e.issues.join("；"),
  建議數: e.suggestions.length,
  CSV候選: e.suggestions
    .map(
      (s) =>
        `${s.row["責任區"]}／${s.row["車次"]}｜${s.row["停留地點"]}｜${s.row["停留時間"]}｜${s.time}｜起點差 ${s.delta ?? "未知"} 分鐘`,
    )
    .join(" ; "),
}));
writeCSV(path.join(out, "review.csv"), reports);
writeCSV(path.join(out, "candidates.csv"), automatic, D.HEADERS);
writeCSV(
  path.join(out, "garbage-days-proposed.csv"),
  R.proposal(raw, existing, official, [], {}),
  D.HEADERS,
);
const sourceFiles = ["sanmin-east.csv", "sanmin-west.csv", "gangshan.csv"];
const covered = new Set(
    entries.flatMap((e) => e.suggestions.map((s) => s.key)),
  ),
  gaps = new Map();
for (const r of raw.filter((r) => sourceFiles.includes(r.sourceFile))) {
  const k = JSON.stringify([
    r.searchDistrict,
    r.sourceFile,
    r["責任區"],
    r["車次"],
  ]);
  if (!gaps.has(k))
    gaps.set(k, {
      行政區: r.searchDistrict,
      來源檔案: r.sourceFile,
      責任區: r["責任區"],
      車次: r["車次"],
      原始筆數: 0,
      既有日期筆數: 0,
      有審核建議筆數: 0,
      未發現候選筆數: 0,
    });
  const g = gaps.get(k);
  g["原始筆數"]++;
  if (r.garbageDay || existing.some((e) => D.key(e) === D.key(r)))
    g["既有日期筆數"]++;
  if (covered.has(D.key(r))) g["有審核建議筆數"]++;
  else g["未發現候選筆數"]++;
}
writeCSV(
  path.join(out, "coverage-gaps.csv"),
  [...gaps.values()],
  [
    "行政區",
    "來源檔案",
    "責任區",
    "車次",
    "原始筆數",
    "既有日期筆數",
    "有審核建議筆數",
    "未發現候選筆數",
  ],
);
const byFile = sourceFiles.map((file) => {
  const list = entries.filter((e) => e.official["來源檔案"] === file);
  return {
    file,
    officialRows: list.length,
    officialRoutes: new Set(
      list.map((e) => e.official["官方路線序號"] || e.official["官方路線名稱"]),
    ).size,
    withSuggestions: list.filter((e) => e.suggestions.length).length,
    noSuggestions: list.filter((e) => !e.suggestions.length).length,
    exactAutomaticCandidates: automatic.filter((c) => c["來源檔案"] === file)
      .length,
  };
});
const summary = {
  officialEvidenceRows: official.length,
  exactAutomaticCandidates: automatic.length,
  pendingReview: entries.length,
  confirmedNewRules: 0,
  existingRules: existing.length,
  proposedRules: existing.length,
  byFile,
  categories: {},
  sourceStates: {},
  suggestionTimeChecks: {},
};
for (const e of entries) {
  for (const category of e.categories)
    summary.categories[category] = (summary.categories[category] || 0) + 1;
  const state = e.official["證據狀態"] || "verified";
  summary.sourceStates[state] = (summary.sourceStates[state] || 0) + 1;
  for (const s of e.suggestions)
    summary.suggestionTimeChecks[s.time] =
      (summary.suggestionTimeChecks[s.time] || 0) + 1;
}
fs.writeFileSync(
  path.join(out, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
