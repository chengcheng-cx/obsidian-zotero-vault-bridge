import { FileSystemAdapter, type App, type TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import type { LiteratureNoteWriter } from "../src/literature/LiteratureNoteService";
import {
	ImportCancelledError,
	ImportService,
} from "../src/papers/ImportService";
import { ImportStateStore } from "../src/papers/ImportState";
import type { BridgeSettings } from "../src/settings";
import type { ZoteroBridgeClient } from "../src/zotero/ZoteroClient";

const SHA_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function settings(): BridgeSettings {
	return {
		papersFolder: "01_Papers",
		literatureFolder: "02_Literature",
		templatePath: "Templates/Literature.md",
		watchForNewPdfs: true,
		scanOnStartup: true,
		enableCitationAutocomplete: true,
		zoteroEndpoint: "http://localhost:23119",
		stablePollIntervalMs: 1,
		stableRequiredSamples: 1,
		stableTimeoutMs: 100,
		recognitionTimeoutMs: 120_000,
	};
}

function adapter(mtime: number): FileSystemAdapter {
	let value = Object.create(FileSystemAdapter.prototype) as FileSystemAdapter;
	Object.assign(value, {
		stat: async () => ({ size: 3, mtime, ctime: mtime, type: "file" }),
		readBinary: async () => new TextEncoder().encode("abc").buffer,
		getFullPath: (path: string) => `C:\\Vault\\${path.replaceAll("/", "\\")}`,
	});
	return value;
}

function service(
	state: ImportStateStore,
	fileAdapter: FileSystemAdapter,
	client: Partial<ZoteroBridgeClient>,
): ImportService {
	let app = { vault: { adapter: fileAdapter } } as unknown as App;
	let notes: LiteratureNoteWriter = {
		createOrUpdate: async () => ({ path: "02_Literature/key.md", created: false }),
	};
	return new ImportService(
		app,
		state,
		client as ZoteroBridgeClient,
		notes,
		settings,
		() => "C:\\Vault",
	);
}

describe("ImportService reliability", () => {
	it("refreshes a touch-only fingerprint without calling Zotero", async () => {
		let state = new ImportStateStore({
			"01_Papers/paper.pdf": {
				path: "01_Papers/paper.pdf",
				status: "complete",
				attempts: 1,
				updatedAt: "2026-01-01T00:00:00.000Z",
				literatureNote: "02_Literature/key.md",
				fingerprint: { size: 3, mtime: 1, sha256: SHA_ABC },
			},
		}, async () => undefined);
		let clientCalls = 0;
		let importer = service(state, adapter(2), {
			ensureConfigured: async () => { clientCalls += 1; throw new Error("unexpected"); },
		});
		let file = { path: "01_Papers/paper.pdf" } as TFile;

		let result = await importer.importFile(file);

		expect(result.status).toBe("complete");
		expect(result.fingerprint).toEqual({ size: 3, mtime: 2, sha256: SHA_ABC });
		expect(clientCalls).toBe(0);
	});

	it("records an actionable cancellation during the stability wait", async () => {
		let state = new ImportStateStore({}, async () => undefined);
		let importer = service(state, adapter(2), {});
		let file = { path: "01_Papers/new.pdf" } as TFile;

		let operation = importer.importFile(file);
		expect(importer.cancelAll()).toBe(1);
		await expect(operation).rejects.toBeInstanceOf(ImportCancelledError);
		expect(state.get(file.path)?.status).toBe("failed");
		expect(state.get(file.path)?.errorCode).toBe("import_cancelled");
	});
});
