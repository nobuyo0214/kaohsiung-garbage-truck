/* QR payload is exactly the existing public HTTPS station link, never local preferences. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./convenience-core"));
  else root.StopQR = factory(root.Convenience);
})(typeof globalThis !== "undefined" ? globalThis : this, function (C) {
  "use strict";
  const BASE = "https://nobuyo0214.github.io/kaohsiung-garbage-truck/",
    MAX_BYTES = 2000;
  function stationURL(id) {
    return C.shareURL(id, BASE);
  }
  function matrix(url, encoder) {
    let id;
    try {
      id = C.sharedId(url);
    } catch {
      throw Error("站點分享網址無效，仍可使用原分享功能。");
    }
    if (!id || stationURL(id) !== url)
      throw Error("僅可產生本站正式HTTPS站點網址的QR Code。");
    if (new TextEncoder().encode(url).length > MAX_BYTES)
      throw Error("站點網址超過QR Code安全容量，請改用複製連結。");
    if (typeof encoder !== "function")
      throw Error("QR Code程式未能載入，仍可複製站點連結。");
    try {
      const code = encoder(0, "M");
      code.addData(url, "Byte");
      code.make();
      return code;
    } catch {
      throw Error("無法產生可掃描的QR Code，請改用複製連結。");
    }
  }
  function draw(canvas, code) {
    const count = code.getModuleCount(),
      scale = 6,
      quiet = 4,
      size = (count + quiet * 2) * scale;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw Error("瀏覽器無法繪製QR Code，仍可複製連結。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.fillStyle = "#000000";
    for (let y = 0; y < count; y++)
      for (let x = 0; x < count; x++)
        if (code.isDark(y, x))
          context.fillRect(
            (x + quiet) * scale,
            (y + quiet) * scale,
            scale,
            scale,
          );
  }
  function filename(url) {
    let hash = 2166136261;
    for (const c of url) {
      hash ^= c.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (
      "kaohsiung-stop-" + (hash >>> 0).toString(16).padStart(8, "0") + ".png"
    );
  }
  return { BASE, MAX_BYTES, stationURL, matrix, draw, filename };
});
