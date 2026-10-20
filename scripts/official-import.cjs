#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const Papa = require("papaparse"),
  cheerio = require("cheerio");
const D = require("../js/data-core");
const root = path.resolve(__dirname, "..");
const registry = require("../data/sources/registry.json");
const accessResults = require("../data/sources/access-results.json");
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
const COLUMNS = {
  zone: "責任區",
  trip: "車次",
  place: "停留地點",
  time: "停留時間",
  days: "一般垃圾日",
  route: "官方路線序號",
  routeName: "官方路線名稱",
  sequence: "官方清運序",
  source: "官方來源",
  updated: "官方更新日期",
};
function parseCSV(text) {
  const r = Papa.parse(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().replace(/^\uFEFF/, ""),
  });
  if (r.errors.length) throw Error("CSV 解析失敗：" + JSON.stringify(r.errors));
  return r.data;
}
function moenvText(text) {
  const lines = text.split("\n").map((l) => l.replace(/^L\d+:\s?/, ""));
  const value = (label) => {
    const i = lines.findIndex((l) => l.trim() === label);
    return i < 0 ? "" : D.clean(lines[i + 1]);
  };
  const route = value("清運路線序號"),
    routeName = value("清運路線名稱");
  if (
    !route ||
    !routeName ||
    !lines.some((l) => l.includes("清運點名稱描述") && l.includes("一般垃圾"))
  )
    throw Error("缺少官方路線識別或一般垃圾表頭");
  const records = [];
  for (const l of lines) {
    const m =
      l.match(
        /^(\d+)\s+\|\s+(.*?)\s+\|\s+(\d{1,2}:\d{2})\s+\|\s+([^|]+)\s+\|\s+([^|]+)\s+\|\s+(.*)$/,
      ) ||
      l.match(
        /^(\d+)\s+(.*?)\s+(\d{1,2}:\d{2})\s+([一二三四五六日、0]+)\s+([一二三四五六日、0]+)\s+(.*)$/,
      );
    if (m)
      records.push({
        清運序: m[1],
        清運點名稱描述: m[2].trim(),
        清運時間: m[3],
        一般垃圾: m[4].trim(),
        廚餘回收: m[5].trim(),
        資源回收: m[6].trim(),
        官方路線序號: route,
        官方路線名稱: routeName,
      });
  }
  if (!records.length)
    throw Error("官方表格無可解析紀錄，請檢查版型或儲存完整頁面");
  return records;
}
function moenvHTML(text) {
  const $ = cheerio.load(text),
    body = $("body").text().replace(/\s+/g, " ");
  // Select the table by its semantic headers, never by column positions alone.
  let records = [];
  $("table").each((_, table) => {
    let headers = [];
    const found = [];
    $(table)
      .find("tr")
      .each((_, tr) => {
        const cells = $(tr)
          .children("th,td")
          .map((_, td) => $(td).text().trim())
          .get();
        if (cells.includes("清運點名稱描述") && cells.includes("一般垃圾")) {
          headers = cells;
          return;
        }
        if (
          headers.length &&
          cells.length === headers.length &&
          /^\d+$/.test(cells[0])
        )
          found.push(Object.fromEntries(headers.map((h, i) => [h, cells[i]])));
      });
    if (found.length) {
      if (records.length) throw Error("出現多個一般垃圾表格，需人工指定");
      records = found;
    }
  });
  const route = body.match(/清運路線序號\s*([A-Z]\d+)/)?.[1] || "";
  const routeName = body.match(/清運路線名稱\s*(.*?)\s*清運方式/)?.[1] || "";
  if (!records.length || !route || !routeName)
    throw Error("官方 HTML 缺一般垃圾表格或路線識別");
  return records.map((r) => ({
    ...r,
    官方路線序號: route,
    官方路線名稱: routeName,
  }));
}
function normalize(text, source, metadata = {}, format = source.format) {
  if (!require("../js/route-files").some((f) => f.name === source.sourceFile))
    throw Error("未知的來源路線 CSV");
  const mapping = { ...COLUMNS, ...source.fields };
  let records;
  if (format === "moenv-text") records = moenvText(text);
  else if (format === "moenv-html") records = moenvHTML(text);
  else if (format === "csv" || format === "normalized-csv")
    records = parseCSV(text);
  else if (format === "json") {
    const payload = JSON.parse(text);
    records = Array.isArray(payload) ? payload : payload.records;
    if (!Array.isArray(records))
      throw Error("JSON 必須為陣列或 {records: [...]}；不猜測其他欄位");
  } else throw Error("不支援的匯入格式：" + format);
  if (!records.length) throw Error("匯入資料沒有任何紀錄");
  const isMoenv = format.startsWith("moenv-");
  if (
    !isMoenv &&
    (!Object.hasOwn(records[0], mapping.place) ||
      !Object.hasOwn(records[0], mapping.time))
  )
    throw Error("缺少停留地點或時間原始欄位，請指定 fields 對應");
  const read = (r, k) => D.clean(r[mapping[k]]);
  return records.map((r, i) => {
    if (!r || typeof r !== "object" || Array.isArray(r))
      throw Error("原始紀錄必須為物件");
    if (r["來源檔案"] && r["來源檔案"] !== source.sourceFile)
      throw Error("原始來源檔案與登錄表不一致");
    const raw = JSON.stringify(r),
      url = read(r, "source") || source.url;
    if (!D.officialURL(url)) throw Error("必須提供實際 HTTPS 政府來源");
    const acquisition = metadata.acquisitionMethod || "offline-unverified";
    return {
      來源檔案: source.sourceFile,
      責任區: read(r, "zone"),
      車次: read(r, "trip"),
      停留地點: isMoenv ? D.clean(r["清運點名稱描述"]) : read(r, "place"),
      停留時間: isMoenv ? D.clean(r["清運時間"]) : read(r, "time"),
      一般垃圾日: isMoenv ? D.clean(r["一般垃圾"]) : read(r, "days"),
      官方來源: url,
      行政區: D.clean(r["行政區"]) || source.district,
      官方路線序號: read(r, "route"),
      官方路線名稱: read(r, "routeName") || source.title || "",
      官方清運序: isMoenv ? D.clean(r["清運序"]) : read(r, "sequence"),
      官方更新日期: read(r, "updated") || D.clean(metadata.officialUpdatedAt),
      資料取得時間: D.clean(metadata.acquiredAt),
      取得方式: acquisition,
      證據狀態:
        r["證據狀態"] === "stale"
          ? "stale"
          : acquisition === "search-cache"
            ? "cached"
            : acquisition === "http"
              ? ""
              : D.clean(r["證據狀態"]) || "unverified",
      責任區提示: source.zoneHint || r["責任區"] || "",
      來源ID: source.id,
      來源紀錄ID: hash(source.id + "\n" + url + "\n" + raw),
      原始欄位: raw,
      擷取說明: metadata.cacheDescription || "",
    };
  });
}
function writeCSV(
  file,
  rows,
  fields = [...new Set([...D.HEADERS, ...rows.flatMap(Object.keys)])],
) {
  fs.writeFileSync(
    file,
    "\uFEFF" +
      Papa.unparse(
        { fields, data: rows.map((r) => fields.map((f) => r[f] ?? "")) },
        { newline: "\r\n" },
      ).replace(/(?:\r?\n)+$/, "") +
      "\r\n",
  );
}
function build(out) {
  const rows = [],
    results = [];
  for (const s of registry.sources) {
    try {
      if (!s.snapshot) {
        const attempt = [...accessResults]
          .reverse()
          .find((r) => r.source === s.id);
        results.push(
          attempt
            ? { ...attempt, rows: 0 }
            : { source: s.id, url: s.url, status: "not_collected", rows: 0 },
        );
        continue;
      }
      const text = fs.readFileSync(path.join(root, s.snapshot), "utf8");
      const imported = normalize(text, s, s.snapshotMetadata);
      rows.push(...imported);
      results.push({
        source: s.id,
        url: s.url,
        status: "snapshot_imported",
        rows: imported.length,
        sha256: hash(text),
        ...s.snapshotMetadata,
      });
    } catch (e) {
      results.push({
        source: s.id,
        url: s.url,
        status: "import_failed",
        rows: 0,
        error: e.message,
      });
    }
  }
  writeCSV(path.join(out, "official.csv"), rows);
  fs.writeFileSync(
    path.join(out, "acquisitions.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  return rows;
}
function collect(source, out, runner = spawnSync) {
  if (!D.officialURL(source.url)) throw Error("來源沒有可下載的政府網址");
  const startedAt = new Date().toISOString(),
    stamp = startedAt.replace(/[:.]/g, "-"),
    base = path.join(out, source.id + "-" + stamp);
  const rawFile = base + ".raw",
    headersFile = base + ".headers";
  // curl preserves the session proxy and CA configuration; never bypass policy or TLS.
  const result = runner(
    "curl",
    [
      "--silent",
      "--show-error",
      "--location",
      "--max-redirs",
      "3",
      "--proto",
      "=https",
      "--proto-redir",
      "=https",
      "--max-time",
      "20",
      "--max-filesize",
      "10485760",
      "--output",
      rawFile,
      "--dump-header",
      headersFile,
      "--write-out",
      "%{http_code}\n%{url_effective}",
      source.url,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  const [httpStatus, finalURL] = (result.stdout || "").trim().split("\n");
  const meta = {
    source: source.id,
    url: source.url,
    attemptedAt: startedAt,
    httpStatus,
    finalURL,
    acquisitionMethod: "http",
    officialUpdatedAt: "",
    status: "download_failed",
    error: "",
  };
  if (
    result.status !== 0 ||
    !/^2\d\d$/.test(httpStatus) ||
    !D.officialURL(finalURL)
  )
    meta.error = result.stderr?.trim() || "HTTP " + httpStatus;
  else {
    meta.acquiredAt = new Date().toISOString();
    const text = fs.readFileSync(rawFile, "utf8");
    meta.sha256 = hash(text);
    try {
      const rows = normalize(
        text,
        source,
        meta,
        source.downloadFormat || source.format,
      );
      writeCSV(base + ".csv", rows);
      meta.rows = rows.length;
      meta.status = "imported";
      meta.normalizedFile = base + ".csv";
    } catch (e) {
      meta.status = "parse_failed";
      meta.error = e.message;
    }
  }
  fs.writeFileSync(
    base + ".metadata.json",
    JSON.stringify(meta, null, 2) + "\n",
  );
  return meta;
}
async function main() {
  const [command, ...args] = process.argv.slice(2),
    opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith("--") || !args[i + 1]) throw Error("選項必須成對");
    opts[args[i]] = args[i + 1];
  }
  const out = path.resolve(opts["--out"] || "work/import");
  if (out === root) throw Error("輸出必須使用獨立資料夾");
  fs.mkdirSync(out, { recursive: true });
  if (command === "build") {
    console.log(JSON.stringify({ rows: build(out).length, out }));
    return;
  }
  if (command === "discover") {
    if (!opts["--input"] || !D.officialURL(opts["--base"]))
      throw Error("discover 需要官方 --base URL 與 --input HTML");
    const $ = cheerio.load(fs.readFileSync(opts["--input"], "utf8")),
      links = new Map();
    $("a[href]").each((_, a) => {
      try {
        const u = new URL($(a).attr("href"), opts["--base"]);
        if (
          D.officialURL(u.href) &&
          u.searchParams.get("ddsPageID") === "LINEINFO" &&
          u.searchParams.has("dbid")
        )
          links.set(u.href, { url: u.href, title: $(a).text().trim() });
      } catch {}
    });
    fs.writeFileSync(
      path.join(out, "discovered-sources.json"),
      JSON.stringify([...links.values()], null, 2) + "\n",
    );
    console.log(JSON.stringify({ links: links.size }));
    return;
  }
  if (command === "collect-all") {
    const combined = [],
      attempts = [];
    for (const source of registry.sources.filter(
      (s) => s.url && (!opts["--file"] || s.sourceFile === opts["--file"]),
    )) {
      const meta = collect(source, out);
      attempts.push(meta);
      console.log(JSON.stringify(meta));
      if (meta.status === "imported")
        combined.push(
          ...parseCSV(fs.readFileSync(meta.normalizedFile, "utf8")),
        );
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    writeCSV(path.join(out, "official.csv"), combined);
    fs.writeFileSync(
      path.join(out, "attempts.json"),
      JSON.stringify(attempts, null, 2) + "\n",
    );
    if (attempts.some((r) => r.status !== "imported")) process.exitCode = 1;
    return;
  }

  const source = registry.sources.find((s) => s.id === opts["--source"]);
  if (!source) throw Error("請指定登錄表中的 --source ID");
  if (command === "collect") {
    const r = collect(source, out);
    console.log(JSON.stringify(r));
    if (r.status !== "imported") process.exitCode = 1;
    return;
  }
  if (command === "import") {
    if (!opts["--input"] || !opts["--metadata"])
      throw Error("離線匯入須提供 --input 與 --metadata，未知取得時間填空白");
    const metadata = JSON.parse(fs.readFileSync(opts["--metadata"], "utf8")),
      text = fs.readFileSync(opts["--input"], "utf8");
    const rows = normalize(
      text,
      source,
      metadata,
      opts["--format"] || source.format,
    );
    writeCSV(path.join(out, "official.csv"), rows);
    fs.copyFileSync(opts["--input"], path.join(out, "original.raw"));
    fs.writeFileSync(
      path.join(out, "metadata.json"),
      JSON.stringify(
        {
          ...metadata,
          source: source.id,
          url: source.url,
          importedAt: new Date().toISOString(),
          sha256: hash(text),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(JSON.stringify({ rows: rows.length, out }));
    return;
  }
  throw Error(
    "Usage: official-import.cjs build|collect|import --source ID --out DIR [--input FILE --metadata JSON --format FORMAT]",
  );
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { normalize, moenvText, moenvHTML, build, collect, writeCSV };
