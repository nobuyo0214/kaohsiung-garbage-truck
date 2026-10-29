#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  root = path.resolve(__dirname, "..");
const { generate } = require("./site-metadata.cjs"),
  sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
function build({ check = false } = {}) {
  generate({ check });
  require("./data-history.cjs").generate({ check });
  const names = [
    "index.html",
    "css/search.css",
    "manifest.webmanifest",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/maskable-512.png",
    "icons/apple-touch-icon.png",
    "js/vendor/papaparse.min.js",
    "js/route-files.js",
    "js/data-core.js",
    "js/search-tools.js",
    "js/search-loader.js",
    "js/site-data.js",
    "js/location-quality.js",
    "js/convenience-core.js",
    "js/convenience-ui.js",
    "js/stop-qr.js",
    "js/qr-ui.js",
    "js/vendor/qrcode-generator-2.0.4.js",
    "js/journey-core.js",
    "js/nearby-session.js",
    "js/search-app.js",
    "js/pwa.js",
    "js/version-ui.js",
    "js/site-version.js",
  ];
  require("./site-version.cjs").generate(names, { check });
  const assets = names.map((name) => [
    name,
    sha(fs.readFileSync(path.join(root, name))),
  ]);
  const template = fs.readFileSync(
    path.join(__dirname, "sw-template.js"),
    "utf8",
  );
  const version = sha(template + JSON.stringify(assets)).slice(0, 20);
  const text = template.replace(
    "__SHELL_CONFIG__",
    JSON.stringify({ version, assets }),
  );
  const output = path.join(root, "sw.js");
  if (check) {
    if (!fs.existsSync(output) || fs.readFileSync(output, "utf8") !== text)
      throw Error("Service Worker版本過期，請執行 npm run build:site");
  } else fs.writeFileSync(output, text);
  return { version, assets };
}
if (require.main === module) {
  const result = build({ check: process.argv.includes("--check") });
  console.log(
    JSON.stringify({
      shellVersion: result.version,
      interfaceAssets: result.assets.length,
    }),
  );
}
module.exports = { build };
