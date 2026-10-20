# 高雄市垃圾車查詢系統

以 GitHub Pages、HTML、JavaScript、Papa Parse 5.5.3 與 CSV 提供 38 個行政區的表定路線查詢。網站不需要後端或付費伺服器；不是即時垃圾車定位服務。

- `index.html`：行政區、村里、地點關鍵字、一般垃圾／資源回收星期、時段、時間排序與分頁。
- `official-day-matcher.html`：逐筆並排審核官方資料與 CSV 候選、接受／拒絕、保存／恢復進度；完整官方證據與人工確認後才產生日期提案。
- `route-organizer.html`：產生路線盤點與對照表；讀取失敗或日期衝突時停止對照表匯出。
- `garbage-day-review.html`：人工核實單一停靠紀錄；完整五欄必須唯一對應原始 CSV。

## 已核實的版本與資料來源

本階段以 `main` 的 `dcee2f3`（PR #4 已合併）為基底。原179筆快照查閱日期為2026-10-20，本次官方證據調查日期為 **2026-10-21（台北時間）**，皆不是官方更新日期：

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

### 本次官方證據調查與批次審核

已交叉核對使用者的CSV與v3 JSON進度：已接受4／拒絕0／待處理175，本次日期確認0／仍待查179，原243條日期不變。實際讀取五頁環境部路線文字並與179筆快照比較，未取得CSV車次對照與官方離站時間；12筆stale維持待查。CSV／JSON官方下載本文無法取得，不把資料集欄位說明冒充新版資料查證。

[完整調查、來源與下一步](docs/official-evidence-investigation.md) · [逐筆缺口與四筆調查報告](reports/sanmin-west-evidence/)。

工作台新增整條官方路線／清運序比較、唯一同地點同到點候選勾選、批次預覽與接受、保存後可撤銷的批次歷程。批次只寫候選建議，與官方證據、日期確認完全分離；不覆蓋已接受、已拒絕及已確認日期的個別決策。舊版v3 JSON直接相容，不必重新處理4筆。詳細教學包含每個步驟與統計定義。

```sh
npm run investigate:sanmin-west -- --progress path/to/official-review-progress.json --review path/to/review-all.csv
```

重現本次4筆已接受狀態需要原上傳檔；不帶進度則產生未處理的調查。新調查資料在 `data/investigations/`，只供研究與報告，不可匯入為verified日期證據。

### 在 GitHub Pages 操作

請先閱讀 [完整人工審核操作教學](docs/manual-review.md)，包含179筆分析、四筆優先候選、每個按鈕、進度備份、補充證據格式與官方來源限制。

1. 開啟 `official-day-matcher.html`，按「載入三民西區179筆」；其他行政區可展開上傳官方CSV。
2. 依行政區、官方路線、優先順序篩選，逐筆比較官方與CSV候選；填理由後接受建議、拒絕或改為待查。**接受候選不會新增日期。**
3. 操作後自動保存至本機；下次按「恢復本機進度」，換裝置則下載／匯入JSON進度備份。
4. 取得官方明確的完整五欄及一般垃圾日後，使用該筆的補充證據空白表記錄來源、查證日期與依據，匯入並人工確認。沒有完整證據時，確認按鈕維持停用。
5. 下載全部審核清單、系統建議候選與完整日期提案，通過測試並送PR。匯出重新讀取最新日期表及全部路線，保留既有規則、阻擋衝突；不會自動修改GitHub。

本次179筆分組：到點一致且無既有規則4筆、到點一致且已有規則63筆、同地點時間不同40筆、無相同地點60筆、舊證據12筆。共136組系統建議，**充分證據自動確認0筆、新增日期0條，179筆繼續保留待查**。12筆舊證據也都缺少車次。逐筆原因與候選見 [完整報告](reports/sanmin-west-ranked/review-all.csv)、[優先4筆](reports/sanmin-west-ranked/priority-first.csv)、[雙方差異](reports/sanmin-west-ranked/candidate-comparison.csv) 和 [計數與雜湊](reports/sanmin-west-ranked/summary.json)。

### 本機批次處理

需要 Node.js 22 以上；安裝的套件只供本機工具與測試使用，Pages 不需要建置。

```sh
npm ci --ignore-scripts
npm run audit
npm run reconcile:sanmin-west
npm run review:sanmin-west # 逐筆原因、排序與候選比較報告
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
- `js/review-core.js`：參考PR #2重新整合的候選查找、完整證據驗證、人工日期決策及提案重新驗證；不參與正式搜尋的模糊配對。
- `js/review-batch.js`：分組與順序比較、候選批次預覽／接受／撤銷、進度統計與相容v3的可選歷程；不修改日期決策。
- `js/review-batch-ui.js`：批次審核DOM介面。
- `scripts/evidence-report.cjs`：核對上傳CSV與JSON、官方頁面文字觀察、逐筆缺口與保留舊規則的提案。
- `js/review-triage.js`：原因與優先排序、候選接受／拒絕、版本3進度格式及報告；候選紀錄與日期確認分離。
- `js/official-day-matcher.js`：檔案載入、逐筆畫面、localStorage／JSON進度保存及下載。
- `scripts/review-report.cjs`：與介面共用分析核心，重跑179筆完整比較及雜湊摘要。
- `scripts/data-tool.cjs`：CSV 解析、稽核與報告；解析錯誤立即失敗。
- `data/official/`：有來源的官方資料轉錄；`reports/`：可重跑的結果。

新增行政區資料轉換器時，先保留官方原始欄位與來源，再轉成共用表頭；缺少明確關係時輸出待核實資料。不要在搜尋頁加入每個行政區各自的模糊比對特例。新增來源檔案時更新共用清單、行政區選項與測試基準；現有 38 區應繼續通過回歸測試。

人工審核回歸測試另涵蓋179筆分組、候選與正式日期隔離、舊證據／衝突阻擋、進度恢復與變更後重審、逐候選拒絕、最新正式檔讀取失敗停止匯出，以及手機版與純文字安全呈現。Actions保留原 `ubuntu-24.04` 設定。
