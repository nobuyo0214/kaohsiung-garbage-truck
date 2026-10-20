/* Manual candidate review is separate from evidence-backed date decisions. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./data-core"), require("./review-core"));
  else root.GarbageTriage = factory(root.GarbageData, root.GarbageReview);
})(typeof globalThis !== "undefined" ? globalThis : this, function (D, R) {
  "use strict";
  function build(raw, existing, official) {
    D.mergeRules(existing, []); // fail closed before displaying/exporting a proposal
    const rawCounts = new Map();
    for (const r of raw)
      rawCounts.set(D.key(r), (rawCounts.get(D.key(r)) || 0) + 1);
    return R.buildEntries(raw, existing, official)
      .map((e, i) => {
        const same = e.suggestions.filter((s) => s.samePlace);
        const arrival = same.filter((s) => s.delta === 0);
        const stale = D.clean(e.official["證據狀態"]) === "stale";
        for (const s of e.suggestions) {
          s.existing = existing.filter((r) => D.key(r) === s.key);
          s.unique = rawCounts.get(s.key) === 1;
        }
        const known = arrival.length === 1 && arrival[0].existing.length > 0;
        const group = stale
          ? "舊證據待更新"
          : arrival.length === 1
            ? known
              ? "到點一致・已有規則"
              : "優先查看・到點一致"
            : same.length
              ? "同地點・時間不同"
              : "無相同地點";
        const priority = stale
          ? 5
          : arrival.length === 1
            ? known
              ? 2
              : 1
            : same.length
              ? 3
              : 4;
        const reasons = [];
        if (/conflict|ambiguous/.test(e.status))
          reasons.push("安全比對發現資料衝突或重複識別，不能確認日期");
        if (e.suggestions.some((s) => !s.unique))
          reasons.push("CSV 候選五欄有重複，必須先查證原始資料");
        if (
          e.suggestions.some(
            (s) =>
              s.samePlace &&
              s.delta === 0 &&
              s.existing.some(
                (r) =>
                  D.normalizeDays(r["一般垃圾日"]) !==
                  D.normalizeDays(e.official["一般垃圾日"]),
              ),
          )
        )
          reasons.push("到點一致的候選與既有日期不同；保留舊規則，不覆蓋");
        if (!D.clean(e.official["車次"]))
          reasons.push("官方沒有明確 CSV 車次，路線名稱數字不能當作車次");
        if (stale) reasons.push("來源標為舊快取，須取得可查證的新官方證據");
        else if (!R.usable(e.official))
          reasons.push("目前是官方頁面轉錄／搜尋快照，尚未完成完整五欄查證");
        if (!same.length)
          reasons.push(
            "同檔案、行政區及責任區找不到完全相同地點；相似文字也僅供查找",
          );
        else if (!arrival.length)
          reasons.push("同地點的 CSV 到點時間不同，不能認定同班次");
        if (arrival.some((s) => s.time !== "exact"))
          reasons.push(
            "官方只有到點時間，CSV 是完整時段，離站時間沒有官方證據",
          );
        if (known)
          reasons.push("此候選已有日期規則，保持原狀；不代表本次重新查證完成");
        return {
          ...e,
          sequence: i + 1,
          group,
          priority,
          reasons,
          arrivalCount: arrival.length,
        };
      })
      .sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
  }
  function reviewKey(entry, candidateKey) {
    return JSON.stringify([entry.id, candidateKey]);
  }
  function mark(entry, candidateKey, action, reason, now) {
    if (!["accept", "reject", "pending"].includes(action))
      throw Error("無效候選動作");
    const s = entry.suggestions.find((s) => s.key === candidateKey);
    if (!s && !(candidateKey === "" && action === "pending"))
      throw Error("候選已不存在，請重新載入");
    if (D.clean(reason).length < 10)
      throw Error("請填寫至少 10 字的核對紀錄或拒絕原因");
    return {
      recordId: entry.id,
      candidateKey,
      action,
      reason: D.clean(reason),
      recordFingerprint: R.stable(entry.official),
      candidateFingerprint: R.stable(s?.row || null),
      decidedAt: now,
    };
  }
  function current(entry, candidate, marks) {
    const m = marks[reviewKey(entry, candidate.key)];
    return m &&
      m.recordFingerprint === R.stable(entry.official) &&
      m.candidateFingerprint === R.stable(candidate.row)
      ? m
      : null;
  }
  function report(entries, marks = {}, decisions = {}) {
    return entries.map((e) => ({
      ...e.official,
      審核序號: e.sequence,
      優先順序: e.priority,
      建議分類: e.group,
      無法確認原因: e.reasons.join("；"),
      候選數: e.suggestions.length,
      系統建議候選: e.suggestions
        .map(
          (s) => `${s.row["車次"]}｜${s.row["停留地點"]}｜${s.row["停留時間"]}`,
        )
        .join(" ; "),
      候選審核紀錄: (e.suggestions.length
        ? e.suggestions
        : [{ key: "", row: null }]
      )
        .flatMap((s) => {
          const m = current(e, s, marks);
          return m
            ? [
                `${s.row?.["車次"] || "無候選"}｜${s.row?.["停留時間"] || ""}｜${m.action}｜${m.reason}`,
              ]
            : [];
        })
        .join(" ; "),
      日期確認狀態:
        decisions[e.id]?.action === "confirm"
          ? "已人工確認，匯出時重新驗證"
          : "待查證（接受候選不等於日期確認）",
      後續查證:
        "取得官方明確車次、完整停留時間及一般垃圾星期；保留網址、查證日期與依據。不得抄 CSV 補齊證據。",
    }));
  }
  function session(officialRows, evidenceRows, decisions, marks) {
    return { version: 3, officialRows, evidenceRows, decisions, marks };
  }
  function validate(value) {
    if (value?.version !== 3) throw Error("不支援的進度檔版本");
    R.validateSession({ ...value, version: 2 });
    if (
      !value.marks ||
      typeof value.marks !== "object" ||
      Array.isArray(value.marks)
    )
      throw Error("缺少候選審核進度");
    for (const [k, m] of Object.entries(value.marks)) {
      if (
        !m ||
        k !== JSON.stringify([m.recordId, m.candidateKey]) ||
        !["accept", "reject", "pending"].includes(m.action) ||
        typeof m.reason !== "string" ||
        D.clean(m.reason).length < 10 ||
        typeof m.recordFingerprint !== "string" ||
        typeof m.candidateFingerprint !== "string"
      )
        throw Error("候選進度格式無效");
    }
    return value;
  }
  return { build, reviewKey, mark, current, report, session, validate };
});
