const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  QR = require("../js/stop-qr"),
  encoder = require("../js/vendor/qrcode-generator-2.0.4"),
  decode = require("jsqr"),
  C = require("../js/convenience-core");
function pixels(code) {
  const n = code.getModuleCount(),
    scale = 5,
    size = (n + 8) * scale,
    pixels = new Uint8ClampedArray(size * size * 4);
  pixels.fill(255);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (code.isDark(y, x))
        for (let j = 0; j < scale; j++)
          for (let i = 0; i < scale; i++) {
            const offset =
              (((y + 4) * scale + j) * size + (x + 4) * scale + i) * 4;
            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
          }
  return { pixels, size };
}
test("independent jsQR decodes real existing version-1 sharing with Chinese, special characters, districts and long names", () => {
  const { load } = require("../scripts/data-tool.cjs"),
    T = require("../js/search-tools"),
    samples = load().filter(
      (r) => r.責任區 && r.車次 && r.startMinute !== null,
    ),
    rows = [
      samples[0],
      samples.find((r) => r.searchDistrict === "三民區"),
      samples.find((r) => r.searchDistrict === "岡山區"),
    ];
  const ids = rows
    .map(T.stopId)
    .concat([
      JSON.stringify([
        "sanmin-west.csv",
        "三民區",
        "1",
        "3",
        "建工路 & <學校> / ＃「站」 😀",
        "20:50-20:52",
      ]),
      JSON.stringify([
        "sanmin-west.csv",
        "三民區",
        "1",
        "3",
        "高雄市長地點".repeat(30),
        "20:50-20:52",
      ]),
    ]);
  for (const id of ids) {
    const url = QR.stationURL(id),
      { pixels: rgba, size } = pixels(QR.matrix(url, encoder)),
      result = decode(rgba, size, size);
    assert.ok(result);
    assert.equal(result.data, url);
    assert.equal(C.sharedId(result.data), id);
    assert.match(QR.filename(url), /^kaohsiung-stop-[a-f0-9]{8}\.png$/);
    assert.equal(new URL(url).search, "");
  }
});
test("nonofficial hosts, mixed parameters, malformed IDs, oversized URLs and unavailable encoder fail clearly", () => {
  const id = JSON.stringify([
      "sanmin-west.csv",
      "三民區",
      "1",
      "3",
      "中山路1號",
      "20:50-20:52",
    ]),
    url = QR.stationURL(id);
  for (const invalid of [
    url.replace("https:", "http:"),
    url.replace("nobuyo0214.github.io", "evil.example"),
    url + "&lat=22",
    url.replace("/#", "/?lat=22#"),
    "javascript:alert(1)",
    url.replace("stop=1.", "stop=2."),
  ])
    assert.throws(() => QR.matrix(invalid, encoder));
  const huge = QR.stationURL(
    JSON.stringify([
      "sanmin-west.csv",
      "三民區",
      "龜".repeat(80),
      "龜".repeat(80),
      "龜".repeat(300),
      "20:50" + " ".repeat(70),
    ]),
  );
  assert.throws(() => QR.matrix(huge, encoder), /容量/);
  assert.throws(() => QR.matrix(url, null), /仍可複製/);
});
