"use strict";
const $ = (id) => document.getElementById(id),
  D = GarbageData;
let result = null,
  merged = [];
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
          reject(
            Error(
              "CSV 解析失敗或缺少必要欄位：" +
                (typeof input === "string" ? input : input.name),
            ),
          );
        else resolve(r.data);
      },
      error: reject,
    }),
  );
}
function save(name, rows, fields) {
  const blob = new Blob(
    [
      "\uFEFF" +
        Papa.unparse(
          { fields, data: rows.map((r) => fields.map((h) => r[h] ?? "")) },
          { newline: "\r\n" },
        ),
    ],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("run").addEventListener("click", async () => {
  result = null;
  merged = [];
  $("rows").replaceChildren();
  $("summary").textContent = "";
  for (const id of ["run", "candidates", "review", "proposed"])
    $(id).disabled = true;
  try {
    const file = $("official").files[0];
    if (!file) throw Error("請選擇官方資料 CSV。");
    $("status").textContent = "正在載入並比對資料…";
    const [official, existing, groups] = await Promise.all([
      read(file, false, D.HEADERS),
      read("garbage-days.csv", true, D.HEADERS),
      Promise.all(
        RouteFiles.map(async (f) =>
          D.prepareRows(
            await read(f.name, true, [
              "責任區",
              "車次",
              "停留地點",
              "停留時間",
            ]),
            f,
          ),
        ),
      ),
    ]);
    result = D.reconcile(groups.flat(), existing, official);
    // Conflicting existing data fails closed, including the proposed export.
    merged = D.mergeRules(existing, result.candidates);
    const counts = result.outcomes.reduce(
      (a, r) => ((a[r["狀態"]] = (a[r["狀態"]] || 0) + 1), a),
      {},
    );
    $("summary").textContent = JSON.stringify(
      {
        官方筆數: official.length,
        既有規則: existing.length,
        新增候選: result.candidates.length,
        待審核: result.review.length,
        狀態: counts,
      },
      null,
      2,
    );
    for (const r of result.review.slice(0, 100)) {
      const tr = document.createElement("tr");
      for (const text of [
        r["狀態"],
        r["停留地點"] + " " + r["停留時間"],
        r["CSV候選"],
      ]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
      $("rows").appendChild(tr);
    }
    $("status").textContent =
      "比對完成。畫面顯示前 100 筆待審核資料，完整資料請下載 CSV。";
    for (const id of ["candidates", "review", "proposed"])
      $(id).disabled = false;
  } catch (e) {
    result = null;
    merged = [];
    $("status").textContent = "停止：" + e.message;
  } finally {
    $("run").disabled = false;
  }
});
$("candidates").addEventListener("click", () => {
  if (result) save("candidates.csv", result.candidates, D.HEADERS);
});
$("review").addEventListener("click", () => {
  if (result)
    save("review.csv", result.review, [
      ...new Set([...D.HEADERS, ...result.outcomes.flatMap(Object.keys)]),
    ]);
});
$("proposed").addEventListener("click", () => {
  if (result) save("garbage-days-proposed.csv", merged, D.HEADERS);
});
