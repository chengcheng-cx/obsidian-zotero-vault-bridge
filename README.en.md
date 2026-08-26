# Obsidian Zotero Vault Bridge

[繁體中文](README.md) | English

Keep the physical PDF inside an Obsidian Vault while Zotero 10 creates a linked attachment, runs native metadata recognition, and persists a citation key. Obsidian then creates an editable Literature Note from the recognized metadata.

Two installable milestones are currently implemented:

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

## Requirements

- Zotero `10.0.x`
- Obsidian Desktop `1.8.0` or later
- Node.js 20 or later (build time only)
- Zotero and Obsidian must run on the same computer

The Companion uses Zotero's internal JavaScript APIs, so its manifest is currently limited to the tested `10.0.*` range.

## Build

```powershell
cd obsidian-zotero-vault-bridge
npm install
npm run check
npm run build
```

Build outputs:

- Obsidian: `obsidian-plugin/main.js`, `manifest.json`, and `styles.css`
- Zotero: `zotero-companion/dist/zotero-vault-bridge-companion-0.2.0.xpi`

## Install the Zotero Companion

1. Open Zotero.
2. Choose `Tools → Plugins`.
3. From the gear menu, choose `Install Plugin From File…`.
4. Select the generated `.xpi`.
5. Restart Zotero.

## Install the Obsidian plugin

Create this directory inside a test Vault:

```text
<vault>/.obsidian/plugins/zotero-vault-bridge/
```

Copy these three files into it:

```text
obsidian-plugin/main.js
obsidian-plugin/manifest.json
obsidian-plugin/styles.css
```

Reload Obsidian, then enable `Zotero Vault Bridge` under `Settings → Community plugins`.

## First run

1. Make sure Zotero is running.
2. Run `Zotero Vault Bridge: Initialize bridge folders`.
3. Run `Zotero Vault Bridge: Test connection` to pair the current Vault with the Companion.
4. Put a PDF in `01_Papers/`, or open a PDF and run `Import active PDF`.
5. The plugin creates or reuses a linked attachment in Zotero, recognizes its metadata, and persists a citation key.
6. The Literature Note is created at `02_Literature/<citationKey>.md`.

Available commands:

- `Scan papers folder`
- `Retry failed PDFs`
- `Create or update Literature Note for active PDF`
- `Sync all Literature Notes`

## Literature Note behavior

- Citation keys are derived from the first author, year, and title. Zotero's item key is appended if a collision occurs.
- New notes use `Templates/Literature.md`.
- Subsequent syncs update only plugin-managed frontmatter.
- User-authored note bodies and custom frontmatter fields are preserved.
- Frontmatter contains Zotero item identifiers, a PDF wikilink, and a `zotero://select` link.
- The same PDF and citation key do not create duplicate notes.

## Security and file ownership

- Zotero uses a linked attachment; the PDF is not copied into Zotero storage.
- Obsidian remains the owner of the PDF, and the Companion does not rename it.
- The Companion accepts only localhost requests with the correct pairing token, `.pdf` files, and paths inside the paired Vault root.
- Citation keys are written through the paired Companion, so enabling Zotero's Local API is not required.

## Current limitations

- Zotero must remain open.
- The note body is generated from the template only when the note is first created; later syncs intentionally preserve it.
- `[@` citation autocomplete is the next milestone and is not implemented yet.

See [architecture](docs/architecture.md), the [development plan](docs/development-plan.md), and the [acceptance test](docs/acceptance-test.md) for design and verification details.

## Primary references

- [Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Zotero Plugin Development](https://www.zotero.org/support/dev/client_coding/plugin_development)
- [Zotero Connector HTTP Server](https://www.zotero.org/support/dev/client_coding/connector_http_server)
- [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
