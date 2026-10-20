/* Conservative coordinate checks; never repairs, swaps or geocodes a CSV value. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./data-core"), require("./search-tools"));
  else root.LocationQuality = factory(root.GarbageData, root.SearchTools);
})(typeof globalThis !== "undefined" ? globalThis : this, function (D, T) {
  "use strict";
  const labels = {
    missing: "座標缺漏",
    invalid: "座標格式或數值無效",
    swapped: "疑似經緯度顛倒（未交換）",
    low_precision: "座標精度不足",
    outside_city: "座標不在參考高雄市範圍",
    district_mismatch: "座標與行政區不符",
    boundary_uncertain: "接近簡化區界，位置尚待確認",
    identity_conflict: "同一完整識別的座標不一致",
    place_conflict: "同區同地點出現不同座標",
    shared_coordinate: "多個不同地點共用座標，疑似預設位置",
    district_label: "原始行政區標示不一致",
    geometry_unavailable: "行政區圖資未通過檢查",
  };
  function coordinate(row) {
    const lon = D.canonical(row.經度),
      lat = D.canonical(row.緯度);
    if (!lon || !lat) return { reason: "missing" };
    const numeric = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
    if (!numeric.test(lon) || !numeric.test(lat)) return { reason: "invalid" };
    const point = [Number(lon), Number(lat)];
    if (point[0] >= 21 && point[0] <= 26 && point[1] >= 119 && point[1] <= 123)
      return { reason: "swapped" };
    if (
      !point.every(Number.isFinite) ||
      Math.abs(point[0]) > 180 ||
      Math.abs(point[1]) > 90
    )
      return { reason: "invalid" };
    if (
      (lon.split(".")[1] || "").length < 4 ||
      (lat.split(".")[1] || "").length < 4
    )
      return { point, reason: "low_precision" };
    return { point };
  }
  function decode(topology) {
    if (
      topology?.type !== "Topology" ||
      !topology.transform ||
      !Array.isArray(topology.objects?.map?.geometries)
    )
      throw Error("區界格式無效");
    const { scale, translate } = topology.transform;
    const arcs = topology.arcs.map((arc) => {
      let x = 0,
        y = 0;
      return arc.map((p) => {
        x += p[0];
        y += p[1];
        return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
      });
    });
    function ring(ids) {
      const points = [];
      for (const id of ids) {
        const arc = id >= 0 ? arcs[id] : [...arcs[~id]].reverse();
        points.push(...(points.length ? arc.slice(1) : arc));
      }
      return points;
    }
    const features = topology.objects.map.geometries.map((g) => {
      const polygons = (
        g.type === "Polygon"
          ? [g.arcs]
          : g.type === "MultiPolygon"
            ? g.arcs
            : []
      ).map((p) => p.map(ring));
      if (!polygons.length) throw Error("區界無多邊形");
      const points = polygons.flat(2);
      if (!points.every((p) => p.length === 2 && p.every(Number.isFinite)))
        throw Error("區界座標無效");
      return {
        name: g.properties.name,
        polygons,
        bounds: [
          Math.min(...points.map((p) => p[0])),
          Math.min(...points.map((p) => p[1])),
          Math.max(...points.map((p) => p[0])),
          Math.max(...points.map((p) => p[1])),
        ],
      };
    });
    if (
      features.length !== 38 ||
      new Set(features.map((f) => f.name)).size !== 38
    )
      throw Error("區界必須包含38個不重複行政區");
    return features;
  }
  function insideRing(p, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (
        a[1] > p[1] !== b[1] > p[1] &&
        p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
      )
        inside = !inside;
    }
    return inside;
  }
  function contains(p, feature) {
    const b = feature.bounds;
    return (
      p[0] >= b[0] &&
      p[0] <= b[2] &&
      p[1] >= b[1] &&
      p[1] <= b[3] &&
      feature.polygons.some(
        (polygon) =>
          insideRing(p, polygon[0]) &&
          !polygon.slice(1).some((hole) => insideRing(p, hole)),
      )
    );
  }
  function boundaryDistance(p, feature) {
    const sx = 111320 * Math.cos((p[1] * Math.PI) / 180),
      sy = 110540;
    let minimum = Infinity;
    for (const ring of feature.polygons.flat())
      for (let i = 0; i < ring.length - 1; i++) {
        const a = [(ring[i][0] - p[0]) * sx, (ring[i][1] - p[1]) * sy],
          b = [(ring[i + 1][0] - p[0]) * sx, (ring[i + 1][1] - p[1]) * sy];
        const dx = b[0] - a[0],
          dy = b[1] - a[1],
          length = dx * dx + dy * dy;
        const t = length
          ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / length))
          : 0;
        minimum = Math.min(minimum, Math.hypot(a[0] + t * dx, a[1] + t * dy));
      }
    return minimum;
  }
  function analyze(rows, topology) {
    let features = [];
    try {
      features = decode(topology);
    } catch {
      /* No geometry means no navigation. */
    }
    const records = rows.map((row) => {
      const value = coordinate(row),
        reasons = value.reason ? [value.reason] : [];
      if (!features.length) reasons.push("geometry_unavailable");
      if (value.point && !value.reason && features.length) {
        const city = features.filter((f) => contains(value.point, f));
        const own = city.find((f) => f.name === row.searchDistrict);
        if (!city.length) reasons.push("outside_city");
        else if (!own) reasons.push("district_mismatch");
        else if (boundaryDistance(value.point, own) < 300)
          reasons.push("boundary_uncertain");
      }
      const aliases = {
        三民東區: "三民區",
        三民西區: "三民區",
        北鳳山區: "鳳山區",
        南鳳山區: "鳳山區",
      };
      const declared = D.clean(row.行政區);
      if (declared && (aliases[declared] || declared) !== row.searchDistrict)
        reasons.push("district_label");
      return { row, id: T.stopId(row), point: value.point, reasons };
    });
    const identities = new Map(),
      places = new Map(),
      coordinates = new Map();
    function append(map, key, value) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(value);
    }
    for (const record of records) {
      append(identities, record.id, record);
      append(
        places,
        JSON.stringify([
          record.row.searchDistrict,
          D.canonical(record.row.停留地點),
        ]),
        record,
      );
      if (record.point)
        append(coordinates, JSON.stringify(record.point), record);
    }
    for (const group of identities.values())
      if (new Set(group.map((r) => JSON.stringify(r.point || null))).size > 1)
        group.forEach((r) => r.reasons.push("identity_conflict"));
    for (const group of places.values())
      if (
        new Set(
          group.filter((r) => r.point).map((r) => JSON.stringify(r.point)),
        ).size > 1
      )
        group.forEach((r) => r.reasons.push("place_conflict"));
    for (const group of coordinates.values())
      if (new Set(group.map((r) => D.canonical(r.row.停留地點))).size >= 3)
        group.forEach((r) => r.reasons.push("shared_coordinate"));
    const byRow = new WeakMap();
    for (const record of records) {
      record.reasons = [...new Set(record.reasons)];
      record.eligible = record.reasons.length === 0;
      byRow.set(record.row, record);
    }
    return { records, byRow };
  }
  function navigationURL(record) {
    if (
      !record?.eligible ||
      record.reasons?.length ||
      !record.point?.every(Number.isFinite)
    )
      return null;
    const [lon, lat] = record.point;
    if (lon < 119 || lon > 122 || lat < 21 || lat > 25) return null;
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("destination", lat + "," + lon);
    return url.href;
  }
  return {
    labels,
    coordinate,
    decode,
    contains,
    boundaryDistance,
    analyze,
    navigationURL,
  };
});
