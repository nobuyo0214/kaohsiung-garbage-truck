/* Batch operations record suggestions only. They never write date decisions or rules. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(
      require("./data-core"),
      require("./review-core"),
      require("./review-triage"),
    );
  else
    root.GarbageBatch = factory(
      root.GarbageData,
      root.GarbageReview,
      root.GarbageTriage,
    );
})(typeof globalThis !== "undefined" ? globalThis : this, function (D, R, T) {
  "use strict";
  function routeKey(e) {
    const o = e.official;
    return JSON.stringify([
      o["來源檔案"],
      o["行政區"] || "",
      o["責任區"],
      o["官方路線序號"] || "",
      o["官方路線名稱"] || "",
      o["官方路線序號"] || o["官方路線名稱"] ? "" : e.id,
    ]);
  }
  const ordinal = (v) =>
    /^\d+$/.test(D.clean(v)) && Number(v) > 0 && Number.isSafeInteger(Number(v))
      ? Number(v)
      : null;
  function preferred(e) {
    const exact = e.suggestions.filter(
      (s) => s.samePlace && s.delta === 0 && s.unique,
    );
    return exact.length === 1 ? exact[0] : null;
  }
  function groups(entries) {
    const result = new Map();
    for (const e of entries) {
      const key = routeKey(e);
      if (!result.has(key))
        result.set(key, { key, official: e.official, entries: [] });
      result.get(key).entries.push(e);
    }
    for (const g of result.values()) {
      g.entries.sort(
        (a, b) =>
          (ordinal(a.official["官方清運序"]) ?? Infinity) -
            (ordinal(b.official["官方清運序"]) ?? Infinity) ||
          a.sequence - b.sequence,
      );
      const seen = new Set();
      g.duplicateOrder = false;
      for (const e of g.entries) {
        const n = ordinal(e.official["官方清運序"]);
        if (n !== null && seen.has(n)) g.duplicateOrder = true;
        seen.add(n);
      }
      // Consecutive official order + consecutive CSV Seq is a browsing aid, never identity evidence.
      g.rows = g.entries.map((e, i) => {
        const s = preferred(e),
          previous = g.entries[i - 1],
          p = previous && preferred(previous);
        let continuity = "無前一站可比較";
        if (previous) {
          if (!s || !p) continuity = "缺少唯一同地點／同到點候選";
          else if (
            ordinal(e.official["官方清運序"]) === null ||
            ordinal(previous.official["官方清運序"]) === null ||
            ordinal(s.row.Seq) === null ||
            ordinal(p.row.Seq) === null
          )
            continuity = "缺少有效序號，無法比較";
          else if (g.duplicateOrder) continuity = "官方清運序重複，需查證";
          else if (
            ordinal(e.official["官方清運序"]) !==
            ordinal(previous.official["官方清運序"]) + 1
          )
            continuity = "官方清運序有缺口";
          else if (s.row["車次"] !== p.row["車次"])
            continuity = "CSV 候選車次改變，不能合併";
          else
            continuity =
              ordinal(s.row.Seq) === ordinal(p.row.Seq) + 1
                ? "兩側序號連續（僅供參考）"
                : "CSV Seq 有缺口或順序不同";
        }
        return {
          entry: e,
          candidate: s,
          officialOrder: ordinal(e.official["官方清運序"]),
          csvOrder: s ? ordinal(s.row.Seq) : null,
          continuity,
        };
      });
    }
    return [...result.values()];
  }
  function unavailable(e, s, marks, decisions) {
    if (
      !s ||
      !s.samePlace ||
      s.delta !== 0 ||
      !s.unique ||
      preferred(e)?.key !== s.key
    )
      return "沒有唯一同地點／同到點候選";
    if (!e.official["官方路線序號"] && !e.official["官方路線名稱"])
      return "缺少官方路線識別";
    if (e.official["證據狀態"] === "stale") return "舊證據，請先逐筆查證";
    if (
      /conflict|ambiguous/.test(e.status) ||
      e.reasons.some((r) => /衝突|重複|既有日期不同/.test(r))
    )
      return "有資料衝突或重複";
    if (decisions[e.id]?.action === "confirm")
      return "已有日期確認，保留個別決策";
    const m = T.current(e, s, marks);
    if (marks[T.reviewKey(e, s.key)] && !m)
      return "先前紀錄已變更，請先逐筆重審";
    if (m?.action === "accept") return "已接受，保留原紀錄";
    if (m?.action === "reject") return "已拒絕，請先逐筆改為待查";
    return "";
  }
  function counts(entries, marks, decisions) {
    let accepted = 0,
      rejected = 0,
      pairAccepted = 0,
      pairRejected = 0,
      pairs = 0;
    for (const e of entries) {
      const states = e.suggestions.map(
        (s) => T.current(e, s, marks)?.action || "pending",
      );
      pairs += states.length;
      pairAccepted += states.filter((x) => x === "accept").length;
      pairRejected += states.filter((x) => x === "reject").length;
      if (states.includes("accept")) accepted++;
      else if (states.length && states.every((x) => x === "reject")) rejected++;
    }
    const confirmed = entries.filter(
      (e) => decisions[e.id]?.action === "confirm",
    ).length;
    return {
      total: entries.length,
      accepted,
      rejected,
      pending: entries.length - accepted - rejected,
      confirmed,
      pendingDates: entries.length - confirmed,
      pairAccepted,
      pairRejected,
      pairPending: pairs - pairAccepted - pairRejected,
    };
  }
  function preview(
    entries,
    marks,
    decisions,
    selections,
    reason,
    now,
    batchId,
  ) {
    if (!selections.length) throw Error("請先勾選要接受的候選");
    if (!D.clean(batchId) || D.clean(reason).length < 10)
      throw Error("請填至少 10 字的共同審核理由");
    const byId = new Map(entries.map((e) => [e.id, e])),
      seen = new Set(),
      routes = new Set();
    const changes = selections.map((choice) => {
      const e = byId.get(choice.recordId),
        s = e?.suggestions.find((s) => s.key === choice.candidateKey);
      if (!e || seen.has(e.id)) throw Error("候選不存在或同筆資料重複勾選");
      seen.add(e.id);
      routes.add(routeKey(e));
      const problem = unavailable(e, s, marks, decisions);
      if (problem) throw Error(problem);
      const key = T.reviewKey(e, s.key);
      return {
        recordId: e.id,
        candidateKey: s.key,
        key,
        before: marks[key] ? { ...marks[key] } : null,
        after: { ...T.mark(e, s.key, "accept", reason, now), batchId },
      };
    });
    if (
      groups(entries.filter((e) => routes.has(routeKey(e)))).some(
        (g) => g.duplicateOrder,
      )
    )
      throw Error("官方清運序重複，請先逐筆查證");
    if (routes.size !== 1)
      throw Error("一批只能處理同檔案、行政區、責任區與官方路線");
    return {
      id: batchId,
      routeKey: [...routes][0],
      reason: D.clean(reason),
      createdAt: now,
      undone: false,
      changes,
    };
  }
  function apply(entries, marks, decisions, batch) {
    validateHistory([batch]);
    const selections = batch.changes.map((c) => ({
      recordId: c.recordId,
      candidateKey: c.candidateKey,
    }));
    const fresh = preview(
      entries,
      marks,
      decisions,
      selections,
      batch.reason,
      batch.createdAt,
      batch.id,
    );
    if (R.stable(fresh) !== R.stable(batch))
      throw Error("預覽後資料或審核結果已變更，請重新預覽");
    const next = { ...marks };
    for (const c of batch.changes) next[c.key] = c.after;
    return next;
  }
  function undo(entries, marks, history, batchId, now) {
    validateHistory(history);
    const batch = history.find((b) => b.id === batchId);
    if (!batch || batch.undone) throw Error("批次不存在或已撤銷");
    const byId = new Map(entries.map((e) => [e.id, e])),
      next = { ...marks };
    let restored = 0,
      skipped = 0;
    for (const c of batch.changes) {
      const e = byId.get(c.recordId),
        s = e?.suggestions.find((s) => s.key === c.candidateKey);
      if (
        !e ||
        !s ||
        R.stable(next[c.key]) !== R.stable(c.after) ||
        !T.current(e, s, next)
      ) {
        skipped++;
        continue;
      }
      if (c.before) next[c.key] = c.before;
      else delete next[c.key];
      restored++;
    }
    return {
      marks: next,
      history: history.map((b) =>
        b.id === batchId
          ? { ...b, undone: true, undoneAt: now, restored, skipped }
          : b,
      ),
      restored,
      skipped,
    };
  }
  function validateHistory(history) {
    if (
      !Array.isArray(history) ||
      new Set(history.map((b) => b?.id)).size !== history.length
    )
      throw Error("批次歷程格式無效或ID重複");
    for (const b of history) {
      if (
        !b ||
        typeof b.id !== "string" ||
        !b.id ||
        typeof b.routeKey !== "string" ||
        typeof b.createdAt !== "string" ||
        typeof b.undone !== "boolean" ||
        D.clean(b.reason).length < 10 ||
        !Array.isArray(b.changes) ||
        !b.changes.length ||
        new Set(b.changes.map((c) => c?.key)).size !== b.changes.length
      )
        throw Error("批次歷程欄位無效");
      for (const c of b.changes) {
        const a = c?.after;
        if (
          !a ||
          c.key !== JSON.stringify([c.recordId, c.candidateKey]) ||
          a.recordId !== c.recordId ||
          a.candidateKey !== c.candidateKey ||
          a.action !== "accept" ||
          a.batchId !== b.id ||
          a.reason !== b.reason ||
          typeof a.recordFingerprint !== "string" ||
          typeof a.candidateFingerprint !== "string"
        )
          throw Error("批次候選紀錄無效");
        if (
          c.before &&
          (c.before.action !== "pending" ||
            c.before.recordId !== c.recordId ||
            c.before.candidateKey !== c.candidateKey ||
            typeof c.before.reason !== "string" ||
            c.before.reason.length < 10 ||
            typeof c.before.recordFingerprint !== "string" ||
            typeof c.before.candidateFingerprint !== "string")
        )
          throw Error("批次原審核紀錄無效");
      }
    }
    return history;
  }
  function session(official, evidence, decisions, marks, batchHistory = []) {
    return { ...T.session(official, evidence, decisions, marks), batchHistory };
  }
  function validateSession(value) {
    T.validate(value);
    validateHistory(value.batchHistory ?? []);
    return { ...value, batchHistory: value.batchHistory ?? [] };
  }
  return {
    routeKey,
    ordinal,
    preferred,
    groups,
    unavailable,
    counts,
    preview,
    apply,
    undo,
    validateHistory,
    session,
    validateSession,
  };
});
