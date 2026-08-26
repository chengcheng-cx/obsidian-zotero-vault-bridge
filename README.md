# Obsidian Zotero Vault Bridge

讓 PDF 實體檔留在 Obsidian Vault，同時由 Zotero 10 建立 linked attachment、執行原生「Retrieve Metadata」，並把辨識結果回傳給 Obsidian。

目前完成的是第一個可安裝里程碑：

```text
01_Papers/*.pdf
        ↓
Obsidian Zotero Vault Bridge
        ↓ localhost + pairing token
Zotero Vault Bridge Companion
        ↓
linked attachment → Zotero native recognition
        ↓
Zotero bibliographic item + persistent import state
```

## 需求

- Zotero `10.0.x`
- Obsidian Desktop
- Node.js 20 以上（只在建置時需要）
- Zotero 與 Obsidian 必須在同一台電腦執行

Zotero 10 的 manifest 相容範圍依官方建議設定為 `10.0.*`。Companion 會使用 Zotero 的內部 JavaScript API，因此新的 Zotero 次要／主要版本必須重新驗證後才會放寬相容範圍。

## 建置

```powershell
cd "D:\14 OpenAI\obsidian-zotero-vault-bridge"
npm install
npm run check
npm run build
```

建置輸出：

- Obsidian：`obsidian-plugin/main.js`、`manifest.json`、`styles.css`
- Zotero：`zotero-companion/dist/zotero-vault-bridge-companion-0.1.1.xpi`

## 安裝 Zotero Companion

1. 開啟 Zotero。
2. 選擇 `Tools → Add-ons`。
3. 齒輪選單選擇 `Install Add-on From File…`。
4. 選擇建置出的 `.xpi`。
5. 重新啟動 Zotero。

Companion 只註冊三個 localhost endpoint：

- `GET /zotero-vault-bridge/status`
- `POST /zotero-vault-bridge/configure`
- `POST /zotero-vault-bridge/import`

## 安裝 Obsidian Plugin

在測試 Vault 建立：

```text
<vault>/.obsidian/plugins/zotero-vault-bridge/
```

複製以下三個檔案進去：

```text
obsidian-plugin/main.js
obsidian-plugin/manifest.json
obsidian-plugin/styles.css
```

接著在 Obsidian `Settings → Community plugins` 啟用 `Zotero Vault Bridge`。

## 第一次配對與使用

1. 確認 Zotero 正在執行。
2. 在 Obsidian Command Palette 執行 `Zotero Vault Bridge: Test connection`。
3. Plugin 會產生本機 pairing token，並把目前 Vault root 登記為 Companion 唯一允許的根目錄。
4. 將 PDF 放入 `01_Papers/`，或執行 `Import active PDF`。

Companion 會拒絕：

- 非 `localhost` 的 Zotero HTTP server 請求
- 未帶正確 pairing token 的匯入
- 非 `.pdf` 檔案
- 不在已配對 Vault root 內的路徑
- 不存在的檔案或目錄路徑

## 保證與目前限制

- PDF 使用 Zotero linked attachment，不會複製到 Zotero storage。
- Companion 刻意略過 Zotero 的 linked-file auto-rename 流程，避免改名破壞 Obsidian 連結。
- 同一路徑已有 linked attachment 時會重用，避免重複匯入。
- 辨識失敗時會保留 standalone linked attachment，之後可以重試或在 Zotero 手動處理。
- Zotero 目前必須開啟；本 repo 尚未自動啟動 Zotero。
- Literature Note 與 `[@` citation autocomplete 是下一個里程碑，介面與狀態欄位已預留，但本版不宣稱完成。

架構與驗收細節見 [docs/architecture.md](docs/architecture.md)、[docs/development-plan.md](docs/development-plan.md) 與 [docs/acceptance-test.md](docs/acceptance-test.md)。

## 官方依據

- [Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Zotero Plugin Development](https://www.zotero.org/support/dev/client_coding/plugin_development)
- [Zotero Connector HTTP Server](https://www.zotero.org/support/dev/client_coding/connector_http_server)
- [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
