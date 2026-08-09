# Knowledge Capture Router MVP Checkpoint

日期：2026-08-09
Branch：`agent/quick-md-to-obsidian`
MVP 實作前基線：`a556611`（`Customize default article clipping template`）

本文件是 Knowledge Capture Router MVP v2 的驗收與回溯紀錄，並與本次 checkpoint commit 一起保存。此次沒有使用 `git reset`、`git checkout`，也沒有 push 或修改 upstream。

## 1. Scope

本 checkpoint 驗證 Browser → Capture Router → Obsidian / Research Queue 的最小閉環：

- 保留官方 clipping、HTML parsing、Markdown conversion、template、metadata、highlight 與 Obsidian integration 的既有流程。
- 客製邏輯集中在 `src/capture/`，由 Router 負責 intent mapping、Inbox path、`capture_*` reserved metadata、Envelope 與 delivery boundary。
- 現有未提交 Quick Clip 變更已保留，並重構為共用 Payload preparation、Router 與 Obsidian adapter 的 `Reference + None` preset。
- 本 checkpoint 沒有新增 AI、NotebookLM、ChatGPT、MCP、RAG 或其他 AI adapter。

## 2. Architecture contract

| Contract | 驗收結果 |
| --- | --- |
| Payload / Context / Envelope 分離 | `CapturePayload` 只含 rendered note；`CaptureContext` 只含 source、intent、project context；Router 組裝 `CaptureEnvelope`。 |
| Router-owned reserved metadata | Router 使用既有 `generateFrontmatter()` 產生 canonical `capture_id`、`capture_intent`、`capture_project_id`、`capture_project_name`、`capture_destination`、`capture_captured_at`；與 template 同名時 canonical value 取代原值。 |
| Project identity | Capture record 使用 stable `projectId`；`projectName` 只作 display snapshot。實測 rename 前後使用同一個 ID，既有 note 保留舊 name snapshot。 |
| Intent mapping | `reference`、`read_later`、`knowledge`、`project_material` → `obsidian`；`research` → `research_queue`。Adapter 不自行判斷 intent。 |
| Inbox configuration | `CaptureSettings.inboxPath` 存於 `browser.storage.sync`，預設 `Inbox`；`read_later` 與 `knowledge` 由 Router 解析為 `create` 到該 path。 |
| Research Queue | Storage key 為 `research_queue_v1`，record 具有 `schemaVersion: 1`、`recordId === captureId`、`status: queued`；reader 對未知版本 fail closed，不靜默刪除。 |
| Delivery result / failure boundary | Adapter 只 delivery 並回傳 `RoutingResult`；Router 驗證 result。adapter、storage、quota 或 URI handoff failure 會 propagate，不回傳假成功；history/telemetry failure 不觸發第二次 delivery。 |
| Quick Clip | 固定 `Reference + None`，與完整 Capture form 共用 final payload preparation、Router 與 Obsidian delivery；不取代 action icon。 |

## 3. Runtime acceptance

環境：Chrome production build 手動 Load unpacked，extension ID `hjconabmofgmggmlpjlcdnignmhjemma`；Obsidian vault `KnowledgeOS`。

| Flow | 實測結果 | Evidence |
| --- | --- | --- |
| Quick Clip（Reference + None） | 成功寫入 Obsidian，使用現有 template path `Clippings/Articles`，保留 `capture_intent: reference` 與 `capture_destination: obsidian`。 | `Clippings/Articles/Example Domain.md` |
| Read Later | 成功建立新 note 到設定的 `Inbox`，而非 template 原 path；frontmatter 為 `read_later`。 | `Inbox/Example Domains.md` |
| Knowledge | 成功建立新 note 到 `Inbox`，frontmatter 保留 `knowledge` intent。 | `Inbox/IANA-managed Reserved Domains.md` |
| Project Material | 成功使用 template path，並寫入 stable project ID 與當時 name snapshot。 | `Clippings/Articles/Time Zones.md` |
| Project rename | rename 後的新 capture 使用同一個 `project-a094d1cf-90e9-47a1-8e6c-86693a4c35e9`，但取得新 name snapshot；舊 note 沒被改寫。 | `Time Zones.md`：`Router Runtime Project`; `Protocol Registries.md`：`Router Runtime Project Renamed` |
| Research | 成功只寫入 local Research Queue，沒有寫入 Obsidian；Settings 顯示 `Pending captures: 1`，JSON export 通過 v1 schema 檢查。 | `/Users/elvis/Downloads/research-queue.json` |
| Queue controls | Settings 已驗證 pending count、JSON export、confirmation-gated clear controls 可見；本次保留 1 筆 pending record 作為後續追溯證據，沒有清除。 | Extension Settings UI |

Research Queue export 的現場檢查結果：

```text
schemaVersion: 1
status: queued
destination: research_queue
recordId === context.captureId === metadata.capture_id
context.intent: research
PASS
```

## 4. Automated gates

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | PASS |
| Full test suite | `TZ=America/Los_Angeles npm test -- --run` | PASS — 63 test files, 627 tests |
| Production builds | `npm run build` | PASS — Chrome, Firefox, Safari zip 均產生 |
| Patch whitespace | `git diff --check` | PASS |
| Direct dependency | `npm ls terser-webpack-plugin --depth=0` | PASS — `terser-webpack-plugin@5.6.1` |

Build 只有 webpack asset/entrypoint size warnings，沒有 compilation error。Chrome、Firefox、Safari 在本 checkpoint 完成 production build；手動 UI runtime 只在 Chrome 驗證。

## 5. Test coverage added

- Router intent mapping、Inbox resolution、reserved metadata reservation、invalid adapter result 與 adapter failure propagation。
- Research Queue record schema、unsupported version、storage failure、append/clear。
- Research Queue adapter delivery result 與 writer failure propagation。
- Background Obsidian URI/clipboard delivery 與 handoff failure propagation。
- Quick Clip preset 的 template compilation、frontmatter/body preparation、Router call、history boundary 與 extraction failure。

## 6. Known boundaries

- 本 checkpoint 不包含 Firefox/Safari 的手動瀏覽器 UI smoke test；兩者已完成 production compilation。
- `npm run check-strings` 沒有列為 passing gate：目前 script 仍指向 `src/locales`，repo 實際 locale 路徑是 `src/_locales`，因此不能把該 script 的結果誤記為 clean。
- 測試用 Obsidian notes、已加入的 project setting 與 1 筆 Research Queue record 是外部 runtime evidence，不屬於 repo commit；可依上表重現或清理。
- 目前仍只保留 MVP routing destinations：Obsidian 與 local Research Queue；沒有建立第三方或 AI destination。

## 7. Reproducibility

從本 checkpoint commit 後，可以用以下指令重新驗證主要 gates：

```bash
TZ=America/Los_Angeles npm test -- --run
npx tsc --noEmit
npm run build
git diff --check
```

下一個產品決策點是觀察實際使用中「Intent + Project + routing」是否比單純 Save to Obsidian 有價值；在此之前不擴張 AI、NotebookLM 或 MCP 功能。
