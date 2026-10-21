"use strict";
function createConvenienceUI({
  getState,
  setFavorites,
  toast,
  onShared,
  onShareError,
  onReturnToSearch,
}) {
  const C = Convenience,
    T = SearchTools,
    $ = (id) => document.getElementById(id);
  let locationAudit = null,
    shared = null,
    pendingImport = null,
    identities = new Map();
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function manualCopy(text, title) {
    $("copyHeading").textContent = title;
    $("copyText").value = text;
    $("copyDialog").showModal();
    $("copyText").focus();
    $("copyText").select();
  }
  async function copyURL(url) {
    try {
      if (!navigator.clipboard?.writeText) throw Error();
      await navigator.clipboard.writeText(url);
      toast("已複製站點連結。");
    } catch {
      manualCopy(url, "複製站點連結");
    }
  }
  async function share(row) {
    const { rows } = getState(),
      id = T.stopId(row);
    if (!C.shareable(id, identities)) {
      toast("站點識別不完整或有歧義，暫時無法分享。");
      return;
    }
    const url = C.shareURL(id, location.href);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "高雄垃圾車｜" + row.停留地點,
          text: row.searchDistrict + "・" + row.停留地點 + "（表定資訊）",
          url,
        });
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }
    await copyURL(url);
  }
  function decorateCard(card, row) {
    const actions = node("div", "stop-actions"),
      id = T.stopId(row),
      state = getState();
    const button = node("button", "share-button", "分享站點");
    button.type = "button";
    button.setAttribute(
      "aria-label",
      "分享站點：" + row.停留地點 + " " + row.停留時間,
    );
    button.disabled = !C.shareable(id, identities);
    if (button.disabled) button.title = "完整識別不足或有歧義，請使用複製資訊";
    button.addEventListener("click", () => share(row));
    actions.append(button);
    const record = locationAudit?.byRow.get(row),
      url = LocationQuality.navigationURL(record);
    if (url) {
      const link = node("a", "map-link", "地圖導航 ↗");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute(
        "aria-label",
        "以Google Maps導航至" + row.停留地點 + "（原始座標通過品質檢查）",
      );
      actions.append(link);
    } else {
      const unknown = node("span", "location-unknown", "位置尚待確認");
      unknown.title = record
        ? record.reasons.map((k) => LocationQuality.labels[k]).join("；")
        : "位置資料未完整載入";
      actions.append(unknown);
    }
    card.append(actions);
    if (id === shared) {
      card.classList.add("shared-stop");
      card.prepend(node("span", "shared-label", "已定位分享的站點"));
      card.tabIndex = -1;
    }
  }
  function updateData({ rows, topology, complete, meta, loadedAt }) {
    identities = C.identityIndex(rows);
    locationAudit =
      complete && topology ? LocationQuality.analyze(rows, topology) : null;
    $("siteSnapshot").textContent = meta
      ? meta.dataRevision.slice(0, 12) +
        "｜雜湊紀錄時間 " +
        formatTime(meta.snapshotRecordedAt) +
        "（非官方更新日）"
      : "尚未取得可驗證版本";
    $("currentLoadedAt").textContent = loadedAt
      ? formatTime(loadedAt) +
        "（" +
        (complete ? "完整取得" : "部分資料，請查看載入詳情") +
        "）"
      : "目前無法更新清運資訊";
    updateManager();
  }
  function formatTime(value) {
    return (
      new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei",
        dateStyle: "medium",
        timeStyle: "medium",
        hour12: false,
      }).format(new Date(value)) + "（台灣時間）"
    );
  }
  function updateManager() {
    $("favoritesManager").hidden = !getState().savedView;
  }
  function resolveShared() {
    let id;
    try {
      id = C.sharedId(location.href);
    } catch {
      id = false;
    }
    if (id === null) return false;
    const { rows, loaded } = getState();
    if (!loaded) return true;
    if (!id || !C.shareable(id, identities)) {
      shared = null;
      onShareError(
        "站點資料可能已變更，或識別不完整／有歧義。請重新搜尋；不會改配其他相似站點。",
      );
      return true;
    }
    shared = id;
    onShared(C.lookup(identities, id)[0]);
    const card = document.querySelector(".shared-stop");
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "center" });
    return true;
  }
  function clearShared() {
    shared = null;
    if (new URLSearchParams(location.hash.slice(1)).has("stop")) {
      const url = new URL(location.href);
      url.hash = "";
      history.replaceState(null, "", url.href);
    }
  }
  $("exportFavorites").addEventListener("click", () => {
    try {
      const backup = C.exportFavorites(getState().preferences.favorites),
        url = URL.createObjectURL(
          new Blob([JSON.stringify(backup, null, 2) + "\n"], {
            type: "application/json",
          }),
        );
      const a = node("a");
      a.href = url;
      a.download = "kaohsiung-garbage-favorites.json";
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      $("favoritesImportStatus").textContent =
        "已匯出 " + backup.favorites.length + " 筆收藏識別，不包含日期。";
    } catch (e) {
      $("favoritesImportStatus").textContent = e.message;
    }
  });
  $("importFavorites").addEventListener("click", () =>
    $("favoritesFile").click(),
  );
  $("favoritesFile").addEventListener("change", async () => {
    const file = $("favoritesFile").files[0];
    $("favoritesFile").value = "";
    pendingImport = null;
    if (!file) return;
    try {
      if (file.size > C.MAX_BYTES) throw Error("檔案超過256KB，未變更收藏");
      const ids = C.importFavorites(await file.text(), file.size),
        current = getState().preferences.favorites,
        merged = C.mergeFavorites(current, ids),
        unresolved = C.unresolved(ids, identities);
      pendingImport = ids;
      $("favoritesPreviewText").textContent =
        "檔案含 " +
        ids.length +
        " 個不重複識別；新增 " +
        (merged.length - current.length) +
        " 個，合併後共 " +
        merged.length +
        " 個。其中 " +
        unresolved.length +
        " 個目前無法唯一確認（含尚未載入或已變更）。";
      $("favoritesPreview").showModal();
    } catch (e) {
      $("favoritesImportStatus").textContent = e.message;
    }
  });
  $("confirmFavoritesImport").addEventListener("click", () => {
    if (!pendingImport) return;
    try {
      const merged = C.mergeFavorites(
        getState().preferences.favorites,
        pendingImport,
      );
      const count = C.unresolved(merged, identities).length;
      setFavorites(merged);
      $("favoritesImportStatus").textContent =
        "已合併，共 " +
        merged.length +
        " 個收藏；" +
        count +
        " 個目前未能唯一確認，識別仍保留。";
      pendingImport = null;
      $("favoritesPreview").close();
    } catch (e) {
      $("favoritesPreviewText").textContent = e.message;
    }
  });
  $("favoritesPreview").addEventListener("close", () => {
    pendingImport = null;
  });
  window.addEventListener("hashchange", resolveShared);
  return {
    decorateCard,
    updateData,
    updateManager,
    resolveShared,
    clearShared,
    manualCopy,
  };
}
