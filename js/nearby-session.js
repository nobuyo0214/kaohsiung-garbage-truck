/* One explicit position request per click; no storage, transmission or watchPosition. */
"use strict";
function createNearbySession({ onResult, onError, onBusy, onClear }) {
  let value = null, sequence = 0, pending = false, deadline, expiry, permission;
  function cancel() {
    sequence++;
    value = null;
    pending = false;
    clearTimeout(deadline);
    clearTimeout(expiry);
    onBusy(false);
  }
  function clear(reason) {
    const active = !!value || pending;
    cancel();
    if (active) onClear(reason);
  }
  function fail(message, token) {
    if (token !== sequence) return;
    cancel();
    onError(message);
  }
  function request() {
    if (pending) return;
    cancel();
    if (!window.isSecureContext || !navigator.geolocation) {
      onError("此瀏覽器目前無法使用定位，請使用地點文字搜尋。");
      return;
    }
    if (permission?.state === "denied") {
      onError("定位權限未開放，請在瀏覽器設定調整，或改用地點文字搜尋。");
      return;
    }
    const token = sequence;
    pending = true;
    onBusy(true);
    deadline = setTimeout(() => fail("定位逾時，請稍後主動重試，或改用地點文字搜尋。", token), 12000);
    // Permission inspection never prompts, and is not needed to start the user's request.
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: "geolocation" }).then(status => {
        if (token !== sequence) return;
        permission = status;
        permission.onchange = () => {
          if (permission.state !== "granted") clear("定位權限已變更，已清除位置；可繼續使用文字搜尋。");
        };
        if (status.state === "denied") clear("定位權限未開放，已清除位置；請改用地點文字搜尋。");
      }).catch(() => { /* Unsupported permission inspection does not prevent one-shot positioning. */ });
    }
    try {
      navigator.geolocation.getCurrentPosition(position => {
        if (token !== sequence) return;
        const result = Journey.positionValue(position);
        if (!result) {
          fail("無法取得有效且足夠精確的新位置（誤差需在1公里內），請重新定位或改用文字搜尋。", token);
          return;
        }
        value = result;
        pending = false;
        clearTimeout(deadline);
        onBusy(false);
        expiry = setTimeout(() => clear("定位已超過5分鐘，已清除位置；請重新定位。"), Journey.POSITION_LIFETIME);
        onResult();
      }, error => fail({
        1: "定位權限未開放，請改用地點文字搜尋；本站不會自動再次要求授權。",
        2: "目前無法取得位置，請稍後主動重試，或改用地點文字搜尋。",
        3: "定位逾時，請稍後主動重試，或改用地點文字搜尋。",
      }[error.code] || "定位失敗，請改用地點文字搜尋。", token),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    } catch {
      fail("瀏覽器未允許定位，請改用地點文字搜尋。", token);
    }
  }
  window.addEventListener("pagehide", () => clear("離開頁面後已清除位置，請重新定位。"));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clear("切換畫面後已清除位置，請重新定位。" );
  });
  return { request, cancel, clear, get: () => value };
}
