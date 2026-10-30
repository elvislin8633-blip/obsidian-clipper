# Review 修正與驗證

日期：2026-09-11（Asia/Taipei）。基線：`cab9e12`，branch `agent/quick-md-to-obsidian`。

本次完成 2026-09-07 review 的五項修正。三個 Luna worker 分別負責 Queue、Capture UI 與 URI handoff；主代理負責 locale CLI、文件、整合檢查、production build 及隔離瀏覽器測試。變更保留在目前工作樹，未提交或推送。

## 已修正

| Review | 最終行為 |
| --- | --- |
| P1 URI handoff 假成功 | `saveToObsidian()` 等待 background 明確回覆 `success: true`。失敗或無效回覆傳回 UI；不使用 `window.open()` 自動重送，也不記錄含筆記內容的 URI。 |
| P1 Queue 同時寫入覆蓋 | Popup／side panel 的新增與清空都送至單一 background writer，依收到的順序串行執行；只有 storage 完成後才回覆成功。某次失敗不阻塞後續操作。沿用 `research_queue_v1`。 |
| P2 Daily Note 空白檔名 | Popup 保留編譯後的 noteName，空白以 `Untitled` 處理。Daily delivery 忽略名稱；Read Later／Knowledge 轉為 Inbox create 時保有文章名稱。 |
| P2 主動作與目的地不一致 | Research Capture 顯示「加入 Research Queue」。複製／下載偏好維持原主動作，預覽反映該主動作；secondary Capture 文案依用途顯示。其他 Obsidian 主動作保留原文案。新增英文與繁中翻譯。 |
| P2 字串檢查假成功 | 修正為 `src/_locales`，讀取／解析錯誤回傳 exit 1；unused 候選仍只作資訊性提示。 |

另補上 fork 的 README 使用入口與 `npm run verify`。Quick Clip 仍固定 Reference + None；既有 extraction、template、frontmatter、Router 與 adapter 邊界保留。

## 自動驗證

最終 `npm run verify` exit 0：

- Vitest：66 files，671 tests 通過。
- Locale CLI：3 tests 通過（正常、來源缺失、JSON 錯誤）。測試使用隔離 fixture，不移動實際翻譯檔。
- TypeScript：通過。
- Locale 掃描：368 strings，60 個 unused 候選；此掃描對動態 key 不完整，不能把候選當成可刪除清單，也不等同缺譯檢查。
- Chrome、Firefox、Safari production build：全部成功。每個 build 仍有 3 個 webpack bundle size/performance warnings。
- `git diff --check`：通過。

## 隔離 Chromium runtime

以已安裝的 Playwright 及 Chromium 149.0.7827.55 執行 `scripts/smoke-capture.cjs`。獨立臨時 profile，使用本機 HTTP 文章，沒有使用原有瀏覽器 profile、Queue 或 Obsidian vault。

通過項目：

1. 5 intents × 3 save behaviors，共 15 組主按鈕、secondary Capture 與目的地預覽。
2. append-daily／prepend-daily × read_later／knowledge，共 4 組傳送 `Inbox/Capture smoke article`。
3. URI handoff 回覆失敗時，編輯器顯示錯誤且按鈕恢復可用；每次只有一個 handoff 請求，沒有自動重送。
4. 真實 production popup 透過 Router 寫入一筆 Research record。
5. 兩個不同 extension pages 同時送出 20 筆 append；加上原有 1 筆，保留全部 21 個不同 record IDs。
6. Malformed record 被拒絕，後續合法 append 仍成功；clear 回覆完成後，實際 Queue 為空。

證據：

- [Runtime JSON（含 production bundle SHA-256）](../output/playwright/capture-smoke.json)
- [Research 操作畫面](../output/playwright/research-capture.png)
- [完整 verify log](../output/playwright/verify.log)

此 smoke 刻意攔截 OS handoff，沒有驗證 Obsidian 真實檔案落盤；Firefox／Safari 本次只有 production build，沒有 runtime 驗證。沒有執行新的乾淨安裝驗證。

## 使用與後續

Chrome 已產出最新 `dist/`；在擴充功能管理頁重新載入現有 unpacked extension，並重新開啟先前的 popup／side panel，確保使用新版前後端。不要以移除再安裝代替重新載入，以保留本機資料。

Research Queue 清單、搜尋、單筆整理與最近使用的 intent/project 屬下一階段產品改善，本次未擴增這些功能。
