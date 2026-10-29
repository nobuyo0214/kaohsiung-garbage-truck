/* Public distance and Taipei schedule helpers. User coordinates remain ephemeral, never part of identifiers. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./data-core"), require("./search-tools"), require("./location-quality"));
  else root.Journey = factory(root.GarbageData, root.SearchTools, root.LocationQuality);
})(typeof globalThis !== "undefined" ? globalThis : this, function (D, T, L) {
  "use strict";
  const RADII = Object.freeze([500, 1000, 3000, 5000]);
  const POSITION_LIFETIME = 5 * 60 * 1000;
  function validPoint(point) {
    return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) &&
      Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
  }
  // Point order follows the existing quality report: [longitude, latitude].
  function haversine(a, b) {
    if (!validPoint(a) || !validPoint(b)) return null;
    const radians = Math.PI / 180, lat1 = a[1] * radians, lat2 = b[1] * radians;
    const h = Math.sin((lat2 - lat1) / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin((b[0] - a[0]) * radians / 2) ** 2;
    return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
  }
  function nearbyIndex(displayRows, audit) {
    // Reuse the exact audit used by card navigation, including its completeness gate.
    const eligible = displayRows.flatMap(row => {
      const record = audit?.byRow.get(row);
      return L.navigationURL(record) ? [{ row, point: record.point }] : [];
    });
    return {
      size: eligible.length,
      search(origin, radius) {
        if (!validPoint(origin) || !RADII.includes(radius)) return [];
        return eligible.map(({ row, point }) => ({ row, distance: haversine(origin, point) }))
          .filter(entry => entry.distance !== null && entry.distance <= radius)
          .sort((a, b) => a.distance - b.distance);
      },
    };
  }
  function formatDistance(metres) {
    if (!Number.isFinite(metres) || metres < 0) return "距離尚未提供";
    const distance = metres < 10 ? "10公尺內" : metres < 1000
      ? Math.round(metres / 10) * 10 + "公尺" : (metres / 1000).toFixed(2) + "公里";
    return "距離約 " + distance + "（直線距離）";
  }
  function positionValue(position, now = Date.now()) {
    const coords = position?.coords, point = [coords?.longitude, coords?.latitude];
    if (!validPoint(point) || !Number.isFinite(coords.accuracy) || coords.accuracy < 0 ||
        coords.accuracy > 1000 || !Number.isFinite(position.timestamp) ||
        !Number.isFinite(now) || now - position.timestamp > 60000 || position.timestamp > now + 5000)
      return null;
    return { point, accuracy: coords.accuracy, obtainedAt: now };
  }
  function taipeiClock(now = new Date()) {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map(part => [part.type, part.value]));
    return { date: parts.year + "-" + parts.month + "-" + parts.day,
      day: T.taipeiWeekday(now), minute: Number(parts.hour) * 60 + Number(parts.minute),
      time: parts.hour + ":" + parts.minute };
  }
  function schedule(row) {
    const normalized = D.normalizeTime(row.停留時間);
    if (!normalized) return { normalized: "", start: null, crossesMidnight: false };
    const times = normalized.split("-").map(t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)));
    return { normalized, start: times[0], crossesMidnight: times.length === 2 && times[1] < times[0] };
  }
  function todayRows(rows, { now = new Date(), remaining = false } = {}) {
    const clock = taipeiClock(now);
    if (!clock) return [];
    return rows.filter(row => D.matchesWeekday(row.recycleDay, clock.day))
      .map(row => ({ row, ...schedule(row) }))
      .filter(entry => !remaining || (entry.start !== null && !entry.crossesMidnight && entry.start >= clock.minute))
      .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity))
      .map(entry => entry.row);
  }
  return { taipeiClock, schedule, todayRows, RADII, POSITION_LIFETIME, validPoint, haversine, nearbyIndex, formatDistance, positionValue };
});
