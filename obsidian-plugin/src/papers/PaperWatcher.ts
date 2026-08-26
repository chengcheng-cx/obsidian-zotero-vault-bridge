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
	constructor(
		private readonly plugin: Plugin,
		private readonly vault: Vault,
		private readonly state: ImportStateStore,
		private readonly importer: ImportService,
		private readonly getSettings: () => BridgeSettings,
	) {}

	start(): void {
		this.plugin.registerEvent(this.vault.on("create", file => {
			if (!(file instanceof TFile) || !this.getSettings().watchForNewPdfs) {
				return;
			}
			if (this.isPaper(file)) {
				void this.importer.importFile(file).catch(error => console.error("Zotero Vault Bridge import failed", error));
			}
		}));

		this.plugin.registerEvent(this.vault.on("rename", file => {
			if (!(file instanceof TFile) || !this.getSettings().watchForNewPdfs) {
				return;
			}
			if (this.isPaper(file)) {
				void this.importer.importFile(file).catch(error => console.error("Zotero Vault Bridge import failed", error));
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
		let files = this.vault.getFiles().filter(file => this.isPaper(file));
		let result: ScanResult = { discovered: files.length, imported: 0, failed: 0 };

		for (let file of files) {
			if (!this.state.needsImport(file.path, includeFailed)) {
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

	private isPaper(file: TFile): boolean {
		return isPdfInFolder(file.path, file.extension, this.getSettings().papersFolder);
	}
}
