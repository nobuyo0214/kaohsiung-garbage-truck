#!/usr/bin/env node
/* Investigation observations are intentionally never passed to the date matcher as evidence. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  Papa = require("papaparse");
const { parse, load } = require("./data-tool.cjs"),
  D = require("../js/data-core"),
  R = require("../js/review-core"),
  T = require("../js/review-triage"),
  B = require("../js/review-batch");
const root = path.resolve(__dirname, ".."),
  priority = new Set([99, 100, 101, 103]);
function generate({
  progress,
  review,
  out = path.join(root, "reports/sanmin-west-evidence"),
  observations = path.join(
    root,
    "data/investigations/sanmin-west-2026-10-21.json",
  ),
} = {}) {
  out = path.resolve(out);
  if (out === root) throw Error("請使用獨立報告目錄，不能覆蓋正式 CSV");
  const official = parse(
      path.join(root, "data/official/sanmin-west.csv"),
      D.HEADERS,
    ),
    old = parse(path.join(root, "garbage-days.csv"), D.HEADERS),
    raw = load();
  const session = progress
    ? B.validateSession(JSON.parse(fs.readFileSync(progress, "utf8")))
    : B.session(official, [], {}, {});
  if (R.stable(session.officialRows) !== R.stable(official))
    throw Error(
      "進度的官方快照與目前三民西區資料不同，請先釐清版本，不能依序號直接混合",
    );
  const entries = T.build(raw, old, official),
    observed = JSON.parse(fs.readFileSync(observations, "utf8"));
  if (
    observed.schemaVersion !== 1 ||
    !Array.isArray(observed.sources) ||
    observed.sources.some(
      (s) => s.authorizesDate !== false || !D.officialURL(s.url),
    )
  )
    throw Error("調查觀察格式無效；不能將觀察資料當成日期證據");
  const proposed = R.proposal(
    raw,
    old,
    official,
    session.evidenceRows,
    session.decisions,
  );
  const rows = T.report(entries, session.marks, session.decisions),
    csvCheck = [];
  if (review) {
    const exported = parse(review, [
        "審核序號",
        "候選審核紀錄",
        "日期確認狀態",
        ...D.HEADERS,
      ]),
      byNumber = new Map(exported.map((r) => [Number(r.審核序號), r]));
    if (
      byNumber.size !== exported.length ||
      exported.length !== official.length
    )
      throw Error("CSV有重複審核序號或數量不符");
    for (const row of rows) {
      const csv = byNumber.get(row.審核序號);
      if (
        !csv ||
        Object.keys(official[row.審核序號 - 1]).some(
          (k) => csv[k] !== row[k],
        ) ||
        csv.候選審核紀錄 !== row.候選審核紀錄 ||
        csv.日期確認狀態 !== row.日期確認狀態
      )
        csvCheck.push(row.審核序號);
    }
    if (csvCheck.length) {
      fs.mkdirSync(out, { recursive: true });
      const diffs = csvCheck.map((n) => ({
        審核序號: n,
        問題: "CSV與JSON來源或審核結果不一致，禁止產生新提案",
        CSV紀錄: JSON.stringify(byNumber.get(n) || null),
        JSON預期紀錄: JSON.stringify(
          rows.find((r) => r.審核序號 === n) || null,
        ),
      }));
      fs.writeFileSync(
        path.join(out, "input-differences.csv"),
        "\uFEFF" + Papa.unparse(diffs),
      );
      throw Error(
        "CSV與JSON不一致；差異已保留至 input-differences.csv，未產生新提案：" +
          csvCheck.join(","),
      );
    }
  }
  for (const row of rows) {
    const o = official[row.審核序號 - 1],
      sources = observed.sources.filter((s) => s.routeId === o.官方路線序號),
      matches = sources.flatMap((s) =>
        s.rows
          .filter((x) => x.官方清運序 === o.官方清運序)
          .map((x) => ({ source: s, row: x })),
      );
    const exact = matches.filter(
      (x) =>
        D.canonical(x.row.停留地點) === D.canonical(o.停留地點) &&
        D.normalizeTime(x.row.到點時間) === D.normalizeTime(o.停留時間) &&
        D.normalizeDays(x.row.一般垃圾日) === D.normalizeDays(o.一般垃圾日),
    );
    row.本次觀察 = "僅頁面文字觀察，不授權日期";
    row.觀察結果 =
      exact.length === 1
        ? "頁面地點、到點與一般垃圾星期與原快照相同"
        : matches.length
          ? "頁面與快照有差異，需查證"
          : "沒有取得對應頁面文字";
    row.本次查閱日期 = observed.observationDateTaipei;
    row.本次觀察來源 = matches.map((x) => x.source.url).join(" ; ");
    row.官方路線車號 = exact.map((x) => x.source.vehiclePlate).join(" ; ");
    row.官方版本更新日期 = "未知（不得以查閱日或詮釋資料更新日代替）";
    row.車次對照證據 =
      "未取得官方路線識別到 CSV 責任區／車次的對照文件；車牌不等於車次";
    row.完整時間證據 = "未取得官方離站時間；不得抄 CSV 結束時間補齊";
    row.舊證據處理 =
      o.證據狀態 === "stale"
        ? "已重查頁面文字，但版本新鮮度仍不明，保留stale"
        : "仍需完整五欄官方證據";
    row.下一步調查 = priority.has(row.審核序號)
      ? "優先請清潔隊／資料提供機關提供 E80720023 對責任區四、CSV車次3的官方對照及有效版本、完整時段、一般垃圾星期"
      : o.責任區 === "一"
        ? "請提供責任區一完整新版站點清單，釐清官方48點與CSV僅1點的資料缺口"
        : "請提供該官方路線與責任區／車次對照、完整時間與有效日期，保留時間及地點差異";
  }
  fs.mkdirSync(out, { recursive: true });
  const csv = (name, data, fields = [...new Set(data.flatMap(Object.keys))]) =>
    fs.writeFileSync(
      path.join(out, name),
      "\uFEFF" +
        Papa.unparse(
          { fields, data: data.map((r) => fields.map((h) => r[h] ?? "")) },
          { newline: "\r\n" },
        ) +
        "\r\n",
    );
  csv("all-179-evidence-gaps.csv", rows);
  csv(
    "priority-four-evidence.csv",
    rows.filter((r) => priority.has(r.審核序號)),
  );
  csv(
    "remaining-175-gaps.csv",
    rows.filter((r) => !priority.has(r.審核序號)),
  );
  csv(
    "route-order-comparison.csv",
    B.groups(entries).flatMap((g) =>
      g.rows.map((r) => ({
        官方路線序號: g.official.官方路線序號,
        官方路線名稱: g.official.官方路線名稱,
        責任區: g.official.責任區,
        審核序號: r.entry.sequence,
        官方清運序: r.entry.official.官方清運序,
        官方地點: r.entry.official.停留地點,
        官方到點: r.entry.official.停留時間,
        候選車次: r.candidate?.row.車次 || "",
        候選地點: r.candidate?.row.停留地點 || "",
        候選時間: r.candidate?.row.停留時間 || "",
        CSV序號: r.csvOrder ?? "",
        順序比較: r.continuity,
        批次限制: B.unavailable(
          r.entry,
          r.candidate,
          session.marks,
          session.decisions,
        ),
        性質: "順序僅供審核參考，不能證明車次或授權新增日期",
      })),
    ),
  );
  csv("garbage-days-proposed.csv", proposed, D.HEADERS);
  const sha = (p) =>
    crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  const summary = {
    baseMain: "dcee2f31e5b7f0ed3f4e6cf0f3af4d4504626abe",
    observationDateTaipei: observed.observationDateTaipei,
    counts: B.counts(entries, session.marks, session.decisions),
    existingRules: old.length,
    proposedRules: proposed.length,
    newRules: proposed.length - old.length,
    automaticConfirmedMatches: 0,
    observationsMatchingSnapshot: rows.filter((r) =>
      r.觀察結果.startsWith("頁面地點"),
    ).length,
    retainedStale: official.filter((o) => o.證據狀態 === "stale").length,
    priorityFourStillPendingDates: rows.filter(
      (r) => priority.has(r.審核序號) && r.日期確認狀態.startsWith("待查證"),
    ).length,
    remainingRows: rows.filter((r) => !priority.has(r.審核序號)).length,
    progressSHA256: progress ? sha(progress) : null,
    reviewSHA256: review ? sha(review) : null,
    reviewJSONConsistent: review ? true : null,
    observationsSHA256: sha(observations),
    officialSnapshotSHA256: sha(
      path.join(root, "data/official/sanmin-west.csv"),
    ),
    note: "觀察列只證明讀到哪些文字，不能取代官方車次與完整時段證據。批次候選紀錄不參與日期合併。",
  };
  fs.writeFileSync(
    path.join(out, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  return summary;
}
if (require.main === module) {
  try {
    const options = {},
      args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
      const key = {
        "--progress": "progress",
        "--review": "review",
        "--out": "out",
        "--observations": "observations",
      }[args[i]];
      if (!key || !args[i + 1])
        throw Error(
          "用法：--progress 進度.json --review 審核.csv --out 報告目錄",
        );
      options[key] = args[i + 1];
    }
    console.log(JSON.stringify(generate(options), null, 2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
module.exports = { generate };
