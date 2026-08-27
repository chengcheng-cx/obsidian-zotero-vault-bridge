import {
	EditorSuggest,
	Notice,
	type App,
	type Editor,
	type EditorPosition,
	type EditorSuggestContext,
	type EditorSuggestTriggerInfo,
	type TFile,
} from "obsidian";
import type { BridgeSettings } from "../settings";
import type { ZoteroBridgeClient } from "../zotero/ZoteroClient";
import type { CitationSearchItem } from "../zotero/ZoteroTypes";
import { findCitationTrigger, replaceCitationIfUnchanged } from "./CitationText";

const SEARCH_LIMIT = 20;
const ERROR_NOTICE_COOLDOWN_MS = 10_000;

export class CitationSuggest extends EditorSuggest<CitationSearchItem> {
	private lastErrorNoticeAt = 0;

	constructor(
		app: App,
		private readonly client: ZoteroBridgeClient,
		private readonly getSettings: () => BridgeSettings,
	) {
		super(app);
		this.limit = SEARCH_LIMIT;
		this.setInstructions([
			{ command: "↑↓", purpose: "navigate" },
			{ command: "↵", purpose: "insert citation" },
			{ command: "esc", purpose: "dismiss" },
		]);
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		file: TFile | null,
	): EditorSuggestTriggerInfo | null {
		if (!this.getSettings().enableCitationAutocomplete || !file || file.extension.toLowerCase() !== "md") {
			return null;
		}
		let line = editor.getLine(cursor.line);
		let trigger = findCitationTrigger(line, cursor.ch);
		if (!trigger) {
			return null;
		}
		return {
			start: { line: cursor.line, ch: trigger.startCh },
			end: { line: cursor.line, ch: trigger.endCh },
			query: trigger.query,
		};
	}

	async getSuggestions(context: EditorSuggestContext): Promise<CitationSearchItem[]> {
		try {
			return await this.client.searchCitations(context.query, SEARCH_LIMIT);
		}
		catch (error) {
			console.error("Zotero Vault Bridge citation search failed", error);
			this.showError(error);
			return [];
		}
	}

	renderSuggestion(item: CitationSearchItem, element: HTMLElement): void {
		element.addClass("zotero-vault-bridge-citation-suggestion");
		element.createDiv({
			cls: "zotero-vault-bridge-citation-title",
			text: item.title || "Untitled Zotero item",
		});
		let details = [item.authors.join(", "), item.year].filter(Boolean).join(" · ");
		if (details) {
			element.createDiv({
				cls: "zotero-vault-bridge-citation-details",
				text: details,
			});
		}
		element.createDiv({
			cls: "zotero-vault-bridge-citation-key",
			text: `@${item.citationKey}`,
		});
	}

	selectSuggestion(item: CitationSearchItem): void {
		let context = this.context;
		if (!context) {
			return;
		}
		let expectedTrigger = context.editor.getRange(context.start, context.end);
		void this.resolveAndInsert(item, context, expectedTrigger);
	}

	private async resolveAndInsert(
		item: CitationSearchItem,
		context: EditorSuggestContext,
		expectedTrigger: string,
	): Promise<void> {
		try {
			let resolved = await this.client.resolveCitation(item.itemKey);
			if (!replaceCitationIfUnchanged(
				context.editor,
				context.start,
				context.end,
				expectedTrigger,
				resolved.citationKey,
			)) {
				new Notice("Citation insertion was cancelled because the note changed.");
				return;
			}
		}
		catch (error) {
			console.error("Zotero Vault Bridge citation insertion failed", error);
			this.showError(error, true);
		}
	}

	private showError(error: unknown, force = false): void {
		let now = Date.now();
		if (!force && now - this.lastErrorNoticeAt < ERROR_NOTICE_COOLDOWN_MS) {
			return;
		}
		this.lastErrorNoticeAt = now;
		let message = error instanceof Error ? error.message : "Unknown citation search error.";
		new Notice(`Zotero Vault Bridge: ${message}`, 10_000);
	}
}
