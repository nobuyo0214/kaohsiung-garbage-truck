"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
function generate(names, { check = false } = {}) {
  const assets = [...names]
    .filter((n) => n !== "js/site-version.js")
    .sort()
    .map((n) => [
      n,
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(root, n)))
        .digest("hex"),
    ]);
  const version = crypto
      .createHash("sha256")
      .update(JSON.stringify(assets))
      .digest("hex"),
    filename = path.join(root, "js/site-version.js");
  const old = fs.existsSync(filename)
    ? JSON.parse(
        fs
          .readFileSync(filename, "utf8")
          .replace(/^window.SiteVersion = /, "")
          .trim()
          .replace(/;$/, ""),
      )
    : null;
  if (check) {
    if (old?.version !== version)
      throw Error("網站介面版本過期，請執行 npm run build:site");
    return old;
  }
  if (old?.version === version) return old;
  const value = {
    format: 1,
    version,
    buildRecordedAt: new Date().toISOString(),
    baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    note: "建置紀錄時間與建置基底commit，不是實際部署時間、官方資料更新日或最終合併commit。",
  };
  fs.writeFileSync(
    filename,
    "window.SiteVersion = " + JSON.stringify(value, null, 2) + ";\n",
  );
  return value;
}
module.exports = { generate };
