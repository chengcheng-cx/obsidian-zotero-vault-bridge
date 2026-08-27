# Obsidian Zotero Vault Bridge

[繁體中文](README.md) | English

Keep the physical PDF inside an Obsidian Vault while Zotero 10 creates a linked attachment, runs native metadata recognition, and persists a citation key. Obsidian then creates an editable Literature Note and completes Pandoc citations.

Four installable milestones are implemented, including reliability and release hardening:

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

## Requirements

- Zotero `10.0.x`
- Obsidian Desktop `1.8.0` or later
- Node.js 20 or later (build time only)
- Zotero and Obsidian must run on the same computer

The Companion uses Zotero's internal JavaScript APIs, so its manifest is currently limited to the tested `10.0.*` range.

## Download

[GitHub Releases](https://github.com/chengcheng-cx/obsidian-zotero-vault-bridge/releases/latest) provides a directly installable Obsidian ZIP, Zotero XPI, `updates.json`, and `SHA256SUMS.txt`. Prefer a release when you do not need to modify the source; local builds are primarily for development and verification.

## Build

```powershell
cd obsidian-zotero-vault-bridge
npm install
npm run check
npm run build
```

Build outputs:

- Obsidian: `obsidian-plugin/main.js`, `manifest.json`, and `styles.css`
- Zotero: `zotero-companion/dist/zotero-vault-bridge-companion-0.4.0.xpi`
- Complete release: `dist/release/` (Obsidian ZIP, XPI, `updates.json`, and SHA-256 checksums)

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
7. Type `[@` in any Markdown note to search Zotero and insert `[@citationKey]`.

For a quick acceptance run, open the included `test-vault` in Obsidian, start Zotero, run `Test connection`, and add one PDF you are allowed to use. A successful run shows a PDF child attachment under the Zotero bibliographic item, a note in `02_Literature/`, and `[@` suggestions in Markdown. See the [acceptance test](docs/acceptance-test.md) for success, failure, rename, and offline cases.

Available commands:

- `Scan papers folder`
- `Retry failed PDFs`
- `Create or update Literature Note for active PDF`
- `Sync all Literature Notes`
- `Cancel pending PDF imports`

## Literature Note behavior

- Citation keys are derived from the first author, year, and title. Zotero's item key is appended if a collision occurs.
- New notes use `Templates/Literature.md`.
- Subsequent syncs update only plugin-managed frontmatter.
- User-authored note bodies and custom frontmatter fields are preserved.
- Frontmatter contains Zotero item identifiers, a PDF wikilink, and a `zotero://select` link.
- The same PDF and citation key do not create duplicate notes.

## Citation autocomplete

- Type `[@` in the Markdown editor to search the entire Zotero user library by author, year, title, or citation key.
- Use `↑`/`↓` to navigate, `Enter` to insert, and `Esc` to dismiss.
- Searching is read-only; a missing citation key is confirmed and persisted only for the item you select.
- The inserted form is a Pandoc citation: `[@citationKey]`.
- Search uses the paired Companion and works even when Zotero's Local API is disabled.

## PDF reliability

- Every completed PDF stores a SHA-256, size, and modification-time fingerprint, so startup scans detect content replacement at the same path.
- Touching a file without changing its content only refreshes the fingerprint and does not rerun Zotero recognition.
- Renaming or moving a tracked PDF inside the Vault updates Zotero's linked attachment through an authenticated relink endpoint and refreshes its Literature Note PDF link.
- For real content replacement, the Companion recognizes a temporary new linked attachment before removing the stale attachment; a failure preserves the original attachment.
- Recognition has a configurable 10–600 second wait limit. A timeout means Zotero is still working; retry reuses the same pending or linked attachment.
- `Cancel pending PDF imports` stops Obsidian-side waiting. A local Zotero operation that already began may finish, and a later retry safely reuses its result.

## Security and file ownership

- Zotero uses a linked attachment; the PDF is not copied into Zotero storage.
- Obsidian remains the owner of the PDF, and the Companion does not rename it.
- The Companion accepts only localhost requests with the correct pairing token, `.pdf` files, and paths inside the paired Vault root.
- Citation keys are written through the paired Companion, so enabling Zotero's Local API is not required.
- Tagged releases are built twice for byte-for-byte reproducibility, checksummed with SHA-256, and receive a signed GitHub/Sigstore provenance attestation.

## Current limitations

- Zotero must remain open.
- The note body is generated from the template only when the note is first created; later syncs intentionally preserve it.
- Autocomplete currently targets a single `[@` trigger; combine multiple citations into a cluster manually after insertion.

See [architecture](docs/architecture.md), the [development plan](docs/development-plan.md), the [compatibility matrix](docs/compatibility.md), and the [acceptance test](docs/acceptance-test.md) for design and verification details.

## Primary references

- [Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Zotero Plugin Development](https://www.zotero.org/support/dev/client_coding/plugin_development)
- [Zotero Connector HTTP Server](https://www.zotero.org/support/dev/client_coding/connector_http_server)
- [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
