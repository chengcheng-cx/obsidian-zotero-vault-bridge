import {
	App,
	PluginSettingTab,
	Setting,
	normalizePath,
} from "obsidian";

export interface BridgeSettings {
	papersFolder: string;
	literatureFolder: string;
	templatePath: string;
	watchForNewPdfs: boolean;
	scanOnStartup: boolean;
	zoteroEndpoint: string;
	stablePollIntervalMs: number;
	stableRequiredSamples: number;
	stableTimeoutMs: number;
}

export const DEFAULT_SETTINGS: BridgeSettings = {
	papersFolder: "01_Papers",
	literatureFolder: "02_Literature",
	templatePath: "Templates/Literature.md",
	watchForNewPdfs: true,
	scanOnStartup: true,
	zoteroEndpoint: "http://localhost:23119",
	stablePollIntervalMs: 750,
	stableRequiredSamples: 3,
	stableTimeoutMs: 30_000,
};

export function loadSettings(value: unknown): BridgeSettings {
	let candidate = value && typeof value === "object" && !Array.isArray(value)
		? value as Partial<BridgeSettings>
		: {};
	return {
		...DEFAULT_SETTINGS,
		...candidate,
		papersFolder: typeof candidate.papersFolder === "string"
			? normalizePath(candidate.papersFolder)
			: DEFAULT_SETTINGS.papersFolder,
		literatureFolder: typeof candidate.literatureFolder === "string"
			? normalizePath(candidate.literatureFolder)
			: DEFAULT_SETTINGS.literatureFolder,
		templatePath: typeof candidate.templatePath === "string"
			? normalizePath(candidate.templatePath)
			: DEFAULT_SETTINGS.templatePath,
		stablePollIntervalMs: positiveInteger(candidate.stablePollIntervalMs, DEFAULT_SETTINGS.stablePollIntervalMs),
		stableRequiredSamples: positiveInteger(candidate.stableRequiredSamples, DEFAULT_SETTINGS.stableRequiredSamples),
		stableTimeoutMs: positiveInteger(candidate.stableTimeoutMs, DEFAULT_SETTINGS.stableTimeoutMs),
	};
}

function positiveInteger(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export interface SettingsHost {
	settings: BridgeSettings;
	updateSettings(patch: Partial<BridgeSettings>): Promise<void>;
	testConnection(): Promise<void>;
	scanPapers(includeFailed: boolean): Promise<void>;
}

export class BridgeSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly host: SettingsHost) {
		super(app, host as never);
	}

	display(): void {
		let { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Zotero Vault Bridge" });
		containerEl.createEl("p", {
			text: "Milestone 1 links and recognizes PDFs. Literature note settings are reserved for the next milestone.",
			cls: "zotero-vault-bridge-settings-note",
		});

		new Setting(containerEl)
			.setName("Papers folder")
			.setDesc("Vault-relative folder watched for PDFs.")
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.papersFolder)
				.setValue(this.host.settings.papersFolder)
				.onChange(async value => this.host.updateSettings({ papersFolder: normalizePath(value) })));

		new Setting(containerEl)
			.setName("Watch for new PDFs")
			.setDesc("Import PDFs created or renamed into the papers folder.")
			.addToggle(toggle => toggle
				.setValue(this.host.settings.watchForNewPdfs)
				.onChange(async value => this.host.updateSettings({ watchForNewPdfs: value })));

		new Setting(containerEl)
			.setName("Scan on startup")
			.setDesc("Reconcile PDFs that arrived while Obsidian was closed. Failed PDFs are not retried automatically.")
			.addToggle(toggle => toggle
				.setValue(this.host.settings.scanOnStartup)
				.onChange(async value => this.host.updateSettings({ scanOnStartup: value })));

		new Setting(containerEl)
			.setName("Zotero endpoint")
			.setDesc("Only loopback HTTP origins are accepted; the pairing token is never sent elsewhere.")
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.zoteroEndpoint)
				.setValue(this.host.settings.zoteroEndpoint)
				.onChange(async value => this.host.updateSettings({ zoteroEndpoint: value.trim() })));

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Pair this Vault root and verify the Companion.")
			.addButton(button => button
				.setButtonText("Test")
				.onClick(async () => this.host.testConnection()));

		new Setting(containerEl)
			.setName("Scan papers")
			.setDesc("Import unprocessed PDFs without retrying known failures.")
			.addButton(button => button
				.setButtonText("Scan")
				.onClick(async () => this.host.scanPapers(false)));

		new Setting(containerEl)
			.setName("Retry failed PDFs")
			.setDesc("Retry failed records; the Companion reuses their existing linked attachments.")
			.addButton(button => button
				.setButtonText("Retry")
				.onClick(async () => this.host.scanPapers(true)));
	}
}
