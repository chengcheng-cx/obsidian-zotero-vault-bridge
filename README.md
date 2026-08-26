# Obsidian Zotero Vault Bridge

繁體中文 | [English](README.en.md)

讓 PDF 實體檔留在 Obsidian Vault，由 Zotero 10 建立 linked attachment、執行原生 metadata recognition 並保存 citation key，再由 Obsidian 建立可持續編輯的 Literature Note。

目前完成兩個可安裝里程碑：

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
```

## 需求

- Zotero `10.0.x`
- Obsidian Desktop `1.8.0` 以上
- Node.js 20 以上（只在建置時需要）
- Zotero 與 Obsidian 必須在同一台電腦執行

Companion 使用 Zotero 的內部 JavaScript API，因此 manifest 暫時限制為已驗證的 `10.0.*`。

## 建置

```powershell
cd obsidian-zotero-vault-bridge
npm install
npm run check
npm run build
```

建置輸出：

- Obsidian：`obsidian-plugin/main.js`、`manifest.json`、`styles.css`
- Zotero：`zotero-companion/dist/zotero-vault-bridge-companion-0.2.0.xpi`

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

可用命令：

- `Scan papers folder`
- `Retry failed PDFs`
- `Create or update Literature Note for active PDF`
- `Sync all Literature Notes`

## Literature Note 行為

- citation key 由第一作者、年份與標題決定；發生碰撞時加入 Zotero item key。
- 新筆記使用 `Templates/Literature.md`。
- 重新同步只更新 plugin 管理的 frontmatter。
- 使用者撰寫的正文及自訂 frontmatter 欄位會保留。
- frontmatter 包含 Zotero item、PDF wikilink 與 `zotero://select` 連結。
- 同一 PDF 與同一 citation key 不會重複建立筆記。

## 安全與檔案所有權

- PDF 使用 Zotero linked attachment，不會複製到 Zotero storage。
- PDF 仍由 Obsidian Vault 管理，Companion 不會自動重新命名。
- Companion 只接受 localhost、正確 pairing token、`.pdf` 檔案及已配對 Vault root 內的路徑。
- Citation key 透過已配對的 Companion 寫入 Zotero，不要求開啟 Zotero Local API。

## 目前限制

- Zotero 必須保持開啟。
- Literature Note 的正文只在首次建立時由模板產生；後續同步刻意不覆寫正文。
- `[@` citation autocomplete 是下一個里程碑，尚未完成。

架構與驗收細節見 [architecture](docs/architecture.md)、[development plan](docs/development-plan.md) 與 [acceptance test](docs/acceptance-test.md)。

## 官方依據

- [Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Zotero Plugin Development](https://www.zotero.org/support/dev/client_coding/plugin_development)
- [Zotero Connector HTTP Server](https://www.zotero.org/support/dev/client_coding/connector_http_server)
- [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
