"use strict";
"use strict";
const $ = (id) => document.getElementById(id);
const HEADERS = GarbageData.HEADERS;
const INV_HEADERS = [
  "行政區",
  "來源檔案",
  "責任區",
  "車次",
  "停靠紀錄數",
  "範例停靠地點",
  "原始一般垃圾日筆數",
  "待查證",
];
const norm = (x) => String(x == null ? "" : x).trim();
let inventory = [],
  existing = [],
  added = [],
  selected = null,
  ready = false;
function readCSVFile(file) {
  return new Promise((resolve, reject) =>
    Papa.parse(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => norm(h).replace(/^\uFEFF/, ""),
      complete: (r) =>
        r.errors.length ? reject(Error("CSV 解析失敗")) : resolve(r),
      error: reject,
    }),
  );
}
function fetchCurrentCSV() {
  return new Promise((resolve, reject) =>
    Papa.parse("garbage-days.csv", {
      download: true,
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => norm(h).replace(/^\uFEFF/, ""),
      complete: (r) =>
        r.errors.length ? reject(Error("CSV 解析失敗")) : resolve(r),
      error: reject,
    }),
  );
}
function hasHeaders(result, headers) {
  return headers.every((h) => (result.meta.fields || []).includes(h));
}
const rowKey = GarbageData.key;
const normalizeDays = GarbageData.normalizeDays;
const validRule = GarbageData.validRule;
function sanitizeRule(row) {
  const result = {};
  HEADERS.forEach((h) => (result[h] = norm(row[h])));
  result["一般垃圾日"] =
    normalizeDays(result["一般垃圾日"]) || result["一般垃圾日"];
  return result;
}
function safeText(parent, text) {
  parent.textContent = text;
}
function makeCell(tr, value) {
  const td = document.createElement("td");
  td.textContent = norm(value);
  tr.appendChild(td);
  return td;
}
function renderStats() {
  $("statTotal").textContent = inventory.length.toLocaleString();
  $("statExisting").textContent = existing.length.toLocaleString();
  $("statNew").textContent = added.length.toLocaleString();
  $("exportBtn").disabled = !ready;
  $("downloadWorkBtn").disabled = !added.length;
}
function renderList() {
  const district = $("district").value,
    query = norm($("search").value).toLowerCase(),
    status = $("state").value;
  let matches = inventory.filter(
    (row) =>
      (!district || row["行政區"] === district) &&
      (!query ||
        [
          row["行政區"],
          row["來源檔案"],
          row["責任區"],
          row["車次"],
          row["範例停靠地點"],
        ]
          .join(" ")
          .toLowerCase()
          .includes(query)) &&
      (status === "all" ||
        (status === "missing"
          ? Number(row["原始一般垃圾日筆數"]) === 0
          : Number(row["原始一般垃圾日筆數"]) > 0)),
  );
  $("listStatus").textContent =
    `符合 ${matches.length} 組；只顯示前 250 組，請用行政區或關鍵字縮小範圍。`;
  $("routeRows").replaceChildren();
  const fragment = document.createDocumentFragment();
  matches.slice(0, 250).forEach((row) => {
    const tr = document.createElement("tr");
    [
      "行政區",
      "來源檔案",
      "責任區",
      "車次",
      "停靠紀錄數",
      "範例停靠地點",
      "原始一般垃圾日筆數",
    ].forEach((h) => makeCell(tr, row[h]));
    const key = [
      row["行政區"],
      row["來源檔案"],
      row["責任區"],
      row["車次"],
    ].join("\x1F");
    if (
      selected &&
      key ===
        [
          selected["行政區"],
          selected["來源檔案"],
          selected["責任區"],
          selected["車次"],
        ].join("\x1F")
    )
      tr.className = "selected";
    tr.addEventListener("click", () => selectRoute(row));
    fragment.appendChild(tr);
  });
  $("routeRows").appendChild(fragment);
}
function selectRoute(row) {
  selected = row;
  $("selectedRoute").textContent =
    `已選：${row["行政區"]}｜${row["來源檔案"]}｜責任區 ${row["責任區"]}｜車次 ${row["車次"]}｜停靠紀錄 ${row["停靠紀錄數"]} 筆。範例：${row["範例停靠地點"]}`;
  $("stopPlace").value = norm(row["範例停靠地點"]);
  $("stopTime").value = "";
  $("verified").checked = false;
  $("validation").textContent = "";
  $("addBtn").disabled = false;
  renderList();
}
function updateScope() {
  const route = $("scope").value === "route";
  $("stopPlace").disabled = route;
  $("stopTime").disabled = route;
  if (route) {
    $("stopPlace").value = "";
    $("stopTime").value = "";
    $("scopeHint").textContent =
      "整路線模式：僅在官方資料確認此責任區＋車次的全部停靠紀錄適用相同清運星期時使用。";
  } else {
    $("scopeHint").textContent =
      "站點模式：需填入原 CSV 的完整停留地點；必須填寫原始 CSV 完整停留時間；到點時間不能代替完整時段。";
  }
}
function renderAdded() {
  $("reviewRows").replaceChildren();
  const frag = document.createDocumentFragment();
  added.forEach((row, i) => {
    const tr = document.createElement("tr");
    ["來源檔案", "責任區", "車次"].forEach((h) => makeCell(tr, row[h]));
    makeCell(tr, row["停留地點"] || "整條路線");
    makeCell(tr, row["一般垃圾日"]);
    const td = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "outline";
    btn.textContent = "移除";
    btn.addEventListener("click", () => {
      added.splice(i, 1);
      renderAdded();
    });
    td.appendChild(btn);
    tr.appendChild(td);
    frag.appendChild(tr);
  });
  $("reviewRows").appendChild(frag);
  renderStats();
}
function csvDownload(name, rows) {
  const csv =
    "\uFEFF" +
    Papa.unparse(
      {
        fields: HEADERS,
        data: rows.map((row) => HEADERS.map((h) => norm(row[h]))),
      },
      { newline: "\r\n" },
    );
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function mergeAndValidate() {
  try {
    return { rows: GarbageData.mergeRules(existing, added) };
  } catch (e) {
    return { error: e.message };
  }
}
$("loadBtn").addEventListener("click", async () => {
  ready = false;
  selected = null;
  added = [];
  inventory = [];
  existing = [];
  $("addBtn").disabled = true;
  $("routeRows").replaceChildren();
  $("loadStatus").textContent = "讀取中...";
  try {
    const file = $("inventoryFile").files[0];
    if (!file) throw Error("請先選擇 route-inventory.csv。");
    const inv = await readCSVFile(file);
    if (!hasHeaders(inv, INV_HEADERS)) throw Error("路線盤點 CSV 欄位不正確。");
    inventory = inv.data
      .filter(
        (r) => norm(r["來源檔案"]) && norm(r["責任區"]) && norm(r["車次"]),
      )
      .map((r) => {
        const x = {};
        INV_HEADERS.forEach((h) => (x[h] = norm(r[h])));
        return x;
      });
    if (inventory.length === 0) throw Error("路線盤點清單沒有有效資料。");
    let days;
    const local = $("existingFile").files[0];
    if (local) {
      days = await readCSVFile(local);
    } else {
      try {
        days = await fetchCurrentCSV();
      } catch {
        throw Error("無法自動讀取 garbage-days.csv。請在右側手動選取後重試。");
      }
    }
    if (!hasHeaders(days, HEADERS))
      throw Error("garbage-days.csv 欄位不完整，請上傳正確版本。");
    existing = days.data
      .filter((r) => HEADERS.some((h) => norm(r[h])))
      .map(sanitizeRule);
    const bad = existing.filter((r) => !validRule(r));
    if (bad.length)
      throw Error(
        "既有對照表含無效規則 " + bad.length + " 筆，請先檢查來源與日期。",
      );
    ready = true;
    const options = [
      ...new Set(inventory.map((x) => x["行政區"]).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    $("district").replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "全部行政區";
    $("district").appendChild(all);
    options.forEach((x) => {
      const el = document.createElement("option");
      el.value = x;
      el.textContent = x;
      $("district").appendChild(el);
    });
    $("district").disabled = false;
    $("search").disabled = false;
    $("state").disabled = false;
    $("loadStatus").textContent =
      `完成：讀入 ${inventory.length} 組路線，保留 ${existing.length} 條既有對照規則。已載入的既有規則不會被刪除。請開始選擇路線並核對官方資料。`;
    renderList();
  } catch (e) {
    $("loadStatus").textContent = "無法開始：" + e.message;
  }
  renderAdded();
});
$("ruleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("validation").textContent = "";
  if (!ready || !selected) {
    $("validation").textContent = "請先載入清單並選擇路線。";
    return;
  }
  const route = $("scope").value === "route";
  const place = route ? "" : norm($("stopPlace").value),
    time = route ? "" : norm($("stopTime").value),
    days = normalizeDays($("days").value),
    url = norm($("source").value);
  if (!days) {
    $("validation").textContent =
      "日期格式請使用「一、二、四、五、六」等星期字。";
    return;
  }
  if (route || !place || !GarbageData.normalizeTime(time)) {
    $("validation").textContent =
      "請填寫完整停留地點與原始完整時間；整路線及無時間規則已停用。";
    return;
  }
  if (!$("verified").checked) {
    $("validation").textContent = "請先勾選已核實官方日期及適用範圍。";
    return;
  }
  const row = sanitizeRule({
    來源檔案: selected["來源檔案"],
    責任區: selected["責任區"],
    車次: selected["車次"],
    停留地點: place,
    停留時間: time,
    一般垃圾日: days,
    官方來源: url,
  });
  if (!validRule(row)) {
    $("validation").textContent =
      "資料不完整：請填入有效的政府官方來源網址（gov.tw 網域）。";
    return;
  }
  try {
    const parsed = await new Promise((resolve, reject) =>
      Papa.parse(row["來源檔案"], {
        download: true,
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (h) => norm(h).replace(/^\uFEFF/, ""),
        complete: (r) =>
          r.errors.length ? reject(Error("原始 CSV 解析失敗")) : resolve(r),
        error: reject,
      }),
    );
    const stops = parsed.data.filter(
      (r) =>
        GarbageData.key({ ...r, 來源檔案: row["來源檔案"] }) === rowKey(row),
    );
    if (stops.length !== 1) {
      $("validation").textContent =
        "原始 CSV 必須有唯一、完整五欄吻合的站點；請核對地點、車次及完整時間。";
      return;
    }
    const rawDay = stops[0]["一般垃圾日"] || stops[0]["一般垃圾清運日"];
    if (rawDay && normalizeDays(rawDay) !== days) {
      $("validation").textContent = "與原始已確認日期衝突，停止新增。";
      return;
    }
  } catch (e) {
    $("validation").textContent = "無法驗證原始 CSV：" + e.message;
    return;
  }
  const k = rowKey(row),
    older = [...existing, ...added].find((x) => rowKey(x) === k);
  if (older) {
    $("validation").textContent =
      older["一般垃圾日"] === days
        ? "此規則已存在，無需重複新增。"
        : "相同條件已有不同日期，請核實並先修正舊規則。";
    return;
  }
  added.push(row);
  renderAdded();
  $("validation").textContent =
    "已加入本次核實清單。尚未改動網站資料；記得最後下載 CSV。";
  $("verified").checked = false;
});
$("scope").addEventListener("change", updateScope);
["district", "state"].forEach((id) =>
  $(id).addEventListener("change", renderList),
);
$("search").addEventListener("input", renderList);
$("clearFormBtn").addEventListener("click", () => {
  $("ruleForm").reset();
  updateScope();
  $("validation").textContent = "";
});
$("resetBtn").addEventListener("click", () => {
  if (!confirm("確定清空本頁已填寫但尚未匯出的規則嗎？")) return;
  location.reload();
});
$("exportBtn").addEventListener("click", () => {
  if (!ready) return;
  const result = mergeAndValidate();
  if (result.error) {
    $("exportStatus").textContent = "匯出失敗：" + result.error;
    return;
  }
  csvDownload("garbage-days.csv", result.rows);
  $("exportStatus").textContent =
    `已下載 ${result.rows.length} 條有效規則。請先檢查，再將檔案上傳到 GitHub 取代舊版 garbage-days.csv。`;
});
$("downloadWorkBtn").addEventListener("click", () => {
  if (added.length) csvDownload("verified-rules-backup.csv", added);
});
