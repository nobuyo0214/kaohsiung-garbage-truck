#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Papa = require("papaparse");
const D = require("../js/data-core.js");
const files = require("../js/route-files.js");
const root = path.resolve(__dirname, "..");
function parse(filename, required = []) {
  const result = Papa.parse(fs.readFileSync(filename, "utf8"), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().replace(/^\uFEFF/, ""),
  });
  if (result.errors.length)
    throw Error(filename + ": " + JSON.stringify(result.errors));
  if (!required.every((h) => result.meta.fields.includes(h)))
    throw Error(filename + ": missing headers " + required.join(","));
  return result.data;
}
function load() {
  return files.flatMap((file) =>
    D.prepareRows(
      parse(path.join(root, file.name), [
        "責任區",
        "車次",
        "停留地點",
        "停留時間",
      ]),
      file,
    ),
  );
}
function csv(filename, rows, fields) {
  fs.writeFileSync(
    filename,
    "\uFEFF" +
      Papa.unparse(
        { fields, data: rows.map((r) => fields.map((h) => r[h] ?? "")) },
        { newline: "\r\n" },
      ).replace(/(?:\r?\n)+$/, "") +
      "\r\n",
  );
}
const reportFields = [
  "來源檔案",
  "資料列",
  "問題",
  "責任區",
  "車次",
  "停留地點",
  "停留時間",
  "詳情",
];
function audit(out) {
  const issues = [],
    raw = load(),
    rules = parse(path.join(root, "garbage-days.csv"), D.HEADERS),
    inventory = new Map();
  const counts = [];
  for (const file of files) {
    const rows = parse(path.join(root, file.name)),
      seen = new Map();
    counts.push({
      file: file.name,
      rows: rows.length,
      sha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(root, file.name)))
        .digest("hex"),
    });
    rows.forEach((r, i) => {
      const issue = (problem, detail = "") =>
        issues.push({
          來源檔案: file.name,
          資料列: i + 2,
          問題: problem,
          ...Object.fromEntries(
            ["責任區", "車次", "停留地點", "停留時間"].map((h) => [h, r[h]]),
          ),
          詳情: detail,
        });
      if (!D.clean(r["停留地點"])) {
        issue("blank_place");
        return;
      }
      const k = D.key({ ...r, sourceFile: file.name });
      if (seen.has(k))
        issue("duplicate_identity", "first data row " + seen.get(k));
      else seen.set(k, i + 2);
      if (!D.normalizeTime(r["停留時間"])) issue("invalid_time");
      if (!D.clean(r["責任區"]) || !D.clean(r["車次"]))
        issue("missing_identity");
      const acceptable = [
        file.district,
        "三民東區",
        "三民西區",
        "北鳳山區",
        "南鳳山區",
      ];
      if (file.name === "sanmin-west.csv") acceptable.push("大寮區");
      if (!acceptable.includes(D.clean(r["行政區"])))
        issue("district_mismatch", D.clean(r["行政區"]));
      for (const [h, min, max] of [
        ["經度", 119, 122],
        ["緯度", 21, 24],
      ])
        if (
          D.clean(r[h]) &&
          (!Number.isFinite(Number(r[h])) ||
            Number(r[h]) < min ||
            Number(r[h]) > max)
        )
          issue("invalid_coordinate", h + "=" + r[h]);
    });
  }
  const index = new Map(),
    rawIndex = new Map();
  for (const r of raw)
    rawIndex.set(D.key(r), [...(rawIndex.get(D.key(r)) || []), r]);
  for (const r of rules) {
    const item = {
      來源檔案: r["來源檔案"],
      資料列: rules.indexOf(r) + 2,
      責任區: r["責任區"],
      車次: r["車次"],
      停留地點: r["停留地點"],
      停留時間: r["停留時間"],
    };
    const problem = (p, detail = "") =>
      issues.push({ ...item, 問題: p, 詳情: detail });
    if (!D.validRule(r)) problem("invalid_rule");
    const k = D.key(r);
    if (index.has(k))
      problem(
        D.normalizeDays(index.get(k)["一般垃圾日"]) ===
          D.normalizeDays(r["一般垃圾日"])
          ? "duplicate_rule"
          : "conflicting_rule",
      );
    index.set(k, r);
    const matches = rawIndex.get(k) || [];
    if (!matches.length) problem("orphan_rule");
    if (matches.length > 1) problem("ambiguous_rule");
  }
  for (const r of raw) {
    const k = JSON.stringify([
      r.searchDistrict,
      r.sourceFile,
      r["責任區"],
      r["車次"],
    ]);
    if (!inventory.has(k))
      inventory.set(k, {
        行政區: r.searchDistrict,
        來源檔案: r.sourceFile,
        責任區: r["責任區"],
        車次: r["車次"],
        停靠紀錄數: 0,
        範例停靠地點: r["停留地點"],
        原始一般垃圾日筆數: 0,
        待查證: "是",
      });
    const group = inventory.get(k);
    group["停靠紀錄數"]++;
    if (r.garbageDay) group["原始一般垃圾日筆數"]++;
  }
  csv(path.join(out, "data-audit.csv"), issues, reportFields);
  csv(
    path.join(out, "route-inventory.csv"),
    [...inventory.values()],
    [
      "行政區",
      "來源檔案",
      "責任區",
      "車次",
      "停靠紀錄數",
      "範例停靠地點",
      "原始一般垃圾日筆數",
      "待查證",
    ],
  );
  const summary = {
    routeFiles: files.length,
    districts: [...new Set(raw.map((r) => r.searchDistrict))].sort(),
    validStops: raw.length,
    rules: rules.length,
    issues: issues.length,
    issueCounts: count(issues, "問題"),
    files: counts,
  };
  fs.writeFileSync(
    path.join(out, "audit-summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        routeFiles: files.length,
        districts: summary.districts.length,
        validStops: raw.length,
        rules: rules.length,
        issueCounts: summary.issueCounts,
      },
      null,
      2,
    ),
  );
}
function count(rows, key) {
  return rows.reduce((a, r) => ((a[r[key]] = (a[r[key]] || 0) + 1), a), {});
}
function reconcile(input, out) {
  const raw = load(),
    existing = parse(path.join(root, "garbage-days.csv"), D.HEADERS),
    official = parse(path.resolve(input), D.HEADERS);
  const result = D.reconcile(raw, existing, official);
  // This validates the proposed union but never writes garbage-days.csv.
  const merged = D.mergeRules(existing, result.candidates);
  const fields = [
    ...new Set([
      ...D.HEADERS,
      ...official.flatMap(Object.keys),
      "狀態",
      "候選筆數",
      "CSV候選",
      "時間檢查",
    ]),
  ];
  csv(path.join(out, "candidates.csv"), result.candidates, D.HEADERS);
  csv(path.join(out, "review.csv"), result.review, fields);
  csv(path.join(out, "outcomes.csv"), result.outcomes, fields);
  csv(path.join(out, "garbage-days-proposed.csv"), merged, D.HEADERS);
  const scopedFiles = new Set(official.map((o) => o["來源檔案"]));
  const coverage = raw
    .filter((r) => scopedFiles.has(r.sourceFile))
    .map((r) => {
      const related = official.filter(
        (o) =>
          o["來源檔案"] === r.sourceFile &&
          D.canonical(o["責任區"]) === D.canonical(r["責任區"]) &&
          D.canonical(o["停留地點"]) === D.canonical(r["停留地點"]),
      );
      const confirmed =
        existing.some((o) => D.key(o) === D.key(r)) || !!r.garbageDay;
      return {
        行政區: r.searchDistrict,
        來源檔案: r.sourceFile,
        責任區: r["責任區"],
        車次: r["車次"],
        停留地點: r["停留地點"],
        CSV時間: r["停留時間"],
        既有日期狀態: confirmed ? "existing_confirmed" : "unconfirmed",
        官方證據狀態: related.length ? "requires_review" : "not_in_snapshot",
        官方時間: related.map((o) => o["停留時間"]).join(" ; "),
        時間檢查: related
          .map((o) => D.timeStatus(o["停留時間"], r["停留時間"]))
          .join(" ; "),
        官方來源: related.map((o) => o["官方來源"]).join(" ; "),
      };
    });
  csv(path.join(out, "raw-coverage.csv"), coverage, [
    "行政區",
    "來源檔案",
    "責任區",
    "車次",
    "停留地點",
    "CSV時間",
    "既有日期狀態",
    "官方證據狀態",
    "官方時間",
    "時間檢查",
    "官方來源",
  ]);
  const summary = {
    officialRows: official.length,
    existingRules: existing.length,
    candidates: result.candidates.length,
    review: result.review.length,
    proposedRules: merged.length,
    statusCounts: count(result.outcomes, "狀態"),
  };
  fs.writeFileSync(
    path.join(out, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
}
if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2),
      options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!["--out", "--official"].includes(args[i]) || !args[i + 1])
        throw Error("Unknown or incomplete option");
      options[args[i]] = args[i + 1];
    }
    const out = path.resolve(options["--out"] || path.join(root, "reports"));
    if (out === root) throw Error("Use a separate output directory");
    fs.mkdirSync(out, { recursive: true });
    if (command === "audit") audit(out);
    else if (command === "reconcile" && options["--official"])
      reconcile(options["--official"], out);
    else
      throw Error(
        "Usage: node scripts/data-tool.cjs audit|reconcile [--official input.csv] --out directory",
      );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
module.exports = { parse, load, audit, reconcile };
