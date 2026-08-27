# Compatibility Matrix

The manifest range is intentionally narrower than the build matrix because the Zotero Companion calls internal desktop APIs. A green Node job proves that source and packaging are portable; it does not replace a desktop acceptance run.

| Component | Declared range | Automated coverage | Manual acceptance | Status |
| --- | --- | --- | --- | --- |
| Zotero Desktop | `10.0.*` | Companion endpoint and Zotero API harness tests | `10.0.1`, Windows 11 | Supported |
| Obsidian Desktop | `>=1.8.0`, desktop only | Typecheck, unit tests, production bundle | `1.13.7`, Windows 11 | Supported |
| Node.js (build only) | `>=20` | Node 20, 22, and 24 on Ubuntu and Windows | Node 22 on Windows 11 | Supported |
| Windows | Windows 11 | Windows CI for all supported Node majors plus isolated replacement/failure harnesses | Full PDF, Literature Note, citation, offline, and rename/relink workflow | Primary tested platform |
| macOS / Linux desktop | Obsidian-compatible desktop | Ubuntu build and unit tests only | Not yet run against desktop Zotero/Obsidian | Build-compatible; runtime unverified |

## Release gate

Before widening Zotero's `strict_max_version`, run the complete acceptance test against that exact Zotero minor line. Before lowering Obsidian's `minAppVersion`, build and manually exercise `EditorSuggest`, vault rename events, and `FileSystemAdapter` on that version.

Every tagged release must pass:

1. the OS/Node CI matrix;
2. all Obsidian and Companion tests;
3. two-build byte-for-byte reproducibility verification;
4. full-history secret scanning and dependency audit;
5. SHA-256 checksum verification and GitHub/Sigstore build-provenance attestation.
