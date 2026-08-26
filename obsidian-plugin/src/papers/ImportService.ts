import {
	FileSystemAdapter,
	type App,
	type TFile,
} from "obsidian";
import type { BridgeSettings } from "../settings";
import {
	ZoteroBridgeClient,
	ZoteroBridgeClientError,
} from "../zotero/ZoteroClient";
import type { PaperRecord } from "./ImportState";
import { ImportStateStore } from "./ImportState";
import { waitForStableFile } from "./fileStability";

export interface ImportOptions {
	force?: boolean;
}

export class ImportService {
	private readonly inFlight = new Map<string, Promise<PaperRecord>>();

	constructor(
		private readonly app: App,
		private readonly state: ImportStateStore,
		private readonly client: ZoteroBridgeClient,
		private readonly getSettings: () => BridgeSettings,
		private readonly getVaultRoot: () => string,
	) {}

	async importFile(file: TFile, options: ImportOptions = {}): Promise<PaperRecord> {
		let current = this.state.get(file.path);
		if (current?.status === "complete" && !options.force) {
			return current;
		}
		let existing = this.inFlight.get(file.path);
		if (existing) {
			return existing;
		}

		let operation = this.runImport(file);
		this.inFlight.set(file.path, operation);
		try {
			return await operation;
		}
		finally {
			this.inFlight.delete(file.path);
		}
	}

	private async runImport(file: TFile): Promise<PaperRecord> {
		if (!this.state.get(file.path)) {
			await this.state.markNew(file.path);
		}
		await this.state.markProcessing(file.path);

		try {
			let adapter = this.requireFileSystemAdapter();
			let settings = this.getSettings();
			await waitForStableFile(
				async () => {
					let stat = await adapter.stat(file.path);
					return stat ? { size: stat.size, mtime: stat.mtime } : null;
				},
				{
					pollIntervalMs: settings.stablePollIntervalMs,
					requiredSamples: settings.stableRequiredSamples,
					timeoutMs: settings.stableTimeoutMs,
				},
			);

			await this.client.ensureConfigured(this.getVaultRoot());
			let result = await this.client.importPdf(adapter.getFullPath(file.path));
			await this.state.markRecognized(file.path, result);
			await this.state.markComplete(file.path);
			let record = this.state.get(file.path);
			if (!record) {
				throw new Error("Import completed without a persisted paper record.");
			}
			return record;
		}
		catch (error) {
			let code = error instanceof ZoteroBridgeClientError
				? error.code
				: error instanceof Error
					? error.name
					: "unknown_error";
			let message = error instanceof Error ? error.message : "Unknown import error.";
			await this.state.markFailed(file.path, code, message);
			throw error;
		}
	}

	private requireFileSystemAdapter(): FileSystemAdapter {
		let adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			throw new Error("Zotero Vault Bridge requires a local desktop file-system vault.");
		}
		return adapter;
	}
}
