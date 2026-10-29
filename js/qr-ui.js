/* Encoder is loaded on demand from this origin; no third-party QR requests. */
"use strict";
function createStopQRUI({ toast }) {
  const $ = (id) => document.getElementById(id);
  let encoderPromise = null,
    sequence = 0,
    url = "",
    returnFocus = null;
  function encoder() {
    if (typeof window.qrcode === "function")
      return Promise.resolve(window.qrcode);
    if (encoderPromise) return encoderPromise;
    encoderPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script"),
        timer = setTimeout(() => done(Error("載入逾時")), 12000);
      const done = (error) => {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) {
          script.remove();
          encoderPromise = null;
          reject(error);
        } else resolve(window.qrcode);
      };
      script.src = "js/vendor/qrcode-generator-2.0.4.js";
      script.onload = () =>
        done(typeof window.qrcode === "function" ? null : Error("無法載入"));
      script.onerror = () => done(Error("無法載入"));
      document.head.append(script);
    });
    return encoderPromise;
  }
  async function open(row, trigger) {
    const token = ++sequence;
    returnFocus = trigger;
    url = StopQR.stationURL(SearchTools.stopId(row));
    $("qrStation").textContent =
      row.searchDistrict + "・" + row.停留地點 + " " + row.停留時間;
    $("qrURL").value = url;
    $("qrCanvas").hidden = true;
    $("downloadQR").disabled = true;
    $("qrStatus").textContent = "正在本機產生QR Code…";
    $("qrDialog").showModal();
    $("closeQR").focus();
    try {
      const code = StopQR.matrix(url, await encoder());
      if (token !== sequence || !$("qrDialog").open) return;
      StopQR.draw($("qrCanvas"), code);
      $("qrCanvas").hidden = false;
      $("downloadQR").disabled = false;
      $("qrStatus").textContent =
        "掃描後開啟本站停靠站資訊；此圖不含你的定位或收藏名稱。";
    } catch (error) {
      if (token === sequence && $("qrDialog").open)
        $("qrStatus").textContent = error.message + " 仍可複製下方站點連結。";
    }
  }
  $("qrDialog").addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [
        ...$("qrDialog").querySelectorAll("textarea,button:not(:disabled)"),
      ].filter((el) => !el.hidden),
      first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  $("closeQR").addEventListener("click", () => $("qrDialog").close());
  $("qrDialog").addEventListener("close", () => {
    sequence++;
    url = "";
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  });
  $("copyQRLink").addEventListener("click", async () => {
    try {
      if (!navigator.clipboard?.writeText) throw Error();
      await navigator.clipboard.writeText(url);
      toast("已複製站點連結。");
      $("qrStatus").textContent = "已複製站點連結。";
    } catch {
      $("qrURL").focus();
      $("qrURL").select();
      $("qrStatus").textContent =
        "無法自動複製，請長按或選取上方網址手動複製。";
    }
  });
  $("downloadQR").addEventListener("click", () => {
    const current = url;
    if (!current || $("qrCanvas").hidden) return;
    try {
      $("qrCanvas").toBlob((blob) => {
        if (!blob || url !== current) {
          $("qrStatus").textContent = "無法下載圖片，請改用複製連結。";
          return;
        }
        const href = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = href;
        a.download = StopQR.filename(current);
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 30000);
      }, "image/png");
    } catch {
      $("qrStatus").textContent = "無法下載圖片，請改用複製連結。";
    }
  });
  return { open };
}
