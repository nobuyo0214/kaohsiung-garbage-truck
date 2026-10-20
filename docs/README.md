`manual-review.md` 是教學來源，`official-evidence-investigation.md` 是本次調查報告來源；同名 `.html` 是 GitHub Pages 可直接開啟的同內容靜態版本。修改教學後，以 `marked@16.4.1` 轉換 Markdown，保留 HTML 的頁首、返回連結及 CSS 路徑，並將產生的 `<table>` 包在 `<div class="comparison">` 內供手機橫向捲動。產生頁面與原稿一同提交；Pages 不需要建置或安裝套件。沒有從網路載入的 HTML 或 Markdown 會在審核工作台直接執行。

```sh
npx --yes --package=marked@16.4.1 marked -i docs/manual-review.md -o work/manual-review-content.html
npx --yes --package=marked@16.4.1 marked -i docs/official-evidence-investigation.md -o work/investigation-content.html
```

表格不溢出手機頁面與審核畫面的 CSS MIME 型別由瀏覽器回歸測試檢查；本機預覽伺服器需以 `text/css` 提供樣式。
