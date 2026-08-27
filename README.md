# Obsidian Zotero Vault Bridge

繁體中文 | [English](README.en.md)

讓 PDF 實體檔留在 Obsidian Vault，由 Zotero 10 建立 linked attachment、執行原生 metadata recognition 並保存 citation key，再由 Obsidian 建立 Literature Note 與完成 Pandoc citation。

目前已完成四個可安裝里程碑，包括完整的可靠性與發佈硬化：

```text
01_Papers/*.pdf
        ↓
Obsidian Zotero Vault Bridge
        ↓ localhost + pairing token
Zotero Vault Bridge Companion
        ↓
linked attachment → Zotero native recognition → citation key
        ↓
02_Literature/<citationKey>.md
        ↓
Markdown editor: [@ → Zotero search → [@citationKey]
```

## 需求

- Zotero `10.0.x`
- Obsidian Desktop `1.8.0` 以上
- Node.js 20 以上（只在建置時需要）
- Zotero 與 Obsidian 必須在同一台電腦執行

Companion 使用 Zotero 的內部 JavaScript API，因此 manifest 暫時限制為已驗證的 `10.0.*`。

## 下載

[GitHub Releases](https://github.com/chengcheng-cx/obsidian-zotero-vault-bridge/releases/latest) 提供可直接安裝的 Obsidian ZIP、Zotero XPI、`updates.json` 與 `SHA256SUMS.txt`。不需修改程式碼時，優先使用 release；自行建置主要供開發與驗證使用。

## 建置

```powershell
cd obsidian-zotero-vault-bridge
npm install
npm run check
npm run build
```

建置輸出：

- Obsidian：`obsidian-plugin/main.js`、`manifest.json`、`styles.css`
- Zotero：`zotero-companion/dist/zotero-vault-bridge-companion-0.4.0.xpi`
- 完整 release：`dist/release/`（Obsidian ZIP、XPI、`updates.json`、SHA-256）

## 安裝 Zotero Companion

1. 開啟 Zotero。
2. 選擇 `Tools → Plugins`。
3. 齒輪選單選擇 `Install Plugin From File…`。
4. 選擇建置出的 `.xpi`。
5. 重新啟動 Zotero。

## 安裝 Obsidian Plugin

在測試 Vault 建立：

```text
<vault>/.obsidian/plugins/zotero-vault-bridge/
```

將以下三個檔案複製進去：

```text
obsidian-plugin/main.js
obsidian-plugin/manifest.json
obsidian-plugin/styles.css
```

重新載入 Obsidian，然後在 `Settings → Community plugins` 啟用 `Zotero Vault Bridge`。

## 第一次使用

1. 確認 Zotero 正在執行。
2. 執行 `Zotero Vault Bridge: Initialize bridge folders`。
3. 執行 `Zotero Vault Bridge: Test connection`，將目前 Vault 與 Companion 配對。
4. 將 PDF 放入 `01_Papers/`，或開啟 PDF 後執行 `Import active PDF`。
5. Plugin 會在 Zotero 建立或重用 linked attachment、辨識文獻資料並保存 citation key。
6. Literature Note 會建立在 `02_Literature/<citationKey>.md`。
7. 在任何 Markdown 筆記輸入 `[@`，即可搜尋 Zotero 並插入 `[@citationKey]`。

快速驗收方式：以 Obsidian 開啟內附的 `test-vault`，啟動 Zotero 後先執行 `Test connection`，再放入一份自己有權使用的 PDF。完成後應同時看到 Zotero 文獻項目下的 PDF 子附件、`02_Literature/` 內的筆記，以及 Markdown 中可用的 `[@` 建議清單。完整成功、失敗、重新命名與離線測試見 [acceptance test](docs/acceptance-test.md)。

可用命令：

- `Scan papers folder`
- `Retry failed PDFs`
- `Create or update Literature Note for active PDF`
- `Sync all Literature Notes`
- `Cancel pending PDF imports`

## Literature Note 行為

- citation key 由第一作者、年份與標題決定；發生碰撞時加入 Zotero item key。
- 新筆記使用 `Templates/Literature.md`。
- 重新同步只更新 plugin 管理的 frontmatter。
- 使用者撰寫的正文及自訂 frontmatter 欄位會保留。
- frontmatter 包含 Zotero item、PDF wikilink 與 `zotero://select` 連結。
- 同一 PDF 與同一 citation key 不會重複建立筆記。

## Citation autocomplete

- 在 Markdown 編輯器輸入 `[@` 後，以作者、年份、標題或 citation key 搜尋整個 Zotero 使用者文庫。
- 使用 `↑`／`↓` 選擇、`Enter` 插入、`Esc` 關閉。
- 搜尋本身不修改 Zotero；只有選取文獻時，才確認並保存該項目的 citation key。
- 插入格式為 Pandoc citation：`[@citationKey]`。
- 搜尋透過已配對 Companion 執行，即使 Zotero Local API 關閉也能使用。

## PDF 可靠性

- 每份完成的 PDF 都保存 SHA-256、大小與修改時間；啟動掃描可辨識同一路徑的內容替換。
- 單純碰觸檔案但內容未變時只更新指紋，不會重跑 Zotero recognition。
- 在 Vault 內改名或移動已追蹤 PDF 時，Zotero linked attachment 會透過 authenticated relink endpoint 同步更新，Literature Note 的 PDF 連結也會更新。
- 內容真的被替換時，先成功辨識新的暫時 linked attachment，之後才移除舊 attachment；失敗時保留原有 attachment。
- Recognition 有 10–600 秒可設定的等待上限。逾時表示 Zotero 仍在背景執行；重試會重用同一個 pending/linked attachment。
- 可用 `Cancel pending PDF imports` 停止 Obsidian 端等待；Zotero 已開始的本機工作可能完成，之後重試會安全地重用結果。

## 安全與檔案所有權

- PDF 使用 Zotero linked attachment，不會複製到 Zotero storage。
- PDF 仍由 Obsidian Vault 管理，Companion 不會自動重新命名。
- Companion 只接受 localhost、正確 pairing token、`.pdf` 檔案及已配對 Vault root 內的路徑。
- Citation key 透過已配對的 Companion 寫入 Zotero，不要求開啟 Zotero Local API。
- Tagged release 由 CI 重建兩次驗證 byte-for-byte reproducibility，產生 SHA-256，並以 GitHub/Sigstore artifact attestation 簽署 provenance。

## 目前限制

- Zotero 必須保持開啟。
- Literature Note 的正文只在首次建立時由模板產生；後續同步刻意不覆寫正文。
- Autocomplete 目前以單一 `[@` trigger 為範圍；多筆 citation cluster 可在插入後手動組合。

架構與驗收細節見 [architecture](docs/architecture.md)、[development plan](docs/development-plan.md)、[compatibility matrix](docs/compatibility.md) 與 [acceptance test](docs/acceptance-test.md)。

## 官方依據

- [Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Zotero Plugin Development](https://www.zotero.org/support/dev/client_coding/plugin_development)
- [Zotero Connector HTTP Server](https://www.zotero.org/support/dev/client_coding/connector_http_server)
- [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
