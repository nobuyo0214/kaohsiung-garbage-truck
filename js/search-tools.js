/* Public search helpers. No candidate review or inferred dates enter this module. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./data-core"));
  else root.SearchTools = factory(root.GarbageData);
})(typeof globalThis !== "undefined" ? globalThis : this, function (D) {
  "use strict";
  const defaults = {
    district: "",
    village: "",
    keyword: "",
    dayType: "recycle",
    weekday: "",
    period: "",
    sortOrder: "asc",
  };
  const stable = (r) =>
    JSON.stringify(
      Object.keys(r)
        .sort()
        .map((k) => [k, r[k]]),
    );
  // Collapse identical displayed content only, AFTER applyRules checks raw ambiguity.
  // Seq and coordinates are retained in the raw data; neither is rendered as a different stop.
  function createIndex(rows) {
    const districts = new Map(),
      seen = new Map(),
      text = new WeakMap(),
      occurrences = new WeakMap();
    for (const row of rows) {
      const signature = JSON.stringify([
        stopId(row),
        row.villageName,
        row.recycleDay,
        row.garbageDay,
      ]);
      if (seen.has(signature)) {
        const first = seen.get(signature);
        occurrences.set(first, occurrences.get(first) + 1);
        continue;
      }
      seen.set(signature, row);
      occurrences.set(row, 1);
      if (!districts.has(row.searchDistrict))
        districts.set(row.searchDistrict, []);
      districts.get(row.searchDistrict).push(row);
      text.set(row, D.normalize(D.clean(row.停留地點) + " " + row.villageName));
    }
    const descending = new Map();
    for (const [district, bucket] of districts) {
      bucket.sort((a, b) =>
        a.startMinute === null
          ? b.startMinute === null
            ? 0
            : 1
          : b.startMinute === null
            ? -1
            : a.startMinute - b.startMinute,
      );
      descending.set(
        district,
        [...bucket].sort((a, b) =>
          a.startMinute === null
            ? b.startMinute === null
              ? 0
              : 1
            : b.startMinute === null
              ? -1
              : b.startMinute - a.startMinute,
        ),
      );
    }
    function search(filters) {
      const f = { ...defaults, ...filters },
        keyword = D.normalize(f.keyword);
      const bucket =
        (f.sortOrder === "desc" ? descending : districts).get(f.district) || [];
      return bucket.filter(
        (r) =>
          (!f.village || r.villageName === f.village) &&
          (!keyword || text.get(r).includes(keyword)) &&
          D.matchesWeekday(
            f.dayType === "garbage" ? r.garbageDay : r.recycleDay,
            f.weekday,
          ) &&
          D.matchesPeriod(r.startMinute, f.period),
      );
    }
    function suggest(district, village, value, limit = 8) {
      const keyword = D.normalize(value);
      if (!keyword) return [];
      const places = new Set();
      for (const row of districts.get(district) || []) {
        if (
          (!village || row.villageName === village) &&
          text.get(row).includes(keyword)
        )
          places.add(D.clean(row.停留地點));
        if (places.size >= limit) break;
      }
      return [...places];
    }
    return {
      districts,
      search,
      suggest,
      occurrences,
      duplicateCount: rows.length - seen.size,
    };
  }
  function stopId(row) {
    // Keep invalid raw times distinct too; no arrival-only or place-only fallback.
    return JSON.stringify([
      row.sourceFile,
      row.searchDistrict,
      D.canonical(row.責任區),
      D.canonical(row.車次),
      D.canonical(row.停留地點),
      D.normalizeTime(row.停留時間) || D.canonical(row.停留時間),
    ]);
  }
  function taipeiWeekday(now = new Date()) {
    const date = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      weekday: "short",
    }).format(now);
    return {
      Mon: "一",
      Tue: "二",
      Wed: "三",
      Thu: "四",
      Fri: "五",
      Sat: "六",
      Sun: "日",
    }[date];
  }
  function validFilters(value, districts) {
    return (
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      districts.includes(value.district) &&
      typeof value.village === "string" &&
      value.village.length <= 100 &&
      typeof value.keyword === "string" &&
      value.keyword.length <= 200 &&
      ["recycle", "garbage"].includes(value.dayType) &&
      ["", ..."一二三四五六日"].includes(value.weekday) &&
      ["", "morning", "afternoon", "evening", "night", "dawn"].includes(
        value.period,
      ) &&
      ["asc", "desc"].includes(value.sortOrder)
    );
  }
  function remember(history, filters) {
    const entry = Object.fromEntries(
      Object.keys(defaults).map((k) => [k, filters[k]]),
    );
    const signature = stable(entry);
    return [entry, ...history.filter((h) => stable(h) !== signature)].slice(
      0,
      6,
    );
  }
  function validStopId(id) {
    if (typeof id !== "string" || id.length > 1500) return false;
    try {
      const fields = JSON.parse(id);
      return (
        Array.isArray(fields) &&
        fields.length === 6 &&
        fields.every((v) => typeof v === "string")
      );
    } catch {
      return false;
    }
  }
  function readPreferences(storage, districts) {
    const value = JSON.parse(storage.getItem("garbage-search-v1") || "null");
    if (!value || value.version !== 1) return { favorites: [], recent: [] };
    return {
      favorites: Array.isArray(value.favorites)
        ? [...new Set(value.favorites.filter(validStopId))].slice(0, 200)
        : [],
      recent: Array.isArray(value.recent)
        ? value.recent
            .filter((f) => validFilters(f, districts))
            .map((f) => ({
              ...defaults,
              ...Object.fromEntries(
                Object.keys(defaults).map((k) => [k, f[k]]),
              ),
            }))
            .slice(0, 6)
        : [],
    };
  }
  return {
    createIndex,
    stopId,
    taipeiWeekday,
    validFilters,
    remember,
    readPreferences,
  };
});
