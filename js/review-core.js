/* Suggestions never change the production matching key or authorize a date. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./data-core"));
  else root.GarbageReview = factory(root.GarbageData);
})(typeof globalThis !== "undefined" ? globalThis : this, function (D) {
  "use strict";
  const stable = (v) =>
    JSON.stringify(v, (_, x) =>
      x && typeof x === "object" && !Array.isArray(x)
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, x[k]]),
          )
        : x,
    );
  const id = (row) => D.clean(row["來源紀錄ID"]) || stable(row);
  // A government URL alone is not evidence that its contents were checked.
  const checkedDate = (value) => {
    const text = D.clean(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const date = new Date(text + "T00:00:00Z");
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === text
    );
  };
  const usable = (r) =>
    r["證據狀態"] === "verified" &&
    D.clean(r["查證依據"]).length >= 10 &&
    checkedDate(r["查證日期"]);
  function requireDistrict(filename) {
    // Mixed legacy file: absence of a declaration must never include its 大寮 rows.
    if (filename === "sanmin-west.csv") return "三民區";
    const manifest =
      typeof module === "object" && module.exports
        ? require("./route-files.js")
        : globalThis.RouteFiles;
    return (manifest.find((f) => f.name === filename) || {}).district;
  }
  function sameDistrict(official, row) {
    const aliases = {
      三民東區: "三民區",
      三民西區: "三民區",
      北鳳山區: "鳳山區",
      南鳳山區: "鳳山區",
    };
    const file = requireDistrict(official["來源檔案"]);
    const declared = D.canonical(official["行政區"]) || file;
    return !!declared && (aliases[declared] || declared) === row.searchDistrict;
  }
  function profile(value, cache) {
    const text = D.clean(value);
    if (cache.has(text)) return cache.get(text);
    const normalized = D.normalize(text),
      pairs = new Set();
    for (let i = 0; i < normalized.length - 1; i++)
      pairs.add(normalized.slice(i, i + 2));
    const result = { canonical: D.canonical(text), normalized, pairs };
    cache.set(text, result);
    return result;
  }
  function similarity(a, b, cache = new Map()) {
    const x = profile(a, cache),
      y = profile(b, cache);
    if (!x.normalized || !y.normalized) return 0;
    if (x.normalized === y.normalized) return 1;
    if (!x.pairs.size || !y.pairs.size) return 0;
    let common = 0;
    for (const pair of x.pairs) if (y.pairs.has(pair)) common++;
    return (2 * common) / (x.pairs.size + y.pairs.size);
  }
  function suggest(raw, o, cache = new Map()) {
    if (!D.clean(o["責任區"])) return [];
    const minute = D.getStartMinute(o["停留時間"]),
      officialPlace = profile(o["停留地點"], cache);
    return raw
      .filter(
        (r) =>
          r.sourceFile === o["來源檔案"] &&
          sameDistrict(o, r) &&
          (!D.clean(o["責任區"]) ||
            D.canonical(r["責任區"]) === D.canonical(o["責任區"])) &&
          (!D.clean(o["車次"]) ||
            D.canonical(r["車次"]) === D.canonical(o["車次"])),
      )
      .flatMap((r) => {
        const samePlace =
          profile(r["停留地點"], cache).canonical === officialPlace.canonical;
        const placeScore = similarity(r["停留地點"], o["停留地點"], cache);
        const delta =
          minute === null || r.startMinute === null
            ? null
            : minute - r.startMinute;
        // Compute detailed time/key information only for eligible suggestions.
        if (
          !samePlace &&
          !(placeScore >= 0.65 && delta !== null && Math.abs(delta) <= 5) &&
          placeScore < 0.85
        )
          return [];
        const time = D.timeStatus(o["停留時間"], r["停留時間"]),
          issues = [];
        if (!o["車次"]) issues.push("missing_trip");
        if (!o["責任區"]) issues.push("missing_zone");
        if (!samePlace) issues.push("place_mismatch");
        if (time !== "exact") issues.push(time);
        return [
          {
            row: r,
            key: D.key(r),
            samePlace,
            placeScore,
            delta,
            time,
            issues,
            score:
              (samePlace ? 1000 : placeScore * 500) -
              (delta === null ? 200 : Math.min(Math.abs(delta), 200)),
          },
        ];
      })
      .sort((a, b) => b.score - a.score)
      .filter(
        (s, i, all) =>
          s.samePlace || all.slice(0, i).filter((x) => !x.samePlace).length < 8,
      );
  }
  function buildEntries(raw, existing, official) {
    const strict = D.reconcile(raw, existing, official),
      bySource = new Map(),
      cache = new Map();
    for (const row of raw) {
      if (!bySource.has(row.sourceFile)) bySource.set(row.sourceFile, []);
      bySource.get(row.sourceFile).push(row);
    }
    return official.map((o, i) => {
      const suggestions = suggest(bySource.get(o["來源檔案"]) || [], o, cache),
        outcome = strict.outcomes[i];
      let category;
      if (/conflict|ambiguous/.test(outcome["狀態"])) category = "資料衝突";
      else if (!D.clean(o["車次"])) category = "缺少車次";
      else if (
        outcome["狀態"] === "candidate" ||
        outcome["狀態"] === "already_confirmed"
      )
        category = "確認吻合";
      else if (suggestions.some((s) => s.samePlace && s.time !== "exact"))
        category = "時間不同";
      else if (suggestions.length) category = "停靠地點不同";
      else category = "找不到對應";
      const categories = [category];
      if (
        suggestions.some((s) => s.time !== "exact") &&
        !categories.includes("時間不同")
      )
        categories.push("時間不同");
      if (
        suggestions.some((s) => !s.samePlace) &&
        !categories.includes("停靠地點不同")
      )
        categories.push("停靠地點不同");
      if (!suggestions.length && !categories.includes("找不到對應"))
        categories.push("找不到對應");
      const issues = [
        ...new Set([
          outcome["狀態"],
          ...suggestions.flatMap((s) => s.issues),
          ...(!usable(o) ? ["source_unverified"] : []),
        ]),
      ];
      return {
        id: id(o),
        official: o,
        category,
        categories,
        status: outcome["狀態"],
        issues,
        suggestions,
      };
    });
  }
  function findEvidence(
    raw,
    existing,
    official,
    evidence,
    entry,
    candidateKey,
  ) {
    // Most pending rows have no verified proof. Avoid scanning 13,871 raw rows then.
    const pool = [...official, ...evidence];
    if (!pool.some(usable)) return [];
    const candidates = raw.filter((r) => D.key(r) === candidateKey);
    if (candidates.length !== 1) return [];
    const target = candidates[0],
      o = entry.official;
    if (target.sourceFile !== o["來源檔案"] || !sameDistrict(o, target))
      return [];
    if (
      o["責任區"] &&
      D.canonical(o["責任區"]) !== D.canonical(target["責任區"])
    )
      return [];
    if (o["車次"] && D.canonical(o["車次"]) !== D.canonical(target["車次"]))
      return [];
    if (
      !pool.some(
        (e) => usable(e) && D.validRule(e) && D.key(e) === candidateKey,
      )
    )
      return [];
    const linked = pool.filter(
      (e) =>
        usable(e) &&
        D.validRule(e) &&
        (stable(e) === stable(o) || D.clean(e["對應來源紀錄ID"]) === entry.id),
    );
    // One source record cannot silently authorize two different CSV identities.
    if (new Set(linked.map((e) => D.key(e))).size > 1) return [];
    const strict = D.reconcile(raw, existing, pool);
    return pool.filter((e, i) => {
      if (
        !usable(e) ||
        !sameDistrict(e, target) ||
        !D.validRule(e) ||
        D.key(e) !== candidateKey
      )
        return false;
      if (
        !["candidate", "already_confirmed"].includes(strict.outcomes[i]["狀態"])
      )
        return false;
      if (D.normalizeDays(e["一般垃圾日"]) !== D.normalizeDays(o["一般垃圾日"]))
        return false;
      // A supplementary record must explicitly reference this original official record.
      return (
        stable(e) === stable(o) || D.clean(e["對應來源紀錄ID"]) === entry.id
      );
    });
  }
  function decide(
    raw,
    existing,
    official,
    evidence,
    entry,
    candidateKey,
    action,
    reason,
    now,
  ) {
    reason = D.clean(reason);
    if (reason.length < 10) throw Error("請填寫至少 10 字的核對依據或拒絕原因");
    if (!["confirm", "reject"].includes(action)) throw Error("無效審核動作");
    const decision = {
      recordId: entry.id,
      recordFingerprint: stable(entry.official),
      candidateKey,
      action,
      reason,
      decidedAt: now,
    };
    if (action === "reject") return decision;
    const proofs = findEvidence(
      raw,
      existing,
      official,
      evidence,
      entry,
      candidateKey,
    );
    if (!proofs.length)
      throw Error(
        "缺少完整五欄官方證據，不能確認；請匯入含對應來源紀錄ID的官方補充資料",
      );
    const candidate = raw.find((r) => D.key(r) === candidateKey);
    return {
      ...decision,
      candidateFingerprint: stable(candidate),
      evidenceFingerprint: stable(proofs[0]),
      sourceURL: proofs[0]["官方來源"],
    };
  }
  function proposal(raw, existing, official, evidence, decisions) {
    const byId = new Map(
      official.map((o) => [id(o), { id: id(o), official: o }]),
    );
    const additions = [];
    for (const decision of Object.values(decisions)) {
      if (decision.action !== "confirm") continue;
      const entry = byId.get(decision.recordId);
      if (
        !entry ||
        decision.recordFingerprint !== stable(entry.official) ||
        D.clean(decision.reason).length < 10
      )
        throw Error("來源紀錄或依據已變更，請重新審核");
      const candidate = raw.find((r) => D.key(r) === decision.candidateKey);
      const proofs = findEvidence(
        raw,
        existing,
        official,
        evidence,
        entry,
        decision.candidateKey,
      );
      const proof = proofs.find(
        (e) =>
          stable(e) === decision.evidenceFingerprint &&
          e["官方來源"] === decision.sourceURL,
      );
      if (
        !candidate ||
        stable(candidate) !== decision.candidateFingerprint ||
        !proof
      )
        throw Error("原始紀錄或官方證據已變更，請重新審核");
      additions.push(Object.fromEntries(D.HEADERS.map((h) => [h, proof[h]])));
    }
    return D.mergeRules(existing, additions);
  }
  function suspendInvalidDecisions(
    raw,
    existing,
    official,
    evidence,
    decisions,
    now,
  ) {
    const next = { ...decisions };
    for (const [key, decision] of Object.entries(decisions)) {
      if (decision.action !== "confirm") continue;
      try {
        proposal(raw, existing, official, evidence, { [key]: decision });
      } catch (error) {
        // Keep the original reason/fingerprints for audit, but withdraw proposal authority.
        next[key] = {
          ...decision,
          action: "reject",
          previousAction: "confirm",
          withdrawnAt: now,
          withdrawalReason: error.message,
        };
      }
    }
    return next;
  }
  function validateSession(value) {
    if (
      !value ||
      value.version !== 2 ||
      !Array.isArray(value.officialRows) ||
      !Array.isArray(value.evidenceRows) ||
      !value.decisions ||
      typeof value.decisions !== "object" ||
      Array.isArray(value.decisions)
    )
      throw Error("不支援的進度檔格式");
    for (const r of [...value.officialRows, ...value.evidenceRows]) {
      if (
        !r ||
        typeof r !== "object" ||
        !D.HEADERS.every((h) => typeof r[h] === "string") ||
        Object.values(r).some((v) => typeof v !== "string")
      )
        throw Error("進度檔的資料欄位無效");
    }
    if (new Set(value.officialRows.map(id)).size !== value.officialRows.length)
      throw Error("進度檔有重複來源識別");
    for (const [k, d] of Object.entries(value.decisions))
      if (
        !d ||
        d.recordId !== k ||
        !["confirm", "reject"].includes(d.action) ||
        typeof d.reason !== "string"
      )
        throw Error("進度檔審核紀錄無效");
    return value;
  }
  return {
    stable,
    id,
    usable,
    similarity,
    suggest,
    buildEntries,
    findEvidence,
    decide,
    proposal,
    validateSession,
    suspendInvalidDecisions,
  };
});
