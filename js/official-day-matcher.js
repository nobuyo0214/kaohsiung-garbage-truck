"use strict";
const $ = (id) => document.getElementById(id),
  D = GarbageData,
  R = GarbageReview,
  STORAGE = "garbage-review-v2";
let state = null,
  raw = [],
  existing = [],
  entries = [],
  selectedId = "",
  page = 0;
const PAGE_SIZE = 40;
const issueLabels = {
  unverified_evidence: "來源為快取或尚未核實",
  missing_identity: "五欄識別不完整",
  missing_trip: "官方未提供車次",
  missing_zone: "官方未提供責任區",
  time_extent_mismatch: "到點時間與完整時段不同",
  time_mismatch: "停靠時間不同",
  place_mismatch: "站點文字不同",
  source_unverified: "來源為快取或尚未核實",
  stale_evidence: "官方證據過舊",
  invalid_time: "時間無法完整解析",
  official_conflict: "官方日期資料衝突",
  existing_conflict: "與既有日期規則衝突",
  raw_conflict: "與原始已確認日期衝突",
  ambiguous_raw: "原始五欄識別重複",
  no_match: "找不到五欄精確對應",
  candidate: "五欄精確候選，待人工確認",
  already_confirmed: "既有規則已確認",
  missing_garbage_days: "未提供一般垃圾日",
  invalid_source: "官方來源網址無效",
  unknown_file: "未知來源檔案",
};

function read(input, download, headers) {
  return new Promise((resolve, reject) =>
    Papa.parse(input, {
      download,
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().replace(/^\uFEFF/, ""),
      complete: (r) => {
        if (
          r.errors.length ||
          !headers.every((h) => (r.meta.fields || []).includes(h))
        )
          reject(Error("CSV 解析失敗或缺少必要欄位"));
        else resolve(r.data);
      },
      error: reject,
    }),
  );
}
function save(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function saveCSV(
  name,
  rows,
  fields = [...new Set([...D.HEADERS, ...rows.flatMap(Object.keys)])],
) {
  save(
    name,
    "\uFEFF" +
      Papa.unparse(
        { fields, data: rows.map((r) => fields.map((h) => r[h] ?? "")) },
        { newline: "\r\n" },
      ),
    "text/csv;charset=utf-8",
  );
}
async function loadBase() {
  const [old, groups] = await Promise.all([
    read("garbage-days.csv", true, D.HEADERS),
    Promise.all(
      RouteFiles.map(async (f) =>
        D.prepareRows(
          await read(f.name, true, ["責任區", "車次", "停留地點", "停留時間"]),
          f,
        ),
      ),
    ),
  ]);
  D.mergeRules(old, []);
  return { old, rows: groups.flat() };
}
function persist() {
  if (!state) return;
  try {
    localStorage.setItem(STORAGE, JSON.stringify(state));
    $("storageStatus").textContent =
      "已自動保存本機進度。未解決、拒絕及確認紀錄均會保留；可匯出 JSON 備份。";
  } catch {
    $("storageStatus").textContent =
      "瀏覽器無法保存（可能空間不足），請立即匯出進度 JSON 備份。";
  }
}
function district(o) {
  return (
    o["行政區"] ||
    RouteFiles.find((f) => f.name === o["來源檔案"])?.district ||
    "未提供"
  );
}
function routeKey(o) {
  return JSON.stringify([
    o["來源檔案"],
    o["官方路線序號"] || o["官方路線名稱"] || o["官方來源"],
  ]);
}
function option(select, value, label) {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = label;
  select.appendChild(el);
}
function updateFilters() {
  const ds = $("reviewDistrict");
  ds.replaceChildren();
  option(ds, "", "全部行政區");
  [...new Set(entries.map((e) => district(e.official)))]
    .sort()
    .forEach((d) => option(ds, d, d));
  updateRoutes();
}
function updateRoutes() {
  const rs = $("reviewRoute");
  rs.replaceChildren();
  option(rs, "", "全部路線");
  const routes = new Map();
  for (const e of entries)
    if (
      !$("reviewDistrict").value ||
      district(e.official) === $("reviewDistrict").value
    )
      routes.set(
        routeKey(e.official),
        `${e.official["官方路線名稱"] || e.official["來源檔案"]} ${e.official["官方路線序號"] || ""}`,
      );
  for (const [k, v] of routes) option(rs, k, v);
}
function summary() {
  const strict = D.reconcile(raw, existing, state.officialRows),
    counts = {};
  for (const e of entries)
    for (const category of e.categories)
      counts[category] = (counts[category] || 0) + 1;
  const decisions = Object.values(state.decisions);
  $("summary").textContent = JSON.stringify(
    {
      官方筆數: entries.length,
      既有規則: existing.length,
      新增候選: strict.candidates.filter((r) =>
        state.officialRows.some((o) => R.usable(o) && D.key(o) === D.key(r)),
      ).length,
      待審核: entries.filter((e) => !state.decisions[e.id]).length,
      已確認: decisions.filter((d) => d.action === "confirm").length,
      已拒絕: decisions.filter((d) => d.action === "reject").length,
      分類: counts,
    },
    null,
    2,
  );
  for (const id of [
    "exportSession",
    "loadSupport",
    "candidates",
    "review",
    "proposed",
    "decisionLog",
  ])
    $(id).disabled = false;
  try {
    R.proposal(
      raw,
      existing,
      state.officialRows,
      state.evidenceRows,
      state.decisions,
    );
  } catch (e) {
    $("proposed").disabled = true;
    $("validation").textContent = "提案停止：" + e.message;
  }
}
function renderList() {
  if (!state) return;
  const matches = entries.filter(
    (e) =>
      (!$("reviewDistrict").value ||
        district(e.official) === $("reviewDistrict").value) &&
      (!$("reviewRoute").value ||
        routeKey(e.official) === $("reviewRoute").value) &&
      (!$("category").value || e.categories.includes($("category").value)) &&
      (!$("decisionFilter").value ||
        (state.decisions[e.id]?.action || "pending") ===
          $("decisionFilter").value) &&
      (!$("query").value ||
        D.normalize(JSON.stringify(e.official)).includes(
          D.normalize($("query").value),
        )),
  );
  page = Math.min(page, Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1));
  $("rows").replaceChildren();
  for (const e of matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const tr = document.createElement("tr");
    tr.className = "entry" + (e.id === selectedId ? " selected" : "");
    const first = document.createElement("td"),
      button = document.createElement("button");
    button.type = "button";
    button.textContent =
      e.category +
      "／" +
      ({ confirm: "已確認", reject: "已拒絕" }[state.decisions[e.id]?.action] ||
        "待審核");
    button.addEventListener("click", () => select(e.id));
    first.appendChild(button);
    tr.appendChild(first);
    const td = document.createElement("td");
    td.textContent = `${e.official["停留地點"]} ${e.official["停留時間"]}`;
    tr.appendChild(td);
    $("rows").appendChild(tr);
  }
  $("listStatus").textContent =
    `符合 ${matches.length} 筆，第 ${page + 1} 頁，每頁 ${PAGE_SIZE} 筆。`;
  $("previous").disabled = page === 0;
  $("next").disabled = (page + 1) * PAGE_SIZE >= matches.length;
}
function selected() {
  return entries.find((e) => e.id === selectedId);
}
function select(id) {
  selectedId = id;
  const e = selected();
  if (!e) return;
  const decision = state.decisions[id];
  $("reason").value = decision?.reason || "";
  $("verified").checked = false;
  $("validation").textContent = "";
  $("selectedStatus").textContent =
    `${e.official["官方路線名稱"] || e.official["來源檔案"]}／${e.category}`;
  $("recordId").textContent = "來源紀錄ID：" + e.id;
  $("sourceInfo").replaceChildren();
  if (D.officialURL(e.official["官方來源"])) {
    const a = document.createElement("a");
    a.href = e.official["官方來源"];
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "開啟官方來源";
    $("sourceInfo").appendChild(a);
  }
  $("issues").textContent = e.issues
    .map((code) => issueLabels[code] || code)
    .join("、");
  $("rawFields").textContent = JSON.stringify(e.official, null, 2);
  const select = $("candidateSelect");
  select.replaceChildren();
  for (const s of e.suggestions)
    option(
      select,
      s.key,
      `${s.row["責任區"]}／${s.row["車次"]}｜${s.row["停留地點"]}｜${s.row["停留時間"]}｜起點差 ${s.delta === null ? "未知" : s.delta + " 分鐘"}`,
    );
  select.disabled = !e.suggestions.length;
  if (decision && e.suggestions.some((s) => s.key === decision.candidateKey))
    select.value = decision.candidateKey;
  $("reject").disabled = false;
  $("reopen").disabled = !decision;
  renderComparison();
  renderList();
}
function renderComparison() {
  const e = selected();
  if (!e) return;
  const s = e.suggestions.find((s) => s.key === $("candidateSelect").value),
    candidate = s?.row;
  $("comparison").replaceChildren();
  for (const h of D.HEADERS.filter((h) => h !== "官方來源")) {
    const official = e.official[h] || "未提供",
      rawValue =
        h === "來源檔案"
          ? candidate?.sourceFile
          : h === "一般垃圾日"
            ? existing.find((r) => D.key(r) === D.key(candidate || {}))?.[
                "一般垃圾日"
              ] || candidate?.garbageDay
            : candidate?.[h];
    const tr = document.createElement("tr");
    if (D.canonical(official) !== D.canonical(rawValue)) tr.className = "diff";
    for (const v of [h, official, rawValue || "未提供"]) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.appendChild(td);
    }
    $("comparison").appendChild(tr);
  }
  const proofs = candidate
    ? R.findEvidence(
        raw,
        existing,
        state.officialRows,
        state.evidenceRows,
        e,
        D.key(candidate),
      )
    : [];
  $("evidenceStatus").textContent = proofs.length
    ? `有完整五欄官方證據可核對：${proofs[0]["官方來源"]}。確認後仍會重新驗證。`
    : "尚無完整五欄官方證據；不能確認。可保留待審核或記錄拒絕原因，再匯入官方補充資料。";
  if (s?.time === "time_extent_mismatch")
    $("evidenceStatus").textContent +=
      " 官方到點時間與 CSV 完整時段不同，未提供的離站時間不能推測。";
  $("confirm").disabled = !proofs.length || !$("verified").checked;
}
async function install(value) {
  R.validateSession(value);
  const base = await loadBase();
  raw = base.rows;
  existing = base.old;
  value.decisions = Object.assign(Object.create(null), value.decisions);
  state = value;
  entries = R.buildEntries(raw, existing, state.officialRows);
  selectedId = "";
  page = 0;
  updateFilters();
  renderList();
  persist();
  if (entries.length) select(entries[0].id);
  summary();
}
async function start(input, download) {
  $("status").textContent = "正在載入並比對資料…";
  $("run").disabled = true;
  $("loadPilot").disabled = true;
  // Previous successful state remains usable if a new file fails validation.
  try {
    const official = await read(input, download, D.HEADERS);
    const uniqueRows = new Map();
    for (const o of official) {
      const key = R.id(o);
      if (uniqueRows.has(key) && R.stable(uniqueRows.get(key)) !== R.stable(o))
        throw Error("來源紀錄ID重複且資料不同，停止匯入");
      uniqueRows.set(key, o);
    }
    const unique = [...uniqueRows.values()];
    await install({
      version: 2,
      officialRows: unique,
      evidenceRows: [],
      decisions: {},
    });
    $("status").textContent =
      "比對完成。請選取紀錄並核對差異；資料不一致時不會自動新增日期。";
  } catch (e) {
    $("status").textContent = "停止：" + e.message;
  } finally {
    $("run").disabled = false;
    $("loadPilot").disabled = false;
  }
}
$("run").addEventListener("click", () => {
  const file = $("official").files[0];
  if (file) start(file, false);
  else $("status").textContent = "請選擇官方資料 CSV。";
});
$("loadPilot").addEventListener("click", () =>
  start("reports/expansion/official.csv", true),
);
$("loadSupport").addEventListener("click", async () => {
  try {
    if (!state || !$("supportFile").files[0])
      throw Error("請先載入工作資料並選擇補充證據");
    const rows = await read($("supportFile").files[0], false, D.HEADERS);
    const next = { ...state, evidenceRows: [...state.evidenceRows, ...rows] };
    R.validateSession(next);
    state = next;
    persist();
    summary();
    renderComparison();
    $("status").textContent =
      `已加入 ${rows.length} 筆補充資料；仍須逐筆確認證據。`;
  } catch (e) {
    $("status").textContent = "停止：" + e.message;
  }
});
for (const [button, action] of [
  ["confirm", "confirm"],
  ["reject", "reject"],
])
  $(button).addEventListener("click", () => {
    try {
      const e = selected();
      if (!e) throw Error("請選取官方紀錄");
      if (action === "confirm" && !$("verified").checked)
        throw Error("請先核實官方欄位");
      const decision = R.decide(
        raw,
        existing,
        state.officialRows,
        state.evidenceRows,
        e,
        $("candidateSelect").value,
        action,
        $("reason").value,
        new Date().toISOString(),
      );
      state.decisions[e.id] = decision;
      persist();
      summary();
      select(e.id);
      $("validation").textContent =
        action === "confirm"
          ? "已確認並保存。下載提案時會重新驗證。"
          : "已拒絕並保存原因。";
    } catch (e) {
      $("validation").textContent = e.message;
    }
  });
$("reopen").addEventListener("click", () => {
  const e = selected();
  if (!e) return;
  delete state.decisions[e.id];
  persist();
  summary();
  select(e.id);
});
$("candidateSelect").addEventListener("change", () => {
  $("verified").checked = false;
  renderComparison();
});
$("verified").addEventListener("change", renderComparison);
$("reviewDistrict").addEventListener("change", () => {
  updateRoutes();
  page = 0;
  renderList();
});
for (const id of ["reviewRoute", "category", "decisionFilter"])
  $(id).addEventListener("change", () => {
    page = 0;
    renderList();
  });
$("query").addEventListener("input", () => {
  page = 0;
  renderList();
});
$("previous").addEventListener("click", () => {
  page--;
  renderList();
});
$("next").addEventListener("click", () => {
  page++;
  renderList();
});
$("exportSession").addEventListener("click", () => {
  if (state)
    save(
      "review-progress.json",
      JSON.stringify(state, null, 2),
      "application/json",
    );
});
async function restore(text) {
  if (text.length > 10 * 1024 * 1024) throw Error("進度檔超過 10 MiB");
  await install(JSON.parse(text));
  $("status").textContent = "進度已還原；匯出時會重新驗證來源及原始 CSV。";
}
$("restoreLocal").addEventListener("click", async () => {
  try {
    const text = localStorage.getItem(STORAGE);
    if (!text) throw Error("沒有本機進度");
    await restore(text);
  } catch (e) {
    $("storageStatus").textContent = "無法還原：" + e.message;
  }
});
$("importSession").addEventListener("click", async () => {
  try {
    const file = $("sessionFile").files[0];
    if (!file) throw Error("請選擇進度 JSON");
    if (file.size > 10 * 1024 * 1024) throw Error("進度檔過大");
    await restore(await file.text());
  } catch (e) {
    $("storageStatus").textContent = "無法還原：" + e.message;
  }
});
$("candidates").addEventListener("click", () => {
  if (state)
    saveCSV(
      "candidates.csv",
      D.reconcile(raw, existing, state.officialRows).candidates.filter((c) =>
        state.officialRows.some((o) => R.usable(o) && D.key(o) === D.key(c)),
      ),
      D.HEADERS,
    );
});
$("review").addEventListener("click", () => {
  if (state)
    saveCSV(
      "review.csv",
      entries.map((e) => ({
        ...e.official,
        來源紀錄ID: e.id,
        分類: e.category,
        問題: e.issues.join("；"),
        審核狀態: state.decisions[e.id]?.action || "pending",
        依據: state.decisions[e.id]?.reason || "",
        CSV候選: e.suggestions
          .map(
            (s) =>
              `${s.row["責任區"]}／${s.row["車次"]}｜${s.row["停留地點"]}｜${s.row["停留時間"]}｜${s.time}｜${s.delta}`,
          )
          .join(" ; "),
      })),
    );
});
$("proposed").addEventListener("click", async () => {
  try {
    if (!state) return;
    $("proposed").disabled = true;
    const latest = await loadBase();
    const proposed = R.proposal(
      latest.rows,
      latest.old,
      state.officialRows,
      state.evidenceRows,
      state.decisions,
    );
    raw = latest.rows;
    existing = latest.old;
    saveCSV("garbage-days-proposed.csv", proposed, D.HEADERS);
    summary();
    $("validation").textContent =
      "已依網站目前的原始資料及日期表重新驗證並匯出。";
  } catch (e) {
    $("proposed").disabled = true;
    $("validation").textContent = "停止匯出，請重新載入資料：" + e.message;
  }
});
$("decisionLog").addEventListener("click", () => {
  if (state)
    saveCSV("review-decisions.csv", Object.values(state.decisions), [
      "recordId",
      "candidateKey",
      "action",
      "reason",
      "sourceURL",
      "decidedAt",
      "recordFingerprint",
      "candidateFingerprint",
      "evidenceFingerprint",
    ]);
});
