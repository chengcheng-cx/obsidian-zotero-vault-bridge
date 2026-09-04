import {
	FileSystemAdapter,
	Notice,
	Plugin,
	TFile,
} from "obsidian";
import { CitationSuggest } from "./citations/CitationSuggest";
import { LiteratureNoteService } from "./literature/LiteratureNoteService";
import { ImportService } from "./papers/ImportService";
import { ImportStateStore, type PaperRecords } from "./papers/ImportState";
import { PaperWatcher } from "./papers/PaperWatcher";
import {
	BridgeSettingTab,
	loadSettings,
	type BridgeSettings,
	type SettingsHost,
} from "./settings";
import {
	ZoteroBridgeClient,
	ZoteroBridgeClientError,
} from "./zotero/ZoteroClient";

interface PersistedPluginData {
	schemaVersion: 1;
	settings: BridgeSettings;
	bridgeToken: string;
	papers: PaperRecords;
}

interface UnknownPluginData {
	settings?: unknown;
	bridgeToken?: unknown;
	papers?: unknown;
}

export default class ZoteroVaultBridgePlugin extends Plugin implements SettingsHost {
	settings!: BridgeSettings;
	private bridgeToken!: string;
	private state!: ImportStateStore;
	private client!: ZoteroBridgeClient;
	private literatureNotes!: LiteratureNoteService;
	private importer!: ImportService;
	private watcher!: PaperWatcher;
	private saveQueue: Promise<void> = Promise.resolve();

	async onload(): Promise<void> {
		let loaded = await this.loadData() as UnknownPluginData | null;
		this.settings = loadSettings(loaded?.settings);
		this.bridgeToken = this.validToken(loaded?.bridgeToken)
			? loaded.bridgeToken
			: this.generateToken();

		this.state = new ImportStateStore(loaded?.papers, () => this.persist());
		this.client = new ZoteroBridgeClient(
			() => this.settings.zoteroEndpoint,
			() => this.bridgeToken,
		);
		this.literatureNotes = new LiteratureNoteService(
			this.app,
			() => this.settings,
		);
		this.importer = new ImportService(
			this.app,
			this.state,
			this.client,
			this.literatureNotes,
			() => this.settings,
			() => this.getVaultRoot(),
		);
		this.watcher = new PaperWatcher(
			this,
			this.app.vault,
			this.state,
			this.importer,
			() => this.settings,
		);

		this.addSettingTab(new BridgeSettingTab(this.app, this));
		this.registerEditorSuggest(new CitationSuggest(
			this.app,
			this.client,
			() => this.settings,
		));
		this.addCommands();
		this.watcher.start();
		await this.persist();
	}

	onunload(): void {
		this.importer?.cancelAll();
	}

	async updateSettings(patch: Partial<BridgeSettings>): Promise<void> {
		this.settings = loadSettings({ ...this.settings, ...patch });
		await this.persist();
	}

	async testConnection(): Promise<void> {
		try {
			let status = await this.client.ensureConfigured(this.getVaultRoot());
			new Notice(`Zotero ${status.zoteroVersion} connected · Companion ${status.companionVersion}`);
		}
		catch (error) {
			new Notice(this.userMessage(error), 10_000);
		}
	}

	async scanPapers(includeFailed: boolean): Promise<void> {
		new Notice(includeFailed ? "Retrying failed PDFs…" : "Scanning papers…");
		let result = await this.watcher.scan(includeFailed);
		new Notice(`PDF scan complete: ${result.imported} imported, ${result.failed} failed, ${result.discovered} found.`);
	}

	async syncLiteratureNotes(): Promise<void> {
		new Notice("Syncing Literature Notes…");
		let result = await this.watcher.syncLiteratureNotes();
		new Notice(`Literature Note sync complete: ${result.imported} updated, ${result.failed} failed, ${result.discovered} PDFs found.`);
	}

	async syncActiveAnnotations(file: TFile): Promise<void> {
		try {
			new Notice("Syncing annotations from Zotero…");
			let res = await this.importer.syncAnnotations(file.path);
			new Notice(`Annotations synced: ${res.count} items in ${res.path}`);
		}
		catch (error) {
			new Notice(this.userMessage(error), 10_000);
		}
	}

	async syncAllAnnotations(): Promise<void> {
		let completed = this.state.allComplete();
		if (!completed.length) {
			new Notice("No recognized PDF records found to sync annotations.");
			return;
		}
		new Notice(`Syncing annotations for ${completed.length} literature notes…`);
		let synced = 0;
		let failed = 0;
		for (let record of completed) {
			try {
				await this.importer.syncAnnotations(record.path);
				synced += 1;
			}
			catch (err) {
				failed += 1;
				console.error(`Failed syncing annotations for ${record.path}:`, err);
			}
		}
		new Notice(`Annotation sync complete: ${synced} updated, ${failed} failed.`);
	}

	private addCommands(): void {
		this.addCommand({
			id: "test-zotero-connection",
			name: "Test connection",
			callback: () => void this.testConnection(),
		});

		this.addCommand({
			id: "scan-papers",
			name: "Scan papers folder",
			callback: () => void this.scanPapers(false),
		});

		this.addCommand({
			id: "retry-failed-papers",
			name: "Retry failed PDFs",
			callback: () => void this.scanPapers(true),
		});

		this.addCommand({
			id: "import-active-pdf",
			name: "Import active PDF",
			checkCallback: checking => {
				let file = this.app.workspace.getActiveFile();
				let available = file instanceof TFile && file.extension.toLocaleLowerCase("en-US") === "pdf";
				if (available && !checking && file) {
					void this.importActivePdf(file);
				}
				return available;
			},
		});

		this.addCommand({
			id: "create-update-active-literature-note",
			name: "Create or update Literature Note for active PDF",
			checkCallback: checking => {
				let file = this.app.workspace.getActiveFile();
				let available = file instanceof TFile && file.extension.toLocaleLowerCase("en-US") === "pdf";
				if (available && !checking && file) {
					void this.createOrUpdateActiveLiteratureNote(file);
				}
				return available;
			},
		});

		this.addCommand({
			id: "sync-literature-notes",
			name: "Sync all Literature Notes",
			callback: () => void this.syncLiteratureNotes(),
		});

		this.addCommand({
			id: "sync-active-annotations",
			name: "Sync annotations for active Literature Note or PDF",
			checkCallback: checking => {
				let file = this.app.workspace.getActiveFile();
				let available = file instanceof TFile && (
					file.extension.toLocaleLowerCase("en-US") === "pdf"
					|| Boolean(this.state.findByLiteratureNote(file.path))
				);
				if (available && !checking && file) {
					void this.syncActiveAnnotations(file);
				}
				return available;
			},
		});

		this.addCommand({
			id: "sync-all-annotations",
			name: "Sync all annotations",
			callback: () => void this.syncAllAnnotations(),
		});

		this.addCommand({
			id: "cancel-pending-imports",
			name: "Cancel pending PDF imports",
			callback: () => {
				let cancelled = this.importer.cancelAll();
				new Notice(cancelled
					? `Cancelled ${cancelled} pending PDF import${cancelled === 1 ? "" : "s"}.`
					: "No PDF imports are currently pending.");
			},
		});

		this.addCommand({
			id: "initialize-vault-folders",
			name: "Initialize bridge folders",
			callback: () => void this.initializeFolders(),
		});
	}

	private async importActivePdf(file: TFile): Promise<void> {
		try {
			let record = await this.importer.importFile(file, { force: true });
			new Notice(`Recognized: ${record.metadata?.title || file.basename}`);
		}
		catch (error) {
			new Notice(this.userMessage(error), 10_000);
		}
	}

	private async createOrUpdateActiveLiteratureNote(file: TFile): Promise<void> {
		try {
			let record = await this.importer.importFile(file, { force: true });
			let note = record.literatureNote
				? this.app.vault.getAbstractFileByPath(record.literatureNote)
				: null;
			if (!(note instanceof TFile)) {
				throw new Error("The Literature Note was not created in the configured folder.");
			}
			await this.app.workspace.getLeaf(false).openFile(note);
			new Notice(`Literature Note ready: ${note.path}`);
		}
		catch (error) {
			new Notice(this.userMessage(error), 10_000);
		}
	}

	private async initializeFolders(): Promise<void> {
		let folders = [
			this.settings.papersFolder,
			this.settings.literatureFolder,
			"03_Notes",
			"04_Drafts",
			this.settings.templatePath.split("/").slice(0, -1).join("/"),
		].filter(Boolean);
		for (let folder of folders) {
			if (!this.app.vault.getAbstractFileByPath(folder)) {
				await this.app.vault.createFolder(folder);
			}
		}
		new Notice("Zotero Vault Bridge folders are ready.");
	}

	private getVaultRoot(): string {
		let adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			throw new Error("Zotero Vault Bridge requires a local desktop file-system vault.");
		}
		return adapter.getBasePath();
	}

	private persist(): Promise<void> {
		let snapshot: PersistedPluginData = {
			schemaVersion: 1,
			settings: structuredClone(this.settings),
			bridgeToken: this.bridgeToken,
			papers: this.state.snapshot(),
		};
		this.saveQueue = this.saveQueue
			.catch(error => console.error("Previous Zotero Vault Bridge save failed", error))
			.then(() => this.saveData(snapshot));
		return this.saveQueue;
	}

	private generateToken(): string {
		let bytes = new Uint8Array(32);
		globalThis.crypto.getRandomValues(bytes);
		return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
	}

	private validToken(value: unknown): value is string {
		return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
	}

	private userMessage(error: unknown): string {
		if (error instanceof ZoteroBridgeClientError) {
			return `Zotero Vault Bridge: ${error.message}`;
		}
		if (error instanceof Error) {
			return `Zotero Vault Bridge: ${error.message}`;
		}
		return "Zotero Vault Bridge failed with an unknown error.";
	}
}
