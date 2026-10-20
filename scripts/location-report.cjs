#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  Papa = require("papaparse");
const { load } = require("./data-tool.cjs"),
  L = require("../js/location-quality"),
  T = require("../js/search-tools");
function generate(
  out = path.resolve(__dirname, "../reports/location-quality"),
) {
  const rows = load(),
    topology = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../data/geo/kaohsiung.topo.json"),
      ),
    ),
    audit = L.analyze(rows, topology);
  const data = audit.records.map((r) => ({
    來源檔案: r.row.sourceFile,
    行政區: r.row.searchDistrict,
    原始流水號: r.row.Seq || "",
    責任區: r.row.責任區,
    車次: r.row.車次,
    停留地點: r.row.停留地點,
    停留時間: r.row.停留時間,
    原始經度: r.row.經度 || "",
    原始緯度: r.row.緯度 || "",
    可提供導航: r.eligible ? "是（通過品質檢查，非逐站現勘確認）" : "否",
    原因: r.reasons.map((k) => L.labels[k]).join("；"),
    導航網址: L.navigationURL(r) || "",
  }));
  const districts = {},
    reasons = {};
  for (const r of audit.records) {
    const d = (districts[r.row.searchDistrict] ||= {
      total: 0,
      eligible: 0,
      unavailable: 0,
    });
    d.total++;
    d[r.eligible ? "eligible" : "unavailable"]++;
    for (const reason of r.reasons)
      reasons[reason] = (reasons[reason] || 0) + 1;
  }
  const display = T.createIndex(rows),
    visible = [...display.districts.values()].flat();
  const summary = {
    policyVersion: 1,
    totalSourceRecords: rows.length,
    eligibleSourceRecords: audit.records.filter((r) => r.eligible).length,
    unavailableSourceRecords: audit.records.filter((r) => !r.eligible).length,
    displayCards: visible.length,
    eligibleCards: visible.filter((r) => audit.byRow.get(r).eligible).length,
    unavailableCards: visible.filter((r) => !audit.byRow.get(r).eligible)
      .length,
    reasons,
    districts,
    geometrySHA256: crypto
      .createHash("sha256")
      .update(
        fs.readFileSync(
          path.resolve(__dirname, "../data/geo/kaohsiung.topo.json"),
        ),
      )
      .digest("hex"),
    note: "原因可重疊。通過表示原始座標符合保守品質政策，不代表官方逐站重新確認；未修正任何座標。",
  };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, "records.csv"),
    "\uFEFF" + Papa.unparse(data, { newline: "\n" }) + "\n",
  );
  fs.writeFileSync(
    path.join(out, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  return summary;
}
if (require.main === module)
  console.log(JSON.stringify(generate(process.argv[2]), null, 2));
module.exports = { generate };
