# Development Plan

## Milestone 0 — repository and connection

Status: implemented.

- npm workspace and CI
- Obsidian and Zotero plugin skeletons
- Zotero 10 manifest compatibility
- status/configure endpoints
- explicit connection command and actionable errors

## Milestone 1 — PDF to Zotero recognition

Status: implemented; normal and difficult-PDF failure/retry acceptance passed on Zotero 10.0.1.

- watcher plus startup reconciliation
- stable-file wait and in-process deduplication
- persistent states: `new`, `processing`, `recognized`, `complete`, `failed`
- root-constrained linked attachment
- direct Zotero 10 native recognition
- metadata response and retry path
- XPI build

Exit criteria are defined in `acceptance-test.md`.

## Milestone 2 — citation key and Literature Note

Status: implemented; manual acceptance passed on Zotero 10.0.1 and Obsidian 1.13.7.

- generate a deterministic citation key when Zotero has none;
- persist `citationKey` through the paired Companion because Zotero's Local API may be disabled;
- create `02_Literature/<citationKey>.md` from `Templates/Literature.md`;
- update frontmatter idempotently while preserving the user-owned note body;
- add `zotero://select` and PDF links;
- record `literatureNote` in import state.

## Milestone 3 — `[@` citation autocomplete

Status: implemented; manual Obsidian/Zotero acceptance passed on Zotero 10.0.1 and Obsidian 1.13.7.

- Obsidian `EditorSuggest` source triggered by `[@`;
- search top-level Zotero items through authenticated Companion endpoints;
- display author, year, title, and citation key;
- insert Pandoc-compatible `[@key]` text;
- keyboard-only selection and cancellation tests.

## Milestone 4 — hardening and release

Status: released in `v0.4.0`; desktop rename/relink acceptance passed on Zotero 10.0.1 and Obsidian 1.13.7, and the complete tagged-release gate passed.

- authenticated linked-file relocation/relink endpoint and Vault rename handling;
- SHA-256/stat fingerprints, content-replacement recognition, and touch-only fast path;
- cancel command plus bounded recognition timeout that keeps one reusable pending operation;
- deterministic Obsidian ZIP and Companion XPI with SHA-256 release manifest;
- generated Zotero `updates.json` and documented compatibility matrix;
- OS/Node CI matrix, full-history secret scanning, dependency audit, reproducible tagged releases, and signed GitHub/Sigstore build provenance.

Repository visibility was changed to public after a full tracked-history privacy audit confirmed that PDFs, Obsidian runtime state, pairing tokens, secrets, and personal email addresses were never committed.

## Milestone 5 — clickable citation links

Status: implemented in `v0.5.0`; keyboard, mouse, and link-navigation acceptance passed on Zotero 10.0.1 and Obsidian 1.13.7.

- keep the `[@` Zotero search trigger and citation-shaped label;
- insert a real Literature Note wikilink by default;
- link existing managed notes internally and fall back to a validated Zotero item link when no note exists;
- preserve plain Pandoc `[@key]` insertion as a settings option;
- validate link targets and retain the asynchronous stale-range guard;
- cover linked and Pandoc output with regression tests.
