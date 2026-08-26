# Architecture

## Ownership boundary

- Zotero owns bibliographic metadata and the parent bibliographic item.
- Obsidian owns the PDF path, Markdown, and the import workflow state.
- The PDF exists once, inside the Vault. Zotero stores a linked attachment to that file.

## Components

### Obsidian plugin

Responsibilities:

- watch `01_Papers/` and reconcile missed files on startup;
- wait until a newly copied PDF has stopped changing;
- convert the Vault-relative path to an absolute desktop path;
- pair with the local Companion using a random token;
- persist per-PDF status in Obsidian plugin `data.json`;
- create or update citation-key Literature Notes without overwriting user-authored bodies;
- expose explicit connection, scan, retry, import, and Literature Note sync commands.

The plugin never talks to `zotero.sqlite` and never sends a PDF body over HTTP.

### Zotero companion

Responsibilities:

- register local HTTP endpoints inside Zotero;
- authenticate requests with the locally paired token;
- canonicalize and constrain paths to the configured Vault root;
- create or reuse a `linked_file` attachment;
- invoke Zotero 10's recognizer;
- attach the PDF to the recognized bibliographic parent without renaming the Vault file;
- generate and persist a deterministic citation key when the item has none;
- return normalized metadata and Zotero keys.

## Import sequence

```text
PDF create/scan
    ↓
wait for stable size + mtime
    ↓
POST /configure (pair or confirm root)
    ↓
POST /import { path }
    ↓
validate token, extension, existence, root boundary
    ↓
find existing linked attachment by canonical path
    ├─ child attachment → return existing parent
    └─ absent/top-level → continue
    ↓
Zotero.Attachments.linkFromFile()
    ↓
Zotero.RecognizeDocument._recognize()
    ↓
transactionally assign attachment.parentID
    ↓
return itemKey + attachmentKey + metadata
    ↓
persist/generate citationKey in Zotero
    ↓
render or update 02_Literature/<citationKey>.md
    ↓
persist complete state in Obsidian data.json
```

## Why `_recognize()` is wrapped directly

`Zotero.RecognizeDocument.recognizeItems()` deliberately catches per-item recognition errors and its private processing path may auto-rename linked files when the Zotero preference is enabled. The Companion uses the current Zotero 10 `_recognize()` entry point and performs only the parent assignment transaction. This preserves error reporting and prevents a Zotero-side filename change from breaking an Obsidian link.

This is an internal API, not a stable Local API endpoint. The manifest therefore caps compatibility at `10.0.*`, and CI/unit tests are not a substitute for the manual acceptance test against every supported Zotero release.

## Idempotency

The Companion serializes concurrent requests per canonical file path. Before creating an attachment it queries Zotero for an existing non-deleted linked attachment with the same path. A recognized child returns its existing parent; an unrecognized top-level attachment is reused for a retry.

The Obsidian state key is the Vault-relative path. A completed path is skipped during startup reconciliation.

Milestone 2 extends completion to include a `literatureNote` path. Older completed records without that path are reconciled once: the Companion reuses the linked attachment and parent item, supplies a citation key, and Obsidian creates the missing note. Subsequent note syncs replace only managed top-level frontmatter fields. Unknown frontmatter fields and the Markdown body are preserved.

## Citation keys

When a Zotero item has no citation key, the Companion derives one from the first author, year, and first significant title word. It compares generated keys case-insensitively within the user library and appends the Zotero item key on collision. The value is saved on the Zotero item before it is returned to Obsidian.

The implementation intentionally uses the already-paired Companion instead of requiring the Zotero Local API setting. This keeps authorization tied to the existing random bridge token and works when the user's Local API is disabled.

## Trust boundary

The bridge is local-only but still treats the absolute path as untrusted input. Pairing and root checks are enforced in Zotero, not only in Obsidian. Browser-like requests also remain subject to Zotero 10's `Zotero-Allowed-Request` hardening.
