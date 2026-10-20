/* Pure functions shared by GitHub Pages and the offline CSV tools. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./route-files.js"));
  else root.GarbageData = factory(root.RouteFiles);
})(typeof globalThis !== "undefined" ? globalThis : this, function (files) {
  "use strict";
  const HEADERS = [
    "來源檔案",
    "責任區",
    "車次",
    "停留地點",
    "停留時間",
    "一般垃圾日",
    "官方來源",
  ];
  const validFiles = new Set(files.map((f) => f.name));
  const clean = (v) => String(v == null ? "" : v).trim();
  const canonical = (v) => clean(v).normalize("NFKC");
  const normalize = (v) => canonical(v).toLowerCase().replace(/\s+/g, "");
  function normalizeTime(value) {
    const t = canonical(value).replace(/\s*:\s*/g, ":");
    // Parse the whole value: never salvage a valid-looking substring from bad data.
    const m = t.match(
      /^([01]?\d|2[0-3]):([0-5]\d)(?:\s*[-~～–—至]\s*([01]?\d|2[0-3]):([0-5]\d))?$/,
    );
    if (!m) return "";
    return (
      m[1].padStart(2, "0") +
      ":" +
      m[2] +
      (m[3] ? "-" + m[3].padStart(2, "0") + ":" + m[4] : "")
    );
  }
  function normalizeDays(value) {
    const t = canonical(value).replace(/[,，\s]+/g, "、");
    if (!/^[一二三四五六日](、[一二三四五六日])*$/.test(t)) return "";
    return [...new Set(t.split("、"))]
      .sort((a, b) => "一二三四五六日".indexOf(a) - "一二三四五六日".indexOf(b))
      .join("、");
  }
  function officialURL(value) {
    try {
      const u = new URL(clean(value));
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        (!u.port || u.port === "443") &&
        u.hostname.endsWith(".gov.tw")
      );
    } catch {
      return false;
    }
  }
  function key(row, includeTime = true) {
    const values = [
      row["來源檔案"] || row.sourceFile,
      row["責任區"],
      row["車次"],
      row["停留地點"],
    ].map(canonical);
    if (includeTime) values.push(normalizeTime(row["停留時間"]));
    return JSON.stringify(values);
  }
  function validRule(row) {
    return (
      validFiles.has(clean(row["來源檔案"])) &&
      ["責任區", "車次", "停留地點"].every((k) => clean(row[k])) &&
      !!normalizeTime(row["停留時間"]) &&
      !!normalizeDays(row["一般垃圾日"]) &&
      officialURL(row["官方來源"])
    );
  }
  function getStartMinute(value) {
    const t = normalizeTime(value);
    return t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null;
  }
  function prepareRows(rows, file) {
    return rows
      .filter((r) => clean(r["停留地點"]))
      .map((row) => ({
        ...row,
        sourceFile: file.name,
        來源檔案: file.name,
        searchDistrict:
          clean(row["行政區"]) === "大寮區" ? "大寮區" : file.district,
        villageName: clean(row["村里"]),
        recycleDay: clean(row["回收日"]) || clean(row["回收日(星期)"]),
        garbageDay: clean(row["一般垃圾日"]) || clean(row["一般垃圾清運日"]),
        startMinute: getStartMinute(row["停留時間"]),
      }));
  }
  function applyRules(rows, rules) {
    const index = new Map(),
      conflicts = new Set(),
      rawCounts = new Map();
    for (const row of rows)
      rawCounts.set(key(row), (rawCounts.get(key(row)) || 0) + 1);
    let skipped = 0,
      matched = 0,
      added = 0,
      originalConflicts = 0;
    for (const rule of rules) {
      if (!validRule(rule)) {
        skipped++;
        continue;
      }
      const k = key(rule),
        day = normalizeDays(rule["一般垃圾日"]);
      if (index.has(k) && index.get(k) !== day) conflicts.add(k);
      else index.set(k, day);
    }
    for (const k of conflicts) index.delete(k);
    for (const row of rows) {
      // Existing confirmed raw dates are always retained, including disagreements.
      if (!normalizeTime(row["停留時間"]) || rawCounts.get(key(row)) !== 1)
        continue;
      const day = index.get(key(row));
      if (!day) continue;
      matched++;
      if (!row.garbageDay) {
        row.garbageDay = day;
        added++;
      } else if (normalizeDays(row.garbageDay) !== day) originalConflicts++;
    }
    return {
      ok: true,
      rules: index.size,
      matched,
      added,
      skipped,
      conflicts: conflicts.size + originalConflicts,
    };
  }
  function matchesWeekday(value, day) {
    if (!day) return true;
    let t = canonical(value)
      .replace(/星期|週|周/g, "")
      .replace(/天/g, "日");
    if (/每日|每天|天天/.test(canonical(value))) return true;
    // Expand every explicit range, including 二至五; do not interpret exclusions as inclusions.
    if (/除|不|休|停/.test(t)) return false;
    t = t.replace(
      /([一二三四五六日])[至到~～-]([一二三四五六日])/g,
      (_, a, b) => {
        const days = "一二三四五六日",
          start = days.indexOf(a),
          end = days.indexOf(b);
        return end >= start
          ? days.slice(start, end + 1)
          : days.slice(start) + days.slice(0, end + 1);
      },
    );
    return t.includes(day);
  }
  const periods = {
    morning: [360, 720],
    afternoon: [720, 1020],
    evening: [1020, 1200],
    night: [1200, 1440],
    dawn: [0, 360],
  };
  function matchesPeriod(minute, period) {
    if (!period) return true;
    const range = periods[period];
    return (
      minute !== null && (!range || (minute >= range[0] && minute < range[1]))
    );
  }
  function search(rows, filters) {
    const {
      district,
      village = "",
      keyword = "",
      dayType = "recycle",
      weekday = "",
      period = "",
      sortOrder = "asc",
    } = filters;
    return rows
      .filter(
        (r) =>
          r.searchDistrict === district &&
          (!village || r.villageName === village) &&
          (!keyword ||
            normalize(clean(r["停留地點"]) + " " + r.villageName).includes(
              normalize(keyword),
            )) &&
          matchesWeekday(
            dayType === "garbage" ? r.garbageDay : r.recycleDay,
            weekday,
          ) &&
          matchesPeriod(r.startMinute, period),
      )
      .sort((a, b) =>
        a.startMinute === null
          ? b.startMinute === null
            ? 0
            : 1
          : b.startMinute === null
            ? -1
            : (sortOrder === "desc" ? -1 : 1) * (a.startMinute - b.startMinute),
      );
  }
  function timeStatus(official, raw) {
    const a = normalizeTime(official),
      b = normalizeTime(raw);
    if (!a || !b) return "invalid_time";
    if (a === b) return "exact";
    return a.split("-")[0] === b.split("-")[0] &&
      a.includes("-") !== b.includes("-")
      ? "time_extent_mismatch"
      : "time_mismatch";
  }
  function reconcile(raw, existing, official) {
    const candidates = [],
      review = [],
      outcomes = [];
    const exact = new Map(),
      places = new Map();
    const append = (map, k, r) => map.set(k, [...(map.get(k) || []), r]);
    for (const r of raw) {
      append(exact, key(r), r);
      append(
        places,
        JSON.stringify([
          r.sourceFile,
          canonical(r["責任區"]),
          canonical(r["停留地點"]),
        ]),
        r,
      );
    }
    // Group input first: every member of a conflicting official key is blocked.
    const groups = new Map();
    for (const r of official) append(groups, key(r), r);
    const emitted = new Set();
    for (const o of official) {
      let status = "";
      const k = key(o),
        same = exact.get(k) || [];
      const possible = (
        places.get(
          JSON.stringify([
            clean(o["來源檔案"]),
            canonical(o["責任區"]),
            canonical(o["停留地點"]),
          ]),
        ) || []
      ).filter(
        (r) =>
          !clean(o["車次"]) || canonical(r["車次"]) === canonical(o["車次"]),
      );
      const existingSame = existing.filter((r) => key(r) === k);
      if (!validFiles.has(clean(o["來源檔案"]))) status = "unknown_file";
      else if (!officialURL(o["官方來源"])) status = "invalid_source";
      else if (clean(o["證據狀態"]) === "stale") status = "stale_evidence";
      else if (clean(o["證據狀態"]) && clean(o["證據狀態"]) !== "verified")
        status = "unverified_evidence";
      else if (!normalizeDays(o["一般垃圾日"])) status = "missing_garbage_days";
      else if (
        !clean(o["責任區"]) ||
        !clean(o["車次"]) ||
        !clean(o["停留地點"])
      )
        status = "missing_identity";
      else if (!normalizeTime(o["停留時間"])) status = "invalid_time";
      else if (
        new Set(groups.get(k).map((r) => normalizeDays(r["一般垃圾日"]))).size >
        1
      )
        status = "official_conflict";
      else if (same.length > 1) status = "ambiguous_raw";
      else if (!same.length)
        status = possible.length
          ? possible.some(
              (r) =>
                timeStatus(o["停留時間"], r["停留時間"]) ===
                "time_extent_mismatch",
            )
            ? "time_extent_mismatch"
            : "time_mismatch"
          : "no_match";
      else if (
        existingSame.some(
          (r) =>
            normalizeDays(r["一般垃圾日"]) !== normalizeDays(o["一般垃圾日"]),
        )
      )
        status = "existing_conflict";
      else if (
        same[0].garbageDay &&
        normalizeDays(same[0].garbageDay) !== normalizeDays(o["一般垃圾日"])
      )
        status = "raw_conflict";
      else if (existingSame.length || same[0].garbageDay)
        status = "already_confirmed";
      else status = "candidate";
      const entry = {
        ...o,
        狀態: status,
        候選筆數: possible.length,
        CSV候選: possible
          .map((r) => `${r["車次"]}｜${r["停留時間"]}｜${r["停留地點"]}`)
          .join(" ; "),
        時間檢查: possible
          .map((r) => timeStatus(o["停留時間"], r["停留時間"]))
          .join(" ; "),
      };
      outcomes.push(entry);
      if (status === "candidate" && !emitted.has(k)) {
        candidates.push(
          Object.fromEntries(
            HEADERS.map((h) => [
              h,
              h === "一般垃圾日" ? normalizeDays(o[h]) : clean(o[h]),
            ]),
          ),
        );
        emitted.add(k);
      } else if (status !== "already_confirmed" && status !== "candidate")
        review.push(entry);
    }
    return { candidates, review, outcomes };
  }
  // Preserve every existing row verbatim; never silently drop conflicts or duplicates.
  function mergeRules(existing, additions) {
    const result = existing.map((r) => ({ ...r })),
      seen = new Map();
    for (const r of existing) {
      if (!validRule(r)) throw Error("既有規則無效，停止匯出");
      const k = key(r),
        d = normalizeDays(r["一般垃圾日"]);
      if (seen.has(k) && seen.get(k) !== d)
        throw Error("既有日期衝突，停止匯出");
      seen.set(k, d);
    }
    for (const r of additions) {
      if (!validRule(r))
        throw Error("新增規則需要完整五欄、一般垃圾日及政府來源");
      const k = key(r),
        d = normalizeDays(r["一般垃圾日"]);
      if (seen.has(k) && seen.get(k) !== d)
        throw Error("日期衝突，保留舊規則並停止匯出");
      if (!seen.has(k)) {
        result.push({ ...r });
        seen.set(k, d);
      }
    }
    return result;
  }
  return {
    HEADERS,
    clean,
    normalize,
    canonical,
    normalizeTime,
    normalizeDays,
    officialURL,
    key,
    validRule,
    getStartMinute,
    prepareRows,
    applyRules,
    matchesWeekday,
    matchesPeriod,
    search,
    timeStatus,
    reconcile,
    mergeRules,
  };
});
