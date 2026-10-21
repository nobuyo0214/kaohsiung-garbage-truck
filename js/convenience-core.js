/* Sharing and backups contain identifiers only: no dates, coordinates or search history. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(
      require("./data-core"),
      require("./search-tools"),
      require("./route-files"),
    );
  else
    root.Convenience = factory(
      root.GarbageData,
      root.SearchTools,
      root.RouteFiles,
    );
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function (D, T, files) {
    "use strict";
    const FORMAT = "kaohsiung-garbage-truck/favorites",
      MAX_BYTES = 256 * 1024;
    const fields = [
      "sourceFile",
      "district",
      "responsibility",
      "trip",
      "place",
      "time",
    ];
    // 大寮區 is already served by rows in sanmin-west.csv (see prepareRows).
    const districts = new Set([...files.map((f) => f.district), "大寮區"]);
    // Text search is a convenience link, never coordinate validation or navigation.
    function mapSearchURL(district, place) {
      if (
        typeof district !== "string" ||
        !districts.has(district) ||
        typeof place !== "string" ||
        /[\u0000-\u001f\u007f<>]/.test(place)
      )
        return null;
      const name = D.canonical(place).replace(/\s+/g, " ");
      if (
        name.length < 3 ||
        name.length > 120 ||
        /(?:https?:|javascript:|data:|www\.|未提供|尚未|待確認|待補|不詳|不明|未知|無資料|未填|某某)/i.test(name)
      )
        return null;
      // Require a named street, a numbered address, or a named public landmark.
      // Bare "路口", "市場前", "活動中心", coordinates and directions stay unavailable.
      const specific =
        /[\p{Script=Han}A-Za-z0-9]{2,}(?:大道|公路|路|街|巷)/u.test(name) ||
        /\p{Script=Han}+[0-9一二三四五六七八九十百]+(?:[-之][0-9一二三四五六七八九十百]+)*號/u.test(name) ||
        /[\p{Script=Han}A-Za-z0-9]{2,}(?:國小|國中|高中|大學|市場|公園|活動中心|派出所|分駐所|衛生所|郵局|圖書館|車站|農會|教會|大樓|宿舍|籃球場|隧道|橋|宮|廟|寺|祠)/u.test(name);
      if (
        !specific ||
        /^(?:公有市場|社區活動中心|產業道路)(?:前|旁|附近)?$/.test(name)
      )
        return null;
      const url = new URL("https://www.google.com/maps/search/");
      url.searchParams.set("api", "1");
      url.searchParams.set("query", "高雄市 " + district + " " + name);
      return url.href.length <= 2048 ? url.href : null;
    }
    function identifier(value) {
      if (
        !Array.isArray(value) ||
        value.length !== 6 ||
        value.some(
          (s) => typeof s !== "string" || /[\u0000-\u001f\u007f]/.test(s),
        )
      )
        throw Error("收藏站點識別格式不正確");
      const [file, district, zone, trip, place, time] = value,
        known = files.find((f) => f.name === file);
      if (
        !known ||
        !(
          district === known.district ||
          (file === "sanmin-west.csv" && district === "大寮區")
        ) ||
        !D.clean(place) ||
        place.length > 300 ||
        zone.length > 80 ||
        trip.length > 80 ||
        time.length > 80
      )
        throw Error("收藏的來源、行政區或識別內容無效");
      // Empty legacy zone/trip/time remain identifiable backups, but never become shareable proof.
      return JSON.stringify(value);
    }
    function parseId(id) {
      if (typeof id !== "string" || id.length > 1500)
        throw Error("站點識別過長或無效");
      return identifier(JSON.parse(id));
    }
    function lookup(rows, id) {
      return rows instanceof Map
        ? rows.get(id) || []
        : rows.filter((r) => T.stopId(r) === id);
    }
    function identityIndex(rows) {
      const result = new Map();
      for (const row of rows) {
        const id = T.stopId(row);
        if (!result.has(id)) result.set(id, []);
        result.get(id).push(row);
      }
      return result;
    }
    function shareable(id, rows) {
      try {
        const canonical = parseId(id),
          values = JSON.parse(canonical);
        return (
          canonical === id &&
          values.slice(2).every((v) => D.clean(v)) &&
          !!D.normalizeTime(values[5]) &&
          lookup(rows, id).length === 1
        );
      } catch {
        return false;
      }
    }
    function encode(id) {
      const bytes = new TextEncoder().encode(id);
      return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    }
    function shareURL(id, pageURL) {
      const canonical = parseId(id),
        base = new URL("./", pageURL);
      if (!["https:", "http:"].includes(base.protocol))
        throw Error("分享網址必須使用HTTP或HTTPS");
      base.username = "";
      base.password = "";
      base.search = "";
      base.hash = "stop=1." + encode(canonical);
      return base.href;
    }
    function sharedId(pageURL) {
      const url = new URL(pageURL),
        params = new URLSearchParams(url.hash.slice(1));
      if (!params.has("stop")) return null;
      if ([...params.keys()].length !== 1 || params.getAll("stop").length !== 1)
        throw Error("分享連結格式無效");
      const token = params.get("stop");
      if (!/^1\.[A-Za-z0-9_-]+$/.test(token) || token.length > 7000)
        throw Error("分享版本或識別無效");
      const binary = atob(token.slice(2).replace(/-/g, "+").replace(/_/g, "/")),
        id = new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(binary, (c) => c.charCodeAt(0)),
        );
      if (parseId(id) !== id || "1." + encode(id) !== token)
        throw Error("分享識別不完整");
      return id;
    }
    function exportFavorites(ids) {
      if (!Array.isArray(ids) || ids.length > 200) throw Error("收藏最多200筆");
      return {
        format: FORMAT,
        version: 1,
        favorites: [...new Set(ids.map(parseId))].map((id) =>
          Object.fromEntries(
            JSON.parse(id).map((value, i) => [fields[i], value]),
          ),
        ),
      };
    }
    function importFavorites(
      text,
      byteLength = new TextEncoder().encode(text).length,
    ) {
      if (
        byteLength > MAX_BYTES ||
        new TextEncoder().encode(text).length > MAX_BYTES
      )
        throw Error("檔案超過256KB，未變更收藏");
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw Error("不是有效的JSON檔案，未變更收藏");
      }
      if (
        !data ||
        Array.isArray(data) ||
        data.format !== FORMAT ||
        data.version !== 1 ||
        Object.keys(data).some(
          (k) => !["format", "version", "favorites"].includes(k),
        )
      )
        throw Error("收藏備份格式或版本不相容，未變更收藏");
      if (!Array.isArray(data.favorites) || data.favorites.length > 200)
        throw Error("收藏清單格式錯誤或超過200筆，未變更收藏");
      return [
        ...new Set(
          data.favorites.map((row) => {
            if (
              !row ||
              Array.isArray(row) ||
              Object.keys(row).length !== fields.length ||
              !fields.every((k) => Object.hasOwn(row, k))
            )
              throw Error("收藏備份缺少必要識別欄位，未變更收藏");
            return identifier(fields.map((k) => row[k]));
          }),
        ),
      ];
    }
    function mergeFavorites(existing, incoming) {
      const result = [...new Set([...existing, ...incoming])];
      if (result.length > 200)
        throw Error("合併後超過200筆，請先取消部分收藏；目前收藏未變更");
      return result;
    }
    function unresolved(ids, rows) {
      return ids.filter((id) => {
        const values = JSON.parse(parseId(id));
        return (
          lookup(rows, id).length !== 1 ||
          !values.slice(2).every(D.clean) ||
          !D.normalizeTime(values[5])
        );
      });
    }
    return {
      FORMAT,
      MAX_BYTES,
      fields,
      mapSearchURL,
      parseId,
      lookup,
      identityIndex,
      shareable,
      shareURL,
      sharedId,
      exportFavorites,
      importFavorites,
      mergeFavorites,
      unresolved,
    };
  },
);
