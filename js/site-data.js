(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./route-files"));
  else root.SiteData = factory(root.RouteFiles);
})(typeof globalThis !== "undefined" ? globalThis : this, function (files) {
  "use strict";
  const paths = [
    ...files.map((f) => f.name),
    "garbage-days.csv",
    "data/geo/kaohsiung.topo.json",
  ];
  const hash = (s) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
  function validate(value) {
    if (
      value?.version !== 1 ||
      !hash(value.dataRevision) ||
      !value.files ||
      paths.some((p) => !hash(value.files[p])) ||
      typeof value.snapshotRecordedAt !== "string" ||
      !Number.isFinite(Date.parse(value.snapshotRecordedAt)) ||
      value.officialUpdatedAt !== null ||
      value.originalImportedAt !== null
    )
      throw Error("網站資料版本資訊無效，請重新整理或稍後重試");
    return value;
  }
  async function request(path, fetcher = fetch) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetcher(path, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw Error("無法取得資料版本或圖資");
      return new Uint8Array(await response.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }
  async function metadata(fetcher) {
    const value = validate(
      JSON.parse(
        new TextDecoder().decode(
          await request("data/site-metadata.json", fetcher),
        ),
      ),
    );
    const bytes = new TextEncoder().encode(
      JSON.stringify(Object.fromEntries(paths.map((p) => [p, value.files[p]]))),
    );
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    if (
      Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("") !== value.dataRevision
    )
      throw Error("資料版本與檔案雜湊清單不一致");
    return value;
  }
  async function geometry(meta, fetcher) {
    const bytes = await request("data/geo/kaohsiung.topo.json", fetcher),
      digest = await crypto.subtle.digest("SHA-256", bytes);
    const actual = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    if (actual !== meta.files["data/geo/kaohsiung.topo.json"])
      throw Error("圖資版本不一致，暫不提供導航");
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  return { validate, metadata, geometry, paths };
});
