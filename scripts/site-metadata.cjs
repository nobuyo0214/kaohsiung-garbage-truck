#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  root = path.resolve(__dirname, ".."),
  { paths } = require("../js/site-data");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
function generate({ check = false } = {}) {
  const files = Object.fromEntries(
    paths.map((name) => [name, sha(fs.readFileSync(path.join(root, name)))]),
  );
  const dataRevision = sha(JSON.stringify(files)),
    filename = path.join(root, "data/site-metadata.json");
  const old = fs.existsSync(filename)
    ? JSON.parse(fs.readFileSync(filename))
    : null;
  if (check) {
    if (
      !old ||
      JSON.stringify(old.files) !== JSON.stringify(files) ||
      old.dataRevision !== dataRevision
    )
      throw Error("網站資料版本過期，請執行 npm run build:site");
    return old;
  }
  const value = {
    version: 1,
    dataRevision,
    snapshotRecordedAt:
      old?.dataRevision === dataRevision
        ? old.snapshotRecordedAt
        : new Date().toISOString(),
    officialUpdatedAt: null,
    originalImportedAt: null,
    note: "snapshotRecordedAt僅為本站保存此組檔案雜湊的時間，不是官方更新日或原始資料匯入日期。歷史39份原始下載版本未完整記錄。",
    files,
  };
  fs.writeFileSync(filename, JSON.stringify(value, null, 2) + "\n");
  return value;
}
if (require.main === module)
  generate({ check: process.argv.includes("--check") });
module.exports = { generate };
