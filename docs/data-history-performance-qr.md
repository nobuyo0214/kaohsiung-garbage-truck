# 資料版本、效能與站點 QR Code（PR #12）

本次從已合併PR #11的main `3ddaac4d184a17f64ccd18160af712d891dec3f8`開發；不改原始CSV、歷史日期、座標政策或站點識別。民眾頁面仍只顯示已知資源回收日，非即時車輛定位。

## 查看資料版本

1. 在結果下方展開「資料版本與更新紀錄」。平常收合，不影響搜尋。
2. 「網站程式版本」是介面檔案內容指紋；「程式版本建置紀錄」是本站生成該版本的時間，以台灣時間顯示。這不是正式部署時間，也不是官方資料日期。最近一次程式提交／實際Pages部署時間未獨立確認，因此明示未確認，不拿目前日期替代。
3. 「GitHub Pages部署識別」標示目前頁面介面內容版本；同一套程式部署多次仍相同。原始碼入口及建置時基底commit另列。建置基底不是尚未產生的最終合併commit，也不表示已部署到正式站。
4. 本頁已載入行政區／有效紀錄是實際記憶體資料；版本收錄數量是快照的規模。缺檔時兩者不混稱完整。
5. 路線版本是解析後內容指紋；官方資料發布日期保持「官方資料發布日期未確認」。原始匯入日期、本次載入時間仍見「資料來源與更新說明」，彼此分開。
6. 展開內層「查看資料變更紀錄」，可看基準、後續變動及無法確定的差異。載入失敗或版本不合會明確提示，可收合再展開重試；不影響站點查詢。

首頁只在需要時以`no-store`讀`data/history/index.json`，比對其中最新路線位元指紋與已驗證的`data/site-metadata.json`路線雜湊。3.1MB的逐筆基準快照不在首頁下載，也不進Service Worker快取。版本說明不宣稱缺漏資訊已核實。

## 三種版本與時間

| 欄位 | 產生方式 | 意義 |
|---|---|---|
| `js/site-version.js: version` | 介面資源路徑固定排序，各檔SHA-256，再對UTF-8 JSON做SHA-256；排除版本檔自身 | 程式內容版本，與路線資料分離 |
| `buildRecordedAt`／`baseCommit` | 介面內容變更時建立，重建相同內容保留原值 | 本站建置紀錄／當時Git基底；非實際部署或官方資料時間 |
| `data/site-metadata.json: dataRevision` | 沿用既有40份CSV＋區界雜湊及驗證 | 當次安全載入的一組資料檔版本；本次不改此格式 |
| `data/history: byteRevision` | 39份路線檔名固定排序＋原檔SHA-256清單 | 路線檔案位元版本；不含歷史日期表、圖資、私人設定 |
| `data/history: contentRevision` | 排序後的來源檔、欄位名稱、逐筆原始欄位值及完整識別 | 站點來源內容版本；同資料重排、欄位重排或外層CSV換行改變時不變 |
| `recordedAt` | 基準建立／偵測檔案差異時記錄 | 本站紀錄時間；不是官方發布日期或實際更動發生時間 |
| `officialPublishedAt` | 本次全部為`null` | 沒有可靠官方發布證據，維持未確認 |

排序採字串碼元順序而非受作業系統語系影響的locale排序；雜湊編碼為UTF-8。保留所有原始欄位值，包括來源序號及空白地點的原始列。原始欄位內容改變仍是內容差異；CSV實體列號不作識別。有效紀錄數仍按現有核心的「非空白停留地點」計算，不因缺識別而少算。

## 變更比對與歷史基準

本PR先建立目前路線版本的基準。Git中有舊CSV提交，但本次沒有逐版核實並回填歷史，也沒有完整原始下載版本；介面清楚標示「從基準開始追蹤」，不捏造過去更新或把Git提交日期當成官方日期。

- 使用既有`SearchTools.stopId`六欄：來源CSV、行政區、責任區、車次、停留地點、完整時間。責任區或車次缺漏、時間無效、空白地點等無完整識別者，差異列為待確認。
- 先抵銷完全相同的原始列；相同完整識別在新舊快照各唯一時，其他來源欄位改變計為「修改」。不因地點相近、時間接近或列號相同而認作同一站。
- 識別中的地點／車次／時間改變，計為舊識別刪除＋新識別新增，不猜測是修改；這是統計定義，沒有改動任何正式資料。
- 完整識別重複或缺漏的差異列入`uncertainBefore/uncertainAfter`，不捏造精確新增／刪除／修改。完全一致的重複列可抵銷，尚餘的差異仍保守處理。
- 每份快照以位元版本命名，保留舊快照。僅程式更新不追加資料紀錄；格式變動可新增「只有位元變更、站點內容未變」紀錄。

靜態格式：

```text
data/history/index.json
  version: 1
  note: 從基準開始追蹤的說明
  entries[]:
    kind: baseline | change
    recordedAt, byteRevision, contentRevision, counts
    snapshot: <byteRevision>.json
    officialPublishedAt: null
    sourceNote
    difference: null（基準）或
      fileBytesChanged, stationContentChanged
      byDistrict[]: district, added, removed, modified, uncertainBefore, uncertainAfter
      totals: 上述各項加總

data/history/<byteRevision>.json
  version: 1, byteRevision, contentRevision, counts
  files[]: name, district, byteHash, fields[], records[]
  records[] = [完整識別或null, 行政區, 依fields排列的原始欄位值陣列]
```

日後更新流程：

1. 另開有來源證據的資料更新PR，保留原始下載版本、來源與查證依據；本PR不更新資料。
2. 更新後執行`npm run build:site`，產生新快照與差異紀錄，再執行資料及座標稽核。
3. 人工檢查新增／刪除／修改與不確定差異，不能直接依差異統計確認官方資訊。來源說明若有新增，提供真實可查證的網址；工具不推測官方日期或PR連結。
4. 連同新快照、index、資料雜湊及必要產物提交PR。依專案原流程更新有證據的測試基準，不略過雜湊檢查。
5. 重跑同一份資料不新增事件；`node scripts/build-site.cjs --check`只檢查，不修改來源或生成時間。

## 效能優化與重現

[完整前後報告](../reports/performance/README.md)列出冷／暖快取各5次的中位數與範圍、環境、所有原始樣本、CSV解析、索引、渲染、搜尋、附近、時間軸、傳輸及近似heap。

實際改動限於快取回收星期解析與時間解析、避免時間軸重排已排序資料。保留6工人CSV載入、既有檔案快取、資料驗證、全市索引、30筆顯示、附近索引和完整座標稽核。初始可操作時間未改善，冷載入略慢且傳輸增加；不宣稱所有項目都變快。CSV解析與附近掃描未改程式，數字變化視為環境變動。

```bash
npm ci
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run measure:performance -- reports/performance/rerun.json
```

測試以正確性回歸及獨立量測分開，不設不穩定的CI毫秒門檻。未加遙測，不取得真實使用者定位作量測。

## 產生與下載站點 QR Code

1. 查到停靠站後，點卡片「QR Code」（與原本「分享站點」並列）。原Web Share／複製分享操作維持不變。
2. 對話框顯示行政區、正式地點、表定時間及站點網址；掃描圖案即開啟既有分享站點。
3. 點「複製站點網址」可傳給家人。剪貼簿受限時，會選取完整網址，可手動複製。
4. 點「下載 QR Code PNG」儲存黑白圖片；四個模組的白邊不能裁掉，印刷或縮放時保留留白。檔名`kaohsiung-stop-<8位安全雜湊>.png`，不使用原始輸入當檔名。
5. Escape或「關閉」可返回原QR按鈕；Tab／Shift+Tab維持在對話框內。大字模式共用同一個介面。

QR內容固定為正式HTTPS專案網址＋原`#stop=1.<base64url>`完整識別，沒有新ID格式；本機預覽時QR也指向正式站。只對既有可唯一分享的站點啟用。沒有定位、收藏自訂名稱、私人備註、最近搜尋或固定日期。資料未合併到正式站前，正式站掃描仍使用目前正式資料；這次原始資料未改，所以既有識別相容。

編碼器為本機固定`qrcode-generator 2.0.4`，不呼叫第三方API、不使用CDN；首次點擊才載入／執行，PWA依既有策略預先驗證快取介面資源。Byte mode、M級錯誤修正、自動版本、每模組6px、四模組白邊。保守限制URL為2,000 UTF-8 bytes；超過容量、編碼器／Canvas失敗時明示錯誤並保留原連結，不產生假圖案。獨立`jsQR 1.4.0`只供測試解碼，不傳給訪客。測試也從下載的PNG重新取像素解碼，逐字核對同一網址。

[程式來源、固定版本、SHA-256、MIT／Apache-2.0授權與檢查說明](../js/vendor/QR-CODE-NOTICE.md)。這是有限的程式檢視與回歸測試，非正式安全認證。

## 手機與電腦畫面

以下為Playwright Chromium模擬截圖，**未宣稱實體手機驗證**；資料是真實既有CSV，無即時車輛資訊。各尺寸及大字模式另有自動回歸測試。

| 畫面 | 截圖 |
|---|---|
| 資料版本資訊（1280px） | [電腦版](screenshots/version-desktop.png) |
| 資料更新紀錄（390px） | [手機版](screenshots/history-mobile.png) |
| QR Code（1280px） | [電腦版](screenshots/qr-desktop.png) |
| QR Code（390px） | [手機版](screenshots/qr-mobile.png) |
| QR Code大字模式（320px） | [大字模式](screenshots/qr-large-320.png) |
| 優化後首頁（390px） | [首頁](screenshots/pr12-home-mobile.png) |

## 修改檔案與驗證

- `scripts/data-history.cjs`、`data/history/`：路線快照及保守差異。
- `scripts/site-version.cjs`、`js/site-version.js`、`js/version-ui.js`：建置版本與展開資訊。
- `js/search-tools.js`、`js/journey-core.js`：星期／時間解析重用，語意不變。
- `js/stop-qr.js`、`js/qr-ui.js`、`js/vendor/qrcode-generator-*`、`QR-CODE-NOTICE.md`：本機QR與來源／授權。
- `index.html`、`css/search.css`、`js/convenience-ui.js`：整合既有卡片及資訊區。
- `scripts/performance.cjs`、`reports/performance/`：可重現量測及原始樣本。
- `scripts/build-site.cjs`、`sw.js`：依原流程生成25個介面資源快取版本；CSV、圖資、版本JSON及快照仍不快取。
- `package.json`、`package-lock.json`：獨立測試解碼器dev dependency及量測指令；無大型前端依賴。
- `test/data-history.test.cjs`、`performance-regression.test.cjs`、`qr.test.cjs`、`version-qr.spec.cjs`、`map-search.spec.cjs`及`pwa.spec.cjs`：版本／搜尋一致性／獨立解碼／手機／子目錄／PWA回歸。
- `README.md`及本文件、截圖：操作與限制。

必跑：

```bash
npm ci
npm test
npm run test:browser
npm run audit
npm run reconcile:sanmin-west
npm run audit:locations
node scripts/build-site.cjs --check
git diff --check
```

已有系統Chromium可用`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`；否則先`npx playwright install --with-deps chromium`。GitHub Actions維持ubuntu-24.04及Node22。

本機Node測試79/79；Playwright 95/95（含新增QR鍵盤順序回歸；完整結果亦列入PR）。40份CSV（39份原始路線＋日期表）逐檔與main位元一致，38區、13,871筆有效來源、243條歷史規則、9,022筆可導航／4,849筆待確認保留。附近／時間軸、全市／單區、收藏v1/v2、分享、回報、PR #9只顯示回收日等原測試持續執行。95個瀏覽器測試含真實Service Worker更新／離線、GitHub Pages子目錄、320／390／768／1280px及一般／大字模式；沒有政府網站即時可用性相依。

## 已知限制

- 官方資料發布日期、原始匯入版本及實際部署時間未獨立確認，不冒充已知。程式與資料版本是內容指紋，不能證明官方資料仍有效。
- 只從本次基準起累積；沒有回填舊更新事件。完整時間／地點識別變更採新增＋刪除，無法唯一對照的修改留為不確定差異。
- 首次可操作速度沒有改善；新增介面略增傳輸，PWA安裝需驗證更多介面檔。記憶體近似量測受GC影響，不能宣稱已改善。
- QR網址越長圖案越密，實際掃描也受相機、印刷與光線影響。已驗證獨立軟體解碼，未實測所有手機相機。
- 離線只有介面與收藏備份；版本紀錄及清運資料必須重新連線取得，沒有新增資料持久快取。
- 正式Pages部署必須等使用者審核合併。本PR只模擬驗證子目錄及PWA更新，沒有自行部署或合併。
