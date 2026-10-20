"use strict";
const files = RouteFiles;
const $ = (id) => document.getElementById(id);
const trim = (v) => String(v === undefined || v === null ? "" : v).trim();
const columns = GarbageData.HEADERS;
let mapRows = [],
  inventoryRows = [];

function readCSV(name) {
  return new Promise((resolve, reject) => {
    Papa.parse(name, {
      download: true,
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => trim(h).replace(/^\uFEFF/, ""),
      complete: (res) =>
        res.errors.length
          ? reject(Error(name + " CSV 解析失敗"))
          : resolve(res),
      error: reject,
    });
  });
}
function saveCSV(filename, cols, rows) {
  const content =
    "\uFEFF" +
    Papa.unparse(
      { fields: cols, data: rows.map((row) => cols.map((c) => trim(row[c]))) },
      { newline: "\r\n" },
    );
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}
async function generate() {
  $("start").disabled = true;
  $("downloadMap").disabled = true;
  $("downloadInventory").disabled = true;
  mapRows = [];
  inventoryRows = [];
  const collected = [];
  const rawCounts = new Map();
  const routeGroups = new Map();
  const failures = [];
  let stopCount = 0;
  const settled = await Promise.allSettled(files.map((f) => readCSV(f.name)));
  settled.forEach((result, i) => {
    const f = files[i];
    if (result.status !== "fulfilled") {
      failures.push(f.name);
      return;
    }
    const parsed = result.value;
    if (!(parsed.meta.fields || []).includes("停留地點")) {
      failures.push(f.name + " (缺少停留地點)");
      return;
    }
    for (const row of parsed.data) {
      if (!trim(row["停留地點"])) continue;
      stopCount++;
      const stopKey = GarbageData.key({ ...row, 來源檔案: f.name });
      rawCounts.set(stopKey, (rawCounts.get(stopKey) || 0) + 1);
      const district = trim(row["行政區"]) === "大寮區" ? "大寮區" : f.district;
      const groupKey = [
        district,
        f.name,
        trim(row["責任區"]),
        trim(row["車次"]),
      ].join("\u001f");
      if (!routeGroups.has(groupKey))
        routeGroups.set(groupKey, {
          行政區: district,
          來源檔案: f.name,
          責任區: trim(row["責任區"]),
          車次: trim(row["車次"]),
          停靠紀錄數: 0,
          範例停靠地點: trim(row["停留地點"]),
          原始一般垃圾日筆數: 0,
          待查證: "是",
        });
      const group = routeGroups.get(groupKey);
      group["停靠紀錄數"]++;
      const day = trim(row["一般垃圾日"] || row["一般垃圾清運日"]);
      const url = trim(row["官方來源"]);
      if (day) group["原始一般垃圾日筆數"]++;
      if (
        GarbageData.validRule({
          ...row,
          來源檔案: f.name,
          一般垃圾日: day,
          官方來源: url,
        })
      ) {
        collected.push({
          來源檔案: f.name,
          責任區: trim(row["責任區"]),
          車次: trim(row["車次"]),
          停留地點: trim(row["停留地點"]),
          停留時間: trim(row["停留時間"]),
          一般垃圾日: day,
          官方來源: url,
        });
      }
    }
  });
  // Stop on a missing/invalid existing map: a partial export could erase confirmed rules.
  if (failures.length)
    throw Error("路線載入不完整，停止匯出：" + failures.join("、"));
  const old = await readCSV("garbage-days.csv");
  if (!columns.every((c) => (old.meta.fields || []).includes(c)))
    throw Error("既有對照表欄位不完整，停止匯出");
  if (collected.some((r) => rawCounts.get(GarbageData.key(r)) !== 1))
    throw Error("原始五欄識別不唯一，停止匯出");
  mapRows = GarbageData.mergeRules(old.data, collected);
  const knownGroups = new Set(
    mapRows.map((r) => [r["來源檔案"], r["責任區"], r["車次"]].join("\u001f")),
  );
  inventoryRows = [...routeGroups.values()].map((r) => ({
    ...r,
    待查證: knownGroups.has(
      [r["來源檔案"], r["責任區"], r["車次"]].join("\u001f"),
    )
      ? "部分站點有資料，仍須核對"
      : "是",
  }));
  inventoryRows.sort(
    (a, b) =>
      a["行政區"].localeCompare(b["行政區"], "zh-Hant") ||
      a["來源檔案"].localeCompare(b["來源檔案"]) ||
      a["責任區"].localeCompare(b["責任區"]),
  );
  $("message").textContent =
    "整理完成！\n路線 CSV：" +
    (files.length - failures.length) +
    " / " +
    files.length +
    "\n有效停靠紀錄：" +
    stopCount.toLocaleString("zh-TW") +
    "\n行政區＋來源檔案＋責任區＋車次組合：" +
    inventoryRows.length +
    "\n已確認日期對照規則：" +
    mapRows.length +
    "\n載入失敗：" +
    (failures.length ? failures.join("、") : "無") +
    "\n\n請下載兩份 CSV；確認後再將產生的對照表取代原 garbage-days.csv。";
  $("start").disabled = false;
  $("downloadMap").disabled = false;
  $("downloadInventory").disabled = false;
}
$("start").addEventListener("click", () =>
  generate().catch((err) => {
    $("message").textContent = "整理失敗：" + err.message;
    $("start").disabled = false;
  }),
);
$("downloadMap").addEventListener("click", () =>
  saveCSV("garbage-days-generated.csv", columns, mapRows),
);
$("downloadInventory").addEventListener("click", () =>
  saveCSV(
    "route-inventory.csv",
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
    inventoryRows,
  ),
);
