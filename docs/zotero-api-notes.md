# Zotero 10 API Notes

Research date: 2026-08-26.

## Compatibility

Zotero's developer documentation says a tested Zotero 10 plugin should use `strict_max_version: "10.0.*"`. Zotero 10 uses the same Firefox 140 ESR base as Zotero 9, but includes Local API and internal data/API changes.

Source: [Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers).

## Local HTTP hardening

Zotero 10 requires the Host header to resolve to loopback. Browser-like requests are dropped unless they are from the connector, explicitly allowed by the endpoint, or carry `Zotero-Allowed-Request`. The Obsidian client always supplies this header, while the Companion does not opt out of Zotero's protection.

Source: [Local HTTP server and local API](https://www.zotero.org/support/dev/zotero_10_for_developers#local_http_server_and_local_api).

## Endpoint contract

Current Zotero endpoints are registered in `Zotero.Server.Endpoints`. A single-argument `init(requestData)` receives method, path, params, headers, and parsed JSON data, and returns a status code or `[status, contentType, body]` tuple.

Source: [`server.js` in the Zotero 10.0.1 release](https://github.com/zotero/zotero/blob/10.0.1/chrome/content/zotero/xpcom/server/server.js).

## Linked attachment

`Zotero.Attachments.linkFromFile({ file })` creates a `linked_file` attachment whose path points to the original file. It accepts either an `nsIFile` or string path.

Source: [`attachments.js` in the Zotero 10.0.1 release](https://github.com/zotero/zotero/blob/10.0.1/chrome/content/zotero/xpcom/attachments.js).

For an Obsidian rename, Zotero 10.0.1 exposes the linked-file path through `attachment.attachmentPath`. The Companion saves a new absolute path only after authenticating the request, checking both Vault-root boundaries, matching the stored attachment key and previous path, and ruling out a destination collision.

## Native recognition

At the inspected Zotero source revision, `Zotero.RecognizeDocument._recognize(attachment)` extracts PDF recognizer data, queries Zotero's recognition service, and creates a bibliographic item. The public queue method then assigns the attachment parent and may rename the file. The Companion calls `_recognize()` and performs the parent assignment itself so the Vault filename remains unchanged.

Source: [`recognizeDocument.js` in the Zotero 10.0.1 release](https://github.com/zotero/zotero/blob/10.0.1/chrome/content/zotero/xpcom/recognizeDocument.js).

## Citation-key persistence

The Zotero Local API can be disabled by the user, including on a supported Zotero 10 installation. Literature Note creation therefore does not depend on Local API availability. The paired Companion generates a deterministic citation key, checks for collisions in the user library, writes the `citationKey` field on the existing bibliographic item, and returns the saved value in the authenticated import response.

This does not add a remote service or a second credential: it reuses the localhost-only endpoint, pairing token, and Vault-root boundary already required for PDF import.

## Citation search

Milestone 3 also avoids a Local API dependency. The Companion exposes authenticated `citations/search` and `citations/resolve` routes on Zotero's localhost connector server. Search reads regular, non-deleted items in the user library and returns a bounded bibliographic projection. Resolve looks up one validated Zotero item key and persists its collision-checked citation key. Query text and response metadata never leave the local machine.

## Update manifest and provenance

The release builder emits Zotero's Mozilla-style `updates.json` with a versioned HTTPS `update_link`, SHA-256 `update_hash`, and the same Zotero compatibility range as the XPI manifest. Archive contents are sorted and receive fixed timestamps and modes. GitHub's public Sigstore service signs build provenance for every published release artifact.

Source: [Zotero plugin update manifest](https://www.zotero.org/support/dev/zotero_7_for_developers#updaterdf_updatesjson).

## Upgrade rule

Do not increase `strict_max_version` merely because installation appears to work. For each new Zotero line:

1. inspect `attachments.js`, `recognizeDocument.js`, and `server/server.js`;
2. run the normal and difficult PDF acceptance cases;
3. confirm the Vault filename is unchanged;
4. verify failure/retry and duplicate-request behavior;
5. only then update the manifest and release metadata.
