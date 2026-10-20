"use strict";
const $ = (id) => document.getElementById(id),
  D = GarbageData,
  R = GarbageReview,
  T = GarbageTriage;
const STORAGE = "garbage-official-review-v3";
let loading = false;
let raw = [],
  existing = [],
  official = [],
  evidence = [],
  entries = [],
  marks = {},
  decisions = {},
  visible = [],
  active = null;
function read(input, download, headers) {
  return (
    download
      ? fetch(input, { cache: "no-store" }).then((r) => {
          if (!r.ok) throw Error("無法讀取 " + input);
          return r.text();
        })
      : input.text()
  ).then((text) => {
    const r = Papa.parse(text, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().replace(/^\uFEFF/, ""),
    });
    if (
      r.errors.length ||
      !headers.every((h) => (r.meta.fields || []).includes(h))
    )
      throw Error("CSV 解析失敗或缺少必要欄位");
    return r.data;
  });
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function save(name, rows, fields) {
  fields ||= [...new Set(rows.flatMap(Object.keys))];
  download(
    name,
    "\uFEFF" +
      Papa.unparse(
        { fields, data: rows.map((r) => fields.map((h) => r[h] ?? "")) },
        { newline: "\r\n" },
      ),
    "text/csv;charset=utf-8",
  );
}
function snapshot() {
  return T.session(official, evidence, decisions, marks);
}
function persist() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(snapshot()));
    $("save-status").textContent =
      "進度已保存於此瀏覽器。換裝置或清除瀏覽器前，請下載進度備份。";
  } catch {
    $("save-status").textContent =
      "本機保存失敗（可能容量不足或隱私模式）。請立即下載進度備份。";
  }
}
async function base() {
  const [rules, groups] = await Promise.all([
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
  D.mergeRules(rules, []);
  return { raw: groups.flat(), existing: rules };
}
function enable(value) {
  for (const id of ["backup", "candidates", "review", "proposed"])
    $(id).disabled = !value;
  $("workspace").hidden = !value;
}
function options(element, values, all) {
  element.replaceChildren();
  if (all) element.add(new Option("全部", ""));
  for (const [value, text] of values)
    element.add(new Option(text, String(value)));
}
function districtOf(o) {
  return (
    o["行政區"] ||
    (RouteFiles.find((f) => f.name === o["來源檔案"]) || {}).district ||
    "未知"
  );
}
function routeOf(o) {
  return o["官方路線名稱"] || o["官方路線序號"] || "未提供路線名稱";
}
async function load(input, restored) {
  if (loading) return;
  loading = true;
  for (const id of ["run", "load-default", "restore", "session", "official"])
    $(id).disabled = true;
  enable(false);
  active = null;
  $("status").textContent = "正在讀取全部路線與既有日期…";
  try {
    const [data, rows] = await Promise.all([
      base(),
      restored
        ? Promise.resolve(restored.officialRows)
        : read(input, typeof input === "string", D.HEADERS),
    ]);
    const session = restored || T.session(rows, [], {}, {});
    T.validate(session);
    const nextEntries = T.build(data.raw, data.existing, rows);
    // Session files are untrusted; revalidate every date against current production data.
    R.proposal(
      data.raw,
      data.existing,
      rows,
      session.evidenceRows,
      session.decisions,
    );
    raw = data.raw;
    existing = data.existing;
    official = rows;
    entries = nextEntries;
    evidence = session.evidenceRows;
    marks = session.marks;
    decisions = session.decisions;
    options(
      $("district"),
      [...new Set(official.map(districtOf))].map((x) => [x, x]),
      true,
    );
    $("priority").value = "";
    $("state").value = "";
    updateRoutes();
    const strict = D.reconcile(raw, existing, official);
    $("rows").replaceChildren();
    for (const r of strict.outcomes) {
      const tr = document.createElement("tr");
      for (const text of [
        r["狀態"],
        r["停留地點"] + " " + r["停留時間"],
        r["CSV候選"],
      ]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      $("rows").append(tr);
    }
    enable(true);
    const obsolete = entries.reduce(
      (n, e) =>
        n +
        e.suggestions.filter(
          (s) => marks[T.reviewKey(e, s.key)] && !T.current(e, s, marks),
        ).length,
      0,
    );
    $("status").textContent =
      `比對完成：${official.length} 筆，保留 ${existing.length} 條既有日期。` +
      (restored
        ? `已恢復備份；${obsolete} 筆候選因原始資料變更而需重新審核。`
        : "請由優先查看的紀錄開始；尚未新增任何日期。");
    $("save-status").textContent = restored
      ? "已恢復進度，後續操作會自動保存。"
      : "開始審核後自動保存；若要接續先前工作，請按恢復本機進度。";
  } catch (e) {
    entries = [];
    $("status").textContent = "停止：" + e.message;
  } finally {
    loading = false;
    for (const id of ["run", "load-default", "restore", "session", "official"])
      $(id).disabled = false;
  }
}
function updateRoutes() {
  options(
    $("route"),
    [
      ...new Set(
        entries
          .filter(
            (e) =>
              !$("district").value ||
              districtOf(e.official) === $("district").value,
          )
          .map((e) => routeOf(e.official)),
      ),
    ].map((x) => [x, x]),
    true,
  );
  filter();
}
function processed(e) {
  return (
    e.suggestions.length > 0 &&
    e.suggestions.every((s) => {
      const m = T.current(e, s, marks);
      return m && m.action !== "pending";
    })
  );
}
function filter(keep) {
  visible = entries.filter(
    (e) =>
      (!$("district").value ||
        districtOf(e.official) === $("district").value) &&
      (!$("route").value || routeOf(e.official) === $("route").value) &&
      (!$("priority").value || e.priority === Number($("priority").value)) &&
      (!$("state").value || processed(e) === ($("state").value === "done")),
  );
  options(
    $("record"),
    visible.map((e) => [
      e.sequence,
      `#${e.sequence} ${e.group}｜${e.official["停留地點"]} ${e.official["停留時間"]}`,
    ]),
  );
  if (keep && visible.some((e) => e.sequence === keep))
    $("record").value = String(keep);
  render();
}
function render() {
  const confirmations = Object.values(decisions).filter(
    (d) => d.action === "confirm",
  );
  const existingKeys = new Set(existing.map((r) => D.key(r)));
  $("summary").textContent = JSON.stringify(
    {
      官方筆數: official.length,
      既有規則: existing.length,
      新增候選: new Set(
        confirmations
          .filter((d) => !existingKeys.has(d.candidateKey))
          .map((d) => d.candidateKey),
      ).size,
      待審核: official.length - confirmations.length,
      已人工確認日期: confirmations.length,
      系統建議候選組數: entries.reduce((n, e) => n + e.suggestions.length, 0),
      說明: "候選建議不授權新增日期；日期確認於匯出時重新驗證",
    },
    null,
    2,
  );
  active = visible.find((e) => e.sequence === Number($("record").value));
  $("detail").hidden = !active;
  $("progress").textContent =
    `全部 ${entries.length} 筆；${entries.filter(processed).length} 筆已處理所有候選。已人工確認日期 ${Object.values(decisions).filter((d) => d.action === "confirm").length} 筆。此篩選顯示 ${visible.length} 筆。`;
  $("previous").disabled = !active || visible.indexOf(active) === 0;
  $("next").disabled =
    !active || visible.indexOf(active) === visible.length - 1;
  if (!active) return;
  $("record-title").textContent =
    `#${active.sequence} ${routeOf(active.official)}｜${active.group}`;
  $("reasons").textContent = active.reasons.join("；");
  options(
    $("candidate"),
    active.suggestions.map((s, i) => [
      i,
      `候選 ${i + 1}：責任區${s.row["責任區"]}／車次${s.row["車次"]}｜${s.row["停留時間"]}｜${s.row["停留地點"]}`,
    ]),
  );
  if (!active.suggestions.length)
    $("candidate").add(new Option("無安全範圍內候選，請保留待查", ""));
  renderCandidate();
}
function selected() {
  return active?.suggestions[Number($("candidate").value)];
}
function renderCandidate() {
  const s = selected(),
    o = active.official;
  $("comparison").replaceChildren();
  for (const [label, field] of [
    ["來源檔案", "來源檔案"],
    ["行政區", "行政區"],
    ["責任區", "責任區"],
    ["車次", "車次"],
    ["停靠地點", "停留地點"],
    ["時間", "停留時間"],
    ["一般垃圾星期", "一般垃圾日"],
  ]) {
    const left = field === "行政區" ? districtOf(o) : o[field] || "未提供";
    const right = s
      ? field === "一般垃圾日"
        ? s.existing.map((r) => r[field]).join("；") ||
          s.row.garbageDay ||
          "沒有已確認日期"
        : field === "行政區"
          ? s.row.searchDistrict
          : s.row[field] || "未提供"
      : "沒有候選";
    const tr = document.createElement("tr");
    for (const [i, value] of [label, left, right].entries()) {
      const td = document.createElement(i === 0 ? "th" : "td");
      td.textContent = value;
      if (i === 0) td.scope = "row";
      if (i > 0 && left !== right) td.className = "different";
      tr.append(td);
    }
    $("comparison").append(tr);
  }
  $("difference").textContent = s
    ? `官方到點減 CSV 起點：${s.delta === null ? "無法解析" : s.delta + " 分鐘"}。${s.time === "time_extent_mismatch" ? "到點與完整時段不同，尚缺離站時間證據。" : "時間檢查：" + s.time + "。"} ${s.samePlace ? "地點文字相同。" : "地點文字不同，巷弄、門牌與括號都必須另外查證。"}`
    : "無法安全提出候選，保留待查，不新增站點。";
  $("existing").textContent = s?.existing.length
    ? "此候選已有日期規則，保留原規則；不算本次新增或重新查證。"
    : "此候選沒有既有日期規則。";
  $("source").replaceChildren(document.createTextNode("官方來源："));
  if (D.officialURL(o["官方來源"])) {
    const a = document.createElement("a");
    a.href = o["官方來源"];
    a.textContent = "開啟官方路線頁（新分頁）";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    $("source").append(a);
  } else $("source").append(document.createTextNode("無有效政府來源"));
  $("source").append(
    document.createTextNode(
      `。查閱日期：${o["查閱日期"] || "未提供"}；官方更新日期：${o["官方更新日期"] || "未知"}；證據狀態：${o["證據狀態"] || "轉錄／快照未核實"}。${o["擷取說明"] || ""}`,
    ),
  );
  const m = T.current(active, s || { key: "", row: null }, marks);
  $("candidate-state").textContent = m
    ? {
        accept: "已接受候選建議（仍待官方日期查證）",
        reject: "已拒絕此候選，保留紀錄與其他候選",
        pending: "保留待查",
      }[m.action] + "。"
    : "此候選尚未處理。";
  $("reason").value = m?.reason || decisions[active.id]?.reason || "";
  $("action-status").textContent = "";
  $("attest").checked = false;
  for (const id of ["accept", "reject"]) $(id).disabled = !s;
  proofState();
}
function proofState() {
  const s = selected();
  const proofs =
    active && s
      ? R.findEvidence(raw, existing, official, evidence, active, s.key)
      : [];
  $("evidence-status").textContent =
    `已匯入補充證據 ${evidence.length} 筆；此候選通過完整五欄與日期衝突檢查的證據 ${proofs.length} 筆。`;
  $("proofs").replaceChildren();
  const linked = active
    ? evidence.filter((e) => e["對應來源紀錄ID"] === active.id)
    : [];
  for (const p of linked) {
    const box = document.createElement("p");
    box.textContent = `補充官方證據：責任區${p["責任區"]}／車次${p["車次"]}，${p["停留地點"]}，${p["停留時間"]}，一般垃圾${p["一般垃圾日"]}。查證日${p["查證日期"]}；官方更新日${p["官方更新日期"] || "未知"}。依據：${p["查證依據"]}。${proofs.some((x) => R.stable(x) === R.stable(p)) ? "通過此候選的證據檢查。" : "未通過此候選的證據檢查（五欄、日期、關聯或其他證據衝突）。"}`;
    if (D.officialURL(p["官方來源"])) {
      const a = document.createElement("a");
      a.href = p["官方來源"];
      a.textContent = "閱讀此補充官方來源";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      box.append(a);
    }
    $("proofs").append(box);
  }
  $("confirm-date").disabled = !proofs.length || !$("attest").checked;
  $("undo-date").disabled = !active || !decisions[active.id];
  $("date-state").textContent =
    active && decisions[active.id]?.action === "confirm"
      ? "本筆已有充分匯入證據並經人工確認，匯出時會再次檢查。"
      : active && decisions[active.id]?.withdrawalReason
        ? "新證據未通過檢查，先前日期確認已退回待查，原核對紀錄保留；不新增日期。"
        : "本筆尚未確認日期，不會新增規則。";
}
for (const [id, action] of [
  ["accept", "accept"],
  ["reject", "reject"],
  ["reopen", "pending"],
])
  $(id).onclick = () => {
    try {
      const s = selected(),
        m = T.mark(
          active,
          s?.key || "",
          action,
          $("reason").value,
          new Date().toISOString(),
        );
      marks[T.reviewKey(active, s?.key || "")] = m;
      // Changing a candidate assessment withdraws that record's earlier date confirmation.
      delete decisions[active.id];
      persist();
      const seq = active.sequence;
      filter(seq);
      $("action-status").textContent = "已記錄候選審核；日期仍待查證。";
    } catch (e) {
      $("action-status").textContent = e.message;
    }
  };
$("attest").onchange = proofState;
$("confirm-date").onclick = () => {
  try {
    if (!$("attest").checked) throw Error("請先勾選已閱讀官方證據");
    const d = R.decide(
      raw,
      existing,
      official,
      evidence,
      active,
      selected().key,
      "confirm",
      $("reason").value,
      new Date().toISOString(),
    );
    const next = { ...decisions, [active.id]: d };
    R.proposal(raw, existing, official, evidence, next);
    decisions = next;
    persist();
    filter(active.sequence);
    $("action-status").textContent = "日期已人工確認，匯出仍會重新驗證證據。";
  } catch (e) {
    $("action-status").textContent = e.message;
  }
};
$("undo-date").onclick = () => {
  delete decisions[active.id];
  persist();
  filter(active.sequence);
};
$("evidence").onchange = async () => {
  try {
    const imported = await read($("evidence").files[0], false, [
      ...D.HEADERS,
      "對應來源紀錄ID",
      "證據狀態",
      "查證日期",
      "查證依據",
    ]);
    const ids = new Set(official.map(R.id));
    if (
      imported.some(
        (r) => !ids.has(r["對應來源紀錄ID"]) || !R.usable(r) || !D.validRule(r),
      )
    )
      throw Error(
        "補充證據須有正確來源紀錄ID、verified、完整五欄、一般垃圾日及查證日期／依據；空白表不能當證據",
      );
    // Append rather than replace: contradictory evidence must remain visible to conflict checks.
    evidence = [
      ...new Map(
        [...evidence, ...imported].map((r) => [R.stable(r), r]),
      ).values(),
    ];
    decisions = R.suspendInvalidDecisions(
      raw,
      existing,
      official,
      evidence,
      decisions,
      new Date().toISOString(),
    );
    persist();
    const keptReason = $("reason").value;
    const keptCandidate = $("candidate").value;
    filter(active.sequence);
    $("candidate").value = keptCandidate;
    renderCandidate();
    $("reason").value = keptReason;
  } catch (e) {
    $("evidence-status").textContent = "未匯入：" + e.message;
  }
};
$("proof-template").onclick = () => {
  if (!active) return;
  const row = {
    ...Object.fromEntries(D.HEADERS.map((h) => [h, ""])),
    對應來源紀錄ID: active.id,
    證據狀態: "",
    查證日期: "",
    查證依據: "",
    官方更新日期: "",
    參考官方來源: active.official["官方來源"],
  };
  save(`official-proof-${active.sequence}-blank.csv`, [row]);
};
$("load-default").onclick = () => load("data/official/sanmin-west.csv");
$("run").onclick = () => {
  if (!$("official").files[0]) {
    $("status").textContent = "請選擇官方資料 CSV";
    return;
  }
  load($("official").files[0]);
};
async function restore(text) {
  try {
    const session = T.validate(JSON.parse(text));
    await load(null, session);
  } catch (e) {
    $("status").textContent = "無法恢復：" + e.message;
  }
}
$("restore").onclick = () => {
  try {
    const text = localStorage.getItem(STORAGE);
    if (!text) throw Error("此瀏覽器還沒有保存的進度");
    restore(text);
  } catch (e) {
    $("status").textContent = e.message;
  }
};
$("session").onchange = async () => {
  if ($("session").files[0]) await restore(await $("session").files[0].text());
};
$("backup").onclick = () =>
  download(
    "official-review-progress.json",
    JSON.stringify(snapshot(), null, 2),
    "application/json;charset=utf-8",
  );
$("district").onchange = updateRoutes;
for (const id of ["route", "priority", "state"])
  $(id).onchange = () => filter();
$("record").onchange = render;
$("candidate").onchange = renderCandidate;
for (const [id, delta] of [
  ["previous", -1],
  ["next", 1],
])
  $(id).onclick = () => {
    $("record").value = String(
      visible[visible.indexOf(active) + delta].sequence,
    );
    render();
    $("detail").focus();
  };
$("review").onclick = () =>
  save("review-all.csv", T.report(entries, marks, decisions));
$("candidates").onclick = () =>
  save(
    "system-suggestions-not-confirmed.csv",
    entries.flatMap((e) =>
      e.suggestions.map((s) => ({
        審核序號: e.sequence,
        官方地點: e.official["停留地點"],
        官方時間: e.official["停留時間"],
        官方一般垃圾日: e.official["一般垃圾日"],
        來源檔案: s.row.sourceFile,
        責任區: s.row["責任區"],
        候選車次: s.row["車次"],
        候選地點: s.row["停留地點"],
        候選時間: s.row["停留時間"],
        官方到點減CSV起點分鐘: s.delta,
        時間差異: s.time,
        地點相同: s.samePlace ? "是" : "否",
        既有日期: s.existing.map((r) => r["一般垃圾日"]).join("；"),
        候選審核: T.current(e, s, marks)?.action || "pending",
        性質: "系統建議，尚非官方確認配對",
      })),
    ),
    [
      "審核序號",
      "官方地點",
      "官方時間",
      "官方一般垃圾日",
      "來源檔案",
      "責任區",
      "候選車次",
      "候選地點",
      "候選時間",
      "官方到點減CSV起點分鐘",
      "時間差異",
      "地點相同",
      "既有日期",
      "候選審核",
      "性質",
    ],
  );
$("proposed").onclick = async () => {
  $("proposed").disabled = true;
  try {
    const latest = await base();
    const merged = R.proposal(
      latest.raw,
      latest.existing,
      official,
      evidence,
      decisions,
    );
    save("garbage-days-proposed.csv", merged, D.HEADERS);
    $("status").textContent =
      `提案匯出完成：保留最新 ${latest.existing.length} 條既有規則，新增 ${merged.length - latest.existing.length} 條。有證據且人工確認才會新增。`;
  } catch (e) {
    $("status").textContent = "停止匯出：" + e.message;
  } finally {
    $("proposed").disabled = false;
  }
};
