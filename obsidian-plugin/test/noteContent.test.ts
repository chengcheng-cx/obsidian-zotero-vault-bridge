import { describe, expect, it } from "vitest";
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
