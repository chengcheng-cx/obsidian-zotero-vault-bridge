# Development Plan

## Milestone 0 — repository and connection

Status: implemented.

- npm workspace and CI
- Obsidian and Zotero plugin skeletons
- Zotero 10 manifest compatibility
- status/configure endpoints
- explicit connection command and actionable errors

## Milestone 1 — PDF to Zotero recognition

Status: implemented; manual Zotero acceptance test still required.

- watcher plus startup reconciliation
- stable-file wait and in-process deduplication
- persistent states: `new`, `processing`, `recognized`, `complete`, `failed`
- root-constrained linked attachment
- direct Zotero 10 native recognition
- metadata response and retry path
- XPI build

Exit criteria are defined in `acceptance-test.md`.

## Milestone 2 — citation key and Literature Note

Status: planned.

- generate a deterministic citation key when Zotero has none;
- use Zotero 10 Local API authorization/write support to persist `citationKey`;
- create `02_Literature/<citationKey>.md` from `Templates/Literature.md`;
- update frontmatter idempotently while preserving the user-owned note body;
- add `zotero://select` and PDF links;
- record `literatureNote` in import state.

## Milestone 3 — `[@` citation autocomplete

Status: planned.

- CodeMirror 6 suggestion source triggered by `[@`;
- search top-level Zotero items through the Local API;
- display author, year, title, and citation key;
- insert Pandoc-compatible `[@key]` text;
- keyboard-only selection and cancellation tests.

## Milestone 4 — hardening and release

Status: planned.

- linked-file relocation/relink endpoint;
- file fingerprint and replacement handling;
- cancellation and bounded recognition timeout UX;
- signed/reproducible release artifacts;
- update manifest and compatibility test matrix;
- migrate repository visibility from private to public after stable MVP acceptance.
