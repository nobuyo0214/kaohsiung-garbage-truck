/* Lazy, network-only history. Build provenance and official publication dates stay separate. */
"use strict";
(() => {
  const $ = (id) => document.getElementById(id),
    source = "https://github.com/nobuyo0214/kaohsiung-garbage-truck";
  let state = null,
    history = null,
    pending = false;
  const when = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("zh-TW", {
          timeZone: "Asia/Taipei",
          dateStyle: "medium",
          timeStyle: "short",
          hour12: false,
        }).format(date) + "（台灣時間）"
      : "未確認";
  };
  function pair(list, label, value) {
    const dt = document.createElement("dt"),
      dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    list.append(dt, dd);
  }
  function render() {
    const list = $("versionSummary");
    list.replaceChildren();
    const version = window.SiteVersion;
    pair(list, "網站程式版本", version?.version?.slice(0, 12) || "尚未取得");
    pair(
      list,
      "程式版本建置紀錄",
      when(version?.buildRecordedAt) + "；不是部署時間",
    );
    pair(
      list,
      "GitHub Pages 部署識別",
      "本頁介面版本 " +
        (version?.version?.slice(0, 12) || "未知") +
        "；實際部署時間未確認",
    );
    pair(
      list,
      "最近程式更新日期",
      "未單獨確認；上方僅為此程式版本建置紀錄時間",
    );
    if (version?.baseCommit && /^[a-f0-9]{40}$/.test(version.baseCommit)) {
      $("buildBaseLink").href = source + "/commit/" + version.baseCommit;
      $("buildBaseLink").textContent =
        "建置基底 commit " + version.baseCommit.slice(0, 7);
    }
    pair(
      list,
      "本頁已載入行政區",
      state
        ? new Set(state.rows.map((r) => r.searchDistrict)).size + " / 38"
        : "尚未載入",
    );
    pair(
      list,
      "本頁有效來源紀錄",
      state?.rows.length.toLocaleString("zh-TW") || "0",
    );
    pair(list, "官方資料發布日期", "官方資料發布日期未確認");
    pair(
      list,
      "路線資料版本",
      history
        ? history.entries.at(-1).contentRevision.slice(0, 12)
        : "展開後驗證路線版本",
    );
    pair(
      list,
      "原始路線 CSV",
      history
        ? history.entries.at(-1).counts.files + " 份"
        : "版本紀錄載入後顯示",
    );
    $("historyStatus").textContent = history
      ? "版本紀錄已與本次路線檔案雜湊核對。" +
        (state?.complete
          ? ""
          : "本頁資料尚未完整取得；以下為版本收錄規模，並非已載入數量。")
      : "展開後讀取可驗證的資料紀錄；沒有官方日期時維持未確認。";
    if (!history) return;
    const entries = $("dataHistoryEntries");
    entries.replaceChildren();
    const contentChanges = history.entries.filter(
      (e) => e.difference?.stationContentChanged,
    );
    pair(
      list,
      "最近偵測到站點內容變更",
      contentChanges.length
        ? when(contentChanges.at(-1).recordedAt) + "（本站偵測，非官方日期）"
        : "目前僅有基準快照，尚無後續可驗證內容變更",
    );
    for (const entry of [...history.entries].reverse()) {
      const li = document.createElement("li"),
        title = document.createElement("strong"),
        text = document.createElement("p");
      title.textContent =
        (entry.kind === "baseline" ? "開始追蹤的基準" : "路線檔案變更") +
        " " +
        entry.contentRevision.slice(0, 12);
      text.textContent =
        when(entry.recordedAt) +
        "；收錄 " +
        entry.counts.districts +
        "區、" +
        entry.counts.files +
        "份CSV、" +
        entry.counts.validRecords.toLocaleString("zh-TW") +
        "筆有效來源。" +
        (entry.kind === "baseline"
          ? "基準前歷史不完整，未補造更新紀錄。"
          : entry.difference.stationContentChanged
            ? "偵測到內容變更；識別含完整時間，識別變動列為新增／刪除，不推測為同一站。"
            : "只有檔案位元變更，站點內容未變（例如欄位順序、換行或列順序）。");
      li.append(title, text);
      for (const difference of entry.difference?.byDistrict || []) {
        const p = document.createElement("p");
        p.textContent =
          difference.district +
          "：新增 " +
          difference.added +
          "、刪除 " +
          difference.removed +
          "、修改 " +
          difference.modified +
          "；無法確定差異：舊 " +
          difference.uncertainBefore +
          "／新 " +
          difference.uncertainAfter +
          " 筆。";
        li.append(p);
      }
      entries.append(li);
    }
    $("dataHistoryNote").textContent =
      history.entries.length === 1
        ? "本次網站更新僅調整程式功能，原始路線資料與追蹤基準相同。每次部署不會自動新增資料變更紀錄。"
        : "紀錄時間為本站建立快照或偵測差異的時間，不是官方發布或部署日期。";
  }
  async function load() {
    if (pending || history || !state?.meta) return;
    pending = true;
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("data/history/index.json", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw Error();
      const value = await response.json(),
        entries = value?.entries;
      if (
        value.version !== 1 ||
        !Array.isArray(entries) ||
        !entries.length ||
        entries.some(
          (e) =>
            !["baseline", "change"].includes(e.kind) ||
            !/^[a-f0-9]{64}$/.test(e.contentRevision) ||
            !/^[a-f0-9]{64}$/.test(e.byteRevision) ||
            !Number.isFinite(Date.parse(e.recordedAt)) ||
            !e.counts ||
            !Number.isInteger(e.counts.validRecords),
        )
      )
        throw Error();
      const input = JSON.stringify(
          [...RouteFiles]
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
            .map((f) => [f.name, state.meta.files[f.name]]),
        ),
        digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(input),
        ),
        hash = [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      if (entries.at(-1).byteRevision !== hash) throw Error();
      history = value;
      render();
    } catch {
      $("historyStatus").textContent =
        "目前無法取得相符的資料變更紀錄，請稍後收合後再展開重試；查詢功能仍可使用。";
    } finally {
      pending = false;
      clearTimeout(timer);
    }
  }
  window.addEventListener("route-data-state", (event) => {
    state = event.detail;
    history = null;
    render();
    if ($("versionInfo").open) load();
  });
  $("versionInfo").addEventListener("toggle", () => {
    if ($("versionInfo").open) load();
  });
  render();
})();
