import {
	Plugin,
	TFile,
	type Vault,
} from "obsidian";
import type { BridgeSettings } from "../settings";
import type { ImportStateStore } from "./ImportState";
import type { ImportService } from "./ImportService";
import { isPdfInFolder } from "./pathRules";

export interface ScanResult {
	discovered: number;
	imported: number;
	failed: number;
}

export class PaperWatcher {
	private readonly pendingDeletes = new Map<string, number>();

	constructor(
		private readonly plugin: Plugin,
		private readonly vault: Vault,
		private readonly state: ImportStateStore,
		private readonly importer: ImportService,
		private readonly getSettings: () => BridgeSettings,
	) {}

	start(): void {
		this.plugin.register(() => {
			for (let timer of this.pendingDeletes.values()) {
				window.clearTimeout(timer);
			}
			this.pendingDeletes.clear();
		});

		this.plugin.registerEvent(this.vault.on("create", file => {
			if (!(file instanceof TFile)) {
				return;
			}
			let pending = this.pendingDeletes.get(file.path);
			if (pending !== undefined) {
				window.clearTimeout(pending);
				this.pendingDeletes.delete(file.path);
			}
			if (!this.getSettings().watchForNewPdfs) {
				return;
			}
			if (this.isPaper(file)) {
				void this.importer.importFile(file).catch(error => console.error("Zotero Vault Bridge import failed", error));
			}
		}));

		this.plugin.registerEvent(this.vault.on("delete", file => {
			if (!(file instanceof TFile)) {
				return;
			}
			if (this.state.get(file.path)) {
				let existingTimer = this.pendingDeletes.get(file.path);
				if (existingTimer !== undefined) {
					window.clearTimeout(existingTimer);
				}
				let timer = window.setTimeout(() => {
					this.pendingDeletes.delete(file.path);
					let stillExists = this.vault.getAbstractFileByPath(file.path);
					if (!stillExists) {
						void this.importer.handleFileMissing(file.path)
							.catch(err => console.error("Zotero Vault Bridge missing handle failed", err));
					}
				}, 3_000);
				this.pendingDeletes.set(file.path, timer);
			}
		}));

		this.plugin.registerEvent(this.vault.on("rename", (file, oldPath) => {
			if (!(file instanceof TFile)) {
				return;
			}
			let pending = this.pendingDeletes.get(oldPath);
			if (pending !== undefined) {
				window.clearTimeout(pending);
				this.pendingDeletes.delete(oldPath);
			}
			if (!this.state.get(oldPath)
					&& (!this.getSettings().watchForNewPdfs || !this.isPaper(file))) {
				return;
			}
			void this.handleRename(file, oldPath).catch(error => console.error("Zotero Vault Bridge relink failed", error));
		}));

		this.plugin.registerEvent(this.vault.on("modify", file => {
			if (!(file instanceof TFile)) {
				return;
			}
			if (this.isPaper(file)
					&& (this.state.get(file.path) || this.getSettings().watchForNewPdfs)) {
				void this.importer.importFile(file).catch(error => console.error("Zotero Vault Bridge replacement check failed", error));
			}
		}));

		if (this.getSettings().scanOnStartup) {
			let timeoutId = window.setTimeout(() => {
				void this.scan(false).catch(error => console.error("Zotero Vault Bridge startup scan failed", error));
			}, 1_000);
			this.plugin.register(() => window.clearTimeout(timeoutId));
		}
	}

	async scan(includeFailed: boolean): Promise<ScanResult> {
		await this.reconcileLiteratureNotes().catch(err => console.error("Zotero Vault Bridge note reconcile failed", err));
		let files = this.vault.getFiles().filter(file => this.isPaper(file));
		let result: ScanResult = { discovered: files.length, imported: 0, failed: 0 };

		for (let file of files) {
			if (!this.state.needsImport(file.path, includeFailed, file.stat)) {
				continue;
			}
			try {
				await this.importer.importFile(file, { force: includeFailed });
				result.imported += 1;
			}
			catch (error) {
				result.failed += 1;
				console.error(`Zotero Vault Bridge failed to import ${file.path}`, error);
			}
		}
		return result;
	}

	private async reconcileLiteratureNotes(): Promise<void> {
		let litFolder = this.getSettings().literatureFolder;
		let files = this.vault.getFiles().filter(file =>
			file.extension.toLowerCase() === "md"
			&& (file.path === litFolder || file.path.startsWith(`${litFolder}/`))
		);
		for (let file of files) {
			if (!this.state.findByLiteratureNote(file.path)) {
				await this.importer.recoverFromNote(file).catch(() => null);
			}
		}
	}

	private async handleRename(file: TFile, oldPath: string): Promise<void> {
		if (this.state.get(oldPath)) {
			await this.importer.relinkFile(file, oldPath);
			return;
		}
		if (this.isPaper(file)) {
			await this.importer.importFile(file);
		}
	}

	async syncLiteratureNotes(): Promise<ScanResult> {
		let files = this.vault.getFiles().filter(file => this.isPaper(file));
		let result: ScanResult = { discovered: files.length, imported: 0, failed: 0 };

		for (let file of files) {
			let record = this.state.get(file.path);
			if (!record?.itemKey || !record.metadata) {
				continue;
			}
			try {
				await this.importer.importFile(file, { force: true });
				result.imported += 1;
			}
			catch (error) {
				result.failed += 1;
				console.error(`Zotero Vault Bridge failed to sync ${file.path}`, error);
			}
		}
		return result;
	}

	private isPaper(file: TFile): boolean {
		return isPdfInFolder(file.path, file.extension, this.getSettings().papersFolder);
	}
}
