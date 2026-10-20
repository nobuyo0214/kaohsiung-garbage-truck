// Browser-only data versions for fixtures. Real source CSVs and safety checks remain intact.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
async function mockSnapshot(page, replacements) {
  const meta = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../data/site-metadata.json")),
  );
  for (const [name, content] of Object.entries(replacements)) {
    meta.files[name] = hash(Buffer.from(content));
    await page.route("**/" + name, (route) =>
      route.fulfill({
        body: content,
        contentType: name.endsWith(".json") ? "application/json" : "text/csv",
      }),
    );
  }
  meta.dataRevision = hash(JSON.stringify(meta.files));
  await page.route("**/data/site-metadata.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(meta),
    }),
  );
  return meta;
}
module.exports = { mockSnapshot };
