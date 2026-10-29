const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  D = require("../js/data-core"),
  T = require("../js/search-tools"),
  J = require("../js/journey-core"),
  L = require("../js/location-quality"),
  { load } = require("../scripts/data-tool.cjs");
const rows = load(),
  index = T.createIndex(rows),
  display = index.search({ district: "all" });
test("weekday memoization preserves all original weekday interpretations including legacy/unknown values", () => {
  const match = T.weekdayMatcher();
  for (const value of [
    "",
    null,
    "每日",
    "週二至週五",
    "五至一",
    "除週日",
    "一三五",
    "回收日待確認",
    "天天",
  ])
    for (const day of [
      "",
      "一",
      "二",
      "三",
      "四",
      "五",
      "六",
      "日",
      "invalid",
    ]) {
      assert.equal(match(value, day), D.matchesWeekday(value, day));
      assert.equal(match(value, day), D.matchesWeekday(value, day));
    }
});
test("optimized whole city and every district preserve result order, keywords, recycling/legacy weekdays and periods", () => {
  for (const district of ["all", ...index.districts.keys()])
    for (const sortOrder of ["asc", "desc"])
      for (const weekday of ["", "一", "五"]) {
        const filters = {
            district,
            sortOrder,
            weekday,
            dayType: "recycle",
            keyword: weekday ? "路" : "",
            period: weekday ? "evening" : "",
          },
          base =
            district === "all"
              ? [...index.districts.values()].flat()
              : index.districts.get(district),
          expected =
            district === "all"
              ? base
                  .filter(
                    (r) =>
                      (!filters.keyword ||
                        D.normalize(
                          D.clean(r.停留地點) + " " + r.villageName,
                        ).includes(D.normalize(filters.keyword))) &&
                      D.matchesWeekday(r.recycleDay, weekday) &&
                      D.matchesPeriod(r.startMinute, filters.period),
                  )
                  .sort((a, b) =>
                    a.startMinute === null
                      ? b.startMinute === null
                        ? 0
                        : 1
                      : b.startMinute === null
                        ? -1
                        : (sortOrder === "desc" ? -1 : 1) *
                          (a.startMinute - b.startMinute),
                  )
              : D.search(base, filters);
        assert.deepEqual(index.search(filters), expected);
        assert.deepEqual(
          index.search(filters).slice(0, 30),
          expected.slice(0, 30),
        );
      }
});
test("schedule cache invalidates on source-time change, timeline ordering equals independent original algorithm", () => {
  for (const remaining of [false, true])
    for (const district of ["all", "三民區", "岡山區"]) {
      const now = new Date("2026-10-29T08:00:00Z"),
        clock = J.taipeiClock(now),
        sample = index.search({ district }),
        original = sample
          .filter((r) => D.matchesWeekday(r.recycleDay, clock.day))
          .map((row) => ({ row, ...J.schedule(row) }))
          .filter(
            (r) =>
              !remaining ||
              (r.start !== null &&
                !r.crossesMidnight &&
                r.start >= clock.minute),
          )
          .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity))
          .map((r) => r.row);
      assert.deepEqual(J.todayRows(sample, { now, remaining }), original);
    }
  const row = { 停留時間: "17:00-17:02" };
  assert.equal(J.schedule(row).start, 1020);
  row.停留時間 = "18:00";
  assert.equal(J.schedule(row).start, 1080);
});
test("existing nearby index still equals a full independent eligible Haversine scan for each radius", () => {
  const audit = L.analyze(rows, require("../data/geo/kaohsiung.topo.json")),
    nearby = J.nearbyIndex(display, audit),
    origin = [120.32406, 22.66913];
  for (const radius of J.RADII) {
    const expected = display
      .filter((row) => L.navigationURL(audit.byRow.get(row)))
      .map((row) => ({
        row,
        distance: J.haversine(origin, audit.byRow.get(row).point),
      }))
      .filter((r) => r.distance <= radius)
      .sort((a, b) => a.distance - b.distance);
    assert.deepEqual(nearby.search(origin, radius), expected);
  }
});
