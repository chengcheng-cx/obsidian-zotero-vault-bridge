import {
	TFile,
	normalizePath,
	type App,
} from "obsidian";
import type { PaperRecord } from "../papers/ImportState";
import type { BridgeSettings } from "../settings";
import {
	literatureFrontmatter,
	isSafeCitationKey,
	readFrontmatterScalar,
	renderLiteratureTemplate,
	updateManagedFrontmatter,
	type LiteratureNoteContext,
} from "./NoteContent";

export interface LiteratureNoteResult {
	path: string;
	created: boolean;
}

export interface LiteratureNoteWriter {
	createOrUpdate(pdfPath: string, record: PaperRecord): Promise<LiteratureNoteResult>;
}

export class LiteratureNoteService implements LiteratureNoteWriter {
	constructor(
		private readonly app: App,
		private readonly getSettings: () => BridgeSettings,
	) {}

	async createOrUpdate(pdfPath: string, record: PaperRecord): Promise<LiteratureNoteResult> {
		let context = this.context(pdfPath, record);
		let settings = this.getSettings();
		let notePath = normalizePath(`${settings.literatureFolder}/${context.citationKey}.md`);
		let existing = this.app.vault.getAbstractFileByPath(notePath);
		if (existing && !(existing instanceof TFile)) {
			throw new Error(`Literature Note path is not a Markdown file: ${notePath}`);
		}

		let created = !existing;
		let content: string;
		if (existing instanceof TFile) {
			content = await this.app.vault.read(existing);
			this.assertOwnership(content, record.itemKey ?? "", notePath);
		}
		else {
			let templatePath = normalizePath(settings.templatePath);
			let template = this.app.vault.getAbstractFileByPath(templatePath);
			if (!(template instanceof TFile)) {
				throw new Error(`Literature Note template was not found: ${templatePath}`);
			}
			content = renderLiteratureTemplate(await this.app.vault.read(template), context);
		}

		let updated = updateManagedFrontmatter(content, literatureFrontmatter(context));
		if (existing instanceof TFile) {
			if (updated !== content) {
				await this.app.vault.modify(existing, updated);
			}
		}
		else {
			await this.ensureFolder(settings.literatureFolder);
			await this.app.vault.create(notePath, updated);
		}

		return { path: notePath, created };
	}

	private context(pdfPath: string, record: PaperRecord): LiteratureNoteContext {
		if (!record.metadata || !record.itemKey || !record.attachmentKey || !record.selectUri) {
			throw new Error("The PDF must have recognized Zotero metadata before creating a Literature Note.");
		}
		let citationKey = record.metadata.citationKey.trim();
		if (!isSafeCitationKey(citationKey)) {
			throw new Error("Zotero returned an empty or file-unsafe citation key.");
		}
		return {
			metadata: record.metadata,
			citationKey,
			itemKey: record.itemKey,
			attachmentKey: record.attachmentKey,
			selectUri: record.selectUri,
			pdfPath,
		};
	}

	private assertOwnership(content: string, itemKey: string, notePath: string): void {
		let owner = readFrontmatterScalar(content, "zotero_item_key");
		if (!owner) {
			throw new Error(`Refusing to overwrite an unmanaged note at ${notePath}.`);
		}
		if (owner !== itemKey) {
			throw new Error(`Citation-key collision: ${notePath} belongs to Zotero item ${owner}.`);
		}
	}

	private async ensureFolder(folder: string): Promise<void> {
		let normalized = normalizePath(folder);
		let current = "";
		for (let segment of normalized.split("/").filter(Boolean)) {
			current = current ? `${current}/${segment}` : segment;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}
}
