import { TFile, type App } from "obsidian";
import { describe, expect, it } from "vitest";
import { LiteratureNoteService } from "../src/literature/LiteratureNoteService";
import type { PaperRecord } from "../src/papers/ImportState";
import type { BridgeSettings } from "../src/settings";
import {
	literatureFrontmatter,
	formatAnnotations,
	updateManagedAnnotations,
	MalformedAnnotationMarkersError,
	isSafeCitationKey,
	readFrontmatterScalar,
	renderLiteratureTemplate,
	updateManagedFrontmatter,
	type LiteratureNoteContext,
} from "../src/literature/NoteContent";

function context(): LiteratureNoteContext {
	return {
		citationKey: "lovelace2026analytical",
		itemKey: "ITEM0001",
		attachmentKey: "ATTACH01",
		selectUri: "zotero://select/library/items/ITEM0001",
		pdfPath: "01_Papers/paper.pdf",
		metadata: {
			itemType: "journalArticle",
			title: "Analytical Engines & Notes",
			creators: [{
				firstName: "Ada",
				lastName: "Lovelace",
				name: "",
				creatorType: "author",
			}],
			date: "2026",
			year: "2026",
			publicationTitle: "Test \"Journal\"",
			doi: "10.0000/test",
			abstractNote: "Generated abstract.",
			url: "https://example.com",
			citationKey: "lovelace2026analytical",
		},
	};
}

describe("Literature Note content", () => {
	it("renders the configured template and escapes YAML placeholders", () => {
		let rendered = renderLiteratureTemplate([
			"---",
			"title: {{title_yaml}}",
			"authors:",
			"{{authors_yaml}}",
			"publication: {{publicationTitle_yaml}}",
			"zotero_select: {{zoteroSelect_yaml}}",
			"---",
			"# {{title}}",
			"{{abstract}}",
		].join("\n"), context());

		expect(rendered).toContain('title: "Analytical Engines & Notes"');
		expect(rendered).toContain('  - "Ada Lovelace"');
		expect(rendered).toContain('publication: "Test \\"Journal\\""');
		expect(rendered).toContain("# Analytical Engines & Notes");
		expect(rendered).toContain("Generated abstract.");
	});

	it("rejects citation keys that are unsafe Windows filenames", () => {
		expect(isSafeCitationKey("lovelace2026analytical")).toBe(true);
		expect(isSafeCitationKey("unsafe/key")).toBe(false);
		expect(isSafeCitationKey("CON")).toBe(false);
		expect(isSafeCitationKey("trailing.")).toBe(false);
	});

	it("updates managed frontmatter idempotently while preserving custom fields and body", () => {
		let original = [
			"---",
			"type: old",
			"custom_field: keep-me",
			"authors:",
			"  - Old Author",
			"zotero_item_key: OLD",
			"---",
			"# User heading",
			"",
			"User-owned comments stay unchanged.",
		].join("\n");
		let managed = literatureFrontmatter(context());
		let first = updateManagedFrontmatter(original, managed);
		let second = updateManagedFrontmatter(first, managed);

		expect(second).toBe(first);
		expect(first).toContain("custom_field: keep-me");
		expect(first.indexOf("custom_field: keep-me")).toBeLessThan(first.indexOf("authors:"));
		expect(first).toContain("# User heading\n\nUser-owned comments stay unchanged.");
		expect(first).toContain('zotero_item_key: "ITEM0001"');
		expect(readFrontmatterScalar(first, "zotero_item_key")).toBe("ITEM0001");
	});

	it("formats annotations into semantic callouts, deep links, tags and empty state", () => {
		let empty = formatAnnotations([], "key1");
		expect(empty).toContain("<!-- BEGIN ANNOTATIONS -->");
		expect(empty).toContain("<!-- END ANNOTATIONS -->");
		expect(empty).toContain("> [!info] 尚無劃線註解");

		let formatted = formatAnnotations([
			{
				key: "ANNO01",
				type: "highlight",
				text: "Important theorem text",
				comment: "User reflection",
				color: "#ffd400",
				colorCategory: "yellow",
				pageLabel: "3",
				sortIndex: "00003",
				tags: ["theorem"],
				selectUri: "zotero://select/library/items/ANNO01",
				openPdfUri: "zotero://open-pdf/library/items/ATTA?page=3&annotation=ANNO01",
			},
			{
				key: "ANNO02",
				type: "image",
				text: "Figure 1 caption",
				comment: "",
				color: "#ff6666",
				colorCategory: "red",
				pageLabel: "5",
				sortIndex: "00005",
				tags: [],
				selectUri: "zotero://select/library/items/ANNO02",
				openPdfUri: "zotero://open-pdf/library/items/ATTA?page=5&annotation=ANNO02",
			},
		], "lovelace2026analytical");

		expect(formatted).toContain("> [!quote]+ p. 3 ([Zotero](zotero://open-pdf/library/items/ATTA?page=3&annotation=ANNO01))");
		expect(formatted).toContain("> Important theorem text");
		expect(formatted).toContain("> **Comment**: User reflection");
		expect(formatted).toContain("> #theorem");
		expect(formatted).toContain("> [!danger]+ p. 5 ([Zotero](zotero://open-pdf/library/items/ATTA?page=5&annotation=ANNO02))");
		expect(formatted).toContain("> ![[assets/lovelace2026analytical/ANNO02.png]]");
	});

	it("updates existing annotation anchor without touching manual user notes", () => {
		let existingNote = [
			"---",
			"type: literature",
			"---",
			"# Note",
			"",
			"## Abstract",
			"The abstract.",
			"",
			"## Annotations",
			"",
			"<!-- BEGIN ANNOTATIONS -->",
			"Old content",
			"<!-- END ANNOTATIONS -->",
			"",
			"## My Comments",
			"",
			"Critical manual user notes that must never be deleted!",
		].join("\n");

		let block = formatAnnotations([], "key1");
		let updated = updateManagedAnnotations(existingNote, block);

		expect(updated).toContain(block);
		expect(updated).not.toContain("Old content");
		expect(updated).toContain("## My Comments\n\nCritical manual user notes that must never be deleted!");
	});

	it("inserts annotations after Abstract in legacy notes lacking anchor", () => {
		let legacyNote = [
			"---",
			"type: literature",
			"---",
			"# Note",
			"",
			"## Abstract",
			"The abstract text.",
			"",
			"## Research Question",
			"My question.",
		].join("\n");

		let block = formatAnnotations([], "key1");
		let updated = updateManagedAnnotations(legacyNote, block);

		expect(updated).toContain("## Abstract\nThe abstract text.\n\n## Annotations\n\n" + block);
		expect(updated).toContain("## Research Question\nMy question.");
	});

	it("throws MalformedAnnotationMarkersError when annotation tags are unpaired to protect user notes", () => {
		let brokenBeginOnly = [
			"## Annotations",
			"<!-- BEGIN ANNOTATIONS -->",
			"Some annotations",
			"",
			"## My precious notes that must never be deleted",
		].join("\n");

		let block = formatAnnotations([], "key1");
		expect(() => updateManagedAnnotations(brokenBeginOnly, block))
			.toThrow(MalformedAnnotationMarkersError);

		let brokenEndOnly = [
			"## Annotations",
			"Some annotations",
			"<!-- END ANNOTATIONS -->",
			"",
			"## My notes",
		].join("\n");

		expect(() => updateManagedAnnotations(brokenEndOnly, block))
			.toThrow(MalformedAnnotationMarkersError);

		let invertedTags = [
			"<!-- END ANNOTATIONS -->",
			"content",
			"<!-- BEGIN ANNOTATIONS -->",
		].join("\n");

		expect(() => updateManagedAnnotations(invertedTags, block))
			.toThrow(MalformedAnnotationMarkersError);
	});

	it("formats gray annotations as note callouts", () => {
		let grayAnno = {
			key: "ANNO_GRAY",
			type: "highlight" as const,
			text: "Gray highlighted insight",
			comment: "",
			color: "#aaaaaa",
			colorCategory: "gray" as const,
			pageLabel: "5",
			sortIndex: "00005",
			tags: [],
			selectUri: "zotero://select",
			openPdfUri: "zotero://open-pdf",
		};
		let block = formatAnnotations([grayAnno], "key1");
		expect(block).toContain("> [!note]+ p. 5 ([Zotero](zotero://open-pdf))");
		expect(block).toContain("> Gray highlighted insight");
	});
});

function paperRecord(): PaperRecord {
	return {
		path: "01_Papers/paper.pdf",
		status: "complete",
		attempts: 1,
		updatedAt: "2026-01-01T00:00:00.000Z",
		itemKey: "ITEM0001",
		attachmentKey: "ATTACH01",
		selectUri: "zotero://select/library/items/ITEM0001",
		literatureNote: "02_Literature/lovelace2026analytical.md",
		metadata: {
			itemType: "journalArticle",
			title: "Analytical Engines & Notes",
			creators: [{
				firstName: "Ada",
				lastName: "Lovelace",
				name: "",
				creatorType: "author",
			}],
			date: "2026",
			year: "2026",
			publicationTitle: "Test \"Journal\"",
			doi: "10.0000/test",
			abstractNote: "Generated abstract.",
			url: "https://example.com",
			citationKey: "lovelace2026analytical",
		},
	};
}

function testSettings(): BridgeSettings {
	return {
		papersFolder: "01_Papers",
		literatureFolder: "02_Literature",
		templatePath: "Templates/Literature.md",
		watchForNewPdfs: true,
		scanOnStartup: true,
		enableCitationAutocomplete: true,
		citationInsertionMode: "literature-note-link",
		syncAnnotationsOnImport: true,
		exportAnnotationImages: false,
		zoteroEndpoint: "http://localhost:23119",
		stablePollIntervalMs: 1,
		stableRequiredSamples: 1,
		stableTimeoutMs: 100,
		recognitionTimeoutMs: 120_000,
	};
}

describe("LiteratureNoteService annotation preservation", () => {
	it("leaves existing annotation block untouched when annotations is undefined", async () => {
		let noteContent = [
			"---",
			"type: literature",
			'title: "Analytical Engines & Notes"',
			'citation_key: "lovelace2026analytical"',
			'zotero_item_key: "ITEM0001"',
			'zotero_attachment_key: "ATTACH01"',
			'pdf: "[[01_Papers/paper.pdf]]"',
			"---",
			"# Analytical Engines & Notes",
			"",
			"## Annotations",
			"",
			"<!-- BEGIN ANNOTATIONS -->",
			"> [!quote]+ p. 1 ([Zotero](zotero://open-pdf/library/items/ATTACH01?page=1&annotation=ANNO1))",
			"> Hand-curated existing highlight that must never be deleted",
			"<!-- END ANNOTATIONS -->",
			"",
			"## My Notes",
			"Personal thoughts.",
		].join("\n");

		let writtenContent = "";
		let file = Object.assign(new TFile(), {
			path: "02_Literature/lovelace2026analytical.md",
			extension: "md",
		});

		let app = {
			vault: {
				getAbstractFileByPath: (p: string) => {
					if (p === "02_Literature/lovelace2026analytical.md") return file;
					return null;
				},
				read: async () => noteContent,
				modify: async (_f: TFile, content: string) => {
					writtenContent = content;
				},
			},
		} as unknown as App;

		let service = new LiteratureNoteService(app, testSettings);
		await service.createOrUpdate("01_Papers/paper.pdf", paperRecord(), undefined);

		if (writtenContent !== "") {
			expect(writtenContent).toContain("Hand-curated existing highlight that must never be deleted");
			expect(writtenContent).not.toContain("尚無劃線註解");
		}
	});

	it("overwrites annotation block with empty callout when annotations is empty array []", async () => {
		let noteContent = [
			"---",
			"type: literature",
			'title: "Analytical Engines & Notes"',
			'citation_key: "lovelace2026analytical"',
			'zotero_item_key: "ITEM0001"',
			'zotero_attachment_key: "ATTACH01"',
			'pdf: "[[01_Papers/paper.pdf]]"',
			"---",
			"# Analytical Engines & Notes",
			"",
			"## Annotations",
			"",
			"<!-- BEGIN ANNOTATIONS -->",
			"> [!quote]+ p. 1 ([Zotero](zotero://open-pdf/library/items/ATTACH01?page=1&annotation=ANNO1))",
			"> Old highlight",
			"<!-- END ANNOTATIONS -->",
		].join("\n");

		let writtenContent = "";
		let file = Object.assign(new TFile(), {
			path: "02_Literature/lovelace2026analytical.md",
			extension: "md",
		});

		let app = {
			vault: {
				getAbstractFileByPath: (p: string) => {
					if (p === "02_Literature/lovelace2026analytical.md") return file;
					return null;
				},
				read: async () => noteContent,
				modify: async (_f: TFile, content: string) => {
					writtenContent = content;
				},
			},
		} as unknown as App;

		let service = new LiteratureNoteService(app, testSettings);
		await service.createOrUpdate("01_Papers/paper.pdf", paperRecord(), []);

		expect(writtenContent).toContain("<!-- BEGIN ANNOTATIONS -->");
		expect(writtenContent).toContain("> [!info] 尚無劃線註解");
		expect(writtenContent).not.toContain("Old highlight");
	});
});

