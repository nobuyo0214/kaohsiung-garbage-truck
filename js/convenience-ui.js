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
    editingFavorite = null,
    reportingRow = null,
    identities = new Map();
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  // A separate versioned display preference cannot overwrite search or favorites.
  function applyLargeText(enabled) {
    document.documentElement.classList.toggle("large-text", enabled);
    $("largeTextButton").setAttribute("aria-pressed", String(enabled));
    $("largeTextButton").textContent = enabled ? "大字模式：開" : "大字模式";
  }
  try {
    const display = JSON.parse(localStorage.getItem("garbage-display-v1") || "null");
    applyLargeText(display?.version === 1 && display.largeText === true);
  } catch { /* Search remains usable if display preferences cannot be read. */ }
  $("largeTextButton").addEventListener("click", () => {
    const enabled = !document.documentElement.classList.contains("large-text");
    applyLargeText(enabled);
    try {
      localStorage.setItem("garbage-display-v1", JSON.stringify({ version: 1, largeText: enabled }));
    } catch {
      toast("無法保存大字模式偏好，本次仍可使用；下次開啟可能需重新設定。");
    }
  });
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
  function editFavorite(row) {
    const id = T.stopId(row), detail = C.favoriteDetail(getState().preferences.favoriteDetails, id);
    editingFavorite = id;
    $("favoriteOfficialPlace").textContent = "正式地點：" + row.searchDistrict + "・" + row.停留地點 + " " + row.停留時間;
    $("favoriteName").value = detail.name;
    $("favoritePinned").checked = detail.pinned;
    $("favoriteEditStatus").textContent = "";
    $("favoriteDialog").showModal();
    $("favoriteName").focus();
  }
  $("favoriteForm").addEventListener("submit", event => {
    event.preventDefault();
    const current = getState().preferences, detail = {
      name: $("favoriteName").value.trim(), pinned: $("favoritePinned").checked,
    };
    if (!T.validFavoriteDetail(detail)) {
      $("favoriteEditStatus").textContent = "名稱最多30個字元，不能包含控制字元。";
      return;
    }
    if (!editingFavorite || !current.favorites.includes(editingFavorite)) {
      $("favoriteEditStatus").textContent = "此站點已不在收藏中，未變更設定。";
      return;
    }
    const details = T.cleanFavoriteDetails(current.favorites, current.favoriteDetails);
    details.entries[editingFavorite] = detail;
    const stored = setFavorites(current.favorites, details);
    $("favoriteDialog").close();
    // The saved list was re-rendered (and may have moved after pinning).
    const control = [...document.querySelectorAll(".favorite-edit")].find(button => button.dataset.stopId === editingFavorite);
    (control || $("viewSavedButton")).focus({ preventScroll: true });
    if (stored) toast("已儲存收藏設定。");
  });
  $("cancelFavoriteEdit").addEventListener("click", () => $("favoriteDialog").close());
  function refreshReport() {
    try {
      $("reportText").value = C.reportText(reportingRow, $("reportType").value, $("reportNote").value);
      $("reportStatus").textContent = "尚未送出。";
      $("copyReport").disabled = false;
    } catch (error) {
      $("reportText").value = "";
      $("reportStatus").textContent = error.message;
      $("copyReport").disabled = true;
    }
  }
  function openReport(row) {
    reportingRow = row;
    $("reportType").value = "place";
    $("reportNote").value = "";
    $("reportPreview").open = false;
    refreshReport();
    $("reportDialog").showModal();
    $("reportType").focus();
  }
  $("reportType").addEventListener("change", refreshReport);
  $("reportNote").addEventListener("input", refreshReport);
  $("closeReport").addEventListener("click", () => $("reportDialog").close());
  $("reportDialog").addEventListener("close", () => { reportingRow = null; });
  $("copyReport").addEventListener("click", async () => {
    const text = $("reportText").value;
    if (!text) return;
    try {
      if (!navigator.clipboard?.writeText) throw Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      $("reportStatus").textContent = "已複製回報內容，尚未送出；請自行交給維護者或主管機關。";
    } catch {
      $("reportPreview").open = true;
      $("reportText").focus();
      $("reportText").select();
      $("reportStatus").textContent = "無法自動複製，請長按或選取下方回報文字手動複製；尚未送出。";
    }
  });
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
    const report = node("button", "report-button", "回報問題");
    report.type = "button";
    report.setAttribute("aria-label", "回報問題：" + row.停留地點 + " " + row.停留時間);
    report.addEventListener("click", () => openReport(row));
    card.querySelector(".card-actions").prepend(report);
    const record = locationAudit?.byRow.get(row),
      url = LocationQuality.navigationURL(record);
    let searchNotice = null;
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
      const searchURL = C.mapSearchURL(row.searchDistrict, row.停留地點);
      const reason = record
        ? record.reasons.map((k) => LocationQuality.labels[k]).join("；")
        : "位置資料未完整載入";
      if (searchURL) {
        const link = node("a", "place-search-link");
        link.append(
          node("span", "", "在 Google Maps"),
          document.createTextNode(" "),
          node("span", "", "搜尋地點 ↗"),
        );
        link.href = searchURL;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute(
          "aria-label",
          "在 Google Maps 搜尋地點：" + row.停留地點 +
            "（搜尋結果不代表已核實的停靠位置，另開分頁）",
        );
        actions.append(link);
        searchNotice = node(
          "p", "location-unknown map-search-note",
          "位置尚待確認；搜尋結果不代表已核實的停靠位置。",
        );
        searchNotice.title = reason;
      } else {
        const unknown = node("span", "location-unknown", "位置尚待確認");
        unknown.title = reason;
        actions.append(unknown);
      }
    }
    if (state.savedView) {
      const detail = C.favoriteDetail(state.preferences.favoriteDetails, id),
        tools = node("div", "favorite-tools"), edit = node("button", "favorite-edit", "名稱與置頂");
      if (detail.name || detail.pinned) {
        const label = node("p", "favorite-label", (detail.pinned ? "已置頂・" : "") +
          (detail.name ? "自訂名稱：" + detail.name : "常用站點"));
        card.querySelector(".card-topline").after(label);
      }
      edit.type = "button";
      edit.dataset.stopId = id;
      edit.setAttribute("aria-label", "編輯收藏名稱與置頂：" + row.停留地點 + " " + row.停留時間);
      edit.addEventListener("click", () => editFavorite(row));
      tools.append(edit);
      card.append(tools);
    }
    card.append(actions);
    if (searchNotice) card.append(searchNotice);
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
      const preferences = getState().preferences,
        backup = C.exportFavoriteBackup(preferences.favorites, preferences.favoriteDetails),
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
        "已匯出 " + backup.favorites.length + " 筆收藏識別、名稱及置頂設定，不包含日期。";
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
      const incoming = C.parseFavoriteBackup(await file.text(), file.size),
        ids = incoming.favorites,
        current = getState().preferences,
        merged = C.mergeFavoriteState(current, incoming).favorites,
        unresolved = C.unresolved(ids, identities);
      pendingImport = incoming;
      $("favoritesPreviewText").textContent =
        "檔案含 " +
        ids.length +
        " 個不重複識別；新增 " +
        (merged.length - current.favorites.length) +
        " 個，重複 " + (ids.length - (merged.length - current.favorites.length)) + " 個（名稱與置頂保留本機設定）；合併後共 " +
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
      const merged = C.mergeFavoriteState(getState().preferences, pendingImport);
      const count = C.unresolved(merged.favorites, identities).length;
      const stored = setFavorites(merged.favorites, merged.favoriteDetails);
      $("favoritesImportStatus").textContent =
        (stored ? "已合併並保存，共 " : "本次已合併但無法永久保存，請匯出備份；共 ") +
        merged.favorites.length +
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
    getLocationAudit: () => locationAudit,
    decorateCard,
    updateData,
    updateManager,
    resolveShared,
    clearShared,
    manualCopy,
  };
}
