"use strict";
(() => {
  const D = GarbageData,
    T = SearchTools,
    files = RouteFiles;
  const PAGE_SIZE = 30,
    $ = (id) => document.getElementById(id);
  const filterIds = [
    "district",
    "village",
    "keyword",
    "dayType",
    "weekday",
    "period",
    "sortOrder",
  ];
  const districts = [...$("district").options].map((o) => o.value);
  const loader = createSearchLoader();
  let truckData = [],
    index = T.createIndex([]),
    loaded = false,
    loading = false;
  let currentMatches = [],
    visibleCount = 0,
    savedView = false,
    activeFilters = null;
  let failedFiles = [],
    mapping = { ok: false },
    preferences = { favorites: [], recent: [] };
  let toastTimer, suggestionTimer;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function icon(type) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute(
      "d",
      {
        search: "m20 20-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
        save: "M6 3h12v18l-6-4-6 4V3Z",
        copy: "M9 9h11v12H9zM15 9V3H3v12h6",
      }[type],
    );
    svg.append(path);
    return svg;
  }
  function toast(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").hidden = false;
    toastTimer = setTimeout(() => {
      $("toast").hidden = true;
    }, 4500);
  }
  try {
    preferences = T.readPreferences(localStorage, districts);
  } catch {
    toast("此瀏覽器暫時無法讀取搜尋紀錄，仍可正常查詢。");
  }

  function persist() {
    try {
      localStorage.setItem(
        "garbage-search-v1",
        JSON.stringify({ version: 1, ...preferences }),
      );
    } catch {
      toast("無法保存至此瀏覽器；目前操作仍有效，關閉頁面後可能遺失。");
    }
  }
  function filters() {
    return Object.fromEntries(filterIds.map((id) => [id, $(id).value]));
  }
  function searchDescription(f) {
    const parts = [f.district, f.village, D.clean(f.keyword)];
    if (f.weekday)
      parts.push(
        (f.dayType === "garbage" ? "垃圾" : "回收") + "・週" + f.weekday,
      );
    if (f.period)
      parts.push(
        $("period")
          .querySelector('option[value="' + f.period + '"]')
          .textContent.split("（")[0],
      );
    if (f.sortOrder === "desc") parts.push("由晚到早");
    return parts.filter(Boolean).join(" · ");
  }
  function renderRecent() {
    $("recentSearches").replaceChildren();
    $("recentSection").hidden = !preferences.recent.length;
    for (const f of preferences.recent) {
      const label = searchDescription(f),
        button = element("button", "", label);
      button.type = "button";
      button.title = label;
      button.disabled = !loaded;
      button.addEventListener("click", () => {
        $("district").value = f.district;
        updateVillages();
        for (const id of filterIds.filter((id) => id !== "district"))
          $(id).value = f[id];
        // A village may disappear in a new CSV; disclose rather than silently widening the search.
        if ($("village").value !== f.village) {
          toast("這筆搜尋的村里目前未載入，已保留紀錄；請重新選擇村里。");
          return;
        }
        searchTruck();
      });
      $("recentSearches").append(button);
    }
  }
  function updateSuggestions() {
    clearTimeout(suggestionTimer);
    $("keywordSuggestions").replaceChildren(
      ...index
        .suggest($("district").value, $("village").value, $("keyword").value)
        .map((place) => {
          const option = document.createElement("option");
          option.value = place;
          return option;
        }),
    );
  }
  function updateVillages() {
    const previous = $("village").value;
    const villages = [
      ...new Set(
        (index.districts.get($("district").value) || [])
          .map((r) => r.villageName)
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    const all = element("option", "", "全部村里");
    all.value = "";
    $("village").replaceChildren(
      all,
      ...villages.map((name) => {
        const option = element("option", "", name);
        option.value = name;
        return option;
      }),
    );
    if (villages.includes(previous)) $("village").value = previous;
    $("village").disabled = !loaded || !villages.length;
    updateSuggestions();
  }
  function affectsDistrict(name, district) {
    return files.some(
      (f) =>
        f.name === name &&
        (f.district === district ||
          (district === "大寮區" && name === "sanmin-west.csv")),
    );
  }
  function updateDayNotice() {
    const district = savedView
      ? ""
      : activeFilters?.district || $("district").value;
    const messages = [];
    if (savedView)
      messages.push(
        "收藏顯示所有行政區，未套用左側篩選；日期依當次載入資料顯示。",
      );
    else {
      const rows = index.districts.get(district) || [],
        known = rows.filter((r) => D.clean(r.garbageDay)).length;
      if (!known)
        messages.push(
          "此區尚未提供一般垃圾清運日，無法確認今日清運；不表示今天沒有垃圾車。",
        );
      else if (known < rows.length)
        messages.push(
          "本區僅 " +
            known +
            " / " +
            rows.length +
            " 筆有一般垃圾日；星期篩選不包含未提供日期的站點。",
        );
      if (failedFiles.some((name) => affectsDistrict(name, district)))
        messages.push("本區部分路線尚未載入，搜尋結果可能不完整，請重試載入。");
    }
    if (!mapping.ok && loaded)
      messages.push(
        "一般垃圾日期對照表未載入；目前僅顯示原始 CSV 已有的日期，請重試。",
      );
    $("filterNotice").textContent = messages.join(" ");
  }
  function updateViewButtons() {
    $("viewAllButton").setAttribute("aria-pressed", String(!savedView));
    $("viewSavedButton").setAttribute("aria-pressed", String(savedView));
    $("favoriteCount").textContent = preferences.favorites.length;
    $("resultsHeading").textContent = savedView ? "我的收藏" : "停靠資訊";
  }
  function scrollToResults() {
    if (matchMedia("(max-width: 760px)").matches) {
      $("resultsHeading").tabIndex = -1;
      $("resultsHeading").focus({ preventScroll: true });
      $("resultsHeading").scrollIntoView({ block: "start" });
    }
  }
  function searchTruck({ remember = true, scroll = true } = {}) {
    if (!loaded) return;
    savedView = false;
    activeFilters = filters();
    currentMatches = index.search(activeFilters);
    if (remember) {
      preferences.recent = T.remember(preferences.recent, activeFilters);
      persist();
      renderRecent();
    }
    updateViewButtons();
    updateDayNotice();
    renderMatches();
    if (scroll) scrollToResults();
  }
  function showSaved({ scroll = true } = {}) {
    if (!loaded) return;
    savedView = true;
    const keys = new Set(preferences.favorites);
    currentMatches = [...index.districts.values()]
      .flat()
      .filter((r) => keys.has(T.stopId(r)));
    currentMatches.sort(
      (a, b) => (a.startMinute ?? Infinity) - (b.startMinute ?? Infinity),
    );
    updateViewButtons();
    updateDayNotice();
    renderMatches();
    if (scroll) scrollToResults();
  }
  function emptyState(title, description, action, onClick) {
    const box = element("div", "empty-state");
    const symbol = element("div", "empty-symbol");
    symbol.append(icon(savedView ? "save" : "search"));
    box.append(symbol, element("h3", "", title), element("p", "", description));
    if (action) {
      const button = element("button", "", action);
      button.type = "button";
      button.addEventListener("click", onClick);
      box.append(button);
    }
    $("results").replaceChildren(box);
  }
  function renderMatches() {
    visibleCount = 0;
    $("results").replaceChildren();
    $("moreButton").hidden = true;
    $("activeContext").textContent = savedView
      ? "所有行政區"
      : searchDescription(activeFilters);
    if (!currentMatches.length) {
      $("resultStatus").textContent =
        "找到 0 筆" + (savedView ? "收藏站點。" : "資料。");
      if (savedView)
        emptyState(
          preferences.favorites.length
            ? "收藏站點目前無法顯示"
            : "把常用站點留在這裡",
          preferences.favorites.length
            ? "收藏識別仍保留；對應路線可能尚未載入，或站點資料已變更。請先檢查載入詳情。"
            : "搜尋後，按停靠卡片上的「收藏」，下次就能直接找到。",
          "回到搜尋結果",
          () => searchTruck({ remember: false }),
        );
      else if (activeFilters.dayType === "garbage" && activeFilters.weekday)
        emptyState(
          "沒有符合的已知垃圾站點",
          "部分站點尚未提供一般垃圾星期；沒有結果不表示當天沒有清運。可清除條件查看其他停靠資訊。",
          "清除條件，查看本區",
          resetFilters,
        );
      else
        emptyState(
          "這次沒有找到停靠站",
          "試試較短的街道名稱、其他村里，或清除星期與時段。資料未載入時，請先重試。",
          "清除條件，查看本區",
          resetFilters,
        );
      return;
    }
    showMore();
  }
  function refreshSaveButton(button, row) {
    const saved = preferences.favorites.includes(T.stopId(row));
    button.replaceChildren(
      icon("save"),
      document.createTextNode(saved ? "已收藏" : "收藏"),
    );
    button.setAttribute("aria-pressed", String(saved));
    button.dataset.stopId = T.stopId(row);
    button.setAttribute(
      "aria-label",
      (saved ? "取消收藏：" : "收藏：") + row.停留地點 + " " + row.停留時間,
    );
  }
  function toggleFavorite(row) {
    const id = T.stopId(row),
      saved = preferences.favorites.includes(id);
    if (!saved && preferences.favorites.length >= 200) {
      toast("目前最多收藏 200 個站點，請先取消不再使用的收藏。");
      return;
    }
    preferences.favorites = saved
      ? preferences.favorites.filter((key) => key !== id)
      : [...preferences.favorites, id];
    persist();
    updateViewButtons();
    if (savedView) {
      showSaved({ scroll: false });
      $("viewSavedButton").focus({ preventScroll: true });
    } else
      document.querySelectorAll(".save-button").forEach((control) => {
        if (control.dataset.stopId === id) refreshSaveButton(control, row);
      });
  }
  async function copyStop(row) {
    const text = [
      row.searchDistrict + " " + (row.villageName || "村里尚未提供"),
      D.clean(row.停留地點),
      "停留時間：" + (D.clean(row.停留時間) || "尚未提供"),
      "一般垃圾日：" + (D.clean(row.garbageDay) || "尚未提供"),
      "資源回收日：" + (D.clean(row.recycleDay) || "尚未提供"),
      "表定資訊，非即時車輛位置",
    ].join("\n");
    try {
      if (!navigator.clipboard?.writeText) throw Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      toast("已複製停靠地點、時間與清運資訊。");
    } catch {
      $("copyText").value = text;
      $("copyDialog").showModal();
      $("copyText").focus();
      $("copyText").select();
    }
  }
  function createResultCard(row) {
    const card = element("article", "card");
    const top = element("div", "card-topline"),
      location = element("div", "location-meta");
    location.append(
      element("span", "", row.searchDistrict),
      document.createTextNode(" · " + (row.villageName || "村里尚未提供")),
    );
    const save = element("button", "save-button");
    save.type = "button";
    refreshSaveButton(save, row);
    save.addEventListener("click", () => toggleFavorite(row));
    top.append(location, save);
    const normalized = D.normalizeTime(row.停留時間);
    const time = element(
      "p",
      "stop-time" + (normalized ? "" : " invalid"),
      normalized
        ? normalized.replace("-", "–")
        : D.clean(row.停留時間) || "時間尚未提供",
    );
    const caption = normalized
      ? normalized.includes("-")
        ? "表定停留時間"
        : "表定到點時間・未提供離站時間"
      : "原始時間待確認，未列入時段篩選";
    card.append(
      top,
      element("h3", "", D.clean(row.停留地點)),
      time,
      element("p", "time-caption", caption),
    );
    const days = element("dl", "day-grid");
    for (const [label, value] of [
      ["一般垃圾日", row.garbageDay],
      ["資源回收日", row.recycleDay],
    ]) {
      const pair = element("div", "day-detail"),
        day = D.clean(value);
      pair.append(
        element("dt", "", label),
        element("dd", day ? "" : "unknown", day || "尚未提供"),
      );
      days.append(pair);
    }
    const actions = element("div", "card-actions");
    const route =
      "責任區 " +
      (D.clean(row.責任區) || "尚未提供") +
      " · 車次 " +
      (D.clean(row.車次) || "尚未提供");
    const copy = element("button", "copy-button");
    copy.type = "button";
    copy.append(icon("copy"), document.createTextNode("複製資訊"));
    copy.setAttribute(
      "aria-label",
      "複製資訊：" + row.停留地點 + " " + row.停留時間,
    );
    copy.addEventListener("click", () => copyStop(row));
    actions.append(element("span", "route-meta", route), copy);
    card.append(days, actions);
    if (index.occurrences.get(row) > 1)
      card.append(
        element(
          "p",
          "source",
          "相同停靠資訊共 " +
            index.occurrences.get(row) +
            " 筆來源列，合併顯示；原始資料保留。",
        ),
      );
    if (
      ["taoyuan.csv", "maolin.csv", "namaxia.csv", "shanlin.csv"].includes(
        row.sourceFile,
      )
    )
      card.append(element("p", "source", "環境部路線資料整理版本"));
    return card;
  }
  function showMore() {
    const nextRows = currentMatches.slice(
        visibleCount,
        visibleCount + PAGE_SIZE,
      ),
      fragment = document.createDocumentFragment();
    nextRows.forEach((row) => fragment.append(createResultCard(row)));
    $("results").append(fragment);
    visibleCount += nextRows.length;
    $("moreButton").hidden = visibleCount >= currentMatches.length;
    $("moreButton").textContent =
      "顯示更多（剩下 " +
      (currentMatches.length - visibleCount).toLocaleString("zh-TW") +
      " 筆）";
    let status =
      "找到 " +
      currentMatches.length.toLocaleString("zh-TW") +
      " 筆，已顯示 " +
      visibleCount.toLocaleString("zh-TW") +
      " 筆。";
    if (savedView) {
      const available = new Set(currentMatches.map(T.stopId)).size,
        missing = preferences.favorites.length - available;
      if (missing)
        status += " 另有 " + missing + " 個收藏目前未載入，識別仍保留。";
    }
    $("resultStatus").textContent = status;
  }
  function resetFilters() {
    $("keyword").value = "";
    $("village").value = "";
    $("dayType").value = "recycle";
    $("weekday").value = "";
    $("period").value = "";
    $("sortOrder").value = "asc";
    updateSuggestions();
    searchTruck({ remember: false, scroll: false });
  }
  async function loadAllData() {
    if (loading) return;
    loading = true;
    $("searchButton").disabled = true;
    $("todayButton").disabled = true;
    $("retryButton").disabled = true;
    $("searchButton").textContent = "資料載入中…";
    $("results").setAttribute("aria-busy", "true");
    try {
      const result = await loader.load(files, D.HEADERS, (count, total) => {
        $("dataStatus").textContent =
          "正在讀取停靠資訊… " + count + " / " + total;
      });
      failedFiles = [];
      truckData = result.routes.flatMap((r, i) => {
        if (r.status === "fulfilled") return D.prepareRows(r.value, files[i]);
        failedFiles.push(files[i].name);
        return [];
      });
      mapping =
        result.rules.status === "fulfilled"
          ? D.applyRules(truckData, result.rules.value)
          : { ok: false };
      index = T.createIndex(truckData);
      loaded = truckData.length > 0;
      $("dataStatus").textContent =
        "已載入 " +
        (files.length - failedFiles.length) +
        " / " +
        files.length +
        " 份資料，" +
        truckData.length.toLocaleString("zh-TW") +
        " 筆有效紀錄。" +
        (mapping.ok ? mapping.rules + " 條規則。" : "部分日期資料未載入。");
      $("dataStatus").parentElement.classList.toggle(
        "warning",
        failedFiles.length > 0 || !mapping.ok,
      );
      $("dataDetailText").textContent = [
        failedFiles.length
          ? "載入失敗：" + failedFiles.join("、") + "。"
          : "所有路線檔案均已載入。",
        mapping.ok
          ? "日期配對 " +
            mapping.matched +
            " 筆；略過 " +
            mapping.skipped +
            " 筆、衝突 " +
            mapping.conflicts +
            " 條。"
          : "無法讀取一般垃圾日期對照表。",
        "相同班次、地點、完整時間、村里與兩種星期的重複卡片合併顯示 " +
          index.duplicateCount +
          " 筆；原始 CSV 均保留。",
      ].join(" ");
      $("retryButton").hidden = !failedFiles.length && mapping.ok;
      updateVillages();
      renderRecent();
      if (loaded) {
        if (savedView) showSaved({ scroll: false });
        else if (activeFilters) {
          // Re-run the last submitted search, without overwriting any draft edits.
          currentMatches = index.search(activeFilters);
          updateViewButtons();
          updateDayNotice();
          renderMatches();
        } else searchTruck({ remember: false, scroll: false });
      } else {
        $("resultStatus").textContent = "停靠資料尚未載入。";
        $("filterNotice").textContent =
          "資料載入失敗，請檢查網路後重試；這不表示沒有停靠站。";
        emptyState(
          "暫時無法載入停靠資訊",
          "請確認網路連線，再按下方按鈕重試。",
          "重試載入",
          loadAllData,
        );
      }
    } catch {
      $("dataStatus").textContent = "資料載入失敗，請檢查網路後重試。";
      $("retryButton").hidden = false;
      emptyState(
        "暫時無法載入停靠資訊",
        "請重試載入，或重新整理頁面。",
        "重試載入",
        loadAllData,
      );
    } finally {
      loading = false;
      $("searchButton").disabled = !loaded;
      $("searchButton").textContent = loaded ? "搜尋垃圾車" : "資料尚未載入";
      $("todayButton").disabled = !loaded;
      $("retryButton").disabled = false;
      $("viewSavedButton").disabled = !loaded;
      $("quickSavedButton").disabled = !loaded;
      $("results").setAttribute("aria-busy", "false");
    }
  }
  function updateTodayLabel() {
    const day = T.taipeiWeekday();
    $("todayLabel").textContent =
      "台灣時間・星期" + day + "・僅含已提供垃圾日的站點";
    return day;
  }
  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    searchTruck();
  });
  $("district").addEventListener("change", () => {
    $("village").value = "";
    updateVillages();
    resetFilters();
  });
  $("village").addEventListener("change", updateSuggestions);
  $("keyword").addEventListener("input", () => {
    clearTimeout(suggestionTimer);
    suggestionTimer = setTimeout(updateSuggestions, 100);
  });
  $("resetButton").addEventListener("click", resetFilters);
  $("moreButton").addEventListener("click", showMore);
  $("retryButton").addEventListener("click", loadAllData);
  $("viewAllButton").addEventListener("click", () =>
    searchTruck({ remember: false }),
  );
  $("viewSavedButton").addEventListener("click", () => showSaved());
  $("quickSavedButton").addEventListener("click", () => showSaved());
  $("todayButton").addEventListener("click", () => {
    $("keyword").value = "";
    $("village").value = "";
    $("period").value = "";
    $("sortOrder").value = "asc";
    $("dayType").value = "garbage";
    $("weekday").value = updateTodayLabel();
    updateSuggestions();
    searchTruck();
  });
  $("clearRecentButton").addEventListener("click", () => {
    preferences.recent = [];
    persist();
    renderRecent();
    toast("已清除最近搜尋紀錄。");
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateTodayLabel();
  });
  if (matchMedia("(max-width: 760px)").matches)
    $("advancedFilters").open = false;
  updateTodayLabel();
  updateViewButtons();
  renderRecent();
  emptyState(
    "正在準備停靠資訊",
    "首次載入完成後，即可搜尋、收藏及查看表定時間。",
  );
  loadAllData();
})();
