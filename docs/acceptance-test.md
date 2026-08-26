# Acceptance Test

Use a dedicated Zotero profile and the included `test-vault`. Do not test the first build against a production library or primary Vault.

## Prepare

1. Build both workspaces with `npm run build`.
2. Install the Companion XPI in Zotero 10.0.x.
3. Install the three Obsidian plugin files in the test Vault.
4. Add two user-owned PDFs to `01_Papers/`:
   - `normal-paper.pdf`: searchable text with a DOI or clear title;
   - `difficult-paper.pdf`: incomplete metadata, OCR-only, or otherwise hard to recognize.
5. Record each PDF filename and checksum before importing.

## Connection

- Run `Test connection` while Zotero is closed: an actionable unavailable error is shown.
- Start Zotero and run it again: the notice shows the Zotero and Companion versions.
- Confirm the Vault is paired without manually exposing a token.

## Normal PDF

- Trigger a scan or copy `normal-paper.pdf` into `01_Papers/`.
- A standalone linked attachment is created, then becomes a child of a bibliographic item.
- Zotero's attachment path points to the original file inside the Vault.
- No second PDF exists in Zotero storage.
- The Vault filename and checksum are unchanged.
- Obsidian plugin data records `complete`, `itemKey`, and `attachmentKey`.
- Re-scan twice: no duplicate item or attachment is created.

## Difficult PDF

- Import `difficult-paper.pdf`.
- If Zotero recognizes it, verify the same invariants as the normal PDF.
- If recognition fails, Obsidian records `failed` with an actionable message and Zotero keeps one standalone linked attachment.
- Retry: the same attachment is reused rather than duplicated.

## Security

- Send an import request without the pairing token: expect HTTP 403.
- Send a `.txt` path: expect HTTP 415.
- Send a PDF path outside the paired Vault root: expect HTTP 403.
- Send a missing in-root PDF: expect HTTP 404.

## Pass condition

Milestone 1 passes only when both success and failure/retry paths behave as described on the exact Zotero version declared compatible by the manifest.

## Milestone 2 — Citation key and Literature Note

1. Upgrade both plugins to `0.2.0` and restart Zotero and Obsidian.
2. Run `Sync all Literature Notes` for a Milestone 1 record whose `literatureNote` field is absent.
3. Confirm Zotero stores a non-empty citation key on the recognized bibliographic item.
4. Confirm exactly one `02_Literature/<citationKey>.md` file is created.
5. Confirm its frontmatter contains the title, authors, year, publication, DOI, citation key, Zotero keys, `zotero://select` URI, and Vault-relative PDF wikilink.
6. Add a custom frontmatter field and user text under `## My Comments`.
7. Run `Sync all Literature Notes` twice.
8. Confirm the managed frontmatter remains current, the custom field stays in place, the note body is byte-for-byte unchanged, and no second note is created.
9. Create a controlled citation-key collision and confirm the second item receives an item-key suffix rather than overwriting the first note.

Milestone 2 passes only when Zotero citation-key persistence, note creation, preservation, and collision behavior all succeed on the declared versions.

Verified on Zotero 10.0.1 and Obsidian 1.13.7: seven completed imports produced seven unique Literature Notes; two consecutive synchronization runs preserved the custom frontmatter field and user-owned body byte-for-byte and created no duplicate notes. The difficult PDF remained in the expected failed-recognition state.
