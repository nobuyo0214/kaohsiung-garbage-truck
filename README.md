# 高雄市垃圾車查詢系統

以 GitHub Pages、HTML、JavaScript、Papa Parse 5.5.3 與 CSV 提供 38 個行政區的表定路線查詢。網站不需要後端或付費伺服器；不是即時垃圾車定位服務。

- `index.html`：行政區、村里、地點關鍵字、一般垃圾／資源回收星期、時段、時間排序與分頁。
- `official-day-matcher.html`：批次匯入、並排審核、保存進度並下載已確認日期提案。
- `route-organizer.html`：產生路線盤點與對照表；讀取失敗或日期衝突時停止對照表匯出。
- `garbage-day-review.html`：人工核實單一停靠紀錄；完整五欄必須唯一對應原始 CSV。

## 下一階段：官方匯入與審核工作台

本階段接續 PR #1 的最新分支 `af3666a`，保留使用者修好的 `ubuntu-24.04` Actions 設定。新增可重複的官方 HTML／CSV／JSON 匯入、來源與失敗記錄、人工建議分類、行政區／路線篩選、並排比較、確認／拒絕、依據記錄、本機保存與 JSON 進度備份。

操作與來源研究詳見 **[官方資料匯入與審核流程](docs/official-workflow.md)**。新版本的完整日期提案只加入已經人工確認且通過重新驗證的規則；精確候選也需要確認。

```sh
npm run import:official
npm run report:expansion
node scripts/serve.cjs
```

開啟 `http://127.0.0.1:4173/official-day-matcher.html`，可直接載入試辦證據。三民東區 110 筆、三民西區 327 筆、岡山區 66 筆，合計 503 筆（包含上階段三民西區 179 筆）；307 筆有審核建議、196 筆未找到建議。因車次／完整時間與來源可靠性尚未確認，安全精確新候選及新確認日期均為 **0**，全部保留待審核；三民東／西區剩餘路線仍有取得與核實缺口。

新報告在 `reports/expansion/`，原始來源及登錄表在 `data/sources/`。原始 39 份 CSV、38 區查詢與 243 條既有日期規則均保持。下方數字與三民西區報告為 PR #1 的基準紀錄，最新擴充統計以新流程文件與 `reports/expansion/summary.json` 為準。

## 已核實的版本與資料來源

本次檢查以 `main` 的 `068ed479e617baa73672b78bc02bad06c908065d` 為基準，查閱日期為 **2026-10-20（台北時間）**：

- 39 份路線 CSV、38 個行政區、13,871 筆有停留地點的紀錄。
- `garbage-days.csv` 有 **243 條**既有日期規則：三民東區 179、三民西區 63、杉林區 1。
- 39 份原始路線 CSV 及 `garbage-days.csv` 在本次變更中保持位元組不變。
- `sanmin-west.csv` 有三民區 550 筆、大寮區 212 筆，沒有空白地點或重複五欄識別。大寮區須依列內行政區分類，不能全部歸入三民區。

既有 CSV 主要是高雄市政府環境保護局開放資料及環境部路線整理版本。原始專案未保存全部 39 份檔案的逐檔下載網址與版本，**不補造來源網址**；日後更新應一併保存真實的資料集頁、資源網址、取得日期與雜湊。

本次實際查閱的來源：

| 來源 | 用途 |
| --- | --- |
| [高雄市三民西區垃圾清運路線及時間](https://data.gov.tw/dataset/106982) | 確認開放資料的提供機關與欄位；此資料只有回收日，不能推導一般垃圾日 |
| [環境部三民西區1](https://hwms.moenv.gov.tw/dispPageBox/route/routeCP.aspx?dbid=6851225449&ddsPageID=LINEINFO) | 官方路線 E80720020，48 筆 |
| [環境部三民西區4](https://hwms.moenv.gov.tw/dispPageBox/route/routeCP.aspx?dbid=5739844254&ddsPageID=LINEINFO) · [第二頁](https://hwms.moenv.gov.tw/dispPageBox/route/routeCP.aspx?dbid=5739844254&ddsPageID=LINEINFO&p=2) | E80720023，50＋19 筆 |
| [環境部三民西區6](https://hwms.moenv.gov.tw/dispPageBox/route/routeCP.aspx?dbid=6471148285&ddsPageID=LINEINFO) · [第二頁](https://hwms.moenv.gov.tw/dispPageBox/route/routeCP.aspx?dbid=6471148285&ddsPageID=LINEINFO&p=2) | E80720025，50＋12 筆；第二頁僅取得較舊快取，標示 `stale`，不得產生新增候選 |

`data/official/sanmin-west.csv` 保存以上三條路線的 179 筆一般垃圾欄位轉錄、官方識別、清運序、實際頁面網址及擷取說明。查閱日期不是官方更新日期，搜尋服務可能提供快取。責任區關聯沿用既有規則的官方來源關係；**不把官方路線名稱數字當作 CSV 車次**，未確認車次一律留白。這份資料是待審核的證據快照，不代表已確認 179 個 CSV 班次。

## 配對與日期保護

共用鍵為 **來源檔案＋責任區＋車次＋停留地點＋完整停留時間**。

1. 地點只做 Unicode NFKC 與首尾空白標準化，不刪除門牌、括號、巷弄或備註。
2. 時間只統一全半形、冒號空白及時段分隔符，例如 `16:19~16:22` 與 `16:19-16:22`。解析必須覆蓋整個欄位；`18:57-28:57` 等錯誤不截取為有效時間。
3. `16:19` 與 `16:19-16:22` 是 `time_extent_mismatch`，不是精確配對；不同起點或終點是 `time_mismatch`。不以時間接近程度、地點相似度或站序自動判定相同班次。
4. 只有五欄完整、原始紀錄唯一、明確的一般垃圾日與 HTTPS 政府來源才產生新增候選。網址驗證僅檢查格式與 `.gov.tw` 網域，不表示工具已下載並驗證頁面內容，維護者仍須核對證據。
5. 不使用資源回收日、廚餘日或每週清運頻率推算一般垃圾日。
6. 相同鍵的官方日期衝突、重複原始識別、與已確認日期衝突者全部交人工審核。既有對照表無效或有日期衝突時，完整提案匯出會停止。
7. 保留既有規則與原始 CSV 已確認日期；新增候選去重。搜尋不再使用起始時間、無時間站點或整路線回退配對。現有 243 條規則仍全部精確命中。

官方資料若只有到點時間，請尋找能明確證明 CSV 車次與完整時段的官方版本；**不能將 CSV 終點時間抄進官方時間欄來製造吻合**。若資料版本不同，先保留差異報告，另開有證據的原始資料修正 PR。

## 可重複的更新流程

### 在 GitHub Pages 操作

1. 從官方頁面或資料集轉錄／轉換一般垃圾資料為 UTF-8 CSV，至少具有以下表頭：

   ```csv
   來源檔案,責任區,車次,停留地點,停留時間,一般垃圾日,官方來源
   ```

   日期格式為 `一、二、四、五、六` 等明列星期。缺少證據的識別欄位留白；不得猜填。可附加 `官方路線序號`、`查閱日期`、`擷取說明` 等欄位；已知過舊的證據標示 `證據狀態=stale`。

2. 開啟 `official-day-matcher.html` 上傳 CSV。工具載入全部路線及現有規則；遇到缺檔、解析錯誤或缺欄會停止匯出，避免產生不完整的替換檔。
3. 下載 `review.csv` 核對缺車次、不同時間、無對應及日期衝突。顯示的 CSV 候選只是供審核參考，不是已確認配對。
4. 核對 `candidates.csv` 與官方欄位、版本，在工作台逐筆記錄確認依據。只有已確認且重新驗證成功的紀錄會加入完整提案；再以提案作為 `garbage-days.csv` 的更新內容。
5. 建立分支、執行測試並送 Pull Request，經人工審查後合併；工具不會自動修改 GitHub。

### 本機批次處理

需要 Node.js 22 以上；安裝的套件只供本機工具與測試使用，Pages 不需要建置。

```sh
npm ci --ignore-scripts
npm run audit
npm run reconcile:sanmin-west
# 其他行政區：同樣的表頭、同樣的安全規則
node scripts/data-tool.cjs reconcile --official path/to/official.csv --out work/review
# 本機預覽
node scripts/serve.cjs
```

開啟 `http://127.0.0.1:4173/`。網站需要 HTTP 預覽，不能依賴 `file://` 跨檔讀取。

| 輸出 | 內容 |
| --- | --- |
| `reports/data-audit.csv` | 全檔案空白、重複、缺識別、時間、行政區／座標異常，含 CSV 資料列位置 |
| `reports/audit-summary.json` | 規模、問題數及逐檔 SHA-256 |
| `reports/route-inventory.csv` | 依行政區＋來源＋責任區＋車次分組，保留大寮區 |
| `reports/sanmin-west/candidates.csv` | 完整精確配對的新候選；本次為空 |
| `reports/sanmin-west/review.csv` | 不能安全配對的官方紀錄與 CSV 候選、雙方時間、差異分類 |
| `reports/sanmin-west/outcomes.csv` | 每筆官方資料的處理結果，保留輸入附加欄位 |
| `reports/sanmin-west/raw-coverage.csv` | 該來源檔案所有 762 筆原始紀錄的既有日期與官方證據涵蓋情況，包含 212 筆大寮區；不在快照不等於不清運 |
| `reports/sanmin-west/garbage-days-proposed.csv` | 保留舊規則的完整提案，永遠不直接改寫根目錄日期表 |

常見審核狀態：`missing_identity` 缺五欄識別、`stale_evidence` 證據過舊、`invalid_time` 無效時間、`time_extent_mismatch` 到點／時段不一致、`time_mismatch` 時間不同、`no_match` 無對應、`ambiguous_raw` 重複原始識別、`official_conflict` 官方輸入日期衝突、`existing_conflict` 與既有規則衝突、`raw_conflict` 與原始已確認日期衝突。`already_confirmed` 不重複新增。

本次 179 筆官方轉錄中，167 筆缺少明確 CSV 車次、12 筆證據過舊，全部保留待審核，新增 **0** 條規則。三民西區的 63 條既有規則保持原狀；本次沒有將它們宣稱為已重新完成官方五欄查證。

## 稽核發現與已修正行為

- 找到南鳳山、彌陀、小港各 1 筆重複五欄識別；不自動刪除原始紀錄。
- 大樹檔案有 186 筆空白地點；維持排除空白地點的搜尋行為。
- 全部 CSV 有 22 筆無法完整解析的時間、16 筆缺識別、2 筆行政區欄位異常及 125 個座標欄位異常。這些是資料品質待辦，不憑空修正時間或地址；無法解析的時間仍可用地點搜尋，時間排序置底、時段篩選排除。
- 原搜尋只處理部分星期範圍；共用函式支援如「週二至週五」，並保留一般垃圾／回收日分離。
- 管理工具先前可能在原日期表讀取失敗後匯出不完整替換檔，或將衝突規則刪除後匯出；現在改為停止匯出。
- 盤點現在依行政區分組，避免三民區／大寮區相同責任區、車次混在一起。

稽核報告可能對同一列列出多項問題，問題筆數不等於待刪除站點數。報告只標示需查證的異常，不宣稱資料一定錯誤。

## 測試與 CI

```sh
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

已有系統 Chromium 時可指定執行路徑：

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
```

資料測試涵蓋 39 檔基準雜湊、243 條既有規則、38 區搜尋、村里／關鍵字／兩種星期／時段／排序、缺值、時間格式與差異、跨來源／責任區／車次隔離、官方衝突、原始重複、已確認日期保護與真實三民西區快照。瀏覽器測試使用實際 HTML 與所有 CSV，涵蓋 38 區、分頁、複合條件、缺檔降級及管理工具匯出。測試攔截 CDN 並使用本機固定版本 Papa Parse，不依賴政府網站即時可用性。

GitHub Actions 執行資料測試、稽核、快照比對與 Chromium 瀏覽器測試，並上傳審核報告。基準雜湊是本次保留原始資料的回歸檢查；日後有證據的資料更新需在 PR 中說明並同步更新 `test/fixtures/baseline.json`，不能為了讓測試通過而略過差異審查。

## 架構與擴充

- `js/route-files.js`：唯一的 39 份檔案清單，網站、盤點與 CLI 共用。
- `js/data-core.js`：不依賴 DOM 的正規化、五欄識別、驗證、日期套用、搜尋、批次比對與保留舊規則合併函式；同時支援瀏覽器與 Node.js。
- `js/official-day-matcher.js`：檔案載入、審核畫面、本機保存與下載。
- `js/review-core.js`：審核建議、補充證據、確認紀錄與提案驗證。
- `scripts/official-import.cjs`：來源取得、HTML／CSV／JSON 匯入與原始資料保存。
- `scripts/expansion-report.cjs`：可重跑試辦報告與責任區／車次缺口盤點。
- `scripts/data-tool.cjs`：CSV 解析、稽核與報告；解析錯誤立即失敗。
- `data/official/`：有來源的官方資料轉錄；`reports/`：可重跑的結果。

新增行政區資料轉換器時，先保留官方原始欄位與來源，再轉成共用表頭；缺少明確關係時輸出待核實資料。不要在搜尋頁加入每個行政區各自的模糊比對特例。新增來源檔案時更新共用清單、行政區選項與測試基準；現有 38 區應繼續通過回歸測試。
