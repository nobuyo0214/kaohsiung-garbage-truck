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
    "weekday",
    "period",
    "sortOrder",
  ];
  const districts = [...$("district").options].map((o) => o.value);
  const loader = createSearchLoader();
  let dataMeta = null,
    loadEpoch = 0;
  let truckData = [],
    index = T.createIndex([]),
    loaded = false,
    loading = false;
  let currentMatches = [],
    visibleCount = 0,
    viewMode = "search",
    activeFilters = null,
    retiredSearchNotice = "";
  let failedFiles = [],
    mapping = { ok: false },
    preferences = { favorites: [], recent: [] };
  let toastTimer, suggestionTimer;
  const citySuggestions = new Map();
  let nearby = Journey.nearbyIndex([], null), distances = new WeakMap();
  function leaveNearby() {
    const active = locationSession.get() || $("nearbyButton").getAttribute("aria-busy") === "true";
    locationSession.cancel();
    distances = new WeakMap();
    if (active) $("nearbyStatus").textContent = "已取消或清除本次定位；需要時請重新定位。";
  }
  function renderNearby({ scroll = true } = {}) {
    const position = locationSession.get();
    if (!loaded || !position) return;
    viewMode = "nearby";
    extras.clearShared();
    retiredSearchNotice = "";
    const entries = nearby.search(position.point, Number($("nearbyRadius").value));
    distances = new WeakMap(entries.map(entry => [entry.row, entry.distance]));
    currentMatches = entries.map(entry => entry.row);
    $("nearbyStatus").textContent = "定位誤差約 " + Math.ceil(position.accuracy) +
      "公尺；僅為本次定位的直線距離，非車輛距離。切換畫面或5分鐘後清除位置。";
    updateViewButtons();
    updateDayNotice();
    renderMatches();
    if (scroll) scrollToResults();
  }
  const locationSession = createNearbySession({
    onResult: renderNearby,
    onBusy: busy => {
      $("nearbyButton").disabled = busy || !loaded;
      $("nearbyButton").setAttribute("aria-busy", String(busy));
      $("nearbyButton").textContent = busy ? "正在取得位置…" : "找我附近的停靠站";
      if (busy) {
        $("nearbyStatus").textContent = "正在取得位置；你仍可使用一般文字搜尋。";
        if (viewMode === "nearby") {
          currentMatches = [];
          $("moreButton").hidden = true;
          $("resultStatus").textContent = "正在重新定位…";
          emptyState("正在更新附近站點", "定位完成後才顯示新的直線距離。");
        }
      }
    },
    onError: message => {
      if (viewMode === "nearby" && loaded) searchTruck({ remember: false, scroll: false });
      $("nearbyStatus").textContent = message;
    },
    onClear: message => {
      if (viewMode === "nearby" && loaded) searchTruck({ remember: false, scroll: false });
      $("nearbyStatus").textContent = message;
    },
  });

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

  preferences.favoriteDetails = T.cleanFavoriteDetails(preferences.favorites, preferences.favoriteDetails);

  function persist() {
    try {
      localStorage.setItem(
        "garbage-search-v1",
        JSON.stringify({ version: 1, ...preferences }),
      );
      return true;
    } catch {
      toast("無法保存至此瀏覽器；目前操作仍有效，關閉頁面後可能遺失。");
      return false;
    }
  }
  function filters() {
    return {
      ...Object.fromEntries(filterIds.map((id) => [id, $(id).value])),
      dayType: "recycle",
    };
  }
  function searchDescription(f) {
    const parts = [f.district === T.ALL_DISTRICTS ? "全高雄市" : f.district, f.village, D.clean(f.keyword)];
    if (f.weekday)
      parts.push(
        f.dayType === "garbage" ? "舊星期條件已停用" : "回收・週" + f.weekday,
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
        const retired = f.dayType === "garbage";
        $("district").value = f.district;
        updateVillages();
        for (const id of filterIds.filter((id) => id !== "district"))
          $(id).value = id === "weekday" && retired ? "" : f[id];
        // A village may disappear in a new CSV; disclose rather than silently widening the search.
        if ($("village").value !== f.village) {
          toast("這筆搜尋的村里目前未載入，已保留紀錄；請重新選擇村里。");
          return;
        }
        const notice = retired
          ? "舊搜尋的星期條件已不再提供，未套用原星期。其他條件已保留；請重新選擇資源回收星期。"
          : "";
        updateSuggestions();
        searchTruck({ remember: !retired, scroll: !retired, notice });
        if (retired) {
          $("advancedFilters").open = true;
          $("weekday").focus();
          toast(notice);
        }
      });
      $("recentSearches").append(button);
    }
  }
  function updateSuggestions() {
    clearTimeout(suggestionTimer);
    citySuggestions.clear();
    if ($("district").value === T.ALL_DISTRICTS) {
      $("keywordSuggestions").replaceChildren(...index.suggestStops($("keyword").value).map(stop => {
        citySuggestions.set(stop.label, stop);
        const option = element("option");
        option.value = stop.label;
        return option;
      }));
      return;
    }
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
  function useCitySuggestion() {
    if ($("district").value !== T.ALL_DISTRICTS) return false;
    const stop = citySuggestions.get($("keyword").value);
    if (!stop) return false;
    $("district").value = stop.district;
    $("keyword").value = stop.place;
    $("village").value = "";
    updateVillages();
    return true;
  }
  function updateVillages() {
    const city = $("district").value === T.ALL_DISTRICTS;
    $("village").closest(".field").hidden = city;
    $("district").closest(".field").classList.toggle("full", city);
    $("keywordHint").textContent = city
      ? "搜尋全市38區；建議會標示行政區，點選後切換至該區。"
      : "輸入地點可看本區站點建議，也可留空查看全區。";
    const previous = $("village").value;
    const villages = [
      ...new Set(
        (index.districts.get($("district").value) || [])
          .map((r) => r.villageName)
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    const all = element("option", "", $("district").value === T.ALL_DISTRICTS ? "全市搜尋不需選村里" : "全部村里");
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
        (district === T.ALL_DISTRICTS || f.district === district ||
          (district === "大寮區" && name === "sanmin-west.csv")),
    );
  }
  function updateDayNotice() {
    const district = viewMode === "saved"
      ? ""
      : activeFilters?.district || $("district").value;
    const messages = retiredSearchNotice ? [retiredSearchNotice] : [];
    if (viewMode === "nearby") {
      messages.push("僅列出可安全導航的已知站點，依直線距離排序；未通過位置品質檢查的站點不列入，距離不是步行路程或車輛位置。");
      if (failedFiles.length || !mapping.ok) messages.push("部分路線或版本資料未載入，附近結果可能不完整；請重試載入。");
    } else if (viewMode === "saved")
      messages.push(
        "收藏顯示所有行政區，未套用左側篩選；資源回收日依當次載入資料顯示。",
      );
    else {
      const rows = district === T.ALL_DISTRICTS ? index.search({ district }) : index.districts.get(district) || [],
        known = rows.filter((r) => D.clean(r.recycleDay)).length;
      if (!known && activeFilters?.weekday)
        messages.push(
          "此區尚未提供資源回收日，無法篩選回收星期；不表示沒有垃圾車。",
        );
      else if (known < rows.length && activeFilters?.weekday)
        messages.push(
          "星期篩選僅包含已提供對應資源回收日的站點。",
        );
      if (failedFiles.some((name) => affectsDistrict(name, district)))
        messages.push(district === T.ALL_DISTRICTS ? "全市部分路線尚未載入，搜尋結果不完整；未找到不代表沒有該地點，請重試載入。" : "本區部分路線尚未載入，搜尋結果可能不完整，請重試載入。");
    }
    if (!mapping.ok && loaded)
      messages.push(
        "部分版本驗證資料未載入；已取得的資源回收資訊仍可查詢，請重試載入。",
      );
    $("filterNotice").textContent = messages.join(" ");
  }
  function updateViewButtons() {
    $("viewAllButton").setAttribute("aria-pressed", String(viewMode === "search"));
    $("viewSavedButton").setAttribute("aria-pressed", String(viewMode === "saved"));
    $("favoriteCount").textContent = preferences.favorites.length;
    $("resultsHeading").textContent = viewMode === "timeline" ? "今日回收時間軸" : viewMode === "nearby" ? "附近可靠停靠站" : viewMode === "saved" ? "我的收藏" : "停靠資訊";
    $("todayButton").setAttribute("aria-pressed", String(viewMode === "timeline"));
    $("todayButton").textContent = viewMode === "timeline" ? "重新套用今日條件 ↗" : "查看今日時間軸 ↗";
    $("timelineControls").closest(".results-panel").classList.toggle("timeline-view", viewMode === "timeline");
    $("timelineControls").hidden = viewMode !== "timeline" || !loaded;
    $("results").classList.toggle("timeline-results", viewMode === "timeline");
    extras.updateManager();
  }
  function scrollToResults() {
    if (matchMedia("(max-width: 760px)").matches) {
      $("resultsHeading").tabIndex = -1;
      $("resultsHeading").focus({ preventScroll: true });
      $("resultsHeading").scrollIntoView({ block: "start" });
    }
  }
  function searchTruck({ remember = true, scroll = true, notice = "" } = {}) {
    if (!loaded) return;
    leaveNearby();
    useCitySuggestion();
    extras.clearShared();
    viewMode = "search";
    retiredSearchNotice = notice;
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
  function refreshTimeline({ scroll = false, force = false } = {}) {
    if (!loaded || viewMode !== "timeline") return;
    const clock = Journey.taipeiClock(), previousDay = activeFilters.weekday;
    activeFilters = { ...activeFilters, dayType: "recycle", weekday: clock.day, sortOrder: "asc" };
    if ($("weekday").value === previousDay) $("weekday").value = clock.day;
    const next = Journey.todayRows(index.search(activeFilters), {
      remaining: $("timelineRemaining").value === "remaining",
    });
    const clockText = clock.date + "（星期" + clock.day + "）" + clock.time + "・台灣時間";
    if ($("timelineClock").textContent !== clockText) $("timelineClock").textContent = clockText;
    $("activeContext").textContent = searchDescription(activeFilters);
    if (!force && next.length === currentMatches.length && next.every((row, i) => row === currentMatches[i])) return;
    const previousCount = force ? PAGE_SIZE : visibleCount, active = document.activeElement,
      focusedId = active?.closest(".card")?.querySelector(".save-button")?.dataset.stopId,
      controlClass = ["save-button", "copy-button", "share-button", "report-button", "map-link", "place-search-link"].find(name => active?.classList.contains(name));
    currentMatches = next;
    updateViewButtons();
    updateDayNotice();
    renderMatches();
    while (visibleCount < previousCount && visibleCount < currentMatches.length) showMore();
    if (focusedId && controlClass) {
      const card = [...document.querySelectorAll(".card")].find(card => card.querySelector(".save-button")?.dataset.stopId === focusedId);
      const target = card?.querySelector("." + controlClass) || $("resultsHeading");
      target.tabIndex = target.tabIndex < 0 ? -1 : target.tabIndex;
      target.focus({ preventScroll: true });
    }
    if (scroll) scrollToResults();
  }
  function showTimeline({ scroll = true, remember = true } = {}) {
    if (!loaded) return;
    leaveNearby();
    useCitySuggestion();
    extras.clearShared();
    viewMode = "timeline";
    retiredSearchNotice = "";
    $("period").value = "";
    $("sortOrder").value = "asc";
    $("weekday").value = updateTodayLabel();
    activeFilters = filters();
    updateSuggestions();
    if (remember) {
      preferences.recent = T.remember(preferences.recent, activeFilters);
      persist();
      renderRecent();
    }
    refreshTimeline({ scroll, force: true });
  }
  function showSaved({ scroll = true } = {}) {
    leaveNearby();
    viewMode = "saved";
    retiredSearchNotice = "";
    extras.clearShared();
    updateViewButtons();
    if (!loaded) {
      $("moreButton").hidden = true;
      $("resultStatus").textContent = "目前無法更新清運資訊；收藏識別仍保留。";
      emptyState(
        "目前無法更新清運資訊",
        "可以匯出或匯入收藏備份；恢復網路後請重試載入。",
        "重試載入",
        loadAllData,
      );
      return;
    }
    const keys = new Set(preferences.favorites);
    currentMatches = [...index.districts.values()]
      .flat()
      .filter((r) => keys.has(T.stopId(r)));
    currentMatches.sort(
      (a, b) => Number(Convenience.favoriteDetail(preferences.favoriteDetails, T.stopId(b)).pinned) -
        Number(Convenience.favoriteDetail(preferences.favoriteDetails, T.stopId(a)).pinned) ||
        (a.startMinute ?? Infinity) - (b.startMinute ?? Infinity),
    );
    updateViewButtons();
    updateDayNotice();
    renderMatches();
    if (scroll) scrollToResults();
  }
  function emptyState(title, description, action, onClick) {
    const box = element("div", "empty-state");
    const symbol = element("div", "empty-symbol");
    symbol.append(icon(viewMode === "saved" ? "save" : "search"));
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
    $("activeContext").textContent = viewMode === "nearby" ? "全市・" + $("nearbyRadius").selectedOptions[0].textContent : viewMode === "saved"
      ? "所有行政區"
      : searchDescription(activeFilters);
    if (!currentMatches.length) {
      $("resultStatus").textContent =
        "找到 0 筆" + (viewMode === "saved" ? "收藏站點。" : "資料。");
      if (viewMode === "nearby")
        emptyState("此範圍內未找到可靠停靠站", "目前範圍內沒有通過位置品質檢查的停靠站，可擴大搜尋範圍，或改用地點文字搜尋。", "改用地點文字搜尋", () => searchTruck({ remember: false }));
      else if (viewMode === "saved")
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
      else if (viewMode === "timeline" && $("timelineRemaining").value === "remaining")
        emptyState("沒有符合的表定時間", "目前條件下沒有起始／到點時間尚未過去的已知回收站點。這不表示附近沒有垃圾車；可切換全部時段或改用一般搜尋。", "查看全部時段", () => {
          $("timelineRemaining").value = "all";
          refreshTimeline({ force: true });
        });
      else if (activeFilters.weekday)
        emptyState(
          "沒有符合的資源回收站點",
          "請改選回收星期、街道或時段；未提供回收日的站點不會列入星期篩選。這不表示沒有垃圾車。",
          "清除搜尋條件",
          resetFilters,
        );
      else
        emptyState(
          "這次沒有找到停靠站",
          "試試較短的街道名稱、其他村里，或清除星期與時段。資料未載入時，請先重試。",
          "清除搜尋條件",
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
    preferences.favoriteDetails = T.cleanFavoriteDetails(preferences.favorites, preferences.favoriteDetails);
    persist();
    updateViewButtons();
    if (viewMode === "saved") {
      showSaved({ scroll: false });
      $("viewSavedButton").focus({ preventScroll: true });
    } else
      document.querySelectorAll(".save-button").forEach((control) => {
        if (control.dataset.stopId === id) refreshSaveButton(control, row);
      });
  }
  async function copyStop(row) {
    $("copyHeading").textContent = "複製停靠資訊";
    const time = D.normalizeTime(row.停留時間),
      timeLabel = time
        ? time.includes("-")
          ? "表定停留時間"
          : "表定到點時間"
        : "原始時間（待確認）";
    const text = [
      row.searchDistrict + " " + (row.villageName || "村里尚未提供"),
      D.clean(row.停留地點),
      timeLabel + "：" + (D.clean(row.停留時間) || "尚未提供"),
      "資源回收日：" + (D.clean(row.recycleDay) || "尚未提供"),
      "表定停靠資訊，非即時車輛定位",
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
    if (viewMode === "nearby") card.append(element("p", "stop-distance", Journey.formatDistance(distances.get(row))));
    const normalized = D.normalizeTime(row.停留時間);
    const timeline = viewMode === "timeline", schedule = Journey.schedule(row);
    const time = element(
      "p",
      "stop-time" + (normalized ? "" : " invalid"),
      normalized
        ? normalized.replace("-", "–")
        : timeline ? "表定時間尚未提供" : D.clean(row.停留時間) || "時間尚未提供",
    );
    const caption = normalized
      ? normalized.includes("-")
        ? "表定停留時間"
        : "表定到點時間・未提供離站時間"
      : timeline ? "時間無法完整解析，未列入尚未過去篩選" : "原始時間待確認，未列入時段篩選";
    const heading = element("h3", "", D.clean(row.停留地點)), captionNode = element("p", "time-caption", caption);
    if (timeline) {
      card.classList.add("timeline-card");
      card.append(time, captionNode, heading, top);
      if (schedule.crossesMidnight) card.append(element("p", "time-caption", "跨午夜時段，來源未提供跨日歸屬；不列入尚未過去篩選。"));
    } else card.append(top, heading, time, captionNode);
    const days = element("dl", "day-grid");
    const pair = element("div", "day-detail"),
      day = D.clean(row.recycleDay);
    pair.append(
      element("dt", day ? "" : "sr-only", "資源回收日"),
      element("dd", day ? "" : "unknown", day || "資源回收日尚未提供"),
    );
    days.append(pair);
    const actions = element("div", "card-actions");
    const copy = element("button", "copy-button");
    copy.type = "button";
    copy.append(icon("copy"), document.createTextNode("複製資訊"));
    copy.setAttribute(
      "aria-label",
      "複製資訊：" + row.停留地點 + " " + row.停留時間,
    );
    copy.addEventListener("click", () => copyStop(row));
    actions.append(copy);
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
    extras.decorateCard(card, row);
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
    if (viewMode === "saved") {
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
    $("weekday").value = "";
    $("period").value = "";
    $("sortOrder").value = "asc";
    updateSuggestions();
    searchTruck({ remember: false, scroll: false });
  }
  async function loadAllData() {
    if (loading) return;
    const epoch = ++loadEpoch;
    loading = true;
    $("searchButton").disabled = true;
    $("todayButton").disabled = true;
    $("retryButton").disabled = true;
    $("searchButton").textContent = "資料載入中…";
    $("results").setAttribute("aria-busy", "true");
    try {
      if (navigator.onLine === false) throw Error("離線中，無法更新資料");
      const meta = await SiteData.metadata();
      if (epoch !== loadEpoch) return;
      if (dataMeta && dataMeta.dataRevision !== meta.dataRevision)
        loader.reset();
      dataMeta = meta;
      const geometryPromise = SiteData.geometry(meta).catch(() => null);
      const result = await loader.load(
        files,
        D.HEADERS,
        (count, total) => {
          if (epoch !== loadEpoch) return;
          $("dataStatus").textContent =
            "正在讀取停靠資訊… " + count + " / " + total;
        },
        meta.files,
      );
      const topology = await geometryPromise;
      if (epoch !== loadEpoch) return;
      if (navigator.onLine === false) throw Error("離線中，無法更新資料");
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
      extras.updateData({
        rows: truckData,
        topology,
        complete: failedFiles.length === 0 && mapping.ok,
        meta,
        loadedAt: loaded ? new Date() : null,
      });
      nearby = Journey.nearbyIndex(index.search({ district: T.ALL_DISTRICTS }), extras.getLocationAudit());
      $("dataStatus").textContent =
        "已載入 " +
        (files.length - failedFiles.length) +
        " / " +
        files.length +
        " 份資料，" +
        truckData.length.toLocaleString("zh-TW") +
        " 筆有效紀錄。" +
        (mapping.ok ? "資料版本檢查完成。" : "部分版本驗證資料未載入。");
      $("dataStatus").parentElement.classList.toggle(
        "warning",
        failedFiles.length > 0 || !mapping.ok,
      );
      $("dataDetailText").textContent = [
        failedFiles.length
          ? "載入失敗：" + failedFiles.join("、") + "。"
          : "所有路線檔案均已載入。",
        mapping.ok
          ? "資料版本檢查完成。"
          : "部分版本驗證資料未載入，請重試。",
        "相同停靠資訊的重複卡片合併顯示 " +
          index.duplicateCount +
          " 筆；原始 CSV 均保留。",
        topology
          ? "導航圖資版本檢查通過。"
          : "位置圖資未能載入或版本不符，暫不提供導航；可重試。",
      ].join(" ");
      $("retryButton").hidden = !failedFiles.length && mapping.ok && !!topology;
      updateVillages();
      renderRecent();
      if (loaded) {
        if (extras.resolveShared()) {
          /* A share failure must not silently show another stop. */
        } else if (viewMode === "nearby" && locationSession.get()) renderNearby({ scroll: false });
        else if (viewMode === "timeline") refreshTimeline();
        else if (viewMode === "saved") showSaved({ scroll: false });
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
      if (epoch !== loadEpoch) return;
      locationSession.cancel();
      viewMode = "search";
      updateViewButtons();
      nearby = Journey.nearbyIndex([], null);
      loaded = false;
      truckData = [];
      index = T.createIndex([]);
      currentMatches = [];
      $("moreButton").hidden = true;
      loader.reset();
      extras.updateData({
        rows: [],
        topology: null,
        complete: false,
        meta: dataMeta,
        loadedAt: null,
      });
      $("dataStatus").textContent =
        (navigator.onLine === false ? "離線中，" : "") +
        "目前無法更新清運資訊，請檢查網路與資料版本後重試。";
      $("filterNotice").textContent =
        "資料尚未完整取得，無法查詢回收星期；這不表示沒有停靠站。";
      $("retryButton").hidden = false;
      emptyState(
        "目前無法更新清運資訊",
        "請重試載入，或重新整理頁面。",
        "重試載入",
        loadAllData,
      );
    } finally {
      loading = false;
      $("searchButton").disabled = !loaded;
      $("searchButton").textContent = loaded ? "搜尋垃圾車" : "資料尚未載入";
      $("todayButton").disabled = !loaded;
      $("nearbyButton").disabled = !loaded;
      $("retryButton").disabled = false;
      $("viewSavedButton").disabled = false;
      $("quickSavedButton").disabled = false;
      $("results").setAttribute("aria-busy", "false");
    }
  }
  function updateTodayLabel() {
    const day = T.taipeiWeekday();
    $("todayLabel").textContent =
      "台灣時間・星期" + day + "・依已提供的資源回收日篩選";
    return day;
  }
  const extras = createConvenienceUI({
    getState: () => ({ rows: truckData, loaded, savedView: viewMode === "saved", preferences }),
    toast,
    setFavorites: (favorites, details = preferences.favoriteDetails) => {
      preferences.favorites = favorites;
      preferences.favoriteDetails = T.cleanFavoriteDetails(favorites, details);
      const stored = persist();
      updateViewButtons();
      if (viewMode === "saved") showSaved({ scroll: false });
      return stored;
    },
    onShared: (row) => {
      leaveNearby();
      viewMode = "search";
      retiredSearchNotice = "";
      $("district").value = row.searchDistrict;
      updateVillages();
      $("village").value = "";
      $("keyword").value = row.停留地點;
      $("weekday").value = "";
      $("period").value = "";
      $("sortOrder").value = "asc";
      activeFilters = filters();
      currentMatches = [row];
      updateViewButtons();
      updateDayNotice();
      renderMatches();
    },
    onShareError: (message) => {
      leaveNearby();
      viewMode = "search";
      currentMatches = [];
      $("moreButton").hidden = true;
      updateViewButtons();
      $("resultStatus").textContent = "站點資料可能已變更。";
      emptyState("站點資料可能已變更", message, "回到一般查詢", () =>
        searchTruck({ remember: false }),
      );
    },
  });
  window.addEventListener("offline", () => {
    leaveNearby();
    viewMode = "search";
    nearby = Journey.nearbyIndex([], null);
    $("nearbyButton").disabled = true;
    $("nearbyStatus").textContent = "離線中，已清除位置；請恢復網路後重新定位。";
    loadEpoch++;
    loader.reset();
    loaded = false;
    truckData = [];
    index = T.createIndex([]);
    currentMatches = [];
    $("searchButton").disabled = true;
    $("todayButton").disabled = true;
    $("moreButton").hidden = true;
    updateViewButtons();
    $("dataStatus").textContent = "離線中，目前無法更新清運資訊。";
    $("filterNotice").textContent =
      "目前無法更新清運資訊；不顯示離線舊日期，收藏備份仍可管理。";
    $("retryButton").hidden = false;
    extras.updateData({
      rows: [],
      topology: null,
      complete: false,
      meta: dataMeta,
      loadedAt: null,
    });
    emptyState(
      "目前無法更新清運資訊",
      "請恢復網路後重試。本站只快取網站介面，不提供離線清運資料。",
      "重試載入",
      loadAllData,
    );
  });
  window.addEventListener("online", () => {
    if (!loading) loadAllData();
  });
  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    searchTruck();
  });
  $("district").addEventListener("change", () => {
    $("village").value = "";
    updateVillages();
    if (viewMode === "timeline") showTimeline({ remember: false, scroll: false });
    else searchTruck({ remember: false, scroll: false });
  });
  $("village").addEventListener("change", updateSuggestions);
  $("keyword").addEventListener("input", () => {
    if (useCitySuggestion()) return;
    clearTimeout(suggestionTimer);
    suggestionTimer = setTimeout(updateSuggestions, 100);
  });
  $("nearbyButton").addEventListener("click", () => {
    if (!loaded) return;
    if (!extras.getLocationAudit()) {
      $("nearbyStatus").textContent = "路線、版本或圖資未完整載入，無法完成位置品質檢查；附近結果可能不完整，請先重試載入。";
      return;
    }
    locationSession.request();
  });
  $("nearbyRadius").addEventListener("change", () => {
    if (viewMode === "nearby") renderNearby({ scroll: false });
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
    $("timelineRemaining").value = "all";
    showTimeline();
  });
  $("timelineRemaining").addEventListener("change", () => refreshTimeline({ force: true }));
  $("clearRecentButton").addEventListener("click", () => {
    preferences.recent = [];
    persist();
    renderRecent();
    toast("已清除最近搜尋紀錄。");
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { updateTodayLabel(); refreshTimeline(); }
  });
  setInterval(() => {
    if (!document.hidden) { updateTodayLabel(); refreshTimeline(); }
  }, 30000);
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
