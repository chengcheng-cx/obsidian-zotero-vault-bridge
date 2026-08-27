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
- persist SHA-256/stat fingerprints and detect replaced content;
- relink tracked Zotero attachments after Vault rename events;
- create or update citation-key Literature Notes without overwriting user-authored bodies;
- provide `[@` citation suggestions and insert clickable Literature Note links by default, with plain Pandoc citations as an option;
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
- search regular items in the user library and resolve a selected citation key;
- bound recognition wait time while preserving one reusable pending operation;
- relink a validated attachment key to a new in-Vault PDF path;
- return normalized metadata and Zotero keys.

## Import sequence

```text
PDF create/scan
    ↓
wait for stable size + mtime, then calculate SHA-256
    ├─ same content → refresh stat fingerprint only
    └─ replaced content → request safe replacement recognition
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

Every completed record also carries a SHA-256, size, and modification time. Matching stat values skip all I/O. A changed stat triggers one content hash; a matching hash is treated as a harmless touch, while a different hash requests replacement recognition. The Companion recognizes a new linked attachment first and deletes the old attachment only after the new one is attached to a bibliographic parent. The request includes the previously stored attachment key, so a retry that arrives after the first replacement finishes returns the new child instead of replacing it a second time.

Milestone 2 extends completion to include a `literatureNote` path. Older completed records without that path are reconciled once: the Companion reuses the linked attachment and parent item, supplies a citation key, and Obsidian creates the missing note. Subsequent note syncs replace only managed top-level frontmatter fields. Unknown frontmatter fields and the Markdown body are preserved.

## Citation keys

When a Zotero item has no citation key, the Companion derives one from the first author, year, and first significant title word. It compares generated keys case-insensitively within the user library and appends the Zotero item key on collision. The value is saved on the Zotero item before it is returned to Obsidian.

The implementation intentionally uses the already-paired Companion instead of requiring the Zotero Local API setting. This keeps authorization tied to the existing random bridge token and works when the user's Local API is disabled.

## Citation autocomplete

Obsidian's `EditorSuggest` watches Markdown text immediately before the cursor for an unfinished `[@` trigger. It sends at most 200 query characters to an authenticated localhost search endpoint and displays no more than 20 matches. Results contain only the Zotero item key, citation key, title, authors, year, and `zotero://select` URI. DOM rendering uses text nodes rather than HTML.

Search is read-only. The Companion derives a collision-checked preview key for display, but writes nothing until the user selects a result. Obsidian then resolves that item through a second authenticated endpoint; the Companion serializes citation-key allocation, persists the final key if needed, and returns it for insertion. When the matching managed note exists, the default mode writes `[[<literatureFolder>/<key>|[@<key>]]]`, which keeps the citation label while creating a real Obsidian internal link. If no note exists, it writes `[@<key>](zotero://select/library/items/<itemKey>)` instead; this opens Zotero without creating an unmanaged empty note that would collide with later synchronization. A setting preserves the original plain Pandoc `[@key]` form. Before replacing the trigger, Obsidian verifies that the editor range is unchanged, validates the key and final link target, and calculates the final cursor position from the complete insertion.

## Rename and relink

Obsidian rename events carry the old Vault-relative path. For a tracked record, the plugin sends the old absolute path, new absolute path, and stored attachment key to `/relink`. The Companion validates the token, both root boundaries, PDF extensions, the exact linked-file attachment, its current old path, and destination collisions before assigning `attachment.attachmentPath` and saving. Only then does Obsidian move its state key and refresh the managed PDF link in the Literature Note. The authenticated `/attachments/verify` diagnostic returns only whether a supplied key matches a supplied in-root path and whether it still has a parent; it never returns the stored Zotero path.

## Timeout and cancellation

The Companion serializes imports by canonical path. Each HTTP caller waits 10–600 seconds, but a timeout does not discard or duplicate the underlying recognition promise. Its map entry remains until Zotero settles it, and a retry races the same operation again. If the operation settles between requests, the expected attachment key makes the completed replacement idempotent. Obsidian can cancel its own wait and records an actionable retry state; Zotero work that already started is intentionally not force-killed because the internal recognizer has no stable cancellation contract.

## Release supply chain

Both ZIP formats use sorted entries, fixed timestamps, fixed modes, and fixed compression. The release builder emits an Obsidian ZIP, standalone Obsidian files, Companion XPI, Zotero `updates.json`, and `SHA256SUMS.txt`. CI compares two complete builds byte-for-byte. Tagged releases verify those checksums, attach a signed GitHub/Sigstore provenance attestation, and publish only after tests pass. A separate workflow scans the full Git history for secrets and audits npm dependencies.

## Trust boundary

The bridge is local-only but still treats the absolute path as untrusted input. Pairing and root checks are enforced in Zotero, not only in Obsidian. Browser-like requests also remain subject to Zotero 10's `Zotero-Allowed-Request` hardening.
