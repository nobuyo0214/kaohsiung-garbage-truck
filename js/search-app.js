"use strict";
const files = RouteFiles;

const PAGE_SIZE = 30;
let truckData = [];
let loaded = false;
let currentMatches = [];
let visibleCount = 0;

const $ = (id) => document.getElementById(id);

const { clean, normalize, getStartMinute, matchesWeekday, matchesPeriod } =
  GarbageData;

function loadCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file.name, {
      download: true,
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => clean(header).replace(/^\uFEFF/, ""),
      complete: (result) => {
        if (!result.meta.fields || !result.meta.fields.includes("停留地點")) {
          reject(new Error(file.name + " 缺少「停留地點」欄位"));
          return;
        }

        if (result.errors.length) {
          reject(new Error(file.name + " CSV 解析失敗"));
          return;
        }
        const rows = GarbageData.prepareRows(result.data, file);

        resolve(rows);
      },
      error: (error) => reject(error),
    });
  });
}

function loadGarbageDayMap() {
  return new Promise((resolve) =>
    Papa.parse("garbage-days.csv", {
      download: true,
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => clean(h).replace(/^\uFEFF/, ""),
      complete: (result) => {
        if (
          result.errors.length ||
          !GarbageData.HEADERS.every((h) =>
            (result.meta.fields || []).includes(h),
          )
        ) {
          resolve({ ok: false, message: "日期對照表解析失敗或缺少必要欄位" });
          return;
        }
        resolve(GarbageData.applyRules(truckData, result.data));
      },
      error: () => resolve({ ok: false, message: "無法讀取 garbage-days.csv" }),
    }),
  );
}

async function loadAllData() {
  const results = await Promise.allSettled(files.map((file) => loadCSV(file)));
  const failedFiles = [];
  const allRows = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      allRows.push(...result.value);
    } else {
      failedFiles.push(files[index].name);
    }
  });

  truckData = allRows;
  const mapping = await loadGarbageDayMap();
  loaded = true;
  $("searchButton").disabled = false;
  $("searchButton").textContent = "搜尋垃圾車";

  $("dataStatus").textContent =
    "成功載入 " +
    (files.length - failedFiles.length) +
    " / " +
    files.length +
    " 份 CSV，共 " +
    truckData.length.toLocaleString("zh-TW") +
    " 筆有效紀錄。";

  if (failedFiles.length > 0) {
    $("dataStatus").textContent += " 載入失敗：" + failedFiles.join("、");
    $("dataStatus").classList.add("warning");
  }

  if (mapping.ok) {
    $("dataStatus").textContent +=
      "｜日期對照表 " +
      mapping.rules +
      " 條規則，配對 " +
      mapping.matched +
      " 筆，新補入 " +
      mapping.added +
      " 筆。";
    if (mapping.skipped || mapping.conflicts) {
      $("dataStatus").textContent +=
        " 略過 " + mapping.skipped + " 筆，衝突 " + mapping.conflicts + " 條。";
    }
  } else {
    $("dataStatus").textContent += "｜" + mapping.message;
    $("dataStatus").classList.add("warning");
  }
  updateVillages();
  $("resultStatus").textContent = "資料已載入，請輸入條件並按「搜尋垃圾車」。";
}

function updateVillages() {
  const district = $("district").value;
  const villageSelect = $("village");
  villageSelect.replaceChildren();

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "全部村里";
  villageSelect.appendChild(allOption);

  const villages = [
    ...new Set(
      truckData
        .filter((row) => row.searchDistrict === district)
        .map((row) => row.villageName)
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, "zh-Hant"));

  villages.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    villageSelect.appendChild(option);
  });

  villageSelect.disabled = !loaded || villages.length === 0;
  updateDayNotice();
}

function updateDayNotice() {
  const district = $("district").value;
  const type = $("dayType");
  const garbageOption = type.querySelector('option[value="garbage"]');
  const districtRows = truckData.filter(
    (row) => row.searchDistrict === district,
  );
  const available = districtRows.filter((row) => clean(row.garbageDay));
  if (!loaded) {
    garbageOption.disabled = true;
    return;
  }
  garbageOption.disabled = available.length === 0;
  if (garbageOption.disabled && type.value === "garbage")
    type.value = "recycle";
  if (!available.length) {
    $("filterNotice").textContent =
      "此區尚未提供一般垃圾清運日，暫時無法使用該日期篩選。資源回收日不可代替一般垃圾日。";
  } else if (available.length < districtRows.length) {
    $("filterNotice").textContent =
      "提醒：此區僅 " +
      available.length +
      " / " +
      districtRows.length +
      " 筆有一般垃圾日，星期查詢可能漏掉未補齊的站點。";
  } else {
    $("filterNotice").textContent = "";
  }
}

function searchTruck() {
  if (!loaded) return;

  const district = $("district").value;
  const village = $("village").value;
  const keyword = normalize($("keyword").value);
  const dayType = $("dayType").value;
  const weekday = $("weekday").value;
  const period = $("period").value;
  const sortOrder = $("sortOrder").value;

  currentMatches = GarbageData.search(truckData, {
    district,
    village,
    keyword,
    dayType,
    weekday,
    period,
    sortOrder,
  });

  visibleCount = 0;
  $("results").replaceChildren();
  $("resultStatus").textContent =
    "「" +
    district +
    "」找到 " +
    currentMatches.length.toLocaleString("zh-TW") +
    " 筆資料。";

  updateDayNotice();
  if (currentMatches.length === 0) {
    $("moreButton").hidden = true;
    $("resultStatus").textContent += " 請調整路名、村里、星期或時段。";
    return;
  }

  showMore();
}

function addDetail(parent, label, value) {
  const p = document.createElement("p");
  p.className = "detail";

  const strong = document.createElement("strong");
  strong.textContent = label + "：";
  p.appendChild(strong);
  p.appendChild(document.createTextNode(clean(value) || "未提供"));

  parent.appendChild(p);
}

function createResultCard(item) {
  const card = document.createElement("article");
  card.className = "card";

  const title = document.createElement("h3");
  title.textContent = clean(item["停留地點"]);
  card.appendChild(title);

  const details = document.createElement("div");
  details.className = "detail-grid";

  addDetail(details, "行政區", item.searchDistrict);
  addDetail(details, "停留時間", item["停留時間"]);
  addDetail(details, "村里", item.villageName);
  addDetail(details, "車次", item["車次"]);
  addDetail(details, "資源回收日", item.recycleDay);
  addDetail(details, "一般垃圾日", item.garbageDay);

  card.appendChild(details);

  if (
    ["taoyuan.csv", "maolin.csv", "namaxia.csv", "shanlin.csv"].includes(
      item.sourceFile,
    )
  ) {
    const source = document.createElement("div");
    source.className = "source";
    source.textContent = "註：此筆來自環境部路線資料整理版本。";
    card.appendChild(source);
  }

  return card;
}

function showMore() {
  const nextRows = currentMatches.slice(visibleCount, visibleCount + PAGE_SIZE);
  const fragment = document.createDocumentFragment();

  nextRows.forEach((row) => {
    fragment.appendChild(createResultCard(row));
  });
  $("results").appendChild(fragment);

  visibleCount += nextRows.length;
  $("moreButton").hidden = visibleCount >= currentMatches.length;
  $("moreButton").textContent =
    "顯示更多（剩下 " +
    (currentMatches.length - visibleCount).toLocaleString("zh-TW") +
    " 筆）";

  $("resultStatus").textContent =
    "找到 " +
    currentMatches.length.toLocaleString("zh-TW") +
    " 筆，已顯示 " +
    visibleCount.toLocaleString("zh-TW") +
    " 筆。";
}

function resetFilters() {
  $("keyword").value = "";
  $("village").value = "";
  $("dayType").value = "recycle";
  $("weekday").value = "";
  $("period").value = "";
  $("sortOrder").value = "asc";
  updateDayNotice();

  $("results").replaceChildren();
  $("moreButton").hidden = true;
  $("resultStatus").textContent =
    "已清除篩選條件。可輸入路名或直接按「搜尋垃圾車」。";
}

$("searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  searchTruck();
});
$("district").addEventListener("change", () => {
  updateVillages();
  resetFilters();
});
$("dayType").addEventListener("change", updateDayNotice);
$("weekday").addEventListener("change", updateDayNotice);
$("resetButton").addEventListener("click", resetFilters);
$("moreButton").addEventListener("click", showMore);

loadAllData();
