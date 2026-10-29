#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  Papa = require("papaparse"),
  D = require("../js/data-core"),
  T = require("../js/search-tools"),
  routes = require("../js/route-files");
const root = path.resolve(__dirname, ".."),
  sha = (value) => crypto.createHash("sha256").update(value).digest("hex"),
  sort = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function snapshot(inputs) {
  const files = [...inputs]
    .sort((a, b) => sort(a.name, b.name))
    .map((file) => {
      const result = Papa.parse(file.content, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (h) => h.trim().replace(/^\uFEFF/, ""),
      });
      if (
        result.errors.length ||
        !["責任區", "車次", "停留地點", "停留時間"].every((h) =>
          result.meta.fields.includes(h),
        )
      )
        throw Error("路線快照CSV格式無效：" + file.name);
      const fields = [...result.meta.fields].sort(sort),
        records = result.data
          .map((raw) => {
            const row = D.prepareRows([raw], file)[0];
            const id = row ? T.stopId(row) : null,
              complete =
                id &&
                JSON.parse(id).every((value) => D.clean(value)) &&
                D.normalizeTime(row.停留時間);
            return [
              complete ? id : null,
              row?.searchDistrict || file.district,
              fields.map((key) => raw[key] ?? ""),
            ];
          })
          .sort((a, b) => sort(JSON.stringify(a), JSON.stringify(b)));
      return {
        name: file.name,
        district: file.district,
        byteHash: sha(Buffer.from(file.content, "utf8")),
        fields,
        records,
      };
    });
  const byteRevision = sha(
      JSON.stringify(files.map((f) => [f.name, f.byteHash])),
    ),
    contentRevision = sha(JSON.stringify(files.map(({ byteHash, ...f }) => f)));
  const valid = files.flatMap((f) =>
      f.records.filter((r) => D.clean(r[2][f.fields.indexOf("停留地點")])),
    ),
    districts = [...new Set(valid.map((r) => r[1]))].sort(sort);
  return {
    version: 1,
    byteRevision,
    contentRevision,
    counts: {
      districts: districts.length,
      files: files.length,
      validRecords: valid.length,
    },
    files,
  };
}
function differences(before, after) {
  const changes = new Map(),
    ensure = (d) => {
      if (!changes.has(d))
        changes.set(d, {
          district: d,
          added: 0,
          removed: 0,
          modified: 0,
          uncertainBefore: 0,
          uncertainAfter: 0,
        });
      return changes.get(d);
    };
  const group = (s) => {
    const map = new Map();
    for (const f of s.files)
      for (const r of f.records) {
        const key = JSON.stringify([f.name, r[0]]);
        if (!map.has(key)) map.set(key, []);
        map
          .get(key)
          .push({
            id: r[0],
            district: r[1],
            value: JSON.stringify(f.fields.map((field, i) => [field, r[2][i]])),
          });
      }
    return map;
  };
  const a = group(before),
    b = group(after);
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const old = a.get(key) || [],
      next = b.get(key) || [],
      remaining = [...next];
    const removed = old.filter((r) => {
      const i = remaining.findIndex(
        (n) => n.value === r.value && n.district === r.district,
      );
      if (i < 0) return true;
      remaining.splice(i, 1);
      return false;
    });
    if (!removed.length && !remaining.length) continue;
    if (old.length > 1 || next.length > 1 || !(old[0]?.id || next[0]?.id)) {
      for (const r of removed) ensure(r.district).uncertainBefore++;
      for (const r of remaining) ensure(r.district).uncertainAfter++;
    } else if (removed.length && remaining.length) {
      ensure(remaining[0].district).modified++;
    } else {
      for (const r of removed) ensure(r.district).removed++;
      for (const r of remaining) ensure(r.district).added++;
    }
  }
  const byDistrict = [...changes.values()].sort((a, b) =>
    sort(a.district, b.district),
  );
  return {
    fileBytesChanged: before.byteRevision !== after.byteRevision,
    stationContentChanged: before.contentRevision !== after.contentRevision,
    byDistrict,
    totals: byDistrict.reduce(
      (s, r) => {
        for (const k of Object.keys(s)) s[k] += r[k];
        return s;
      },
      {
        added: 0,
        removed: 0,
        modified: 0,
        uncertainBefore: 0,
        uncertainAfter: 0,
      },
    ),
  };
}
function generate({
  check = false,
  directory = root,
  inputFiles = routes,
  now = () => new Date().toISOString(),
} = {}) {
  const current = snapshot(
      inputFiles.map((f) => ({
        ...f,
        content: fs.readFileSync(path.join(directory, f.name), "utf8"),
      })),
    ),
    folder = path.join(directory, "data/history"),
    snapshotName = current.byteRevision + ".json",
    target = path.join(folder, snapshotName),
    historyPath = path.join(folder, "index.json");
  const history = fs.existsSync(historyPath)
      ? JSON.parse(fs.readFileSync(historyPath, "utf8"))
      : {
          version: 1,
          note: "從此基準開始追蹤；紀錄時間非官方發布日期。歷史下載版本不完整，未補造過去變更。",
          entries: [],
        },
    last = history.entries.at(-1);
  if (!last || last.byteRevision !== current.byteRevision) {
    if (check) throw Error("資料變更紀錄過期，請執行 npm run build:site");
    const previous = last
      ? JSON.parse(fs.readFileSync(path.join(folder, last.snapshot), "utf8"))
      : null;
    history.entries.push({
      kind: last ? "change" : "baseline",
      recordedAt: now(),
      byteRevision: current.byteRevision,
      contentRevision: current.contentRevision,
      counts: current.counts,
      snapshot: snapshotName,
      officialPublishedAt: null,
      sourceNote:
        "高雄市環保局相關開放資料與部分環境部路線整理；逐檔原始下載版本未完整保存。",
      difference: previous ? differences(previous, current) : null,
    });
  }
  const text = JSON.stringify(current) + "\n";
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== text)
      throw Error("路線內容快照不符，請重建");
  } else {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(target, text);
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
  }
  return { current, history };
}
if (require.main === module)
  generate({ check: process.argv.includes("--check") });
module.exports = { snapshot, differences, generate };
