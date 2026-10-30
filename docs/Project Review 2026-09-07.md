# Project review：讓日常擷取更可靠、更順手

日期：2026-09-07。審查基線：`cab9e12`，branch `agent/quick-md-to-obsidian`，開始時 working tree 乾淨。

將使用者的「更 handful」暫解讀為更順手、容易使用與維護。本次聚焦客製 Quick Clip、Capture Router、popup、Research Queue、設定與驗證流程；不是完整上游安全審計或瀏覽器視覺 UX 審查。

## 結論

現有 extraction → template/frontmatter → Router → adapter 分層值得保留。最優先是修正資料遺失與成功回報，再讓使用者看得懂儲存目的地、找得到已收集內容。Research Queue 目前仍是「收集並匯出」的 MVP，缺少日常整理入口。

## Findings

### 1. [P1] Popup 的 URI handoff 失敗不會傳回 Router

位置：`src/utils/obsidian-note-creator.ts:17-24`；呼叫鏈為 `create-router.ts` → `ObsidianAdapter.deliver()` → `saveToObsidian()`。

`openObsidianUrl()` 回傳 void，未等待 `runtime.sendMessage()`，也未檢查回覆的 `success`。Background 在 tabs query/update 失敗時會正常 resolve `{ success: false, error }`，此情況連 `.catch()` 都不會執行。Adapter 因此仍回報 delivered，popup 顯示成功、記錄 history 並可能關閉。

隔離重現：設定 legacyMode，mock `runtime.sendMessage()` 回覆 `{ success: false, error: 'No active tab found' }`，呼叫真實 `saveToObsidian()`，結果仍 resolve undefined。非 legacy 路徑也呼叫同一個未等待的 helper。

修正方向：helper 回傳並等待 Promise，檢查明確失敗回覆，讓錯誤傳回 Router/UI。若保留 fallback，必須處理其失敗，避免無法確認結果時自動重送。瀏覽器接受 URI handoff 仍不等同 Obsidian 確認檔案已落盤；成功文案應符合可觀測的證據。

驗收：background 回覆失敗或 message rejection 時顯示錯誤，不顯示成功、不增加成功紀錄；成功 handoff 不重送。

### 2. [P1] Research Queue 同時寫入會遺失資料

位置：`src/capture/queue-storage.ts:87-93`。

Append 先讀整個 array，再寫回整個 array。兩個 popup／side panel 同時擷取時，兩邊可能讀到相同舊值，後寫入者覆蓋另一筆；兩次操作仍都成功。Clear 與 append 也沒有共同的協調機制。

隔離重現：mock storage.get 回傳資料快照，storage.set 更新儲存物件；`await Promise.all([appendResearchQueue(A), appendResearchQueue(B)])` 兩次均 resolve，但 readResearchQueue 只有 1 筆。現有測試只涵蓋單次 append。

修正方向：建立跨 extension context 的單一寫入入口，序列化 append/clear，或改為支援 transaction 的儲存。單一 popup 模組中的 Promise lock 無法協調其他 popup。保留 v1 資料相容性與失敗傳遞。

驗收：同時新增 N 筆保留 N 筆；append/clear 的順序可定義且可重現；儲存失敗不回報成功。

### 3. [P2] Daily Note 模板切到 Inbox intent 會產生空白檔名

位置：`src/core/popup.ts:1498-1500`、`src/capture/router.ts:66-72`。

Popup 依原模板的 append-daily/prepend-daily 行為把 noteName 清空。Router 對 read_later/knowledge 改為 `create` 與 Inbox 路徑，卻保留空白 noteName。Save helper 因此組出 `obsidian://new?file=Inbox%2F...`，遺失文章名稱。實際 Obsidian 如何處理此 URI 本次未實測。

隔離重現：將 popup 在 daily 模板產生的空白 noteName payload 送入真實 Router，使用 read_later context；save spy 收到 `('', 'Inbox', '', 'create')` 作為檔名、路徑、vault、behavior。

修正方向：保留已編譯的文章名稱，讓最終 daily delivery 決定是否忽略；Router 改為 create 時仍有有效名稱，必要時使用既有命名 fallback。

驗收：append-daily/prepend-daily × read_later/knowledge 都以有效文章名稱建立 Inbox 筆記，reference 仍維持 daily 行為。

### 4. [P2] Research 的目的地預覽與主按鈕行為不一致

位置：`src/core/popup.ts:611-620`、`src/core/popup.ts:1425-1455`。

選 Research 後預覽顯示 Research Queue，但預設主按鈕仍標示「Add to Obsidian」，實際執行卻加入 Queue。若偏好為 copyToClipboard/saveFile，主按鈕直接呼叫原有動作，完全不經 Router；預覽仍顯示 Queue。使用者無法從目的地預覽判斷此次主動作會做什麼。

這是控制流程的靜態證據，尚未操作瀏覽器確認呈現。

修正方向：讓 Capture 主動作依 intent 顯示「加入研究佇列」或「儲存至 Obsidian」，並清楚區分 copy/download 動作與其目的地。若需保留既有主按鈕偏好，應明確標示 routing 預覽僅適用於 Capture，不可無提示改寫偏好。

驗收：5 種 intent × 3 種 saveBehavior 的文案、預覽、實際動作一致；copy/download 偏好不被靜默改寫。

### 5. [P2] Locale 檢查出錯卻回報 exit 0

位置：`scripts/check-unused-strings.ts:80`、`scripts/check-unused-strings.ts:113-115`。

`npm run check-strings` 讀取不存在的 `src/locales/en/messages.json`，實際目錄為 `src/_locales`。Catch 只 log，命令 exit 0，無法作為品質檢查 gate。本次已直接重現。

修正方向：修正路徑，讀取或解析錯誤設定非零 exit code。此工具定位是 unused string 檢查，不能因能執行就聲稱涵蓋缺譯、動態 key 或所有 locale 完整性。

驗收：正常檔案可完成掃描；缺少來源檔或無效 JSON 必須非零退出；分開定義 missing key 檢查。

## 讓產品更順手的改善順序

以下是待實作建議，不是既有需求已批准或功能已完成。

1. **可靠儲存**：先修 Findings 1–3，再修主動作一致性和 locale gate。使用者要能相信每次操作的結果。
2. **顯示實際目的地**：使用同一份 routing resolution 顯示 vault、Inbox／template path 和 Queue，避免 UI 再實作一套規則。失敗時保留內容並提供具體下一步。
3. **Research Queue 管理入口**：目前 `src/managers/capture-settings.ts` 與 settings.html 只提供 count、JSON export、確認後全部清空。先加標題／來源／日期／專案清單、搜尋及單筆操作，保留 JSON 匯出。跨目的地轉存與新狀態需要另定成功邊界及 schema，不能直接把 queued 解讀為已處理。
4. **縮短重複操作**：完整 Capture 可考慮記住上次 intent/project，或提供最近使用；需決定是否跨網站沿用。Quick Clip 維持既有 Reference + None 契約。
5. **可交接的開發入口**：README 開頭補上本 fork 的功能、快捷鍵、Inbox、Queue 與本機安裝方式。現在開頭引導安裝官方商店版，沒有說明本 fork 的新增流程。增加單一 verify 指令並串接測試、typecheck、locale 和目標瀏覽器 build；乾淨安裝及跨瀏覽器 runtime 另列驗收。

## 本次驗證與限制

- `npm test -- --run`：63 files、627 tests 通過；vitest.config.ts 已固定 fixture 時區。
- `npx --no-install tsc --noEmit`：通過。
- 暫時隔離 probe：3 個測試均成功確認上述不良行為存在，並非修正後 regression test 通過。Probe 已移除，正式來源與測試未改動。
- `npm run check-strings`：ENOENT，但 exit 0；不得視為通過。
- 本次沒有重建 extension、執行 npm ci 或進行新的 Chrome／Obsidian／Firefox／Safari runtime 驗證。2026-08-09 checkpoint 的 runtime 結果是歷史證據。
- 本次交付僅此 review 文件，未修改產品程式碼、使用者 Queue、設定或 Obsidian 筆記。
